// ─────────────────────────────────────────────────────────────
// 랜딩 페이지 영상 업로드 저장소
//
// - 영상 파일 자체는 "showreel.<ext>" 한 개만 유지합니다. 새로 올리면 이전 파일을 지우고 교체합니다.
// - 실제 파일은 dataDir/uploads 아래에 저장하고, /media 경로로 정적 서빙합니다.
// - 무료 호스팅 서비스 다수는 디스크가 재시작·재배포 시 초기화됩니다. 그 경우 영상도 함께
//   사라지므로, 지속 디스크가 아니라면 재배포 후 다시 올려야 할 수 있습니다(README 참고).
// ─────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';

const ALLOWED = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
};

export const ALLOWED_MIME_TYPES = Object.keys(ALLOWED);

export function createVideoStore({ dataDir, publicPath = '/media', maxBytes = 80 * 1024 * 1024 }) {
  const dir = path.join(dataDir, 'uploads');

  function ensureDir() {
    fs.mkdirSync(dir, { recursive: true });
  }

  function currentFile() {
    ensureDir();
    const hit = fs.readdirSync(dir).find((f) => f.startsWith('showreel.'));
    return hit ? path.join(dir, hit) : null;
  }

  function clear() {
    const f = currentFile();
    if (f) fs.unlinkSync(f);
    return Boolean(f);
  }

  /** @param {{mimetype: string, buffer: Buffer, size: number}} file */
  function save(file) {
    const ext = ALLOWED[file.mimetype];
    if (!ext) {
      const err = new Error('mp4, webm, mov 형식의 영상만 올릴 수 있습니다.');
      err.status = 400;
      throw err;
    }
    if (file.size > maxBytes) {
      const err = new Error(`영상은 최대 ${Math.floor(maxBytes / 1024 / 1024)}MB까지 올릴 수 있습니다.`);
      err.status = 400;
      throw err;
    }
    ensureDir();
    clear();
    const dest = path.join(dir, 'showreel' + ext);
    fs.writeFileSync(dest, file.buffer);
    return urlFor(dest);
  }

  function urlFor(filePath) {
    return publicPath + '/' + path.basename(filePath) + '?v=' + fs.statSync(filePath).mtimeMs.toString(36);
  }

  function status() {
    const f = currentFile();
    return f ? { exists: true, url: urlFor(f), mimetype: mimeFromExt(f) } : { exists: false, url: '' };
  }

  function mimeFromExt(f) {
    const ext = path.extname(f);
    return Object.entries(ALLOWED).find(([, e]) => e === ext)?.[0] || 'video/mp4';
  }

  return { dir, save, clear, status, ensureDir };
}
