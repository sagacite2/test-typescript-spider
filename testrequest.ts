import api = require('./api');
import * as request from 'request';

// (async () => {
//     let body = await api.request_get('http://www.baidu.com/');
//     console.log(body);
// })();

import Devourer = require('./Devourer');
let c = new Devourer.Worker({
    headers: {
        'User-Agent': Devourer.UserAgent.Chrome,
        'Referer': 'http://www.baidu.com/',
        'Cookie': ''
    },
    debug: true,
    proxy: ['http://1.82.216.135:80', 'http://14.29.124.52:80', 'http://14.29.124.53:80'],
});
c.queue({
    uri: 'http://www.baidu.com/',
    // forceUTF8:true,

    // The global callback won't be called
    callback: function (error, result, body) {

    }
});


