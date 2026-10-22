// 13차시 「효모 풍선 대결」 — 시스템 네 칸(투입 · 과정 · 산출 · 되먹임)
// 팀이 물 온도 · 설탕을 투표로 고르고, 진행판에서 풍선이 30초 동안 부푼다. 3라운드.
import {
  esc, clamp, keyed, text, secsLeft, timerHTML, timerUpdate, tickSound, majority,
  rankPoints, confetti, injectCSS, medal, beep,
} from '../src/gamekit.js';

// ── 내용 (중학교 기술 · 생명 기술 시스템) ───────────────────────────
// 효모는 설탕을 먹고 이산화탄소(+알코올)를 낸다 = 발효. 40℃ 안팎이 가장 활발하고,
// 차가우면 느리고, 너무 뜨거우면(60℃ 이상) 효모가 죽어 멈춘다.
export const TEMPS = [
  { v: 10, label: '차가움', emoji: '🧊', f: 0.15, say: '효모가 추워서 느릿느릿' },
  { v: 25, label: '미지근', emoji: '💧', f: 0.55, say: '효모가 조금씩 일해요' },
  { v: 40, label: '따뜻',   emoji: '♨️', f: 1.0,  say: '효모가 가장 신나게 일해요' },
  { v: 70, label: '뜨거움', emoji: '🔥', f: 0,    say: '너무 뜨거워 효모가 죽었어요' },
];
export const SUGARS = [
  { v: 0, label: '없음', emoji: '⬜', f: 0.1, say: '먹이(설탕)가 없어요' },
  { v: 1, label: '조금', emoji: '🥄', f: 0.6, say: '먹이가 조금 있어요' },
  { v: 2, label: '많이', emoji: '🍚', f: 1.0, say: '먹이가 넉넉해요' },
];
const T = v => TEMPS.find(x => x.v === Number(v)) || TEMPS[1];
const S = v => SUGARS.find(x => x.v === Number(v)) || SUGARS[1];
// 목록에 없는 값(「999℃」 같은 장난 입력)은 표로 세지 않는다
export const okTemp = v => typeof v === 'number' && TEMPS.some(x => x.v === v);
export const okSugar = v => typeof v === 'number' && SUGARS.some(x => x.v === v);

// 발효 중 예측: 「우리 풍선 몇 cm?」 — 정수 cm 가 어느 칸에 드나
export const PRED = [
  { v: 0, lo: 0,  hi: 15,  label: '15cm 미만', emoji: '😶' },
  { v: 1, lo: 15, hi: 25,  label: '15~24cm',  emoji: '🎈' },
  { v: 2, lo: 25, hi: 35,  label: '25~34cm',  emoji: '🎈🎈' },
  { v: 3, lo: 35, hi: 999, label: '35cm 이상', emoji: '🎈🎈🎈' },
];
export const okPred = v => typeof v === 'number' && PRED.some(x => x.v === v);
export const predOf = cm => (PRED.find(x => Math.round(cm) >= x.lo && Math.round(cm) < x.hi) || PRED[0]).v;

const ROUNDS = 3;
const VOTE_MS = [20000, 15000, 15000];
const ALL_IN_MS = 3000;        // 모두 고르면 3초 뒤 마감
const NEAR_MS = 6000;          // 팀마다 한 명씩만 남았으면 6초 뒤 마감(모두 고른 때보다 3초 더)
const PRED_MS = 8000;          // 발효 시작 뒤 8초까지 「우리 풍선 몇 cm?」 예측을 받는다
const FERMENT_MS = 30000;
const REVEAL_DELAY = 1500;     // 조건 공개 뒤 부풀기 시작까지
const BONUS = 2;               // 2 · 3라운드 목표를 딱 맞히면(정수 cm) +2
// 라운드 목표: 1R 가장 크게 · 2R 25cm · 3R 30cm 맞히기 (운이 아니라 조건을 「조절」하게)
// 지금 모형(무작위 빼고): 25℃+많이 ≈ 26.5 · 40℃+조금 ≈ 28 · 25℃+조금 ≈ 20 · 40℃+많이 ≈ 40
//   → 25cm 에는 두 조합(26.5 · 28), 30cm 에도 두 조합(28 · 26.5)이 비슷하게 가깝다
export const TARGETS = [null, 25, 30];
const goalOf = round => TARGETS[round - 1];
const goalText = round => goalOf(round) == null ? '🎈 목표: 가장 크게!' : `🎯 목표: ${goalOf(round)}cm 맞히기`;
const cmInt = cm => Math.round(cm);

/** 풍선 둘레(cm): 10cm(안 부푼 풍선) + 30 × 온도 × 설탕 × (0.92~1.08) */
export function balloonCm(temp, sugar, rnd = Math.random) {
  const a = T(temp).f * S(sugar).f;
  return Math.round((10 + 30 * a * (0.92 + 0.16 * rnd())) * 10) / 10;
}
/** 부푸는 모양: 팀마다 시작이 조금 늦거나 빠르다 → 중간 순위가 뒤집힐 수 있다 */
function shape(p, lag, ex) { return Math.pow(clamp((p - lag) / (1 - lag), 0, 1), ex); }
function cmAt(run, now, startAt) {
  const p = clamp((now - startAt) / FERMENT_MS, 0, 1);
  return 10 + (run.cm - 10) * shape(p, run.lag, run.ex);
}
const fmt = cm => (Math.round(cm * 10) / 10).toFixed(1);

// ── 진행판 쪽 (판정) ──────────────────────────────────────────────
function startVote(s, ctx, round) {
  return { ...s, step: 'vote', round, inputKey: `y${round}`, deadline: ctx.now() + VOTE_MS[round - 1], tally: {}, early: false };
}

