// 15차시 「가족 저녁 회의」 — 식품 생산 생명 기술이 가족 식생활에 미치는 영향 · 토의 (15~18분)
// 사흘(라운드 3번, 교사가 2번에서 끝낼 수도 있다). 하루 흐름:
//   메뉴 · 정보 → 첫 마음 투표(혼자, 역할대로 · 20초) → 우리 가족 첫 마음 공개 + 90초 회의
//   → 🃏 상황 카드 반전(30초 짧은 회의) → 다시 투표(메뉴 + 근거 · 30초) → 가족 결정
//   동률이면 빠르기로 가르지 않는다: 「동률! 30초 더 회의」 → 동률 팀만 다시 투표 (교사가 정할 수도 있다)
// 점수 없음. 대신 날마다 🗣️ 설득상(첫 마음과 다른 사람을 가족 결정 쪽으로 2명 이상 돌린 가족 중 가장 많이 돌린 가족) ·
// 🤝 한마음상(첫 마음이 갈렸는데 회의 뒤 모두 같은 메뉴) — 회의를 해야만 받을 수 있는 상.
import {
  esc, shuffle, keyed, text, secsLeft, timerHTML, timerUpdate, tickSound, injectCSS, confetti, beep,
} from '../src/gamekit.js';
import {
  REASONS, ROW_DEFS, ROLES, FAMILY, ROUNDS, VOTE1_SECONDS, TALK_SECONDS, TWIST_SECONDS, VOTE2_SECONDS,
  TIE_TALK_SECONDS, TIE_VOTE_SECONDS, MAX_REASONS, WRAP, SWAY_MIN, SWAY_MAX,
} from './dinner-data.js';

const GRACE_MS = 400;
const ALL_BITS = REASONS.reduce((a, r) => a | r.bit, 0);
export const reasonsOf = rs => REASONS.filter(r => (rs & r.bit) !== 0);
const countBits = rs => reasonsOf(rs).length;
export const roleOf = id => ROLES.find(r => r.id === id) || FAMILY;
const isProxy = u => u.startsWith('proxy-');
const roundOf = s => ROUNDS[s.r] || ROUNDS[0];
const menusOf = s => roundOf(s).menus;
const ORDER = ROLES.map(r => r.id).concat(FAMILY.id);

/** 팀 인원 n 에게 줄 역할 묶음: 기본 4개, 5명이면 아빠, 6명이면 삼촌, 7명이면 할아버지 */
export function rolePool(n) { return ROLES.slice(0, Math.max(4, Math.min(ROLES.length, n))).map(r => r.id); }

/** 역할이 없는 팀원에게 역할을 준다(처음 · 늦게 온 학생). 바뀐 게 없으면 같은 객체 */
export function assignRoles(s, ctx) {
  let roles = null;
  const cur = s.roles || {};
  for (const t of ctx.teams) {
    const mem = (t.members || []).filter(u => !isProxy(u));
    const missing = mem.filter(u => !cur[u]);
    if (!missing.length) continue;
    roles = roles || { ...cur };
    const used = mem.map(u => roles[u]).filter(Boolean);
    let avail = shuffle(rolePool(mem.length).filter(r => !used.includes(r)), ctx.rnd);
    for (const u of missing) {
      if (!avail.length) avail = shuffle(ROLES.map(r => r.id), ctx.rnd);   // 7명 넘는 팀: 겹쳐도 된다
      roles[u] = avail.shift();
    }
  }
  return roles ? { ...s, roles } : s;
}

/** 다음 날: 팀 안에서 역할을 한 칸씩 돌린다(겹치지 않던 역할은 계속 안 겹친다) */
export function rotateRoles(s, ctx) {
  const roles = { ...(s.roles || {}) };
  for (const t of ctx.teams) {
    const mem = (t.members || []).filter(u => !isProxy(u) && roles[u]);
    const pool = rolePool(mem.length);
    for (const u of mem) {
      const i = pool.indexOf(roles[u]);
      if (i >= 0) roles[u] = pool[(i + 1) % pool.length];
    }
  }
  return { ...s, roles };
}

/** 근거는 한 사람에 MAX_REASONS 개까지(대신 누르기는 팀 전체라 제한 없음) */
function clampReasons(rs, proxy) {
  rs = Number.isInteger(rs) ? rs & ALL_BITS : 0;
  if (proxy) return rs;
  let out = 0, n = 0;
  for (const r of REASONS) if ((rs & r.bit) && n < MAX_REASONS) { out |= r.bit; n++; }
  return out;
}

function teamMap(ctx) {
  const m = {};
  for (const t of ctx.teams) for (const u of t.members || []) m[u] = t.id;
  return m;
}

/** 입력 → 표. reasons = 근거도 받기, allow = { 팀: [고를 수 있는 메뉴] } (동률 다시 투표 — 그 팀만) */
function foldVotes(inputs, ctx, nMenus, { reasons = false, allow = null } = {}) {
  const teamOf = teamMap(ctx);
  const out = {};
  for (const [u, inp] of Object.entries(inputs || {})) {
    const tid = teamOf[u];
    if (!inp || !tid) continue;
    if (allow && !allow[tid]) continue;
    let m = Number.isInteger(inp.m) && inp.m >= 0 && inp.m < nMenus ? inp.m : null;
    if (m !== null && allow && !allow[tid].includes(m)) m = null;
    const rs = reasons ? clampReasons(inp.rs, isProxy(u)) : 0;
    if (m === null && !rs) continue;
    out[u] = reasons ? { m, rs, tid } : { m, tid };
  }
  return out;
}

// 이 팀에서 투표를 기다리는 사람: 지금 접속한 팀원(대신 누르기는 누른 경우만). 비상 모드는 대신 누르기만
function needOf(t, ctx, votes) {
  if (ctx.offline) return t.online.slice();
  const list = t.online.filter(u => !isProxy(u));
  const px = 'proxy-' + t.id;
  if (votes[px] && !list.includes(px)) list.push(px);
  return list;
}
const doneMenu = v => !!v && v.m !== null;
const doneWhy = v => !!v && v.m !== null && v.rs > 0;

function progress(s, votes, ctx, isDone, only) {
  const prog = {};
  let all = true, any = false;
  for (const t of ctx.teams) {
    if (only && !only[t.id]) continue;
    const need = needOf(t, ctx, votes);
    const done = need.filter(u => isDone(votes[u])).length;
    prog[t.id] = { done, need: need.length, who: need.filter(u => !isProxy(u)).map(u => [(s.roles || {})[u] || '', isDone(votes[u]) ? 1 : 0]) };
    if (need.length) any = true;
    if (done < need.length) all = false;
  }
  return { prog, all, any };
}

const BLANK = { v1: {}, v2: {}, fin: {}, tv: {}, prog: {}, tw: null, tie: null, dec: {}, res: null, early: false, deadline: 0 };
const key = (s, x) => `r${s.r + 1}${x}`;

// ── 단계 바꾸기 ──
function startVote1(s, ctx) {
  return { ...s, step: 'vote1', inputKey: key(s, 'a'), deadline: ctx.now() + VOTE1_SECONDS * 1000, v1: {}, prog: {}, early: false };
}
function closeVote1(s, ctx) {
  const v1 = foldVotes(ctx.inputs, ctx, menusOf(s).length);
  return { ...s, v1, prog: {}, step: 'talk', inputKey: null, deadline: ctx.now() + TALK_SECONDS * 1000 };
}
function startTwist(s, ctx) {
  const n = roundOf(s).twists.length;
  return { ...s, step: 'twist', inputKey: null, tw: Math.floor(ctx.rnd() * n) % n, deadline: ctx.now() + TWIST_SECONDS * 1000 };
}
function startVote2(s, ctx) {
  return { ...s, step: 'vote2', inputKey: key(s, 'b'), deadline: ctx.now() + VOTE2_SECONDS * 1000, v2: {}, prog: {}, early: false };
}

const countOf = (ms, n) => { const c = Array.from({ length: n }, () => 0); for (const m of ms) c[m]++; return c; };
const tops = c => { const top = Math.max(...c); return c.map((x, i) => (x === top ? i : -1)).filter(i => i >= 0); };

function closeVote2(s, ctx) {
  const n = menusOf(s).length;
  const v2 = foldVotes(ctx.inputs, ctx, n, { reasons: true });
  const fin = {};
  for (const [u, v] of Object.entries(v2)) if (v.m !== null) fin[u] = v.m;
  const dec = {}, tied = {};
  for (const t of ctx.teams) {
    let ms = Object.entries(fin).filter(([u]) => v2[u].tid === t.id).map(([, m]) => m);
    let how = 'maj';
    if (!ms.length) { ms = Object.values(s.v1 || {}).filter(v => v.tid === t.id && v.m !== null).map(v => v.m); how = 'first'; }
    if (!ms.length) { dec[t.id] = { m: null, how: 'none' }; continue; }
    const top = tops(countOf(ms, n));
    if (top.length === 1) dec[t.id] = { m: top[0], how };
    else tied[t.id] = top;
  }
  const s2 = { ...s, v2, fin, dec, prog: {}, inputKey: null };
  return Object.keys(tied).length ? startTie(s2, ctx, tied, 1) : toShow(s2, ctx);
}

function startTie(s, ctx, teams, n) {
  return { ...s, step: 'tie', inputKey: null, tie: { n, teams }, tv: {}, prog: {}, deadline: ctx.now() + TIE_TALK_SECONDS * 1000 };
}
function startTieVote(s, ctx) {
  return { ...s, step: 'tiev', inputKey: key(s, 't' + s.tie.n), tv: {}, prog: {}, early: false, deadline: ctx.now() + TIE_VOTE_SECONDS * 1000 };
}
/** 동률 팀 다시 투표 마감: 다시 낸 표(없으면 앞 표가 후보 안이면 그대로)로 센다. 그래도 같으면 또 30초 회의 */
function closeTieVote(s, ctx) {
  const n = menusOf(s).length;
  const tv = s.step === 'tiev' ? foldVotes(ctx.inputs, ctx, n, { allow: s.tie.teams }) : {};
  const fin = { ...s.fin };
  for (const [u, v] of Object.entries(tv)) if (v.m !== null) fin[u] = v.m;
  const teamOf = teamMap(ctx);
  const dec = { ...s.dec }, still = {};
  for (const [tid, opts] of Object.entries(s.tie.teams)) {
    const ms = Object.entries(fin).filter(([u, m]) => teamOf[u] === tid && opts.includes(m)).map(([, m]) => m);
    const top = ms.length ? tops(countOf(ms, n)).filter(i => opts.includes(i)) : opts;
    if (top.length === 1) dec[tid] = { m: top[0], how: 'tie' };
    else still[tid] = top;
  }
  const s2 = { ...s, fin, dec, tv: {}, inputKey: null };
  return Object.keys(still).length ? startTie(s2, ctx, still, s.tie.n + 1) : toShow(s2, ctx);
}
/** 교사가 정하기: payload {tid, m} = 그 팀만, 없으면 남은 동률 팀 모두 제비뽑기 */
function force(s, ctx, payload) {
  if (!s.tie) return s;
  let base = s;
  if (s.step === 'tiev') {          // 지금까지 낸 동률 표도 기록에 남긴다
    const tv = foldVotes(ctx.inputs, ctx, menusOf(s).length, { allow: s.tie.teams });
    const fin = { ...s.fin };
    for (const [u, v] of Object.entries(tv)) if (v.m !== null) fin[u] = v.m;
    base = { ...s, fin };
  }
  const dec = { ...base.dec }, left = { ...base.tie.teams };
  if (payload && payload.tid) {
    const opts = left[payload.tid];
    if (!opts || !opts.includes(payload.m)) return s;
    dec[payload.tid] = { m: payload.m, how: 'teacher' };
    delete left[payload.tid];
  } else {
    for (const [tid, opts] of Object.entries(left)) { dec[tid] = { m: opts[Math.floor(ctx.rnd() * opts.length) % opts.length], how: 'draw' }; delete left[tid]; }
  }
  const s2 = { ...base, dec };
  if (Object.keys(left).length) return { ...s2, tie: { ...base.tie, teams: left } };
  return toShow({ ...s2, inputKey: null }, ctx);
}

