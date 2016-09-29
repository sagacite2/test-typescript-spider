import mongoose = require('mongoose');
import IArticle = require('./IArticle');
interface IArticleModel extends IArticle, mongoose.Document { }

const ArticleSchema = new mongoose.Schema({
    title: { type: String },
    url: { type: String },
    text: { type: String },
});

const Article = mongoose.model<IArticleModel>("Article", ArticleSchema);

export = Article;