function decideAndFerment(s, ctx) {
  const run = {};
  for (const t of ctx.teams) {
    const tl = (s.tally || {})[t.id] || {};
    let temp = tl.temp == null ? null : Number(tl.temp), sugar = tl.sugar == null ? null : Number(tl.sugar), rand = false;
    if (!okTemp(temp)) { temp = TEMPS[Math.floor(ctx.rnd() * TEMPS.length)].v; rand = true; }
    if (!okSugar(sugar)) { sugar = SUGARS[Math.floor(ctx.rnd() * SUGARS.length)].v; rand = true; }
    run[t.id] = {
      temp: Number(temp), sugar: Number(sugar), rand,
      cm: balloonCm(temp, sugar, ctx.rnd),
      lag: Math.round(ctx.rnd() * 25) / 100,          // 0 ~ 0.25
      ex: Math.round((0.8 + ctx.rnd() * 0.8) * 100) / 100, // 0.8 ~ 1.6
    };
  }
  const startAt = ctx.now() + REVEAL_DELAY;
  // 예측에 드는 사람 = 지금 접속한 팀원(대신 누르기는 눌렀을 때만 더한다)
  const predNeed = {};
  for (const t of ctx.teams) predNeed[t.id] = ctx.offline ? [] : t.online.filter(u => !u.startsWith('proxy-'));
  return {
    ...s, step: 'ferment', inputKey: `p${s.round}`, run, startAt, deadline: startAt + FERMENT_MS,
    predFrom: ctx.now(), predUntil: startAt + PRED_MS, predNeed, pred: {}, predDone: {},
  };
}

/** 예측 입력 → { uid: 칸 } (칸을 연 시각보다 0.3초 넘게 앞선 것 · 잠근 뒤 것 · 목록에 없는 값은 버린다) */
function foldPred(s, inputs) {
  const pred = { ...(s.pred || {}) };
  for (const [u, inp] of Object.entries(inputs || {})) {
    if (!inp || !okPred(inp.pred) || typeof inp.t !== 'number') continue;
    if (inp.t < s.predFrom - 300 || inp.t > s.predUntil) continue;
    pred[u] = inp.pred;
  }
  return pred;
}
function predMembers(s, tid, pred) {
  const list = ((s.predNeed || {})[tid] || []).slice();
  const px = 'proxy-' + tid;
  if (pred[px] !== undefined) list.push(px);
  return list;
}

function reveal(s, ctx) {
  const goal = goalOf(s.round);
  const cms = Object.fromEntries(Object.entries(s.run).map(([tid, r]) => [tid, r.cm]));
  // 순위는 정수 cm 로 — 0.1cm 차이로 점수가 갈리지 않게. 목표 라운드는 목표와의 차이가 작을수록
  const val = Object.fromEntries(Object.entries(cms).map(([tid, c]) => [tid, goal == null ? cmInt(c) : -Math.abs(cmInt(c) - goal)]));
  const { points, rank } = rankPoints(val, true);
  const history = { ...(s.history || {}) }, best = { ...(s.best || {}) }, total = { ...(s.total || {}) };
  const predSum = { ...(s.predSum || {}) }, final = {};
  const pred = s.pred || {};
  const bonus = {};
  for (const tid of Object.keys(cms)) {
    const prevBest = best[tid] ?? 0;
    if (goal != null && cmInt(cms[tid]) === goal) bonus[tid] = BONUS;
    // 예측: 맞힌 팀원 비율 × 1점 (0.1 단위)
    const ans = predOf(cms[tid]);
    const mem = predMembers(s, tid, pred);
    const ok = mem.filter(u => pred[u] === ans).length;
    const pp = mem.length ? Math.round(ok / mem.length * 10) / 10 : 0;
    predSum[tid] = Math.round(((predSum[tid] || 0) + pp) * 10) / 10;
    history[tid] = [...(history[tid] || []), { ...s.run[tid], goal, gap: goal == null ? null : Math.abs(cmInt(cms[tid]) - goal), rank: rank[tid], pts: points[tid] + (bonus[tid] || 0),
      pred: { ans, ok, n: mem.length, pts: pp } }];
    best[tid] = Math.max(prevBest, cms[tid]);
    total[tid] = (total[tid] || 0) + points[tid] + (bonus[tid] || 0);
  }
  for (const tid of Object.keys(total)) final[tid] = total[tid] + Math.round(predSum[tid] || 0);
  return { ...s, step: 'reveal', inputKey: null, rank, pts: points, bonus, history, best, total, predSum, final, deadline: null };
}

// 이 반에서 가장 크게 부푼 기록
function bestOverall(s) {
  let b = null;
  for (const [tid, h] of Object.entries(s.history || {})) for (const r of h) if (!b || r.cm > b.cm) b = { ...r, tid };
  return b;
}

