// 미니게임 플러그인이 쓰는 도구 모음. games/<id>.js 는 이 파일과 shared.js 만 import 한다.
export { esc, clamp, mulberry32, shuffle, rankPoints, RANK_PTS } from './shared.js';
import { esc } from './shared.js';

/**
 * 같은 key 면 그대로 두고, key 가 바뀔 때만 html 로 새로 그린다.
 * hostView / playView 는 자주 불리므로 뼈대는 keyed 로 한 번만 만들고, 값만 제자리에서 바꾼다.
 * 돌려줌: 새로 그렸으면 true
 */
export function keyed(el, key, html) {
  if (el.dataset.key === key) return false;
  el.dataset.key = key;
  el.innerHTML = html;
  return true;
}

/** el 안에서 선택자로 하나 찾기 */
export const q = (el, sel) => el.querySelector(sel);

/** 글자 바꾸기 (같으면 손대지 않음 → 깜빡임 없음) */
export function text(el, sel, s) {
  const n = typeof sel === 'string' ? el.querySelector(sel) : sel;
  if (n && n.textContent !== String(s)) n.textContent = String(s);
}

/** 남은 초 (올림). deadline 은 서버 시간 ms */
export function secsLeft(deadline, now) {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/**
 * 큰 초시계 HTML. 마지막 3초에는 .hot (빨갛게 · 맥박) — 진행판에서 긴장감
 * 붙인 뒤 timerUpdate(el, 남은초) 로 갱신
 */
export function timerHTML(label = '남은 시간') {
  return `<div class="gk-timer" role="timer" aria-live="off"><span class="gk-timer-l">${esc(label)}</span><b class="gk-timer-n num">--</b><span class="gk-timer-u">초</span></div>`;
}
export function timerUpdate(root, secs) {
  const t = root.querySelector('.gk-timer');
  if (!t) return;
  text(t, '.gk-timer-n', secs);
  t.classList.toggle('hot', secs <= 3 && secs > 0);
  t.classList.toggle('zero', secs === 0);
}

/** 팀 이름표 HTML (색 + 이모지 + 이름 — 색만으로 구분하지 않는다) */
export function teamTag(t, extra = '') {
  return `<span class="gk-tag" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}">${t.emoji} ${esc(t.name)}${extra}</span>`;
}

/**
 * 다수결. votes: [{v, t}] (t = 서버 시간). 표가 같으면 그 값의 첫 표가 먼저 들어온 쪽.
 * 돌려줌: { winner, counts: {v: n} } — 표가 없으면 winner = null
 */
export function majority(votes) {
  const counts = {}, first = {};
  for (const { v, t } of votes) {
    if (v === undefined || v === null || v === '') continue;
    counts[v] = (counts[v] || 0) + 1;
    if (first[v] === undefined || (t || 0) < first[v]) first[v] = t || 0;
  }
  let winner = null;
  for (const v of Object.keys(counts)) {
    if (winner === null || counts[v] > counts[winner] || (counts[v] === counts[winner] && first[v] < first[winner])) winner = v;
  }
  return { winner, counts };
}

/** 꽃가루(축하) — el 안에 잠깐 뿌린다. 움직임 줄이기 설정이면 생략 */
export function confetti(el, n = 60) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div');
  box.className = 'gk-confetti';
  const colors = ['#d97757', '#6a9bcc', '#788c5d', '#c9a227', '#9b6fb0', '#4f9e95'];
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.style.left = (Math.random() * 100) + '%';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = (Math.random() * 0.5) + 's';
    p.style.animationDuration = (1.6 + Math.random() * 1.2) + 's';
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    box.appendChild(p);
  }
  el.appendChild(box);
  setTimeout(() => box.remove(), 3500);
}

/** 화면 흔들기 · 번쩍 (깜짝 이벤트) */
export function flash(el, cls = 'gk-flash', ms = 900) {
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

/** 짧은 효과음 (Web Audio, 파일 없음). 진행판에서만. 실패해도 조용히 넘어간다 */
let actx = null;
export function beep(freq = 880, ms = 120, type = 'sine', vol = 0.15) {
  try {
    if (!window.__bbSound) return;
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = vol;
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + ms / 1000);
    o.connect(g).connect(actx.destination);
    o.start(); o.stop(actx.currentTime + ms / 1000);
  } catch { /* 소리는 없어도 된다 */ }
}

/** 마지막 3초 째깍 소리 — 초가 바뀔 때만 울린다 */
export function tickSound(root, secs) {
  if (root.__lastTick === secs) return;
  root.__lastTick = secs;
  if (secs <= 3 && secs > 0) beep(660 + (3 - secs) * 110, 110, 'square', 0.08);
  else if (secs === 0) beep(1046, 320, 'triangle', 0.15);
}

/** 게임 전용 CSS 를 한 번만 넣는다 (플러그인이 styles.css 를 고치지 않아도 되게) */
export function injectCSS(id, css) {
  if (document.getElementById('css-' + id)) return;
  const s = document.createElement('style');
  s.id = 'css-' + id;
  s.textContent = css;
  document.head.appendChild(s);
}

/** 순위 → 메달 */
export function medal(rank) { return ['🥇', '🥈', '🥉'][rank - 1] || `${rank}위`; }
