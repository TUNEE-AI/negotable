// ─────────────────────────────────────────────────────────────
// 아주 단순한 JSON 파일 저장소 (MVP용).
// - 컬렉션별 배열을 하나의 JSON 파일에 저장합니다.
// - 쓰기는 임시 파일 → rename 으로 원자적으로 처리합니다.
// - 운영 단계에서는 PostgreSQL 등으로 교체하세요(인터페이스: list/get/insert/update/remove).
// ─────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { newId } from './util.js';

export { newId };

export const COLLECTIONS = [
  'projects',
  'materials',
  'tool_runs',
  'prototypes',
  'review_sessions',
  'conversations',
  'custom_skills',
  'final_packages',
  'external_handoffs',
];

export function createStore(file) {
  let db = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
  if (file && fs.existsSync(file)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const c of COLLECTIONS) db[c] = Array.isArray(loaded[c]) ? loaded[c] : [];
    } catch (err) {
      // Never silently overwrite a damaged database with an empty one.\n      // Stop startup so that the original file can be recovered.\n      throw new Error(`[store] 데이터 파일을 읽지 못했습니다. 원본 보호를 위해 시작을 중단합니다: ${err.message}`, { cause: err });
    }
  }

  let timer = null;
  function persist() {
    if (!file) return;
    clearTimeout(timer);
    timer = setTimeout(flush, 50);
  }
  function flush() {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, file);
  }

  const clone = (v) => (v == null ? v : structuredClone(v));

  return {
    list(col, pred = () => true) {
      return db[col].filter(pred).map(clone);
    },
    get(col, id) {
      return clone(db[col].find((r) => r.id === id));
    },
    find(col, pred) {
      return clone(db[col].find(pred));
    },
    insert(col, row) {
      db[col].push(clone(row));
      persist();
      return clone(row);
    },
    update(col, id, patch) {
      const i = db[col].findIndex((r) => r.id === id);
      if (i < 0) return null;
      db[col][i] = { ...db[col][i], ...clone(patch), updated_at: new Date().toISOString() };
      persist();
      return clone(db[col][i]);
    },
    remove(col, id) {
      const before = db[col].length;
      db[col] = db[col].filter((r) => r.id !== id);
      persist();
      return db[col].length !== before;
    },
    flush,
  };
}
