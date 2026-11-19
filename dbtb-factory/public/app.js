// ─────────────────────────────────────────────────────────────
// DBTB FACTORY — 프론트엔드 (의존성 없는 바닐라 JS SPA, 해시 라우팅)
// ─────────────────────────────────────────────────────────────

import { paintWall } from './wall.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36));

// ── 로컬 저장(편의 기능 전용; 실패해도 동작) ──
const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
let OWNER = ls.get('dbtb-owner');
if (!OWNER || !/^[a-zA-Z0-9_-]{16,64}$/.test(OWNER)) { OWNER = `u_${rid()}`.slice(0, 40); ls.set('dbtb-owner', OWNER); }

const settings = { sound: ls.get('dbtb-sound', false), reduceMotion: ls.get('dbtb-reduce-motion', false) };
const prefersReduced = () => settings.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
document.documentElement.classList.toggle('reduce-motion', settings.reduceMotion);

// ── API ──
class ApiError extends Error { constructor(msg, status, body) { super(msg); this.status = status; this.body = body; } }
async function api(method, url, body, { retries = 1 } = {}) {
  if (window.__dbtbLocal) {
    const r = await window.__dbtbLocal(method, url, body, OWNER);
    if (r.status >= 400) throw new ApiError(r.body?.error || `오류(${r.status})`, r.status, r.body);
    return r.body;
  }
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { method, headers: { 'content-type': 'application/json', 'x-dbtb-owner': OWNER }, body: body ? JSON.stringify(body) : undefined });
    } catch {
      if (attempt < retries) { await sleep(700); continue; } // 네트워크 오류: 같은 요청(같은 idempotency key)으로 재시도
      throw new ApiError('네트워크에 연결하지 못했습니다. 입력한 내용은 그대로 남아 있습니다.', 0);
    }
    const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text();
    if (!res.ok) throw new ApiError(data?.error || `오류(${res.status})`, res.status, data);
    return data;
  }
}

// ── 토스트·모달 ──
function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = `t${err ? ' err' : ''}`;
  el.textContent = msg;
  $('#toast').append(el);
  setTimeout(() => el.remove(), err ? 5200 : 2800);
}
function modal(html, bind) {
  const root = $('#modal-root');
  const prev = document.activeElement;
  root.innerHTML = `<div class="modal-back" data-close><div class="modal" role="dialog" aria-modal="true" tabindex="-1">${html}</div></div>`;
  const m = $('.modal', root);
  const close = () => { root.innerHTML = ''; prev?.focus?.(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  root.firstChild.addEventListener('click', (e) => { if (e.target.hasAttribute('data-close')) close(); });
  $$('[data-dismiss]', m).forEach((b) => b.addEventListener('click', close));
  (m.querySelector('input,button,textarea,select') || m).focus();
  bind?.(m, close);
  return close;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    ta.remove(); return ok;
  }
}

// ── 사운드 (WebAudio 합성 금속 클릭; 기본 꺼짐) ──
let audioCtx;
function clank(kind = 'click') {
  if (!settings.sound) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(kind === 'done' ? 880 : 180, t);
    o.frequency.exponentialRampToValueAtTime(kind === 'done' ? 1320 : 60, t + 0.12);
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + 0.2);
  } catch {}
}

// ── 공통 데이터 ──
let CATALOG = null;
async function catalog() { return (CATALOG ||= await api('GET', '/api/catalog')); }
const GEAR_SVG = (cls = '') => `<svg class="gear ${cls}" viewBox="0 0 48 48" aria-hidden="true"><path fill="currentColor" d="M27.6 3l1.1 5.3a16 16 0 0 1 4.3 1.8l4.6-2.9 5.1 5.1-2.9 4.6a16 16 0 0 1 1.8 4.3l5.3 1.1v7.2l-5.3 1.1a16 16 0 0 1-1.8 4.3l2.9 4.6-5.1 5.1-4.6-2.9a16 16 0 0 1-4.3 1.8L27.6 45h-7.2l-1.1-5.3a16 16 0 0 1-4.3-1.8l-4.6 2.9-5.1-5.1 2.9-4.6a16 16 0 0 1-1.8-4.3L1 27.6v-7.2l5.3-1.1a16 16 0 0 1 1.8-4.3L5.2 10.4l5.1-5.1 4.6 2.9a16 16 0 0 1 4.3-1.8L20.4 3zM24 16a8 8 0 1 0 0 16 8 8 0 0 0 0-16z"/></svg>`;
const LAYER_BADGE = { confirmed: ['출처 확인', 'layer-confirmed'], author_claim: ['저자 주장', 'layer-author_claim'], user_input: ['사용자 제공', 'layer-user_input'] };

// ═════════ 라우팅 ═════════
const STEPS = [
  { key: 'design', code: 'P1', label: '프로젝트 설계실' },
  { key: 'materials', code: 'P2', label: '원재료 보관함' },
  { key: 'tools', code: 'P3', label: '가공설비실' },
  { key: 'lab', code: 'P4', label: '특별 사고 실험실' },
  { key: 'prototypes', code: 'P5', label: '프로토타입 진열대' },
  { key: 'review', code: 'P6', label: '공장장 검수실' },
  { key: 'assembly', code: 'P7', label: '최종 조립실' },
];
const STATUS_ORDER = ['DRAFT', 'PROJECT_READY', 'MATERIAL_READY', 'PROTOTYPE_SAVED', 'REVIEWED', 'PROCESSING_NEW_VERSION', 'FINALIZING', 'WAREHOUSED', 'EXTERNAL_HANDOFF'];

// 서버판은 주소창 해시(#/p/..)로, 브라우저 데모판(claude.ai 페이지)은 메모리로 화면을 이동한다.
const LOCAL = Boolean(window.__dbtbLocal);
let memPath = '#/';
const currentPath = () => (LOCAL ? memPath : location.hash || '#/');
function go(path) {
  if (LOCAL) { memPath = path; route(); window.scrollTo(0, 0); } else location.hash = path;
}
if (LOCAL) {
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href^="#/"]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    go(a.getAttribute('href'));
  });
}
function confirmBox(title, body, yes = '삭제') {
  return new Promise((resolve) => {
    let answered = false;
    modal(`<h2>${esc(title)}</h2><p>${esc(body)}</p><div class="row"><button class="btn danger" data-yes>${esc(yes)}</button><button class="btn" data-dismiss>취소</button></div>`, (m, close) => {
      $('[data-yes]', m).addEventListener('click', () => { answered = true; close(); resolve(true); });
    });
    const obs = new MutationObserver(() => { if (!$('#modal-root').children.length) { obs.disconnect(); if (!answered) resolve(false); } });
    obs.observe($('#modal-root'), { childList: true });
  });
}