const game = {
  id: 'yeast',
  title: '효모 풍선 대결',
  lesson: 13,
  minutes: 6,
  emoji: '🎈',
  blurb: '가장 크게 → 🎯 25cm → 🎯 30cm 맞히기',
  intro: {
    headline: '효모 풍선 대결',
    lines: [
      '병 안에 효모 · 설탕 · 물. 입구에 풍선 🎈',
      '팀이 투표로 <b>물 온도</b>와 <b>설탕</b>을 고른다',
      '1라운드 <b>가장 크게</b> · 2라운드 <b>🎯 25cm</b> · 3라운드 <b>🎯 30cm</b> 맞히기',
    ],
    art: 'yeast',
  },

  setup(ctx) {
    return startVote({ total: {}, history: {}, best: {} }, ctx, 1);
  },

  onInput(s, inputs, ctx) {
    if (s.step === 'ferment') {
      if (!s.inputKey) return s;
      const pred = foldPred(s, inputs);
      const predDone = {};
      for (const tid of Object.keys(s.run || {})) predDone[tid] = predMembers(s, tid, pred).filter(u => pred[u] !== undefined).length;
      return { ...s, pred, predDone };
    }
    if (s.step !== 'vote') return s;
    const tally = {};
    let allIn = true, near = true, anyone = false;
    for (const t of ctx.teams) {
      const votes = t.online.map(u => inputs[u]).filter(Boolean);
      const tv = majority(votes.filter(v => okTemp(v.temp)).map(v => ({ v: v.temp, t: v.t })));
      const sv = majority(votes.filter(v => okSugar(v.sugar)).map(v => ({ v: v.sugar, t: v.t })));
      const done = t.online.filter(u => inputs[u] && okTemp(inputs[u].temp) && okSugar(inputs[u].sugar)).length;
      const need = t.online.length;
      if (need && done < need) allIn = false;
      if (need && done < Math.max(1, need - 1)) near = false;
      if (need) anyone = true;
      tally[t.id] = { temp: tv.winner, sugar: sv.winner, tc: tv.counts, sc: sv.counts, done, need };
    }
    let deadline = s.deadline, early = s.early;
    const left = deadline - ctx.now();
    if (anyone && allIn && left > ALL_IN_MS) { deadline = ctx.now() + ALL_IN_MS; early = true; }
    else if (anyone && near && left > NEAR_MS) { deadline = ctx.now() + NEAR_MS; early = true; }
    return { ...s, tally, deadline, early };
  },

  // 같은 번호가 새 기기로 바뀌면(코어가 부른다) 예측 명단 · 예측을 옮긴다
  remap(s, from, to) {
    if (!s.predNeed) return s;
    const predNeed = {};
    for (const [tid, uids] of Object.entries(s.predNeed)) predNeed[tid] = uids.map(u => (u === from ? to : u));
    const pred = { ...(s.pred || {}) };
    if (pred[from] !== undefined && pred[to] === undefined) pred[to] = pred[from];
    delete pred[from];
    return { ...s, predNeed, pred };
  },

  tick(s, ctx) {
    const now = ctx.now();
    if (s.step === 'vote' && now >= s.deadline) return decideAndFerment(s, ctx);
    if (s.step === 'ferment' && s.inputKey && now >= s.predUntil) {
      return { ...s, pred: foldPred(s, ctx.inputs), inputKey: null };   // 예측 잠금
    }
    if (s.step === 'ferment' && now >= s.deadline) return reveal(s, ctx);
    return s;
  },

  action(s, name, payload, ctx) {
    if (name === 'skip' && s.step === 'vote') return { ...s, deadline: ctx.now() };
    if (name === 'more' && s.step === 'vote') return { ...s, deadline: s.deadline + 10000 };
    if (name === 'next' && s.step === 'reveal') return s.round < ROUNDS ? startVote(s, ctx, s.round + 1) : { ...s, step: 'card', inputKey: null };
    if (name === 'finish' && s.step === 'card') return { ...s, done: true };
    return s;
  },

  proxyButtons(s) {
    if (s.step === 'ferment' && s.inputKey) return PRED.map(x => ({ label: `예측 ${x.label}`, input: { pred: x.v } }));
    if (s.step !== 'vote') return [];
    return [
      ...TEMPS.map(t => ({ label: `${t.emoji}${t.v}℃`, input: { temp: t.v } })),
      ...SUGARS.map(x => ({ label: `설탕 ${x.label}`, input: { sugar: x.v } })),
    ];
  },

  scoring(s, ctx) {
    const b = bestOverall(s);
    const lines = [];
    if (b) {
      const t = ctx.teams.find(x => x.id === b.tid);
      lines.push(`🎈 가장 큰 풍선: ${t ? t.emoji + ' ' + t.name : ''} ${fmt(b.cm)}cm (${T(b.temp).v}℃ · 설탕 ${S(b.sugar).label})`);
    }
    lines.push('효모가 설탕을 먹고 이산화탄소를 냈다 = 발효. 40℃ 안팎이 가장 활발!');
    lines.push('📱 「우리 풍선 몇 cm?」 — 맞힌 팀원 비율만큼 라운드마다 최대 +1점');
    return { points: s.final || s.total || {}, lines };
  },

  record(s) {
    const b = bestOverall(s);
    return b ? { label: '가장 크게 부푼 풍선', value: b.cm, unit: 'cm', team: b.tid } : null;
  },

  // ── 진행판 그리기 ──
  hostView(el, s, ctx) {
    injectCSS('yeast', CSS);
    const now = ctx.now();
    const key = `${s.step}-${s.round}-${ctx.teams.length}`;
    if (s.step === 'vote' || s.step === 'ferment') {
      if (keyed(el, key, hostArena(s, ctx))) {
        if (s.step === 'ferment') beep(523, 160, 'triangle');
      }
      updateArena(el, s, ctx, now);
    } else if (s.step === 'reveal') {
      if (keyed(el, key, hostReveal(s, ctx))) confetti(el, 50);
    } else if (s.step === 'card') {
      keyed(el, key, hostCard(s, ctx));
    }
    el.querySelectorAll('[data-act]').forEach(b => { b.onclick = () => ctx.act(b.dataset.act); });
  },

  // ── 조종기 그리기 ──
  playView(el, s, me, ctx) {
    injectCSS('yeast', CSS);
    const now = ctx.now();
    if (s.step === 'vote') {
      const mine = me.mine || {};
      const key = `pv-${s.round}-${mine.temp}-${mine.sugar}`;
      if (keyed(el, key, playVote(s, me, mine))) {
        el.querySelectorAll('[data-temp]').forEach(b => b.onclick = () => ctx.send({ ...mine, temp: Number(b.dataset.temp) }));
        el.querySelectorAll('[data-sugar]').forEach(b => b.onclick = () => ctx.send({ ...mine, sugar: Number(b.dataset.sugar) }));
      }
      const tl = (s.tally || {})[me.team] || {};
      const left = secsLeft(s.deadline, now);
      text(el, '.yv-left', left);
      el.querySelector('.yv-time')?.classList.toggle('hot', left <= 3);
      text(el, '.yv-team', teamVoteLine(tl));
    } else if (s.step === 'ferment') {
      const r = (s.run || {})[me.team];
      const inPred = ((s.predNeed || {})[me.team] || []).includes(me.uid);
      const open = now < s.predUntil && inPred;          // (학생 쪽 state 에는 inputKey 가 없다 — 코어가 따로 보낸다)
      const myPred = me.mine && okPred(me.mine.pred) ? me.mine.pred : (s.pred || {})[me.uid];
      if (keyed(el, `pf-${s.round}-${open ? 'o' : 'c'}-${myPred ?? 'x'}-${inPred}`, playFerment(s, r, open, inPred, myPred))) {
        el.querySelectorAll('[data-pred]').forEach(b => b.onclick = () => ctx.send({ pred: Number(b.dataset.pred) }));
      }
      if (open) {
        const left = secsLeft(s.predUntil, now);
        text(el, '.yp-left', left);
        el.querySelector('.yv-time')?.classList.toggle('hot', left <= 3);
      }
    } else if (s.step === 'reveal') {
      const h = ((s.history || {})[me.team] || []).slice(-1)[0];
      keyed(el, `pr-${s.round}`, h ? `
        <div class="pv-center">
          <div class="pv-eyebrow">${s.round}라운드 결과</div>
          <div class="pv-huge">${medal(h.rank)}</div>
          <div class="pv-big num">${cmInt(h.cm)}cm${h.goal != null ? ` (목표 ${h.goal} · 차이 ${h.gap})` : ''} · +${h.pts}점</div>
          <p class="pv-sub">${T(h.temp).v}℃ · 설탕 ${S(h.sugar).label} — ${esc(h.temp === 70 ? T(70).say : S(h.sugar).f < 0.5 ? S(h.sugar).say : T(h.temp).say)}</p>
          ${h.pred && h.pred.n ? `<p class="pv-sub">📱 예측 정답 ${PRED[h.pred.ans].label} — 우리 팀 ${h.pred.ok}/${h.pred.n}명 맞힘${h.pred.pts ? ` · +${h.pred.pts}점` : ''}${(s.pred || {})[me.uid] === h.pred.ans ? ' · 나 ✅' : ''}</p>` : ''}
          ${s.round < ROUNDS ? `<p class="pv-q">🔁 다음 목표 ${goalOf(s.round + 1)}cm — 무엇을 바꿀까? 팀과 의논!</p>` : ''}
        </div>` : `<div class="pv-center"><div class="pv-big">결과는 화면에서!</div></div>`);
    } else {
      keyed(el, 'pc', `<div class="pv-center"><div class="pv-eyebrow">정리</div><div class="pv-big">시스템 네 칸 — 화면을 보세요</div>
        <p class="pv-sub">투입 → 과정 → 산출 → 되먹임</p></div>`);
    }
  },
};
export default game;

