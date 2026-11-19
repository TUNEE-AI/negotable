// 서버·브라우저 공용 유틸 (Node 20+ 와 브라우저 모두 globalThis.crypto 지원)
export function newId(prefix) {
  const b = new Uint8Array(6);
  globalThis.crypto.getRandomValues(b);
  return `${prefix}_${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class AIError extends Error {
  constructor(message, { status = 502, retryable = false } = {}) {
    super(message);
    this.name = 'AIError';
    this.status = status;
    this.retryable = retryable;
  }
}