let cleanup = null; // 화면 이탈 시 폴링 중단 등
async function route() {
  cleanup?.(); cleanup = null;
  const hash = currentPath().replace(/^#\/?/, '');
  const parts = hash.split('?')[0].split('/').filter(Boolean);
  const query = new URLSearchParams(hash.split('?')[1] || '');
  const app = $('#app');
  try {
    if (!parts.length) return renderGate(app);
    await catalog();
    if (parts[0] === 'projects') return shell(app, null, 'projects', renderProjects);
    if (parts[0] === 'warehouse') return shell(app, null, 'warehouse', (el) => (parts[1] ? renderPackage(el, parts[1]) : renderWarehouse(el)));
    if (parts[0] === 'skills') return shell(app, null, 'skills', renderSkills);
    if (parts[0] === 'p' && parts[1]) {
      const project = await api('GET', `/api/projects/${parts[1]}`);
      const room = parts[2] || 'design';
      const renderers = { design: renderDesign, materials: renderMaterials, tools: renderTools, lab: renderLab, prototypes: renderPrototypes, review: renderReview, assembly: renderAssembly };
      return shell(app, project, room, (el) => (renderers[room] || renderDesign)(el, project, { id: parts[3], query }));
    }
    go('#/projects');
  } catch (err) {
    app.innerHTML = `<main id="main" class="room"><div class="error-box">${esc(err.message)}</div><p><a class="btn" href="#/projects">프로젝트 목록으로</a></p></main>`;
  }
}
if (!LOCAL) window.addEventListener('hashchange', route);

function shell(app, project, room, render) {
  const engine = CATALOG.engine;
  const navLink = (href, label, key) => `<a href="${href}" ${room === key ? 'aria-current="page"' : ''}>${label}</a>`;
  const rank = project ? STATUS_ORDER.indexOf(project.status) : -1;
  const doneMap = { design: rank >= 1, materials: rank >= 2 || project?.counts.materials > 0, tools: project?.counts.prototypes > 0, lab: false, prototypes: project?.counts.prototypes > 0, review: rank >= 4, assembly: project?.counts.packages > 0 };
  app.innerHTML = `
    <header class="topbar">
      <a class="mini-logo" href="#/" aria-label="DBTB 공장 정문으로">DBTB</a>
      <span class="engine-badge ${engine === 'demo' ? 'demo' : ''}" title="${engine === 'demo' ? 'AI 키가 설정되지 않아 데모 엔진으로 동작합니다' : 'AI 엔진 연결됨'}">${engine === 'demo' ? 'DEMO ENGINE' : 'AI ENGINE'}</span>
      <nav aria-label="공장 메뉴">
        ${navLink('#/projects', '프로젝트', 'projects')}
        <a href="#" data-act="tools" ${room === 'tools' ? 'aria-current="page"' : ''}>P3 가공설비실</a>
        <a href="#" data-act="lab" ${room === 'lab' ? 'aria-current="page"' : ''}>P4 실험실</a>
        ${navLink('#/warehouse', 'P8 완제품 창고', 'warehouse')}
        ${navLink('#/skills', 'P9 나의 공구실', 'skills')}
        <button type="button" data-act="settings" aria-label="소리·모션 설정">⚙︎</button>
      </nav>
    </header>
    <div class="${project ? 'shell' : ''}">
      ${project ? `<aside class="line" aria-label="공정 라인">
        <div class="proj-name">${esc(project.name)}</div>
        <div class="status"><span class="badge brass">${esc(project.status_label)}</span></div>
        <ol>${STEPS.map((s) => `<li><a href="#/p/${project.id}/${s.key}" class="${doneMap[s.key] ? 'done' : ''}" ${room === s.key ? 'aria-current="page"' : ''}><span class="dot"></span>${s.label}<span class="code">${s.code}</span></a></li>`).join('')}</ol>
      </aside>` : ''}
      <main id="main" class="room" tabindex="-1"></main>
    </div>`;
  $('[data-act=settings]', app).addEventListener('click', openSettings);
  if (project) ls.set('dbtb-last-project', project.id);
  // 상단 메뉴의 가공설비실·실험실: 지금 프로젝트 → 최근 프로젝트 → 없으면 새 프로젝트 안내
  $$('[data-act=tools],[data-act=lab]', app).forEach((a) => a.addEventListener('click', async (e) => {
    e.preventDefault();
    const roomKey = a.dataset.act;
    if (project) return go(`#/p/${project.id}/${roomKey}`);
    const list = await api('GET', '/api/projects').catch(() => []);
    const last = list.find((p) => p.id === ls.get('dbtb-last-project')) || list[0];
    if (last) return go(`#/p/${last.id}/${roomKey}`);
    toast('먼저 프로젝트를 하나 만드세요. 이름과 목표만 있으면 됩니다.');
    go('#/projects');
  }));
  const main = $('#main', app);
  if (!project) main.style.margin = '0 auto';
  return render(main);
}

function openSettings() {
  modal(`<h2>공장 설정</h2>
    <label class="check"><input type="checkbox" id="s-sound" ${settings.sound ? 'checked' : ''}/> <span>레버 사운드 켜기</span></label>
    <label class="check"><input type="checkbox" id="s-motion" ${settings.reduceMotion ? 'checked' : ''}/> <span>애니메이션 줄이기 (기기 설정의 '동작 줄이기'도 자동 반영)</span></label>
    <p class="small muted">이 브라우저의 익명 작업자 ID로 프로젝트가 보관됩니다. 다른 기기에서는 보이지 않습니다.</p>
    <div class="row"><button class="btn primary" data-dismiss>닫기</button></div>`, (m) => {
    $('#s-sound', m).addEventListener('change', (e) => { settings.sound = e.target.checked; ls.set('dbtb-sound', settings.sound); clank(); });
    $('#s-motion', m).addEventListener('change', (e) => { settings.reduceMotion = e.target.checked; ls.set('dbtb-reduce-motion', settings.reduceMotion); document.documentElement.classList.toggle('reduce-motion', settings.reduceMotion); });
  });
}

// 작업실별 배경 장면 (이미지, 보여줄 위치)
const ROOM_ART = {
  P1: ['design-office', '50% 38%'],
  P2: ['material-warehouse', '50% 30%'],
  P3: ['processing-hall', '50% 30%'],
  P4: ['production-line', '58% 40%'],
  P5: ['production-line', '68% 50%'],
  P6: ['design-office', '78% 45%'],
  P7: ['production-line', '96% 55%'],
  P8: ['material-warehouse', '92% 55%'],
  P9: ['design-office', '6% 60%'],
};
const img = (name) => `images/${name}.webp`;
function head(code, title, desc, { scene = '' } = {}) {
  const art = ROOM_ART[code];
  if (!art) return `<div class="room-head"><div class="code">${code}</div><h1>${title}</h1>${desc ? `<p>${desc}</p>` : ''}</div>`;
  return `<header class="room-head has-art ${scene ? 'scene' : ''}">
    <img class="art" src="${img(art[0])}" alt="" style="object-position:${art[1]}" decoding="async" />
    ${scene}
    <div class="cap"><div class="code">${code}</div><h1>${title}</h1>${desc ? `<p>${desc}</p>` : ''}</div>
  </header>`;
}
/** 이미지 위 클릭 영역(좌표는 원본 이미지 기준 %) */
function hotspots(spots, attr, { selected, rec = [] } = {}) {
  return spots.map(([id, label, l, t, w, h]) => `<button type="button" class="hot" ${attr}="${id}" aria-pressed="${id === selected}" aria-label="${esc(label)} 선택" style="left:${l}%;top:${t}%;width:${w}%;height:${h}%">${rec.includes(id) ? '<span class="tag">추천</span>' : ''}<span class="hot-label">${esc(label)}</span></button>`).join('');
}
const HALL_SPOTS = [
  ['swot', 'SWOT', 17.9, 27.1, 12.3, 20.2], ['funnel', '퍼널', 42.9, 27.1, 14.5, 20.2], ['stp', 'STP', 64.0, 27.1, 21.5, 20.2],
  ['lean', '린 스타트업', 9.0, 52.6, 17.6, 23.4], ['4p', '4P', 30.2, 52.6, 17.9, 23.4], ['pest', 'PEST', 51.7, 52.6, 17.9, 23.4], ['porter5', '포터 5 Forces', 70.9, 52.6, 19.7, 23.4],
];
const SHELF_SPOTS = [
  ['book', '책', 17.9, 30.8, 15.3, 51.0], ['paper', '논문', 33.5, 38.3, 12.3, 35.1], ['video', '영상', 51.4, 42.5, 10.5, 30.8],
  ['news', '뉴스', 64.9, 41.4, 10.8, 31.9], ['ebook', '전자책·문서', 83.4, 31.9, 16.2, 40.4],
];

// ═════════ L0 공장 정문 ═════════
function renderGate(app) {
  app.innerHTML = `
  <main id="main">
    <section class="brand-wall" aria-labelledby="brand-title">
      <canvas id="wall" aria-hidden="true"></canvas>
      <h1 id="brand-title" class="sr-only">DON'T BUY THE BOOK — BRAIN FACTORY</h1>
      <p class="sr-only">책 한 권을 정답으로 믿지 마세요. 책은 새로운 질문의 시작입니다.</p>
    </section>
    <section class="gate" aria-label="공장 정문">
      <div class="backdrop" style="background-image:url(${img('gate')})"></div>
      <div class="stage">
        <img src="${img('gate')}" alt="비 내린 마당 앞의 대형 벽돌 공장. 외벽에 흰 페인트로 DBTB라고 쓰여 있고, 가운데 철문 위에 등이 켜져 있다." fetchpriority="high" />
        <button class="door-hot" type="button" data-enter aria-label="철문을 열고 공장 입장"></button>
        <button class="enter-tag" type="button" data-enter>공장 입장 →</button>
      </div>
    </section>
    <section class="how" aria-labelledby="how-title">
      <h2 id="how-title">이렇게 씁니다</h2>
      <ol>
        <li><b>설계</b><span>만들고 싶은 것을 정합니다.</span></li>
        <li><b>가공</b><span>책·논문·영상·뉴스를 분석 설비에 넣습니다.</span></li>
        <li><b>출고</b><span>외부 AI가 바로 만들 수 있는 설계서로 받습니다.</span></li>
      </ol>
      <button class="btn brass big" data-enter>공장 입장 →</button>
    </section>
  </main>`;
  $$('[data-enter]', app).forEach((b) => b.addEventListener('click', () => { clank(); go('#/projects'); }));
  const canvas = $('#wall', app);
  const notes = [
    { text: '책 한 권을' },
    { text: '정답으로 믿지 마세요.' },
    { text: '책은 새로운 질문의', color: 'rgba(122,59,63,.9)' },
    { text: '시작입니다.', color: 'rgba(122,59,63,.9)' },
  ];
  const draw = () => paintWall(canvas, { notes }).catch(() => {});
  draw();
  let t, lastW = canvas.clientWidth;
  const onResize = () => { clearTimeout(t); t = setTimeout(() => { if (Math.abs(canvas.clientWidth - lastW) > 30) { lastW = canvas.clientWidth; draw(); } }, 200); };
  window.addEventListener('resize', onResize);
  cleanup = () => window.removeEventListener('resize', onResize);
}

// ═════════ 프로젝트 목록 + P1 신규 ═════════
async function renderProjects(el) {
  const list = await api('GET', '/api/projects');
  const draft = ls.get('dbtb-draft-new', {});
  el.innerHTML = `${head('P1', '프로젝트 설계실', '무엇을 만들고 싶은가? 프로젝트명과 목표만 있으면 공장이 가동됩니다.')}
  <div class="grid c2" style="align-items:start">
    <form class="panel plate" id="new-project" novalidate>
      <h2>새 프로젝트 설계</h2>
      ${projectFields(draft)}
      <div class="row"><button class="btn primary" type="submit">프로젝트 설계 →</button><span class="small muted">입력 중인 내용은 자동 보관됩니다.</span></div>
    </form>
    <section class="panel">
      <h2>진행 중인 프로젝트</h2>
      ${list.length ? `<div class="grid">${list.map((p) => `<a class="mat-item" style="text-decoration:none;color:inherit" href="#/p/${p.id}/${p.counts.prototypes ? 'prototypes' : p.counts.materials ? 'tools' : 'materials'}">
          <div class="body"><div class="title">${esc(p.name)}</div><div class="small muted">${esc(p.goal).slice(0, 80)}</div>
          <div class="row small" style="margin-top:4px"><span class="badge brass">${esc(p.status_label)}</span><span class="badge">재료 ${p.counts.materials}</span><span class="badge">버전 ${p.counts.prototypes}</span><span class="badge">완제품 ${p.counts.packages}</span></div></div></a>`).join('')}</div>`
        : '<div class="empty">아직 프로젝트가 없습니다. 왼쪽에서 첫 프로젝트를 설계하세요.</div>'}
    </section>
  </div>`;
  const form = $('#new-project', el);
  form.addEventListener('input', () => ls.set('dbtb-draft-new', formData(form)));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(form);
    if (!d.name || !d.goal) return toast('프로젝트명과 목표를 입력하세요.', true);
    try {
      const p = await api('POST', '/api/projects', d);
      ls.del('dbtb-draft-new'); clank();
      go(`#/p/${p.id}/materials`);
    } catch (err) { toast(err.message, true); }
  });
}
function projectFields(v = {}) {
  return `
    <label class="field"><span>프로젝트명<em>필수</em></span><input type="text" name="name" maxlength="120" required value="${esc(v.name)}" placeholder="예: 우리 매장 재방문 전략" /></label>
    <label class="field"><span>목표 / 해결할 문제<em>필수</em></span><textarea name="goal" maxlength="2000" required placeholder="예: 첫 방문 고객의 한 달 내 재방문율을 높이고 싶다">${esc(v.goal)}</textarea></label>
    <label class="field"><span>주 대상</span><input type="text" name="audience" maxlength="300" value="${esc(v.audience)}" placeholder="예: 동네 30~40대 직장인" /></label>
    <label class="field"><span>최종적으로 얻고 싶은 것</span><input type="text" name="expected" maxlength="300" value="${esc(v.expected)}" placeholder="예: 직원 회의에서 발표할 실행 PPT" /></label>`;
}
function formData(form) { return Object.fromEntries(new FormData(form).entries()); }

