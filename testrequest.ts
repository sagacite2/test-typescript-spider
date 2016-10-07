import api = require('./api');
(async () => {
    let body = await api.request_get('http://www.baidu.com/');
    console.log(body);
})();

const Crawler = require('../modules/crawler');
let c = new Crawler();
c.queue([{
    uri: 'http://www.baidu.com/',
    jQuery: false,

    // The global callback won't be called
    callback: function (error, result) {
        console.log('Grabbed', result.body.length, 'bytes');
    }
}]);