function playFerment(s, r, open, inPred, myPred) {
  const cond = r ? `<p class="yp-cond">우리 팀 조건: ${T(r.temp).emoji} <b>${r.temp}℃</b> · 설탕 <b>${S(r.sugar).label}</b>${r.rand ? ' (🎲 무작위)' : ''} — ${esc(T(r.temp).say)}</p>` : '';
  if (open) {
    return `
    <div class="yv">
      <div class="yv-head"><span class="pv-eyebrow">${s.round}라운드 · 발효 중</span><span class="yv-time"><b class="yp-left num">--</b>초</span></div>
      ${cond}
      <h2 class="yv-q">📱 우리 풍선 몇 cm 될까? <small class="yp-small">맞힌 사람이 많을수록 팀 +점(최대 1점)</small></h2>
      <div class="yp-row">
        ${PRED.map(x => `<button class="yv-btn yp-btn ${myPred === x.v ? 'on' : ''}" data-pred="${x.v}" aria-pressed="${myPred === x.v}">
          <span class="yv-e">${x.emoji}</span><b>${x.label}</b></button>`).join('')}
      </div>
      <p class="yv-me">${myPred != null ? '✅ 골랐어요! 시간 안에는 바꿀 수 있어요' : '우리 조건과 화면의 풍선을 보고 골라요'}</p>
    </div>`;
  }
  return `
  <div class="pv-center">
    <div class="pv-eyebrow">${s.round}라운드 · 발효 중</div>
    <div class="pv-big">🎈 화면을 보세요!</div>
    ${cond}
    ${myPred != null ? `<p class="pv-sub">📱 내 예측: ${PRED[myPred].emoji} ${PRED[myPred].label} — 맞았을까?</p>` : inPred ? '<p class="pv-sub dim">📱 예측 시간이 끝났어요</p>' : ''}
    <div class="y-bub-row" aria-hidden="true">${'<i></i>'.repeat(8)}</div>
  </div>`;
}

function teamVoteLine(tl) {
  if (!tl || !tl.need) return '';
  const tc = Object.entries(tl.tc || {}).map(([v, n]) => `${T(v).emoji}${v}℃ ${n}`).join(' · ');
  const sc = Object.entries(tl.sc || {}).map(([v, n]) => `설탕${S(v).label} ${n}`).join(' · ');
  return `우리 팀 ${tl.done}/${tl.need}명 고름 — ${tc || '온도 아직'} / ${sc || '설탕 아직'}`;
}