// ═════════ P1 프로젝트 설계실(편집) ═════════
async function renderDesign(el, project) {
  const key = `dbtb-draft-${project.id}`;
  const v = { ...project, ...ls.get(key, {}) };
  el.innerHTML = `${head('P1', '프로젝트 설계실', '프로젝트의 기본값을 다듬습니다. 원재료는 언제든 계속 추가할 수 있습니다.')}
  <form class="panel plate" id="edit-project">${projectFields(v)}
    <div class="spread"><div class="row"><button class="btn primary">저장</button><a class="btn" href="#/p/${project.id}/materials">원재료 보관함으로 →</a></div>
    <button type="button" class="btn danger sm" data-del>프로젝트 삭제</button></div></form>`;
  const form = $('#edit-project', el);
  form.addEventListener('input', () => ls.set(key, formData(form)));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('PATCH', `/api/projects/${project.id}`, formData(form)); ls.del(key); toast('저장했습니다.'); route(); } catch (err) { toast(err.message, true); }
  });
  $('[data-del]', el).addEventListener('click', () => modal(`<h2>프로젝트를 삭제할까요?</h2><p>원재료·프로토타입·창고의 완제품까지 모두 삭제되며 되돌릴 수 없습니다.</p><div class="row"><button class="btn danger" data-yes>삭제</button><button class="btn" data-dismiss>취소</button></div>`, (m, close) => {
    $('[data-yes]', m).addEventListener('click', async () => { await api('DELETE', `/api/projects/${project.id}`); close(); go('#/projects'); });
  }));
}

