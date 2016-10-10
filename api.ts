import superagent = require('superagent');
import cheerio = require('cheerio');
import request = require('request');
import models = require('./models');
const Article = models.Article;

export const get_index_urls = async function () {
    const res = await remote_get('http://cnodejs.org/');

    const $ = cheerio.load(res.text);
    let urls: string[] = [];
    $('.topic_title_wrapper').each((index, element) => {
        urls.push('http://cnodejs.org' + $(element).find('.topic_title').first().attr('href'));
    });
    return urls;

}
export const fetch_content = async function (url: string) {
    const res = await remote_get(url);

    const $ = cheerio.load(res.text);
    let article = new Article();
    article.text = $('.topic_content').first().text();
    article.title = $('.topic_full_title').first().text().replace('置顶', '').replace('精华', '').trim();
    article.url = url;
    console.log('获取成功：' + article.title);
    article.save();

}
export const remote_get = (url: string) => {

    return new Promise<superagent.Response>((resolve, reject) => {
        superagent.get(url)
            .end(function (err, res) {
                if (!err) {
                    resolve(res);
                } else {
                    return reject(err);
                }
            });
    });
}

export const request_get = (url: string, proxy?: string, user_agent?: string, referer?: string, cookie?: string) => {
    const options = {
        url: url,
        proxy: proxy || '',
        headers: {
            'User-Agent': user_agent || 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/52.0.2743.116 Safari/537.36',
            'Referer': referer || 'http://www.baidu.com/',
            'Cookie': cookie || ''
        }
    };

    return new Promise((resolve, reject) => {
        request(options, function (err, res, body) {
            if (err) {
                return reject(err);
            } else {
                resolve(body);
            }
        });
    })


}