// 브라우저 안에서 lib/api.js 라우트를 그대로 실행하는 아주 작은 express 대용품.
// (claude.ai 미리보기용 데모: 서버 없이 같은 API 코드가 돈다)
import { errorResponse } from '../lib/api.js';

function compile(path) {
  const keys = [];
  const re = path === '*' ? /^.*$/ : new RegExp('^' + path.replace(/\//g, '\\/').replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '\\/?$');
  return { re, keys };
}

export function createMiniApp() {
  const stack = [];
  const add = (method) => (path, ...fns) => { stack.push({ method, ...compile(path), fns }); };
  const app = {
    get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE'),
    use(prefix, fn) { if (typeof prefix === 'function') stack.push({ use: '', fn: prefix }); else stack.push({ use: prefix, fn }); },
    handle(method, url, body, headers = {}) {
      return new Promise((resolve) => {
        const u = new URL(url, 'http://local');
        let done = false;
        const out = { status: 200, headers: {}, body: undefined };
        const res = {
          status(n) { out.status = n; return res; },
          set(k, v) { out.headers[k.toLowerCase()] = v; return res; },
          json(o) { if (done) return; done = true; out.headers['content-type'] = 'application/json'; out.body = JSON.parse(JSON.stringify(o)); resolve(out); },
          send(s) { if (done) return; done = true; out.body = s; resolve(out); },
        };
        const req = { method, path: u.pathname, params: {}, query: Object.fromEntries(u.searchParams), body: body ?? {}, get: (h) => headers[h.toLowerCase()] };
        const fail = (err) => { if (done) return; const r = errorResponse(err); res.status(r.status).json(r.body); };
        let i = 0;
        const next = (err) => {
          if (err) return fail(err);
          while (i < stack.length) {
            const layer = stack[i++];
            if (layer.use !== undefined) {
              if (!u.pathname.startsWith(layer.use)) continue;
              const saved = req.path;
              req.path = u.pathname.slice(layer.use.length) || '/';
              try { layer.fn(req, res, (e) => { req.path = saved; next(e); }); } catch (e) { fail(e); }
              return;
            }
            if (layer.method !== method) continue;
            const m = u.pathname.match(layer.re);
            if (!m) continue;
            req.params = Object.fromEntries(layer.keys.map((k, j) => [k, decodeURIComponent(m[j + 1])]));
            try {
              const r = layer.fns[0](req, res, next);
              if (r && typeof r.then === 'function') r.catch(fail);
            } catch (e) { fail(e); }
            return;
          }
          res.status(404).json({ error: '없는 API입니다.' });
        };
        next();
      });
    },
  };
  return app;
}