function playVote(s, me, mine) {
  return `
  <div class="yv">
    <div class="yv-head">
      <span class="pv-eyebrow">${s.round}라운드 · 팀 투표</span>
      <span class="yv-time"><b class="yv-left num">--</b>초</span>
    </div>
    <div class="yv-goal">${goalText(s.round)}${goalOf(s.round) != null ? ' <small>너무 커도 안 돼요!</small>' : ''}</div>
    <h2 class="yv-q">물 온도는?</h2>
    <div class="yv-row four">
      ${TEMPS.map(t => `<button class="yv-btn ${Number(mine.temp) === t.v ? 'on' : ''}" data-temp="${t.v}" aria-pressed="${Number(mine.temp) === t.v}">
        <span class="yv-e">${t.emoji}</span><b class="num">${t.v}℃</b><span>${t.label}</span></button>`).join('')}
    </div>
    <h2 class="yv-q">설탕은?</h2>
    <div class="yv-row three">
      ${SUGARS.map(x => `<button class="yv-btn ${mine.sugar != null && Number(mine.sugar) === x.v ? 'on' : ''}" data-sugar="${x.v}" aria-pressed="${mine.sugar != null && Number(mine.sugar) === x.v}">
        <span class="yv-e">${x.emoji}</span><b>${x.label}</b></button>`).join('')}
    </div>
    <p class="yv-team"></p>
    <p class="yv-me">${mine.temp != null && mine.sugar != null ? '✅ 골랐어요! 시간 안에는 바꿀 수 있어요' : '두 가지 다 골라 주세요'}</p>
  </div>`;
}

// ── 진행판: 병 + 풍선 ──
function bottleSVG(t) {
  // viewBox 160 × 330. 풍선 목 = (80, 205). 병(원래 크기의 0.62배) = 205~310
  return `<svg class="yb-svg" viewBox="0 0 160 330" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
    <g class="yb-balloon" style="transform-origin:80px 205px">
      <path d="M73 205 q7 -12 14 0 z" fill="${t.fill}"/>
      <ellipse cx="80" cy="${205 - 34}" rx="30" ry="34" fill="${t.fill}" stroke="#141413" stroke-opacity=".3" stroke-width="1.2"/>
      <ellipse cx="69" cy="${205 - 50}" rx="6" ry="10" fill="#fff" opacity=".4"/>
      <text x="80" y="${205 - 24}" text-anchor="middle" font-size="24">${t.emoji}</text>
    </g>
    <g transform="translate(80 205) scale(.62) translate(-80 -150)">
      <path d="M66 150 h28 v14 q0 8 10 16 q22 18 22 44 v86 q0 10 -10 10 h-72 q-10 0 -10 -10 v-86 q0 -26 22 -44 q10 -8 10 -16 z"
        fill="#ffffff" stroke="#8d8a80" stroke-width="3.5"/>
      <clipPath id="clip-${t.id}"><path d="M40 226 h80 v86 q0 8 -8 8 h-64 q-8 0 -8 -8 z"/></clipPath>
      <g clip-path="url(#clip-${t.id})">
        <rect class="yb-liquid" x="34" y="232" width="92" height="90" fill="#e8eef2"/>
        <g class="yb-bubbles">${[48, 62, 76, 90, 104, 56, 84, 112].map((x, i) => `<circle cx="${x}" cy="312" r="${4 + (i % 3)}" style="animation-delay:${(i * 0.37).toFixed(2)}s"/>`).join('')}</g>
      </g>
      <text class="yb-temp" x="80" y="286" text-anchor="middle" font-size="34" font-weight="800" fill="#141413"></text>
    </g>
  </svg>`;
}

function hostArena(s, ctx) {
  const vote = s.step === 'vote';
  return `
  <div class="y-wrap ${vote ? 'is-vote' : 'is-ferment'}">
    <div class="y-top">
      <div>
        <div class="eyebrow">효모 풍선 대결 · ${s.round}/${ROUNDS}라운드</div>
        <h1 class="y-title">${vote ? `${goalText(s.round)} — 팀이 물 온도와 설탕을 골라요` : (goalOf(s.round) == null ? '발효 중… 효모가 설탕을 먹고 이산화탄소를 낸다!' : `발효 중… 🎯 ${goalOf(s.round)}cm에 가장 가까운 팀이 이긴다!`)}</h1>
      </div>
      <div class="y-goal">${goalOf(s.round) == null ? '🎈 가장 크게' : `🎯 ${goalOf(s.round)}cm`}</div>
      ${timerHTML(vote ? '투표' : '발효')}
    </div>
    <div class="y-arena" style="--n:${ctx.teams.length}">
      ${ctx.teams.map(t => `
      <div class="y-col" data-tid="${t.id}" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}">
        <div class="y-cm num">${vote ? '' : '10.0'}<small>${vote ? '' : 'cm'}</small></div>
        ${bottleSVG(t)}
        <div class="y-name">${t.emoji} ${esc(t.name)}</div>
        <div class="y-cond"></div>
        ${vote ? '' : '<div class="y-pred"></div>'}
      </div>`).join('')}
    </div>
    <div class="y-foot">
      ${vote ? `<button class="btn ghost" data-act="more">+10초</button><button class="btn" data-act="skip">투표 마감 ▶</button>` : ''}
      <span class="gk-hint">${vote ? (s.round > 1 ? '🔁 지난 결과를 보고 조건을 바꿔 보세요 — 이것이 <b>되먹임</b>!' : '조건은 발효가 시작될 때 공개!') : '<span class="y-predinfo"></span>'}</span>
    </div>
  </div>`;
}