/**
 * 🗣️ 설득상 받는 팀: 돌린 사람(sw)이 SWAY_MIN(2) 이상인 팀 중 sw 가 가장 많은 팀.
 * 셋 이상이면 돌릴 수 있었던 사람(첫 마음이 결정과 달랐던 사람) 중 돌린 비율이 높은 팀.
 * 하루에 많아야 SWAY_MAX(2) 가족 — 그래도 셋 이상 똑같으면 그날은 없음.
 */
export function swayWinners(teams) {
  const ids = Object.keys(teams).filter(id => teams[id].sw >= SWAY_MIN);
  if (!ids.length) return [];
  const best = Math.max(...ids.map(id => teams[id].sw));
  const top = ids.filter(id => teams[id].sw === best);
  if (top.length <= SWAY_MAX) return top;
  const ratio = id => { const x = teams[id]; return x.sw / Math.max(1, x.opp || x.sw); };
  const r = Math.max(...top.map(ratio));
  const top2 = top.filter(id => ratio(id) === r);
  return top2.length <= SWAY_MAX ? top2 : [];   // 그래도 셋 이상 똑같으면 특별하지 않다 — 그날은 설득상 없음(한마음상이 있다)
}

/** 하루 결과: 팀 결정 · 첫 마음 → 다시 투표 · 설득상 · 한마음상 · 반 전체 */
export function roundResult(s, ctx) {
  const n = menusOf(s).length;
  const tw = s.tw !== null && s.tw !== undefined ? roundOf(s).twists[s.tw] : null;
  const about = tw && tw.about ? REASONS.find(r => r.id === tw.about) : null;
  const teamOf = teamMap(ctx);
  const teams = {}, per = {};
  const cls = { c1: countOf([], n), c2: countOf([], n), n1: 0, n2: 0, rs: {}, ch: 0, about: about ? about.id : null, aboutN: 0 };
  for (const v of Object.values(s.v2 || {})) {
    for (const r of reasonsOf(v.rs)) cls.rs[r.id] = (cls.rs[r.id] || 0) + 1;
    if (about && (v.rs & about.bit)) cls.aboutN++;
  }
  for (const t of ctx.teams) {
    const d = (s.dec || {})[t.id] || { m: null, how: 'none' };
    const uids = [...new Set([...Object.keys(s.v1 || {}), ...Object.keys(s.fin || {})])].filter(u => teamOf[u] === t.id);
    const voters = uids.map(u => {
      const a = s.v1[u] && s.v1[u].m !== null ? s.v1[u].m : null;
      const b = s.fin[u] !== undefined ? s.fin[u] : null;
      return { u, role: isProxy(u) ? FAMILY.id : ((s.roles || {})[u] || FAMILY.id), a, b, px: isProxy(u) };
    }).sort((x, y) => ORDER.indexOf(x.role) - ORDER.indexOf(y.role));
    for (const v of voters) {
      if (v.a !== null) { cls.c1[v.a]++; cls.n1++; }
      if (v.b !== null) { cls.c2[v.b]++; cls.n2++; }
      if (v.a !== null && v.b !== null && v.a !== v.b) cls.ch++;
    }
    const real = voters.filter(v => !v.px);
    const sw = d.m === null ? 0 : real.filter(v => v.a !== null && v.b !== null && v.a !== d.m && v.b === d.m).length;
    const opp = d.m === null ? 0 : real.filter(v => v.a !== null && v.a !== d.m).length;   // 첫 마음이 결정과 달랐던 사람
    const ch = voters.filter(v => v.a !== null && v.b !== null && v.a !== v.b).length;
    const firsts = real.filter(v => v.a !== null).map(v => v.a);
    const finals = real.filter(v => v.b !== null).map(v => v.b);
    const uni = d.m !== null && finals.length >= 2 && finals.every(m => m === d.m) && firsts.length >= 2 && new Set(firsts).size > 1;
    const pers = sw ? real.filter(v => v.a === d.m).map(v => v.role) : [];
    for (const v of real) {
      per[v.u] = sw && v.a === d.m ? 'p' : (v.a !== null && v.b !== null && v.a !== v.b ? (v.b === d.m ? 's' : 'c') : (v.a !== null || v.b !== null ? 'k' : ''));
    }
    teams[t.id] = { m: d.m, how: d.how, sw, opp, ch, uni, pers, voters: voters.map(({ role, a, b }) => ({ role, a, b })) };
  }
  const sway = swayWinners(teams);
  const best = sway.length ? teams[sway[0]].sw : 0;
  const uniT = Object.keys(teams).filter(id => teams[id].uni);
  return { teams, cls, sway, best, uniT, per };
}

function toShow(s, ctx) {
  const res = roundResult(s, ctx);
  const hist = [...(s.hist || []).filter(h => h.r !== s.r), {
    r: s.r, tw: s.tw, ch: res.cls.ch, c2: res.cls.c2,
    teams: Object.fromEntries(Object.entries(res.teams).map(([id, x]) => [id, { m: x.m, how: x.how, sw: x.sw, sway: res.sway.includes(id), uni: x.uni }])),
  }];
  return { ...s, step: 'show', inputKey: null, res, hist, tie: null, prog: {} };
}

function nextDay(s, ctx) {
  if (s.r + 1 >= ROUNDS.length) return { ...s, step: 'final', inputKey: null };
  return assignRoles(rotateRoles({ ...s, ...BLANK, r: s.r + 1, step: 'info', inputKey: null }, ctx), ctx);
}

/** 사흘 합계: 팀마다 날별 결정 · 설득상 · 한마음상 수 */
export function summary(s, ctx) {
  const teams = {};
  for (const t of ctx.teams) teams[t.id] = { decs: [], sway: 0, uni: 0, sw: 0 };
  for (const h of s.hist || []) {
    for (const t of ctx.teams) {
      const x = h.teams[t.id];
      teams[t.id].decs[h.r] = x ? x.m : null;
      if (x && x.sway) teams[t.id].sway++;
      if (x && x.uni) teams[t.id].uni++;
      if (x) teams[t.id].sw += x.sw;
    }
  }
  const bestSway = Math.max(0, ...Object.values(teams).map(x => x.sway));
  const king = bestSway > 0 ? Object.keys(teams).filter(id => teams[id].sway === bestSway) : [];
  const ch = (s.hist || []).reduce((a, h) => a + h.ch, 0);
  return { teams, king, bestSway, ch, days: (s.hist || []).length };
}

