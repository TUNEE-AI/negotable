// lib/store.js 와 같은 인터페이스. 브라우저 localStorage 에 저장(실패해도 메모리로 동작).
const KEY = 'dbtb-local-db-v1';
const COLLECTIONS = ['projects', 'materials', 'tool_runs', 'prototypes', 'review_sessions', 'conversations', 'custom_skills', 'final_packages', 'external_handoffs'];

export function createBrowserStore() {
  let db = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
  try {
    const loaded = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (loaded) for (const c of COLLECTIONS) db[c] = Array.isArray(loaded[c]) ? loaded[c] : [];
  } catch {}
  // 새로고침으로 끊긴 가공 작업은 실패 처리(재시도 가능)
  for (const r of db.tool_runs) if (r.state === 'queued' || r.state === 'running') Object.assign(r, { state: 'failed', stage: '실패', error: '페이지를 새로 열어 작업이 중단되었습니다.', retryable: true });
  let timer;
  const persist = () => { clearTimeout(timer); timer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} }, 50); };
  const clone = (v) => (v == null ? v : structuredClone(v));
  return {
    list: (col, pred = () => true) => db[col].filter(pred).map(clone),
    get: (col, id) => clone(db[col].find((r) => r.id === id)),
    find: (col, pred) => clone(db[col].find(pred)),
    insert(col, row) { db[col].push(clone(row)); persist(); return clone(row); },
    update(col, id, patch) {
      const i = db[col].findIndex((r) => r.id === id);
      if (i < 0) return null;
      db[col][i] = { ...db[col][i], ...clone(patch), updated_at: new Date().toISOString() };
      persist();
      return clone(db[col][i]);
    },
    remove(col, id) { const n = db[col].length; db[col] = db[col].filter((r) => r.id !== id); persist(); return db[col].length !== n; },
    flush() {},
  };
}
