// 더블클릭으로 바로 열리는 HTML 한 장(dist-standalone/DBTB_FACTORY.html)을 만든다.
// - 모든 JS 모듈을 하나로 묶고(아주 단순한 번들러), CSS·이미지(data URI)까지 넣는다.
// - 서버·설치 없이 브라우저에서 데모 엔진으로 동작한다. 데이터는 그 브라우저에만 저장된다.
//   node scripts/build-standalone.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-standalone');
fs.mkdirSync(out, { recursive: true });

// 의존 순서대로
const MODULES = [
  ['util', 'lib/util.js'],
  ['catalog', 'lib/catalog.js'],
  ['status', 'lib/status.js'],
  ['books', 'lib/books.js'],
  ['engine', 'lib/engine.js'],
  ['api', 'lib/api.js'],
  ['miniapp', 'artifact/local/mini-app.js'],
  ['bstore', 'artifact/local/browser-store.js'],
  ['boot', 'artifact/local/boot.js'],
  ['icons', 'public/icons.js'],
  ['wall', 'public/wall.js'],
  ['app', 'public/app.js'],
];
const nameOf = (spec) => ({ './util.js': 'util', './catalog.js': 'catalog', './status.js': 'status', './books.js': 'books', './engine.js': 'engine', '../lib/api.js': 'api', './mini-app.js': 'miniapp', './browser-store.js': 'bstore', './wall.js': 'wall', './icons.js': 'icons' })[spec];

function transform(id, src) {
  const exportsList = [];
  src = src.replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?\s*$/gm, (_, names, spec) => {
    const m = nameOf(spec);
    if (!m) throw new Error(`${id}: 모르는 import ${spec}`);
    return `const {${names.replace(/\s+as\s+/g, ': ')}} = __m.${m};`;
  });
  src = src.replace(/^export\s*\{([^}]*)\}\s*from\s*'([^']+)';?\s*$/gm, (_, names, spec) => {
    names.split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => exportsList.push(`${n}: __m.${nameOf(spec)}.${n}`));
    return '';
  });
  src = src.replace(/^export\s*\{([^}]*)\};?\s*$/gm, (_, names) => {
    names.split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => exportsList.push(n));
    return '';
  });
  src = src.replace(/^export\s+(async\s+function|function|class|const|let)\s+([A-Za-z0-9_$]+)/gm, (_, kind, n) => {
    exportsList.push(n);
    return `${kind} ${n}`;
  });
  if (/^\s*(import|export)\s/m.test(src)) throw new Error(`${id}: 처리 못한 import/export`);
  return `__m.${id} = (() => {\n${src}\nreturn { ${exportsList.join(', ')} };\n})();\n`;
}

let bundle = 'const __m = {};\n';
for (const [id, file] of MODULES) bundle += `// ── ${file} ──\n` + transform(id, fs.readFileSync(path.join(root, file), 'utf8'));

// 이미지를 data URI로
const images = {};
for (const f of fs.readdirSync(path.join(root, 'public', 'images'))) {
  if (!/\.(webp|png|jpg)$/.test(f)) continue;
  const ext = f.split('.').pop();
  images[f.replace(/\.[^.]+$/, '')] = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${fs.readFileSync(path.join(root, 'public', 'images', f)).toString('base64')}`;
}

const indexHtml = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const fonts = indexHtml.match(/<link href="https:\/\/fonts\.googleapis\.com[^>]+>/)[0];
const svgFilter = indexHtml.match(/<svg width="0"[\s\S]*?<\/svg>/)[0];
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>DBTB FACTORY — DON'T BUY THE BOOK</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
${fonts}
<style>
${css}
</style>
</head>
<body>
${svgFilter}
<a class="skip" href="#main">본문으로 건너뛰기</a>
<div id="app"></div>
<div id="toast" role="status" aria-live="polite"></div>
<div id="modal-root"></div>
<script>window.__DBTB_IMAGES = ${JSON.stringify(images)};</script>
<script>
${safe(bundle)}
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(out, 'DBTB_FACTORY.html'), html);
console.log('built', path.join(out, 'DBTB_FACTORY.html'), `${(html.length / 1024 / 1024).toFixed(1)}MB`);