// ═════════ P2 원재료 보관함 ═════════
async function renderMaterials(el, project) {
  const { materialTypes, rights } = CATALOG;
  const mats = await api('GET', `/api/projects/${project.id}/materials`);
  const draftKey = `dbtb-mat-${project.id}`;
  let type = ls.get(`${draftKey}-type`, 'book');
  el.innerHTML = `${head('P2', '원재료 보관함', '선반을 눌러 원재료 종류를 고르세요. 책만이 아니라 모든 지식이 가공됩니다.', { scene: `<div class="hots">${hotspots(SHELF_SPOTS, 'data-shelf', { selected: type })}</div>` })}
    <div class="mat-tabs" role="tablist" aria-label="원재료 종류">${Object.entries(materialTypes).map(([k, t]) => `<button class="mat-tab" role="tab" data-type="${k}" aria-selected="${k === type}"><span class="ic" aria-hidden="true">${t.icon}</span>${t.label}</button>`).join('')}</div>
    <div class="grid c2" style="align-items:start">
      <form class="panel plate" id="mat-form" novalidate></form>
      <section class="panel"><div class="spread"><h2>투입된 원재료 <span class="badge">${mats.length}</span></h2><a class="btn primary sm" href="#/p/${project.id}/tools">가공설비실로 →</a></div>
        ${mats.length ? `<div class="grid">${mats.map((m) => `<div class="mat-item"><span class="ic" aria-hidden="true">${materialTypes[m.type].icon}</span><div class="body">
          <div class="title">${esc(m.title)}</div><div class="small muted">${esc(materialTypes[m.type].label)}${m.author ? ` · ${esc(m.author)}` : ''}${m.uri ? ` · <a href="${esc(m.uri)}" target="_blank" rel="noopener noreferrer">링크</a>` : ''}</div>
          <div class="row small" style="margin-top:4px"><span class="badge">${esc(rights[m.rights_status])}</span><span class="badge ${m.analysis_mode === 'text_provided' ? 'ok' : 'brass'}">${m.analysis_mode === 'text_provided' ? '제공 텍스트 분석' : '공개자료 기반 관점 분석'}</span>${m.file_ref ? `<span class="badge">📎 ${esc(m.file_ref.name)}</span>` : ''}</div></div>
          <button class="btn ghost sm" data-del="${m.id}" aria-label="${esc(m.title)} 삭제">삭제</button></div>`).join('')}</div>`
        : '<div class="empty">첫 원재료를 추가하세요.<br/>재료 없이도 가공할 수 있지만, 근거가 없는 결과는 모두 “가정”으로 표시됩니다.</div>'}
      </section>
    </div>`;
  const form = $('#mat-form', el);
  const draw = () => {
    const t = materialTypes[type];
    const d = ls.get(`${draftKey}-${type}`, {});
    const f = (name, label, ph = '', extra = '') => `<label class="field"><span>${label}</span><input type="text" name="${name}" value="${esc(d[name])}" placeholder="${ph}" ${extra}/></label>`;
    const ta = (name, label, ph = '') => `<label class="field"><span>${label}</span><textarea name="${name}" placeholder="${ph}">${esc(d[name])}</textarea></label>`;
    form.innerHTML = `<h2>${t.icon} ${t.label} 추가</h2><p class="hint" style="margin-top:-6px">${esc(t.hint)}</p>
      <label class="field"><span>${type === 'culture' ? '작품명' : '제목'}<em>필수</em></span><input type="text" name="title" value="${esc(d.title)}" required /></label>
      ${f('author', type === 'news' ? '매체/기자' : type === 'culture' ? '감독/작가' : '저자', '')}
      ${type === 'book' ? `${f('isbn', 'ISBN (선택)', '978...')}<div class="row"><button type="button" class="btn sm" data-resolve>📚 도서 식별 (Open Library)</button><span class="small muted">서지 정보만 조회하며 본문은 가져오지 않습니다.</span></div><div class="candidates" id="cands"></div>` : ''}
      ${type === 'paper' ? f('doi', 'DOI', '10.xxxx/...') : ''}
      ${type === 'culture' ? f('genre', '장르', '영화 / 연극 / 드라마…') : ''}
      ${['paper', 'video', 'news'].includes(type) ? f('uri', '링크 (허용된 자료만)', 'https://…', 'inputmode="url"') : ''}
      ${type === 'ebook' || type === 'paper' || type === 'video' ? `<label class="field"><span>${type === 'video' ? '자막/스크립트 파일 (.srt .vtt .txt)' : '파일 (PDF/EPUB/TXT)'}</span><input type="file" name="file" accept="${type === 'video' ? '.srt,.vtt,.txt' : '.pdf,.epub,.txt,.md'}" /><div class="hint" id="file-hint">텍스트 파일(.txt .md .srt .vtt)은 내용을 읽어 넣습니다. PDF/EPUB은 파일명만 기록되니, 분석할 부분을 아래에 붙여넣어 주세요.</div></label>` : ''}
      ${type !== 'book' ? ta('excerpt', type === 'culture' ? '감상 / 자료 내용' : '발췌 / 본문 / 스크립트', '분석할 텍스트를 붙여넣으세요 (최대 50,000자)') : ta('excerpt', '직접 확보한 발췌 (선택)', '본인이 확보한 요약·발췌. 없으면 공개자료 기반 관점 분석으로 처리됩니다.')}
      ${ta('note', '나의 메모 (선택)', '왜 이 자료를 넣었나요?')}
      <label class="field"><span>권리 상태</span><select name="rights_status">${Object.entries(rights).map(([k, l]) => `<option value="${k}" ${(d.rights_status || (type === 'ebook' ? 'rights_confirmed' : 'user_provided')) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${type === 'ebook' ? `<label class="check"><input type="checkbox" name="rights_ack" value="1" ${d.rights_ack ? 'checked' : ''}/> <span>이 파일에 대한 권리를 보유했거나 개인 사용 권한이 있으며, 원문을 재배포하지 않겠습니다.</span></label>` : ''}
      <div class="row"><button class="btn primary">원재료 추가</button></div>`;
    form.dataset.meta = '';
    $('[data-resolve]', form)?.addEventListener('click', resolveBook);
    $('input[type=file]', form)?.addEventListener('change', readFile);
  };
  async function resolveBook() {
    const d = formData(form);
    const box = $('#cands', form);
    box.innerHTML = '<span class="small muted">찾는 중…</span>';
    try {
      const r = await api('POST', '/api/materials/books/resolve', { title: d.title, author: d.author, isbn: d.isbn });
      if (!r.candidates.length) { box.innerHTML = `<span class="small muted">${esc(r.error || '후보를 찾지 못했습니다. 입력한 서지로 그대로 등록할 수 있습니다.')}</span>`; return; }
      box.innerHTML = r.candidates.map((c, i) => `<button type="button" data-i="${i}"><b>${esc(c.title)}</b> <span class="small muted">${esc(c.author)}${c.year ? ` · ${c.year}` : ''}${c.isbn ? ` · ISBN ${esc(c.isbn)}` : ''}</span></button>`).join('');
      $$('button', box).forEach((b) => b.addEventListener('click', () => {
        const c = r.candidates[b.dataset.i];
        form.title.value = c.title; form.author.value = c.author; form.isbn.value = c.isbn;
        form.dataset.meta = JSON.stringify({ source: 'openlibrary', source_url: c.source_url, year: c.year, publisher: c.publisher });
        form.rights_status.value = 'public';
        box.innerHTML = `<span class="small"><span class="badge ok">식별됨</span> ${esc(c.title)} — ${esc(c.author)}</span>`;
        saveDraft();
      }));
    } catch (err) { box.innerHTML = `<span class="small muted">${esc(err.message)}</span>`; }
  }
  async function readFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const hint = $('#file-hint', form);
    if (file.size > 20 * 1024 * 1024) { e.target.value = ''; return toast('파일은 20MB 이하만 가능합니다.', true); }
    form.dataset.file = JSON.stringify({ name: file.name, size: file.size });
    if (/\.(txt|md|srt|vtt)$/i.test(file.name)) {
      let txt = await file.text();
      if (/\.(srt|vtt)$/i.test(file.name)) txt = txt.replace(/^WEBVTT.*$/m, '').replace(/^\d+\s*$/gm, '').replace(/^[\d:.,]+ --> [\d:.,]+.*$/gm, '').replace(/\n{2,}/g, '\n').trim();
      form.excerpt.value = txt.slice(0, 50000);
      hint.textContent = `“${file.name}”의 텍스트를 읽어 넣었습니다${txt.length > 50000 ? ' (50,000자까지)' : ''}.`;
      if (!form.title.value) form.title.value = file.name.replace(/\.[^.]+$/, '');
      saveDraft();
    } else {
      hint.textContent = `“${file.name}” — PDF/EPUB 본문은 자동 추출하지 않습니다. 분석할 부분을 아래 칸에 붙여넣어 주세요.`;
      if (!form.title.value) form.title.value = file.name.replace(/\.[^.]+$/, '');
    }
  }
  const saveDraft = () => { const d = formData(form); delete d.file; ls.set(`${draftKey}-${type}`, d); };
  form.addEventListener('input', saveDraft);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(form); delete d.file;
    if (!d.title?.trim()) return toast('제목을 입력하세요.', true);
    const file = form.dataset.file ? JSON.parse(form.dataset.file) : null;
    try {
      await api('POST', `/api/projects/${project.id}/materials`, { ...d, type, rights_ack: Boolean(d.rights_ack), file_name: file?.name, file_size: file?.size, source_metadata: form.dataset.meta ? JSON.parse(form.dataset.meta) : null });
      ls.del(`${draftKey}-${type}`); clank(); toast('원재료를 보관함에 넣었습니다.');
      route();
    } catch (err) { toast(err.message, true); }
  });
  const pickType = (t) => {
    type = t; ls.set(`${draftKey}-type`, type);
    $$('.mat-tab', el).forEach((x) => x.setAttribute('aria-selected', String(x.dataset.type === t)));
    $$('[data-shelf]', el).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.shelf === t)));
    draw();
  };
  $$('.mat-tab', el).forEach((b) => b.addEventListener('click', () => pickType(b.dataset.type)));
  $$('[data-shelf]', el).forEach((b) => b.addEventListener('click', () => { clank(); pickType(b.dataset.shelf); $('#mat-form', el).scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth', block: 'start' }); }));
  $$('[data-del]', el).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('이 원재료를 삭제할까요?', '기존 프로토타입은 보존되며 “근거 자료 삭제됨”으로 표시됩니다.'))) return;
    try { await api('DELETE', `/api/materials/${b.dataset.del}`); route(); } catch (err) { toast(err.message, true); }
  }));
  draw();
}

// ═════════ P3 가공설비실 + 레버 ═════════
async function renderTools(el, project, { query }) {
  const [mats, rec, protos] = await Promise.all([
    api('GET', `/api/projects/${project.id}/materials`),
    api('GET', `/api/projects/${project.id}/recommendations`),
    api('GET', `/api/projects/${project.id}/prototypes`),
  ]);
  const selKey = `dbtb-tool-${project.id}`;
  let selected = ls.get(selKey, rec.tool_ids[0]);
  let source = query.get('source') || '';
  if (source && !protos.some((p) => p.id === source)) source = '';
  const tools = CATALOG.tools;
  const ordered = [...rec.tool_ids.map((id) => tools.find((t) => t.id === id)), ...tools.filter((t) => !rec.tool_ids.includes(t.id))];
  el.innerHTML = `${head('P3', '가공설비실', '기계를 눌러 설비를 고르고, 아래 레버를 끝까지 당기면 가동됩니다. 재가공은 새 버전으로 저장됩니다.', { scene: `<div class="hots">${hotspots(HALL_SPOTS, 'data-machine', { selected, rec: rec.tool_ids })}</div>` })}
    ${!mats.length ? `<div class="notice" style="margin-bottom:12px">원재료가 없습니다. 지금 가동하면 결과는 모두 “가정 기반 시뮬레이션”으로 표시됩니다. <a href="#/p/${project.id}/materials">원재료 추가하기</a></div>` : ''}
    <section class="panel"><div class="spread"><h2>AI 공장장 추천</h2><span class="small muted">프로젝트 목표·재료를 보고 고른 3종</span></div>
      <div class="grid c3">${ordered.map((t) => `<button class="tool-card" type="button" data-tool="${t.id}" aria-pressed="${t.id === selected}">${rec.tool_ids.includes(t.id) ? '<span class="badge brass rec">추천</span>' : ''}<div class="name">${esc(t.name)}</div><div class="out">${esc(t.output)}</div><div class="small muted">입력: ${esc(t.input)}</div></button>`).join('')}</div>
    </section>
    <section class="panel">
      <div class="grid c2">
        <label class="field"><span>투입할 원재료</span>
          <div id="mat-pick">${mats.length ? mats.map((m) => `<label class="check"><input type="checkbox" value="${m.id}" checked/> <span>${CATALOG.materialTypes[m.type].icon} ${esc(m.title)}</span></label>`).join('') : '<span class="small muted">(없음)</span>'}</div></label>
        <div>
          <label class="field"><span>기준 프로토타입 (재가공)</span><select id="src"><option value="">없음 — 새로 가공</option>${protos.map((p) => `<option value="${p.id}" ${p.id === source ? 'selected' : ''}>${esc(p.version_label)} · ${esc(p.tool_name)}</option>`).join('')}</select><div class="hint">기준 버전은 그대로 보존되고, 이것을 부모로 한 새 버전이 생깁니다.</div></label>
          <label class="field"><span>집중 관점 (선택)</span><input type="text" id="focus" maxlength="500" placeholder="예: 비용을 거의 쓰지 않는 방법 위주로" /></label>
        </div>
      </div>
    </section>
    <section class="machine" id="machine" aria-label="가공 기계">
      <div>
        <div class="lever" id="lever">
          <div class="slot"></div><div class="scale"></div><div class="threshold" style="top:66%" aria-hidden="true"></div>
          <button class="handle" type="button" id="handle" aria-describedby="lever-help">당기기</button>
        </div>
      </div>
      <div class="panel-r">
        <div class="spread"><div class="gears">${GEAR_SVG()}${GEAR_SVG('g2')}</div><div class="mono small" id="sel-name"></div></div>
        <div class="conveyor"></div>
        <div class="gauge" id="gauge"><div class="fill"></div></div>
        <div class="readout" id="readout" role="status" aria-live="polite">대기 중 — 레버를 아래로 70% 이상 당기세요.</div>
        <p id="lever-help" class="small" style="color:var(--stone-2);margin:0">마우스·터치로 드래그, 또는 레버에 초점을 두고 Enter/Space. 아래 버튼으로도 같은 작업을 실행합니다.</p>
        <div class="row"><button class="btn brass" id="quick-run" type="button">⚙ 빠른 실행</button><span id="after"></span></div>
      </div>
    </section>`;

  const setSel = (id) => {
    selected = id; ls.set(selKey, id);
    $$('.tool-card', el).forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.tool === id)));
    $$('[data-machine]', el).forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.machine === id)));
    $('#sel-name', el).textContent = `설비: ${tools.find((t) => t.id === id)?.name || '-'}`;
  };
  $$('.tool-card', el).forEach((c) => c.addEventListener('click', () => setSel(c.dataset.tool)));
  $$('[data-machine]', el).forEach((c) => c.addEventListener('click', () => { clank(); setSel(c.dataset.machine); $('#machine', el).scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth', block: 'center' }); }));
  setSel(selected);

  const machine = $('#machine', el), readout = $('#readout', el), gauge = $('#gauge', el), after = $('#after', el);
  let busy = false, stop = false;
  cleanup = () => { stop = true; };

  async function fire() {
    if (busy) return;
    if (!selected) return toast('설비를 먼저 고르세요.', true);
    busy = true; lever.lock(); $('#quick-run', el).disabled = true; after.innerHTML = '';
    clank();
    machine.classList.add('running');
    readout.innerHTML = '<b>기어 회전</b> — 설비 예열 중';
    gauge.classList.remove('indeterminate'); $('.fill', gauge).style.width = '8%';
    const key = rid();
    const body = { tool_id: selected, material_ids: $$('#mat-pick input:checked', el).map((i) => i.value), source_prototype_id: $('#src', el).value || null, config: { focus: $('#focus', el).value }, idempotency_key: key };
    await sleep(prefersReduced() ? 0 : 700); // 0.4~1.2초 기어 연출 후 실제 작업 상태로 전환
    let run;
    try {
      run = await api('POST', `/api/projects/${project.id}/runs`, body, { retries: 2 });
    } catch (err) {
      if (err.status === 409 && err.body?.run) run = err.body.run;
      else return fail(err.message, true);
    }
    // 실제 백엔드 작업 상태를 폴링
    while (!stop) {
      if (run.state === 'queued') { readout.innerHTML = '<b>접수</b> — 작업 대기열'; $('.fill', gauge).style.width = '15%'; }
      if (run.state === 'running') { readout.innerHTML = `<b>가공 중</b> — ${esc(run.stage)} (실제 작업 진행 중)`; gauge.classList.add('indeterminate'); }
      if (run.state === 'succeeded') return success(run);
      if (run.state === 'failed') return fail(run.error, run.retryable !== false);
      await sleep(900);
      try { run = await api('GET', `/api/runs/${run.id}`, null, { retries: 3 }); } catch (err) { readout.textContent = `상태 확인 재시도 중… (${err.message})`; }
    }
  }
  function success(run) {
    machine.classList.remove('running'); gauge.classList.remove('indeterminate'); $('.fill', gauge).style.width = '100%';
    readout.innerHTML = '<b>완료</b> — 프로토타입이 자동 저장되었습니다.';
    clank('done'); busy = false; lever.release(); $('#quick-run', el).disabled = false;
    after.innerHTML = `<a class="btn primary" href="#/p/${project.id}/review/${run.prototype_id}">공장장 검수실로 →</a> <a class="btn" href="#/p/${project.id}/prototypes">진열대 보기</a>`;
    toast('새 프로토타입이 진열대에 올라갔습니다.');
  }
  function fail(msg, retryable) {
    machine.classList.remove('running'); gauge.classList.remove('indeterminate'); $('.fill', gauge).style.width = '0';
    readout.innerHTML = `<b style="color:#f0b4b4">실패</b> — ${esc(msg || '오류')}. 원재료와 선택은 그대로 남아 있습니다.`;
    busy = false; lever.release(); $('#quick-run', el).disabled = false;
    if (retryable) { after.innerHTML = '<button class="btn brass" type="button" id="retry">다시 시도</button>'; $('#retry', el).addEventListener('click', fire); }
  }
  const lever = makeLever($('#lever', el), $('#handle', el), fire);
  $('#quick-run', el).addEventListener('click', fire);
}

/** UX-04 드래그 레버: 70% 이상 당기면 가동, 아니면 스냅백. 키보드 Enter/Space 지원. */
function makeLever(root, handle, onFire) {
  let dragging = false, startY = 0, y = 0, locked = false;
  const max = () => root.clientHeight - handle.offsetHeight;
  const setY = (v, snap = false) => { y = Math.max(0, Math.min(max(), v)); handle.classList.toggle('snap', snap); handle.style.transform = `translateY(${y}px)`; };
  handle.addEventListener('pointerdown', (e) => {
    if (locked) return;
    dragging = true; startY = e.clientY - y; handle.setPointerCapture(e.pointerId); handle.classList.remove('snap');
  });
  handle.addEventListener('pointermove', (e) => { if (dragging) setY(e.clientY - startY); });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    if (y >= max() * 0.7) { setY(max(), true); onFire(); } else setY(0, true);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('keydown', (e) => {
    if (locked || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault(); setY(max(), true); onFire();
  });
  handle.addEventListener('click', (e) => { if (e.detail === 0) e.preventDefault(); }); // 키보드 클릭 중복 방지
  return {
    lock() { locked = true; root.classList.add('locked'); setY(max(), true); handle.setAttribute('aria-disabled', 'true'); handle.textContent = '가동 중'; },
    release() { locked = false; root.classList.remove('locked'); setY(0, true); handle.removeAttribute('aria-disabled'); handle.textContent = '당기기'; },
  };
}

// ═════════ P5 프로토타입 진열대 ═════════
function protoDoc(p, { compact = false } = {}) {
  const c = p.content;
  const missing = new Set(p.missing_material_ids || []);
  return `<div class="doc">
    <p>${esc(c.summary)}</p>
    ${c.simulated ? '<div class="notice warn">가상 시뮬레이션: 실제 인물의 발언이 아닙니다.</div>' : ''}
    ${(c.sections || []).map((s) => `<h4>${esc(s.heading)}</h4><ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`).join('')}
    ${compact ? '' : `
    <h4>근거 <span class="small muted">(자료·사용자 입력에 실제로 있는 것)</span></h4>
    ${(c.evidence || []).length ? c.evidence.map((e) => { const [l, cls] = LAYER_BADGE[e.layer] || [e.layer, '']; return `<div class="ev"><span class="badge ${cls}">${l}</span><span>${esc(e.statement)}${missing.has(e.material_id) ? ' <span class="badge burgundy">근거 자료 삭제됨</span>' : ''}</span></div>`; }).join('') : '<p class="small muted">근거 없음</p>'}
    <h4>AI 해석</h4>${(c.interpretations || []).map((x) => `<div class="ev"><span class="badge layer-ai">AI 해석</span><span>${esc(x)}</span></div>`).join('') || '<p class="small muted">-</p>'}
    <h4>가설 / 검증 필요</h4>${(c.assumptions || []).map((x) => `<div class="ev"><span class="badge layer-hypothesis">가설</span><span>${esc(x)}</span></div>`).join('') || '<p class="small muted">-</p>'}
    <h4>권고</h4><ul>${(c.recommendations || []).map((r) => `<li><span class="badge ${r.priority === 'high' ? 'burgundy' : ''}">${r.priority === 'high' ? '우선' : r.priority === 'medium' ? '보통' : '낮음'}</span> <b>${esc(r.action)}</b> <span class="small muted">— ${esc(r.rationale)}</span></li>`).join('')}</ul>`}
  </div>`;
}
async function renderPrototypes(el, project) {
  const protos = await api('GET', `/api/projects/${project.id}/prototypes`);
  const byParent = {};
  for (const p of protos) (byParent[p.parent_id || 'root'] ||= []).push(p);
  const node = (p) => `<li><article class="proto ${p.source}" id="${p.id}">
      <div class="spread"><div><span class="label">${esc(p.version_label)}</span> <span class="badge">${esc(p.tool_name)}</span> ${p.content.engine === 'demo' ? '<span class="badge burgundy">데모</span>' : ''} ${p.missing_material_ids.length ? '<span class="badge burgundy">근거 자료 일부 삭제됨</span>' : ''}</div><span class="small muted">${fmtTime(p.created_at)}</span></div>
      <h3>${esc(p.content.title)}</h3>
      <p class="small muted" style="margin:0">변경점: ${esc(p.content.changes_from_parent || '-')}${p.parent_id ? ` · 부모: ${esc(protos.find((x) => x.id === p.parent_id)?.version_label || '')}` : ''}</p>
      <details style="margin-top:6px"><summary>내용 펼치기</summary>${protoDoc(p)}</details>
      <div class="row" style="margin-top:8px">
        <label class="check" style="margin:0"><input type="checkbox" data-cmp="${p.id}"/> <span class="small">비교</span></label>
        <a class="btn sm" href="#/p/${project.id}/review/${p.id}">검수</a>
        <a class="btn sm" href="#/p/${project.id}/tools?source=${p.id}">이 버전으로 재가공</a>
        <a class="btn sm" href="#/p/${project.id}/lab?source=${p.id}">실험실에 올리기</a>
        <a class="btn sm primary" href="#/p/${project.id}/assembly?proto=${p.id}">최종 조립</a>
      </div></article>
      ${byParent[p.id] ? `<ul class="tree">${byParent[p.id].map(node).join('')}</ul>` : ''}</li>`;
  el.innerHTML = `${head('P5', '프로토타입 진열대', '모든 버전은 보존됩니다. 어떤 버전이든 다시 골라 재가공·분기·최종 조립할 수 있습니다.')}
    ${protos.length ? `<div class="spread" style="margin-bottom:8px"><span class="small muted">총 ${protos.length}개 버전 · 들여쓰기는 부모-자식(분기) 관계</span><button class="btn sm" id="cmp" disabled>선택한 2개 비교</button></div>
      <ul class="tree">${(byParent.root || []).map(node).join('')}</ul>`
      : `<div class="empty">아직 프로토타입이 없습니다. <a href="#/p/${project.id}/tools">가공설비실</a>에서 레버를 당기거나 <a href="#/p/${project.id}/lab">실험실</a>에서 토론을 요약하세요.</div>`}`;
  const boxes = $$('[data-cmp]', el);
  const btn = $('#cmp', el);
  boxes.forEach((b) => b.addEventListener('change', () => { btn.disabled = boxes.filter((x) => x.checked).length !== 2; }));
  btn?.addEventListener('click', () => {
    const [a, b] = boxes.filter((x) => x.checked).map((x) => protos.find((p) => p.id === x.dataset.cmp));
    modal(`<div class="spread"><h2>버전 비교</h2><button class="btn sm" data-dismiss>닫기</button></div><div class="compare">${[a, b].map((p) => `<div><h3>${esc(p.version_label)} · ${esc(p.tool_name)}</h3>${protoDoc(p, { compact: true })}</div>`).join('')}</div>`);
    $('.modal').style.width = 'min(1000px, 100%)';
  });
}

// ═════════ P6 공장장 검수실 ═════════
async function renderReview(el, project, { id }) {
  const protos = await api('GET', `/api/projects/${project.id}/prototypes`);
  if (!protos.length) { el.innerHTML = `${head('P6', '공장장 검수실')}<div class="empty">검수할 프로토타입이 없습니다. <a href="#/p/${project.id}/tools">가공설비실</a>로 가세요.</div>`; return; }
  const proto = protos.find((p) => p.id === id) || protos[protos.length - 1];
  const session = await api('POST', '/api/review-sessions', { prototype_id: proto.id });
  let suggested = [...session.chat].reverse().find((m) => m.suggested_option)?.suggested_option;
  const hints = { changed: '다른 설비로 관점을 바꿔 다시 가공', new_idea: '특별 실험실에서 토론으로 확장', compare: '진열대에서 버전 비교', other_tool: '이 버전을 기준으로 재가공', finalize: '최종 조립실로 이동' };
  const draw = () => {
    el.innerHTML = `${head('P6', '공장장 검수실', '객관식만으로 다음 공정을 고를 수 있습니다. 원하면 공장장과 짧게 대화하세요.')}
    <div class="row" style="margin-bottom:10px"><label class="small" for="pick">검수 대상</label><select id="pick" style="max-width:360px">${protos.map((p) => `<option value="${p.id}" ${p.id === proto.id ? 'selected' : ''}>${esc(p.version_label)} · ${esc(p.tool_name)}</option>`).join('')}</select></div>
    <section class="panel plate"><h2>공장장: “${esc(proto.version_label)}을 보고 생각이 어떻게 바뀌었나요?”</h2>
      ${session.chosen_direction ? `<p class="small"><span class="badge ok">선택됨</span> ${esc(session.options.find((o) => o.id === session.chosen_direction)?.label)}</p>` : ''}
      <div class="choices">${session.options.map((o) => `<button class="choice ${suggested === o.id ? 'suggested' : ''}" data-opt="${o.id}">${esc(o.label)}<small>${hints[o.id]}${suggested === o.id ? ' · 공장장 제안' : ''}</small></button>`).join('')}</div>
    </section>
    <div class="grid c2" style="margin-top:16px;align-items:start">
      <section class="panel"><h2>${esc(proto.version_label)} · ${esc(proto.tool_name)}</h2><h3>${esc(proto.content.title)}</h3>${protoDoc(proto, { compact: true })}</section>
      <section class="panel"><h2>공장장과 대화 <span class="small muted">(선택)</span></h2>
        <div class="chat" id="chat">${session.chat.map((m) => `<div class="msg ${m.role === 'user' ? 'user' : ''}"><div class="who">${m.role === 'user' ? '나' : '공장장'}</div>${esc(m.text)}</div>`).join('') || '<p class="small muted">예: “고객 반응을 먼저 확인하고 싶어요”</p>'}</div>
        <form class="chat-input" id="chat-form"><textarea name="text" placeholder="공장장에게 말하기" maxlength="2000" aria-label="공장장에게 보낼 메시지"></textarea><button class="btn primary">보내기</button></form>
      </section>
    </div>`;
    $('#pick', el).addEventListener('change', (e) => { go(`#/p/${project.id}/review/${e.target.value}`); });
    $$('[data-opt]', el).forEach((b) => b.addEventListener('click', async () => {
      try {
        const r = await api('POST', `/api/review-sessions/${session.id}/choose`, { option_id: b.dataset.opt });
        clank();
        const dest = { tools: `tools?source=${proto.id}`, lab: `lab?source=${proto.id}`, prototypes: 'prototypes', assembly: `assembly?proto=${proto.id}` }[r.next];
        go(`#/p/${project.id}/${dest}`);
      } catch (err) { toast(err.message, true); }
    }));
    const f = $('#chat-form', el);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = f.text.value.trim();
      if (!text) return;
      const btn = $('button', f); btn.disabled = true;
      $('#chat', el).insertAdjacentHTML('beforeend', `<div class="msg user"><div class="who">나</div>${esc(text)}</div><div class="typing">공장장이 생각 중…</div>`);
      try {
        const r = await api('POST', `/api/review-sessions/${session.id}/messages`, { text });
        session.chat = r.chat; suggested = r.suggested_option; draw();
        $('#chat', el).scrollTop = 1e6;
      } catch (err) { toast(err.message, true); $('.typing', el)?.remove(); btn.disabled = false; }
    });
  };
  draw();
}

