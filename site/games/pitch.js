// 16차시 「2040 발명가 피칭」 — 발달 전망 예측 · 근거로 토론
// ① 조립: 팀원 투표로 투입 · 일하는 생물 · 산출 · 누구의 문제(각 6개 중 1) + 발명품 이름(12자) → 진행판에 발명품 카드(시스템 네 칸)
// ② 피칭: 팀마다 1분(진행판이 차례를 넘긴다). 다른 팀은 질문 단추 「근거는?」「누가 손해?」「진짜 가능?」 — 발표 팀 화면에 수가 뜬다
// ③ 투자: 각자 500코인을 다른 팀에 나눠 건다 → 팀 투자 = 팀원 평균 ④ 결과: 투자 1위 · 질문 많이 받은 발명품 ⑤ 「걱정되는 점」 모으기
// 발명품 이름: 팀에서 「먼저 낸 이름 하나」만 쓴다(교사가 지우면 다시). 처음엔 모두 숨김 → 진행판에서 팀마다 확인(👀 누르고 있기) 뒤 「공개」.
//   공개 전에는 어디서나 「팀 발명품」으로 보인다(결과 · 축하 화면 포함). 이름을 안 낸 팀은 고른 것으로 만든 이름.
// 질문 시간: 🎲 질문자 뽑기 — 질문 단추를 누른 다른 팀 학생 중 한 명의 번호를 뽑아 「○번, 직접 물어보세요!」
// 투자 점수 = 받은 투자 순위 점수 + 1위 맞히기 보너스(1위 발명품에 절반 이상 걸면 +PREDICT_BONUS(1), 1위 팀은 자동 +1)
//   → 「1위가 될 팀 막기」 투자는 손해. 보너스(1)가 순위 점수 차(최소 1)를 넘지 않아 투자 순위는 뒤집히지 않는다
import {
  esc, keyed, text, secsLeft, timerHTML, timerUpdate, tickSound, majority, rankPoints, confetti, injectCSS, medal, beep, flash,
} from '../src/gamekit.js';
import {
  SLOTS, QUESTIONS, BUILD_SECONDS, PITCH_SECONDS, INVEST_SECONDS, INVEST_COINS, CHIP, NAME_MAX, PREDICT_BONUS,
} from './pitch-data.js';

export const HIDDEN_NAME = '팀 발명품';

const fmt = n => Math.round(n).toLocaleString('ko-KR');
/** 진행판 팀 카드 열 수: 4팀까지 한 줄 · 5~6팀은 3열(카드를 넓게) · 7~8팀은 4열 */
const cols = n => (n <= 4 ? Math.max(1, n) : n <= 6 ? 3 : 4);
const opt = (slotKey, idx) => { const sl = SLOTS.find(x => x.key === slotKey); return idx == null ? null : sl.opts[idx] || null; };

/** 발명품 이름 다듬기: 제어 문자 · 꺾쇠 빼고, 12자(이모지도 한 글자) */
export function cleanName(v) {
  const s = String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f\u007f<>{}\\]/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, NAME_MAX).join('').trim();
}
/** 고른 것으로 만드는 이름 (이름이 없거나 숨겼을 때) */
export function autoName(v) {
  const b = v && opt('bio', v.bio), o = v && opt('out', v.out);
  if (!b && !o) return '이름 짓는 중…';
  return cleanName(`${b ? b.nm : ''}${b && o ? ' ' : ''}${o ? o.nm : ''} 공장`);
}
export function nameIdeas(v) {
  const b = v && opt('bio', v.bio), o = v && opt('out', v.out), w = v && opt('who', v.who);
  const list = [];
  if (b && o) list.push(`${b.nm} ${o.nm} 공장`);
  if (o) list.push(`${o.nm} 메이커 2040`);
  if (w) list.push(`${w.nm} 지킴이`);
  if (b) list.push(`슈퍼 ${b.nm}`);
  return [...new Set(list.map(cleanName).filter(x => Array.from(x).length <= NAME_MAX))].slice(0, 3);
}
/** 화면에 보일 이름: 교사가 공개한 팀만 진짜 이름 · 낸 이름이 있지만 공개 전이면 「팀 발명품」 · 이름을 안 냈으면 자동 이름 */
export function shownName(s, tid) {
  const v = (s.inv || {})[tid];
  if (!v || !v.nm) return autoName(v);
  return (s.shown || {})[tid] ? v.nm : HIDDEN_NAME;
}
const hk = s => 'n' + JSON.stringify(s.shown || {}) + Object.keys(s.inv || {}).map(t => (s.inv[t].nm ? 1 : 0)).join('');
const isHidden = (s, tid) => !!((s.inv || {})[tid] && s.inv[tid].nm && !(s.shown || {})[tid]);
/** 한 줄 문장: 「○○를 위해 ○○를 ○○가 ○○로 바꾼다」 */
export function sentence(v) {
  if (!v) return '';
  const i = opt('in', v.in), b = opt('bio', v.bio), o = opt('out', v.out), w = opt('who', v.who);
  return `${w ? w.for : '누군가를 위해'} ${i ? i.obj : '무엇을'} ${b ? b.subj : '어떤 생물이'} ${o ? o.to : '무엇으로'} 바꾼다`;
}

// ── 판정 ──
function tallyBuild(s, inputs, ctx) {
  const inv = {};
  for (const t of ctx.teams) {
    const votes = t.online.map(u => inputs[u]).filter(Boolean);
    const v = { cnt: {}, need: t.online.length, done: 0 };
    for (const sl of SLOTS) {
      const m = majority(votes.map(x => ({ v: Number.isInteger(x[sl.key]) && x[sl.key] >= 0 && x[sl.key] < sl.opts.length ? x[sl.key] : null, t: x.t })));
      v[sl.key] = m.winner === null ? null : Number(m.winner);
      v.cnt[sl.key] = m.counts;
    }
    v.done = votes.filter(x => SLOTS.every(sl => Number.isInteger(x[sl.key]))).length;
    v.nm = firstName(s, t, inputs).nm;
    inv[t.id] = v;
  }
  return inv;
}

/** 팀에서 먼저 낸 이름 하나: 이미 정해졌으면 그대로 · 아니면 (교사가 지운 뒤에) 가장 먼저 들어온 이름. 지운 이름은 다시 받지 않는다 */
export function firstName(s, t, inputs) {
  const lock = (s.nmLock || {})[t.id];
  if (lock) return lock;
  const ban = (s.nmBan || {})[t.id] || [], clr = (s.nmClr || {})[t.id] || 0;
  let best = null;
  const uids = [...(t.online || [])];
  if (!uids.includes('proxy-' + t.id)) uids.push('proxy-' + t.id);
  for (const u of uids) {
    const x = inputs[u];
    if (!x) continue;
    const c = cleanName(x.nm), tt = Number(x.t) || 0;
    if (!c || ban.includes(c) || tt <= clr) continue;
    if (!best || tt < best.t) best = { nm: c, u, t: tt };
  }
  return best || { nm: '' };
}
function lockNames(s, inputs, ctx) {
  const nmLock = { ...(s.nmLock || {}) };
  let changed = false;
  for (const t of ctx.teams) {
    if (nmLock[t.id]) continue;
    const f = firstName(s, t, inputs);
    if (f.nm) { nmLock[t.id] = { nm: f.nm, u: f.u, t: f.t, by: ctx.numOf(f.u) }; changed = true; }
  }
  return changed ? nmLock : (s.nmLock || {});
}
function build(s, inputs, ctx) {
  const nmLock = lockNames(s, inputs, ctx);
  const s2 = { ...s, nmLock };
  return { ...s2, inv: tallyBuild(s2, inputs, ctx) };
}

function lockBuild(s, ctx) {
  const inv = {};
  for (const t of ctx.teams) {
    const v = { ...((s.inv || {})[t.id] || { cnt: {}, need: 0, done: 0, nm: '' }) };
    const rand = {};
    for (const sl of SLOTS) if (v[sl.key] == null) { v[sl.key] = Math.floor(ctx.rnd() * sl.opts.length); rand[sl.key] = true; }
    v.rand = rand;
    delete v.cnt;
    inv[t.id] = v;
  }
  return { ...s, step: 'pitch', inv, order: ctx.teams.map(t => t.id), turn: 0, sub: 'ready', inputKey: null, deadline: null, qs: {}, qnow: null };
}

function countQs(s, inputs, ctx) {
  const cur = s.order[s.turn];
  const q = { q1: 0, q2: 0, q3: 0 };
  for (const t of ctx.teams) {
    if (t.id === cur) continue;
    const uids = [...t.online];
    if (!uids.includes('proxy-' + t.id)) uids.push('proxy-' + t.id);
    for (const u of uids) {
      const x = inputs[u];
      if (!x || (s.talkAt && typeof x.t === 'number' && x.t < s.talkAt - 2000)) continue;   // 앞 팀 칸 입력이 늦게 와도 섞이지 않게
      for (const k of Object.keys(q)) if (x[k] === true) q[k]++;
    }
  }
  return q;
}

function nextTurn(s, ctx) {
  const cur = s.order[s.turn];
  const qs = { ...s.qs, [cur]: s.qnow || { q1: 0, q2: 0, q3: 0 } };
  if (s.turn + 1 < s.order.length) return { ...s, qs, turn: s.turn + 1, sub: 'ready', inputKey: null, deadline: null, qnow: null, qpick: null };   // qpicked 는 게임 내내 이어진다
  return { ...s, qs, step: 'invest', sub: null, inputKey: 'pi', deadline: ctx.now() + INVEST_SECONDS * 1000, qnow: null, qpick: null, ivDone: 0, ivNeed: 0 };
}

