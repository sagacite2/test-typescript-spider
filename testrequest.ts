import api = require('./api');
(async () => {
    let body = await api.request_get('http://www.baidu.com/');
    console.log(body);
})();