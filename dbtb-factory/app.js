// ─────────────────────────────────────────────────────────────
// DBTB FACTORY — HTTP API (PRD 10.1)
// ─────────────────────────────────────────────────────────────
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId } from './lib/store.js';
import { TOOLS, LABS, LAB_LIMITS, FORMATS, PROVIDERS, REVIEW_OPTIONS, MATERIAL_TYPES, RIGHTS_STATUS, recommendTools, publicCatalog } from './lib/catalog.js';
import { runTool, labTurn, labSummary, reviewChat, buildPackage } from './lib/engine.js';
import { resolveBook } from './lib/books.js';
import { transition, STATUS_LABELS } from './lib/status.js';
import { AIError } from './lib/ai.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const now = () => new Date().toISOString();
const pad = (n) => String(n).padStart(2, '0');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const LIMITS = { name: 120, goal: 2000, short: 300, excerpt: 50_000, note: 4000, instruction: 6000 };
function text(v, max, field, required = false) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new HttpError(400, `${field}을(를) 입력하세요.`);
  if (s.length > max) throw new HttpError(400, `${field}이(가) 너무 깁니다(최대 ${max.toLocaleString()}자).`);
  return s;
}

// EXT-02 민감정보 감지 — 외부 이관 전 경고용(차단하지 않음)
const SENSITIVE = [
  { re: /\b\d{6}-?[1-4]\d{6}\b/, label: '주민등록번호로 보이는 숫자' },
  { re: /\b01[016789]-?\d{3,4}-?\d{4}\b/, label: '휴대전화 번호' },
  { re: /[\w.+-]+@[\w-]+\.[\w.]+/, label: '이메일 주소' },
  { re: /\b(?:\d{4}[- ]?){3}\d{4}\b/, label: '카드번호로 보이는 숫자' },
  { re: /(비밀번호|password|passwd)\s*[:=]/i, label: '비밀번호' },
];
export function detectSensitive(s) {
  return SENSITIVE.filter((x) => x.re.test(s || '')).map((x) => x.label);
}

