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


interface Task extends request.CoreOptions, CheerioOptionsInterface {
    cache?: boolean;//是否使用缓存，默认false
    forceUTF8?: boolean;//是否强制转换为UTF8，默认false
    incomingEncoding?: string;//手动指定编码格式，默认null
    method?: string;//指定请求方法，默认GET方法
    priority?: number;//优先级，默认5
    rateLimits?: number;//两个请求之间的暂停时间（毫秒），默认0
    referer?: string;
    retries?: number;//重试次数，默认3
    retryTimeout?: number;//重试间隔时间（毫秒），默认10000
    skipDuplicates?: boolean;//是否忽略重复的链接，默认false
    debug?: boolean;//debug模式，默认false
    uri?: string;//链接地址
    uri_getter?: Function;//可选：获取链接地址的函数
    html?: string;//直接给定html，用于测试
    _poolReference?: any;//线程池的一个对象引用，内部使用，无需配置
}

//判断是否使用缓存
function useCache(t: Task) {
    return ((t.cache || t.skipDuplicates) &&
        (t.method === 'GET' || t.method === 'HEAD'));
}

class Devourer extends EventEmitter {
    onDrain: Function;
    private pool: any;
    private plannedQueueCallsCount: number;
    private queueItemSize: number;
    private cache: Object;

    static defaultOptions: Task = {
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

    constructor(private options: Task, private maxConnections: number = 10, private priorityRange: number = 10) {
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

        t = _.defaults(t, this.options);

        this.queueItemSize++;
        if (t.skipDuplicates && this.cache[t.uri]) {
            return this.emit('pool:release', t);
        }
        this.pool.acquire(function (error, poolReference) {
            t._poolReference = poolReference;

            // this is and operation error
            if (error) {
                console.error('pool acquire error:', error);
                t.callback(error, null, null);
                return;
            }

            //Static HTML was given, skip request
            if (t.html) {
                this._onContent(null, t, { body: t.html }, false);
            } else if (t.uri_getter) {
                t.uri = t.uri_getter();
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

        if (t.debug) {
            console.log(t.method + ' ' + t.uri + ' ...');
        }
        if (!t.headers) {
            t.headers = {};
        }
        if (t.forceUTF8) {
            if (!t.headers['Accept-Charset'] && !t.headers['accept-charset']) {
                t.headers['Accept-Charset'] = 'utf-8;q=0.7,*;q=0.3';
            }
            if (!t.encoding) {
                t.encoding = null;
            }
        }
        if (typeof t.encoding === 'undefined') {
            t.headers['Accept-Encoding'] = 'gzip';
            t.encoding = null;
        }
        if (t.agent) {
            t.headers['User-Agent'] = t.agent;
        }

        if (t.proxy && t.proxy.length) {
            t.proxy = t.proxy[0];
        }

        let req = request(t.uri, t, function (error, msg, body) {
            if (error) {
                return self._onContent(error, t);
            }
            self._onContent(error, t, body, false);

        });
    }

    private _onContent(error, t: Task, response?: any, body?: any, fromCache: boolean = false) {
        var self = this;

        if (error) {
            if (t.debug) {
                console.log('Error ' + error + ' when fetching ' +
                    t.uri + (t.retries ? ' (' + t.retries + ' retries left)' : ''));
            }
            if (t.retries) {
                self.plannedQueueCallsCount++;
                setTimeout(function () {
                    t.retries--;
                    self.plannedQueueCallsCount--;

                    // If there is a "proxies" option, rotate it so that we don't keep hitting the same one
                    if (t.proxy) {
                        t.proxy.push(t.proxy.shift());
                    }

                    self.queue(t);
                }, t.retryTimeout);

            } else if (t.callback) {
                t.callback(error, response, body);
            }

            return self.emit('pool:release', t);
        }

        if (!response.body) { response.body = ''; }

        if (t.debug) {
            console.log('Got ' + (t.uri || 'html') + ' (' + response.body.length + ' bytes)...');
        }

        if (t.forceUTF8) {
            //TODO check http header or meta equiv?
            var iconvObj;

            if (!t.incomingEncoding) {
                var detected = jschardet.detect(response.body);

                if (detected && detected.encoding) {
                    if (t.debug) {
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
                if (t.incomingEncoding !== 'Big5') {
                    response.body = iconvLite.decode(response.body, t.incomingEncoding);
                }
            }

        } else {
            response.bodyRAW = response.body;
            response.body = response.body.toString();
        }

        if (useCache(t) && !fromCache) {
            if (t.cache) {
                self.cache[t.uri] = [response];

                //If we don't cache but still want to skip duplicates we have to maintain a list of fetched URLs.
            } else if (t.skipDuplicates) {
                self.cache[t.uri] = true;
            }
        }

        if (!t.callback) {
            return self.emit('pool:release', t);
        }


        // This could definitely be improved by *also* matching content-type headers
        var isHTML = body.match(/^\s*</);

        if (isHTML && t.method !== 'HEAD') {
            t.callback(null, response, cheerio.load(body, t));

        } else {
            t.callback(null, response, '');

        }
        self.emit('pool:release', t);
    }
}


export = Devourer;