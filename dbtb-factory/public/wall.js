// ─────────────────────────────────────────────────────────────
// 첫 화면 벽: 낡은 붉은 벽돌 + 오른쪽(좁은 화면은 아래) 갈라진 회벽을 캔버스로 직접 그린다.
// 브랜드는 벽돌 위에 페인트로, 설명은 회벽 위에 붓글씨 페인트로 칠한다.
// (외부 사진 없이 매번 같은 모양: 시드 고정 난수)
// ─────────────────────────────────────────────────────────────

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const BRICKS = ['#7d3f30', '#8a4a37', '#6e3729', '#94563f', '#5f3226', '#834635', '#a0624a', '#73402f', '#6a3324'];

export async function paintWall(canvas, { brand = ["DON'T BUY", 'THE BOOK'], sub = 'KNOWLEDGE ONTOLOGY FACTORY', notes = [] } = {}) {
  try {
    await Promise.all([
      document.fonts.load('100px "Alfa Slab One"'),
      document.fonts.load('40px "Nanum Brush Script"'),
    ]);
  } catch {}
  const W = Math.max(320, Math.round(canvas.clientWidth || canvas.parentElement.clientWidth));
  const narrow = W < 720;
  const brickH = narrow ? Math.round(W * 0.62) : Math.round(Math.min(Math.max(W * 0.42, 380), 600));
  const noteFs = Math.min(42, W / 9.5);
  const H = narrow ? brickH + Math.round(48 + Math.max(1, notes.length) * noteFs * 1.3 + 28) : brickH;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.height = `${H}px`;
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const r = rng(20261119);

  // ── 벽돌 ──
  const bh = Math.max(14, Math.round((narrow ? W : W * 0.7) / 34)); // 벽돌 높이
  const bw = bh * 2.25;
  const m = Math.max(2, Math.round(bh * 0.16)); // 줄눈
  g.fillStyle = '#a89a86';
  g.fillRect(0, 0, W, H);
  // 줄눈 얼룩
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '60,48,40' : '210,200,185'},${0.05 + r() * 0.08})`; g.fillRect(r() * W, r() * H, 2 + r() * 30, 1 + r() * 4); }
  for (let row = 0, y = 0; y < H; row++, y += bh) {
    const off = row % 2 ? -bw / 2 : -r() * 4;
    for (let x = off; x < W; x += bw) {
      const w = bw - m, h = bh - m;
      const bx = x + m / 2 + (r() - 0.5) * 1.2, by = y + m / 2 + (r() - 0.5) * 1.2;
      g.fillStyle = BRICKS[Math.floor(r() * BRICKS.length)];
      g.fillRect(bx, by, w, h);
      // 표면 결
      for (let k = 0; k < 18; k++) { g.fillStyle = r() < 0.5 ? `rgba(30,12,8,${0.08 + r() * 0.14})` : `rgba(255,220,190,${0.04 + r() * 0.08})`; g.fillRect(bx + r() * w, by + r() * h, 1 + r() * 5, 1 + r() * 2); }
      // 남은 흰 석회(회칠 자국)
      if (r() < 0.16) { g.fillStyle = `rgba(215,205,188,${0.08 + r() * 0.18})`; for (let q = 0; q < 6; q++) { g.beginPath(); g.ellipse(bx + r() * w, by + r() * h, 2 + r() * w * 0.18, 1 + r() * h * 0.3, r() * 3, 0, 7); g.fill(); } }
      // 모서리 깨짐·그늘
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(bx, by + h - 2, w, 2);
      g.fillStyle = 'rgba(255,230,210,.08)'; g.fillRect(bx, by, w, 1.5);
    }
  }
  // 오래된 벽처럼 채도 낮추기
  g.globalCompositeOperation = 'saturation'; g.fillStyle = 'rgba(128,128,128,.42)'; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
  // 빗물 자국·때
  for (let i = 0; i < 26; i++) { const x = r() * W; const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, `rgba(25,15,10,${0.05 + r() * 0.12})`); grd.addColorStop(1, 'rgba(25,15,10,0)'); g.fillStyle = grd; g.fillRect(x, 0, 4 + r() * 26, H * (0.3 + r() * 0.7)); }
  const vg = g.createRadialGradient(W * 0.35, brickH * 0.2, 20, W * 0.35, brickH * 0.4, Math.max(W, H));
  vg.addColorStop(0, 'rgba(255,215,160,.16)'); vg.addColorStop(0.5, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(15,8,5,.55)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);

  // ── 회벽 영역 (찢긴 가장자리) ──
  const edge = [];
  if (narrow) {
    for (let x = 0, y = brickH; x <= W + 8; x += 8) { y += (r() - 0.5) * 14; y = Math.min(brickH + 24, Math.max(brickH - 24, y)); edge.push([x, y]); }
  } else {
    let x = W * 0.66;
    for (let y = 0; y <= H + 8; y += 8) { x += (r() - 0.5) * 16 + Math.sin(y / 60) * 1.5; x = Math.min(W * 0.7, Math.max(W * 0.6, x)); edge.push([x, y]); }
  }
  const plaster = new Path2D();
  if (narrow) { plaster.moveTo(0, H); edge.forEach(([x, y]) => plaster.lineTo(x, y)); plaster.lineTo(W, H); }
  else { plaster.moveTo(W, 0); edge.forEach(([x, y]) => plaster.lineTo(x, y)); plaster.lineTo(W, H); }
  plaster.closePath();
  // 두께감 그림자
  g.save(); g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 14; g.shadowOffsetX = narrow ? 0 : -6; g.shadowOffsetY = narrow ? -6 : 0;
  g.fillStyle = '#e6dccb'; g.fill(plaster); g.restore();
  g.save(); g.clip(plaster);
  const pg = narrow ? g.createLinearGradient(0, brickH, 0, H) : g.createLinearGradient(W * 0.6, 0, W, 0);
  pg.addColorStop(0, '#ddd2bf'); pg.addColorStop(0.5, '#ece4d4'); pg.addColorStop(1, '#e2d8c5');
  g.fillStyle = pg; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) { g.fillStyle = r() < 0.6 ? `rgba(90,75,55,${r() * 0.07})` : `rgba(255,255,255,${r() * 0.18})`; g.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 3); }
  // 갈라짐
  g.lineCap = 'round';
  const crack = (x, y, a, len, wdt, depth) => {
    g.strokeStyle = `rgba(70,58,45,${0.2 + r() * 0.25})`; g.lineWidth = wdt;
    g.beginPath(); g.moveTo(x, y);
    for (let i = 0; i < len; i++) { a += (r() - 0.5) * 0.7; x += Math.cos(a) * 7; y += Math.sin(a) * 7; g.lineTo(x, y); if (depth < 2 && r() < 0.08) { g.stroke(); crack(x, y, a + (r() - 0.5) * 2, len * 0.5, wdt * 0.6, depth + 1); g.beginPath(); g.moveTo(x, y); } }
    g.stroke();
  };
  for (let i = 0; i < 7; i++) crack(narrow ? r() * W : W * (0.62 + r() * 0.38), narrow ? brickH + r() * (H - brickH) : r() * H, r() * 6.28, 10 + r() * 24, 0.8 + r() * 0.8, 0);
  g.restore();

  // ── 페인트 글씨: 벽돌 위 브랜드 ──
  const areaW = narrow ? W : W * 0.6;
  const cx = areaW / 2;
  const paintLayer = document.createElement('canvas');
  paintLayer.width = canvas.width; paintLayer.height = canvas.height;
  const p = paintLayer.getContext('2d');
  p.setTransform(dpr, 0, 0, dpr, 0, 0);
  let fs = 200;
  p.font = `${fs}px "Alfa Slab One", Rockwell, Georgia, serif`;
  const widest = Math.max(...brand.map((t) => p.measureText(t).width));
  fs = Math.min(fs * (areaW * 0.86) / widest, brickH * 0.3);
  const lineH = fs * 1.02;
  const subFs = fs * 0.24;
  const blockH = lineH * brand.length + subFs * 1.8;
  let ty = Math.max(fs * 0.9, (brickH - blockH) / 2 + fs * 0.82);
  p.textAlign = 'center';
  p.fillStyle = '#eee5d2';
  p.font = `${fs}px "Alfa Slab One", Rockwell, Georgia, serif`;
  brand.forEach((t, i) => { p.save(); p.translate(cx, ty + i * lineH); p.rotate((r() - 0.5) * 0.008); p.fillText(t, 0, 0); p.restore(); });
  p.font = `${subFs}px "Alfa Slab One", Rockwell, Georgia, serif`;
  p.fillStyle = '#d9c39a';
  const subY = ty + (brand.length - 1) * lineH + subFs * 2.1;
  p.letterSpacing = `${subFs * 0.4}px`;
  p.fillText(sub, cx, subY);
  p.letterSpacing = '0px';
  // 페인트 벗겨짐: 작은 조각을 지운다
  p.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 420; i++) { p.fillStyle = `rgba(0,0,0,${0.5 + r() * 0.5})`; p.beginPath(); p.ellipse(r() * areaW, r() * brickH, 0.6 + r() * fs * 0.03, 0.5 + r() * fs * 0.02, r() * 3, 0, 7); p.fill(); }
  for (let i = 0; i < 6000; i++) { p.fillStyle = `rgba(0,0,0,${r() * 0.35})`; p.fillRect(r() * areaW, r() * brickH, 1, 1); }
  p.globalCompositeOperation = 'source-over';
  g.globalAlpha = 0.9;
  g.drawImage(paintLayer, 0, 0, W, H);
  g.globalAlpha = 1;
  // 줄눈이 페인트 아래로 비치게: 벽돌 영역에 줄눈 선을 다시 얕게
  g.save();
  const brickClip = new Path2D(); brickClip.rect(0, 0, W, H); brickClip.addPath(plaster); g.clip(brickClip, 'evenodd');
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = 'rgba(120,100,85,.45)';
  for (let row = 0, y = 0; y < brickH + bh; row++, y += bh) {
    g.fillRect(0, y - m / 2, areaW + 40, m * 0.8);
    const off = row % 2 ? -bw / 2 : 0;
    for (let x = off; x < areaW + 40; x += bw) g.fillRect(x - m / 2, y, m * 0.8, bh);
  }
  g.restore();

  // ── 붓글씨 페인트: 회벽 위 설명 ──
  if (notes.length) {
    const nx = narrow ? 18 : W * 0.71;
    const nw = narrow ? W - 36 : W * 0.26;
    const top = narrow ? brickH + 40 : H * 0.24;
    let nfs = 80;
    g.font = `${nfs}px "Nanum Brush Script", cursive`;
    const nwid = Math.max(...notes.map((t) => g.measureText(t.text).width / (t.scale || 1)));
    nfs = Math.min(nfs * nw / nwid, narrow ? noteFs : 64);
    let y = top;
    g.textAlign = 'left';
    notes.forEach((t, i) => {
      const s = nfs * (t.scale || 1);
      g.save();
      g.translate(nx + (narrow ? 0 : i * 4), y + s);
      g.rotate(-0.02 + (r() - 0.5) * 0.01);
      g.font = `${s}px "Nanum Brush Script", cursive`;
      g.fillStyle = t.color || 'rgba(38,30,26,.88)';
      g.fillText(t.text, 0, 0);
      g.restore();
      y += s * 1.25;
    });
  }
}

// ─────────────────────────────────────────────────────────────
// 사용자가 준 벽 사진(왼쪽 벽돌 + 오른쪽 회벽) 위에 페인트로 쓴다.
// 사진은 자르거나 가리지 않고 원본 비율 그대로 그린다.
// ─────────────────────────────────────────────────────────────
function loadImage(src) {
  return new Promise((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = fail; im.src = src; });
}

export async function paintPhotoWall(canvas, { src, brand = ["DON'T BUY THE BOOK"], sub = 'KNOWLEDGE ONTOLOGY FACTORY', brandBox = [0.05, 0.05, 0.95, 0.34], notes = [], notesBox = null } = {}) {
  const [photo] = await Promise.all([
    loadImage(src),
    document.fonts.load('100px "Alfa Slab One"').catch(() => {}),
    document.fonts.load('40px "Nanum Brush Script"').catch(() => {}),
  ]);
  const W = Math.max(300, Math.round(canvas.clientWidth));
  const H = Math.round(W * photo.naturalHeight / photo.naturalWidth);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.height = `${H}px`;
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.imageSmoothingQuality = 'high';
  g.drawImage(photo, 0, 0, W, H);
  const r = rng(8);

  // 페인트 층: 글씨를 칠한 뒤 사진의 벽돌 결을 얕게 곱해 벽에 스며든 느낌을 낸다.
  const layer = document.createElement('canvas');
  layer.width = canvas.width; layer.height = canvas.height;
  const p = layer.getContext('2d');
  p.setTransform(dpr, 0, 0, dpr, 0, 0);
  p.textAlign = 'center';

  // 브랜드
  const [bx0, by0, bx1, by1] = brandBox;
  const bW = (bx1 - bx0) * W, bH = (by1 - by0) * H, cx = (bx0 + bx1) / 2 * W;
  let fs = 200;
  p.font = `${fs}px "Alfa Slab One", Rockwell, Georgia, serif`;
  const subRatio = sub ? 0.26 : 0;
  fs = Math.min(fs * bW / Math.max(...brand.map((t) => p.measureText(t).width)), bH / (brand.length * 1.02 + subRatio * 1.9));
  const lineH = fs * 1.02, subFs = fs * subRatio;
  const blockH = lineH * brand.length + subFs * 1.9;
  const top = by0 * H + (bH - blockH) / 2 + fs * 0.86;
  p.fillStyle = '#f4ecdb';
  p.font = `${fs}px "Alfa Slab One", Rockwell, Georgia, serif`;
  brand.forEach((t, i) => { p.save(); p.translate(cx, top + i * lineH); p.rotate((r() - 0.5) * 0.008); p.fillText(t, 0, 0); p.restore(); });
  // 벗겨짐 (브랜드 영역만)
  p.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 520; i++) { p.fillStyle = `rgba(0,0,0,${0.5 + r() * 0.5})`; p.beginPath(); p.ellipse(bx0 * W + r() * bW, by0 * H + r() * bH, 0.6 + r() * fs * 0.03, 0.5 + r() * fs * 0.02, r() * 3, 0, 7); p.fill(); }
  for (let i = 0; i < 7000; i++) { p.fillStyle = `rgba(0,0,0,${r() * 0.35})`; p.fillRect(bx0 * W + r() * bW, by0 * H + r() * bH, 1, 1); }
  p.globalCompositeOperation = 'source-over';

  if (sub) {
    p.fillStyle = '#ead9b4';
    p.font = `${fs}px "Alfa Slab One", Rockwell, Georgia, serif`;
    const brandW = Math.max(...brand.map((t) => p.measureText(t).width));
    let sfs = subFs;
    p.font = `${sfs}px "Alfa Slab One", Rockwell, Georgia, serif`;
    const subW = p.measureText(sub).width + sub.length * sfs * 0.3;
    const maxSub = Math.max(brandW * 0.92, Math.min(bW * 0.97, W < 640 ? bW : 0));
    if (subW > maxSub) sfs *= maxSub / subW;
    p.font = `${sfs}px "Alfa Slab One", Rockwell, Georgia, serif`;
    p.letterSpacing = `${sfs * 0.3}px`;
    p.fillText(sub, cx + sfs * 0.15, top + (brand.length - 1) * lineH + subFs * 2.15);
    p.letterSpacing = '0px';
  }
  // 설명 (붓 페인트)
  if (notesBox && notes.length) {
    const [nx0, ny0, nx1, ny1] = notesBox;
    const nW = (nx1 - nx0) * W, nH = (ny1 - ny0) * H, ncx = (nx0 + nx1) / 2 * W;
    let nfs = 100;
    p.font = `${nfs}px "Nanum Brush Script", cursive`;
    nfs = Math.min(nfs * nW / Math.max(...notes.map((t) => p.measureText(t.text).width)), nH / (notes.length * 1.15));
    let y = ny0 * H + (nH - notes.length * nfs * 1.15) / 2 + nfs * 0.9;
    notes.forEach((t) => {
      p.save(); p.translate(ncx, y); p.rotate((r() - 0.5) * 0.012);
      p.font = `${nfs}px "Nanum Brush Script", cursive`;
      p.fillStyle = t.color || '#f1e8d6';
      p.strokeStyle = p.fillStyle; p.lineWidth = Math.max(1, nfs * 0.035); p.lineJoin = 'round';
      p.strokeText(t.text, 0, 0);
      p.fillText(t.text, 0, 0);
      p.restore();
      y += nfs * 1.15;
    });
  }

  // 벽돌 결 비치기
  const mask = document.createElement('canvas');
  mask.width = layer.width; mask.height = layer.height;
  mask.getContext('2d').drawImage(layer, 0, 0);
  p.globalCompositeOperation = 'multiply';
  p.globalAlpha = 0.22;
  p.drawImage(photo, 0, 0, W, H);
  p.globalCompositeOperation = 'destination-in';
  p.globalAlpha = 1;
  p.setTransform(1, 0, 0, 1, 0, 0);
  p.drawImage(mask, 0, 0);

  g.save(); g.shadowColor = 'rgba(20,10,6,.4)'; g.shadowBlur = 3; g.shadowOffsetY = 1;
  g.drawImage(layer, 0, 0, W, H);
  g.restore();
}
