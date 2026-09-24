/* ─────────────────────────────────────────────────────────────
   랜딩 페이지 전용 연출. app.js의 라우팅·상태와는 무관하며,
   #view-landing 안의 장식 요소만 다룬다. 실패해도 핵심 기능(대화·ITEM·Preview)에
   영향이 없도록 이 파일 전체를 try/catch로 감싼다.
   ───────────────────────────────────────────────────────────── */
(() => {
  'use strict';
  try {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

    // ── 1) 상단 바: 스크롤하면 어두운 유리 톤 + 시작 버튼 노출 ──
    const bar = $('#land-bar');
    if (bar) {
      const onScroll = () => bar.classList.toggle('scrolled', window.scrollY > 80);
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
    }
    $('#cta-start-bar')?.addEventListener('click', () => $('#cta-start')?.click());

    // ── 2) 스크롤 등장: [data-rv] ──
    const rvEls = $$('[data-rv]');
    if (rvEls.length) {
      if (reduce || !('IntersectionObserver' in window)) {
        rvEls.forEach((el) => el.classList.add('rv-in'));
      } else {
        const io = new IntersectionObserver(
          (entries) => {
            for (const e of entries) if (e.isIntersecting) { e.target.classList.add('rv-in'); io.unobserve(e.target); }
          },
          { threshold: 0.18 },
        );
        rvEls.forEach((el) => io.observe(el));
      }
    }

    // ── 3) "이렇게 편하게 말해도 됩니다" 예시 문구가 타이핑되며 순환한다 ──
    const ASK_EXAMPLES = [
      '고객사가 계약에 없던 기능을 계속 추가해달라고 해요…',
      '퇴직했는데 계속 업무 질문이 와요…',
      '동업을 정리하려는데 장비랑 고객을 어떻게 나눌지…',
      '광고주가 영상을 계약보다 오래 쓰려고 해요…',
      '아파트 주차 조건을 관리업체와 확실히 하고 싶어요',
    ];
    const askEl = $('#ask-text');
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    async function typeText(el, text, { speed = 42, hold = 1400 } = {}) {
      el.textContent = '';
      for (let i = 0; i < text.length; i++) {
        el.textContent += text[i];
        await sleep(speed + (Math.random() * 20 - 10));
      }
      await sleep(hold);
    }

    async function runAskCycle() {
      if (!askEl) return;
      let i = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const text = ASK_EXAMPLES[i % ASK_EXAMPLES.length];
        if (reduce) {
          askEl.textContent = text;
          await sleep(3200);
        } else {
          await typeText(askEl, text, { hold: 1600 });
          askEl.textContent = '';
          await sleep(400);
        }
        i++;
      }
    }
    runAskCycle();

    // ── 4) "하나의 협상, 여러 개의 합의" 도식: 응답 상태가 천천히 순환 ──
    const bis = $$('.split-vis .bi');
    if (bis.length && !reduce) {
      let k = 0;
      setInterval(() => {
        bis.forEach((b) => b.classList.remove('active'));
        bis[k % bis.length].classList.add('active');
        k++;
      }, 1400);
    } else {
      bis.forEach((b) => b.classList.add('active'));
    }

    // ── 5) 금액 처리 흐름: 순서대로 살짝 강조 + 동전이 흐르다 에스크로에서 머무는 연출 ──
    const flowLis = $$('#flow li');
    const flowWrap = $('.flow-wrap');
    if (flowLis.length && !reduce) {
      const io2 = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            flowLis.forEach((li, idx) => setTimeout(() => li.classList.add('pulse'), idx * 260));
            // 카드 등장이 끝난 뒤 동전 애니메이션과 에스크로 카드의 은은한 빛을 시작한다
            setTimeout(() => {
              $('#flow-coin')?.classList.add('run');
              flowWrap?.classList.add('glow-on');
            }, flowLis.length * 260 + 300);
            io2.disconnect();
          }
        },
        { threshold: 0.3 },
      );
      io2.observe($('#flow'));
    }
  } catch (err) {
    // 장식 스크립트 오류가 서비스 이용을 막지 않도록 조용히 무시하고 콘솔에만 남긴다.
    console.warn('[landing] decorative script error (ignored):', err);
  }
})();
