import * as request from 'request';

request({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/52.0.2743.116 Safari/537.36',
        'Referer': 'http://www.baidu.com/',
        'Cookie': ''
    },
    url: 'http://chuansong.me/account/duhaoshu',
    proxy: 'http://122.228.179.178:80'
}, function (err, msg, body) {
    if (err) {
        console.log(err)
    } else {
        console.log(body);
    }

})