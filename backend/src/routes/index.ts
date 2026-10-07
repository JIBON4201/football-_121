import { Router } from 'express';
import { config } from '../config';
import { cacheable } from '../lib/cache';
import { ok } from '../lib/respond';
import openapi from '../openapi/openapi.json';
import admin from './v1/admin.routes';
import articles from './v1/articles.routes';
import auth from './v1/auth.routes';
import categories from './v1/categories.routes';
import competitions from './v1/competitions.routes';
import countries from './v1/countries.routes';
import discovery from './v1/discovery.routes';
import health from './v1/health.routes';
import matches from './v1/matches.routes';
import me from './v1/me.routes';
import media from './v1/media.routes';
import news from './v1/news.routes';
import players from './v1/players.routes';
import search from './v1/search.routes';
import seo from './v1/seo.routes';
import tags from './v1/tags.routes';
import teams from './v1/teams.routes';
import transfers from './v1/transfers.routes';

const v1 = Router();

v1.use('/health', health);
v1.use('/news', news);
v1.use('/matches', matches);
v1.use('/teams', teams);
v1.use('/players', players);
v1.use('/competitions', competitions);
v1.use('/transfers', transfers);
v1.use('/categories', categories);
v1.use('/countries', countries);
v1.use('/tags', tags);
v1.use('/search', search);
v1.use('/articles', articles);
v1.use('/media', media);
v1.use('/seo', seo);
v1.use('/admin', admin);
v1.use('/auth', auth);
v1.use('/', discovery);
v1.use('/me', me);

v1.get('/docs.json', cacheable(config.cache.staticTtl), (_req, res) => {
  ok(res, openapi);
});

export default v1;
