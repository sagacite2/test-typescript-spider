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

interface Options {
    cache: boolean;
    forceUTF8: boolean;
    incomingEncoding: string;
    jQuery: string;
    maxConnections: number;
    method: string;
    onDrain: Function;
    priority: number;
    priorityRange: number;
    rateLimits: number;
    referer: string;
    retries: number;
    retryTimeout: number;
    skipDuplicates: boolean;
    uri: string;
    cheerioOptions: CheerioOptionsInterface;
}
interface queueOptions {
    uri: string;
    priority?: number;
    get_uri_function?: Function;
    html?: string;
    _poolReference?: any;
    options?: request.CoreOptions;
}

//判断是否使用缓存
function useCache(options: Options) {
    return (
        options.uri &&
        (options.cache || options.skipDuplicates) &&
        (options.method === 'GET' || options.method === 'HEAD'));
}

class Crawler extends EventEmitter {
    options: Options;
    static defaultOptions: Options = {
        cache: false,
        forceUTF8: false,
        incomingEncoding: null,
        jQuery: 'cheerio',
        maxConnections: 10,
        method: 'GET',
        onDrain: null,
        priority: 5,
        priorityRange: 10,
        rateLimits: 0,
        referer: null,
        retries: 3,
        retryTimeout: 10000,
        skipDuplicates: false,
        uri: null,
        cheerioOptions: Crawler.defaultCheerioOptions
    };

    static defaultCheerioOptions: CheerioOptionsInterface = {
        normalizeWhitespace: false,
        xmlMode: false,
        decodeEntities: true
    };
    static globalOnlyOptions: string[] = ['maxConnections', 'priorityRange', 'onDrain'];
    protected pool: any;
    plannedQueueCallsCount: number;
    queueItemSize: number;
    protected cache: Object;
    //Crawler构造函数
    constructor(options: Options) {
        super();
        this.options = options;
        this.init(options);
    }
    private init(options: Options) {


        //return defaultOptions with overriden properties from options.
        this.options = _.extend(Crawler.defaultOptions, options);

        // if using rateLimits we want to use only one connection with delay in between requests
        if (this.options.rateLimits !== 0) {
            this.options.maxConnections = 1;
        }


        //Setup a worker pool w/ https://github.com/coopernurse/node-pool
        this.pool = Pool({
            name: 'crawler',
            max: this.options.maxConnections,
            priorityRange: this.options.priorityRange,
            create: function (callback) {
                callback(1);
            },
            destroy: function () { }
        });

        this.plannedQueueCallsCount = 0;
        this.queueItemSize = 0;

        this.cache = {};

        this.on('pool:release', function (options) {
            this._release(options);
        });

        this.on('pool:drain', function () {
            if (this.options.onDrain) {
                this.options.onDrain();
            }
        });
    }
    private _release(options) {
        var self = this;

        self.queueItemSize--;
        if (options._poolReference) {
            self.pool.release(options._poolReference);
        }

        // Pool stats are behaving weird - have to implement our own counter
        if (self.queueItemSize + self.plannedQueueCallsCount === 0) {
            self.emit('pool:drain');
        }
    }
    private _inject(response, options) {
        if (options.jQuery === 'cheerio') {
            return cheerio.load(response.body, options.cheerioOptions);
        }
    }
    queue(...url: string[]);
    queue(...options: queueOptions[]);
    queue(rest) {
        if (typeof rest[0] === 'string') {
            this._pushToQueue({ uri: rest[0], options: null, _poolReference: null });
        } else {
            this._pushToQueue(rest[0]);
        }
        rest.shift();
        this.queue(rest);
    }
    private _pushToQueue(queue_options: queueOptions) {
        this.queueItemSize++;
        if (this.options.skipDuplicates && this.cache[queue_options.uri]) {
            return this.emit('pool:release', queue_options);
        }
        this.pool.acquire(function (error, poolReference) {
            queue_options._poolReference = poolReference;

            // this is and operation error
            if (error) {
                console.error('pool acquire error:', error);
                queue_options.options.callback(error, null, null);
                return;
            }

            //Static HTML was given, skip request
            if (this.options.html) {
                this._onContent(null, queue_options, { body: this.options.html }, false);
            } else if (queue_options.get_uri_function) {
                queue_options.uri = queue_options.get_uri_function();
                this._makeCrawlerRequest(queue_options);

            } else {
                this._makeCrawlerRequest(queue_options);
            }
        }, this.options.priority);
    }

}



















export = Crawler;