function updateArena(el, s, ctx, now) {
  const vote = s.step === 'vote';
  const secs = vote ? secsLeft(s.deadline, now) : (now < s.startAt ? 30 : secsLeft(s.deadline, now));
  timerUpdate(el, secs);
  tickSound(el, secs);
  for (const t of ctx.teams) {
    const col = el.querySelector(`.y-col[data-tid="${t.id}"]`);
    if (!col) continue;
    if (vote) {
      const tl = (s.tally || {})[t.id] || { done: 0, need: t.online.length };
      text(col, '.y-cond', tl.need ? `투표 ${tl.done}/${tl.need}` : '대신 누르기');
      col.classList.toggle('ready', !!tl.need && tl.done >= tl.need);
      text(col, '.yb-temp', '?');
    } else {
      const r = s.run[t.id];
      if (!r) continue;
      const cm = now < s.startAt ? 10 : cmAt(r, now, s.startAt);
      // 10cm → 0.5배 · 42cm → 칸을 가득 채움(위로는 숫자 바로 아래까지, 옆으로는 칸 너비까지)
      const f = clamp((cm - 10) / 32, 0, 1), room = balloonRoom(col);
      const sy = 0.5 + f * (room.sy - 0.5), sx = Math.min(0.5 + f * (room.sx - 0.5), sy * 1.12);
      col.querySelector('.yb-balloon').style.transform = `scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
      col.querySelector('.yb-liquid').setAttribute('fill', liquidColor(r.temp));
      text(col, '.yb-temp', `${r.temp}℃`);
      const cmEl = col.querySelector('.y-cm');
      if (cmEl.firstChild) cmEl.firstChild.nodeValue = fmt(cm);
      text(col, '.y-cond', `${T(r.temp).emoji}${r.temp}℃ · 설탕 ${S(r.sugar).label}${r.rand ? ' 🎲' : ''}`);
      const act = T(r.temp).f * S(r.sugar).f;
      col.style.setProperty('--bub', act > 0.05 ? (2.6 - act * 1.8).toFixed(2) + 's' : '0s');
      col.classList.toggle('dead', r.temp === 70);
      col.classList.toggle('bubbling', act > 0.05 && now >= s.startAt);
      const need = ((s.predNeed || {})[t.id] || []).length, done = (s.predDone || {})[t.id] || 0;
      text(col, '.y-pred', s.inputKey && need ? `📱 예측 ${done}/${need}` : '');
    }
  }
  if (!vote) {
    const info = el.querySelector('.y-predinfo');
    if (info) {
      const all = Object.values(s.predNeed || {}).reduce((a, l) => a + l.length, 0);
      const done = Object.values(s.predDone || {}).reduce((a, n) => a + n, 0);
      const html = s.inputKey
        ? `📱 크롬북에서 「우리 풍선 몇 cm?」 예측 — <b class="num">${secsLeft(s.predUntil, now)}</b>초 남음 · <b class="num">${done}/${all}</b>명`
        : (all ? `📱 예측 잠김 (${done}/${all}명) — 맞혔는지는 결과에서!` : '');
      if (info.innerHTML !== html) info.innerHTML = html;
    }
  }
  // 지금 1등 표시 (발효 중 순위가 뒤집히는 맛)
  if (!vote && now >= s.startAt && goalOf(s.round) == null) {
    let lead = null, leadCm = -1;
    for (const t of ctx.teams) { const r = s.run[t.id]; if (!r) continue; const c = cmAt(r, now, s.startAt); if (c > leadCm) { leadCm = c; lead = t.id; } }
    el.querySelectorAll('.y-col').forEach(c => c.classList.toggle('lead', c.dataset.tid === lead));
  }
}

/** 이 칸에서 풍선이 커질 수 있는 최대 배율(가로 · 세로). 병 목(viewBox 80,205)이 기준 */
function balloonRoom(col) {
  const svg = col.querySelector('.yb-svg');
  const r = svg && svg.getBoundingClientRect();
  if (!r || !r.width || !r.height) return { sx: 2.4, sy: 2.4 };
  const k = Math.min(r.width / 160, r.height / 330);          // viewBox 1 = k px (meet)
  const neck = r.height - (330 - 205) * k;                     // 그림 위쪽에서 병 목까지(px)
  return {
    sy: Math.max(1, (neck / k - 4) / 68),                      // 풍선 높이 68
    sx: Math.max(1, (col.clientWidth - 14) / k / 60),          // 풍선 너비 60
  };
}

function liquidColor(temp) {
  return { 10: '#cfe0f0', 25: '#e3ecf1', 40: '#f6dcc8', 70: '#f2b7a0' }[temp] || '#e8eef2';
}

function hostReveal(s, ctx) {
  const rows = ctx.teams
    .map(t => ({ t, h: (s.history[t.id] || []).slice(-1)[0] }))
    .filter(x => x.h)
    .sort((a, b) => a.h.rank - b.h.rank);
  const max = Math.max(...rows.map(x => x.h.cm), 42);
  const top = rows[0];
  const goal = goalOf(s.round);
  const why = top ? `${T(top.h.temp).v}℃ — ${T(top.h.temp).say} · 설탕 ${S(top.h.sugar).label} — ${S(top.h.sugar).say} → ${cmInt(top.h.cm)}cm` : '';
  return `
  <div class="y-wrap">
    <div class="y-top">
      <div>
        <div class="eyebrow">${s.round}라운드 결과</div>
        <h1 class="y-title">${!top ? '결과' : goal == null ? `${medal(1)} ${top.t.emoji} ${esc(top.t.name)} — ${cmInt(top.h.cm)}cm!` : `🎯 ${goal}cm에 가장 가까운 팀: ${top.t.emoji} ${esc(top.t.name)} — ${cmInt(top.h.cm)}cm`}</h1>
      </div>
    </div>
    <div class="y-rank">
      ${rows.map((x, i) => `
      <div class="y-rrow" style="--tf:${x.t.fill};--tt:${x.t.tint};--tx:${x.t.text};animation-delay:${(i * 0.06).toFixed(2)}s">
        <span class="y-rk">${medal(x.h.rank)}</span>
        <span class="y-rn">${x.t.emoji} ${esc(x.t.name)}</span>
        <span class="y-rc">${T(x.h.temp).emoji}${x.h.temp}℃ · 설탕 ${S(x.h.sugar).label}</span>
        <span class="y-rbar"><i style="width:${Math.max(2, (x.h.cm - 10) / (max - 10) * 100).toFixed(1)}%"></i>${goal != null ? `<em class="y-tgt" style="left:${((goal - 10) / (max - 10) * 100).toFixed(1)}%"></em>` : ''}</span>
        <b class="y-rv num">${cmInt(x.h.cm)}cm${goal != null ? `<small>차이 ${x.h.gap}</small>` : ''}</b>
        <span class="y-rp num">+${x.h.pts}${s.bonus && s.bonus[x.t.id] ? ' <em>딱 맞힘!</em>' : ''}${x.h.pred && x.h.pred.n ? `<small class="y-rpred">📱 ${x.h.pred.ok}/${x.h.pred.n}${x.h.pred.pts ? ` +${x.h.pred.pts}` : ''}</small>` : ''}</span>
      </div>`).join('')}
    </div>
    <div class="gk-note">
      ${goal != null && top ? `<b>💡 왜 가까웠나?</b> ${esc(why)}<br>` : ''}${s.round < ROUNDS
        ? `<b>🔁 되먹임</b> 결과를 보고 다음 목표(${goalOf(s.round + 1)}cm)에 맞게 조건을 바꿔 보세요 — 결과를 보고 투입을 고치는 것이 <b>되먹임</b>이다.`
        : `<b>💡 정리</b> 40℃ 안팎에서 효모가 가장 활발하고, 설탕(먹이)이 많을수록 이산화탄소가 많이 나온다. 70℃에서는 효모가 죽는다.`}
    </div>
    <div class="y-foot">
      <button class="btn" data-act="next">${s.round < ROUNDS ? `${s.round + 1}라운드 시작 ▶` : '시스템 네 칸 정리 ▶'}</button>
      <span class="gk-hint">${goal != null ? `정수 cm 로 순위 · 목표를 딱 맞히면 +${BONUS}점 · 세로선 = 목표 · ` : ''}📱 = 예측 맞힌 팀원(비율만큼 최대 +1점)</span>
    </div>
  </div>`;
}

function hostCard(s, ctx) {
  const b = bestOverall(s);
  const bt = b && ctx.teams.find(t => t.id === b.tid);
  const boxes = [
    ['투입', '🥣', '효모 · 설탕 · 물 · 온도', '🦠🍚💧🌡', b ? `우리 반 최고: ${b.temp}℃ · 설탕 ${S(b.sugar).label}` : ''],
    ['과정', '⚙️', '효모가 설탕을 먹고 이산화탄소를 낸다 = <b>발효</b>', '🦠➜💨', '살아 있는 생물이 일한다'],
    ['산출', '🎈', '이산화탄소 · 알코올 → 풍선과 빵이 부푼다', '🎈🍞', b ? `가장 큰 풍선 ${fmt(b.cm)}cm ${bt ? bt.emoji : ''}` : ''],
    ['되먹임', '🔁', '풍선을 보고 다음 조건을 바꾼다', '👀➜🔧', '결과 → 다시 투입으로'],
  ];
  return `
  <div class="y-wrap">
    <div class="y-top"><div><div class="eyebrow">정리 · 생명 기술 시스템</div>
      <h1 class="y-title">효모 풍선 = 살아 있는 생물이 일하는 시스템</h1></div></div>
    <div class="y-card4">
      ${boxes.map(([h, e, main, art, sub], i) => `
      <div class="y-box" style="animation-delay:${(0.15 + i * 0.6).toFixed(2)}s">
        <div class="y-bh"><span class="y-be">${e}</span>${h}</div>
        <p class="y-bm">${main}</p>
        <div class="y-bi" aria-hidden="true">${art}</div>
        ${sub ? `<p class="y-bs">${esc(sub)}</p>` : ''}
      </div>${i < 3 ? `<div class="y-arrow" style="animation-delay:${(0.45 + i * 0.6).toFixed(2)}s">→</div>` : ''}`).join('')}
    </div>
    <p class="gk-note">정보 기술에서는 컴퓨터가 처리했다면, 생명 기술에서는 <b>살아 있는 생물(효모)</b>이 일한다.</p>
    <div class="y-foot"><button class="btn" data-act="finish">결과 보기 ▶</button></div>
  </div>`;
}

const CSS = `
.y-wrap{display:flex;flex-direction:column;height:100%;gap:12px}
.y-top{display:flex;align-items:flex-end;justify-content:space-between;gap:24px}
.y-title{font-size:32px;font-weight:800;letter-spacing:-.025em;line-height:1.25;margin:6px 0 0}
.y-arena{flex:1;display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));grid-template-rows:minmax(0,1fr);gap:10px;min-height:0}
.y-col{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;
  background:var(--card);border:1.5px solid var(--line);border-top:8px solid var(--tf);border-radius:14px;padding:8px 6px 10px;min-width:0}
.y-col.ready{background:var(--tt)}
.y-col.lead{box-shadow:0 0 0 3px var(--tf)}
.y-col.lead::after{content:'👑 1등';position:absolute;top:-15px;left:50%;transform:translateX(-50%);white-space:nowrap;z-index:2;font-size:17px;line-height:24px;font-weight:800;background:var(--tf);color:#141413;border-radius:99px;padding:0 8px}
.is-ferment .y-col{padding-top:14px}
.y-pred{font-size:17px;font-weight:800;color:#3d6f9e;min-height:22px;line-height:1.3}
.y-cm{font-size:34px;font-weight:800;letter-spacing:-.04em;line-height:1;min-height:36px}
.y-cm small{font-size:16px;margin-left:2px;color:var(--dim)}
.yb-svg{flex:1 1 0;min-height:0;width:100%;display:block;overflow:visible}
.yb-balloon{transform:scale(.5);transition:transform .25s linear;transform-box:view-box}
.yb-bubbles circle{fill:#fff;opacity:0}
.y-col.bubbling .yb-bubbles circle{animation:ybub var(--bub,2s) linear infinite}
@keyframes ybub{0%{transform:translateY(0);opacity:0}15%{opacity:.9}100%{transform:translateY(-80px);opacity:0}}
.y-col.dead .yb-balloon{filter:grayscale(.7)}
.y-col.dead .y-cond::after{content:' 💀';}
.y-name{font-size:19px;font-weight:800;letter-spacing:-.02em;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.y-cond{font-size:22px;font-weight:700;color:var(--ink);min-height:28px;line-height:1.25;text-align:center;letter-spacing:-.02em}
.y-foot{display:flex;align-items:center;gap:12px;min-height:48px}
.y-rank{display:flex;flex-direction:column;gap:6px;flex:1;min-height:0;justify-content:center;overflow:hidden}
.y-rrow{flex:1 1 0;min-height:0;max-height:64px;display:grid;grid-template-columns:64px 170px 236px 1fr 160px 178px;align-items:center;gap:12px;
  background:var(--card);border:1.5px solid var(--line);border-left:10px solid var(--tf);border-radius:12px;padding:0 14px;overflow:hidden;
  animation:gk-in .35s cubic-bezier(.2,.75,.3,1) both}
.y-rk{font-size:30px;text-align:center}
.y-rn{font-size:21px;font-weight:800;color:var(--tx)}
.y-rc{font-size:22px;font-weight:700;letter-spacing:-.02em;white-space:nowrap}
.y-rbar{position:relative;height:22px;background:var(--line);border-radius:6px;overflow:hidden}
.y-tgt{position:absolute;top:-2px;bottom:-2px;width:4px;background:#141413;transform:translateX(-50%)}
.y-rv small{font-size:15px;color:var(--dim);margin-left:6px;font-weight:700}
.y-goal{font-size:40px;font-weight:800;letter-spacing:-.03em;background:var(--org-w);border:2px solid var(--org);border-radius:14px;padding:4px 18px;margin-left:auto;white-space:nowrap}
.yv-goal{font-size:30px;font-weight:800;letter-spacing:-.025em;background:var(--org-w);border:2px solid var(--org);border-radius:14px;padding:6px 16px}
.yv-goal small{font-size:17px;color:var(--org-t)}
.y-rbar i{display:block;height:100%;background:var(--tf);border-radius:6px}
.y-rv{font-size:26px;font-weight:800;text-align:right}
.y-rp{font-size:20px;font-weight:800;color:var(--grn-t)}
.y-rp em{font-style:normal;font-size:14px;background:var(--grn-w);border:1px solid var(--grn-l);border-radius:99px;padding:2px 8px}
.y-rpred{display:block;font-size:15px;color:var(--ink);font-weight:700;white-space:nowrap}
.y-card4{flex:1;display:grid;grid-template-columns:1fr 36px 1fr 36px 1fr 36px 1fr;align-items:stretch;gap:6px;min-height:0}
.y-box{display:flex;flex-direction:column;background:var(--card);border:1.5px solid var(--line);border-top:8px solid var(--org);border-radius:14px;padding:18px;
  animation:gk-pop .45s cubic-bezier(.2,.75,.3,1) both}
.y-box:nth-child(3){border-top-color:var(--grn)}.y-box:nth-child(5){border-top-color:var(--blu)}.y-box:nth-child(7){border-top-color:var(--mid-d)}
.y-bh{font-size:32px;font-weight:800;letter-spacing:-.025em;display:flex;align-items:center;gap:8px}
.y-be{font-size:40px}
.y-bi{font-size:84px;line-height:1;text-align:center;margin:auto 0 8px}
.y-bm{font-size:24px;line-height:1.5;margin:14px 0 8px;font-weight:700;letter-spacing:-.015em}
.y-bs{font-size:18px;color:var(--dim);margin:0 0 auto}
.y-arrow{align-self:center;font-size:34px;font-weight:800;color:var(--mid-d);text-align:center;animation:gk-pop .3s both}
/* 조종기 */
.yv{display:flex;flex-direction:column;gap:10px;height:100%}
.yv-head{display:flex;justify-content:space-between;align-items:center}
.yv-time{font-size:22px;font-weight:800}
.yv-time.hot{color:#b3261e;animation:gkpulse .5s infinite alternate}
.yv-q{font-size:26px;font-weight:800;letter-spacing:-.025em;margin:4px 0 0}
.yv-row{display:grid;gap:12px}
.yv-row.four{grid-template-columns:repeat(4,1fr)}
.yv-row.three{grid-template-columns:repeat(3,1fr)}
.yv-btn{display:flex;flex-direction:column;align-items:center;gap:2px;padding:14px 8px;border-radius:14px;background:var(--card);
  border:2.5px solid var(--line);font-size:18px;color:var(--ink);cursor:pointer;min-height:150px;justify-content:center}
.yv-btn b{font-size:26px;letter-spacing:-.03em}
.yv-btn .yv-e{font-size:34px;line-height:1}
.yv-btn:hover{border-color:var(--mid-d)}
.yv-btn.on{border-color:var(--org);background:var(--org-w);box-shadow:0 0 0 2px var(--org);position:relative}
.yv-btn.on::after{content:'✓';position:absolute;top:6px;right:8px;width:24px;height:24px;border-radius:50%;background:var(--org);color:#141413;font-weight:800;font-size:15px;display:grid;place-items:center}
.yv-team{font-size:16px;color:var(--dim);margin:4px 0 0;min-height:24px}
.yv-me{font-size:18px;font-weight:700;margin:0}
.y-bub-row{display:flex;gap:10px;justify-content:center;margin-top:16px}
.yp-cond{font-size:19px;margin:0;line-height:1.4}
.yp-small{font-size:16px;font-weight:700;color:var(--dim);margin-left:6px}
.yp-row{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;flex:1;min-height:0}
.yp-btn{min-height:0}
.yp-btn b{font-size:28px}
.y-bub-row i{width:14px;height:14px;border-radius:50%;background:var(--blu);animation:ybub2 1.6s ease-in infinite}
.y-bub-row i:nth-child(odd){animation-delay:.5s}.y-bub-row i:nth-child(3n){animation-delay:.9s}
@keyframes ybub2{0%{transform:translateY(20px);opacity:0}30%{opacity:1}100%{transform:translateY(-40px);opacity:0}}
@media (prefers-reduced-motion:reduce){.y-col.bubbling .yb-bubbles circle,.y-bub-row i,.y-rrow,.y-box,.y-arrow{animation:none!important;opacity:1}}
`;
