// Netlify Function v2 – obsluhuje /api/* (viz src/api.mjs)
import { createHandler } from '../../src/api.mjs';
import { db } from '../../src/db.mjs';

const handle = createHandler({ db, appKey: (process.env.APP_KEY || '').trim() });
export default async (req) => handle(req);
export const config = { path: ['/api', '/api/*'] };
