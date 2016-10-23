//仿照node-crawler改写的ts代码

import * as event from 'events';
import * as request from 'request';
import * as cheerio from 'cheerio';
import * as helper from './helper';
import * as http from 'http';
import * as jschardet from 'jschardet';
import * as iconvLite from 'iconv-lite';
import * as generic_pool from 'generic-pool';

interface Task extends request.CoreOptions, CheerioOptionsInterface {
    cache?: boolean;//是否使用缓存，默认false
    forceUTF8?: boolean;//是否强制转换为UTF8，默认false
    priority?: number;//优先级，默认5
    rateLimits?: number;//两个请求之间的暂停时间（毫秒），默认1000
    retries?: number;//重试次数，默认3
    retryTimeout?: number;//重试间隔时间（毫秒），默认10000
    skipDuplicates?: boolean;//是否忽略重复的链接，默认false
    debug?: boolean;//debug模式，默认false
    uri?: string;//链接地址
    uri_getter?: Function;//可选：获取链接地址的函数
    html?: string;//直接给定html，用于测试
    cheerioConvert?: boolean;//是否用cheerio加载，默认打开
    _poolReference?: any;//线程池的一个对象引用，内部使用，无需配置

}
interface Result {
    incomingMessage?: http.IncomingMessage;
    body?: string;
    bodyRAW: any;
    $?: CheerioStatic;
}
//判断是否使用缓存
function enableCache(t: Task) {
    return ((t.cache || t.skipDuplicates) &&
        (t.method === 'GET' || t.method === 'HEAD'));
}

class Worker extends event.EventEmitter {
    onDrain: Function;
    private pool: any;
    private plannedQueueCallsCount: number;
    private queueItemSize: number;
    private cache: Object;

    static defaultOptions: Task = {
        uri: '',
        cache: false,
        forceUTF8: false,
        method: 'GET',//指定请求方法，默认GET方法
        priority: 5,
        rateLimits: 1000,
        retries: 3,
        retryTimeout: 10000,
        skipDuplicates: false,
        normalizeWhitespace: false,
        xmlMode: false,
        decodeEntities: true,
        debug: false,
        cheerioConvert: true,
        encoding: 'utf-8',//默认使用utf-8编码

    };

