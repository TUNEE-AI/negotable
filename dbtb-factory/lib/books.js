// ─────────────────────────────────────────────────────────────
// 도서 식별 (PRD 9.1) — 공개 API인 Open Library 검색만 사용합니다.
// 서점 페이지(교보·YES24·알라딘 등)는 자동 수집하지 않습니다.
// 반환하는 것은 서지 정보(제목·저자·출판연도·ISBN)뿐이며 본문은 가져오지 않습니다.
// ─────────────────────────────────────────────────────────────

const OL = 'https://openlibrary.org/search.json';

export async function resolveBook({ title = '', author = '', isbn = '' }, { fetchImpl = fetch, timeoutMs = 6000 } = {}) {
  const q = new URLSearchParams({ limit: '6', fields: 'key,title,author_name,first_publish_year,isbn,publisher,language' });
  if (isbn) q.set('isbn', isbn.replace(/[^0-9Xx]/g, ''));
  else {
    if (title) q.set('title', title);
    if (author) q.set('author', author);
  }
  if (!isbn && !title) return { candidates: [], source: 'none' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${OL}?${q}`, { signal: ctrl.signal, headers: { 'user-agent': 'DBTB-Factory/0.1 (book identification)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const candidates = (data.docs || []).map((d) => ({
      title: d.title,
      author: (d.author_name || []).join(', '),
      year: d.first_publish_year || null,
      isbn: (d.isbn || []).find((x) => x.length === 13) || (d.isbn || [])[0] || '',
      publisher: (d.publisher || [])[0] || '',
      source_url: d.key ? `https://openlibrary.org${d.key}` : '',
    }));
    return { candidates, source: 'openlibrary' };
  } catch (err) {
    // 검색 실패는 치명적이지 않다 — 사용자가 직접 입력한 서지로 계속 진행.
    return { candidates: [], source: 'openlibrary', error: '도서 검색 서비스에 연결하지 못했습니다. 입력한 제목·저자로 그대로 등록할 수 있습니다.' };
  } finally {
    clearTimeout(timer);
  }
}
