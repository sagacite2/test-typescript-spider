const Pool = require('generic-pool').Pool;
const iconvLite = require('iconv-lite');
import * as path from 'path';
import * as util from 'util';
import * as event from 'events';
const EventEmitter = event.EventEmitter;
import * as request from 'request';
import * as _ from 'lodash';
const jschardet = require('jschardet');
import * as cheerio from 'cheerio';
import * as zlib from 'zlib';
import * as fs from 'fs';


interface DevourerOptions extends request.CoreOptions, CheerioOptionsInterface {
    cache: boolean;
    forceUTF8: boolean;
    incomingEncoding: string;
    method: string;
    priority: number;
    rateLimits: number;
    referer: string;
    retries: number;
    retryTimeout: number;
    skipDuplicates: boolean;
    debug: boolean;
}
interface Task {
    uri: string;
    priority?: number;
    get_uri_function?: Function;
    html?: string;
    _poolReference?: any;
    options?: DevourerOptions;
}

//判断是否使用缓存
function useCache(options: DevourerOptions) {
    return (
        (options.cache || options.skipDuplicates) &&
        (options.method === 'GET' || options.method === 'HEAD'));
}

class Devourer extends EventEmitter {
    onDrain: Function;
    private pool: any;
    private plannedQueueCallsCount: number;
    private queueItemSize: number;
    private cache: Object;

    static defaultOptions: DevourerOptions = {
        cache: false,
        forceUTF8: false,
        incomingEncoding: null,
        method: 'GET',
        priority: 5,
        rateLimits: 0,
        referer: null,
        retries: 3,
        retryTimeout: 10000,
        skipDuplicates: false,
        normalizeWhitespace: false,
        xmlMode: false,
        decodeEntities: true,
        debug: false,
    };

    constructor(private options: DevourerOptions, private maxConnections: number = 10, private priorityRange: number = 10) {
        super();
        const self = this;

        //return defaultOptions with overriden properties from options.
        self.options = _.extend(Devourer.defaultOptions, options);

        // if using rateLimits we want to use only one connection with delay in between requests
        if (self.options.rateLimits !== 0) {
            self.maxConnections = 1;
        }

        //Setup a worker pool w/ https://github.com/coopernurse/node-pool
        self.pool = Pool({
            name: 'Devourer',
            max: self.maxConnections,
            priorityRange: priorityRange,
            create: function (callback) {
                callback(1);
            },
            destroy: function () { }
        });

        self.plannedQueueCallsCount = 0;
        self.queueItemSize = 0;

        self.cache = {};
        self.onDrain = function () { }
        self.on('pool:release', function (t: Task) {
            self._release(t);
        });

        self.on('pool:drain', function () {
            if (self.onDrain) {
                self.onDrain();
            }
        });
    }
    private _release(t: Task) {
        const self = this;

        self.queueItemSize--;
        if (t._poolReference) {
            self.pool.release(t._poolReference);
        }

        // Pool stats are behaving weird - have to implement our own counter
        if (self.queueItemSize + self.plannedQueueCallsCount === 0) {
            self.emit('pool:drain');
        }
    }
    private _inject(response, options) {
        return cheerio.load(response.body, options.cheerioOptions);
    }
    queue(...url: string[]);
    queue(...task: Task[]);
    queue(rest) {
        if (typeof rest[0] === 'string') {
            this._pushToQueue({ uri: rest[0] });
        } else {
            this._pushToQueue(rest[0]);
        }
        rest.shift();
        this.queue(rest);
    }
    private _pushToQueue(t: Task) {
        if (!t.options) {
            t.options = this.options;
        } else {
            t.options = _.defaults(t.options, this.options);
        }
        this.queueItemSize++;
        if (t.options.skipDuplicates && this.cache[t.uri]) {
            return this.emit('pool:release', t);
        }
        this.pool.acquire(function (error, poolReference) {
            t._poolReference = poolReference;

            // this is and operation error
            if (error) {
                console.error('pool acquire error:', error);
                t.options.callback(error, null, null);
                return;
            }

            //Static HTML was given, skip request
            if (t.html) {
                this._onContent(null, t, { body: t.html }, false);
            } else if (t.get_uri_function) {
                t.uri = t.get_uri_function();
                this._makeCrawlerRequest(t);

            } else {
                this._makeCrawlerRequest(t);
            }
        }, t.priority);
    }
    private _makeCrawlerRequest(t: Task) {
        const self = this;

        if (self.options.rateLimits !== 0) {
            setTimeout(function () {
                self._executeCrawlerRequest(t);
            }, self.options.rateLimits);
        } else {
            self._executeCrawlerRequest(t);
        }
    }
    private _executeCrawlerRequest(t: Task) {
        const self = this;
        let cacheData = self.cache[t.uri];

        //If a query has already been made to self URL, don't callback again
        if (useCache(self.options) && cacheData) {

            // Make sure we actually have cached data, and not just a note
            // that the page was already crawled
            if (_.isArray(cacheData)) {
                self._onContent(null, t, cacheData[0], true);
            } else {
                self.emit('pool:release', t);
            }

        } else {
            self._buildHTTPRequest(t);
        }
    }
    private _buildHTTPRequest(t: Task) {
        var self = this;

        if (t.options.debug) {
            console.log(t.options.method + ' ' + t.uri + ' ...');
        }
        if (!t.options.headers) {
            t.options.headers = {};
        }
        if (t.options.forceUTF8) {
            if (!t.options.headers['Accept-Charset'] && !t.options.headers['accept-charset']) {
                t.options.headers['Accept-Charset'] = 'utf-8;q=0.7,*;q=0.3';
            }
            if (!t.options.encoding) {
                t.options.encoding = null;
            }
        }
        if (typeof t.options.encoding === 'undefined') {
            t.options.headers['Accept-Encoding'] = 'gzip';
            t.options.encoding = null;
        }
        if (t.options.agent) {
            t.options.headers['User-Agent'] = t.options.agent;
        }

        if (t.options.proxy && t.options.proxy.length) {
            t.options.proxy = t.options.proxy[0];
        }

        let req = request(t.uri, t.options, function (error, msg, body) {
            if (error) {
                return self._onContent(error, t);
            }
            self._onContent(error, t, body, false);

        });
    }