/** 🎲 질문자 뽑기: 이번 발표에 질문 단추를 누른 다른 팀 학생 중 한 명(대신 누르기 제외 · 이 게임에서 이미 뽑힌 사람 빼고) */
export function askers(s, inputs, ctx) {
  const cur = s.order[s.turn];
  const out = [];
  for (const t of ctx.teams) {
    if (t.id === cur) continue;
    for (const u of t.online) {
      if (u.startsWith('proxy-')) continue;
      const x = inputs[u];
      if (!x || (s.talkAt && typeof x.t === 'number' && x.t < s.talkAt - 2000)) continue;
      const qk = QUESTIONS.filter(Q => x[Q.k] === true).map(Q => Q.k);
      if (qk.length) out.push({ u, team: t.id, qk });
    }
  }
  return out;
}
function pickAsker(s, ctx) {
  const all = askers(s, ctx.inputs || {}, ctx);
  const done = s.qpicked || [];
  let pool = all.filter(a => !done.includes(a.u));
  let qpicked = done;
  // 지금 누른 사람이 모두 이미 뽑혔으면 이 사람들만 처음부터(다른 사람의 「뽑힘」은 남긴다) — 모두 한 번씩 뽑힌 뒤에야 겹친다
  if (!pool.length && all.length) { pool = all; qpicked = done.filter(u => !all.some(a => a.u === u)); }
  if (!pool.length) return { ...s, qpick: { none: true, at: ctx.now() } };
  const a = pool[Math.floor(ctx.rnd() * pool.length)];
  return { ...s, qpick: { u: a.u, num: ctx.numOf(a.u), team: a.team, qk: a.qk, n: pool.length, at: ctx.now() }, qpicked: [...qpicked, a.u] };
}

/** 1위 맞히기 보너스: 1위(공동 포함, 받은 투자 > 0) 팀에 건 팀 평균 코인 ÷ 500 × PREDICT_BONUS (반올림).
 *  1위 팀은 자기에게 걸 수 없으니 자동으로 최대(PREDICT_BONUS) — 1위가 보너스 때문에 밀리지 않는다 */
export function predictBonus(gave, recv, rank) {
  const tops = Object.keys(recv).filter(t => rank[t] === 1 && recv[t] > 0);
  const bonus = {};
  for (const t of Object.keys(recv)) {
    const g = tops.reduce((a, top) => a + ((gave[t] || {})[top] || 0), 0);
    bonus[t] = tops.includes(t) ? PREDICT_BONUS : Math.round(PREDICT_BONUS * Math.min(1, g / INVEST_COINS));
  }
  return { bonus, tops };
}

/** 한 사람의 투자: 다른 팀에만 · 100 단위 · 합 500 이하. 맞지 않으면 null */
export function cleanAlloc(x, myTeam, teamIds) {
  if (!x) return null;
  const a = {};
  let sum = 0;
  for (const tid of teamIds) {
    if (tid === myTeam) continue;
    const v = Number(x[tid]);
    if (!Number.isFinite(v) || v <= 0) continue;
    const c = Math.floor(v / CHIP) * CHIP;
    if (c > 0) { a[tid] = c; sum += c; }
  }
  if (sum === 0 || sum > INVEST_COINS) return null;
  return a;
}

/** 팀 투자 = 투자한 팀원 배분의 평균(10 단위 반올림). 돌려줌: { recv: {받은 팀: 코인}, gave: {준 팀: {받은 팀: 코인}} } */
export function settleInvest(teams, inputs) {
  const ids = teams.map(t => t.id);
  const recv = Object.fromEntries(ids.map(id => [id, 0])), gave = {};
  for (const t of teams) {
    const uids = [...(t.members || t.online)];
    if (!uids.includes('proxy-' + t.id)) uids.push('proxy-' + t.id);
    const subs = uids.map(u => cleanAlloc(inputs[u], t.id, ids)).filter(Boolean);
    gave[t.id] = {};
    if (!subs.length) continue;
    for (const to of ids) {
      if (to === t.id) continue;
      const avg = subs.reduce((a, x) => a + (x[to] || 0), 0) / subs.length;
      const g = Math.round(avg / 10) * 10;
      if (g > 0) { gave[t.id][to] = g; recv[to] += g; }
    }
  }
  return { recv, gave };
}

function closeInvest(s, ctx) {
  const { recv, gave } = settleInvest(ctx.teams, ctx.inputs || {});
  const { rank, points } = rankPoints(recv, true);
  const { bonus } = predictBonus(gave, recv, rank);
  const pts = {};
  for (const t of Object.keys(points)) pts[t] = points[t] + (bonus[t] || 0);
  return { ...s, step: 'result', inputKey: null, deadline: null, recv, gave, rank, rpts: points, bonus, pts };
}

function qTotal(q) { return q ? (q.q1 || 0) + (q.q2 || 0) + (q.q3 || 0) : 0; }
function qKing(s) {
  let best = null;
  for (const [tid, q] of Object.entries(s.qs || {})) { const n = qTotal(q); if (n > 0 && (!best || n > best.n)) best = { tid, n, q }; }
  return best;
}