export function createApp({ store, ai, config = {} }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const dailyLimit = Number(config.dailyAiLimit ?? process.env.DAILY_AI_LIMIT ?? 300);
  const aiUsage = new Map(); // owner → {day, count}
  function chargeAI(owner) {
    if (ai.mock) return;
    const day = now().slice(0, 10);
    const u = aiUsage.get(owner);
    const cur = u && u.day === day ? u : { day, count: 0 };
    if (cur.count >= dailyLimit) throw new HttpError(429, '오늘의 AI 가공 한도에 도달했습니다. 내일 다시 이용하세요.');
    cur.count += 1;
    aiUsage.set(owner, cur);
  }

  // ── 소유자 식별 (MVP: 브라우저가 만든 익명 ID. 로그인 방식은 PRD 14.1 미확정) ──
  app.use('/api', (req, res, next) => {
    const owner = req.get('x-dbtb-owner') || '';
    if (req.path === '/health' || req.path === '/catalog') return next();
    if (!/^[a-zA-Z0-9_-]{16,64}$/.test(owner)) return res.status(401).json({ error: '사용자 식별값이 없습니다. 페이지를 새로고침하세요.' });
    req.owner = owner;
    next();
  });

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  function ownProject(req, id) {
    const p = store.get('projects', id);
    if (!p || p.user_id !== req.owner) throw new HttpError(404, '프로젝트를 찾을 수 없습니다.');
    return p;
  }
  function setStatus(project, event) {
    const next = transition(project.status, event);
    if (next !== project.status) store.update('projects', project.id, { status: next });
    return next;
  }
  function projectView(p) {
    const count = (col) => store.list(col, (r) => r.project_id === p.id).length;
    return { ...p, status_label: STATUS_LABELS[p.status], counts: { materials: count('materials'), prototypes: count('prototypes'), packages: count('final_packages') } };
  }
  function prototypeView(proto) {
    const existing = new Set(store.list('materials', (m) => m.project_id === proto.project_id).map((m) => m.id));
    const missing = [...new Set((proto.content.evidence || []).map((e) => e.material_id).filter((id) => id && id !== 'user' && !existing.has(id)))];
    return { ...proto, missing_material_ids: missing };
  }
  function savePrototype(project, { parentId, toolRun, toolName, source, content }) {
    const n = store.list('prototypes', (r) => r.project_id === project.id).length + 1;
    const proto = store.insert('prototypes', {
      id: newId('pt'),
      project_id: project.id,
      parent_id: parentId || null,
      version_label: `Prototype ${pad(n)}`,
      version_no: n,
      tool_run_id: toolRun || null,
      tool_name: toolName,
      source, // 'tool' | 'lab' | 'manual'
      content,
      evidence_refs: [...new Set((content.evidence || []).map((e) => e.material_id).filter(Boolean))],
      created_at: now(),
    });
    setStatus(store.get('projects', project.id), 'prototype_saved');
    return proto;
  }

  // ── 기본 ──
  app.get('/api/health', (req, res) => res.json({ ok: true, engine: ai.mock ? 'demo' : 'ai', model: ai.model }));
  app.get('/api/catalog', (req, res) => res.json({ ...publicCatalog(), engine: ai.mock ? 'demo' : 'ai' }));
  app.get('/api/tools', (req, res) => res.json(TOOLS.map(({ keywords, ...t }) => ({ ...t, active: true, version: 1 }))));

  // ── 프로젝트 ──
  app.get('/api/projects', (req, res) => {
    res.json(store.list('projects', (p) => p.user_id === req.owner).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(projectView));
  });
  app.post('/api/projects', (req, res) => {
    const b = req.body || {};
    const project = {
      id: newId('pj'),
      user_id: req.owner,
      name: text(b.name, LIMITS.name, '프로젝트명', true),
      goal: text(b.goal, LIMITS.goal, '목표', true),
      audience: text(b.audience, LIMITS.short, '주 대상'),
      expected: text(b.expected, LIMITS.short, '최종 얻고 싶은 것'),
      status: 'DRAFT',
      created_at: now(),
    };
    project.status = transition(project.status, 'project_defined');
    store.insert('projects', project);
    res.status(201).json(projectView(project));
  });
  app.get('/api/projects/:id', (req, res) => res.json(projectView(ownProject(req, req.params.id))));
  app.patch('/api/projects/:id', (req, res) => {
    const p = ownProject(req, req.params.id);
    const b = req.body || {};
    const patch = {};
    if ('name' in b) patch.name = text(b.name, LIMITS.name, '프로젝트명', true);
    if ('goal' in b) patch.goal = text(b.goal, LIMITS.goal, '목표', true);
    if ('audience' in b) patch.audience = text(b.audience, LIMITS.short, '주 대상');
    if ('expected' in b) patch.expected = text(b.expected, LIMITS.short, '최종 얻고 싶은 것');
    res.json(projectView(store.update('projects', p.id, patch)));
  });
  app.delete('/api/projects/:id', (req, res) => {
    const p = ownProject(req, req.params.id);
    for (const col of ['materials', 'tool_runs', 'prototypes', 'review_sessions', 'conversations', 'final_packages']) {
      for (const r of store.list(col, (x) => x.project_id === p.id)) store.remove(col, r.id);
    }
    store.remove('projects', p.id);
    res.json({ ok: true });
  });
  app.get('/api/projects/:id/recommendations', (req, res) => {
    const p = ownProject(req, req.params.id);
    res.json({ tool_ids: recommendTools(p, store.list('materials', (m) => m.project_id === p.id)) });
  });

  // ── 원재료 ──
  app.get('/api/projects/:id/materials', (req, res) => {
    const p = ownProject(req, req.params.id);
    res.json(store.list('materials', (m) => m.project_id === p.id));
  });
  app.post('/api/projects/:id/materials', (req, res) => {
    const p = ownProject(req, req.params.id);
    const b = req.body || {};
    if (!MATERIAL_TYPES[b.type]) throw new HttpError(400, '원재료 종류가 올바르지 않습니다.');
    const rights = RIGHTS_STATUS[b.rights_status] ? b.rights_status : 'unknown';
    if (b.type === 'ebook' && !b.rights_ack) throw new HttpError(400, '전자책은 본인이 권리를 가졌거나 개인 사용 권한이 있는지 확인해야 합니다.');
    const uri = text(b.uri, 1000, '링크');
    if (uri && !/^https?:\/\//i.test(uri)) throw new HttpError(400, '링크는 http(s):// 로 시작해야 합니다.');
    const m = store.insert('materials', {
      id: newId('mt'),
      project_id: p.id,
      type: b.type,
      title: text(b.title, LIMITS.short, '제목', true),
      author: text(b.author, LIMITS.short, '저자/출처'),
      isbn: text(b.isbn, 40, 'ISBN'),
      doi: text(b.doi, 200, 'DOI'),
      genre: text(b.genre, 60, '장르'),
      uri,
      file_ref: b.file_name ? { name: text(b.file_name, 255, '파일명'), size: Number(b.file_size) || 0, text_extracted: Boolean(b.excerpt) } : null,
      excerpt: text(b.excerpt, LIMITS.excerpt, '발췌/본문'),
      note: text(b.note, LIMITS.note, '메모'),
      rights_status: rights,
      source_metadata: b.source_metadata && typeof b.source_metadata === 'object' ? { source: String(b.source_metadata.source || '').slice(0, 40), source_url: String(b.source_metadata.source_url || '').slice(0, 500), year: b.source_metadata.year || null, publisher: String(b.source_metadata.publisher || '').slice(0, 200) } : null,
      analysis_mode: b.excerpt ? 'text_provided' : 'public_info_only',
      created_at: now(),
    });
    setStatus(p, 'material_added');
    res.status(201).json(m);
  });
  app.delete('/api/materials/:id', (req, res) => {
    const m = store.get('materials', req.params.id);
    if (!m) throw new HttpError(404, '원재료를 찾을 수 없습니다.');
    ownProject(req, m.project_id);
    store.remove('materials', m.id);
    res.json({ ok: true, note: '기존 프로토타입은 보존되며, 근거 자료가 삭제되었다고 표시됩니다.' });
  });
  app.post('/api/materials/books/resolve', wrap(async (req, res) => {
    const b = req.body || {};
    res.json(await resolveBook({ title: text(b.title, 300, '제목'), author: text(b.author, 300, '저자'), isbn: text(b.isbn, 40, 'ISBN') }, { fetchImpl: config.fetchImpl || fetch }));
  }));

  // ── 가공 실행 (비동기 작업 + 상태 조회) ──
  const runningKeys = new Set();
  app.post('/api/projects/:id/runs', (req, res) => {
    const p = ownProject(req, req.params.id);
    const b = req.body || {};
    const tool = TOOLS.find((t) => t.id === b.tool_id);
    if (!tool) throw new HttpError(400, '가공설비를 선택하세요.');
    const key = text(b.idempotency_key, 100, 'idempotency_key') || newId('ik');

    // 재시도 시 같은 키 → 같은 작업 (중복 청구·중복 버전 방지)
    const dup = store.find('tool_runs', (r) => r.project_id === p.id && r.idempotency_key === key);
    if (dup) return res.status(200).json(dup);

    const source = b.source_prototype_id ? store.get('prototypes', b.source_prototype_id) : null;
    if (b.source_prototype_id && (!source || source.project_id !== p.id)) throw new HttpError(400, '기준 프로토타입을 찾을 수 없습니다.');

    const lockKey = `${p.id}:${tool.id}:${source?.id || ''}`;
    if (runningKeys.has(lockKey)) {
      const busy = store.find('tool_runs', (r) => r.project_id === p.id && r.tool_id === tool.id && ['queued', 'running'].includes(r.state));
      return res.status(409).json({ error: '같은 가공이 이미 진행 중입니다.', run: busy });
    }

    const allMats = store.list('materials', (m) => m.project_id === p.id);
    const ids = Array.isArray(b.material_ids) ? b.material_ids : allMats.map((m) => m.id);
    const mats = allMats.filter((m) => ids.includes(m.id));
    chargeAI(req.owner);

    const run = store.insert('tool_runs', {
      id: newId('run'),
      project_id: p.id,
      tool_id: tool.id,
      tool_name: tool.name,
      input_material_ids: mats.map((m) => m.id),
      source_prototype_id: source?.id || null,
      tool_config: { focus: text(b.config?.focus, 500, '집중 관점') },
      idempotency_key: key,
      state: 'queued',
      stage: '접수',
      cost: null,
      created_at: now(),
      started_at: null,
      finished_at: null,
    });
    if (source) setStatus(p, 'reprocess_chosen');

    runningKeys.add(lockKey);
    (async () => {
      store.update('tool_runs', run.id, { state: 'running', stage: 'AI 가공 중', started_at: now() });
      try {
        const out = await runTool(ai, { tool, project: p, materials: mats, sourcePrototype: source, config: run.tool_config });
        const proto = savePrototype(p, { parentId: source?.id, toolRun: run.id, toolName: tool.name, source: 'tool', content: { ...out.data, tool_id: tool.id, engine: ai.mock ? 'demo' : 'ai' } });
        store.update('tool_runs', run.id, { state: 'succeeded', stage: '완료', prototype_id: proto.id, cost: out.usage, finished_at: now() });
      } catch (err) {
        console.error(`[run] ${run.id} 실패: ${err.message}`);
        store.update('tool_runs', run.id, { state: 'failed', stage: '실패', error: err instanceof AIError ? err.message : '가공 중 오류가 발생했습니다.', retryable: err instanceof AIError ? err.retryable : true, finished_at: now() });
      } finally {
        runningKeys.delete(lockKey);
      }
    })();
    res.status(202).json(run);
  });
  app.get('/api/runs/:id', (req, res) => {
    const r = store.get('tool_runs', req.params.id);
    if (!r) throw new HttpError(404, '작업을 찾을 수 없습니다.');
    ownProject(req, r.project_id);
    res.json(r);
  });
  app.get('/api/projects/:id/runs', (req, res) => {
    const p = ownProject(req, req.params.id);
    res.json(store.list('tool_runs', (r) => r.project_id === p.id));
  });

  // ── 프로토타입 (불변) ──
  app.get('/api/projects/:id/prototypes', (req, res) => {
    const p = ownProject(req, req.params.id);
    res.json(store.list('prototypes', (r) => r.project_id === p.id).sort((a, b) => a.version_no - b.version_no).map(prototypeView));
  });
  app.get('/api/prototypes/:id', (req, res) => {
    const pt = store.get('prototypes', req.params.id);
    if (!pt) throw new HttpError(404, '프로토타입을 찾을 수 없습니다.');
    ownProject(req, pt.project_id);
    res.json(prototypeView(pt));
  });
  app.post('/api/projects/:id/prototypes', (req, res) => {
    // 수동 저장: 기존 프로토타입을 부모로 하여 메모·수정본을 새 버전으로 만든다(기존 버전은 그대로).
    const p = ownProject(req, req.params.id);
    const b = req.body || {};
    const parent = b.parent_id ? store.get('prototypes', b.parent_id) : null;
    if (b.parent_id && (!parent || parent.project_id !== p.id)) throw new HttpError(400, '부모 프로토타입을 찾을 수 없습니다.');
    const note = text(b.note, LIMITS.note, '메모', true);
    const base = parent?.content || { title: p.name, summary: '', sections: [], evidence: [], interpretations: [], assumptions: [], recommendations: [] };
    const content = { ...structuredClone(base), title: text(b.title, LIMITS.short, '제목') || base.title, summary: `${base.summary}\n\n[사용자 수정 메모] ${note}`.trim(), changes_from_parent: `사용자 수정: ${note}`, evidence: [...(base.evidence || []), { statement: note, material_id: 'user', layer: 'user_input' }] };
    res.status(201).json(savePrototype(p, { parentId: parent?.id, toolName: '수동 저장', source: 'manual', content }));
  });

  // ── 공장장 검수실 ──
  app.post('/api/review-sessions', (req, res) => {
    const b = req.body || {};
    const pt = store.get('prototypes', b.prototype_id);
    if (!pt) throw new HttpError(404, '프로토타입을 찾을 수 없습니다.');
    const p = ownProject(req, pt.project_id);
    const existing = store.find('review_sessions', (s) => s.prototype_id === pt.id);
    if (existing) return res.json({ ...existing, options: REVIEW_OPTIONS });
    const s = store.insert('review_sessions', { id: newId('rv'), project_id: p.id, prototype_id: pt.id, chosen_direction: null, chat: [], created_at: now() });
    res.status(201).json({ ...s, options: REVIEW_OPTIONS });
  });
  function ownSession(req) {
    const s = store.get('review_sessions', req.params.id);
    if (!s) throw new HttpError(404, '검수 세션을 찾을 수 없습니다.');
    return { s, p: ownProject(req, s.project_id) };
  }
  app.post('/api/review-sessions/:id/choose', (req, res) => {
    const { s, p } = ownSession(req);
    const opt = REVIEW_OPTIONS.find((o) => o.id === req.body?.option_id);
    if (!opt) throw new HttpError(400, '선택지를 고르세요.');
    store.update('review_sessions', s.id, { chosen_direction: opt.id, chosen_at: now() });
    setStatus(p, 'review_done');
    if (opt.id === 'finalize') setStatus(store.get('projects', p.id), 'finalize_chosen');
    res.json({ ok: true, next: opt.next, option: opt, project: projectView(store.get('projects', p.id)) });
  });
  app.post('/api/review-sessions/:id/messages', wrap(async (req, res) => {
    const { s, p } = ownSession(req);
    const t = text(req.body?.text, 2000, '메시지', true);
    if (s.chat.length >= 40) throw new HttpError(429, '대화가 길어졌습니다. 객관식으로 다음 공정을 선택하세요.');
    chargeAI(req.owner);
    const out = await reviewChat(ai, { project: p, prototype: store.get('prototypes', s.prototype_id), history: s.chat, userText: t });
    const chat = [...s.chat, { role: 'user', text: t, at: now() }, { role: 'manager', text: out.data.reply, suggested_option: out.data.suggested_option, at: now() }];
    store.update('review_sessions', s.id, { chat });
    res.json({ chat, suggested_option: out.data.suggested_option });
  }));

  // ── 특별 사고 실험실 ──
  function ownConversation(req) {
    const c = store.get('conversations', req.params.id);
    if (!c) throw new HttpError(404, '토론을 찾을 수 없습니다.');
    return { c, p: ownProject(req, c.project_id) };
  }
  const busyConvs = new Set();
  async function advanceConversation(c, p, userText) {
    if (busyConvs.has(c.id)) throw new HttpError(409, '참가자들이 아직 발언 중입니다.');
    busyConvs.add(c.id);
    try {
      const mats = store.list('materials', (m) => m.project_id === p.id);
      const out = await labTurn(ai, { conversation: c, project: p, materials: mats, userText, limit: LAB_LIMITS.maxHistoryMessages });
      const added = out.data.messages.map((m) => ({ ...m, id: newId('msg'), at: now() }));
      const tokens = (c.usage?.tokens || 0) + (out.usage?.input_tokens || 0) + (out.usage?.output_tokens || 0);
      return store.update('conversations', c.id, { messages: [...c.messages, ...added], usage: { tokens } });
    } finally {
      busyConvs.delete(c.id);
    }
  }
  app.post('/api/conversations', wrap(async (req, res) => {
    const b = req.body || {};
    const lab = LABS[b.lab_id];
    if (!lab) throw new HttpError(400, '실험실을 선택하세요.');
    const p = ownProject(req, b.project_id);
    let participants = lab.participants;
    if (lab.id === 'celeb') {
      const names = (Array.isArray(b.personas) ? b.personas : []).map((n) => text(n, 40, '인물 이름')).filter(Boolean).slice(0, 5);
      if (names.length < 2) throw new HttpError(400, '관점 캐릭터를 2명 이상 고르세요.');
      participants = names.map((n, i) => ({ id: `c${i + 1}`, name: `${n}(추정 관점)`, role: `${n}의 공개적으로 알려진 사상·스타일을 바탕으로 한 가상 캐릭터` }));
    }
    const source = b.source_prototype_id ? store.get('prototypes', b.source_prototype_id) : null;
    if (source && source.project_id !== p.id) throw new HttpError(400, '기준 프로토타입이 이 프로젝트에 없습니다.');
    chargeAI(req.owner);
    const c = store.insert('conversations', {
      id: newId('cv'),
      project_id: p.id,
      lab_id: lab.id,
      topic: text(b.topic, 500, '토론 주제') || p.goal,
      participants,
      source_prototype_id: source?.id || null,
      source_prototype: source ? { version_label: source.version_label, content: source.content } : null,
      messages: [],
      state: 'active',
      disclaimer: lab.disclaimer,
      created_at: now(),
    });
    try {
      res.status(201).json(await advanceConversation(c, p, b.pitch ? text(b.pitch, 4000, '피칭') : ''));
    } catch (err) {
      // 첫 발언 실패 시에도 토론방은 남긴다 — 사용자가 다시 시도할 수 있게.
      if (err instanceof AIError) return res.status(err.status).json({ error: err.message, conversation: store.get('conversations', c.id) });
      throw err;
    }
  }));
  app.get('/api/projects/:id/conversations', (req, res) => {
    const p = ownProject(req, req.params.id);
    res.json(store.list('conversations', (c) => c.project_id === p.id));
  });
  app.get('/api/conversations/:id', (req, res) => res.json(ownConversation(req).c));
  app.post('/api/conversations/:id/messages', wrap(async (req, res) => {
    const { c, p } = ownConversation(req);
    if (c.state !== 'active') throw new HttpError(409, '종료된 토론입니다.');
    const userTurns = c.messages.filter((m) => m.speaker_id === 'user').length;
    if (userTurns >= LAB_LIMITS.maxUserTurns) throw new HttpError(429, `발언 한도(${LAB_LIMITS.maxUserTurns}회)에 도달했습니다. 요약 리포트를 만들어 프로토타입으로 저장하세요.`);
    const t = text(req.body?.text, 4000, '발언');
    chargeAI(req.owner);
    let conv = c;
    if (t) conv = store.update('conversations', c.id, { messages: [...c.messages, { id: newId('msg'), speaker_id: 'user', text: t, replies_to: '', at: now() }] });
    res.json(await advanceConversation(conv, p, t));
  }));
  app.post('/api/conversations/:id/summary', wrap(async (req, res) => {
    const { c, p } = ownConversation(req);
    if (c.summary_prototype_id) return res.json({ conversation: c, prototype: prototypeView(store.get('prototypes', c.summary_prototype_id)) });
    if (!c.messages.length) throw new HttpError(400, '요약할 발언이 없습니다.');
    chargeAI(req.owner);
    const out = await labSummary(ai, { conversation: c, project: p });
    const d = out.data;
    const lab = LABS[c.lab_id];
    const content = {
      title: d.title,
      summary: d.summary,
      sections: [
        { heading: '핵심 논점', bullets: d.key_points },
        { heading: '위험', bullets: d.risks },
        { heading: '개선 방향', bullets: d.improvements },
        { heading: '열린 질문', bullets: d.open_questions },
      ],
      evidence: c.messages.filter((m) => m.speaker_id === 'user').slice(0, 8).map((m) => ({ statement: m.text.slice(0, 300), material_id: 'user', layer: 'user_input' })),
      interpretations: d.key_points,
      assumptions: [lab.disclaimer, ...d.open_questions.map((q) => `검증 필요: ${q}`)],
      recommendations: d.improvements.map((x, i) => ({ action: x, priority: i === 0 ? 'high' : 'medium', rationale: `${lab.name}에서 도출` })),
      changes_from_parent: c.source_prototype ? `${c.source_prototype.version_label}을 ${lab.name}에서 재검증` : `${lab.name} 결과`,
      assumption_based: true,
      lab_id: c.lab_id,
      simulated: c.lab_id === 'celeb',
      engine: ai.mock ? 'demo' : 'ai',
    };
    const proto = savePrototype(p, { parentId: c.source_prototype_id, toolName: lab.name, source: 'lab', content });
    const conv = store.update('conversations', c.id, { state: 'ended', summary_prototype_id: proto.id, ended_at: now() });
    res.json({ conversation: conv, prototype: prototypeView(proto) });
  }));
  app.post('/api/conversations/:id/end', (req, res) => {
    const { c } = ownConversation(req);
    res.json(store.update('conversations', c.id, { state: 'ended', ended_at: now() }));
  });

  // ── 나의 공구실 (개인 마무리 스킬) ──
  function skillBody(b) {
    return {
      name: text(b.name, 80, '공구 이름', true),
      instruction: text(b.instruction, LIMITS.instruction, '지시문', true),
      output_rules: text(b.output_rules, LIMITS.instruction, '출력 규칙'),
      tone: text(b.tone, 100, '문체'),
      audience: text(b.audience, 200, '독자'),
      length: text(b.length, 100, '분량'),
      criteria: text(b.criteria, 1000, '검증 기준'),
    };
  }
  function composeSkill(s) {
    const extra = [s.tone && `문체: ${s.tone}`, s.audience && `독자: ${s.audience}`, s.length && `분량: ${s.length}`, s.criteria && `검증 기준: ${s.criteria}`].filter(Boolean).join('\n');
    return { ...s, instruction: [s.instruction, extra].filter(Boolean).join('\n') };
  }
  app.get('/api/custom-skills', (req, res) => res.json(store.list('custom_skills', (s) => s.user_id === req.owner)));
  app.post('/api/custom-skills', (req, res) => {
    res.status(201).json(store.insert('custom_skills', { id: newId('sk'), user_id: req.owner, ...skillBody(req.body || {}), version: 1, created_at: now() }));
  });
  function ownSkill(req, id) {
    const s = store.get('custom_skills', id);
    if (!s || s.user_id !== req.owner) throw new HttpError(404, '공구를 찾을 수 없습니다.');
    return s;
  }
  app.put('/api/custom-skills/:id', (req, res) => {
    const s = ownSkill(req, req.params.id);
    res.json(store.update('custom_skills', s.id, { ...skillBody(req.body || {}), version: s.version + 1 }));
  });
  app.delete('/api/custom-skills/:id', (req, res) => {
    const s = ownSkill(req, req.params.id);
    store.remove('custom_skills', s.id);
    res.json({ ok: true });
  });
  app.post('/api/custom-skills/:id/test', wrap(async (req, res) => {
    // 테스트: 저장하지 않는 미리보기 패키지(문서 형식)
    const s = ownSkill(req, req.params.id);
    const pt = store.get('prototypes', req.body?.prototype_id);
    if (!pt) throw new HttpError(400, '테스트할 프로토타입을 고르세요.');
    const p = ownProject(req, pt.project_id);
    chargeAI(req.owner);
    const out = await buildPackage(ai, { project: p, prototype: pt, skill: composeSkill(s), format: 'doc', finalName: `[테스트] ${p.name}`, materials: store.list('materials', (m) => m.project_id === p.id) });
    res.json({ preview: out.data, saved: false });
  }));

  // ── 최종 조립 → 창고 ──
  const packageLocks = new Map();
  app.post('/api/final-packages', wrap(async (req, res) => {
    const b = req.body || {};
    const pt = store.get('prototypes', b.prototype_id);
    if (!pt) throw new HttpError(400, '프로토타입을 선택하세요.');
    const p = ownProject(req, pt.project_id);
    if (!FORMATS[b.format]) throw new HttpError(400, '출력 형식을 선택하세요.');
    const finalName = text(b.final_name, LIMITS.name, '최종 아이템명', true);
    const key = text(b.idempotency_key, 100, 'idempotency_key');
    if (key) {
      const dup = store.find('final_packages', (f) => f.project_id === p.id && f.idempotency_key === key);
      if (dup) return res.json(dup);
      if (packageLocks.has(key)) throw new HttpError(409, '패키지를 이미 만드는 중입니다.');
    }
    const skill = b.custom_skill_id ? ownSkill(req, b.custom_skill_id) : null;
    const materials = store.list('materials', (m) => m.project_id === p.id);
    chargeAI(req.owner);
    if (key) packageLocks.set(key, true);
    try {
      const out = await buildPackage(ai, { project: p, prototype: pt, skill: skill ? composeSkill(skill) : null, format: b.format, finalName, materials });
      // 버전 계보(사용 설비 체인)
      const lineage = [];
      for (let cur = pt; cur; cur = cur.parent_id ? store.get('prototypes', cur.parent_id) : null) lineage.unshift({ id: cur.id, version_label: cur.version_label, tool_name: cur.tool_name });
      const pkg = {
        ...out.data,
        format: b.format,
        format_label: FORMATS[b.format].label,
        evidence: pt.content.evidence || [],
        assumptions: pt.content.assumptions || [],
        sources: materials.map((m) => ({ id: m.id, type: m.type, type_label: MATERIAL_TYPES[m.type].label, title: m.title, author: m.author, uri: m.uri, isbn: m.isbn, doi: m.doi, rights_status: m.rights_status, analysis_mode: m.analysis_mode })),
        lineage,
        engine: ai.mock ? 'demo' : 'ai',
      };
      pkg.sensitive_warnings = detectSensitive(`${pkg.human_document}\n${pkg.production_prompt}`);
      const fp = store.insert('final_packages', {
        id: newId('fp'),
        project_id: p.id,
        project_name: p.name,
        prototype_id: pt.id,
        prototype_label: pt.version_label,
        custom_skill_id: skill?.id || null,
        // DATA-04: 스킬 스냅샷 — 이후 스킬을 고쳐도 이 패키지는 바뀌지 않는다.
        custom_skill_snapshot: skill ? { name: skill.name, version: skill.version, instruction: skill.instruction, output_rules: skill.output_rules } : null,
        final_name: finalName,
        format: b.format,
        package: pkg,
        idempotency_key: key || null,
        cost: out.usage,
        created_at: now(),
      });
      setStatus(store.get('projects', p.id), 'package_saved');
      res.status(201).json(fp);
    } finally {
      if (key) packageLocks.delete(key);
    }
  }));
  function ownPackage(req) {
    const fp = store.get('final_packages', req.params.id);
    if (!fp) throw new HttpError(404, '완제품을 찾을 수 없습니다.');
    ownProject(req, fp.project_id);
    return fp;
  }
  app.get('/api/warehouse', (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const projectIds = new Set(store.list('projects', (p) => p.user_id === req.owner).map((p) => p.id));
    const items = store
      .list('final_packages', (f) => projectIds.has(f.project_id))
      .filter((f) => !q || `${f.final_name} ${f.project_name} ${f.package.format_label}`.toLowerCase().includes(q))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(({ package: pkg, ...f }) => ({ ...f, format_label: pkg.format_label, source_count: pkg.sources.length, sensitive_warnings: pkg.sensitive_warnings }));
    res.json(items);
  });
  app.get('/api/final-packages/:id', (req, res) => res.json(ownPackage(req)));
  app.get('/api/final-packages/:id/download', (req, res) => {
    const fp = ownPackage(req);
    const md = packageMarkdown(fp);
    const fname = `${fp.final_name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'dbtb-package'}.md`;
    res.set('content-type', 'text/markdown; charset=utf-8');
    res.set('content-disposition', `attachment; filename="dbtb-package.md"; filename*=UTF-8''${encodeURIComponent(fname)}`);
    res.send(md);
  });
  app.post('/api/external-handoffs', (req, res) => {
    const b = req.body || {};
    const fp = store.get('final_packages', b.final_package_id);
    if (!fp) throw new HttpError(404, '완제품을 찾을 수 없습니다.');
    const p = ownProject(req, fp.project_id);
    const provider = PROVIDERS.find((x) => x.id === b.provider);
    if (!provider) throw new HttpError(400, '외부 서비스를 선택하세요.');
    const ack = b.rights_ack || {};
    if (!ack.rights || !ack.sensitive) throw new HttpError(400, '자료 권리와 민감정보 확인 단계를 완료해야 합니다.');
    const h = store.insert('external_handoffs', { id: newId('ho'), final_package_id: fp.id, project_id: p.id, provider: provider.id, method: ['copy', 'download', 'open'].includes(b.method) ? b.method : 'open', visibility: ['public', 'private'].includes(ack.visibility) ? ack.visibility : 'private', opened_at: now() });
    setStatus(p, 'handoff');
    res.status(201).json({ handoff: h, url: provider.url });
  });

  // ── 관찰성: 간단 지표 (PRD 13) ──
  app.get('/api/metrics', (req, res) => {
    const projects = store.list('projects', (p) => p.user_id === req.owner);
    const ids = new Set(projects.map((p) => p.id));
    const runs = store.list('tool_runs', (r) => ids.has(r.project_id));
    const protos = store.list('prototypes', (r) => ids.has(r.project_id));
    const done = runs.filter((r) => r.state === 'succeeded');
    res.json({
      projects: projects.length,
      runs: runs.length,
      run_success_rate: (() => {
        const finished = runs.filter((r) => ['succeeded', 'failed'].includes(r.state)).length;
        return finished ? done.length / finished : null;
      })(),
      avg_run_ms: done.length ? Math.round(done.reduce((s, r) => s + (Date.parse(r.finished_at) - Date.parse(r.started_at)), 0) / done.length) : null,
      tokens: runs.reduce((s, r) => s + (r.cost?.input_tokens || 0) + (r.cost?.output_tokens || 0), 0),
      prototypes: protos.length,
      reprocessed_projects: new Set(protos.filter((x) => x.parent_id).map((x) => x.project_id)).size,
      packages: store.list('final_packages', (f) => ids.has(f.project_id)).length,
      handoffs: store.list('external_handoffs', (h) => ids.has(h.project_id)).length,
    });
  });

  // ── 정적 파일 ──
  app.use(express.static(path.join(here, 'public'), { extensions: ['html'] }));
  app.use('/api', (req, res) => res.status(404).json({ error: '없는 API입니다.' }));
  app.get('*', (req, res) => res.sendFile(path.join(here, 'public', 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: '입력이 너무 큽니다.' });
    if (err instanceof HttpError || err instanceof AIError) return res.status(err.status).json({ error: err.message, retryable: err.retryable || false });
    console.error('[error]', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  });

  return app;
}

export function packageMarkdown(fp) {
  const k = fp.package;
  const L = { confirmed: '출처 확인', author_claim: '저자 주장', user_input: '사용자 제공' };
  return [
    `# ${fp.final_name}`,
    `> DBTB FACTORY 최종 설계 패키지 · ${k.format_label} · 기준 ${fp.prototype_label} · ${fp.created_at.slice(0, 16).replace('T', ' ')}`,
    k.engine === 'demo' ? '> ⚠️ 데모 엔진으로 생성된 구조 예시입니다.' : '',
    '',
    k.human_document,
    '',
    `## 구성 (${k.format_label})`,
    ...k.outline.map((o) => `### ${o.title}\n${o.content}`),
    '',
    '## 외부 AI 제작 지시문',
    '```',
    k.production_prompt,
    '```',
    '',
    '## 근거 (확인된 자료·사용자 제공)',
    ...(k.evidence.length ? k.evidence.map((e) => `- [${L[e.layer] || e.layer}] ${e.statement}`) : ['- (없음)']),
    '',
    '## 가설 / 검증 필요',
    ...(k.assumptions.length ? k.assumptions.map((a) => `- ${a}`) : ['- (없음)']),
    '',
    '## 원재료 출처',
    ...(k.sources.length ? k.sources.map((s) => `- [${s.type_label}] ${s.title}${s.author ? ` — ${s.author}` : ''}${s.uri ? ` (${s.uri})` : ''} · 권리: ${RIGHTS_STATUS[s.rights_status]} · ${s.analysis_mode === 'public_info_only' ? '공개자료 기반 관점 분석' : '제공 텍스트 분석'}`) : ['- (없음)']),
    '',
    '## 가공 이력',
    ...k.lineage.map((l) => `- ${l.version_label}: ${l.tool_name}`),
    fp.custom_skill_snapshot ? `\n## 적용한 개인 스킬\n- ${fp.custom_skill_snapshot.name} (v${fp.custom_skill_snapshot.version})` : '',
    '',
    '## 제작 후 검토 체크리스트',
    ...k.review_checklist.map((c) => `- [ ] ${c}`),
    '',
    '---',
    '원문 재배포 금지. DBTB는 외부 AI 서비스의 제작 결과를 보장하지 않습니다.',
  ].join('\n');
}