    private _onContent (error, t:Task,response?:any, body?:any, fromCache:boolean=false) {
    var self = this;

    if (error) {
        if (t.options.debug) {
            console.log('Error '+error+' when fetching '+
            t.uri+(t.options.retries?' ('+t.options.retries+' retries left)':''));
        }
        if (t.options.retries) {
            self.plannedQueueCallsCount++;
            setTimeout(function() {
                t.options.retries--;
                self.plannedQueueCallsCount--;

                // If there is a "proxies" option, rotate it so that we don't keep hitting the same one
                if (t.options.proxy) {
                    t.options.proxy.push(t.options.proxy.shift());
                }

                self.queue(t);
            },t.options.retryTimeout);

        } else if (t.options.callback) {
            t.options.callback(error,response,body);
        }

        return self.emit('pool:release', t);
    }

    if (!response.body) { response.body=''; }

    if (t.options.debug) {
        console.log('Got '+(t.uri||'html')+' ('+response.body.length+' bytes)...');
    }

    if (t.options.forceUTF8) {
        //TODO check http header or meta equiv?
        var iconvObj;

        if (!t.options.incomingEncoding) {
            var detected = jschardet.detect(response.body);

            if (detected && detected.encoding) {
                if (t.options.debug) {
                    console.log(
                        'Detected charset ' + detected.encoding +
                        ' (' + Math.floor(detected.confidence * 100) + '% confidence)'
                    );
                }
                if (detected.encoding !== 'utf-8' && detected.encoding !== 'ascii') {

                  if (detected.encoding !== 'Big5') {
                        response.body = iconvLite.decode(response.body, detected.encoding);
                    }

                } else if (typeof response.body !== 'string') {
                    response.body = response.body.toString();
                }

            } else {
                response.body = response.body.toString('utf8'); //hope for the best
            }
        } else { // do not hope to best use custom encoding
            if (t.options.incomingEncoding !== 'Big5') {
                response.body = iconvLite.decode(response.body, t.options.incomingEncoding);
            }
        }

    } else {
        response.bodyRAW =response.body;
        response.body = response.body.toString();
    }

    if (useCache(t.options) && !fromCache) {
        if (t.options.cache) {
            self.cache[t.uri] = [response];

            //If we don't cache but still want to skip duplicates we have to maintain a list of fetched URLs.
        } else if (t.options.skipDuplicates) {
            self.cache[t.uri] = true;
        }
    }

    if (!t.options.callback) {
        return self.emit('pool:release', t);
    }


    // This could definitely be improved by *also* matching content-type headers
    var isHTML = response.body.match(/^\s*</);

    if (isHTML  && t.options.method !== 'HEAD') {
        self._inject(response, options, function(errors, $) {
            self._onInject(errors, options, response, $);
        });
    } else {
        t.options.callback(null,response);
        self.emit('pool:release', t);
    }
}
}



















export = Crawler;