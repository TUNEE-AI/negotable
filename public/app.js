/* ─────────────────────────────────────────────────────────────
   NegoTable 프런트엔드 (빌드 도구 없는 순수 JS)
   흐름: 랜딩 → AI 대화 → 이해한 내용 확인 → ITEM 확인·수정 → 상대방 Preview → 완료/설문
   - AI 호출은 모두 서버(/api/*)를 거칩니다. 이 파일에는 API 키가 없습니다.
   - negotiationState 는 여기(S.state)에 들고 있다가 매 요청에 함께 보냅니다.
   - 새로고침해도 진행이 유지되도록 sessionStorage 에 저장합니다.
   ───────────────────────────────────────────────────────────── */
(() => {
  'use strict';

  const CFG = window.NEGOTABLE_CONFIG || {};
  const STORE_KEY = 'negotable.v2'; // 구조가 바뀌면 숫자를 올려 옛 저장본을 버린다
  const GREETING =
    '상대방과 조정하거나 합의하고 싶은 상황을 편하게 설명해주세요. 정리해서 말씀하지 않아도 됩니다. 어떤 일이 있었고, 상대방에게 무엇을 요청하거나 제안하고 싶은지 자유롭게 이야기해주세요.';
  const CONFIRM_PLACEHOLDER = '맞으면 “맞아요”, 고칠 곳이 있으면 말씀해주세요.';
  const INTAKE_PLACEHOLDER = '상황을 편하게 적어주세요.';
  const ACTIONS = [
    ['accept', 'ACCEPT', '수락'],
    ['counter', 'COUNTER', '역제안'],
    ['scope', 'SCOPE CHANGE', '범위 변경'],
    ['discuss', 'DISCUSS', '논의 요청'],
    ['hold', 'HOLD', '보류'],
    ['reject', 'REJECT', '거절'],
  ];
  const KIND_LABEL = { amount: '금액', period: '기간', condition: '조건' };
  const kindBadge = (k) => (KIND_LABEL[k] ? h('span', { class: 'kind k-' + k }, KIND_LABEL[k]) : null);
  const ITEM_FIELDS = [
    ['request', '요청 내용'],
    ['scope', '범위'],
    ['period', '기간'],
    ['amount', '금액'],
    ['rationale', '근거'],
  ];

  // ── 유틸 ────────────────────────────────────────────────────
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const isCoarse = matchMedia('(pointer: coarse)').matches;

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const emptyState = () => ({
    counterparty: '',
    situation: '',
    issues: [],
    desiredOutcome: '',
    conditions: [],
    rationale: [],
    existingAgreements: [],
    confirmedFacts: [],
    unknownFacts: [],
    items: [],
  });

  const newId = () => 'it_' + Math.random().toString(36).slice(2, 9);
  const sid = () => 's_' + Math.random().toString(36).slice(2, 12);

  // ── 앱 상태 ─────────────────────────────────────────────────
  const fresh = () => ({
    sid: sid(),
    messages: [], // {role, content, action?, summary?, static?}
    phase: 'intake', // intake | confirming | items
    state: emptyState(), // negotiationState
    itemsReady: false,
    itemsNote: '',
    responses: {}, // 상대방 Preview 시뮬레이션 선택 {itemId: action}
    proposal: { to: '', from: '' }, // 받는 분 · 보내는 분
    files: [], // 첨부(근거 자료): {id, name, size, itemId|null}. 파일 이름·크기만 저장하며 내용은 저장/전송하지 않음
    tracked: [],
    survey: null,
  });
  let S = load() || fresh();
  // 저장하지 않는 일시 상태
  const T = { busy: null, error: null, editingId: null, changed: new Set(), seen: new Set(), lastDeleted: null, editBusy: false, staged: [] };

  function load() {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      return raw ? { ...fresh(), ...JSON.parse(raw) } : null;
    } catch {
      return null;
    }
  }
  function save() {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(S));
    } catch {}
  }

  // ── 네트워크 ────────────────────────────────────────────────
  async function api(path, body) {
    const ctrl = new AbortController();
    // 서버 쪽 AI 호출 제한(60초)과 부가 호출을 감안해, 서버가 답하기 전에 브라우저가 먼저 끊지 않도록 여유를 둔다.
    const timer = setTimeout(() => ctrl.abort(), 150_000);
    let res;
    try {
      res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? '응답이 너무 오래 걸리고 있어요. 다시 시도해주세요.' : '네트워크 연결을 확인해주세요.');
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try {
      data = await res.json();
    } catch {}
    if (!res.ok) throw new Error(data?.error || '문제가 발생했어요. 잠시 후 다시 시도해주세요.');
    return data;
  }

  function track(type) {
    if (S.tracked.includes(type)) return;
    S.tracked.push(type);
    save();
    const payload = JSON.stringify({ sid: S.sid, type });
    try {
      if (!(navigator.sendBeacon && navigator.sendBeacon('/api/event', new Blob([payload], { type: 'application/json' })))) throw 0;
    } catch {
      fetch('/api/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
    }
  }

  const wire = () =>
    S.messages
      .filter((m) => !m.static)
      .map((m) => ({
        role: m.role,
        content: m.content + (m.files && m.files.length ? `\n(첨부한 파일 이름: ${m.files.map((f) => f.name).join(', ')} — 파일 내용은 AI가 볼 수 없음)` : ''),
        action: m.action,
      }));

  // ── 토스트 ──────────────────────────────────────────────────
  let toastTimer;
  function toast(msg, opt = {}) {
    const el = $('#toast');
    el.replaceChildren(h('span', {}, msg));
    if (opt.action) {
      el.append(
        h('button', { type: 'button', onclick: () => { opt.action.fn(); el.hidden = true; } }, opt.action.label),
      );
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), opt.ms || 3800);
  }

  // ── 라우터 ──────────────────────────────────────────────────
  const VIEWS = ['landing', 'chat', 'items', 'preview'];
  const STEPS = [
    ['chat', '이야기하기'],
    ['items', '항목 다듬기'],
    ['preview', '상대방 화면'],
  ];

  function currentRoute() {
    let v = location.hash.replace(/^#\/?/, '') || 'landing';
    if (!VIEWS.includes(v)) v = 'landing';
    if ((v === 'items' || v === 'preview') && !S.itemsReady) v = S.messages.length ? 'chat' : 'landing';
    return v;
  }

  function route() {
    const v = currentRoute();
    for (const name of VIEWS) $('#view-' + name).hidden = name !== v;
    window.scrollTo(0, 0);
    document.body.classList.remove('panel-open');
    $('#table-panel')?.classList.remove('open');
    renderSteppers(v);
    if (v === 'landing') track('landing_view');
    if (v === 'chat') mountChat();
    if (v === 'items') mountItems();
    if (v === 'preview') mountPreview();
  }

  function renderSteppers(cur) {
    const idx = STEPS.findIndex(([k]) => k === cur);
    for (const nav of $$('.stepper')) {
      nav.replaceChildren();
      STEPS.forEach(([k, label], i) => {
        const enabled = k === 'chat' || S.itemsReady;
        const cls = 'st ' + (i === idx ? 'now' : i < idx ? 'done' : '') + (enabled ? '' : ' off');
        const inner = [h('span', { class: 'sn' }, i < idx ? '✓' : String(i + 1)), h('span', { class: 'sl' }, label)];
        nav.append(
          i === idx || !enabled ? h('span', { class: cls, 'aria-current': i === idx ? 'step' : null }, inner) : h('a', { class: cls, href: '#/' + k }, inner),
        );
        if (i < STEPS.length - 1) nav.append(h('span', { class: 'st-sep', 'aria-hidden': 'true' }));
      });
    }
  }

  // ═══════════════════ 랜딩 ═══════════════════
  function startChat() {
    // 랜딩의 시작 버튼은 항상 새 대화로 시작한다(이전 진행분은 버림). 새로고침은 그대로 이어진다.
    S = fresh();
    Object.assign(T, { busy: null, error: null, editingId: null, changed: new Set(), seen: new Set(), staged: [] });
    save();
    if (location.hash === '#/chat') route();
    else location.hash = '#/chat';
  }

  // ═══════════════════ 첨부(근거 자료) ═══════════════════
  // 파일 내용은 저장·전송하지 않고 이름·크기만 다룬다. 대화 입력창에서 붙이거나 ITEM 카드마다 붙일 수 있다.
  const MAX_FILES = 5;
  const MAX_BYTES = 10 * 1024 * 1024;
  const fmtSize = (n) => (n < 1024 ? n + 'B' : n < 1048576 ? Math.round(n / 1024) + 'KB' : (n / 1048576).toFixed(1) + 'MB');
  const filesOf = (itemId) => S.files.filter((f) => f.itemId === itemId);
  const looseFiles = () => S.files.filter((f) => !f.itemId);

  function fileRow(f, onRemove) {
    const li = h('li', {}, h('span', { class: 'fn', title: f.name }, f.name), h('span', { class: 'fs' }, fmtSize(f.size)), onRemove ? h('button', { class: 'rm', type: 'button', 'aria-label': f.name + ' 삭제', onclick: onRemove }, '삭제') : null);
    li.insertAdjacentHTML('afterbegin', '<svg class="ic"><use href="#i-clip"/></svg>');
    return li;
  }

  /** 선택한 파일 중 조건에 맞는 것만 {id,name,size}로 돌려준다 */
  function pickFiles(list, currentCount) {
    const ok = [];
    const tooBig = [];
    for (const f of Array.from(list)) {
      if (currentCount + ok.length >= MAX_FILES) { toast(`첨부는 최대 ${MAX_FILES}개까지 가능해요.`); break; }
      if (f.size > MAX_BYTES) { tooBig.push(f.name); continue; }
      ok.push({ id: newId(), name: f.name.slice(0, 120), size: f.size });
    }
    if (tooBig.length) toast('10MB를 넘는 파일은 제외했어요: ' + tooBig.join(', '));
    return ok;
  }

  function renderStaged() {
    const ul = $('#staged');
    ul.hidden = T.staged.length === 0;
    ul.replaceChildren(...T.staged.map((f) => fileRow(f, () => { T.staged = T.staged.filter((x) => x.id !== f.id); renderStaged(); })));
  }

  // ═══════════════════ AI 대화 ═══════════════════
  const log = () => $('#chat-log');
  const input = () => $('#chat-input');

  function mountChat() {
    if (S.messages.length === 0) {
      S.messages.push({ role: 'assistant', content: GREETING, static: true });
      save();
    }
    T.seen = new Set(stateKeys(S.state)); // 이미 올라온 것은 애니메이션하지 않음
    renderLog(true);
    renderPanel(false);
    setPlaceholder();
    if (!isCoarse) input().focus({ preventScroll: true });
  }

  function setPlaceholder() {
    input().placeholder = S.phase === 'confirming' ? CONFIRM_PLACEHOLDER : INTAKE_PLACEHOLDER;
  }

  function lockComposer(locked) {
    $('#chat-send').disabled = locked;
    input().disabled = locked;
    if (!locked && !isCoarse && currentRoute() === 'chat') input().focus({ preventScroll: true });
  }

  function summaryCard(st) {
    const rows = [];
    const row = (label, val, cls) => rows.push(h('div', { class: 'row ' + (cls || '') }, h('dt', {}, label), h('dd', {}, val)));
    const list = (arr) => h('ul', {}, arr.map((x) => h('li', {}, x)));
    const amounts = st.conditions.filter((c) => c.kind === 'amount');
    const others = st.conditions.filter((c) => c.kind !== 'amount');
    if (st.counterparty) row('상대방', st.counterparty);
    if (st.situation) row('현재 상황', st.situation);
    if (st.issues.length) row('핵심 쟁점', list(st.issues));
    if (st.desiredOutcome) row('원하는 결과', st.desiredOutcome);
    if (others.length) row('주요 조건', list(others.map((c) => [c.topic, c.topic && c.detail ? ' — ' : '', c.detail].join(''))));
    if (amounts.length) row('금액', list(amounts.map((c) => [c.topic, c.topic && c.detail ? ' — ' : '', c.detail].join(''))));
    if (st.rationale.length) row('근거', list(st.rationale));
    if (st.existingAgreements.length) row('이미 합의된 것', list(st.existingAgreements));
    if (st.unknownFacts.length) row('아직 미정', list(st.unknownFacts), 'unk');
    return h('div', { class: 'summary' }, h('div', { class: 'summary-head' }, '협상 내용 정리'), h('dl', {}, rows));
  }

  function renderLog(instant) {
    const el = log();
    el.replaceChildren();
    const lastIdx = S.messages.length - 1;
    S.messages.forEach((m, i) => {
      if (m.role === 'user') {
        el.append(h('div', { class: 'msg user' }, h('div', { class: 'ustack' }, h('div', { class: 'bubble' }, m.content), m.files && m.files.length ? h('ul', { class: 'file-list ufiles' }, m.files.map((f) => fileRow(f))) : null)));
        return;
      }
      const stack = h('div', { class: 'stack' }, h('div', { class: 'bubble' }, m.content));
      if (m.action === 'summarize' && m.summary) {
        stack.append(summaryCard(m.summary));
        if (i === lastIdx && S.phase === 'confirming' && !T.busy && !T.error) {
          stack.append(
            h(
              'div',
              { class: 'summary-actions' },
              h('button', { class: 'btn btn-ink btn-sm', type: 'button', onclick: proceedToItems }, '이대로 진행하기'),
              h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { setPlaceholder(); input().focus(); } }, '고칠 부분이 있어요'),
            ),
          );
        }
      }
      el.append(h('div', { class: 'msg ai' }, h('div', { class: 'av' }, 'AI'), stack));
    });

    if (T.busy) {
      el.append(
        h(
          'div',
          { class: 'msg ai' },
          h('div', { class: 'av' }, 'AI'),
          T.busy === 'items'
            ? h('div', { class: 'bubble' }, '협상 ITEM으로 나누고 있어요…')
            : h('div', { class: 'bubble typing', 'aria-label': 'AI가 답을 쓰는 중' }, h('i'), h('i'), h('i')),
        ),
      );
    }
    if (T.error) {
      el.append(
        h(
          'div',
          { class: 'msg ai err' },
          h('div', { class: 'av' }, 'AI'),
          h(
            'div',
            { class: 'bubble' },
            T.error.msg,
            h('div', { class: 'retry' }, h('button', { class: 'btn btn-ink btn-sm', type: 'button', onclick: () => (T.error.kind === 'items' ? runItems() : runChat()) }, '다시 시도')),
          ),
        ),
      );
    }
    el.scrollTo({ top: el.scrollHeight, behavior: instant ? 'auto' : 'smooth' });
  }

  async function sendUser(text) {
    text = String(text || '').trim();
    if (!text || T.busy) return;
    const files = T.staged.splice(0);
    S.messages.push({ role: 'user', content: text, files });
    if (files.length) S.files.push(...files.map((f) => ({ ...f, itemId: null })));
    renderStaged();
    track('chat_start');
    save();
    await runChat();
  }

  // "이대로 진행하기" 버튼: 동의가 명확하므로 AI에게 동의 여부를 묻는 대화 호출을 건너뛰고
  // 바로 ITEM 생성으로 간다. (직접 "맞아요"라고 입력한 경우는 기존처럼 AI가 판단한다.)
  async function proceedToItems() {
    if (T.busy || S.phase !== 'confirming') return;
    S.messages.push({ role: 'user', content: '네, 이대로 진행해주세요.', files: [] });
    S.messages.push({ role: 'assistant', content: '좋아요, 협상 ITEM으로 나눠볼게요.', action: 'generate_items', summary: null });
    S.phase = 'items';
    save();
    setPlaceholder();
    await runItems();
  }

  async function runChat() {
    T.busy = 'chat';
    T.error = null;
    renderLog();
    lockComposer(true);
    try {
      const res = await api('/api/chat', { messages: wire(), state: S.state, phase: S.phase });
      S.state = res.state;
      S.phase = res.phase;
      S.messages.push({
        role: 'assistant',
        content: res.reply,
        action: res.action,
        summary: res.action === 'summarize' ? clone(res.state) : null,
      });
      if (res.action === 'summarize') track('summary_shown');
      save();
      T.busy = res.action === 'generate_items' ? 'items' : null;
      renderPanel(true);
      setPlaceholder();
      renderLog();
      if (res.action === 'generate_items') await runItems();
    } catch (e) {
      T.error = { kind: 'chat', msg: e.message };
    } finally {
      if (T.busy === 'chat') T.busy = null;
      if (T.busy !== 'items') {
        renderLog();
        lockComposer(false);
      }
    }
  }

  async function runItems() {
    T.busy = 'items';
    T.error = null;
    renderLog();
    lockComposer(true);
    try {
      const res = await api('/api/items', { messages: wire(), state: S.state });
      S.state = res.state;
      S.itemsNote = res.reply;
      S.itemsReady = true;
      S.files.forEach((f) => (f.itemId = null)); // 새 ITEM이 만들어졌으므로 항목 연결은 다시 고른다
      S.responses = {};
      S.phase = 'items';
      T.changed = new Set();
      save();
      track('items_generated');
      T.busy = null;
      lockComposer(false);
      location.hash = '#/items';
    } catch (e) {
      T.error = { kind: 'items', msg: e.message };
      T.busy = null;
      renderLog();
      lockComposer(false);
    }
  }

  // ── 테이블 패널(AI가 지금 이해하고 있는 상태) ─────────────────
  function stateKeys(st) {
    return [
      st.counterparty && 'cp:' + st.counterparty,
      st.situation && 'sit:' + st.situation,
      st.desiredOutcome && 'out:' + st.desiredOutcome,
      ...st.issues.map((x) => 'is:' + x),
      ...st.conditions.map((c) => 'co:' + c.topic + c.detail),
    ].filter(Boolean);
  }

  function renderPanel(animate) {
    const st = S.state;
    const body = $('#panel-body');
    body.replaceChildren();
    $('#panel-count').textContent = String(st.issues.length + st.conditions.length);
    const isNew = (k) => animate && !T.seen.has(k);
    const tilt = (i) => ['-1.1deg', '.8deg', '-.4deg', '1deg'][i % 4];
    const sec = (label, node) => body.append(h('div', { class: 'tp-sec' }, h('div', { class: 'tp-label' }, label), node));

    // 확인 현황: 정리 전에 AI가 확인해야 하는 항목의 진행 상태
    const COV = [['counterparty', '상대방'], ['situation', '상황'], ['issues', '핵심 쟁점'], ['desiredOutcome', '원하는 결과'], ['conditions', '조건'], ['amount', '금액'], ['period', '기간'], ['rationale', '근거']];
    const MARK = { known: '✓', unknown: '미정', not_applicable: '해당 없음', not_asked: '' };
    const cov = st.coverage || {};
    if (S.phase === 'intake') {
      body.append(
        h('div', { class: 'tp-progress', 'aria-label': '확인 현황' }, COV.map(([k, label]) => {
          const v = cov[k] || 'not_asked';
          return h('span', { class: 'tp-step ' + v }, h('i', {}, MARK[v]), label);
        })),
      );
    }

    if (!stateKeys(st).length) {
      body.append(h('p', { class: 'tp-empty', style: 'margin-top:14px' }, '아직 테이블이 비어 있어요. 이야기를 들려주시면, AI가 이해한 내용이 이곳에 하나씩 올라옵니다.'));
      return;
    }
    if (st.counterparty) sec('상대방', h('div', { class: 'tp-val' + (isNew('cp:' + st.counterparty) ? ' new' : '') }, st.counterparty));
    if (st.situation) sec('현재 상황', h('div', { class: 'tp-val' + (isNew('sit:' + st.situation) ? ' new' : '') }, st.situation));
    if (st.issues.length)
      sec('핵심 쟁점', h('div', { class: 'tp-cards' }, st.issues.map((x, i) => h('div', { class: 'tp-card' + (isNew('is:' + x) ? ' new' : ''), style: `--r:${tilt(i)}` }, x))));
    if (st.desiredOutcome) sec('원하는 결과', h('div', { class: 'tp-val' + (isNew('out:' + st.desiredOutcome) ? ' new' : '') }, st.desiredOutcome));
    if (st.conditions.length)
      sec(
        '조건',
        h(
          'div',
          { class: 'tp-cards' },
          st.conditions.map((c, i) =>
            h('div', { class: 'tp-card' + (c.kind === 'amount' ? ' amount' : '') + (isNew('co:' + c.topic + c.detail) ? ' new' : ''), style: `--r:${tilt(i + 2)}` }, c.topic || c.detail, c.topic && c.detail ? h('small', {}, c.detail) : null),
          ),
        ),
      );
    T.seen = new Set([...T.seen, ...stateKeys(st)]);
  }

  function togglePanel(open) {
    const p = $('#table-panel');
    const next = open ?? !p.classList.contains('open');
    p.classList.toggle('open', next);
    $('#panel-toggle').setAttribute('aria-expanded', String(next));
  }

  // ═══════════════════ ITEM 확인·수정 ═══════════════════
  const items = () => S.state.items;

  // ── 제안 정보(받는 분 · 보내는 분) ─────────────────────────────
  const prop = () => (S.proposal = { to: '', from: '', ...S.proposal });
  const toName = () => prop().to.trim() || S.state.counterparty || '상대방';
  const fromName = () => prop().from.trim() || '제안자 (가명)';

  function renderProposal() {
    if (document.activeElement !== $('#pp-to')) $('#pp-to').value = prop().to || S.state.counterparty || '';
    if (document.activeElement !== $('#pp-from')) $('#pp-from').value = prop().from;
    const toVal = prop().to.trim();
    const fromVal = prop().from.trim();
    const previewEl = $('#prop-preview');
    if (!toVal && !fromVal) {
      previewEl.classList.add('hint');
      previewEl.replaceChildren('이름을 넣으면 상대방 화면에 "누가 누구에게 보내는 제안인지" 바로 보여요.');
    } else {
      previewEl.classList.remove('hint');
      const from = fromVal || '제안자';
      const to = toVal || S.state.counterparty || '상대방';
      previewEl.replaceChildren(h('b', {}, from), '님이 ', h('b', {}, to), '님에게 보내는 제안입니다');
    }
  }

  function mountItems() {
    renderProposal();
    renderNote();
    renderItems();
  }

  function renderNote() {
    const el = $('#ai-note');
    if (!S.itemsNote) return void (el.hidden = true);
    el.hidden = false;
    el.replaceChildren(h('div', { class: 'av' }, 'AI'), h('p', {}, S.itemsNote));
  }

  function itemAttach(it) {
    const files = filesOf(it.id);
    const input = h('input', { type: 'file', multiple: true, hidden: true, onchange: (e) => {
      const acc = pickFiles(e.target.files, filesOf(it.id).length);
      S.files.push(...acc.map((f) => ({ ...f, itemId: it.id })));
      e.target.value = '';
      save();
      renderItems();
    } });
    return h(
      'div',
      { class: 'item-files' },
      h('div', { class: 'if-head' }, h('b', {}, '첨부 (이 항목의 근거 자료)'), h('label', { class: 'btn btn-ghost btn-sm' }, '+ 파일 추가', input)),
      files.length ? h('ul', { class: 'file-list' }, files.map((f) => fileRow(f, () => { S.files = S.files.filter((x) => x.id !== f.id); save(); renderItems(); }))) : null,
    );
  }

  // 대화에서 붙인 파일 중 아직 항목에 연결하지 않은 것
  function renderTray() {
    const box = $('#tray');
    const loose = looseFiles();
    box.hidden = loose.length === 0;
    if (!loose.length) return;
    box.replaceChildren(
      h('h2', {}, '대화에서 첨부한 파일'),
      h('p', { class: 'tray-note' }, '어느 항목의 근거 자료인지 골라주세요. 고르지 않으면 상대방 화면에 “공통 첨부 파일”로 표시됩니다.'),
      h(
        'ul',
        { class: 'file-list tray-list' },
        loose.map((f) => {
          const li = fileRow(f, () => { S.files = S.files.filter((x) => x.id !== f.id); save(); renderItems(); });
          const sel = h(
            'select',
            { 'aria-label': f.name + '을(를) 붙일 항목', onchange: (e) => { f.itemId = e.target.value || null; save(); renderItems(); } },
            h('option', { value: '' }, '항목 선택…'),
            items().map((it, i) => h('option', { value: it.id }, 'ITEM ' + String(i + 1).padStart(2, '0') + ' · ' + it.title)),
          );
          li.insertBefore(sel, li.querySelector('.rm'));
          return li;
        }),
      ),
    );
  }

  function fieldRows(it) {
    const rows = ITEM_FIELDS.filter(([k]) => it[k]);
    if (!rows.length) return null;
    return h('dl', { class: 'fields' }, rows.flatMap(([k, label]) => [h('dt', {}, label), h('dd', {}, it[k])]));
  }

  function renderItems() {
    const list = $('#items-list');
    list.replaceChildren();
    const arr = items();
    if (!arr.length) list.append(h('p', { class: 'tp-empty', style: 'color:var(--mute)' }, '항목이 없어요. 아래 “항목 직접 추가”로 만들거나 입력창에 원하는 항목을 말해보세요.'));
    arr.forEach((it, i) => {
      if (T.editingId === it.id) return list.append(itemForm(it, i));
      list.append(
        h(
          'article',
          { class: 'item' + (T.changed.has(it.id) ? ' flash' : ''), 'data-id': it.id },
          h(
            'div',
            { class: 'item-top' },
            h('span', { class: 'item-no' }, 'ITEM ' + String(i + 1).padStart(2, '0'), kindBadge(it.kind)),
            h(
              'div',
              { class: 'item-tools' },
              h('button', { class: 'tbtn', type: 'button', disabled: i === 0, 'aria-label': '위로', onclick: () => moveItem(i, -1) }, '↑'),
              h('button', { class: 'tbtn', type: 'button', disabled: i === arr.length - 1, 'aria-label': '아래로', onclick: () => moveItem(i, 1) }, '↓'),
              h('button', { class: 'tbtn', type: 'button', onclick: () => { T.editingId = it.id; renderItems(); } }, '편집'),
              h('button', { class: 'tbtn del', type: 'button', onclick: () => deleteItem(i) }, '삭제'),
            ),
          ),
          h('div', { class: 'item-title' }, it.title),
          it.headline ? h('div', { class: 'item-headline' }, it.headline) : null,
          it.issue ? h('p', { class: 'item-issue' }, it.issue) : null,
          fieldRows(it),
          itemAttach(it),
        ),
      );
    });
    renderTray();
    $('#btn-preview').disabled = arr.length === 0;
    T.changed = new Set();
  }

  function itemForm(it, idx) {
    const f = {};
    const field = (key, label, { area = false, ph = '' } = {}) => {
      const el = area ? h('textarea', { rows: 3, placeholder: ph }) : h('input', { type: 'text', placeholder: ph });
      el.value = it[key] || '';
      f[key] = el;
      return h('label', {}, label, el);
    };
    const form = h(
      'form',
      { class: 'item form', onsubmit: (e) => { e.preventDefault(); saveItem(it, f); } },
      h('div', { class: 'item-top' }, h('span', { class: 'item-no' }, 'ITEM ' + String(idx + 1).padStart(2, '0') + ' 편집')),
      h('label', {}, '종류 (한 항목에는 한 종류만)', (f.kind = h('select', {}, [['', '선택 안 함'], ['amount', '금액'], ['period', '기간'], ['condition', '조건']].map(([v, l]) => h('option', { value: v, selected: (it.kind || '') === v ? true : null }, l))))),
      field('title', '제목'),
      field('headline', '핵심 조건 (카드에 크게 표시)', { ph: '금액이 있으면 금액, 없으면 핵심 기간·범위·조건' }),
      field('issue', '협의 사항 (한 줄)'),
      field('request', '요청 내용', { area: true }),
      field('scope', '범위'),
      h('div', { class: 'two' }, field('period', '기간'), field('amount', '금액')),
      field('rationale', '근거', { area: true }),
      h(
        'div',
        { class: 'form-actions' },
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => cancelEdit(it) }, '취소'),
        h('button', { class: 'btn btn-ink btn-sm', type: 'submit' }, '저장'),
      ),
    );
    setTimeout(() => f.title.focus({ preventScroll: false }), 0);
    return form;
  }

  function saveItem(it, f) {
    const next = { ...it };
    for (const k of Object.keys(f)) next[k] = f[k].value.trim();
    if (!next.title && !next.request) return toast('제목이나 요청 내용을 입력해주세요.');
    if (!next.title) next.title = next.request.slice(0, 24);
    if (!next.headline) next.headline = next.amount || next.period || '조건 협의';
    S.state.items = items().map((x) => (x.id === it.id ? next : x));
    T.editingId = null;
    T.changed = new Set([it.id]);
    save();
    renderItems();
    toast('수정했어요.');
  }

  function cancelEdit(it) {
    // 방금 추가한 빈 항목이면 취소 시 제거
    if (!it.title && !it.request && !it.headline) S.state.items = items().filter((x) => x.id !== it.id);
    T.editingId = null;
    save();
    renderItems();
  }

  function moveItem(i, d) {
    const arr = items().slice();
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    S.state.items = arr;
    save();
    renderItems();
  }

  function deleteItem(i) {
    const arr = items().slice();
    const [removed] = arr.splice(i, 1);
    S.files.forEach((f) => { if (f.itemId === removed.id) f.itemId = null; }); // 삭제된 항목의 파일은 미지정으로 돌린다
    S.state.items = arr;
    T.lastDeleted = { item: removed, index: i };
    save();
    renderItems();
    toast('항목을 삭제했어요.', {
      ms: 6000,
      action: {
        label: '되돌리기',
        fn: () => {
          const d = T.lastDeleted;
          if (!d) return;
          const a = items().slice();
          a.splice(Math.min(d.index, a.length), 0, d.item);
          S.state.items = a;
          T.lastDeleted = null;
          save();
          renderItems();
        },
      },
    });
  }

  function addItem() {
    const it = { id: newId(), title: '', headline: '', issue: '', request: '', scope: '', period: '', amount: '', rationale: '' };
    S.state.items = [...items(), it];
    T.editingId = it.id;
    renderItems();
  }

  async function reviseByText(text) {
    text = String(text || '').trim();
    if (!text || T.editBusy) return;
    T.editBusy = true;
    const bar = $('#edit-bar');
    bar.classList.add('busy');
    $('#edit-send').disabled = true;
    const before = new Map(items().map((x) => [x.id, JSON.stringify(x)]));
    try {
      const res = await api('/api/edit', { messages: wire(), state: S.state, instruction: text });
      S.state = res.state;
      S.itemsNote = res.reply;
      T.editingId = null;
      T.changed = new Set(items().filter((x) => before.get(x.id) !== JSON.stringify(x)).map((x) => x.id));
      const firstChanged = [...T.changed][0];
      const changedCount = T.changed.size;
      $('#edit-input').value = '';
      save();
      track('items_edited');
      renderNote();
      renderItems();
      changedCount && firstChanged && requestAnimationFrame(() => $(`.item[data-id="${firstChanged}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      toast(res.reply, { ms: 5000 });
    } catch (e) {
      toast(e.message, { ms: 5000 });
    } finally {
      T.editBusy = false;
      bar.classList.remove('busy');
      $('#edit-send').disabled = false;
    }
  }

  // ═══════════════════ 상대방 Preview ═══════════════════
  function mountPreview() {
    track('preview_viewed');
    const arr = items();
    $('#pv-to').textContent = toName();
    $('#pv-from').textContent = fromName();
    const common = looseFiles();
    $('#pv-files').hidden = common.length === 0;
    $('#pv-file-list').replaceChildren(...common.map((f) => fileRow(f)));
    $('#pv-lead').textContent = `제안자가 ${arr.length}개의 항목에 대해 협의를 요청했습니다. 항목마다 따로 응답할 수 있어요.`;
    const box = $('#preview-items');
    box.replaceChildren();
    arr.forEach((it, i) => {
      const rows = ITEM_FIELDS.filter(([k]) => it[k]);
      const myFiles = filesOf(it.id);
      const detail = rows.flatMap(([k, label]) => [h('dt', {}, label), h('dd', {}, it[k])]);
      if (myFiles.length) detail.push(h('dt', {}, '첨부'), h('dd', {}, h('ul', { class: 'file-list' }, myFiles.map((f) => fileRow(f)))));
      const item = h(
        'section',
        { class: 'pv-item', 'data-id': it.id },
        h(
          'div',
          { class: 'pv-head' },
          h('div', { class: 'pv-no' }, 'ITEM ' + String(i + 1).padStart(2, '0'), kindBadge(it.kind)),
          h('div', { class: 'pv-title' }, it.title),
          it.headline ? h('div', { class: 'pv-headline' }, it.headline) : null,
          it.issue ? h('p', { class: 'pv-issue' }, it.issue) : null,
        ),
        detail.length
          ? h(
              'button',
              {
                class: 'pv-toggle',
                type: 'button',
                'aria-expanded': 'false',
                onclick: (e) => {
                  const open = item.classList.toggle('open');
                  e.currentTarget.setAttribute('aria-expanded', String(open));
                  e.currentTarget.firstChild.textContent = open ? '상세내용 접기' : '상세내용';
                },
              },
              '상세내용',
              h('svg', { class: 'ic' }),
            )
          : null,
        detail.length ? h('div', { class: 'pv-body' }, h('dl', { class: 'fields' }, detail)) : null,
        h(
          'div',
          { class: 'actions', role: 'group', 'aria-label': `${it.title} 응답` },
          ACTIONS.map(([key, en, ko]) =>
            h('button', { class: 'act' + (S.responses[it.id] === key ? ' on' : ''), type: 'button', 'data-a': key, 'aria-pressed': String(S.responses[it.id] === key), onclick: () => choose(it.id, key) }, h('b', {}, en), h('span', {}, ko)),
          ),
        ),
      );
      // 아이콘(use) 삽입 — h()로 만든 svg는 네임스페이스가 달라 innerHTML 사용
      const tg = item.querySelector('.pv-toggle .ic');
      if (tg) tg.outerHTML = '<svg class="ic"><use href="#i-chev"/></svg>';
      box.append(item);
    });
    renderTally();

    // 링크 전달 안내(시뮬레이션): 제안자 이름과 예시 링크로 "상대방이 받는 메시지"를 보여준다
    const link = 'negotable.example/t/' + S.sid.replace(/^s_/, '').slice(0, 6);
    $('#dl-link').textContent = link;
    $('#dl-url').textContent = 'https://' + link;
    const who = prop().from.trim() || '제안자';
    $('#dl-msg').textContent = `${who}님이 NegoTable로 협의 제안을 보냈어요.\n아래 링크에서 항목별로 확인하고 응답해주세요.`;

    $('#benefit-text').textContent = CFG.benefitText || 'NegoTable 정식 서비스 출시 후 1년 무료 이용 혜택';
    const apply = $('#btn-apply');
    if (CFG.applyUrl) apply.href = CFG.applyUrl;
    else apply.removeAttribute('href');
    $$('#survey-opts button').forEach((b) => {
      const on = S.survey === b.dataset.choice;
      b.setAttribute('aria-checked', String(on));
    });
    $('#survey-thanks').hidden = !S.survey;
    runPhoneMockLoop();
  }

  // 상대방이 링크를 눌러서 여는 순간을 반복 재생 (알림 → AI가 정리 중 → 항목 카드).
  // mountPreview가 다시 호출돼도 타이머가 중복 생성되지 않도록 한 번만 시작한다.
  function runPhoneMockLoop() {
    const states = ['pm-notif', 'pm-loading', 'pm-cards'].map((id) => $('#' + id)).filter(Boolean);
    if (states.length !== 3 || states[0].dataset.running) return;
    states[0].dataset.running = '1';
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      states[2].classList.add('show'); // 정적일 땐 결과(카드) 화면만 보여준다
      return;
    }
    let i = 0;
    const HOLD = [1800, 1400, 2200]; // 알림 · 로딩 · 카드 각 단계가 머무는 시간
    (function step() {
      states.forEach((el, k) => el.classList.toggle('show', k === i));
      setTimeout(() => {
        i = (i + 1) % states.length;
        step();
      }, HOLD[i]);
    })();
  }

  function choose(id, key) {
    const first = Object.keys(S.responses).length === 0;
    S.responses[id] = S.responses[id] === key ? undefined : key;
    if (S.responses[id] === undefined) delete S.responses[id];
    save();
    const box = $(`.pv-item[data-id="${id}"]`);
    $$('.act', box).forEach((b) => {
      const on = S.responses[id] === b.dataset.a;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    renderTally();
    if (first) toast('시뮬레이션이에요. 선택해도 실제로 전송되지 않습니다.');
  }

  function renderTally() {
    const counts = {};
    for (const v of Object.values(S.responses)) counts[v] = (counts[v] || 0) + 1;
    const parts = ACTIONS.filter(([k]) => counts[k]).map(([k, en, ko]) => `${en}(${ko}) ${counts[k]}`);
    const el = $('#pv-tally');
    el.hidden = parts.length === 0;
    el.textContent = parts.length ? '응답 시뮬레이션: ' + parts.join(' · ') : '';
  }

  // ═══════════════════ 이벤트 연결 ═══════════════════
  function restart() {
    if (!confirm('처음부터 다시 시작할까요? 지금까지 만든 내용이 지워집니다.')) return;
    try {
      sessionStorage.removeItem(STORE_KEY);
    } catch {}
    S = fresh();
    Object.assign(T, { busy: null, error: null, editingId: null, changed: new Set(), seen: new Set(), staged: [] });
    location.hash = '#/';
    route();
  }

  function autosize() {
    const el = input();
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 168) + 'px';
  }

  // 랜딩 페이지 15초 영상: 직접 올린 파일이 있으면 그걸 먼저 보여주고, 없으면 유튜브 ID(설정된 경우)를 쓴다.
  // 관리자가 영상을 올리는 방법: /admin-video.html (README 참고)
  //
  // 자체 영상 파일은 "누르기 전까지 아무것도 미리 불러오지 않다가, 누른 순간에만" 재생을 시작한다.
  // 페이지가 iframe 안에서 열리는 경우(Claude 발행 페이지 등) 자동 미리 불러오기가 막혀
  // 로딩이 끝나지 않는 문제가 있었는데, 실제 사용자의 클릭으로만 재생을 시작하면 이 문제를 피할 수 있다.
  function mountShowreel() {
    const frame = $('#showreel-frame');
    if (!frame || frame.dataset.mounted) return;
    if (CFG.videoUrl) {
      frame.dataset.mounted = '1';
      $('#showreel-placeholder')?.remove();
      const poster = h('img', { class: 'showreel-poster', src: CFG.posterUrl || '', alt: '', 'aria-hidden': 'true' });
      const play = h('button', {
        class: 'showreel-play',
        type: 'button',
        'aria-label': '영상 재생',
        onclick: () => {
          const video = h('video', { src: CFG.videoUrl, controls: true, autoplay: true, playsinline: true, muted: false });
          frame.replaceChildren(video);
          video.play?.().catch(() => {});
        },
      });
      play.innerHTML = '<svg class="ic"><use href="#i-play"/></svg>';
      frame.append(poster, play);
      return;
    }
    if (!CFG.demoVideoId) return; // 아무 것도 없으면 "영상 준비 중" 안내를 그대로 둔다.
    frame.dataset.mounted = '1';
    $('#showreel-placeholder')?.remove();
    frame.appendChild(
      h('iframe', {
        src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(CFG.demoVideoId)}?rel=0&modestbranding=1`,
        title: 'NegoTable 소개 영상',
        loading: 'lazy',
        allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
        allowfullscreen: true,
      }),
    );
  }

  function init() {
    mountShowreel();
    $('#cta-start').addEventListener('click', startChat);
    $('#cta-start-2').addEventListener('click', startChat);
    $('#cta-video')?.addEventListener('click', () => $('#showreel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));

    // 대화 입력: 한글 조합 중 Enter는 전송하지 않음, 모바일은 Enter=줄바꿈
    $('#chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input().value.trim();
      if (!v) return void (T.staged.length && toast('첨부와 함께 어떤 자료인지 한 줄 적어주세요.'));
      input().value = '';
      autosize();
      sendUser(v);
    });
    $('#chat-file').addEventListener('change', (e) => {
      T.staged.push(...pickFiles(e.target.files, T.staged.length));
      e.target.value = '';
      renderStaged();
    });
    input().addEventListener('input', autosize);
    input().addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && !isCoarse) {
        e.preventDefault();
        $('#chat-form').requestSubmit();
      }
    });
    $('#privacy-more').addEventListener('click', (e) => {
      const box = $('#privacy');
      const on = box.classList.toggle('expanded');
      e.currentTarget.textContent = on ? '접기' : '더보기';
      e.currentTarget.setAttribute('aria-expanded', String(on));
    });
    $('#panel-toggle').addEventListener('click', () => togglePanel());
    $('#panel-close').addEventListener('click', () => togglePanel(false));

    // ITEM 화면
    $('#add-item').addEventListener('click', addItem);
    $('#pp-to').addEventListener('input', (e) => { prop().to = e.target.value; save(); renderProposal(); });
    $('#pp-from').addEventListener('input', (e) => { prop().from = e.target.value; save(); renderProposal(); });
    $('#btn-preview').addEventListener('click', () => (location.hash = '#/preview'));
    $('#edit-bar').addEventListener('submit', (e) => {
      e.preventDefault();
      reviseByText($('#edit-input').value);
    });
    $('#edit-chips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip) reviseByText(chip.textContent);
    });

    // Preview 화면
    $('#delivery').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ch]');
      if (!b) return;
      const ch = b.dataset.ch;
      track('delivery_' + ch);
      const msg = {
        copy: '예시 링크예요. 실제 링크는 정식 서비스에서 만들어집니다.',
        kakao: '카카오톡으로 링크를 보내는 화면이 열리는 모습이에요. (시뮬레이션 · 실제로 전송되지 않아요)',
        sms: '문자 메시지에 링크가 담겨 열리는 모습이에요. (시뮬레이션 · 실제로 전송되지 않아요)',
        email: '이메일 작성 창에 링크가 담겨 열리는 모습이에요. (시뮬레이션 · 실제로 전송되지 않아요)',
      }[ch];
      toast(msg, { ms: 5000 });
    });
    $('#btn-restart').addEventListener('click', restart);
    $('#btn-pdf').addEventListener('click', () => {
      track('pdf_clicked');
      window.print();
    });
    $('#btn-apply').addEventListener('click', (e) => {
      track('apply_clicked');
      if (!CFG.applyUrl) {
        e.preventDefault();
        toast('신청 페이지를 준비 중이에요. 곧 열릴 예정입니다.');
        console.warn('[NegoTable] applyUrl 이 설정되지 않았습니다. config.js 또는 환경변수 APPLY_URL 을 설정하세요.');
      }
    });
    $('#survey-opts').addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-choice]');
      if (!b) return;
      S.survey = b.dataset.choice;
      save();
      $$('#survey-opts button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      $('#survey-thanks').hidden = false;
      try {
        await api('/api/feedback', { sid: S.sid, choice: S.survey });
      } catch {}
    });

    window.addEventListener('hashchange', route);
    route();
  }

  init();
})();