const game = {
  id: 'pitch',
  title: '2040 발명가 피칭',
  lesson: 16,
  minutes: 18,
  emoji: '🚀',
  blurb: '미래 생명 기술 발명품을 조립하고 1분 피칭 · 투자 · 질문!',
  intro: {
    headline: '2040 발명가 피칭',
    lines: [
      '2040년, 우리 팀은 생명 기술 스타트업 🚀',
      '<b>투입 · 일하는 생물 · 산출 · 누구의 문제</b>를 골라 발명품 조립 + 이름 짓기',
      '팀마다 <b>1분 피칭</b> → 질문 단추 · 🎲 뽑힌 사람이 직접 질문',
      `끝나면 각자 <b>500코인 투자</b> — 1위 발명품에 절반 이상 걸면 우리 팀도 보너스 +${PREDICT_BONUS}!`,
    ],
    art: `<div class="art-row"><span>📥</span><span class="plus">→</span><span>🦠</span><span class="plus">→</span><span>📦</span></div><div class="art-big">🚀</div><div class="art-cap">2040년의 발명품은?</div>`,
  },

  setup(ctx) {
    return { step: 'build', inputKey: 'pb', deadline: ctx.now() + BUILD_SECONDS * 1000, inv: tallyBuild({}, {}, ctx), shown: {}, nmLock: {}, nmBan: {}, nmClr: {} };
  },

  onInput(s, inputs, ctx) {
    if (s.step === 'build') return build(s, inputs, ctx);
    if (s.step === 'pitch' && (s.sub === 'talk' || s.sub === 'qa')) {
      const q = countQs(s, inputs, ctx);
      return JSON.stringify(q) === JSON.stringify(s.qnow) ? s : { ...s, qnow: q };
    }
    if (s.step === 'invest') {
      const ids = ctx.teams.map(t => t.id);
      let done = 0, need = 0;
      for (const t of ctx.teams) for (const u of t.online) { need++; if (cleanAlloc(inputs[u], t.id, ids)) done++; }
      return (done === s.ivDone && need === s.ivNeed) ? s : { ...s, ivDone: done, ivNeed: need };
    }
    return s;
  },

  tick(s, ctx) {
    const now = ctx.now();
    if (s.step === 'build' && now >= s.deadline) return lockBuild(s, ctx);
    if (s.step === 'pitch' && s.sub === 'talk' && now >= s.deadline) return { ...s, sub: 'qa' };
    if (s.step === 'invest' && now >= s.deadline) return closeInvest(s, ctx);
    return s;
  },

  action(s, name, payload, ctx) {
    if (name === 'hideAll') return { ...s, shown: {} };
    if (name === 'show' && payload && (s.inv || {})[payload] && s.inv[payload].nm) return { ...s, shown: { ...(s.shown || {}), [payload]: !(s.shown || {})[payload] } };
    if (name === 'clrname' && payload && s.step === 'build' && (s.nmLock || {})[payload]) {
      const nmLock = { ...s.nmLock }, old = nmLock[payload].nm;
      delete nmLock[payload];
      const s2 = { ...s, nmLock, nmBan: { ...(s.nmBan || {}), [payload]: [...((s.nmBan || {})[payload] || []), old] }, nmClr: { ...(s.nmClr || {}), [payload]: ctx.now() }, shown: { ...(s.shown || {}), [payload]: false } };
      return { ...s2, inv: tallyBuild(s2, ctx.inputs || {}, ctx) };
    }
    if (s.step === 'pitch' && (s.sub === 'talk' || s.sub === 'qa')) {
      if (name === 'pickq') return pickAsker(s, ctx);
      if (name === 'pickclose') return { ...s, qpick: null };
    }
    if (s.step === 'build') {
      if (name === 'more') return { ...s, deadline: Math.max(s.deadline, ctx.now()) + 60000 };
      if (name === 'lock') return lockBuild(s, ctx);
    }
    if (s.step === 'pitch') {
      if (name === 'talk' && s.sub === 'ready') return { ...s, sub: 'talk', inputKey: 'q' + s.turn, talkAt: ctx.now(), deadline: ctx.now() + PITCH_SECONDS * 1000, qnow: { q1: 0, q2: 0, q3: 0 } };
      if (name === 'more' && s.sub === 'talk') return { ...s, deadline: s.deadline + 15000 };
      if (name === 'stop' && s.sub === 'talk') return { ...s, sub: 'qa' };
      if (name === 'next' && (s.sub === 'qa' || s.sub === 'talk')) return nextTurn(s, ctx);
      if (name === 'skip' && s.sub === 'ready') return nextTurn({ ...s, qnow: null }, ctx);
    }
    if (s.step === 'invest') {
      if (name === 'more') return { ...s, deadline: s.deadline + 15000 };
      if (name === 'close') return closeInvest(s, ctx);
    }
    if (name === 'worry' && s.step === 'result') return { ...s, step: 'worry' };
    if (name === 'finish' && s.step === 'worry') return { ...s, done: true };
    return s;
  },

  proxyButtons(s, team, ctx) {
    if (s.step === 'build') {
      const v = (s.inv || {})[team.id] || {};
      return SLOTS.map(sl => {
        const cur = v[sl.key];
        const nxt = cur == null ? 0 : (cur + 1) % sl.opts.length;
        return { label: `${sl.box}: ${cur == null ? '❔' : sl.opts[cur].e} ▶`, input: { [sl.key]: nxt } };
      });
    }
    if (s.step === 'pitch' && (s.sub === 'talk' || s.sub === 'qa') && s.order[s.turn] !== team.id) {
      return QUESTIONS.map(q => ({ label: `${q.e} ${q.label}`, input: { [q.k]: true }, once: true }));
    }
    if (s.step === 'invest') {
      const mine = (ctx.inputs || {})['proxy-' + team.id] || {};
      const others = ctx.teams.filter(t => t.id !== team.id);
      const used = others.reduce((a, t) => a + (Number(mine[t.id]) || 0), 0);
      const btns = used + CHIP <= INVEST_COINS ? others.map(t => ({ label: `${t.emoji}+${CHIP}`, input: { [t.id]: (Number(mine[t.id]) || 0) + CHIP } })) : [];
      if (used > 0) btns.push({ label: `↺ 다시(${used})`, input: Object.fromEntries(others.map(t => [t.id, 0])) });
      return btns;
    }
    return [];
  },

  remap(s, from, to) {
    const qpick = s.qpick && s.qpick.u === from ? { ...s.qpick, u: to } : s.qpick;
    const qpicked = (s.qpicked || []).map(u => (u === from ? to : u));
    const nmLock = {};
    for (const [t, l] of Object.entries(s.nmLock || {})) nmLock[t] = l.u === from ? { ...l, u: to } : l;
    return { ...s, qpick, qpicked, nmLock };
  },

  scoring(s, ctx) {
    const tn = tid => { const t = ctx.teams.find(x => x.id === tid); return t ? `${t.emoji} ${esc(t.name)}` : ''; };
    const lines = [];
    const top = Object.keys(s.recv || {}).find(tid => s.rank[tid] === 1 && s.recv[tid] > 0);
    if (top) lines.push(`💰 투자 1위: ${tn(top)} 「${esc(shownName(s, top))}」 ${fmt(s.recv[top])}코인`);
    const isTop = t => s.rank && s.rank[t] === 1 && (s.recv || {})[t] > 0;   // 1위 팀은 자동 보너스 — 「알아본 팀」에서 뺀다
    const hit = Object.keys(s.bonus || {}).filter(t => s.bonus[t] > 0 && !isTop(t)).sort((a, b) => s.bonus[b] - s.bonus[a]);
    if (hit.length) lines.push(`🎯 1위를 알아본 팀 보너스: ${hit.map(t => `${tn(t)} +${s.bonus[t]}`).join(' · ')}`);
    const k = qKing(s);
    if (k) lines.push(`🙋 질문을 가장 많이 받은 발명품: ${tn(k.tid)} 「${esc(shownName(s, k.tid))}」 ${k.n}개`);
    lines.push('🤔 걱정되는 점은 다음 시간(생명 기술의 영향 · 윤리)의 출발 질문으로!');
    return { points: s.pts || {}, lines };
  },

  record(s) {
    const top = Object.keys(s.recv || {}).find(tid => s.rank[tid] === 1 && s.recv[tid] > 0);
    return top ? { label: '투자 1위 발명품', value: s.recv[top], unit: '코인', team: top } : null;
  },

  // ── 진행판 ──
  hostView(el, s, ctx) {
    injectCSS('pitch', CSS);
    const now = ctx.now();
    if (s.step === 'build') {
      keyed(el, `build-${ctx.teams.length}`, hostBuild(s, ctx));
      updateBuild(el, s, ctx, now);
    } else if (s.step === 'pitch') {
      if (keyed(el, `pitch-${s.turn}`, hostPitch(s, ctx))) beep(587, 140, 'triangle');
      updatePitch(el, s, ctx, now);
    } else if (s.step === 'invest') {
      keyed(el, 'invest', hostInvest(s, ctx));
      const secs = secsLeft(s.deadline, now);
      timerUpdate(el, secs); tickSound(el, secs);
      text(el, '.pi-prog b', `${s.ivDone || 0}/${s.ivNeed || 0}`);
      const bar = el.querySelector('.pi-pbar i');
      if (bar) bar.style.width = `${s.ivNeed ? (s.ivDone / s.ivNeed * 100).toFixed(1) : 0}%`;
      updateNames(el, s, ctx);
    } else if (s.step === 'result') {
      if (keyed(el, 'result' + hk(s), hostResult(s, ctx, !el.__resShown)) && !el.__resShown) {
        el.__resShown = true;
        setTimeout(() => { confetti(el, 70); beep(784, 160); setTimeout(() => beep(1046, 300, 'triangle'), 170); }, 1600);
      }
      updateNames(el, s, ctx);
    } else if (s.step === 'worry') {
      keyed(el, 'worry' + hk(s), hostWorry(s, ctx));
      updateNames(el, s, ctx);
    }
    // 이름 공개 단추 · 👀 누르고 있으면 그 팀 이름을 잠깐 본다(교사 확인용)
    updateNameBtns(el, s);
    el.querySelectorAll('[data-act]').forEach(b => { b.onclick = () => ctx.act(b.dataset.act, b.dataset.p); });
    el.querySelectorAll('[data-peek]').forEach(b => {
      if (b.__pk) return;
      b.__pk = 1;
      const on = e => { e.preventDefault(); el.__peek = b.dataset.peek; updateNames(el, s, ctx, true); };
      const off = () => { if (el.__peek) { el.__peek = null; updateNames(el, s, ctx, true); } };
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
    });
  },

  // ── 조종기 ──
  playView(el, s, me, ctx) {
    injectCSS('pitch', CSS);
    const now = ctx.now();
    if (s.step === 'build') return playBuild(el, s, me, ctx, now);
    el.__sub = 0;
    if (s.step === 'pitch') return playPitch(el, s, me, ctx, now);
    if (s.step === 'invest') return playInvest(el, s, me, ctx, now);
    if (s.step === 'result') {
      const n = (s.recv || {})[me.team] || 0, q = qTotal((s.qs || {})[me.team]), bn = (s.bonus || {})[me.team] || 0;
      const top = s.rank && s.rank[me.team] === 1 && n > 0;
      return keyed(el, 'pr', `<div class="pv-center">
        <div class="pv-eyebrow">투자 결과</div>
        <div class="pv-huge">${s.rank && s.rank[me.team] ? medal(s.rank[me.team]) : '🚀'}</div>
        <div class="pv-big num">우리 발명품이 받은 투자 🪙 ${fmt(n)}</div>
        <p class="pv-sub">${bn ? (top ? `🎯 투자 1위 — 보너스 +${bn}! · ` : `🎯 1위 발명품을 알아봤어요 — 보너스 +${bn}! · `) : ''}받은 질문 ${q}개 — 질문은 발명품을 더 좋게 만드는 재료!</p></div>`);
    }
    const v = (s.inv || {})[me.team];
    const b = v && opt('bio', v.bio);
    keyed(el, 'pw', `<div class="pv-center"><div class="pv-eyebrow">걱정되는 점 모으기</div><div class="pv-huge">🤔</div>
      <div class="pv-big">화면을 보세요</div>
      ${b ? `<p class="pv-q">우리 발명품에 던질 질문: ${esc(b.worry)}</p>` : ''}
      <p class="pv-sub dim">다음 시간 「생명 기술의 영향」에서 이어서 생각해요</p></div>`);
  },
};
export default game;

// ── 진행판: 조립 ──
function boxesHTML(v, big = false) {
  return `<div class="pc-boxes ${big ? 'big' : ''}">${SLOTS.map((sl, k) => {
    const o = v ? opt(sl.key, v[sl.key]) : null;
    return `<div class="pc-box ${o ? 'on' : ''}" data-s="${sl.key}"><span class="pc-bh"><i class="pc-bi">${sl.icon}</i> ${big ? sl.box : (sl.short || sl.box)}</span>
      <span class="pc-be">${o ? o.e : '❔'}</span><span class="pc-bl">${o ? esc(o.label) : '고르는 중'}${v && v.rand && v.rand[sl.key] ? ' 🎲' : ''}</span></div>${k < SLOTS.length - 1 ? '<i class="pc-ar" aria-hidden="true">→</i>' : ''}`;
  }).join('')}</div>`;
}

function hostBuild(s, ctx) {
  const n = ctx.teams.length;
  return `
  <div class="pi-wrap">
    <div class="pi-top">
      <div>
        <div class="eyebrow">2040 발명가 피칭 · ① 발명품 조립</div>
        <h1 class="pi-title">무엇을 넣어, 어떤 생물이 일해, 무엇이 나올까?</h1>
      </div>
      <div class="gk-timer pi-mtimer" role="timer"><span class="gk-timer-l">조립</span><b class="gk-timer-n num">--</b></div>
    </div>
    <div class="pi-grid" style="--c:${cols(n)};--r:${Math.ceil(n / cols(n))}">
      ${ctx.teams.map(t => `
      <div class="pi-card" data-tid="${t.id}" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}">
        <div class="pi-ch"><span class="gk-tag" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}">${t.emoji} ${esc(t.name)}</span>
          <span class="pi-prog1"></span>${nameBtns(t.id, 'clr')}</div>
        <div class="pi-nm"></div>
        <div class="pi-sen"></div>
        <div class="pi-bx"></div>
      </div>`).join('')}
    </div>
    <div class="pi-foot">
      <button class="btn ghost" data-act="more">+1분</button><button class="btn" data-act="lock">조립 마감 → 피칭 ▶</button>
      <button class="btn ghost pi-hall" data-act="hideAll">🙈 모두 숨기기</button>
      <span class="gk-hint">이름은 팀에서 먼저 낸 것 하나 · 👀 누르고 있으면 확인 → 「공개」 · 🗑 지우면 다시 받기</span>
    </div>
  </div>`;
}