const game = {
  id: 'dinner',
  title: '가족 저녁 회의',
  lesson: 15,
  minutes: 16,
  emoji: '🍽️',
  blurb: '역할 카드 · 상황 카드로 사흘 동안 가족 식탁 토의',
  intro: {
    headline: '가족 저녁 회의',
    lines: [
      '조종기에 <b>역할 카드</b> — 할머니 · 엄마 · 동생 · 나 … (날마다 바뀐다)',
      '하루 = <b>첫 마음 투표</b> → 90초 회의 → <b>🃏 상황 카드</b> → 다시 투표 → 가족 결정',
      '점수 없음 — 가족 <b>2명 이상</b>의 마음을 움직이면 <b>🗣️ 설득상</b>, 갈렸던 마음이 하나 되면 <b>🤝 한마음상</b>',
    ],
    art: `<div class="art-row" style="font-size:64px"><span>👵</span><span>👩</span><span>🧒</span><span>🧑</span></div>
      <div class="art-big" style="font-size:96px">🍽️</div>
      <div class="art-row" style="font-size:48px"><span>🍖</span><span class="plus">·</span><span>🥛</span><span class="plus">·</span><span>🫘</span><span class="plus">+</span><span>🃏</span></div>
      <div class="art-cap">사흘 동안, 우리 가족 식탁은?</div>`,
  },

  setup(ctx) {
    return assignRoles({ ...BLANK, step: 'info', r: 0, inputKey: null, roles: {}, hist: [] }, ctx);
  },

  onInput(s, inputs, ctx) {
    let n = assignRoles(s, ctx);
    const nM = menusOf(n).length;
    if (n.step === 'vote1') {
      const v1 = foldVotes(inputs, ctx, nM);
      const p = progress(n, v1, ctx, doneMenu);
      return early({ ...n, v1, prog: p.prog }, p, ctx);
    }
    if (n.step === 'vote2') {
      const v2 = foldVotes(inputs, ctx, nM, { reasons: true });
      const p = progress(n, v2, ctx, doneWhy);
      return early({ ...n, v2, prog: p.prog }, p, ctx);
    }
    if (n.step === 'tiev') {
      const tv = foldVotes(inputs, ctx, nM, { allow: n.tie.teams });
      const p = progress(n, tv, ctx, doneMenu, n.tie.teams);
      return early({ ...n, tv, prog: p.prog }, p, ctx);
    }
    return n;
  },

  remap(s, from, to) {
    const ren = m => {
      if (!m || m[from] === undefined) return m;
      const o = { ...m };
      if (o[to] === undefined) o[to] = o[from];
      delete o[from];
      return o;
    };
    const res = s.res ? { ...s.res, per: ren(s.res.per) } : s.res;
    return { ...s, roles: ren(s.roles || {}), v1: ren(s.v1), v2: ren(s.v2), fin: ren(s.fin), tv: ren(s.tv), res };
  },

  tick(s, ctx) {
    const now = ctx.now();
    const n = (s.step === 'final' || s.step === 'wrap') ? s : assignRoles(s, ctx);
    if (n.step === 'vote1' && now >= n.deadline + GRACE_MS) return closeVote1(n, ctx);
    if (n.step === 'talk' && now >= n.deadline) return startTwist(n, ctx);
    if (n.step === 'twist' && now >= n.deadline) return startVote2(n, ctx);
    if (n.step === 'vote2' && now >= n.deadline + GRACE_MS) return closeVote2(n, ctx);
    if (n.step === 'tie' && now >= n.deadline) return startTieVote(n, ctx);
    if (n.step === 'tiev' && now >= n.deadline + GRACE_MS) return closeTieVote(n, ctx);
    return n;
  },

  action(s, name, payload, ctx) {
    const st = s.step;
    const add = sec => ({ ...s, deadline: s.deadline + sec * 1000 });
    if (st === 'info' && name === 'v1') return startVote1(s, ctx);
    if (st === 'vote1') { if (name === 'more') return add(10); if (name === 'close') return { ...s, deadline: ctx.now() }; }
    if (st === 'talk') { if (name === 'more') return add(30); if (name === 'twist') return startTwist(s, ctx); }
    if (st === 'twist') {
      if (name === 'redraw') return { ...s, tw: (s.tw + 1) % roundOf(s).twists.length };
      if (name === 'more') return add(15);
      if (name === 'v2') return startVote2(s, ctx);
    }
    if (st === 'vote2') { if (name === 'more') return add(15); if (name === 'close') return { ...s, deadline: ctx.now() }; }
    if (st === 'tie') {
      if (name === 'more') return add(15);
      if (name === 'tv') return startTieVote(s, ctx);
    }
    if (st === 'tiev' && name === 'close') return { ...s, deadline: ctx.now() };
    if ((st === 'tie' || st === 'tiev') && (name === 'draw' || name === 'pick')) return force(s, ctx, name === 'pick' ? payload : null);
    if (st === 'show') { if (name === 'next') return nextDay(s, ctx); if (name === 'final') return { ...s, step: 'final', inputKey: null }; }
    if (st === 'final' && name === 'wrap') return { ...s, step: 'wrap' };
    if (st === 'wrap') { if (name === 'back') return { ...s, step: 'final' }; if (name === 'finish') return { ...s, done: true }; }
    return s;
  },

  proxyButtons(s, team) {
    const menus = menusOf(s);
    if (s.step === 'vote1') return menus.map((m, i) => ({ label: `${m.emoji} ${m.name}`, input: { m: i } }));
    if (s.step === 'vote2') {
      const cur = (s.v2 || {})['proxy-' + team.id] || { rs: 0 };
      return [
        ...menus.map((m, i) => ({ label: `${m.emoji} ${m.name}`, input: { m: i } })),
        ...REASONS.map(r => ({ label: `${cur.rs & r.bit ? '✓ ' : ''}${r.emoji} ${r.label}`, input: { rs: (cur.rs || 0) ^ r.bit } })),
      ];
    }
    if (s.step === 'tiev' && s.tie && s.tie.teams[team.id]) return s.tie.teams[team.id].map(i => ({ label: `${menus[i].emoji} ${menus[i].name}`, input: { m: i } }));
    return [];
  },

  scoring(s, ctx) {
    const sum = summary(s, ctx);
    const lines = [];
    const name = id => { const t = ctx.teams.find(x => x.id === id); return t ? `${t.emoji} ${esc(t.name)}` : ''; };
    if (sum.king.length) lines.push(`🗣️ 설득왕 가족: ${sum.king.map(name).join(' · ')} — 설득상 ${sum.bestSway}번 (가족의 마음을 가장 많이 움직였다)`);
    const uni = ctx.teams.filter(t => sum.teams[t.id] && sum.teams[t.id].uni > 0);
    if (uni.length) lines.push(`🤝 한마음상: ${uni.map(t => `${name(t.id)}${sum.teams[t.id].uni > 1 ? ` ×${sum.teams[t.id].uni}` : ''}`).join(' · ')}`);
    if (sum.days) lines.push(`🔄 ${sum.days}일 동안 회의 · 상황 카드 뒤 마음을 바꾼 사람 <b>${sum.ch}명</b> — 사정이 바뀌면 결정도 바뀐다`);
    lines.push('정답은 없다 — 생명 기술이 만든 새 먹거리는 <b>근거</b>를 들어 가족이 함께 고른다 (점수 없음)');
    return { points: {}, lines };
  },

  // ── 진행판 ──
  hostView(el, s, ctx) {
    injectCSS('dinner', CSS);
    const now = ctx.now();
    const st = s.step;
    if (st === 'info') {
      if (keyed(el, `info-${s.r}-${rolesKey(s, ctx)}`, hostInfo(s, ctx))) beep(660, 140, 'triangle');
    } else if (st === 'vote1' || st === 'vote2' || st === 'tiev') {
      const k = `${st}-${s.r}-${s.tie ? s.tie.n + Object.keys(s.tie.teams).join('.') : ''}-${ctx.teams.length}-${JSON.stringify(Object.values(s.prog || {}).map(p => p.need))}-${ctx.offline ? 1 : 0}`;
      if (keyed(el, k, st === 'tiev' ? hostTie(s, ctx, true) : hostVote(s, ctx))) beep(784, 140);
      updateVote(el, s, ctx);
    } else if (st === 'talk') {
      if (keyed(el, `talk-${s.r}-${rolesKey(s, ctx)}`, hostTalk(s, ctx))) beep(660, 160, 'triangle');
    } else if (st === 'twist') {
      if (keyed(el, `twist-${s.r}-${s.tw}`, hostTwist(s, ctx))) { beep(523, 120, 'triangle'); setTimeout(() => beep(1046, 220, 'triangle'), 130); }
    } else if (st === 'tie') {
      if (keyed(el, `tie-${s.r}-${s.tie.n}-${Object.keys(s.tie.teams).join('.')}`, hostTie(s, ctx, false))) beep(440, 200, 'square', 0.08);
    } else if (st === 'show') {
      if (keyed(el, `show-${s.r}`, hostShow(s, ctx))) { confetti(el, 40); beep(988, 220, 'triangle'); }
    } else if (st === 'final') {
      if (keyed(el, 'final', hostFinal(s, ctx))) confetti(el, 50);
    } else if (st === 'wrap') {
      keyed(el, 'wrap', hostWrap(s, ctx));
    }
    if (s.deadline && ['vote1', 'talk', 'twist', 'vote2', 'tie', 'tiev'].includes(st)) {
      const left = secsLeft(s.deadline, now);
      timerUpdate(el, left); tickSound(el, left);
    }
    el.querySelectorAll('[data-act]').forEach(b => { b.onclick = () => ctx.act(b.dataset.act); });
    el.querySelectorAll('[data-pick]').forEach(b => { b.onclick = () => ctx.act('pick', { tid: b.dataset.tid, m: Number(b.dataset.pick) }); });
  },

  // ── 조종기 ──
  playView(el, s, me, ctx) {
    injectCSS('dinner', CSS);
    const now = ctx.now();
    const st = s.step;
    const role = (s.roles || {})[me.uid] ? roleOf(s.roles[me.uid]) : null;
    if (!role && !['show', 'final', 'wrap'].includes(st)) {
      return keyed(el, 'norole', '<div class="pv-center"><div class="pv-huge">🎴</div><div class="pv-big">역할 카드를 나눠 주는 중…</div><p class="pv-sub">화면을 보세요</p></div>');
    }
    if (st === 'info') {
      if (el.__lr !== s.r) { el.__lr = s.r; el.__li = 0; }   // 새 날: 그날 대사부터
      if (keyed(el, `pi-${s.r}-${role.id}`, playRole(s, role))) {
        const lines = [roundOf(s).say[role.id], ...role.lines].filter(Boolean);
        text(el, '.dr-line', lines[(el.__li || 0) % lines.length]);
        const b = el.querySelector('.dr-next');
        if (b) b.onclick = () => { el.__li = (el.__li || 0) + 1; text(el, '.dr-line', lines[el.__li % lines.length]); };
      }
    } else if (st === 'vote1') {
      const m = me.mine && Number.isInteger(me.mine.m) ? me.mine.m : null;
      if (keyed(el, `p1-${s.r}-${m}`, playMenu(s, role, m, 'first'))) {
        el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => ctx.send({ m: Number(b.dataset.m) }));
      }
      text(el, '.dv-left', secsLeft(s.deadline, now));
    } else if (st === 'talk') {
      const fam = familyOf(s, me.team);
      keyed(el, `pt-${s.r}-${role.id}-${JSON.stringify(fam)}`, playTalk(s, role, me, fam));
      const left = secsLeft(s.deadline, now);
      text(el, '.dr-left', left);
      el.querySelector('.dr-time')?.classList.toggle('hot', left <= 5);
    } else if (st === 'twist') {
      keyed(el, `pw-${s.r}-${s.tw}-${role.id}`, playTwist(s, role));
      text(el, '.dr-left', secsLeft(s.deadline, now));
    } else if (st === 'vote2') {
      const mine = me.mine || {};
      const m = Number.isInteger(mine.m) ? mine.m : null;
      const rs = clampReasons(mine.rs, false);
      const editing = el.dataset.edit === '1' || m === null;
      const first = s.v1 && s.v1[me.uid] ? s.v1[me.uid].m : null;
      if (keyed(el, `p2-${s.r}-${editing ? 'menu' : 'why'}-${m}-${rs}`, editing ? playMenu(s, role, m, 'again', first) : playWhy(s, role, m, rs, first))) {
        el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { el.dataset.edit = ''; ctx.send({ m: Number(b.dataset.m), rs }); });
        el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
          const bit = Number(b.dataset.r);
          if (!(rs & bit) && countBits(rs) >= MAX_REASONS) {
            const w = el.querySelector('.dv-warn');
            if (w) { w.textContent = `근거는 ${MAX_REASONS}개까지! 하나를 끄고 골라요`; w.classList.add('on'); }
            return;
          }
          ctx.send({ m, rs: rs ^ bit });
        });
        const ch = el.querySelector('.dv-change');
        if (ch) ch.onclick = () => { el.dataset.edit = '1'; el.dataset.key = ''; game.playView(el, s, me, ctx); };
      }
      text(el, '.dv-left', secsLeft(s.deadline, now));
    } else if (st === 'tie' || st === 'tiev') {
      const opts = s.tie && s.tie.teams[me.team];
      const m = st === 'tiev' && me.mine && Number.isInteger(me.mine.m) ? me.mine.m : null;
      if (keyed(el, `ptie-${st}-${s.r}-${s.tie ? s.tie.n : 0}-${opts ? opts.join('.') : 'x'}-${m}`, playTie(s, role, opts, st, m))) {
        el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => ctx.send({ m: Number(b.dataset.m) }));
      }
      text(el, '.dv-left', secsLeft(s.deadline, now));
    } else if (st === 'show') {
      keyed(el, `ps-${s.r}`, playShow(s, me));
    } else if (st === 'final') {
      keyed(el, 'pf', playFinal(s, me));
    } else {
      keyed(el, 'pwrap', `<div class="pv-center"><div class="pv-eyebrow">정리</div><div class="pv-huge">⚖️</div>
        <div class="pv-big">우리 집은 무엇을 가장 먼저 볼까?</div>
        <p class="pv-sub">가격 · 건강 · 맛 · 환경 · 동물 · 영양 — 옆 친구에게 한 줄로 말해 봐요</p></div>`);
    }
  },
};
export default game;

function early(n, p, ctx) {
  let { deadline, early: e } = n;
  if (p.any && p.all && deadline - ctx.now() > 3000) { deadline = ctx.now() + 3000; e = true; }
  return { ...n, deadline, early: e };
}

/** 격자 열 수: 1~4팀 = 팀 수, 5~6팀 = 3열, 7팀 이상 = 4열 */
const colsOf = n => (n <= 4 ? Math.max(1, n) : n <= 6 ? 3 : 4);

function rolesKey(s, ctx) {
  return ctx.teams.map(t => (t.members || []).filter(u => !isProxy(u)).map(u => (s.roles || {})[u] || '-').join('.')).join('|');
}

/** 한 팀의 첫 마음: [[역할, 메뉴], …] (역할 순서) */
function familyOf(s, tid) {
  return Object.entries(s.v1 || {}).filter(([, v]) => v.tid === tid && v.m !== null)
    .map(([u, v]) => [isProxy(u) ? FAMILY.id : ((s.roles || {})[u] || FAMILY.id), v.m, u])
    .sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
}

