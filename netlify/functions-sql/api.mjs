// Netlify Function v2 – obsluhuje /api/* (viz src/api.mjs)
import { createHandler } from '../../src/api.mjs';
import { dbs } from '../../src/db.mjs';

const handle = createHandler({ dbs });
export default async (req) => handle(req);
export const config = { path: ['/api', '/api/*'] };