function nameBtns(tid, extra = '') {
  return `<span class="pi-nbs ${extra}" data-nb="${tid}"><button class="pi-nmb pk" data-peek="${tid}" title="누르고 있으면 이름 확인">👀</button><button class="pi-nmb sh" data-act="show" data-p="${tid}">공개</button>${extra === 'clr' ? `<button class="pi-nmb cl" data-act="clrname" data-p="${tid}" title="이 이름 지우고 다시 받기">🗑</button>` : ''}</span>`;
}
/** 팀마다 이름 단추: 이름이 없으면 끔 · 공개됐으면 「숨김」 */
function updateNameBtns(el, s) {
  el.querySelectorAll('[data-nb]').forEach(g => {
    const tid = g.dataset.nb, v = (s.inv || {})[tid], has = !!(v && v.nm), on = !!(s.shown || {})[tid];
    const k = (has ? 1 : 0) + (on ? 2 : 0);
    if (g.__k === k) return;            // 바뀐 것만 고친다(0.2초마다 불린다)
    g.__k = k;
    g.classList.toggle('none', !has);
    g.classList.toggle('on', on);
    g.querySelectorAll('button').forEach(b => { b.disabled = !has; });
    const sh = g.querySelector('.sh');
    if (sh) sh.textContent = !has ? '이름 없음' : on ? '🙈 숨김' : '✅ 공개';
  });
}
function updateNames(el, s, ctx) {
  for (const t of ctx.teams) {
    const card = el.querySelector(`[data-tid="${t.id}"]`);
    if (!card) continue;
    const nmEl = card.querySelector('.pi-nm');
    const peek = el.__peek === t.id && (s.inv || {})[t.id] && s.inv[t.id].nm;
    if (nmEl) text(nmEl, nmEl, peek ? `👀 「${s.inv[t.id].nm}」` : `${isHidden(s, t.id) ? '🙈 ' : ''}「${shownName(s, t.id)}」`);
    card.classList.toggle('hidden-nm', isHidden(s, t.id) && !peek);
    card.classList.toggle('peek', !!peek);
  }
  // 결과 · 걱정 화면의 이름 칸
  el.querySelectorAll('[data-nmt]').forEach(n => {
    const tid = n.dataset.nmt, v = (s.inv || {})[tid];
    const peek = el.__peek === tid && v && v.nm;
    text(n, n, peek ? `👀 「${v.nm}」` : `「${shownName(s, tid)}」`);
  });
}
/** 피칭 · 투자 · 결과 · 걱정 화면 아래쪽: 팀마다 이름 공개 단추 */
function namesBar(ctx) {
  return `<span class="pi-nbar"><span class="pi-nbl">이름</span>${ctx.teams.map(t => `<span class="pi-nbt" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}">${t.emoji}${nameBtns(t.id)}</span>`).join('')}<button class="btn ghost pi-hall" data-act="hideAll">🙈 모두</button></span>`;
}

function updateBuild(el, s, ctx, now) {
  const left = Math.max(0, Math.ceil((s.deadline - now) / 1000));
  const t = el.querySelector('.pi-mtimer');
  if (t) { text(t, '.gk-timer-n', `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`); t.classList.toggle('hot', left <= 10 && left > 0); }
  tickSound(el, left);
  for (const tm of ctx.teams) {
    const card = el.querySelector(`.pi-card[data-tid="${tm.id}"]`);
    if (!card) continue;
    const v = (s.inv || {})[tm.id];
    keyed(card.querySelector('.pi-bx'), JSON.stringify(v ? SLOTS.map(sl => v[sl.key]) : []), boxesHTML(v));
    text(card, '.pi-sen', v && SLOTS.some(sl => v[sl.key] != null) ? sentence(v) : '조종기에서 골라요');
    text(card, '.pi-prog1', v && v.need ? `${v.done}/${v.need}` : (ctx.offline ? '대신 누르기' : '—'));
    card.classList.toggle('ready', !!(v && v.need && v.done >= v.need));
  }
  updateNames(el, s, ctx);
}

// ── 진행판: 피칭 ──
function hostPitch(s, ctx) {
  const tid = s.order[s.turn];
  const t = ctx.teams.find(x => x.id === tid) || { id: tid, name: '?', emoji: '❔', fill: '#b0aea5', tint: '#eee', text: '#141413' };
  const v = s.inv[tid];
  return `
  <div class="pi-wrap">
    <div class="pi-top">
      <div>
        <div class="eyebrow">② 1분 피칭 · ${s.turn + 1}/${s.order.length}팀</div>
        <h1 class="pi-title"><span class="pi-state"></span></h1>
      </div>
      ${timerHTML('피칭')}
    </div>
    <div class="pi-stage">
      <div class="pi-big" data-tid="${tid}" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}">
        <div class="pi-ch"><span class="gk-tag big" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}">${t.emoji} ${esc(t.name)}</span><span class="pi-sp"></span>
          ${nameBtns(tid)}</div>
        <div class="pi-nm big"></div>
        <p class="pi-sen big">${esc(sentence(v))}</p>
        ${boxesHTML(v, true)}
      </div>
      <div class="pi-qs">
        <div class="pi-ql">다른 팀의 질문</div>
        ${QUESTIONS.map(q => `<div class="pi-q" data-q="${q.k}"><span class="pi-qe">${q.e}</span><span class="pi-qt">${q.label}</span><b class="pi-qn num">0</b></div>`).join('')}
        <p class="pi-qh">발표가 끝나면 대표가 질문에 답한다</p>
      </div>
    </div>
    <div class="pi-pick" aria-live="assertive"></div>
    <div class="pi-order">${s.order.map((x, k) => { const T = ctx.teams.find(y => y.id === x); return T ? `<span class="pi-o ${k < s.turn ? 'done' : k === s.turn ? 'now' : ''}" style="--tf:${T.fill};--tt:${T.tint};--tx:${T.text}">${k < s.turn ? '✓' : k === s.turn ? '🎤' : k + 1} ${T.emoji} ${esc(T.name)}</span>` : ''; }).join('')}</div>
    <div class="pi-foot"></div>
  </div>`;
}

function updatePitch(el, s, ctx, now) {
  const t = ctx.teams.find(x => x.id === s.order[s.turn]);
  const secs = s.sub === 'talk' ? secsLeft(s.deadline, now) : s.sub === 'ready' ? PITCH_SECONDS : 0;
  timerUpdate(el, secs);
  if (s.sub === 'talk') tickSound(el, secs);
  text(el, '.pi-state', s.sub === 'ready' ? `🎤 다음 발표: ${t ? t.emoji + ' ' + t.name : ''} — 준비되면 시작!`
    : s.sub === 'talk' ? '🎤 발표 중 — 다른 팀은 조종기로 질문!' : '⏰ 시간 끝! 질문에 답해 볼까요?');
  const q = s.qnow || { q1: 0, q2: 0, q3: 0 };
  for (const Q of QUESTIONS) {
    const box = el.querySelector(`.pi-q[data-q="${Q.k}"]`);
    if (!box) continue;
    const prev = Number(box.dataset.n || 0), n = q[Q.k] || 0;
    if (n !== prev) { box.dataset.n = n; text(box, '.pi-qn', n); if (n > prev) { flash(box, 'pi-bump', 450); beep(700 + n * 30, 60, 'triangle', 0.08); } }
    box.classList.toggle('has', n > 0);
  }
  updateNames(el, s, ctx);
  const last = s.turn + 1 >= s.order.length;
  keyed(el.querySelector('.pi-foot'), s.sub + s.turn, s.sub === 'ready'
    ? `<button class="btn big" data-act="talk">🎤 피칭 시작 ▶</button><button class="btn ghost" data-act="skip">이 팀 건너뛰기</button>${namesBar(ctx)}`
    : s.sub === 'talk'
      ? `<button class="btn ghost" data-act="more">+15초</button><button class="btn ghost" data-act="stop">발표 끝</button><button class="btn" data-act="pickq">🎲 질문자 뽑기</button><button class="btn" data-act="next">${last ? '투자 시간 ▶' : '다음 팀 ▶'}</button>${namesBar(ctx)}`
      : `<button class="btn big" data-act="pickq">🎲 질문자 뽑기</button><button class="btn" data-act="next">${last ? '💰 투자 시간 ▶' : '다음 팀 ▶'}</button>${namesBar(ctx)}`);
  // 🎲 뽑힌 질문자
  const pk = s.qpick;
  const pkey = pk ? `${pk.at}` : '';
  const box = el.querySelector('.pi-pick');
  if (box && box.dataset.k !== pkey) {
    box.dataset.k = pkey;
    if (!pk) box.innerHTML = '';
    else if (pk.none) box.innerHTML = `<div class="pi-pk none"><b>🎲 아직 질문 단추를 누른 사람이 없어요</b><span>조종기에서 질문 단추를 누른 사람 중에서 뽑아요</span><button class="btn ghost" data-act="pickclose">닫기</button></div>`;
    else {
      const T = ctx.teams.find(x => x.id === pk.team);
      box.innerHTML = `<div class="pi-pk" ${T ? `style="--tf:${T.fill};--tt:${T.tint};--tx:${T.text}"` : ''}>
        <div class="pi-pkd" aria-hidden="true">🎲</div>
        <div class="pi-pkt">${T ? `<span class="gk-tag big" style="--tf:${T.fill};--tt:${T.tint};--tx:${T.text}">${T.emoji} ${esc(T.name)}</span>` : ''}
          <b class="num">${pk.num ? `${pk.num}번` : '대신 누르기'}, 직접 물어보세요!</b>
          <span>누른 질문: ${QUESTIONS.filter(Q => (pk.qk || []).includes(Q.k)).map(Q => `${Q.e} ${Q.label}`).join(' · ')} <small>(후보 ${pk.n}명)</small></span></div>
        <div class="pi-pkb"><button class="btn" data-act="pickq">🎲 다시 뽑기</button><button class="btn ghost" data-act="pickclose">닫기</button></div></div>`;
      flash(box.firstElementChild, 'pi-pkin', 600);
      beep(523, 80, 'triangle', 0.1); setTimeout(() => beep(659, 80, 'triangle', 0.1), 90); setTimeout(() => beep(784, 200, 'triangle', 0.12), 180);
    }
  }
}