// ── 진행판 그리기 ──
function dayDots(s) {
  return `<span class="d-days" aria-label="${s.r + 1}/${ROUNDS.length}일째">${ROUNDS.map((R, i) => `<i class="${i < s.r ? 'past' : i === s.r ? 'now' : ''}">${R.emoji}</i>`).join('')}</span>`;
}
function head(s, title, timer = '') {
  const R = roundOf(s);
  return `<div class="d-top"><div>
      <div class="eyebrow">가족 저녁 회의 · ${s.r + 1}일째 ${esc(R.day)} · ${esc(R.topic)} ${dayDots(s)}</div>
      <h1 class="d-title">${title}</h1>
    </div>${timer}</div>`;
}

function menuCards(s, mode = 'full') {
  const R = roundOf(s);
  if (mode === 'strip') {
    return `<div class="d-strip">${R.menus.map((m, i) => `<span class="d-sm"><b class="d-smn">${i + 1}</b><span aria-hidden="true">${m.emoji}</span> ${esc(m.name)}</span>`).join('')}</div>`;
  }
  return `<div class="d-menus ${mode === 'compact' ? 'compact' : ''}">
    ${R.menus.map((m, i) => `
    <div class="d-menu" style="animation-delay:${(i * 0.12).toFixed(2)}s">
      <div class="d-mh">
        <span class="d-me" aria-hidden="true">${m.emoji}</span>
        <div class="d-mt"><b>${esc(m.name)}</b><span>생명 기술: ${esc(m.tech)}</span></div>
      </div>
      ${mode === 'compact' ? '' : `<div class="d-rows">${R.rows.map(id => `<div class="d-row"><span class="d-rl">${ROW_DEFS[id].emoji} ${ROW_DEFS[id].label}</span><span class="d-rv">${esc(m.rows[id] || '')}</span></div>`).join('')}</div>`}
    </div>`).join('')}
  </div>`;
}

function rolesLegend(s, ctx) {
  const used = new Set(Object.values(s.roles || {}));
  const list = ROLES.filter(r => used.has(r.id));
  const show = ctx.offline || !list.length ? ROLES.slice(0, 6) : list;
  return `<div class="d-legend"><span class="d-lgh">${ctx.offline || !list.length ? '역할 카드' : '오늘의 역할'}</span>${show.map(r => `<span class="d-lg">${r.emoji} <b>${r.name}</b> ${esc(r.care)}</span>`).join('')}</div>`;
}

function hostInfo(s, ctx) {
  const R = roundOf(s);
  return `
  <div class="d-wrap">
    ${head(s, `${R.emoji} ${esc(R.q)}`)}
    ${menuCards(s)}
    ${rolesLegend(s, ctx)}
    <div class="d-foot"><button class="btn big" data-act="v1">🗳️ 첫 마음 투표 (${VOTE1_SECONDS}초) ▶</button>
      <span class="gk-hint">${ctx.offline ? '팀마다 역할을 나눠 맡아요 (위 역할 카드)' : s.r ? '역할이 <b>한 칸씩 바뀌었어요</b> — 조종기의 새 역할 대사를 소리 내어 읽어요' : '조종기에 <b>내 역할 카드</b>가 떴어요 — 역할 대사를 소리 내어 읽어요'} · 정보는 예시예요</span></div>
  </div>`;
}

function progGrid(s, ctx, only) {
  const teams = ctx.teams.filter(t => !only || only[t.id]);
  return `<div class="d-prog" style="--n:${colsOf(teams.length)}">
      ${teams.map(t => `
      <div class="d-pt" data-tid="${t.id}" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}">
        <div class="d-pth"><div class="d-ptn">${t.emoji} ${esc(t.name)}</div>
        <div class="d-ptc"><b class="num d-ptd">0</b><span class="d-ptneed">/0명 냈어요</span></div></div>
        ${only ? `<div class="d-picks">${only[t.id].map(i => `<button class="d-pk" data-tid="${t.id}" data-pick="${i}" title="선생님이 이 메뉴로 정하기">${menusOf(s)[i].emoji} ${esc(menusOf(s)[i].name)}</button>`).join('')}</div>` : '<div class="d-ptw"></div>'}
      </div>`).join('')}
    </div>`;
}

function hostVote(s, ctx) {
  const first = s.step === 'vote1';
  const tw = !first && s.tw !== null ? roundOf(s).twists[s.tw] : null;
  return `
  <div class="d-wrap">
    ${head(s, first
    ? (ctx.offline ? '첫 마음 — 팀이 먼저 떠올린 메뉴를 선생님이 눌러요' : '🤫 첫 마음 투표 — 내 역할이라면? (아직 비밀)')
    : (ctx.offline ? '다시 투표 — 팀이 정한 메뉴 + 근거를 선생님이 눌러요' : '🗳️ 다시 투표! 메뉴 + 근거 1~2개'), timerHTML('투표'))}
    ${tw ? `<div class="d-twr"><span class="d-twre" aria-hidden="true">${tw.emoji}</span><b>🃏 ${esc(tw.head)}</b>${ctx.offline || ctx.teams.length > 4 ? '' : `<span>${esc(tw.body)}</span>`}</div>` : ''}
    ${menuCards(s, 'strip')}
    ${progGrid(s, ctx)}
    <div class="d-foot"><button class="btn ghost" data-act="more">＋${first ? 10 : 15}초</button><button class="btn" data-act="close">바로 마감 ▶</button>
      <span class="gk-hint">${first ? '혼자, 역할대로 고르기 — 결과는 회의 때 한꺼번에 공개!' : '마음이 바뀌었으면 바꿔도 돼요 — 다 내면 3초 뒤 마감'}</span></div>
  </div>`;
}

function updateVote(el, s, ctx) {
  for (const t of ctx.teams) {
    const p = (s.prog || {})[t.id] || { done: 0, need: 0, who: [] };
    const box = el.querySelector(`.d-pt[data-tid="${t.id}"]`);
    if (!box) continue;
    text(box, '.d-ptd', p.done);
    text(box, '.d-ptneed', `/${p.need}명 냈어요`);
    const realDone = p.who.filter(w => w[1]).length;
    const html = p.who.map(([r, d]) => `<span class="d-w ${d ? 'on' : ''}">${roleOf(r).emoji}${d ? '✓' : '…'}</span>`).join('')
      + (ctx.offline || p.need > p.who.length ? `<span class="d-w ${p.done > realDone ? 'on' : ''}">👪${p.done > realDone ? '✓' : '…'}</span>` : '');
    const w = box.querySelector('.d-ptw');
    if (w && w.__h !== html) { w.__h = html; w.innerHTML = html; }
    box.classList.toggle('done', p.need > 0 && p.done >= p.need);
  }
}

function chipFirst(role, m, menus) {
  return `<span class="d-v"><span aria-hidden="true">${roleOf(role).emoji}</span>${menus[m].emoji}</span>`;
}

function hostTalk(s, ctx) {
  const menus = menusOf(s);
  return `
  <div class="d-wrap">
    ${head(s, '우리 가족 첫 마음 공개! 🗣️ 90초 회의', timerHTML('회의'))}
    ${menuCards(s, 'strip')}
    <div class="d-fam" style="--n:${Math.max(2, colsOf(ctx.teams.length))}">
      ${ctx.teams.map(t => {
        const fam = familyOf(s, t.id);
        const kinds = new Set(fam.map(f => f[1])).size;
        const tag = !fam.length ? '<span class="d-ft dim">표 없음</span>' : kinds > 1 ? '<span class="d-ft hot">갈렸어요!</span>' : '<span class="d-ft">모두 같아요</span>';
        return `<div class="d-fc" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}">
          <div class="d-fch"><span class="d-tcn">${t.emoji} ${esc(t.name)}</span>${tag}</div>
          <div class="d-voters">${fam.map(f => chipFirst(f[0], f[1], menus)).join('')}</div>
        </div>`;
      }).join('')}
    </div>
    <div class="d-steps">
      <span><b>①</b> 다른 메뉴를 고른 가족에게 「왜?」</span><span class="d-ar">→</span>
      <span><b>②</b> 「내 역할은 ○○가 중요해서 ○○!」</span><span class="d-ar">→</span>
      <span><b>③</b> 설득되면 다시 투표에서 바꾸기</span>
    </div>
    <div class="d-foot"><button class="btn ghost" data-act="more">＋30초</button><button class="btn" data-act="twist">🃏 상황 카드 ▶</button>
      <span class="gk-hint">시간이 끝나면 상황 카드가 나와요 — 가족 사정이 바뀐다!</span></div>
  </div>`;
}

function twistCard(tw, big = true) {
  const about = tw.about ? REASONS.find(r => r.id === tw.about) : null;
  return `<div class="d-tw ${big ? 'big' : ''}">
    <div class="d-twl">🃏 상황 카드</div>
    <div class="d-twe" aria-hidden="true">${tw.emoji}</div>
    <div class="d-twb"><b>${esc(tw.head)}</b><p>${esc(tw.body)}</p>
      <div class="d-twwho"><span>특히 신경 쓸 가족</span>${tw.who.map(id => `<span class="d-twr2">${roleOf(id).emoji} ${roleOf(id).name}</span>`).join('')}${about ? `<span class="d-twa">${about.emoji} ${about.label}</span>` : ''}</div>
    </div>
  </div>`;
}

function hostTwist(s, ctx) {
  const tw = roundOf(s).twists[s.tw];
  return `
  <div class="d-wrap">
    ${head(s, '사정이 바뀌었다! 🃏', timerHTML('짧은 회의'))}
    ${twistCard(tw)}
    ${menuCards(s, 'strip')}
    <div class="d-foot"><button class="btn ghost" data-act="redraw">🔄 다른 카드</button><button class="btn ghost" data-act="more">＋15초</button><button class="btn" data-act="v2">🗳️ 다시 투표 ▶</button>
      <span class="gk-hint">이 카드로 우리 가족 결정이 바뀔까? 짧게 이야기한 뒤 다시 투표</span></div>
  </div>`;
}

function hostTie(s, ctx, voting) {
  const teams = s.tie ? s.tie.teams : {};
  const menus = menusOf(s);
  const done = ctx.teams.filter(t => !teams[t.id] && s.dec[t.id] && s.dec[t.id].m !== null);
  return `
  <div class="d-wrap">
    ${head(s, voting ? '동률 가족만 다시 투표! 🗳️' : `동률! ${TIE_TALK_SECONDS}초 더 회의 ⏱${s.tie && s.tie.n > 1 ? ` (${s.tie.n}번째)` : ''}`, timerHTML(voting ? '투표' : '회의'))}
    ${voting ? progGrid(s, ctx, teams) : `
    <div class="d-ties ${Object.keys(teams).length > 2 ? 'many' : ''}" style="--n:${colsOf(Object.keys(teams).length)}">
      ${ctx.teams.filter(t => teams[t.id]).map(t => `
      <div class="d-tie" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}">
        <div class="d-ptn">${t.emoji} ${esc(t.name)}</div>
        <div class="d-vs">${teams[t.id].map((i, k) => `${k ? '<span class="d-vsx">vs</span>' : ''}<button class="d-pk big" data-tid="${t.id}" data-pick="${i}" title="선생님이 이 메뉴로 정하기">${menus[i].emoji}<span>${esc(menus[i].name)}</span></button>`).join('')}</div>
      </div>`).join('')}
    </div>`}
    ${done.length ? `<div class="d-done"><span class="d-lgh">결정 끝</span>${done.map(t => `<span class="d-lg">${t.emoji} ${esc(t.name)} ${menus[s.dec[t.id].m].emoji}</span>`).join('')}</div>` : ''}
    <div class="d-foot">${voting ? '<button class="btn" data-act="close">바로 마감 ▶</button>' : `<button class="btn ghost" data-act="more">＋15초</button><button class="btn" data-act="tv">🗳️ 바로 다시 투표 ▶</button>`}
      <button class="btn ghost" data-act="draw">🎲 남은 동률은 선생님이 정하기</button>
      <span class="gk-hint">빠르기로 정하지 않아요 · 메뉴를 누르면 그 가족 결정을 선생님이 정해요</span></div>
  </div>`;
}

