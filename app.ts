import api = require('./api');
import helper = require('./helper');
import cheerio = require('cheerio');

(async () => {

    try {
        let urls = await api.get_index_urls();
        for (let i = 0; i < urls.length; i++) {
            await helper.wait_seconds(1);
            await api.fetch_content(urls[i]);
        }
    } catch (err) {
        console.log(err);
    }

    console.log('完毕！');

})();