// ── 진행판: 투자 ──
function hostInvest(s, ctx) {
  const n = ctx.teams.length;
  return `
  <div class="pi-wrap">
    <div class="pi-top">
      <div>
        <div class="eyebrow">③ 투자 시간 · 1위 발명품에 절반 이상 걸면 우리 팀 보너스 +${PREDICT_BONUS}</div>
        <h1 class="pi-title">💰 근거가 가장 그럴듯한 발명품은? 각자 ${INVEST_COINS}코인을 다른 팀에!</h1>
      </div>
      ${timerHTML('투자')}
    </div>
    <div class="pi-grid mini" style="--c:${cols(n)};--r:${Math.ceil(n / cols(n))}">
      ${ctx.teams.map(t => { const v = s.inv[t.id]; return `
      <div class="pi-card" data-tid="${t.id}" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}">
        <div class="pi-ch"><span class="gk-tag" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}">${t.emoji} ${esc(t.name)}</span></div>
        <div class="pi-nm"></div>
        <div class="pi-emo">${SLOTS.map(sl => opt(sl.key, v && v[sl.key])?.e || '❔').join('<i>→</i>')}</div>
        <div class="pi-sen">${esc(sentence(v))}</div>
        <div class="pi-money" aria-hidden="true">💰 <b>?</b></div>
      </div>`; }).join('')}
    </div>
    <div class="pi-prog"><span>투자한 사람</span><span class="pi-pbar"><i></i></span><b class="num">0/0</b></div>
    <div class="pi-foot">
      <button class="btn ghost" data-act="more">+15초</button><button class="btn" data-act="close">투자 마감 → 결과 ▶</button>
      ${namesBar(ctx)}
    </div>
  </div>`;
}

// ── 진행판: 결과 ──
function hostResult(s, ctx, anim = true) {
  const rows = ctx.teams.slice().sort((a, b) => s.rank[a.id] - s.rank[b.id]);
  const max = Math.max(1, ...Object.values(s.recv));
  const k = qKing(s);
  const kt = k && ctx.teams.find(t => t.id === k.tid);
  const n = rows.length;
  return `
  <div class="pi-wrap ${anim ? '' : 'no-anim'}">
    <div class="pi-top"><div>
      <div class="eyebrow">④ 결과 · 투자 순위</div>
      <h1 class="pi-title pi-reveal">${rows[0] && s.recv[rows[0].id] > 0 ? `👑 투자 1위 — ${rows[0].emoji} ${esc(rows[0].name)} 「${esc(shownName(s, rows[0].id))}」` : '투자 결과'}</h1>
    </div></div>
    <div class="pi-res">
      <div class="pi-rank">
        ${rows.map((t, i) => `
        <div class="pi-rr ${s.rank[t.id] === 1 && s.recv[t.id] > 0 ? 'top' : ''}" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text};--d:${((n - 1 - i) * 0.18).toFixed(2)}s">
          <span class="pi-rk">${medal(s.rank[t.id])}</span>
          <span class="pi-rn"><b>${t.emoji} ${esc(t.name)}</b><small data-nmt="${t.id}">「${esc(shownName(s, t.id))}」</small></span>
          <span class="pi-bar"><i style="width:${(s.recv[t.id] / max * 100).toFixed(1)}%"></i></span>
          <b class="pi-rv num">${fmt(s.recv[t.id])}</b><span class="pi-rp num">+${(s.rpts || s.pts)[t.id]}</span><span class="pi-rb num ${(s.bonus || {})[t.id] ? '' : 'zero'}" title="1위 맞히기 보너스">🎯+${(s.bonus || {})[t.id] || 0}</span>
        </div>`).join('')}
      </div>
      <div class="pi-king">
        <div class="pi-kl">🙋 질문을 가장 많이 받은 발명품</div>
        ${kt ? `<div class="pi-kt"><span class="gk-tag big" style="--tf:${kt.fill};--tt:${kt.tint};--tx:${kt.text}">${kt.emoji} ${esc(kt.name)}</span></div>
          <div class="pi-kn" data-nmt="${kt.id}">「${esc(shownName(s, kt.id))}」</div>
          <div class="pi-kq">${QUESTIONS.map(q => `<span>${q.e} ${q.label} <b class="num">${k.q[q.k] || 0}</b></span>`).join('')}</div>
          <p class="pi-kh">질문을 많이 받았다 = 모두가 궁금해한 발명품!</p>`
        : '<p class="pi-kh">이번엔 질문이 없었어요</p>'}
        <p class="pi-kb">🎯 = 1위 발명품에 절반(250) 이상 건 팀 +${PREDICT_BONUS} · 1위 팀은 자동 +${PREDICT_BONUS}</p>
      </div>
    </div>
    <div class="pi-foot"><button class="btn big" data-act="worry">🤔 걱정되는 점 모으기 ▶</button>${namesBar(ctx)}</div>
  </div>`;
}

function hostWorry(s, ctx) {
  const rows = ctx.teams.map(t => {
    const v = s.inv[t.id], b = opt('bio', v && v.bio), q = (s.qs || {})[t.id] || {};
    const topQ = QUESTIONS.slice().sort((x, y) => (q[y.k] || 0) - (q[x.k] || 0)).filter(x => (q[x.k] || 0) > 0);
    return { t, v, b, q, topQ };
  });
  const totals = QUESTIONS.map(Q => ({ Q, n: Object.values(s.qs || {}).reduce((a, q) => a + (q[Q.k] || 0), 0) }));
  return `
  <div class="pi-wrap">
    <div class="pi-top"><div>
      <div class="eyebrow">⑤ 걱정되는 점 모으기 → 다음 시간 출발 질문</div>
      <h1 class="pi-title">🤔 우리 발명품, 이런 걱정은 없을까?</h1>
    </div>
      <div class="pi-tot">${totals.map(x => `<span>${x.Q.e} ${x.Q.label} <b class="num">${x.n}</b></span>`).join('')}</div>
    </div>
    <div class="pi-worry" style="--r:${Math.ceil(rows.length / 2)}">
      ${rows.map(({ t, v, b, q, topQ }) => `
      <div class="pi-w" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}">
        <div class="pi-wh"><span class="pi-we">${SLOTS.map(sl => opt(sl.key, v && v[sl.key])?.e || '').join('')}</span>
          <b>${t.emoji} <span data-nmt="${t.id}">「${esc(shownName(s, t.id))}」</span></b></div>
        <p>${b ? esc(b.worry) : ''}</p>
        <div class="pi-wq">${topQ.length ? topQ.map(Q => `<span>${Q.e} ${Q.label} ×${q[Q.k]}</span>`).join('') : '<span class="dim">받은 질문 없음</span>'}</div>
      </div>`).join('')}
    </div>
    <p class="gk-note">생명 기술은 문제를 풀지만 <b>누군가는 손해</b>를 보거나 <b>생명 윤리</b> 문제가 생길 수 있다 — 다음 시간 「생명 기술의 영향」에서 이 질문들로 시작한다.</p>
    <div class="pi-foot"><button class="btn big" data-act="finish">결과 보기 ▶</button>${namesBar(ctx)}</div>
  </div>`;
}

