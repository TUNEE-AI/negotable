// claude.ai 페이지(Artifact)용 브라우저 데모판을 dist-artifact/ 에 만든다.
// 서버 없이 같은 API 코드(lib/api.js)를 브라우저에서 데모 엔진으로 실행한다.
//   node scripts/build-artifact.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-artifact');
fs.mkdirSync(path.join(out, 'lib'), { recursive: true });
fs.mkdirSync(path.join(out, 'local'), { recursive: true });

for (const f of ['api.js', 'catalog.js', 'engine.js', 'status.js', 'util.js', 'books.js']) fs.copyFileSync(path.join(root, 'lib', f), path.join(out, 'lib', f));
for (const f of fs.readdirSync(path.join(root, 'artifact', 'local'))) fs.copyFileSync(path.join(root, 'artifact', 'local', f), path.join(out, 'local', f));
for (const f of ['app.js', 'wall.js']) fs.copyFileSync(path.join(root, 'public', f), path.join(out, f));
fs.mkdirSync(path.join(out, 'images'), { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'public', 'images'))) if (f.endsWith('.webp')) fs.copyFileSync(path.join(root, 'public', 'images', f), path.join(out, 'images', f));

const indexHtml = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const fonts = indexHtml.match(/<link href="https:\/\/fonts\.googleapis\.com[^>]+>/)[0];
const svgFilter = indexHtml.match(/<svg width="0"[\s\S]*?<\/svg>/)[0];

const page = `<title>DBTB FACTORY</title>
<meta name="description" content="책은 문제의 해결이 아니라 새로운 질문의 시작. 지식가공공장 데모." />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
${fonts}
<style>
:root { color-scheme: light; }
${css}
</style>
${svgFilter}
<a class="skip" href="#main">본문으로 건너뛰기</a>
<div id="app"></div>
<div id="toast" role="status" aria-live="polite"></div>
<div id="modal-root"></div>
<script type="module">
import './local/boot.js';
import './app.js';
</script>
`;
fs.writeFileSync(path.join(out, 'index.html'), page);
console.log('built', out);
