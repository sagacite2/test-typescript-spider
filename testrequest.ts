import api = require('./api');
import * as request from 'request';

(async () => {
    let body = await api.request_get('http://www.baidu.com/');
    console.log(body);
})();

import Crawler = require('./Devourer');
let c = new Crawler();
c.queue({
    uri: 'http://www.baidu.com/',
    debug:true,
    // The global callback won't be called
    callback: function (error, result, body) {
        
    }
});