// ═════════ P4 특별 사고 실험실 ═════════
async function renderLab(el, project, { id, query }) {
  const labs = CATALOG.labs;
  if (id) return renderConversation(el, project, id);
  const [convs, protos] = await Promise.all([api('GET', `/api/projects/${project.id}/conversations`), api('GET', `/api/projects/${project.id}/prototypes`)]);
  const source = query.get('source') || '';
  el.innerHTML = `${head('P4', '특별 사고 실험실', '일반 설비와 달리 실시간 다자간 대화로 운영됩니다. 언제든 끼어들고, 끝내고, 요약할 수 있습니다.')}
    <div class="grid c3">${Object.values(labs).map((l) => `<section class="panel plate"><h2>${esc(l.name)}</h2><p class="small">${esc(l.desc)}</p><p class="small muted">${esc(l.disclaimer)}</p><button class="btn primary" data-lab="${l.id}">토론 시작</button></section>`).join('')}</div>
    ${convs.length ? `<section class="panel"><h2>지난 토론</h2><div class="grid">${convs.slice().reverse().map((c) => `<a class="mat-item" style="text-decoration:none;color:inherit" href="#/p/${project.id}/lab/${c.id}"><div class="body"><div class="title">${esc(labs[c.lab_id].name)} — ${esc(c.topic).slice(0, 60)}</div><div class="small muted">${c.messages.length}개 발언 · ${c.state === 'active' ? '진행 중' : '종료'} · ${fmtTime(c.created_at)}</div></div></a>`).join('')}</div></section>` : ''}`;
  $$('[data-lab]', el).forEach((b) => b.addEventListener('click', () => {
    const lab = labs[b.dataset.lab];
    modal(`<h2>${esc(lab.name)}</h2><form id="lab-form">
      <label class="field"><span>토론 주제</span><input type="text" name="topic" value="${esc(project.goal).slice(0, 200)}" maxlength="500"/></label>
      <label class="field"><span>기준 프로토타입 (선택)</span><select name="source"><option value="">없음</option>${protos.map((p) => `<option value="${p.id}" ${p.id === source ? 'selected' : ''}>${esc(p.version_label)} · ${esc(p.tool_name)}</option>`).join('')}</select></label>
      ${lab.id === 'shark' ? '<label class="field"><span>피칭 (선택)</span><textarea name="pitch" placeholder="아이디어를 1~3문단으로 소개하세요. 심사역이 이 내용을 근거로 질문합니다."></textarea></label>' : ''}
      ${lab.id === 'celeb' ? `<fieldset class="field" style="border:0;padding:0"><legend style="font-weight:500">관점 캐릭터 2~5명</legend><div class="masks">${lab.suggestions.map((n) => `<label class="check" style="margin:2px 10px 2px 0"><input type="checkbox" name="persona" value="${esc(n)}"/> <span>${esc(n)}</span></label>`).join('')}</div>
        <input type="text" name="custom" placeholder="직접 입력 (쉼표로 구분)" style="margin-top:6px"/><div class="notice warn" style="margin-top:8px">${esc(lab.disclaimer)}</div></fieldset>` : ''}
      ${lab.id === 'masks' ? `<div class="masks small">${lab.participants.map((p) => `<span class="badge">${esc(p.name)}</span>`).join('')}</div>` : ''}
      <div class="row" style="margin-top:14px"><button class="btn primary">시작</button><button type="button" class="btn" data-dismiss>취소</button></div></form>`, (m, close) => {
      $('#lab-form', m).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        const personas = [...$$('input[name=persona]:checked', f).map((x) => x.value), ...(f.custom?.value || '').split(',').map((s) => s.trim()).filter(Boolean)];
        const btn = $('button.primary', f); btn.disabled = true; btn.textContent = '참가자 입장 중…';
        try {
          const c = await api('POST', '/api/conversations', { project_id: project.id, lab_id: lab.id, topic: f.topic.value, source_prototype_id: f.source.value || null, pitch: f.pitch?.value || '', personas });
          close(); go(`#/p/${project.id}/lab/${c.id}`);
        } catch (err) {
          if (err.body?.conversation) { close(); toast(err.message, true); go(`#/p/${project.id}/lab/${err.body.conversation.id}`); return; }
          toast(err.message, true); btn.disabled = false; btn.textContent = '시작';
        }
      });
    });
  }));
}
async function renderConversation(el, project, id) {
  let c = await api('GET', `/api/conversations/${id}`);
  const lab = CATALOG.labs[c.lab_id];
  const names = Object.fromEntries(c.participants.map((p) => [p.id, p.name]));
  const userTurns = () => c.messages.filter((m) => m.speaker_id === 'user').length;
  const draw = () => {
    el.innerHTML = `${head('P4', esc(lab.name), esc(c.topic))}
      <div class="notice ${c.lab_id === 'celeb' ? 'warn' : ''}" style="margin-bottom:12px">${esc(c.disclaimer)}</div>
      <div class="masks" style="margin-bottom:10px">${c.participants.map((p) => `<span class="badge" title="${esc(p.role)}">${esc(p.name)}</span>`).join('')}</div>
      <section class="panel">
        <div class="chat" id="chat" aria-live="polite">${c.messages.map((m) => m.speaker_id === 'user' ? `<div class="msg user"><div class="who">나</div>${esc(m.text)}</div>` : `<div class="msg"><div class="who">${esc(names[m.speaker_id] || m.speaker_id)}${m.replies_to && m.replies_to !== 'user' && names[m.replies_to] ? ` <span class="re">↩ ${esc(names[m.replies_to])}에게</span>` : m.replies_to === 'user' ? ' <span class="re">↩ 나에게</span>' : ''}</div>${esc(m.text)}</div>`).join('') || '<p class="small muted">아직 발언이 없습니다. “계속”을 눌러 첫 발언을 요청하세요.</p>'}</div>
        ${c.state === 'active' ? `<form class="chat-input" id="say"><textarea name="text" maxlength="4000" placeholder="끼어들기 — 반박, 질문, 답변 (비워두고 보내면 참가자끼리 계속 토론)" aria-label="토론 발언"></textarea><button class="btn primary">보내기</button></form>
          <div class="spread" style="margin-top:10px"><span class="small muted">내 발언 ${userTurns()} / ${CATALOG.labLimits.maxUserTurns}</span><div class="row"><button class="btn brass" id="sum">요약 리포트 → 프로토타입 저장</button><button class="btn" id="end">토론 종료</button></div></div>`
        : `<div class="spread" style="margin-top:10px"><span class="badge">종료됨</span>${c.summary_prototype_id ? `<a class="btn primary" href="#/p/${project.id}/review/${c.summary_prototype_id}">저장된 프로토타입 검수 →</a>` : '<button class="btn brass" id="sum">요약 리포트 → 프로토타입 저장</button>'}</div>`}
      </section>`;
    $('#chat', el).scrollTop = 1e6;
    $('#say', el)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = e.target.text.value.trim();
      const btn = $('button', e.target); btn.disabled = true;
      $('#chat', el).insertAdjacentHTML('beforeend', `${text ? `<div class="msg user"><div class="who">나</div>${esc(text)}</div>` : ''}<div class="typing">참가자들이 발언을 준비 중…</div>`);
      $('#chat', el).scrollTop = 1e6;
      try { c = await api('POST', `/api/conversations/${c.id}/messages`, { text }); draw(); } catch (err) { toast(err.message, true); $('.typing', el)?.remove(); btn.disabled = false; }
    });
    $('#sum', el)?.addEventListener('click', async (e) => {
      e.target.disabled = true; e.target.textContent = '요약 중…';
      try { const r = await api('POST', `/api/conversations/${c.id}/summary`); clank('done'); toast(`${r.prototype.version_label}로 저장했습니다.`); go(`#/p/${project.id}/review/${r.prototype.id}`); } catch (err) { toast(err.message, true); e.target.disabled = false; e.target.textContent = '요약 리포트 → 프로토타입 저장'; }
    });
    $('#end', el)?.addEventListener('click', async () => { c = await api('POST', `/api/conversations/${c.id}/end`); draw(); });
  };
  draw();
}

