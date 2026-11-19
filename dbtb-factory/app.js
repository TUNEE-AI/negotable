// ─────────────────────────────────────────────────────────────
// DBTB FACTORY — express 서버 앱 (라우트는 lib/api.js)
// ─────────────────────────────────────────────────────────────
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerApi, errorResponse } from './lib/api.js';

export { detectSensitive, packageMarkdown } from './lib/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ store, ai, config = {} }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  registerApi(app, { store, ai, config });
  app.use(express.static(path.join(here, 'public'), { extensions: ['html'] }));
  app.get('*', (req, res) => res.sendFile(path.join(here, 'public', 'index.html')));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const r = errorResponse(err);
    res.status(r.status).json(r.body);
  });
  return app;
}
