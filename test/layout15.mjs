// 15차시 시험 공용: 화면 레이아웃 점검 (page.evaluate(layoutIssues) 로 브라우저 안에서 돈다 — 바깥 변수 쓰지 않음)
// 문서 세로 · 가로 스크롤 · 화면 밖 요소 · 「넘침을 자르는」 조상 밖으로 가로 · 세로로 삐져나와 잘린 요소 · 잘린 상자 · 말줄임
export function layoutIssues() {
  const vh = innerHeight, vw = innerWidth, out = [];
  const d = document.documentElement;
  if (d.scrollHeight > d.clientHeight + 1) out.push(`문서 세로 ${d.scrollHeight}>${d.clientHeight}`);
  if (d.scrollWidth > d.clientWidth + 1) out.push(`문서 가로 ${d.scrollWidth}>${d.clientWidth}`);
  for (const el of document.querySelectorAll('#stage *, #main *')) {
    // .proxy(대신 누르기 칸)는 코어가 만든 스크롤 칸이라 넘쳐도 스크롤로 보인다 (CORE_REQUESTS 3)
    if (el.closest('.gk-confetti') || el.closest('.c-ready') || el.closest('.proxy')) continue;
    const b = el.getBoundingClientRect();
    if (!b.height || !b.width) continue;
    if (b.bottom > vh + 1 || b.right > vw + 1) { out.push(`화면 밖 <${el.tagName.toLowerCase()} class="${el.className}"> ${Math.round(b.bottom)}/${Math.round(b.right)}`); if (out.length > 6) break; }
  }
  const root = document.querySelector('#gameEl') || document.querySelector('#gp');
  // 눈에 보이게 잘린 요소: 가장 가까운 「넘침을 자르는」 조상(overflow ≠ visible)의 안쪽 상자를 가로 · 세로로 벗어나면 잘린 것
  const clipOf = el => {
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') return p;
    }
    return null;
  };
  const inEllipsis = (el, stop) => { for (let p = el; p && p !== stop; p = p.parentElement) if (getComputedStyle(p).textOverflow === 'ellipsis') return true; return false; };
  let nClip = 0;
  if (root) for (const el of root.querySelectorAll('*')) {
    if (el.closest('.gk-confetti') || el.closest('.c-ready')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.position === 'fixed') continue;
    const b = el.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) continue;
    const anc = clipOf(el);
    if (!anc || inEllipsis(el, anc)) continue;
    const a = anc.getBoundingClientRect(), acs = getComputedStyle(anc);
    const L = a.left + parseFloat(acs.borderLeftWidth), R = a.right - parseFloat(acs.borderRightWidth);
    const T = a.top + parseFloat(acs.borderTopWidth), B = a.bottom - parseFloat(acs.borderBottomWidth);
    const dx = Math.max(L - b.left, b.right - R), dy = Math.max(T - b.top, b.bottom - B);
    if (dx > 2 || dy > 2) {
      const cls = String(el.className).split(' ')[0] || el.tagName.toLowerCase();
      out.push(`${dx > 2 ? '가로' : '세로'} 넘침 .${cls} "${el.textContent.trim().slice(0, 12)}" ${Math.round(Math.max(dx, dy))}px ⊄ .${String(anc.className).split(' ')[0] || anc.id}`);
      if (++nClip > 6) break;
    }
  }
  // 삐짐: 넘침을 자르지 않는(visible) 상자에서 내용이 가로로 상자 밖까지 나가면, 옆 칸 글자와 겹친다
  // (예: nowrap 글자가 격자 칸을 넘어 옆 칸 「근거 6」 위에 올라감)
  let nSpill = 0;
  if (root) for (const el of root.querySelectorAll('*')) {
    if (el.closest('.gk-confetti') || el.closest('.c-ready')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'inline' || cs.display === 'none' || cs.overflowX !== 'visible') continue;
    // 일부러 돌린 상자(예: 가격표 모양 -2°) 안은 테두리 상자 좌표가 어긋나 재지 않는다
    let turned = false;
    for (let q = el; q && q !== root; q = q.parentElement) if (getComputedStyle(q).transform !== 'none') { turned = true; break; }
    if (turned) continue;
    if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 3) {
      // 무엇이 삐졌나: 자식 요소 또는 글자. 장식용 ::before · 일부러 돌리거나 키운(transform · scale) 자식은 빼고 본다
      const p = el.getBoundingClientRect();
      const L = p.left + el.clientLeft, R = L + el.clientWidth;
      const kids = [...el.children].filter(k => {
        const kc = getComputedStyle(k);
        if (kc.transform !== 'none' || (kc.scale && kc.scale !== 'none') || kc.position === 'absolute' || kc.position === 'fixed') return false;
        const r = k.getBoundingClientRect();
        return r.width > 1 && (r.right > R + 3 || r.left < L - 3);
      });
      let txt = kids[0] ? kids[0].textContent.trim() : '';
      if (!kids.length) {
        for (const n of el.childNodes) {
          if (n.nodeType !== 3 || !n.textContent.trim()) continue;
          const rg = document.createRange(); rg.selectNodeContents(n);
          const r = rg.getBoundingClientRect();
          if (r.right > R + 3 || r.left < L - 3) { txt = n.textContent.trim(); break; }
        }
      }
      if (!kids.length && !txt) continue;
      out.push(`가로 삐짐 .${String(el.className).split(' ')[0] || el.tagName.toLowerCase()} "${txt.slice(0, 12)}" ${el.scrollWidth}>${el.clientWidth}`);
      if (++nSpill > 6) break;
    }
    // 세로 삐짐: 칸 높이가 정해진 상자(격자 · 줄어든 flex 칸)에서 자식이 아래로 나가 다음 칸과 겹침
    if (el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 4 && (cs.display === 'grid' || cs.display === 'flex' || cs.display === 'block')) {
      const p = el.getBoundingClientRect();
      const B = p.top + el.clientTop + el.clientHeight;
      const k = [...el.children].find(k => {
        const kc = getComputedStyle(k);
        if (kc.transform !== 'none' || (kc.scale && kc.scale !== 'none') || kc.position === 'absolute' || kc.position === 'fixed') return false;
        const r = k.getBoundingClientRect();
        return r.height > 1 && r.bottom > B + 4;
      });
      if (k) {
        out.push(`세로 삐짐 .${String(el.className).split(' ')[0] || el.tagName.toLowerCase()} ⊃ .${String(k.className).split(' ')[0] || k.tagName.toLowerCase()} "${k.textContent.trim().slice(0, 12)}" ${el.scrollHeight}>${el.clientHeight}`);
        if (++nSpill > 6) break;
      }
    }
  }
  if (root) for (const el of [root, ...root.querySelectorAll('*')]) {
    const cs = getComputedStyle(el);
    if (el.closest('.gk-confetti')) continue;
    if ((cs.overflow === 'hidden' || cs.overflowY === 'hidden' || cs.overflowY === 'auto') && el.scrollHeight > el.clientHeight + 3 && el.clientHeight > 0) {
      out.push(`잘림 .${String(el.className).split(' ').join('.')} ${el.scrollHeight}>${el.clientHeight}`);
      if (out.length > 10) break;
    }
    if ((cs.overflow === 'hidden' || cs.overflowX === 'hidden') && cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 3 && el.clientWidth > 0) {
      out.push(`가로 잘림 .${String(el.className).split(' ').join('.')} ${el.scrollWidth}>${el.clientWidth}`);
      if (out.length > 10) break;
    }
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.push(`말줄임 .${String(el.className).split(' ')[0]} "${el.textContent.slice(0, 20)}"`);
  }
  return out;
}