// ═════════ P7 최종 조립실 ═════════
async function renderAssembly(el, project, { query }) {
  const [protos, skills] = await Promise.all([api('GET', `/api/projects/${project.id}/prototypes`), api('GET', '/api/custom-skills')]);
  if (!protos.length) { el.innerHTML = `${head('P7', '최종 조립실')}<div class="empty">조립할 프로토타입이 없습니다. 먼저 <a href="#/p/${project.id}/tools">가공</a>하세요.</div>`; return; }
  const key = `dbtb-asm-${project.id}`;
  const d = { proto: query.get('proto') || protos[protos.length - 1].id, format: 'ppt', skill: '', name: project.name, ...ls.get(key, {}) };
  if (query.get('proto')) d.proto = query.get('proto');
  el.innerHTML = `${head('P7', '최종 조립실', 'DBTB의 완제품은 파일이 아니라, 외부 AI가 바로 제작할 수 있는 “제작용 설계 패키지”입니다.')}
    <form class="panel plate" id="asm">
      <div class="grid c2">
        <label class="field"><span>기준 프로토타입</span><select name="proto">${protos.map((p) => `<option value="${p.id}" ${p.id === d.proto ? 'selected' : ''}>${esc(p.version_label)} · ${esc(p.tool_name)} — ${esc(p.content.title).slice(0, 40)}</option>`).join('')}</select><div class="hint">1차든 N차든 원하는 버전을 고르세요.</div></label>
        <label class="field"><span>개인 마무리 스킬</span><select name="skill"><option value="">기본 (스킬 없음)</option>${skills.map((s) => `<option value="${s.id}" ${s.id === d.skill ? 'selected' : ''}>${esc(s.name)} (v${s.version})</option>`).join('')}</select><div class="hint"><a href="#/skills">나의 공구실</a>에서 만들 수 있습니다.</div></label>
      </div>
      <fieldset style="border:0;padding:0;margin:0 0 14px"><legend style="font-weight:500;margin-bottom:6px">출력 형식</legend><div class="choices">${Object.entries(CATALOG.formats).map(([k, f]) => `<label class="choice" style="font-weight:700"><input type="radio" name="format" value="${k}" ${k === d.format ? 'checked' : ''}/> ${esc(f.label)}<small>${esc(f.spec)}</small></label>`).join('')}</div></fieldset>
      <label class="field"><span>최종 프로젝트 아이템명<em>필수</em></span><input type="text" name="name" maxlength="120" value="${esc(d.name)}" required/></label>
      <div class="row"><button class="btn primary" id="go">출고 패키지 생성 → 창고 저장</button><span class="small muted" id="asm-status" role="status"></span></div>
    </form>`;
  const form = $('#asm', el);
  const save = () => { const f = formData(form); ls.set(key, { proto: f.proto, format: f.format, skill: f.skill, name: f.name }); };
  form.addEventListener('input', save);
  let ikey = rid();
  form.addEventListener('input', () => { ikey = rid(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(form);
    if (!f.name.trim()) return toast('최종 아이템명을 입력하세요.', true);
    const btn = $('#go', el); btn.disabled = true; $('#asm-status', el).textContent = '조립 라인 가동 중… (AI가 설계 패키지를 작성합니다)';
    try {
      const fp = await api('POST', '/api/final-packages', { prototype_id: f.proto, custom_skill_id: f.skill || null, format: f.format, final_name: f.name, idempotency_key: ikey }, { retries: 2 });
      ls.del(key); clank('done'); toast('완제품 창고에 입고되었습니다.');
      go(`#/warehouse/${fp.id}`);
    } catch (err) { toast(err.message, true); btn.disabled = false; $('#asm-status', el).textContent = ''; }
  });
}

// ═════════ P8 완제품 창고 ═════════
async function renderWarehouse(el) {
  const q = ls.get('dbtb-wh-q', '');
  el.innerHTML = `${head('P8', '완제품 창고', '최종 아이템을 검색하고, 열고, 복사하고, 외부 AI로 가져가세요.')}
    <div class="row" style="margin-bottom:14px"><input type="search" id="q" value="${esc(q)}" placeholder="최종 아이템명·프로젝트명 검색" aria-label="창고 검색" style="max-width:420px"/></div>
    <div id="list"></div>`;
  const list = $('#list', el);
  const load = async (q) => {
    const items = await api('GET', `/api/warehouse?q=${encodeURIComponent(q)}`);
    list.innerHTML = items.length ? `<div class="grid c2">${items.map((f) => `<article class="crate"><div class="spread"><span class="badge brass">${esc(f.format_label)}</span><span class="small muted">${fmtTime(f.created_at)}</span></div>
      <h3>${esc(f.final_name)}</h3><p class="small muted" style="margin:0">${esc(f.project_name)} · ${esc(f.prototype_label)} · 자료 ${f.source_count}건${f.custom_skill_snapshot ? ` · 스킬: ${esc(f.custom_skill_snapshot.name)}` : ''}</p>
      ${f.sensitive_warnings?.length ? `<p class="small" style="color:var(--burgundy)">⚠ 민감정보 의심: ${esc(f.sensitive_warnings.join(', '))}</p>` : ''}
      <div class="row" style="margin-top:8px"><a class="btn sm primary" href="#/warehouse/${f.id}">열기</a><a class="btn sm" href="#/p/${f.project_id}/tools?source=${f.prototype_id}">다시 가공</a></div></article>`).join('')}</div>`
      : `<div class="empty">${q ? '검색 결과가 없습니다.' : '창고가 비어 있습니다. 최종 조립실에서 첫 패키지를 출고하세요.'}</div>`;
  };
  let t;
  $('#q', el).addEventListener('input', (e) => { ls.set('dbtb-wh-q', e.target.value); clearTimeout(t); t = setTimeout(() => load(e.target.value), 200); });
  await load(q);
}

async function renderPackage(el, id) {
  const fp = await api('GET', `/api/final-packages/${id}`);
  const k = fp.package;
  el.innerHTML = `${head('P8', esc(fp.final_name), `${esc(k.format_label)} 제작 패키지 · ${esc(fp.project_name)} · 기준 ${esc(fp.prototype_label)}`)}
    ${k.engine === 'demo' ? '<div class="notice warn" style="margin-bottom:12px">데모 엔진으로 생성된 구조 예시입니다. 서버에 ANTHROPIC_API_KEY를 설정하면 실제 AI가 작성합니다.</div>' : ''}
    <section class="panel plate"><div class="spread"><h2>외부 AI로 가져가기</h2><span class="small muted">DBTB는 외부 서비스에 자동 제출하거나 제작 완료를 보장하지 않습니다.</span></div>
      <div class="row"><button class="btn brass" id="handoff">복사하고 외부 AI 열기 →</button><button class="btn" id="cp-prompt">제작 지시문 복사</button><button class="btn" id="cp-all">전체 패키지 복사</button>${LOCAL ? '' : '<a class="btn" id="dl" href="#">⬇ .md 다운로드</a>'}<a class="btn ghost" href="#/p/${fp.project_id}/tools?source=${fp.prototype_id}">다시 가공</a></div>
    </section>
    <section class="panel"><h2>외부 AI 제작 지시문</h2><pre class="prompt">${esc(k.production_prompt)}</pre></section>
    <div class="grid c2" style="margin-top:16px;align-items:start">
      <section class="panel"><h2>최종 정리문서</h2><div class="md">${esc(k.human_document)}</div></section>
      <section class="panel"><h2>구성 (${esc(k.format_label)})</h2><ol>${k.outline.map((o) => `<li><b>${esc(o.title)}</b><div class="small">${esc(o.content)}</div></li>`).join('')}</ol>
        <h3>제작 후 검토</h3><ul>${k.review_checklist.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></section>
    </div>
    <div class="grid c2" style="margin-top:16px;align-items:start">
      <section class="panel"><h2>원재료 출처</h2>${k.sources.length ? `<ul>${k.sources.map((s) => `<li>${esc(s.type_label)} · <b>${esc(s.title)}</b>${s.author ? ` — ${esc(s.author)}` : ''} <span class="badge">${esc(CATALOG.rights[s.rights_status])}</span> <span class="badge ${s.analysis_mode === 'text_provided' ? 'ok' : 'brass'}">${s.analysis_mode === 'text_provided' ? '제공 텍스트' : '공개자료 기반'}</span></li>`).join('')}</ul>` : '<p class="small muted">없음</p>'}</section>
      <section class="panel"><h2>가공 이력</h2><ol>${k.lineage.map((l) => `<li>${esc(l.version_label)} — ${esc(l.tool_name)}</li>`).join('')}</ol>${fp.custom_skill_snapshot ? `<p class="small">적용 스킬: <b>${esc(fp.custom_skill_snapshot.name)}</b> (v${fp.custom_skill_snapshot.version}, 출고 시점 스냅샷)</p>` : ''}</section>
    </div>`;
  const md = () => api('GET', `/api/final-packages/${id}/download`);
  let mdCache = null;
  md().then((t) => { mdCache = t; }).catch(() => {});
  $('#cp-prompt', el).addEventListener('click', async () => toast((await copyText(k.production_prompt)) ? '제작 지시문을 복사했습니다.' : '복사하지 못했습니다.', false));
  $('#cp-all', el).addEventListener('click', async () => toast((await copyText(mdCache || (await md()))) ? '전체 패키지를 복사했습니다.' : '복사하지 못했습니다.'));
  $('#dl', el)?.addEventListener('click', async (e) => {
    e.preventDefault();
    const text = mdCache || (await md());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    a.download = `${fp.final_name.replace(/[\\/:*?"<>|]+/g, '_')}.md`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#handoff', el).addEventListener('click', () => openHandoff(fp, () => mdCache));
}

/** EXT-01/02: 권리·민감정보 확인 → 복사 + 공식 링크 새 탭 */
function openHandoff(fp, getMd) {
  const k = fp.package;
  const unknown = k.sources.filter((s) => s.rights_status === 'unknown');
  modal(`<h2>외부 AI로 넘기기 전 확인</h2>
    <form id="ho">
      <fieldset style="border:0;padding:0;margin:0 0 10px"><legend style="font-weight:500">이 패키지의 공개 범위</legend>
        <label class="check"><input type="radio" name="vis" value="private" checked/> <span>비공개 (나만 사용)</span></label>
        <label class="check"><input type="radio" name="vis" value="public"/> <span>공개 (외부에 게시·공유 예정)</span></label></fieldset>
      ${unknown.length ? `<div class="notice warn">권리 미확인 자료 ${unknown.length}건: ${esc(unknown.map((s) => s.title).join(', '))}</div>` : ''}
      <label class="check"><input type="checkbox" name="rights" required/> <span>포함된 자료를 외부 AI에 입력·업로드할 권리가 있음을 확인했습니다. 원문을 재배포하지 않습니다.</span></label>
      ${k.sensitive_warnings?.length ? `<div class="notice warn">⚠ 패키지에서 민감정보로 보이는 내용이 감지되었습니다: <b>${esc(k.sensitive_warnings.join(', '))}</b>. 붙여넣기 전에 지우세요.</div>` : ''}
      <label class="check"><input type="checkbox" name="sensitive" required/> <span>개인정보·비밀번호·주민번호 등 민감정보가 포함되지 않았음을 확인했습니다.</span></label>
      <label class="field" style="margin-top:10px"><span>복사할 내용</span><select name="what"><option value="prompt">제작 지시문만</option><option value="all">전체 패키지(지시문+정리문서+근거)</option></select></label>
      <p class="small muted">두 확인란에 체크한 뒤 서비스를 누르면 내용을 클립보드에 복사하고 공식 사이트를 새 탭으로 엽니다. 붙여넣기(Ctrl/⌘+V)는 직접 하세요.</p>
      <div class="providers" id="provs" aria-disabled="true">${CATALOG.providers.map((p) => `<a class="btn" data-p="${p.id}" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" title="${esc(p.note)}">${esc(p.name)} ↗</a>`).join('')}</div>
      <p class="small muted" id="pnote"></p>
      <div class="row"><button type="button" class="btn ghost" data-dismiss>닫기</button></div>
    </form>`, (m) => {
    const f = $('#ho', m);
    const ready = () => f.rights.checked && f.sensitive.checked;
    const sync = () => $('#provs', f).setAttribute('aria-disabled', String(!ready()));
    sync();
    f.addEventListener('change', sync);
    $$('[data-p]', f).forEach((b) => {
      b.addEventListener('mouseenter', () => { $('#pnote', f).textContent = CATALOG.providers.find((p) => p.id === b.dataset.p).note; });
      b.addEventListener('click', (e) => {
        if (!ready()) { e.preventDefault(); toast('먼저 두 가지 확인란에 체크하세요.', true); return; }
        const prov = CATALOG.providers.find((p) => p.id === b.dataset.p);
        const text = f.what.value === 'all' && getMd() ? getMd() : k.production_prompt;
        copyText(text).then((ok) => toast(ok ? `${prov.name}에 붙여넣을 내용을 복사했습니다.` : '복사에 실패했습니다. 지시문을 직접 선택해 복사하세요.', !ok));
        // 링크 자체가 새 탭으로 공식 사이트를 연다(팝업 차단·액자 제한 회피)
        api('POST', '/api/external-handoffs', { final_package_id: fp.id, provider: prov.id, method: 'open', rights_ack: { rights: true, sensitive: true, visibility: f.vis.value } }).catch(() => {});
        $('#pnote', f).textContent = prov.note;
      });
    });
  });
}

// ═════════ P9 나의 공구실 ═════════
async function renderSkills(el) {
  const [skills, projects] = await Promise.all([api('GET', '/api/custom-skills'), api('GET', '/api/projects')]);
  const draft = ls.get('dbtb-skill-draft', {});
  el.innerHTML = `${head('P9', '나의 공구실', '선호하는 문체·독자·분량·검증 기준을 공구로 저장하고, 최종 조립 때 적용하세요. 공구를 고쳐도 이미 출고된 패키지는 바뀌지 않습니다.')}
  <div class="grid c2" style="align-items:start">
    <form class="panel plate" id="sk"><h2 id="sk-title">새 공구 만들기</h2><input type="hidden" name="id"/>
      <label class="field"><span>공구 이름<em>필수</em></span><input type="text" name="name" maxlength="80" value="${esc(draft.name)}" placeholder="예: 사장님 보고용 담백체"/></label>
      <label class="field"><span>지시문<em>필수</em></span><textarea name="instruction" maxlength="6000" placeholder="예: 결론을 맨 앞에. 전문용어 대신 쉬운 말. 실행 항목은 담당자와 기한을 붙인다.">${esc(draft.instruction)}</textarea></label>
      <div class="grid c2"><label class="field"><span>문체</span><input type="text" name="tone" value="${esc(draft.tone)}" placeholder="담백한 존댓말"/></label><label class="field"><span>독자</span><input type="text" name="audience" value="${esc(draft.audience)}" placeholder="매장 직원 5명"/></label></div>
      <div class="grid c2"><label class="field"><span>분량</span><input type="text" name="length" value="${esc(draft.length)}" placeholder="슬라이드 10장 이내"/></label><label class="field"><span>검증 기준</span><input type="text" name="criteria" value="${esc(draft.criteria)}" placeholder="모든 수치에 출처 또는 '가정' 표시"/></label></div>
      <label class="field"><span>출력 규칙</span><textarea name="output_rules" maxlength="6000" placeholder="예: 각 슬라이드 제목은 15자 이내">${esc(draft.output_rules)}</textarea></label>
      <div class="row"><button class="btn primary">공구 저장</button><button type="button" class="btn ghost" id="sk-reset">새로 만들기</button></div>
    </form>
    <section class="panel"><h2>내 공구 <span class="badge">${skills.length}</span></h2>
      ${skills.length ? `<div class="grid">${skills.map((s) => `<div class="mat-item"><span class="ic">🔧</span><div class="body"><div class="title">${esc(s.name)} <span class="badge">v${s.version}</span></div><div class="small muted">${esc(s.instruction).slice(0, 100)}</div>
        <div class="row" style="margin-top:6px"><button class="btn sm" data-edit="${s.id}">편집</button><button class="btn sm" data-test="${s.id}">테스트</button><button class="btn sm ghost" data-del="${s.id}">삭제</button></div></div></div>`).join('')}</div>` : '<div class="empty">아직 공구가 없습니다.</div>'}
    </section>
  </div>`;
  const form = $('#sk', el);
  form.addEventListener('input', () => { if (!form.id.value) ls.set('dbtb-skill-draft', formData(form)); });
  $('#sk-reset', el).addEventListener('click', () => { ls.del('dbtb-skill-draft'); route(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(form);
    try {
      if (d.id) await api('PUT', `/api/custom-skills/${d.id}`, d); else await api('POST', '/api/custom-skills', d);
      ls.del('dbtb-skill-draft'); clank(); toast(d.id ? '새 버전으로 저장했습니다.' : '공구를 저장했습니다.'); route();
    } catch (err) { toast(err.message, true); }
  });
  $$('[data-edit]', el).forEach((b) => b.addEventListener('click', () => {
    const s = skills.find((x) => x.id === b.dataset.edit);
    for (const k of ['id', 'name', 'instruction', 'tone', 'audience', 'length', 'criteria', 'output_rules']) form[k].value = s[k] || '';
    $('#sk-title', el).textContent = `공구 편집 — v${s.version} → v${s.version + 1}`;
    form.name.focus();
  }));
  $$('[data-del]', el).forEach((b) => b.addEventListener('click', async () => { if (await confirmBox('공구를 삭제할까요?', '이미 출고된 패키지에는 영향이 없습니다.')) { await api('DELETE', `/api/custom-skills/${b.dataset.del}`); route(); } }));
  $$('[data-test]', el).forEach((b) => b.addEventListener('click', async () => {
    const options = [];
    for (const p of projects.filter((x) => x.counts.prototypes)) {
      const ps = await api('GET', `/api/projects/${p.id}/prototypes`);
      ps.forEach((x) => options.push(`<option value="${x.id}">${esc(p.name)} · ${esc(x.version_label)}</option>`));
    }
    if (!options.length) return toast('테스트하려면 프로토타입이 하나 이상 필요합니다.', true);
    modal(`<h2>공구 테스트</h2><p class="small muted">선택한 프로토타입에 공구를 적용한 미리보기를 만듭니다(저장되지 않음).</p>
      <label class="field"><span>프로토타입</span><select id="tp">${options.join('')}</select></label>
      <div class="row"><button class="btn primary" id="run-test">미리보기</button><button class="btn" data-dismiss>닫기</button></div><div id="tout" style="margin-top:12px"></div>`, (m) => {
      $('#run-test', m).addEventListener('click', async (e) => {
        e.target.disabled = true; $('#tout', m).innerHTML = '<p class="small muted">공구 시험 가동 중…</p>';
        try { const r = await api('POST', `/api/custom-skills/${b.dataset.test}/test`, { prototype_id: $('#tp', m).value }); $('#tout', m).innerHTML = `<pre class="prompt">${esc(r.preview.production_prompt)}</pre>`; } catch (err) { $('#tout', m).innerHTML = `<div class="error-box">${esc(err.message)}</div>`; }
        e.target.disabled = false;
      });
    });
  }));
}

route();