// ── 조종기: 조립 (한 화면에 하나: ① 투입 ② 생물 ③ 산출 ④ 누구 ⑤ 이름) ──
function playBuild(el, s, me, ctx, now) {
  // 내가 마지막으로 보낸 값을 기억해 쓴다. 빠르게 연달아 누르면 DB 에서 돌아오는 앞선 값(me.mine)이
  // 늦게 도착해 방금 고른 칸을 지울 수 있어서다(학생은 자기 칸의 유일한 작성자다).
  const mine = el.__last || me.mine || {};
  const v = (s.inv || {})[me.team] || {};
  let sub = el.__sub || 0;
  if (sub > SLOTS.length) sub = SLOTS.length;
  const picks = SLOTS.map(sl => (Number.isInteger(mine[sl.key]) ? mine[sl.key] : null));
  const tabs = `<div class="pb-tabs">${[...SLOTS.map((sl, k) => [sl.box, picks[k] != null ? sl.opts[picks[k]].e : String(k + 1)]), ['이름', mine.nm ? '✏️' : String(SLOTS.length + 1)]]
    .map(([lbl, mark], k) => `<button class="pb-tab ${k === sub ? 'on' : ''} ${(k < SLOTS.length ? picks[k] != null : !!mine.nm) ? 'done' : ''}" data-tab="${k}"><span>${mark}</span>${lbl}</button>`).join('')}
    <span class="pb-time num"></span></div>`;
  const send = patch => { const next = { ...pickInput(mine), ...patch }; el.__last = next; ctx.send(next); };
  if (sub < SLOTS.length) {
    const sl = SLOTS[sub];
    if (keyed(el, `pb-${sub}-${picks.join(',')}-${mine.nm || ''}`, `
      <div class="pb">
        ${tabs}
        <div class="pb-q"><h2>${sl.icon} ${sub + 1}. ${sl.q}</h2><span class="pb-team"></span></div>
        <div class="pb-opts">${sl.opts.map((o, i) => `
          <button class="pb-o ${picks[sub] === i ? 'on' : ''}" data-i="${i}" aria-pressed="${picks[sub] === i}"><span class="pb-oe">${o.e}</span><b>${esc(o.label)}</b><span class="pb-oc"></span></button>`).join('')}</div>
        <p class="pb-hint">팀원들과 의논해서 골라요 · 팀 결정 = 다수결 · 시간 안에는 바꿀 수 있어요</p>
      </div>`)) {
      bindTabs(el);
      el.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { el.__sub = sub + 1; send({ [sl.key]: Number(b.dataset.i) }); });
    }
    const cnt = (v.cnt || {})[sl.key] || {};
    el.querySelectorAll('.pb-o').forEach(b => text(b, '.pb-oc', cnt[b.dataset.i] ? `👥 ${cnt[b.dataset.i]}` : ''));
    const w = opt(sl.key, v[sl.key]);
    text(el, '.pb-team', w ? `우리 팀 결정: ${w.e} ${w.label}` : '우리 팀: 아직');
  } else {
    const lock = (s.nmLock || {})[me.team];
    const cleared = !lock && (s.nmClr || {})[me.team];
    if (keyed(el, `pb-name-${picks.join(',')}-${mine.nm || ''}-${lock ? lock.nm : ''}-${cleared ? 'c' : ''}`, `
      <div class="pb">
        ${tabs}
        <div class="pb-q"><h2>✏️ 5. 발명품 이름은? <small>(${NAME_MAX}자까지 · 사람 이름은 넣지 않아요)</small></h2></div>
        <div class="pb-card"><div class="pb-emo"></div><p class="pb-sen"></p></div>
        ${lock ? `<div class="pb-locked">✅ 우리 팀 이름: <b>「${esc(lock.nm)}」</b><small>팀에서 먼저 낸 이름으로 정해졌어요 · 선생님이 확인하면 큰 화면에 떠요</small></div>`
        : `<form class="pb-form" autocomplete="off"><input class="pb-in" maxlength="${NAME_MAX}" placeholder="예: 바이오 발명품" value="${esc(mine.nm || '')}" aria-label="발명품 이름">
          <button class="btn big" type="submit">이름 보내기</button></form>
        <div class="pb-ideas"></div>`}
        <p class="pb-now"></p>
      </div>`)) {
      bindTabs(el);
      const f = el.querySelector('.pb-form'), inp = el.querySelector('.pb-in');
      if (f) f.onsubmit = e => { e.preventDefault(); const nm = cleanName(inp.value); if (nm) send({ nm }); };
    }
    // 팀 결정(다수결)은 이름을 짓는 동안에도 바뀔 수 있다 → 입력 칸은 그대로 두고 그림 · 추천만 다시 그린다
    keyed(el.querySelector('.pb-emo'), SLOTS.map(sl2 => v[sl2.key]).join(','), SLOTS.map(sl2 => opt(sl2.key, v[sl2.key])?.e || '❔').join('<i>→</i>'));
    const ideas = nameIdeas(v);
    if (el.querySelector('.pb-ideas') && keyed(el.querySelector('.pb-ideas'), ideas.join('|'), ideas.map(x => `<button class="pb-idea" type="button" data-nm="${esc(x)}">💡 ${esc(x)}</button>`).join(''))) {
      el.querySelectorAll('[data-nm]').forEach(b => b.onclick = () => send({ nm: b.dataset.nm }));
      const inp = el.querySelector('.pb-in');
      if (inp) inp.placeholder = `예: ${ideas[0] || '바이오 발명품'}`;
    }
    text(el, '.pb-sen', sentence(v));
    text(el, '.pb-now', lock ? ((s.shown || {})[me.team] ? '📺 큰 화면에 우리 이름이 공개됐어요!' : '🙈 아직 큰 화면에는 「팀 발명품」으로 보여요')
      : cleared ? '🗑 선생님이 이름을 지웠어요 — 다시 지어 보내요 (먼저 낸 하나만 쓰여요)'
      : '팀에서 먼저 보낸 이름 하나만 쓰여요 — 안 지으면 자동 이름');
  }
  const left = Math.max(0, Math.ceil((s.deadline - now) / 1000));
  text(el, '.pb-time', `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);
}
function pickInput(mine) {
  const o = {};
  for (const sl of SLOTS) if (Number.isInteger(mine[sl.key])) o[sl.key] = mine[sl.key];
  if (mine.nm) o.nm = mine.nm;
  return o;
}
function bindTabs(el) {
  el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { el.__sub = Number(b.dataset.tab); el.dataset.key = ''; });
}

// ── 조종기: 피칭 ──
function playPitch(el, s, me, ctx, now) {
  const cur = s.order[s.turn];
  const T = ctx.teams[cur] || { emoji: '❔', name: '?' };
  const v = s.inv[cur];
  const mineTurn = cur === me.team;
  const open = s.sub === 'talk' || s.sub === 'qa';
  const q = s.qnow || { q1: 0, q2: 0, q3: 0 };
  if (mineTurn) {
    keyed(el, `pp-me-${s.turn}-${s.sub}-${hk(s)}`, `
      <div class="pq">
        <div class="pq-head"><span class="pv-eyebrow">${s.turn + 1}/${s.order.length}팀 · 우리 팀 차례</span><span class="pq-time num"></span></div>
        <div class="pq-big">🎤 ${s.sub === 'ready' ? '곧 우리 팀 발표! 1분 동안 소개해요' : s.sub === 'talk' ? '발표 중! 질문이 들어와요' : '시간 끝 — 질문에 답해요'}</div>
        <div class="pq-card"><b>「${esc(v && v.nm ? v.nm : shownName(s, cur))}」${isHidden(s, cur) ? ' <small>🙈 큰 화면엔 아직 「팀 발명품」</small>' : ''}</b><span>${esc(sentence(v))}</span></div>
        <div class="pq-counts">${QUESTIONS.map(Q => `<div class="pq-c" data-q="${Q.k}"><span>${Q.e}</span><b class="num">0</b><small>${Q.label}</small></div>`).join('')}</div>
      </div>`);
    for (const Q of QUESTIONS) text(el, `.pq-c[data-q="${Q.k}"] b`, q[Q.k] || 0);
  } else {
    const mine = (el.__q && el.__q.turn === s.turn) ? el.__q.v : (me.mine || {});
    const picked = !!(s.qpick && s.qpick.u === me.uid);
    const key = `pp-${s.turn}-${s.sub}-${QUESTIONS.map(Q => mine[Q.k] ? 1 : 0).join('')}-${hk(s)}-${picked ? s.qpick.at : ''}`;
    if (keyed(el, key, `
      <div class="pq">
        <div class="pq-head"><span class="pv-eyebrow">${s.turn + 1}/${s.order.length}팀 발표 · ${T.emoji} ${esc(T.name)}</span><span class="pq-time num"></span></div>
        <div class="pq-card"><span class="pq-emo">${SLOTS.map(sl => opt(sl.key, v && v[sl.key])?.e || '❔').join('<i>→</i>')}</span><b>「${esc(shownName(s, cur))}」</b><span>${esc(sentence(v))}</span></div>
        ${picked ? `<p class="pq-picked">🎲 내가 뽑혔어요! 일어나서 직접 물어봐요 — ${QUESTIONS.filter(Q => (s.qpick.qk || []).includes(Q.k)).map(Q => `${Q.e} ${Q.label}`).join(' · ')}</p>` : ''}
        ${open ? `<p class="pq-ask">궁금한 질문을 눌러요 (질문마다 한 번) · 누른 사람 중에서 🎲 질문자를 뽑아요</p>
        <div class="pq-btns">${QUESTIONS.map(Q => `<button class="pq-b ${mine[Q.k] ? 'on' : ''}" data-q="${Q.k}" ${mine[Q.k] ? 'disabled' : ''}><span>${Q.e}</span><b>${Q.label}</b><small>${mine[Q.k] ? '✓ 질문했어요' : ''}</small></button>`).join('')}</div>`
        : `<p class="pq-wait">👂 곧 발표가 시작돼요 — 잘 들어요</p>`}
      </div>`)) {
      el.querySelectorAll('.pq-b[data-q]').forEach(b => b.onclick = () => {
        const next = {};
        for (const Q of QUESTIONS) if (mine[Q.k]) next[Q.k] = true;
        next[b.dataset.q] = true;
        b.disabled = true;
        el.__q = { turn: s.turn, v: next };
        ctx.send(next);
      });
    }
  }
  text(el, '.pq-time', s.sub === 'talk' ? `⏱ ${secsLeft(s.deadline, now)}초` : '');
}

// ── 조종기: 투자 ──
function playInvest(el, s, me, ctx, now) {
  const mine = el.__inv || me.mine || {};
  const others = Object.entries(ctx.teams).filter(([id]) => id !== me.team).sort((a, b) => (a[1].i ?? 0) - (b[1].i ?? 0));
  const alloc = Object.fromEntries(others.map(([id]) => [id, Math.max(0, Number(mine[id]) || 0)]));
  const used = Object.values(alloc).reduce((a, b) => a + b, 0);
  const leftC = INVEST_COINS - used;
  if (keyed(el, `pi-${JSON.stringify(alloc)}-${hk(s)}`, `
    <div class="pv-inv">
      <div class="pv-ih"><span class="pv-eyebrow">투자 시간 · 내 코인 ${INVEST_COINS}</span><span class="pv-it num"></span></div>
      <div class="pv-left">남은 코인 🪙 <b class="num">${leftC}</b> <small>— 마음에 드는 발명품에 ${CHIP}씩 걸어요</small></div>
      <div class="pv-rows" style="--r:${others.length}">
        ${others.map(([id, T]) => `
        <div class="pv-ir" style="--tf:${T.fill};--tt:${T.tint};--tx:${T.text}">
          <span class="pv-in"><b>${T.emoji} ${esc(T.name)}</b><small>「${esc(shownName(s, id))}」</small></span>
          <button class="pv-pm" data-t="${id}" data-d="-1" ${alloc[id] ? '' : 'disabled'} aria-label="빼기">−</button>
          <b class="pv-iv num">${alloc[id]}</b>
          <button class="pv-pm plus" data-t="${id}" data-d="1" ${leftC >= CHIP ? '' : 'disabled'} aria-label="더하기">+</button>
        </div>`).join('')}
      </div>
      <p class="pv-ihint">우리 팀 투자 = 팀원들이 건 코인의 평균 · 마감 전까지 바꿀 수 있어요</p>
    </div>`)) {
    el.querySelectorAll('.pv-pm').forEach(b => b.onclick = () => {
      const id = b.dataset.t, d = Number(b.dataset.d) * CHIP;
      const next = { ...alloc, [id]: Math.max(0, alloc[id] + d) };
      if (Object.values(next).reduce((a, x) => a + x, 0) > INVEST_COINS) return;
      el.__inv = next;
      ctx.send(next);
    });
  }
  text(el, '.pv-it', `⏱ ${secsLeft(s.deadline, now)}초`);
}

const CSS = `
.pi-wrap{position:relative;display:flex;flex-direction:column;height:100%;gap:10px}
.pi-top{display:flex;align-items:flex-end;justify-content:space-between;gap:24px}
.pi-title{font-size:30px;font-weight:800;letter-spacing:-.025em;line-height:1.25;margin:6px 0 0}
.pi-grid{flex:1;display:grid;grid-template-columns:repeat(var(--c),minmax(0,1fr));grid-template-rows:repeat(var(--r),minmax(0,1fr));gap:10px;min-height:0}
.pi-card{container-type:size;display:flex;flex-direction:column;gap:6px;background:var(--card);border:1.5px solid var(--line);border-top:8px solid var(--tf);border-radius:var(--r-l);padding:10px 12px;min-height:0;overflow:hidden}
.pi-card.ready{background:var(--tt)}
.pi-ch{display:flex;align-items:center;gap:8px}
.pi-sp{flex:1}
.pi-prog1{flex:1;font-size:17px;font-weight:800;color:var(--dim);text-align:right}
.pi-nbs{display:inline-flex;gap:3px;flex:0 0 auto}
.pi-card .pi-ch .gk-tag{white-space:nowrap;flex:0 0 auto}
.pi-card .pi-prog1{min-width:0;white-space:nowrap;overflow:hidden}
.pc-bi{font-style:normal}
.pi-nmb{border:1.5px solid var(--line);background:var(--card);border-radius:8px;font-size:16px;font-weight:800;padding:2px 7px;cursor:pointer;line-height:1.3;color:var(--ink);touch-action:none;user-select:none}
.pi-nmb.sh{border-color:var(--org);background:var(--org-w);color:var(--org-t)}
.pi-nbs.on .pi-nmb.sh{border-color:var(--line);background:var(--card);color:var(--dim)}
.pi-nbs.none .pi-nmb{opacity:.45;cursor:default}
.pi-nbs.none .pi-nmb.pk,.pi-nbs.none .pi-nmb.cl{display:none}
.pi-card.peek .pi-nm,.pi-big.peek .pi-nm{color:var(--org-t)}
.pi-nbar{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;margin-left:auto}
.pi-nbl{font-size:16px;font-weight:800;color:var(--dim)}
.pi-nbt{display:inline-flex;align-items:center;gap:3px;font-size:20px;border:1.5px solid var(--line);border-left:6px solid var(--tf);border-radius:10px;padding:2px 4px;background:var(--card)}
.pi-nbt .pi-nmb{font-size:15px;padding:1px 6px}
.pi-nbar .pi-hall{padding:6px 10px;font-size:15px}
.pi-nm{font-size:24px;font-weight:800;letter-spacing:-.025em;line-height:1.25;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pi-card.hidden-nm .pi-nm,.pi-big.hidden-nm .pi-nm{color:var(--dim)}
.pi-sen{font-size:17px;font-weight:700;color:var(--dim);line-height:1.4;min-height:24px}
.pi-bx{flex:1;min-height:0;display:flex}
.pc-boxes{flex:1;display:grid;grid-template-columns:1fr 12px 1fr 12px 1fr 12px 1fr;gap:3px;align-items:stretch;min-height:0}
.pc-box{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;background:var(--paper);border:1.5px dashed var(--mid-d);border-radius:10px;padding:4px 2px;min-width:0;text-align:center}
.pc-box.on{border:1.5px solid var(--line);background:var(--card);animation:gk-pop .3s both}
.pc-bh{font-size:18px;font-weight:800;color:var(--org-t);white-space:nowrap;letter-spacing:-.03em}
.pc-be{font-size:34px;line-height:1.1}
.pc-bl{font-size:18px;font-weight:700;line-height:1.25;word-break:keep-all;letter-spacing:-.03em}
.pc-ar{align-self:center;font-style:normal;font-weight:800;color:var(--mid-d);text-align:center;font-size:18px}
.pc-boxes.big{flex:1 1 0;min-height:0;max-height:280px;grid-template-columns:1fr 26px 1fr 26px 1fr 26px 1fr;gap:6px;container-type:size}
.pc-boxes.big .pc-bh{font-size:clamp(18px,8cqh,22px)}.pc-boxes.big .pc-be{font-size:clamp(26px,32cqh,80px)}.pc-boxes.big .pc-bl{font-size:clamp(18px,9cqh,22px)}
.pc-boxes.big .pc-ar{font-size:30px}
.pi-foot{display:flex;align-items:center;gap:12px;min-height:48px;flex-wrap:wrap}
.pi-hall.on{border-color:var(--org);background:var(--org-w);color:var(--org-t)}
.pi-mtimer .gk-timer-n{min-width:2.6em}
/* 피칭 */
.pi-state{display:inline}
.pi-stage{flex:1;display:grid;grid-template-columns:minmax(0,1fr) 330px;grid-template-rows:minmax(0,1fr);gap:16px;min-height:0;container-type:size}
.pi-big{display:flex;flex-direction:column;gap:10px;background:var(--card);border:1.5px solid var(--line);border-top:12px solid var(--tf);border-radius:var(--r-l);padding:16px 20px;min-height:0;overflow:hidden;animation:gk-pop .4s both}
.gk-tag.big{font-size:22px;padding:5px 16px}
.pi-nm.big{font-size:48px;letter-spacing:-.035em;line-height:1.15;white-space:normal}
.pi-sen.big{font-size:22px;color:var(--ink);margin:0;line-height:1.45}
.pi-qs{display:flex;flex-direction:column;gap:10px;background:var(--card);border:1.5px solid var(--line);border-radius:var(--r-l);padding:14px}
.pi-ql{font-size:17px;font-weight:800;color:var(--dim)}
.pi-q{flex:1;display:grid;grid-template-columns:52px 1fr auto;align-items:center;gap:8px;background:var(--paper);border:1.5px solid var(--line);border-radius:12px;padding:6px 14px;min-height:0}
.pi-q.has{background:var(--org-w);border-color:var(--org-l)}
.pi-qe{font-size:38px;line-height:1}.pi-qt{font-size:22px;font-weight:800}.pi-qn{font-size:52px;font-weight:800;letter-spacing:-.04em}
.pi-bump{animation:pi-bump .4s cubic-bezier(.2,.75,.3,1)}
@keyframes pi-bump{0%{transform:scale(1.1)}100%{transform:none}}
.pi-qh{font-size:16px;color:var(--dim);margin:0}
.pi-order{display:flex;gap:6px;flex-wrap:wrap}
.pi-o{font-size:17px;font-weight:800;padding:4px 12px;border-radius:99px;border:1.5px solid var(--line);background:var(--card);color:var(--tx)}
.pi-pick:empty{display:none}
.pi-pick{position:absolute;inset:0;display:grid;place-items:center;z-index:20;pointer-events:none}
.pi-pk{pointer-events:auto;display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;gap:10px 24px;align-items:center;background:var(--card);border:3px solid #141413;border-top:16px solid var(--tf,var(--org));border-radius:24px;padding:22px 36px;box-shadow:0 18px 50px rgba(20,20,19,.25);max-width:1100px}
.pi-pk.none{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center}
.pi-pk.none b{font-size:32px}.pi-pk.none span{font-size:20px;color:var(--dim)}
.pi-pkd{font-size:110px;line-height:1;grid-row:span 2;animation:pi-roll .7s cubic-bezier(.2,.75,.3,1)}
@keyframes pi-roll{0%{transform:rotate(-540deg) scale(.4)}100%{transform:none}}
.pi-pkt{display:flex;flex-direction:column;align-items:flex-start;gap:6px}
.pi-pkt b{font-size:64px;font-weight:800;letter-spacing:-.04em;line-height:1.05}
.pi-pkt span{font-size:22px;font-weight:700}.pi-pkt small{font-size:17px;color:var(--dim)}
.pi-pkb{display:flex;gap:10px;grid-column:2}
.pi-pkin{animation:gk-pop .45s cubic-bezier(.2,.75,.3,1)}
.pi-o.done{opacity:.55}
.pi-o.now{background:var(--tt);border-color:var(--tf);box-shadow:0 0 0 2px var(--tf)}
/* 투자 */
.pi-grid.mini .pi-card{gap:4px}
.pi-grid.mini .pi-emo{font-size:42px}
.pi-grid.mini .pi-sen{font-size:17px;color:var(--ink);line-height:1.38}
.pi-emo{font-size:36px;line-height:1.1;display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.pi-emo i,.pb-emo i,.pq-emo i{font-style:normal;font-size:16px;color:var(--mid-d);font-weight:800}
.pi-money{margin-top:auto;align-self:flex-end;font-size:30px;font-weight:800;color:var(--mid-d);animation:gkpulse .9s infinite alternate}
.pi-prog{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;font-size:17px;font-weight:800}
.pi-prog b{font-size:26px}
.pi-pbar{height:20px;background:var(--line);border-radius:6px;overflow:hidden}
.pi-pbar i{display:block;height:100%;width:0;background:var(--grn);transition:width .4s}
/* 결과 */
.pi-res{flex:1;display:grid;grid-template-columns:minmax(0,1fr) 380px;grid-template-rows:minmax(0,1fr);gap:16px;min-height:0}
.pi-rank{display:flex;flex-direction:column;gap:6px;justify-content:center;min-height:0;overflow:hidden}
.pi-rr{flex:1 1 0;min-height:0;max-height:66px;display:grid;grid-template-columns:56px 230px 1fr 90px 50px 64px;gap:12px;align-items:center;background:var(--card);border:1.5px solid var(--line);border-left:10px solid var(--tf);border-radius:12px;padding:0 12px;overflow:hidden;
  animation:gk-in .4s cubic-bezier(.2,.75,.3,1) both;animation-delay:var(--d)}
.pi-rr.top{background:var(--tt);box-shadow:0 0 0 3px var(--tf)}
.pi-rk{font-size:28px;text-align:center}
.pi-rn{display:flex;flex-direction:column;min-width:0;line-height:1.25}
.pi-rn b{font-size:19px;color:var(--tx)}.pi-rn small{font-size:17px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pi-bar{height:24px;background:var(--line);border-radius:6px;overflow:hidden}
.pi-bar i{display:block;height:100%;background:var(--tf);border-radius:6px;animation:pi-grow 1.1s cubic-bezier(.2,.75,.3,1) both;animation-delay:var(--d)}
@keyframes pi-grow{from{max-width:0}to{max-width:100%}}
.pi-rv{font-size:26px;text-align:right;letter-spacing:-.03em}.pi-rp{font-size:20px;font-weight:800;color:var(--grn-t)}
.pi-rb{font-size:19px;font-weight:800;color:var(--org-t)}.pi-rb.zero{color:var(--mid-d);font-weight:700}
.pi-kb{font-size:17px;font-weight:700;color:var(--org-t);margin:0}
.pi-reveal{animation:gk-pop .5s 1.4s both}
.pi-king{display:flex;flex-direction:column;gap:12px;justify-content:center;align-items:flex-start;background:var(--card);border:1.5px solid var(--line);border-radius:var(--r-l);padding:20px}
.pi-kl{font-size:19px;font-weight:800}
.pi-kn{font-size:32px;font-weight:800;letter-spacing:-.03em;line-height:1.25}
.pi-kq{display:flex;flex-direction:column;gap:6px}.pi-kq span{font-size:20px;font-weight:700}.pi-kq b{font-size:26px}
.pi-kh{font-size:17px;color:var(--dim);margin:0}
/* 걱정 */
.pi-tot{display:flex;gap:10px}.pi-tot span{font-size:17px;font-weight:800;background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:6px 12px}.pi-tot b{font-size:24px}
.pi-worry{flex:1;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(var(--r),minmax(0,1fr));gap:8px;min-height:0}
.pi-w{display:flex;flex-direction:column;justify-content:center;gap:4px;background:var(--card);border:1.5px solid var(--line);border-left:10px solid var(--tf);border-radius:12px;padding:6px 14px;min-height:0;overflow:hidden;animation:gk-pop .35s both}
.pi-wh{display:flex;align-items:center;gap:10px;min-width:0}.pi-we{font-size:24px;white-space:nowrap}
.pi-wh b{font-size:19px;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pi-w p{font-size:18px;font-weight:700;margin:0;line-height:1.4}
.pi-wq{display:flex;gap:8px;flex-wrap:wrap}.pi-wq span{font-size:16px;font-weight:800;background:var(--org-w);border:1px solid var(--org-l);border-radius:99px;padding:1px 10px}
.pi-wq span.dim{background:none;border:none}
/* 조종기: 조립 */
.pb{display:flex;flex-direction:column;gap:12px;height:100%;max-width:1100px;width:100%;margin:0 auto;justify-content:center}
.pb-tabs{display:flex;gap:6px;align-items:center}
.pb-tab{display:flex;align-items:center;gap:6px;font-size:16px;font-weight:800;padding:6px 12px;border-radius:99px;border:1.5px solid var(--line);background:var(--card);cursor:pointer;color:var(--ink)}
.pb-tab span{font-size:18px}
.pb-tab.done{border-color:var(--grn-l);background:var(--grn-w)}
.pb-tab.on{border-color:var(--org);box-shadow:0 0 0 2px var(--org);background:var(--org-w)}
.pb-time{margin-left:auto;font-size:20px;font-weight:800}
.pb-q{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
.pb-q h2{font-size:30px;font-weight:800;letter-spacing:-.025em;margin:0}
.pb-q h2 small{font-size:16px;color:var(--dim);font-weight:700}
.pb-team{font-size:19px;font-weight:800;color:var(--grn-t)}
.pb-opts{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.pb-o{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:150px;border-radius:18px;border:2.5px solid var(--line);background:var(--card);cursor:pointer;color:var(--ink)}
.pb-o:hover{border-color:var(--mid-d)}
.pb-oe{font-size:50px;line-height:1}.pb-o b{font-size:23px;letter-spacing:-.02em}
.pb-oc{position:absolute;top:8px;left:10px;font-size:14px;font-weight:800;color:var(--dim)}
.pb-o.on{border-color:var(--org);background:var(--org-w);box-shadow:0 0 0 2px var(--org)}
.pb-o.on::after{content:'✓';position:absolute;top:6px;right:8px;width:26px;height:26px;border-radius:50%;background:var(--org);color:#141413;font-weight:800;display:grid;place-items:center}
.pb-hint{font-size:16px;color:var(--dim);margin:0}
.pb-card{background:var(--card);border:1.5px solid var(--line);border-radius:var(--r-l);padding:12px 18px}
.pb-emo{font-size:44px;display:flex;align-items:center;gap:8px}
.pb-sen{font-size:19px;font-weight:700;margin:6px 0 0}
.pb-form{display:flex;gap:12px}
.pb-in{flex:1;font-size:32px;font-weight:800;padding:12px 18px;border-radius:var(--r-m);border:2.5px solid var(--mid-d);background:var(--card);min-width:0}
.pb-ideas{display:flex;gap:10px;flex-wrap:wrap}
.pb-idea{font-size:19px;font-weight:700;padding:10px 16px;border-radius:12px;border:1.5px solid var(--line);background:var(--card);cursor:pointer}
.pb-idea:hover{border-color:var(--org)}
.pb-now{font-size:19px;font-weight:800;margin:0;color:var(--grn-t)}
.pb-locked{display:flex;flex-direction:column;gap:4px;background:var(--grn-w);border:2px solid var(--grn);border-radius:var(--r-l);padding:14px 20px;font-size:22px;font-weight:800}
.pb-locked b{font-size:34px;letter-spacing:-.03em}.pb-locked small{font-size:17px;color:var(--dim);font-weight:700}
/* 조종기: 피칭 */
.pq{display:flex;flex-direction:column;gap:14px;height:100%;max-width:1100px;width:100%;margin:0 auto;justify-content:center}
.pq-head{display:flex;justify-content:space-between;align-items:center}
.pq-time{font-size:22px;font-weight:800}
.pq-big{font-size:32px;font-weight:800;letter-spacing:-.025em}
.pq-card{display:flex;flex-direction:column;gap:4px;background:var(--card);border:1.5px solid var(--line);border-radius:var(--r-l);padding:12px 18px}
.pq-card b{font-size:30px;letter-spacing:-.03em}.pq-card>span:last-child{font-size:18px;font-weight:700;color:var(--dim)}
.pq-emo{font-size:40px;display:flex;align-items:center;gap:8px}
.pq-ask{font-size:20px;font-weight:800;margin:0}
.pq-picked{font-size:26px;font-weight:800;margin:0;background:var(--org-w);border:3px solid var(--org);border-radius:18px;padding:12px 18px;animation:gkpulse .8s infinite alternate}
.pq-card b small{font-size:16px;color:var(--dim);font-weight:700}
.pq-btns{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.pq-b{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:200px;border-radius:20px;border:none;background:var(--org);color:#141413;cursor:pointer;box-shadow:0 7px 0 #a84f2e}
.pq-b span{font-size:56px;line-height:1}.pq-b b{font-size:32px;letter-spacing:-.03em}.pq-b small{font-size:17px;font-weight:800;min-height:24px}
.pq-b:active{transform:translateY(5px);box-shadow:0 2px 0 #a84f2e}
.pq-b.on{background:var(--grn-w);box-shadow:none;border:3px solid var(--grn);cursor:default}
.pq-wait{font-size:26px;font-weight:800;text-align:center;background:var(--paper);border:2px dashed var(--mid-d);border-radius:20px;padding:44px 16px;margin:0}
.pq-counts{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.pq-c{display:flex;flex-direction:column;align-items:center;gap:2px;background:var(--org-w);border:2px solid var(--org-l);border-radius:20px;padding:16px}
.pq-c span{font-size:44px;line-height:1}.pq-c b{font-size:64px;letter-spacing:-.04em;line-height:1}.pq-c small{font-size:20px;font-weight:800}
/* 조종기: 투자 */
.pv-inv{display:flex;flex-direction:column;gap:10px;height:100%;max-width:1000px;width:100%;margin:0 auto;justify-content:center}
.pv-ih{display:flex;justify-content:space-between;align-items:center}
.pv-it{font-size:22px;font-weight:800}
.pv-left{font-size:22px;font-weight:800}.pv-left b{font-size:40px;letter-spacing:-.03em}.pv-left small{font-size:16px;color:var(--dim)}
.pv-rows{display:flex;flex-direction:column;gap:8px}
.pv-ir{display:grid;grid-template-columns:1fr 68px 90px 68px;align-items:center;gap:10px;background:var(--card);border:1.5px solid var(--line);border-left:10px solid var(--tf);border-radius:14px;padding:5px 12px}
.pv-in{display:flex;flex-direction:column;min-width:0;line-height:1.25}
.pv-in b{font-size:20px;color:var(--tx)}.pv-in small{font-size:16px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pv-pm{height:50px;border-radius:12px;border:2px solid var(--line);background:var(--card);font-size:32px;font-weight:800;cursor:pointer;line-height:1}
.pv-pm.plus{background:var(--org);border-color:var(--org)}
.pv-pm:disabled{background:var(--paper);border-color:var(--line);color:var(--mid);cursor:default}
.pv-iv{font-size:32px;text-align:center;letter-spacing:-.03em}
.pv-ihint{font-size:16px;color:var(--dim);margin:0}
@media (max-height:700px){.pb-o{min-height:120px}.pb-oe{font-size:40px}.pq-b{min-height:160px}.pv-ir{padding:2px 12px}.pv-pm{height:42px}
  .pv-inv,.pv-rows{gap:6px}.pv-left b{font-size:32px}.pv-in b{font-size:18px}.pv-in small{font-size:14px}}
@container (max-height:340px){.pi-nm.big{font-size:30px}.pi-sen.big{font-size:17px}.pi-big{padding:10px 14px;gap:6px}.pi-qe{font-size:26px}.pi-qt{font-size:17px}.pi-qn{font-size:34px}.pi-qh,.pi-ql{display:none}}
@container (max-height:210px){.pi-money{display:none}}
@container (max-height:160px){.pi-card .pi-sen{display:none}.pi-card .pi-nm{font-size:19px}}
@container (max-height:150px){.pc-bl,.pc-bh,.pc-ar{display:none}.pc-be{font-size:26px}.pi-emo{font-size:26px}}
@container (max-width:340px){.pi-card .pc-bl,.pi-card .pc-bi{display:none}}
.pi-wrap.no-anim .pi-rr,.pi-wrap.no-anim .pi-bar i,.pi-wrap.no-anim .pi-reveal{animation:none!important}
@media (prefers-reduced-motion:reduce){.pi-rr,.pi-bar i,.pi-reveal,.pi-big,.pc-box.on,.pi-w,.pi-bump{animation:none!important}}
`;