const HOW = { tie: '동률 → 더 회의해서 결정', draw: '🎲 동률 → 제비뽑기', teacher: '동률 → 선생님이 정함', first: '다시 투표 없음 → 첫 마음으로', none: '' };

function voterChip(v, menus) {
  const R = roleOf(v.role);
  if (v.a !== null && v.b !== null && v.a !== v.b) {
    return `<span class="d-v ch" title="${esc(R.name)}: 마음 바꿈"><span aria-hidden="true">${R.emoji}</span>${menus[v.a].emoji}<i class="d-arw" aria-label="에서">→</i>${menus[v.b].emoji}</span>`;
  }
  const m = v.b !== null ? v.b : v.a;
  return `<span class="d-v" title="${esc(R.name)}"><span aria-hidden="true">${R.emoji}</span>${m !== null ? menus[m].emoji : '…'}</span>`;
}

function hostShow(s, ctx) {
  const res = s.res;
  const menus = menusOf(s);
  const dense = ctx.teams.length > 4;
  const max = Math.max(1, ...res.cls.c1, ...res.cls.c2);
  const tw = s.tw !== null && s.tw !== undefined ? roundOf(s).twists[s.tw] : null;
  const about = res.cls.about ? REASONS.find(r => r.id === res.cls.about) : null;
  const last = s.r + 1 >= ROUNDS.length;
  const topR = Object.entries(res.cls.rs).sort((a, b) => b[1] - a[1])[0];
  return `
  <div class="d-wrap">
    ${head(s, `${s.r + 1}일째 가족 결정!${res.sway.length ? ' 🗣️ 설득상' : ''}${res.uniT.length ? ' · 🤝 한마음상' : ''}`)}
    <div class="d-show ${dense ? 'dense' : ''}">
      <div class="d-tcs ${dense ? 'dense' : ''}" style="--rows:${Math.max(2, Math.ceil(ctx.teams.length / 2))}">
        ${ctx.teams.map((t, i) => {
          const r = res.teams[t.id] || { m: null, how: 'none', voters: [], sw: 0, ch: 0, uni: false, pers: [] };
          const sway = res.sway.includes(t.id);
          const M = r.m !== null ? menus[r.m] : null;
          return `<div class="d-tc ${sway || r.uni ? 'badge' : ''}" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text};animation-delay:${(i * 0.08).toFixed(2)}s">
            <div class="d-tch"><span class="d-tcn">${t.emoji} ${esc(t.name)}</span>
              <span class="d-bdg">${sway ? '<span class="d-badge" title="설득상">🗣️<span class="d-bt"> 설득상</span></span>' : ''}${r.uni ? '<span class="d-badge uni" title="한마음상">🤝<span class="d-bt"> 한마음</span></span>' : ''}</span></div>
            <div class="d-dec">${M ? `<span class="d-dece" aria-hidden="true">${M.emoji}</span><b>${esc(M.name)}</b>${HOW[r.how] ? `<small>${HOW[r.how]}</small>` : ''}` : '<b class="dim">못 정했어요</b>'}</div>
            <div class="d-voters">${r.voters.map(v => voterChip(v, menus)).join('') || '<span class="dim">표 없음</span>'}</div>
            <div class="d-sw">${r.ch ? `🔄 <b class="num">${r.ch}</b>명 마음 바꿈` : '마음 바꾼 사람 없음'}${r.sw ? ` · 설득한 가족 ${r.pers.map(id => roleOf(id).emoji).join('')}` : ''}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="d-cls">
        <div class="d-clsh">우리 반 전체 · <span class="d-k1">첫 마음</span> → <span class="d-k2">다시 투표</span></div>
        ${menus.map((m, i) => `<div class="d-cb">
            <div class="d-cbh"><span>${m.emoji} ${esc(m.name)}</span><b class="num">${res.cls.c1[i]}<i class="d-arw">→</i>${res.cls.c2[i]}표</b></div>
            <div class="d-cbar k1"><i style="width:${(res.cls.c1[i] / max * 100).toFixed(1)}%"></i></div>
            <div class="d-cbar k2"><i style="width:${(res.cls.c2[i] / max * 100).toFixed(1)}%"></i></div>
          </div>`).join('')}
        <p class="d-topr">🔄 마음을 바꾼 사람 <b class="num">${res.cls.ch}</b>명${tw ? ` · 🃏 ${esc(tw.head)}${about ? ` → ${about.emoji} ${about.label}을(를) 근거로 쓴 사람 <b class="num">${res.cls.aboutN}</b>명` : ''}` : ''}${topR ? ` · 가장 많이 쓴 근거 ${REASONS.find(x => x.id === topR[0]).emoji} <b>${REASONS.find(x => x.id === topR[0]).label}</b>` : ''}</p>
      </div>
    </div>
    <div class="d-foot">${last ? '<button class="btn" data-act="next">사흘 결과 ▶</button>' : `<button class="btn" data-act="next">다음 날 저녁 ▶ (${s.r + 2}/${ROUNDS.length})</button><button class="btn ghost" data-act="final">여기까지 · 결과 ▶</button>`}
      <span class="gk-hint">🗣️ 설득상 = 첫 마음과 다른 가족을 결정 쪽으로 ${SWAY_MIN}명 이상 돌린 팀 중 최고(하루 ${SWAY_MAX}가족까지) · 🤝 한마음 = 갈렸던 마음이 모두 같아짐</span></div>
  </div>`;
}

function hostFinal(s, ctx) {
  const sum = summary(s, ctx);
  const days = ROUNDS.slice(0, Math.max(1, sum.days));
  const dense = ctx.teams.length > 5;
  return `
  <div class="d-wrap">
    <div class="d-top"><div>
      <div class="eyebrow">가족 저녁 회의 · ${sum.days}일 동안</div>
      <h1 class="d-title">${!sum.king.length ? '우리 가족들의 식탁' : sum.king.length > 3 ? `🗣️ 설득왕 가족 ${sum.king.length}팀 — 설득상 ${sum.bestSway}번씩` : `🗣️ 설득왕 가족: ${sum.king.map(id => { const t = ctx.teams.find(x => x.id === id); return `${t.emoji} ${esc(t.name)}`; }).join(' · ')}`}</h1>
    </div></div>
    <div class="d-fin ${dense ? 'dense' : ''}" style="--d:${days.length}">
      <div class="d-frow d-fhd"><span>가족</span>${days.map(R => `<span>${R.emoji} ${esc(R.topic)}</span>`).join('')}<span>상</span></div>
      ${ctx.teams.map((t, i) => {
        const x = sum.teams[t.id];
        return `<div class="d-frow ${sum.king.includes(t.id) ? 'king' : ''}" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text};animation-delay:${(i * 0.06).toFixed(2)}s">
          <span class="d-tcn">${t.emoji} ${esc(t.name)}</span>
          ${days.map((R, d) => { const m = x.decs[d]; return `<span class="d-fd">${m !== null && m !== undefined ? `<i aria-hidden="true">${R.menus[m].emoji}</i>${esc(R.menus[m].name)}` : '<span class="dim">—</span>'}</span>`; }).join('')}
          <span class="d-fb">${x.sway ? `<b>🗣️×${x.sway}</b>` : ''}${x.uni ? `<b>🤝×${x.uni}</b>` : ''}${!x.sway && !x.uni ? '<span class="dim">—</span>' : ''}</span>
        </div>`;
      }).join('')}
    </div>
    <p class="gk-note">🔄 ${sum.days}일 동안 마음을 바꾼 사람 <b>${sum.ch}명</b> — 가족 사정(상황 카드)이 바뀌면 고르는 기준도, 결정도 바뀐다.</p>
    <div class="d-foot"><button class="btn" data-act="wrap">정리 ▶</button><span class="gk-hint">이 게임은 점수가 없어요 — 상은 회의를 잘한 가족에게</span></div>
  </div>`;
}

function hostWrap(s, ctx) {
  const sum = summary(s, ctx);
  return `
  <div class="d-wrap">
    <div class="d-top"><div>
      <div class="eyebrow">정리 · 식품 생명 기술과 우리 가족 식탁</div>
      <h1 class="d-title">정답은 없다 — <span class="d-hl">근거</span>가 있다</h1>
    </div></div>
    <div class="d-wraps">
      ${WRAP.map((w, i) => `<div class="d-wc" style="animation-delay:${(i * 0.15).toFixed(2)}s"><div class="d-wce">${w.emoji}</div><b>${esc(w.head)}</b><p>${esc(w.body)}</p></div>`).join('')}
    </div>
    <p class="gk-note">💬 한 줄 말하기: 「우리 집은 식탁 메뉴를 고를 때 <b>○○</b>을(를) 가장 먼저 본다. 왜냐하면 ○○ 때문이다.」</p>
    ${sum.king.length ? `<p class="d-bline">🗣️ 설득왕 가족: ${sum.king.map(id => { const t = ctx.teams.find(x => x.id === id); return `${t.emoji} ${esc(t.name)}`; }).join(' · ')} — 설득상 ${sum.bestSway}번</p>` : ''}
    <div class="d-foot"><button class="btn ghost" data-act="back">◀ 결과 다시 보기</button><button class="btn" data-act="finish">끝내기 ▶</button>
      <span class="gk-hint">이 게임은 점수가 없어요</span></div>
  </div>`;
}

// ── 조종기 그리기 ──
function careChips(role) {
  if (!role.cares.length) return `<span class="dr-c">${esc(role.care)}</span>`;
  return role.cares.map(id => { const r = REASONS.find(x => x.id === id); return `<span class="dr-c">${r.emoji} ${r.label}</span>`; }).join('');
}

function playRole(s, role) {
  const R = roundOf(s);
  return `
  <div class="dr">
    <div class="dr-head"><span class="pv-eyebrow">${s.r + 1}일째 ${esc(R.day)} · ${esc(R.topic)} · 내 역할 카드</span>${s.r ? '<span class="dr-new">🔄 역할이 바뀌었어요</span>' : ''}</div>
    <div class="dr-card">
      <div class="dr-who"><span class="dr-e" aria-hidden="true">${role.emoji}</span><span class="dr-im">나는</span><b class="dr-n">${esc(role.name)}</b></div>
      <div class="dr-right">
        <div class="dr-care"><span class="dr-cl">내가 중요하게 여기는 것</span><div class="dr-cs">${careChips(role)}</div></div>
        <div class="dr-say"><span class="dr-sl">📢 역할 대사 — 소리 내어 읽어요</span><p class="dr-line"></p>
          <button class="btn ghost dr-next">🔁 다른 대사</button></div>
      </div>
    </div>
    <p class="dr-tip">선생님 화면의 메뉴 정보를 보고 — 곧 「첫 마음」 투표!</p>
  </div>`;
}

function playMenu(s, role, m, kind, first = null) {
  const menus = menusOf(s);
  const q = kind === 'first' ? `🤫 첫 마음 — 내 역할(${role.emoji} ${esc(role.name)})이라면?` : '🗳️ 다시 투표 — 지금 마음은?';
  return `
  <div class="dv ${kind}">
    <div class="dv-head"><span class="pv-eyebrow">${kind === 'first' ? '첫 마음 (비밀)' : '다시 투표'} · ${role.emoji} ${esc(role.name)}</span><span class="dv-time"><b class="dv-left num">--</b>초</span></div>
    <h2 class="dv-q">${q}</h2>
    <div class="dv-menus">
      ${menus.map((x, i) => `<button class="dv-m ${m === i ? 'on' : ''}" data-m="${i}" aria-pressed="${m === i}">
        <span class="dv-me" aria-hidden="true">${x.emoji}</span><b>${esc(x.name)}</b><span class="dv-mt">${esc(x.tech)}</span>
        ${m === i ? '<span class="dv-ok">✓ 고름</span>' : first === i ? '<span class="dv-ok was">첫 마음</span>' : ''}</button>`).join('')}
    </div>
    <p class="dv-tip">${kind === 'first' ? `중요하게 여기는 것: ${careChips(role)}${m !== null ? ' · <b class="dv-okt">✓ 냈어요 — 시간 안엔 바꿀 수 있어요</b>' : ''}` : `${first !== null ? `첫 마음: ${menus[first].emoji} ${esc(menus[first].name)} · ` : ''}설득됐으면 바꿔도 돼요!`}</p>
  </div>`;
}

function playWhy(s, role, m, rs, first) {
  const M = menusOf(s)[m];
  const n = countBits(rs);
  const changed = first !== null && first !== m;
  return `
  <div class="dv">
    <div class="dv-head"><span class="pv-eyebrow">다시 투표 · ${role.emoji} ${esc(role.name)}</span><span class="dv-time"><b class="dv-left num">--</b>초</span></div>
    <div class="dv-sel"><span class="dv-sele" aria-hidden="true">${M.emoji}</span><b>${esc(M.name)}${changed ? ' <small class="dv-chg">🔄 마음 바꿈</small>' : ''}</b><button class="btn ghost dv-change">메뉴 바꾸기</button></div>
    <h2 class="dv-q">왜? 근거를 1~${MAX_REASONS}개 골라요 <span class="dv-star">⭐ = 내 역할이 중요하게 여기는 것 · 상황 카드도 근거가 돼요</span></h2>
    <div class="dv-rs">
      ${REASONS.map(r => { const on = (rs & r.bit) !== 0; return `<button class="dv-r ${on ? 'on' : ''}" data-r="${r.bit}" aria-pressed="${on}">
        <span class="dv-re" aria-hidden="true">${r.emoji}</span><b>${r.label}</b>${role.cares.includes(r.id) ? '<span class="dv-rstar" aria-label="내 역할이 중요하게 여기는 것">⭐</span>' : ''}${on ? '<span class="dv-ok">✓</span>' : ''}</button>`; }).join('')}
    </div>
    <p class="dv-status ${n ? 'ok' : ''}">${n ? '✓ 냈어요! 시간 안에는 바꿀 수 있어요' : '근거를 골라야 투표가 끝나요'}</p>
    <p class="dv-warn" aria-live="polite"></p>
  </div>`;
}

function playTalk(s, role, me, fam) {
  const menus = menusOf(s);
  const kinds = new Set(fam.map(f => f[1])).size;
  const mine = fam.find(f => f[2] === me.uid);
  const other = mine ? fam.find(f => f[1] !== mine[1]) : null;
  return `
  <div class="dr">
    <div class="dr-head"><span class="pv-eyebrow">가족 회의 · ${role.emoji} 나는 ${esc(role.name)}</span><span class="dr-time">회의 <b class="dr-left num">--</b>초</span></div>
    <div class="dt">
      <div class="dt-h">우리 가족 첫 마음 ${!fam.length ? '' : kinds > 1 ? '<span class="dt-tag hot">갈렸어요!</span>' : '<span class="dt-tag">모두 같아요</span>'}</div>
      <div class="dt-list">${fam.map(f => `<div class="dt-f ${f[2] === me.uid ? 'me' : ''}">${f[2] === me.uid ? '<span class="dt-you">내 표</span>' : ''}<span class="dt-r">${roleOf(f[0]).emoji}<small>${roleOf(f[0]).name}</small></span><span class="dt-m">${menus[f[1]].emoji}<small>${esc(menus[f[1]].name)}</small></span></div>`).join('') || '<p class="pv-sub">첫 마음 표가 없어요 — 입으로 말해요!</p>'}</div>
    </div>
    <p class="dr-tip">${other ? `🗣️ ${roleOf(other[0]).emoji} ${roleOf(other[0]).name}에게 물어봐요: 「왜 ${esc(menus[other[1]].name)}?」` : kinds === 1 && fam.length > 1 ? '🤔 모두 같아요 — 정말 그게 최선일까? 다른 메뉴의 좋은 점도 찾아봐요' : '🗣️ 「내 역할은 ○○가 중요해서 ○○!」'} · 내 역할: ${careChips(role)}</p>
  </div>`;
}

function playTwist(s, role) {
  const tw = roundOf(s).twists[s.tw];
  const mine = tw.who.includes(role.id);
  return `
  <div class="dr">
    <div class="dr-head"><span class="pv-eyebrow">상황이 바뀌었다! · ${role.emoji} ${esc(role.name)}</span><span class="dr-time">짧은 회의 <b class="dr-left num">--</b>초</span></div>
    ${twistCard(tw, false)}
    <p class="dr-tip ${mine ? 'me' : ''}">${mine ? `⚡ 내 역할(${role.emoji} ${esc(role.name)})과 관련 있어요! 가족에게 먼저 말해 봐요` : '이 카드로 우리 가족 결정이 바뀔까? 곧 다시 투표!'}</p>
  </div>`;
}

function playTie(s, role, opts, st, m) {
  const menus = menusOf(s);
  if (!opts) {
    return `<div class="pv-center"><div class="pv-eyebrow">기다리는 중</div><div class="pv-huge">✅</div>
      <div class="pv-big">우리 가족은 결정 끝!</div><p class="pv-sub">동률인 가족이 더 회의하고 있어요</p>
      <p class="pv-q">💬 기다리는 동안: 우리 가족이 이 메뉴를 고른 까닭을 한 줄로 말해 봐요</p></div>`;
  }
  if (st === 'tie') {
    return `<div class="dv">
      <div class="dv-head"><span class="pv-eyebrow">동률! · ${role.emoji} ${esc(role.name)}</span><span class="dv-time"><b class="dv-left num">--</b>초</span></div>
      <h2 class="dv-q">⚖️ 우리 가족 표가 똑같이 갈렸어요 — ${TIE_TALK_SECONDS}초 더 회의!</h2>
      <div class="dv-menus ${opts.length === 2 ? 'vs' : ''}" style="--c:${opts.length * 2 - 1}">${opts.map(i => `<div class="dv-m still"><span class="dv-me" aria-hidden="true">${menus[i].emoji}</span><b>${esc(menus[i].name)}</b></div>`).join('<span class="dv-vs">vs</span>')}</div>
      <p class="dv-tip">빠르기로 정하지 않아요 — 서로 한 번씩 더 설득하고, 곧 다시 투표!</p>
    </div>`;
  }
  return `<div class="dv tiev">
    <div class="dv-head"><span class="pv-eyebrow">동률 다시 투표 · ${role.emoji} ${esc(role.name)}</span><span class="dv-time"><b class="dv-left num">--</b>초</span></div>
    <h2 class="dv-q">회의 끝! 이제 둘 중 하나</h2>
    <div class="dv-menus" style="--c:${opts.length}">${opts.map(i => `<button class="dv-m ${m === i ? 'on' : ''}" data-m="${i}" aria-pressed="${m === i}">
      <span class="dv-me" aria-hidden="true">${menus[i].emoji}</span><b>${esc(menus[i].name)}</b>${m === i ? '<span class="dv-ok">✓ 고름</span>' : ''}</button>`).join('')}</div>
    <p class="dv-tip">${m !== null ? '✓ 냈어요 — 시간 안엔 바꿀 수 있어요' : '가족 결정을 위해 꼭 눌러요!'}</p>
  </div>`;
}

function playShow(s, me) {
  const res = s.res;
  const menus = menusOf(s);
  const r = res && res.teams[me.team];
  const M = r && r.m !== null ? menus[r.m] : null;
  const a = s.v1 && s.v1[me.uid] ? s.v1[me.uid].m : null;
  const b = s.fin && s.fin[me.uid] !== undefined ? s.fin[me.uid] : null;
  const tag = res && res.per ? res.per[me.uid] : '';
  const msg = {
    p: `🗣️ 설득 성공! 처음부터 ${M ? esc(M.name) : ''} — 가족 ${r ? r.sw : 0}명이 따라왔어요`,
    s: '🔄 회의 뒤 마음을 바꿔 가족 결정에 함께했어요 — 무엇이 마음을 바꿨나요?',
    c: '🔄 마음을 바꿨어요 — 무엇이 마음을 바꿨나요?',
    k: '🧱 끝까지 내 생각을 지켰어요 — 내 근거를 한 줄로 말해 봐요',
  }[tag] || '';
  const sway = res && res.sway.includes(me.team);
  return `<div class="pv-center">
    <div class="pv-eyebrow">${s.r + 1}일째 · 우리 가족 결정</div>
    <div class="pv-huge">${M ? M.emoji : '🤔'}</div>
    <div class="pv-big">${M ? esc(M.name) : '못 정했어요'}</div>
    ${a !== null || b !== null ? `<p class="dp-me">내 표: ${a !== null ? `${menus[a].emoji} ${esc(menus[a].name)}` : '—'} <i class="d-arw">→</i> ${b !== null ? `${menus[b].emoji} ${esc(menus[b].name)}` : '—'}</p>` : '<p class="pv-sub">이번엔 투표하지 못했어요</p>'}
    ${msg ? `<p class="pv-sub">${msg}</p>` : ''}
    ${sway || (r && r.uni) ? `<p class="pv-q">${sway ? '🗣️ 우리 가족 설득상!' : ''}${sway && r.uni ? ' · ' : ''}${r && r.uni ? '🤝 한마음상!' : ''}</p>` : ''}
  </div>`;
}

function playFinal(s, me) {
  const decs = (s.hist || []).map(h => [h.r, h.teams[me.team]]);
  return `<div class="pv-center">
    <div class="pv-eyebrow">사흘 동안 우리 가족 식탁</div>
    <div class="dp-days">${decs.map(([r, x]) => { const R = ROUNDS[r]; const m = x && x.m !== null ? R.menus[x.m] : null; return `<div class="dp-day"><small>${R.emoji} ${esc(R.topic)}</small><span>${m ? m.emoji : '—'}</span><b>${m ? esc(m.name) : '못 정함'}</b>${x && (x.sway || x.uni) ? `<i>${x.sway ? '🗣️' : ''}${x.uni ? '🤝' : ''}</i>` : ''}</div>`; }).join('')}</div>
    <p class="pv-sub">화면을 보세요 — 우리 가족은 무엇을 가장 먼저 봤나요?</p>
  </div>`;
}

const CSS = `
.d-wrap,.dr,.dv{word-break:keep-all}
.d-wrap{position:relative;display:flex;flex-direction:column;height:100%;gap:12px}
.d-top{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;min-height:70px}
.d-title{font-size:34px;font-weight:800;letter-spacing:-.025em;margin:6px 0 0;line-height:1.2}
.d-hl{color:var(--org-t)}
.d-days{display:inline-flex;gap:4px;margin-left:8px;vertical-align:middle}
.d-days i{font-style:normal;font-size:14px;width:24px;height:24px;display:inline-grid;place-items:center;border-radius:50%;border:2px dashed var(--mid-d);opacity:.55}
.d-days i.past{opacity:1;border-style:solid;border-color:var(--grn);background:var(--grn-w)}
.d-days i.now{opacity:1;border:3px solid var(--org);background:var(--org-w)}
.d-menus{flex:1;min-height:0;display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.d-menus.compact{flex:none}
.d-menu{background:var(--card);border:1.5px solid var(--line);border-radius:16px;padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-height:0;animation:gk-pop .45s cubic-bezier(.2,.75,.3,1) both}
.d-mh{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:12px}
.d-me{font-size:58px;line-height:1}
.d-mt b{display:block;font-size:27px;letter-spacing:-.03em;line-height:1.2}
.d-mt span{font-size:16px;font-weight:700;color:var(--blu-t)}
.d-rows{display:flex;flex-direction:column;gap:6px;min-height:0}
.d-row{display:grid;grid-template-columns:84px 1fr;gap:8px;align-items:baseline;border-top:1.5px solid var(--rule);padding-top:7px}
.d-rl{font-size:17px;font-weight:800;color:var(--dim);white-space:nowrap}
.d-rv{font-size:20px;line-height:1.4}
.compact .d-menu{padding:10px 14px}
.compact .d-me{font-size:44px}
.compact .d-mt b{font-size:23px}
.d-strip{display:flex;gap:10px;flex-wrap:wrap}
.d-sm{display:inline-flex;align-items:center;gap:8px;font-size:22px;font-weight:800;background:var(--card);border:1.5px solid var(--line);border-radius:99px;padding:4px 16px 4px 6px}
.d-smn{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--ink);color:var(--paper);font-size:16px}
.d-legend,.d-done{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:8px 14px;font-size:18px}
.d-lgh{font-size:16px;font-weight:800;color:var(--org-t)}
.d-lg b{font-weight:800}
.d-steps{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;background:var(--org-w);border:1.5px solid var(--org-l);border-radius:14px;padding:10px 16px;font-size:20px;font-weight:700}
.d-steps b{color:var(--org-t)}
.d-ar{color:var(--mid-d)}
.d-foot{display:flex;align-items:center;gap:12px;min-height:48px}
.d-foot .gk-hint b{color:var(--ink)}
.d-prog{flex:1;min-height:0;display:grid;grid-template-columns:repeat(var(--n),1fr);grid-auto-rows:1fr;gap:10px;container-type:size}
.d-pt{background:var(--card);border:1.5px solid var(--line);border-top:8px solid var(--tf);border-radius:14px;padding:10px 14px;display:flex;flex-direction:column;gap:6px;min-height:0;overflow:hidden}
.d-pt.done{background:var(--tt)}
.d-ptn{font-size:20px;font-weight:800;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.d-ptc{display:flex;align-items:baseline;gap:4px}
.d-ptc b{font-size:40px;font-weight:800;letter-spacing:-.045em;line-height:1}
.d-ptc span{font-size:17px;font-weight:700;color:var(--dim)}
.d-ptw,.d-picks{display:flex;flex-wrap:wrap;gap:6px}
.d-pth{display:flex;align-items:baseline;justify-content:space-between;gap:4px 10px;flex-wrap:wrap;flex:none;min-width:0}
.d-ptn,.d-ptc{flex:none;min-width:0}
.d-w{font-size:22px;padding:2px 8px;border-radius:99px;border:2px dashed var(--mid-d);color:var(--dim);font-weight:800}
.d-w.on{border:2px solid #141413;background:var(--tf);color:#141413}
.d-pk{font:inherit;font-size:18px;font-weight:800;padding:4px 12px;border-radius:12px;border:2px solid var(--mid-d);background:var(--card);cursor:pointer;color:var(--ink)}
.d-pk:hover{border-color:var(--org);background:var(--org-w)}
.d-pk.big{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:46px;line-height:1.1;padding:10px 18px;border-width:2.5px;border-radius:18px}
.d-pk.big span{font-size:20px}
/* 칸이 낮을 때(대신 누르기 칸이 열림): 한 줄 요약 → 더 낮으면 이름 · 수만 */
@container (max-height:300px){
  .d-pt{flex-direction:row;flex-wrap:wrap;align-items:center;align-content:center;gap:2px 10px;padding:4px 12px;border-top-width:5px}
  .d-ptc b{font-size:28px}
  .d-w{font-size:18px;padding:0 6px}
  .d-pk{font-size:16px;padding:2px 8px}
}
@container (max-height:170px){
  .d-ptw{display:none}
  .d-pt{padding:2px 10px;flex-wrap:nowrap}
  .d-ptn{font-size:16px;min-width:0}
  .d-ptc b{font-size:20px}.d-ptc span{font-size:14px;white-space:nowrap}
  .d-pt.done .d-ptc span::after{content:' ✓'}
}
.d-twr{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--org-w);border:2px solid var(--org);border-radius:14px;padding:8px 16px;font-size:19px}
.d-twr b{font-size:21px}
.d-twre{font-size:34px;line-height:1}
/* 회의: 팀마다 첫 마음 */
.d-fam{flex:1;min-height:0;display:grid;grid-template-columns:repeat(var(--n),1fr);grid-auto-rows:1fr;gap:10px}
.d-fc{background:var(--card);border:1.5px solid var(--line);border-top:8px solid var(--tf);border-radius:14px;padding:10px 14px;display:flex;flex-direction:column;gap:8px;min-height:0;min-width:0}
.d-fch{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap}
.d-ft{font-size:17px;font-weight:800;padding:2px 10px;border-radius:99px;background:var(--grn-w);color:var(--grn-t);border:1.5px solid var(--grn-l)}
.d-ft.hot{background:var(--org);color:#141413;border-color:#141413;animation:gkpulse .6s 4 alternate}
/* 상황 카드 */
.d-tw{display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto 1fr;column-gap:24px;background:var(--card);border:4px solid var(--ink);border-radius:26px;padding:18px 28px;box-shadow:0 10px 0 var(--org-l);animation:drflip .55s cubic-bezier(.2,.75,.3,1) both}
.d-tw.big{flex:1;min-height:0;align-content:center}
.d-twl{grid-column:1/3;font-size:18px;font-weight:800;color:var(--org-t);letter-spacing:.04em}
.d-twe{font-size:150px;line-height:1.05;align-self:center}
.d-twb{display:flex;flex-direction:column;justify-content:center;gap:12px;min-width:0}
.d-twb b{font-size:50px;letter-spacing:-.035em;line-height:1.15}
.d-twb p{margin:0;font-size:30px;line-height:1.45}
.d-twwho{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:20px}
.d-twwho>span:first-child{font-size:17px;font-weight:800;color:var(--dim)}
.d-twr2{font-weight:800;padding:2px 12px;border-radius:99px;background:var(--org-w);border:1.5px solid var(--org-l)}
.d-twa{font-weight:800;padding:2px 12px;border-radius:99px;background:var(--grn-w);border:1.5px solid var(--grn-l);color:var(--grn-t)}
/* 동률 */
.d-ties{flex:1;min-height:0;display:grid;grid-template-columns:repeat(var(--n),1fr);grid-auto-rows:minmax(0,1fr);gap:12px;align-content:center}
.d-tie{background:var(--card);border:2px solid var(--org);border-top:10px solid var(--tf);border-radius:16px;padding:12px 16px;display:flex;flex-direction:column;gap:10px;justify-content:center;min-height:0;min-width:0}
.d-vs{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap}
.d-vsx{font-size:22px;font-weight:800;color:var(--dim)}
.d-ties.many .d-vs{flex-direction:column;gap:4px}
.d-ties.many .d-pk.big{flex-direction:row;gap:10px;font-size:34px;padding:4px 14px;width:100%;justify-content:center}
.d-ties.many .d-pk.big span{font-size:19px}
.d-ties.many .d-vsx{font-size:17px}
.d-ties.many .d-tie{padding:8px 12px;gap:6px}
/* 결과 */
.d-show{flex:1;min-height:0;display:grid;grid-template-columns:1fr 420px;gap:16px}
.d-tcs{min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(var(--rows),1fr);gap:10px}
.d-tc{position:relative;background:var(--card);border:1.5px solid var(--line);border-left:10px solid var(--tf);border-radius:14px;padding:8px 14px;display:flex;flex-direction:column;justify-content:center;gap:5px;min-height:0;min-width:0;overflow:hidden;animation:gk-pop .4s cubic-bezier(.2,.75,.3,1) both}
.d-tc.badge{border:3px solid var(--org);border-left:10px solid var(--tf);background:var(--org-w)}
.d-tch{display:flex;align-items:center;justify-content:space-between;gap:8px}
.d-tcn{font-size:20px;font-weight:800;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.d-bdg{display:flex;gap:4px;flex:none}
.d-badge{font-size:17px;font-weight:800;padding:2px 10px;border-radius:99px;background:var(--org);color:#141413;white-space:nowrap;animation:gkpulse .6s 4 alternate}
.d-badge.uni{background:var(--grn);color:#fff}
.d-dec{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.d-dece{font-size:34px;line-height:1}
.d-dec b{font-size:26px;letter-spacing:-.03em}
.d-dec small{font-size:16px;color:var(--dim);font-weight:700}
.d-voters{display:flex;flex-wrap:wrap;gap:6px}
.d-v{display:inline-flex;align-items:center;gap:2px;font-size:22px;background:var(--paper);border:1.5px solid var(--line);border-radius:99px;padding:0 9px;white-space:nowrap;line-height:1.35}
.d-v.ch{border:2px solid var(--org);background:var(--org-w)}
.d-arw{font-style:normal;font-size:20px;font-weight:800;color:var(--org-t);margin:0 3px}
.d-sw{font-size:17px;font-weight:700;color:var(--dim)}
.d-sw b{color:var(--ink)}
.d-show.dense{grid-template-columns:1fr 380px}
/* 팀 5개 이상: 1줄 = 팀 이름 · 결정 · 상, 2줄 = 역할 첫 마음 → 다시 투표 */
.d-tcs.dense .d-tc{display:grid;grid-template-columns:auto minmax(0,1fr) auto;grid-template-rows:auto auto;align-content:center;column-gap:10px;row-gap:4px;padding:5px 12px}
.d-tcs.dense .d-tch{display:contents}
.d-tcs.dense .d-tcn{grid-column:1;grid-row:1;font-size:17px;align-self:center}
.d-tcs.dense .d-bdg{grid-column:3;grid-row:1;align-self:center}
.d-tcs.dense .d-dec{grid-column:2;grid-row:1;flex-wrap:nowrap;gap:6px;min-width:0}
.d-tcs.dense .d-dec small,.d-tcs.dense .d-sw{display:none}
.d-tcs.dense .d-voters{grid-column:1/4;grid-row:2;gap:3px 4px}
.d-tcs.dense .d-dece{font-size:24px}.d-tcs.dense .d-dec b{font-size:20px;white-space:nowrap}
.d-tcs.dense .d-bt{display:none}
.d-tcs.dense .d-v{font-size:18px;padding:0 6px}
.d-tcs.dense .d-arw{font-size:18px;margin:0 1px}
.d-tcs.dense .d-badge{font-size:15px;padding:1px 7px}
.d-cls{background:var(--card);border:1.5px solid var(--line);border-radius:14px;padding:12px 16px;display:flex;flex-direction:column;gap:9px;min-height:0}
.d-clsh{font-size:17px;font-weight:800;color:var(--dim)}
.d-k1,.d-k2{padding:0 6px;border-radius:6px;color:var(--ink)}
.d-k1{background:var(--line)}.d-k2{background:var(--blu-w)}
.d-cb{display:flex;flex-direction:column;gap:3px}
.d-cbh{display:flex;justify-content:space-between;align-items:baseline;font-size:21px;font-weight:800}
.d-cbh b{font-size:24px}
.d-cbar{height:14px;background:var(--rule);border-radius:5px;overflow:hidden}
.d-cbar i{display:block;height:100%;border-right:3px solid #141413;animation:sbgrow .9s .3s cubic-bezier(.2,.75,.3,1) both}
.d-cbar.k1 i{background:var(--mid)}.d-cbar.k2 i{background:var(--blu)}
.d-topr{margin:auto 0 0;font-size:17px;line-height:1.45;background:var(--grn-w);border:1.5px solid var(--grn-l);border-radius:10px;padding:6px 10px}
.d-show.dense .d-cbh{font-size:19px}.d-show.dense .d-cbh b{font-size:22px}
/* 사흘 결과 */
.d-fin{flex:1;min-height:0;display:flex;flex-direction:column;gap:6px;justify-content:center}
.d-frow{flex:1 1 0;max-height:66px;min-height:0;display:grid;grid-template-columns:220px repeat(var(--d),1fr) 150px;gap:10px;align-items:center;background:var(--card);border:1.5px solid var(--line);border-left:10px solid var(--tf);border-radius:12px;padding:0 14px;animation:gk-in .35s cubic-bezier(.2,.75,.3,1) both}
.d-frow.d-fhd{flex:none;background:none;border:none;font-size:17px;font-weight:800;color:var(--dim);animation:none;padding:0 14px 0 24px}
.d-frow.king{border:3px solid var(--org);border-left:10px solid var(--tf);background:var(--org-w)}
.d-fd{display:flex;align-items:center;gap:8px;font-size:20px;font-weight:700;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.d-fd i{font-style:normal;font-size:30px;flex:none}
.d-fb{display:flex;gap:8px;font-size:20px}
.d-fin.dense .d-fd{font-size:17px}.d-fin.dense .d-fd i{font-size:24px}
.d-wraps{flex:1;min-height:0;display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.d-wc{background:var(--card);border:1.5px solid var(--line);border-radius:16px;padding:24px;display:flex;flex-direction:column;justify-content:center;gap:14px;animation:gk-pop .45s cubic-bezier(.2,.75,.3,1) both}
.d-wce{font-size:84px;line-height:1}
.d-wc b{font-size:30px;letter-spacing:-.03em;line-height:1.3}
.d-wc p{font-size:22px;line-height:1.55;margin:0;color:var(--ink)}
.d-bline{margin:0;font-size:20px;font-weight:800;color:var(--org-t)}
/* 조종기 */
.dr{display:flex;flex-direction:column;height:100%;gap:12px}
.dr-head,.dv-head{display:flex;justify-content:space-between;align-items:center;gap:10px}
.dr-new{font-size:17px;font-weight:800;padding:2px 12px;border-radius:99px;background:var(--org);color:#141413}
.dr-time,.dv-time{font-size:18px;font-weight:800;padding:4px 14px;border-radius:12px;border:1.5px solid var(--line);background:var(--card);white-space:nowrap}
.dr-time b,.dv-time b{font-size:30px}
.dr-time.hot{border-color:var(--bad);background:var(--bad-w);color:var(--bad)}
.dr-card{flex:1;min-height:0;display:grid;grid-template-columns:300px 1fr;gap:20px;background:var(--card);border:3px solid var(--ink);border-radius:24px;padding:20px 24px;
  box-shadow:0 8px 0 var(--org-l);animation:drflip .5s cubic-bezier(.2,.75,.3,1) both}
@keyframes drflip{from{transform:perspective(900px) rotateY(80deg);opacity:0}to{transform:none;opacity:1}}
.dr-who{display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--org-w);border-radius:18px;gap:4px}
.dr-e{font-size:150px;line-height:1.05}
.dr-im{font-size:20px;font-weight:700;color:var(--dim)}
.dr-n{font-size:50px;letter-spacing:-.04em;line-height:1.1}
.dr-right{display:flex;flex-direction:column;gap:14px;min-height:0}
.dr-care{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.dr-cl{width:100%;font-size:16px;font-weight:800;color:var(--dim)}
.dr-cs{display:flex;gap:8px}
.dr-c{font-size:26px;font-weight:800;padding:6px 16px;border-radius:12px;background:var(--grn-w);border:2px solid var(--grn);color:var(--grn-t)}
.dr-say{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;background:var(--paper);border:2px dashed var(--mid-d);border-radius:18px;padding:14px 18px;position:relative}
.dr-sl{font-size:16px;font-weight:800;color:var(--org-t)}
.dr-line{flex:1;margin:0;font-size:38px;font-weight:800;letter-spacing:-.025em;line-height:1.42;display:flex;align-items:center}
.dr-next{align-self:flex-start}
.dr-tip{margin:0;font-size:20px;text-align:center;font-weight:700;display:flex;justify-content:center;align-items:center;gap:8px;flex-wrap:wrap}
.dr-tip .dr-c,.dv-tip .dr-c{font-size:18px;padding:2px 10px}
.dr-tip.me{background:var(--org);color:#141413;border-radius:14px;padding:10px 16px;font-size:24px}
.dr .d-tw{flex:1;min-height:0;align-content:center;padding:16px 24px}
.dr .d-twe{font-size:110px}
.dr .d-twb b{font-size:40px}.dr .d-twb p{font-size:26px}
.dt{flex:1;min-height:0;display:flex;flex-direction:column;gap:12px;background:var(--card);border:3px solid var(--ink);border-radius:24px;padding:16px 22px}
.dt-h{font-size:24px;font-weight:800;display:flex;align-items:center;gap:10px}
.dt-tag{font-size:18px;padding:2px 12px;border-radius:99px;background:var(--grn-w);color:var(--grn-t);border:1.5px solid var(--grn-l)}
.dt-tag.hot{background:var(--org);color:#141413;border-color:#141413}
.dt-list{flex:1;min-height:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));grid-auto-rows:1fr;gap:10px}
.dt-f{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;border:2px solid var(--line);border-radius:18px;padding:8px;min-height:0}
.dt-f.me{border:3px solid var(--org);background:var(--org-w)}
.dt-r,.dt-m{display:flex;flex-direction:column;align-items:center;font-size:60px;line-height:1.1}
.dt-m{font-size:76px}
.dt-r small,.dt-m small{font-size:20px;font-weight:800;color:var(--dim)}
.dt-you{font-size:17px;font-weight:800;padding:2px 10px;border-radius:99px;background:var(--org);color:#141413}
.dt-m small{color:var(--ink)}
.dv{display:flex;flex-direction:column;height:100%;gap:12px}
.dv-q{font-size:26px;font-weight:800;letter-spacing:-.025em;margin:0;text-align:center}
.dv-star{display:block;font-size:16px;font-weight:700;color:var(--dim);margin-top:2px}
.dv-menus{flex:1;min-height:0;display:grid;grid-template-columns:repeat(var(--c,3),1fr);gap:14px}
.dv-m{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;border-radius:22px;border:2.5px solid var(--mid-d);background:var(--card);cursor:pointer;padding:12px;font:inherit;color:var(--ink)}
.dv-m.still{cursor:default;border-style:dashed}
.dv-m b{font-size:30px;letter-spacing:-.03em;text-align:center}
.dv-me{font-size:96px;line-height:1}
.dv-mt{font-size:16px;font-weight:700;color:var(--blu-t)}
.dv-m:not(.still):hover{border-color:var(--org);background:var(--org-w)}
.dv-m.on{border-color:var(--org);background:var(--org-w);box-shadow:0 0 0 4px var(--org)}
.dv-menus.vs{grid-template-columns:1fr auto 1fr}
.dv-vs{align-self:center;font-size:24px;font-weight:800;background:var(--ink);color:var(--paper);border-radius:99px;padding:4px 12px}
.dv-ok{position:absolute;top:10px;right:12px;font-size:16px;font-weight:800;padding:2px 10px;border-radius:99px;background:var(--org);color:#141413}
.dv-ok.was{background:var(--line);color:var(--ink)}
.dv-okt{color:var(--grn-t)}
.dv-tip{margin:0;text-align:center;font-size:19px;display:flex;justify-content:center;align-items:center;gap:8px;flex-wrap:wrap}
.dv-sel{display:flex;align-items:center;gap:12px;background:var(--org-w);border:1.5px solid var(--org-l);border-radius:14px;padding:8px 14px}
.dv-sele{font-size:40px;line-height:1}.dv-sel b{font-size:26px;flex:1}
.dv-chg{font-size:17px;color:var(--org-t);margin-left:6px}
.dv-rs{flex:1;min-height:0;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:1fr 1fr;gap:12px}
.dv-r{position:relative;display:flex;align-items:center;justify-content:center;gap:12px;border-radius:20px;border:2.5px solid var(--mid-d);background:var(--card);cursor:pointer;padding:8px;font:inherit;color:var(--ink)}
.dv-r b{font-size:32px;letter-spacing:-.03em}
.dv-re{font-size:48px;line-height:1}
.dv-rstar{position:absolute;top:8px;left:12px;font-size:20px}
.dv-r:hover{border-color:var(--grn)}
.dv-r.on{border-color:var(--grn);background:var(--grn-w);box-shadow:0 0 0 4px var(--grn)}
.dv-r.on .dv-ok{background:var(--grn);color:#fff}
.dv-status{margin:0;text-align:center;font-size:20px;font-weight:800;color:var(--org-t)}
.dv-status.ok{color:var(--grn-t)}
.dv-warn{margin:0;text-align:center;font-size:18px;font-weight:800;color:var(--bad);min-height:0}
.dv-warn:empty{display:none}
.dp-me{margin:0;font-size:24px;font-weight:800}
.dp-days{display:flex;gap:14px;flex-wrap:wrap;justify-content:center}
.dp-day{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:200px;background:var(--card);border:2px solid var(--line);border-radius:18px;padding:12px 16px}
.dp-day small{font-size:17px;font-weight:800;color:var(--dim)}
.dp-day span{font-size:64px;line-height:1.1}
.dp-day b{font-size:22px}
.dp-day i{position:absolute;top:8px;right:10px;font-style:normal;font-size:22px}
@media (prefers-reduced-motion:reduce){.d-menu,.d-tc,.d-wc,.dr-card,.d-badge,.d-tw,.d-ft.hot,.d-frow{animation:none!important}}
`;
