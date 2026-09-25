import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chatTurn, createItems, reviseItems, recentChatTimings } from './lib/negotiation.js';
import { LLMError } from './lib/llm.js';
import { createVideoStore, ALLOWED_MIME_TYPES } from './lib/video-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EVENT_TYPES = new Set([
  'landing_view',
  'chat_start',
  'summary_shown',
  'items_generated',
  'items_edited',
  'preview_viewed',
  'pdf_clicked',
  'apply_clicked',
  'delivery_copy',
  'delivery_kakao',
  'delivery_sms',
  'delivery_email',
]);
const SURVEY_CHOICES = new Set(['now', 'depends', 'unsure', 'no']);

/**
 * @param {{llm: Function, config: object, dataDir?: string}} deps
 */
export function createApp({ llm, config, dataDir = path.join(__dirname, 'data') }) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '200kb' }));

  // ── 보안 헤더 (최소) ────────────────────────────────────────
  app.use((_, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // ── 비용 보호: IP별 / 일일 호출 제한 (메모리, 재시작 시 초기화) ─
  const hits = new Map();
  let day = new Date().toDateString();
  let dayCount = 0;
  function limiter(req, res, next) {
    const now = Date.now();
    const today = new Date().toDateString();
    if (today !== day) {
      day = today;
      dayCount = 0;
    }
    if (dayCount >= config.dailyLlmLimit) {
      return res.status(429).json({ error: '오늘 준비한 체험 인원이 모두 찼습니다. 내일 다시 이용해주세요.' });
    }
    const windowMs = 15 * 60 * 1000;
    const arr = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
    if (arr.length >= config.rateLimitPer15Min) {
      return res.status(429).json({ error: '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.' });
    }
    arr.push(now);
    hits.set(req.ip, arr);
    dayCount += 1;
    next();
  }
  setInterval(() => {
    const now = Date.now();
    for (const [ip, arr] of hits) if (!arr.some((t) => now - t < 15 * 60 * 1000)) hits.delete(ip);
  }, 10 * 60 * 1000).unref();

  // ── 이벤트 기록(대화 내용은 저장하지 않습니다) ───────────────
  function record(kind, payload) {
    const line = JSON.stringify({ t: new Date().toISOString(), kind, ...payload });
    console.log('[event]', line);
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.appendFileSync(path.join(dataDir, 'events.jsonl'), line + '\n');
    } catch (e) {
      console.warn('[event] 파일 기록 실패(호스팅 환경에 따라 정상):', e.message);
    }
    if (config.eventWebhookUrl) {
      fetch(config.eventWebhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: line,
      }).catch(() => {});
    }
  }

  // ── API ─────────────────────────────────────────────────────
  const wrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req.body));
    } catch (err) {
      const status = err?.status || (err instanceof LLMError ? err.status : 500);
      if (status >= 500) console.error('[api]', err?.message || err);
      res.status(status).json({
        error: status === 400 || err instanceof LLMError ? err.message : '서버에서 문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
      });
    }
  };

  // 상태 확인: 어떤 AI를 쓰는지, 어떤 코드 버전이 배포됐는지, 최근 대화 턴이 몇 초 걸렸는지(내용은 없음)
  app.get('/api/health', (_, res) =>
    res.json({
      ok: true,
      provider: config.llmProvider || 'anthropic',
      model: config.llmProvider === 'openrouter' ? config.openrouterModel : config.model,
      version: (process.env.RENDER_GIT_COMMIT || process.env.SOURCE_VERSION || '').slice(0, 7) || 'speed-v3',
      recentChats: recentChatTimings(),
    }),
  );
  app.post('/api/chat', limiter, wrap((b) => chatTurn(llm, b)));
  app.post('/api/items', limiter, wrap((b) => createItems(llm, b)));
  app.post('/api/edit', limiter, wrap((b) => reviseItems(llm, b)));

  app.post('/api/event', (req, res) => {
    const { sid, type } = req.body || {};
    if (EVENT_TYPES.has(type) && typeof sid === 'string' && sid.length <= 40) {
      record('funnel', { sid, type });
    }
    res.status(204).end();
  });

  app.post('/api/feedback', (req, res) => {
    const { sid, choice } = req.body || {};
    if (!SURVEY_CHOICES.has(choice) || typeof sid !== 'string' || sid.length > 40) {
      return res.status(400).json({ error: '잘못된 요청입니다.' });
    }
    record('survey', { sid, choice });
    res.json({ ok: true });
  });

  // ── 랜딩 페이지 영상 업로드 (관리자 전용) ──────────────────────
  // 회원가입·로그인이 없는 MVP라, 대신 비밀 토큰(ADMIN_TOKEN) 하나로 막습니다.
  // 토큰을 설정하지 않으면 업로드 기능 자체가 꺼집니다.
  const videoStore = createVideoStore({ dataDir, maxBytes: config.maxVideoMb * 1024 * 1024 });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxVideoMb * 1024 * 1024 + 1024 } });

  function requireAdmin(req, res, next) {
    if (!config.adminToken) {
      return res.status(503).json({ error: '관리자 업로드가 아직 설정되지 않았습니다. 서버에 ADMIN_TOKEN을 설정해주세요.' });
    }
    const given = req.get('x-admin-token') || req.body?.token || req.query?.token;
    if (given !== config.adminToken) {
      return res.status(401).json({ error: '토큰이 올바르지 않습니다.' });
    }
    next();
  }

  app.get('/api/admin/video', requireAdmin, (_, res) => res.json(videoStore.status()));

  app.post('/api/admin/video', requireAdmin, (req, res) => {
    upload.single('video')(req, res, (err) => {
      if (err) {
        const tooBig = err.code === 'LIMIT_FILE_SIZE';
        return res.status(400).json({ error: tooBig ? `영상은 최대 ${config.maxVideoMb}MB까지 올릴 수 있습니다.` : '업로드에 실패했습니다.' });
      }
      if (!req.file) return res.status(400).json({ error: '영상 파일이 없습니다.' });
      if (!ALLOWED_MIME_TYPES.includes(req.file.mimetype)) {
        return res.status(400).json({ error: 'mp4, webm, mov 형식의 영상만 올릴 수 있습니다.' });
      }
      try {
        const url = videoStore.save(req.file);
        record('admin', { kind: 'video_upload', bytes: req.file.size });
        res.json({ ok: true, url });
      } catch (e) {
        res.status(e.status || 500).json({ error: e.message });
      }
    });
  });

  app.delete('/api/admin/video', requireAdmin, (_, res) => {
    const removed = videoStore.clear();
    if (removed) record('admin', { kind: 'video_removed' });
    res.json({ ok: true, removed });
  });

  app.use('/media', express.static(videoStore.dir, { maxAge: '1h', fallthrough: true }));
  app.use('/media', (_, res) => res.status(404).end());

  // 클라이언트 설정 (신청 Google Form 주소 등) — config.js / .env 에서 바꿉니다
  app.get('/config.js', (_, res) => {
    res.type('application/javascript').setHeader('Cache-Control', 'no-store');
    const video = videoStore.status();
    res.send(
      'window.NEGOTABLE_CONFIG = ' +
        JSON.stringify({
          applyUrl: config.applyUrl,
          benefitText: config.benefitText,
          demoVideoId: config.demoVideoId,
          videoUrl: video.exists ? video.url : '',
          posterUrl: video.exists ? config.posterUrl : '',
          maxVideoMb: config.maxVideoMb,
        }) +
        ';',
    );
  });

  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '5m' }));
  app.use('/api', (_, res) => res.status(404).json({ error: 'Not found' }));
  return app;
}
