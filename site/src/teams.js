// 팀 나누기 계산 (순수 함수 — DOM · DB 없음, test/unit.mjs 에서 바로 시험)
import { shuffle } from './shared.js';

/** 팀 수 = ceil(인원 / 팀 크기). 2명 이상이면 최소 2팀, 최대 8팀 */
export function teamCountFor(n, size) {
  if (n <= 1) return 1;
  return Math.min(8, Math.max(2, Math.ceil(n / size)));
}

/**
 * 팀 정원(지금 이 순간). 인원 차이가 1을 넘지 않게:
 * base = floor(n/k), extra = n%k → 「base+1 명 팀」은 extra 개까지만.
 * counts: {tid: 현재 인원}
 */
export function capsNow(n, teamIds, counts) {
  const k = teamIds.length;
  const base = Math.floor(n / k), extra = n % k;
  const big = teamIds.filter(t => (counts[t] || 0) >= base + 1).length;
  const caps = {};
  for (const t of teamIds) {
    caps[t] = ((counts[t] || 0) >= base + 1 || big < extra) ? base + 1 : base;
  }
  return caps;
}

/**
 * 자유 선택: 먼저 누른 순서대로 정원 안에서 자리를 준다.
 * picks: [{uid, pick, pickAt}]  (pickAt = 서버 시간)
 * n: 팀 고르기를 연 순간의 인원(정원 계산 기준)
 * 돌려줌: { got: {uid: tid}, over: [uid…] (넘친 사람), seats: {tid: 남은 자리} }
 */
export function computePick(picks, teamIds, n) {
  const order = picks
    .filter(p => p.pick && teamIds.includes(p.pick))
    .sort((a, b) => (a.pickAt || 0) - (b.pickAt || 0) || (a.uid < b.uid ? -1 : 1));
  const counts = Object.fromEntries(teamIds.map(t => [t, 0]));
  const got = {}, over = [];
  for (const p of order) {
    const caps = capsNow(n, teamIds, counts);
    if (counts[p.pick] < caps[p.pick]) { got[p.uid] = p.pick; counts[p.pick]++; }
    else over.push(p.uid);
  }
  const caps = capsNow(n, teamIds, counts);
  const seats = Object.fromEntries(teamIds.map(t => [t, Math.max(0, caps[t] - counts[t])]));
  return { got, over, seats };
}

/** 인원 차이가 1을 넘으면 큰 팀에서 작은 팀으로 옮긴다. movable(uid) 가 참인 사람부터 옮긴다 */
export function rebalance(assign, teamIds, rnd = Math.random, prefer = () => false) {
  const a = { ...assign };
  for (let guard = 0; guard < 100; guard++) {
    const members = Object.fromEntries(teamIds.map(t => [t, []]));
    for (const [u, t] of Object.entries(a)) if (members[t]) members[t].push(u);
    const sizes = teamIds.map(t => members[t].length);
    const max = Math.max(...sizes), min = Math.min(...sizes);
    if (max - min <= 1) return a;
    const from = shuffle(teamIds.filter(t => members[t].length === max), rnd)[0];
    const to = shuffle(teamIds.filter(t => members[t].length === min), rnd)[0];
    const cand = members[from].filter(prefer);
    const pool = cand.length ? cand : members[from];
    const u = shuffle(pool, rnd)[0];
    a[u] = to;
  }
  return a;
}

/**
 * 팀 고르기 마감: 자리 잡은 사람은 그대로, 못 고른 사람 · 넘친 사람은 빈자리에 무작위.
 * 돌려줌: { assign: {uid: tid}, filled: [무작위로 들어간 uid…] }
 */
export function finalizePick(got, allUids, teamIds, rnd = Math.random) {
  const assign = {};
  for (const u of allUids) if (got[u] && teamIds.includes(got[u])) assign[u] = got[u];
  const rest = shuffle(allUids.filter(u => !assign[u]), rnd);
  for (const u of rest) assign[u] = smallestTeam(assign, teamIds, rnd);
  const filled = new Set(rest);
  const balanced = rebalance(assign, teamIds, rnd, u => filled.has(u));
  for (const u of Object.keys(balanced)) if (balanced[u] !== assign[u]) filled.add(u);
  return { assign: balanced, filled: [...filled] };
}

/** 무작위로 고르게 나누기 */
export function randomSplit(uids, teamIds, rnd = Math.random) {
  const assign = {};
  const order = shuffle(uids, rnd);
  const offset = Math.floor(rnd() * teamIds.length);
  order.forEach((u, i) => { assign[u] = teamIds[(i + offset) % teamIds.length]; });
  return assign;
}

/** 가장 작은 팀(여럿이면 무작위) */
export function smallestTeam(assign, teamIds, rnd = Math.random) {
  const counts = Object.fromEntries(teamIds.map(t => [t, 0]));
  for (const t of Object.values(assign)) if (t in counts) counts[t]++;
  const min = Math.min(...teamIds.map(t => counts[t]));
  return shuffle(teamIds.filter(t => counts[t] === min), rnd)[0];
}