    constructor(private options?: Task, private maxConnections: number = 10, private priorityRange: number = 10) {
        super();
        const self = this;

        self.options = helper.extend(Worker.defaultOptions, options);

        //如果两个请求间的间隔不是0，则强制只用一个线程，这是合理的。
        if (self.options.rateLimits !== 0) {
            self.maxConnections = 1;
        }

        //线程池 https://github.com/coopernurse/node-pool
        self.pool = generic_pool.Pool({
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
            self.release(t);
        });

        self.on('pool:drain', function () {
            if (self.onDrain) {
                self.onDrain();
            }
        });
    }
    private release(t: Task) {
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
        if (!Array.isArray(rest)) {
            rest = [rest];
        }
        if (typeof rest[0] === 'string') {
            this.pushToQueue({ uri: rest[0] });
        } else {
            if (!rest[0].uri) {

            }
            this.pushToQueue(rest[0]);
        }
        rest.shift();
        if (rest.length > 0) {
            this.queue(rest);
        }

    }
    private pushToQueue(t: Task) {

        const self = this;
        t = helper.extend(self.options, t);

        self.queueItemSize++;
        if (t.uri && t.skipDuplicates && self.cache[t.uri]) {
            return self.emit('pool:release', t);
        }
      
        self.pool.acquire(function (error, poolReference) {

            t._poolReference = poolReference;

            if (error) {
                console.error('pool acquire error:', error);
                if (t.callback) {
                    t.callback(error, <http.IncomingMessage>{}, null);
                }

                return;
            }

            //Static HTML was given, skip request
            if (t.html) {
                self.onContent(null, t, { bodyRAW: t.html }, false);
            } else if (t.uri_getter) {
                t.uri = t.uri_getter();
                self.makeCrawlerRequest(t);

            } else {
                self.makeCrawlerRequest(t);
            }
        }, t.priority);
    }
    private makeCrawlerRequest(t: Task) {
        const self = this;

        if (t.rateLimits !== 0) {
            setTimeout(function () {
                self.executeCrawlerRequest(t);
            }, t.rateLimits);
        } else {
            self.executeCrawlerRequest(t);
        }
    }
    private executeCrawlerRequest(t: Task) {
        const self = this;
        let cacheData = t.uri ? self.cache[t.uri] : null;

        //If a query has already been made to self URL, don't callback again
        if (enableCache(t) && cacheData) {

            // Make sure we actually have cached data, and not just a note
            // that the page was already crawled
            if (_.isArray(cacheData)) {
                self.onContent(null, t, cacheData[0] as Result, true);
            } else {
                self.emit('pool:release', t);
            }

        } else {
            self.buildHTTPReques(t);
        }
    }
    private buildHTTPReques(t: Task) {
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
                t.encoding = undefined;
            }
        }
        if (typeof t.encoding === 'undefined') {
            t.headers['Accept-Encoding'] = 'gzip';
            t.encoding = undefined;
        }
        if (t.agent) {
            t.headers['User-Agent'] = t.agent;
        }
        if (Array.isArray(t.proxy)) {
            if (t.proxy.length > 0) {
                //随机选取一个代理服务器
                t.proxy = t.proxy[Math.floor(Math.random() * (t.proxy.length - 1))];
            } else {
                t.proxy = '';
            }
        }
        //注意，msg是Node自带的http.IncomingMessage对象，而body才是html内容.
        if (t.uri) {
            request(t.uri, t, function (error, msg, body) {
                //把request返回的body放到result.bodyRAW里
                self.onContent(error, t, { 'incomingMessage': msg, 'bodyRAW': body });
            });
        }

    }

    private onContent(error, t: Task, result: Result, fromCache: boolean = false) {
        const self = this;
        //如果发生错误，则尝试重试
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
                    self.queue(t);
                }, t.retryTimeout);
            } else if (t.callback) {
                t.callback(error, <http.IncomingMessage>{}, undefined);
            }
            return self.emit('pool:release', t);
        }

        if (t.debug) {
            if (typeof result.bodyRAW !== 'string') {
                console.log('Got ' + (t.uri || 'html') + ' (raw body is not string:' + typeof result.bodyRAW);

            } else {
                console.log('Got ' + (t.uri || 'html') + ' (' + result.bodyRAW.length + ' bytes)...');
            }
        }
        if (typeof result.bodyRAW !== 'string') {
            return self.emit('pool:release', t);
        }
        result.body = result.bodyRAW;
        //如果指定了强制转换成UTF8编码，则进行转码
        if (t.forceUTF8) {
            var detected = jschardet.detect(result.bodyRAW);
            //如果通过jschardet模块分析到文本的编码格式
            if (detected && detected.encoding) {
                if (t.debug) {
                    console.log(
                        'Detected charset ' + detected.encoding +
                        ' (' + Math.floor(detected.confidence * 100) + '% confidence)'
                    );
                }
                if (detected.encoding !== 'utf-8' && detected.encoding !== 'ascii' && detected.encoding !== 'Big5') {
                    result.body = iconvLite.decode(result.bodyRAW, detected.encoding) as string;
                }
            } else {
                if (t.debug) {
                    console.log('jschardet fail to detect the body\'s encoding!');
                }
            }

        }

        //缓存result
        if (enableCache(t) && !fromCache) {
            if (t.debug) {
                console.log('caching...');
            }
            if (t.cache && t.uri) {
                self.cache[t.uri] = [result];

                //If we don't cache but still want to skip duplicates we have to maintain a list of fetched URLs.
            } else if (t.skipDuplicates && t.uri) {
                self.cache[t.uri] = true;
            }
        }

        if (!t.callback) {
            return self.emit('pool:release', t);
        }
        // This could definitely be improved by *also* matching content-type headers
        var isHTML = result.body.match(/^\s*</);
        if (!isHTML) {
            console.log('this is not HTML!');
        }
        if (isHTML && t.method !== 'HEAD' && result.incomingMessage) {
            t.callback(null, result.incomingMessage, t.cheerioConvert ? cheerio.load(result.body, t) : result.body);
        } else {
            t.callback(null, <http.IncomingMessage>{}, undefined);
        }
        return self.emit('pool:release', t);
    }

}
class UserAgent {
    static Chrome: string = 'Mozilla/5.0 (Windows NT 5.2) AppleWebKit/534.30 (KHTML, like Gecko) Chrome/12.0.742.122 Safari/534.30';
    static Firefox: string = 'Mozilla/5.0 (Windows NT 5.1; rv:5.0) Gecko/20100101 Firefox/5.0';
    static IE8: string = 'Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 5.2; Trident/4.0; .NET CLR 1.1.4322; .NET CLR 2.0.50727; .NET4.0E; .NET CLR 3.0.4506.2152; .NET CLR 3.5.30729; .NET4.0C)';
    static IE9: string = 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; Trident/5.0; SLCC2; .NET CLR 2.0.50727; .NET CLR 3.5.30729; .NET CLR 3.0.30729; Media Center PC 6.0; .NET4.0C; .NET4.0E)';
    static IE7: string = 'Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 5.2; .NET CLR 1.1.4322; .NET CLR 2.0.50727; .NET4.0E; .NET CLR 3.0.4506.2152; .NET CLR 3.5.30729; .NET4.0C)';
    static IE6: string = 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1; SV1; .NET CLR 2.0.50727) ';
    static Opera: string = 'Opera/9.80 (Windows NT 5.1; U; zh-cn) Presto/2.9.168 Version/11.50';
    static Safari: string = 'Mozilla/5.0 (Windows; U; Windows NT 5.1; zh-CN) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1';
    static Maxthon: string = 'Mozilla/5.0 (Windows; U; Windows NT 5.1; ) AppleWebKit/534.12 (KHTML, like Gecko) Maxthon/3.0 Safari/534.12';
    static TheWorld: string = 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1; SV1; .NET CLR 2.0.50727; TheWorld)';
    static IPhone: string = 'Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Version/5.1 Mobile/9A5313e Safari/7534.48.3';
    static SAMSUNG: string = 'Mozilla/5.0 (compatible; MSIE 9.0; Windows Phone OS 7.5; Trident/5.0; IEMobile/9.0; SAMSUNG; OMNIA7)';
    static Macintosh: string = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_7_2) AppleWebKit/535.1 (KHTML, like Gecko) Chrome/14.0.835.202 Safari/535.1';

}

export default { Worker, UserAgent };