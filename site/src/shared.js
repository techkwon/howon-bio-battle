// 진행판 · 조종기 · 게임이 함께 쓰는 상수와 작은 도구들 (DOM · Firebase 없음 → node 에서도 시험 가능)

// 팀 8개. 색은 늘 이모지 · 이름과 함께 쓴다(색만으로 구분하지 않는다).
// fill = 면 · 막대 · 풍선, tint = 옅은 바탕, text = 그 팀 색 계열 작은 글씨(바탕 #faf9f5 기준 4.5:1 이상)
export const TEAM_DEFS = [
  { name: '효모단',   emoji: '🍞', fill: '#d97757', tint: '#fbeee7', text: '#a84f2e' },
  { name: '유산균단', emoji: '🥛', fill: '#6a9bcc', tint: '#eaf1f8', text: '#3d6f9e' },
  { name: '누룩단',   emoji: '🍶', fill: '#788c5d', tint: '#eff2e8', text: '#55683f' },
  { name: '미생물단', emoji: '🦠', fill: '#9b6fb0', tint: '#f3ecf7', text: '#6f4785' },
  { name: '세포단',   emoji: '🧫', fill: '#c9a227', tint: '#f8f1d9', text: '#7a6114' },
  { name: '씨앗단',   emoji: '🌱', fill: '#4f9e95', tint: '#e5f2f0', text: '#2f6c65' },
  { name: '버섯단',   emoji: '🍄', fill: '#c46a8a', tint: '#f8e8ee', text: '#93415f' },
  { name: '해조단',   emoji: '🌊', fill: '#5d6f86', tint: '#e8ecf1', text: '#46566b' },
];

export const MAX_NUM = 30;
export const PICK_SECONDS = 30;
export const INTRO_SECONDS = 10;
export const DAY_MS = 24 * 3600 * 1000;

// 순위 점수: 1위 10 · 2위 8 · 3위 6 · 4위 5 · 5위 4 · 6위 3 · 7위 2 · 8위 1
export const RANK_PTS = [10, 8, 6, 5, 4, 3, 2, 1];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 씨앗 있는 난수 (같은 씨앗 → 같은 결과)
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

/**
 * 값 → 순위 점수. 같은 값은 같은 순위(공동), 다음 순위는 건너뛴다.
 * values: { teamId: number }   higherBetter: 큰 값이 1위인가
 * 돌려줌: { points: {tid: n}, rank: {tid: 1..} }
 */
export function rankPoints(values, higherBetter = true) {
  const ids = Object.keys(values);
  const sorted = ids.slice().sort((a, b) => higherBetter ? values[b] - values[a] : values[a] - values[b]);
  const points = {}, rank = {};
  let prevVal = null, prevRank = 0;
  sorted.forEach((tid, i) => {
    const v = values[tid];
    const r = (prevVal !== null && v === prevVal) ? prevRank : i + 1;
    rank[tid] = r; points[tid] = RANK_PTS[r - 1] ?? 1;
    prevVal = v; prevRank = r;
  });
  return { points, rank };
}

/** 진행판의 방 상태 JSON 한 칸을 안전하게 읽는다 */
export function parseJSON(s, fallback = null) {
  if (typeof s !== 'string') return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

/** 4자리 방 코드 (첫 자리 1~8 — 9xxx 는 시험용) */
export function newRoomCode(rnd = Math.random, test = false) {
  const first = test ? 9 : 1 + Math.floor(rnd() * 8);
  return String(first) + String(Math.floor(rnd() * 1000)).padStart(3, '0');
}

export function teamLabel(t) { return t ? `${t.emoji} ${t.name}` : ''; }

/** 기기 표시(글자 1 + 숫자 1, 예: K7). 같은 번호가 두 기기일 때 교사가 「누가 진짜?」를 고르는 데 쓴다. 개인정보 아님 */
export function devTag(uid) {
  let h = 2166136261;
  for (const c of String(uid || '')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return L[h % L.length] + String(Math.floor(h / L.length) % 9 + 1);
}
