import * as request from 'request';

request({
    url: 'http://chuansong.me/',
    proxy: 'http://1.82.216.135:80'
}, function (err, msg, body) {
    if (err) {
        console.log(err)
    } else {
        console.log(body);
    }

})