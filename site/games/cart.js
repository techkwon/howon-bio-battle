// 15차시 「장바구니 탐정」 — 식품 표시 · 영양 식생활
// 진행판에 가상 식품 포장 카드가 한 장씩. 조종기: 「이 식품에 들어간 생명 기술은?」 4지선다, 10초.
// 처음 고른 답만 센다. 카드 점수 = 100 × Σ(맞힌 팀원의 빠르기 0.5~1) ÷ 팀원 수. 모든 카드 합으로 순위.
import {
  esc, clamp, shuffle, keyed, text, secsLeft, timerHTML, timerUpdate, tickSound,
  rankPoints, confetti, injectCSS, medal, beep,
} from '../src/gamekit.js';
import { TECH, CARDS, PLAY_COUNT, ASK_SECONDS, REVEAL_SECONDS } from './cart-data.js';

const READY_MS = 2500;          // 카드가 뜬 뒤 보기 단추가 열리기까지 (단서를 읽는 시간)
const GRACE_MS = 400;           // 마감 뒤 늦게 도착한 입력을 기다리는 시간(입력 시각 t 는 마감 전이어야 한다)
const SYM = ['●', '▲', '■', '◆'];
const LET = ['가', '나', '다', '라'];
const POINT_SCALE = 3;          // 순위 점수 × 3 (1위 30 · 2위 24 · 3위 18 …)

/** 한 판 카드 순서: 기술마다 한 장씩 먼저, 나머지는 무작위 */
export function pickOrder(rnd = Math.random, count = PLAY_COUNT) {
  const byTech = {};
  CARDS.forEach((c, i) => { (byTech[c.answer] = byTech[c.answer] || []).push(i); });
  const first = Object.values(byTech).map(list => shuffle(list, rnd)[0]);
  const rest = shuffle(CARDS.map((_, i) => i).filter(i => !first.includes(i)), rnd);
  const chosen = [...first, ...rest].slice(0, Math.min(count, CARDS.length));
  return shuffle(chosen, rnd);
}

/** 빠르기 0.5(마감 직전) ~ 1(바로) */
export function speedOf(t, startAt, deadline) {
  return 0.5 + 0.5 * clamp((deadline - t) / Math.max(1, deadline - startAt), 0, 1);
}

function startCard(s, ctx, idx) {
  const ci = s.order[idx - 1];
  // 기다릴 사람 = 지금 접속한 팀원. 대신 누르기(proxy-팀)는 비상 모드에서만 미리 넣고,
  // 접속 중에 교사가 「대신 누르기」를 켠 팀은 실제로 누른 경우에만 한 사람으로 센다(members)
  const need = {};
  for (const t of ctx.teams) need[t.id] = ctx.offline ? t.online.slice() : t.online.filter(u => !u.startsWith('proxy-'));
  const startAt = ctx.now() + READY_MS;
  return {
    ...s, step: 'ask', idx, ci, choices: shuffle(CARDS[ci].choices, ctx.rnd),
    inputKey: `c${idx}`, startAt, deadline: startAt + ASK_SECONDS * 1000,
    need, first: {}, prog: {}, endAt: null, res: null, autoAt: null, paused: false,
  };
}

// 처음 고른 답만 (다시 보내도 안 바뀐다). 보기 안의 값 · 열린 뒤 · 마감 전만
function foldFirst(s, inputs) {
  const first = { ...(s.first || {}) };
  for (const [u, inp] of Object.entries(inputs || {})) {
    if (!inp || first[u] !== undefined || typeof inp.t !== 'number') continue;
    if (!s.choices.includes(inp.c)) continue;
    if (inp.t < s.startAt - 200 || inp.t > s.deadline) continue;
    first[u] = { c: inp.c, t: Math.max(inp.t, s.startAt) };
  }
  return first;
}

function members(s, tid, ctx, first) {
  const px = 'proxy-' + tid;
  if (ctx.offline) return [px];
  const list = (s.need[tid] || []).slice();
  if (first[px] !== undefined && !list.includes(px)) list.push(px);
  return list;
}

function reveal(s, ctx, inputs) {
  const first = foldFirst(s, inputs);
  const card = CARDS[s.ci];
  const counts = Object.fromEntries(s.choices.map(c => [c, 0]));
  for (const f of Object.values(first)) if (counts[f.c] !== undefined) counts[f.c]++;
  const pts = {}, right = {}, size = {};
  const total = { ...(s.total || {}) }, rightAll = { ...(s.rightAll || {}) };
  for (const tid of Object.keys(s.need)) {
    const uids = members(s, tid, ctx, first);
    let sum = 0, r = 0;
    for (const u of uids) {
      const f = first[u];
      if (f && f.c === card.answer) { r++; sum += speedOf(f.t, s.startAt, s.deadline); }
    }
    pts[tid] = uids.length ? Math.round(100 * sum / uids.length) : 0;
    right[tid] = r; size[tid] = uids.length;
    total[tid] = (total[tid] || 0) + pts[tid];
    rightAll[tid] = (rightAll[tid] || 0) + r;
  }
  const answered = Object.keys(first).length;
  const ok = Object.values(first).filter(f => f.c === card.answer).length;
  const hist = [...(s.hist || []), { ci: s.ci, ok, n: answered }];
  return {
    ...s, step: 'reveal', inputKey: null, first, total, rightAll, hist,
    res: { ans: card.answer, counts, pts, right, size, ok, n: answered },
    autoAt: ctx.now() + REVEAL_SECONDS * 1000, paused: false,
  };
}

function goNext(s, ctx) {
  if (s.idx < s.order.length) return startCard(s, ctx, s.idx + 1);
  return toFinal(s);
}
function toFinal(s) {
  const { points, rank } = rankPoints(s.total || {}, true);
  return { ...s, step: 'final', inputKey: null, rank, rpts: Object.fromEntries(Object.entries(points).map(([k, v]) => [k, v * POINT_SCALE])), autoAt: null };
}

// 반 전체에서 가장 많이 틀린 카드
function hardest(s) {
  let h = null;
  for (const x of s.hist || []) {
    if (!x.n) continue;
    const r = x.ok / x.n;
    if (!h || r < h.r) h = { ...x, r };
  }
  return h;
}

const game = {
  id: 'cart',
  title: '장바구니 탐정',
  lesson: 15,
  minutes: 4,
  emoji: '🛒',
  blurb: '포장지 표시를 읽고 숨은 생명 기술 찾기',
  intro: {
    headline: '장바구니 탐정',
    lines: [
      '가상 식품 포장 카드가 한 장씩 나온다 🛒 — 정답이 그대로 적혀 있지 않다!',
      '<b>원재료명 · 만드는 법 · 표시</b>에서 단서를 찾아 「들어간 생명 기술」을 추리 🔎 (앞면 광고 문구는 함정일 수도)',
      '<b>처음 고른 답만</b> 센다! 빨리 맞힐수록 팀 점수가 커진다 (12초)',
    ],
    art: `<div class="art-row"><span>🔎</span><span class="plus">+</span><span>🛒</span></div>
      <div class="art-cap" style="background:#fff;border:2px dashed #a84f2e;border-radius:10px;padding:6px 14px;color:#a84f2e">원재료명: 밀가루, 우유, 설탕, 이스트 …</div>
      <div class="art-row" style="font-size:44px"><span>🧬</span><span>🦠</span><span>🌾</span><span>📡</span></div>
      <div class="art-cap">이 식품에 들어간 생명 기술은?</div>`,
  },

  setup(ctx) {
    const s = { order: pickOrder(ctx.rnd), total: {}, rightAll: {}, hist: [] };
    return startCard(s, ctx, 1);
  },

  onInput(s, inputs, ctx) {
    if (s.step !== 'ask') return s;
    const first = foldFirst(s, inputs);
    const prog = {};
    let all = true, anyNeed = false;
    for (const tid of Object.keys(s.need)) {
      const uids = members(s, tid, ctx, first);
      prog[tid] = uids.filter(u => first[u] !== undefined).length;
      if (uids.length) anyNeed = true;
      if (prog[tid] < uids.length) all = false;
    }
    let endAt = s.endAt;
    if (anyNeed && all && !endAt) endAt = ctx.now() + 900;
    return { ...s, first, prog, endAt };
  },

  remap(s, from, to) {
    const need = {};
    for (const [tid, uids] of Object.entries(s.need || {})) need[tid] = uids.map(u => (u === from ? to : u));
    const first = { ...(s.first || {}) };
    if (first[from] !== undefined && first[to] === undefined) first[to] = first[from];
    delete first[from];
    return { ...s, need, first };
  },

  tick(s, ctx) {
    const now = ctx.now();
    if (s.step === 'ask') {
      if ((s.endAt && now >= s.endAt) || now >= s.deadline + GRACE_MS) return reveal(s, ctx, ctx.inputs);
      return s;
    }
    if (s.step === 'reveal' && !s.paused && s.autoAt && now >= s.autoAt) return goNext(s, ctx);
    return s;
  },

  action(s, name, payload, ctx) {
    if (name === 'stop' && s.step === 'ask') return reveal(s, ctx, ctx.inputs);
    if (name === 'pause' && s.step === 'reveal') return s.paused ? { ...s, paused: false, autoAt: ctx.now() + REVEAL_SECONDS * 1000 } : { ...s, paused: true, autoAt: null };
    if (name === 'next' && s.step === 'reveal') return goNext(s, ctx);
    if (name === 'final' && s.step === 'reveal') return toFinal(s);
    if (name === 'finish' && s.step === 'final') return { ...s, done: true };
    return s;
  },

  proxyButtons(s) {
    if (s.step !== 'ask') return [];
    return s.choices.map((c, i) => ({ label: `${SYM[i]} ${TECH[c].label}`, input: { c }, once: true }));
  },

  scoring(s, ctx) {
    const lines = [];
    const rk = s.rank || {};
    const top = ctx.teams.filter(t => rk[t.id] === 1);
    if (top.length) lines.push(`🛒 최고 탐정: ${top.map(t => `${t.emoji} ${esc(t.name)}`).join(' · ')} (${s.total[top[0].id]}점)`);
    const h = hardest(s);
    if (h) { const c = CARDS[h.ci]; lines.push(`가장 헷갈린 카드: ${c.art} ${esc(c.name)} → <b>${esc(TECH[c.answer].label)}</b> (맞힌 사람 ${h.ok}/${h.n})`); }
    lines.push('포장지의 <b>표시</b>를 읽으면 식품 속 생명 기술이 보인다 — 알아야 고를 수 있다');
    return { points: s.rpts || {}, lines };
  },

  record(s) {
    let b = null;
    for (const [tid, v] of Object.entries(s.total || {})) if (!b || v > b.value) b = { value: v, team: tid };
    return b ? { label: `장바구니 탐정 팀 점수(${s.order.length}장)`, value: b.value, unit: '점', team: b.team } : null;
  },

  // ── 진행판 ──
  hostView(el, s, ctx) {
    injectCSS('cart', CSS);
    const now = ctx.now();
    if (s.step === 'ask' || s.step === 'reveal') {
      const fresh = keyed(el, `c-${s.idx}-${s.step}-${ctx.teams.length}`, hostCard(s, ctx));
      if (fresh && s.step === 'reveal') { beep(s.res.ok > s.res.n / 2 ? 880 : 520, 220, 'triangle'); }
      if (fresh && s.step === 'ask') beep(660, 90, 'sine', 0.08);
      if (s.step === 'ask') updateAsk(el, s, ctx, now);
      else updateReveal(el, s, now);
      fitPack(el);
    } else if (s.step === 'final') {
      if (keyed(el, 'final', hostFinal(s, ctx))) confetti(el, 60);
    }
    el.querySelectorAll('[data-act]').forEach(b => { b.onclick = () => ctx.act(b.dataset.act); });
  },

  // ── 조종기 ──
  playView(el, s, me, ctx) {
    injectCSS('cart', CSS);
    const now = ctx.now();
    const card = CARDS[s.ci];
    if (s.step === 'ask') {
      const ready = now >= s.startAt;
      const got = (s.first && s.first[me.uid]) ? s.first[me.uid].c : (me.mine && me.mine.c) || null;
      const inNeed = (s.need[me.team] || []).includes(me.uid);
      if (keyed(el, `pa-${s.idx}-${ready ? 1 : 0}-${got || ''}-${inNeed}`, playAsk(s, card, ready, got, inNeed))) {
        el.querySelectorAll('[data-c]').forEach(b => {
          b.onclick = () => {
            el.querySelectorAll('[data-c]').forEach(x => { x.disabled = true; });
            b.classList.add('on');
            ctx.send({ c: b.dataset.c });
          };
        });
      }
      const left = ready ? secsLeft(s.deadline, now) : ASK_SECONDS;
      text(el, '.cq-left', left);
      el.querySelector('.cq-time')?.classList.toggle('hot', ready && left <= 3);
    } else if (s.step === 'reveal') {
      keyed(el, `pr-${s.idx}`, playReveal(s, card, me));
    } else if (s.step === 'final') {
      const r = (s.rank || {})[me.team];
      keyed(el, 'pf', `<div class="pv-center">
        <div class="pv-eyebrow">장바구니 탐정 끝!</div>
        <div class="pv-huge">${r ? medal(r) : '🛒'}</div>
        <div class="pv-big num">우리 팀 ${(s.total || {})[me.team] || 0}점 · 맞힌 답 ${(s.rightAll || {})[me.team] || 0}개</div>
        <p class="pv-sub">표시를 읽으면 생명 기술이 보여요 — 화면을 보세요</p></div>`);
    }
  },
};
export default game;

// ── 포장 카드 그림 (인라인 HTML/CSS · 외부 이미지 없음) ──
function zigzag(n = 14, d = 3.2) {
  const top = [], bot = [];
  for (let i = 0; i <= n; i++) {
    const x = (i / n * 100).toFixed(2);
    top.push(`${x}% ${i % 2 ? d : 0}%`);
    bot.unshift(`${x}% ${i % 2 ? 100 - d : 100}%`);
  }
  return `polygon(${[...top, ...bot].join(',')})`;
}

/** 뒷면 표시 줄: [단서 키, 이름, 내용] — 식품유형 · 원재료명 · 그 밖의 줄(만드는 법 · 재배 · 표시 …) */
export function labelRows(card) {
  return [['type', '식품유형', card.type], ['ing', '원재료명', card.ing], ...(card.rows || []).map(([l, v], i) => ['r' + i, l, v])];
}
const clueRow = card => labelRows(card).find(r => r[0] === card.clue);

export function packHTML(card, { clue = false, mini = false } = {}) {
  const k = card.kind;
  const extra = k === 'bottle' ? '<div class="cp-neck"></div>' : k === 'jar' ? '<div class="cp-lid"></div>' : k === 'carton' ? '<div class="cp-gable"></div>' : '';
  return `
  <div class="cp-pack k-${k} t-${card.tone} ${mini ? 'mini' : ''}">
    ${extra}
    <div class="cp-body" ${k === 'bag' ? `style="clip-path:${zigzag()}"` : ''}>
      <span class="cp-virtual">가상 상품</span>
      <div class="cp-front"><span class="cp-art" aria-hidden="true">${card.art}</span><span class="cp-fn"><span class="cp-name">${esc(card.name)}</span>
        ${(card.marks || []).map(m => `<span class="cp-stk">${esc(m)}</span>`).join('')}</span></div>
      <div class="cp-label">
        ${labelRows(card).map(([k, l, v]) => `<div class="cp-row ${clue && card.clue === k ? 'clue' : ''}"><b>${esc(l)}</b><span>${esc(v)}</span></div>`).join('')}
      </div>
    </div>
  </div>`;
}

function hostCard(s, ctx) {
  const card = CARDS[s.ci];
  const rev = s.step === 'reveal';
  const res = s.res || {};
  const maxC = Math.max(1, ...Object.values(res.counts || {}));
  return `
  <div class="c-wrap ${rev ? 'rev' : ''} ${ctx.offline && !rev ? 'offask' : ''}">
    <div class="c-top">
      <div>
        <div class="eyebrow">장바구니 탐정 · 카드 ${s.idx}/${s.order.length}</div>
        <h1 class="c-title">${rev ? `정답: ${TECH[res.ans].emoji} ${esc(TECH[res.ans].label)}` : '이 식품에 들어간 생명 기술은?'}</h1>
      </div>
      ${rev ? `<div class="c-okrate"><b class="num">${res.ok}</b><span>/${res.n}명 맞힘</span></div>` : timerHTML('남은 시간')}
    </div>
    <div class="c-main">
      <div class="c-packbox">${packHTML(card, { clue: rev })}</div>
      <div class="c-opts">
        ${s.choices.map((c, i) => {
          const isAns = rev && c === res.ans;
          const n = rev ? (res.counts[c] || 0) : 0;
          return `<div class="c-opt ${isAns ? 'ans' : ''} ${rev && !isAns ? 'no' : ''}">
            <span class="c-sym" aria-hidden="true">${SYM[i]}</span>
            <span class="c-let">${LET[i]}</span>
            <span class="c-oe" aria-hidden="true">${TECH[c].emoji}</span>
            <span class="c-ol">${esc(TECH[c].label)}</span>
            ${rev ? `<span class="c-cnt num">${isAns ? '✓ ' : ''}${n}명</span><i class="c-bar" style="width:${(n / maxC * 100).toFixed(0)}%"></i>` : ''}
          </div>`;
        }).join('')}
        ${rev ? `<p class="c-why">💡 ${esc(card.why)}</p>` : '<div class="c-ready" aria-hidden="true"></div>'}
      </div>
    </div>
    <div class="c-teams" style="--n:${ctx.teams.length}">
      ${ctx.teams.map(t => `
      <div class="c-team" data-tid="${t.id}" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}">
        <div class="c-tn">${t.emoji} ${esc(t.name)}</div>
        ${rev
          ? `<div class="c-tr"><b class="num">+${res.pts[t.id] ?? 0}</b><span>맞힘 ${res.right[t.id] ?? 0}/${res.size[t.id] ?? 0}</span></div>`
          : `<div class="c-dots">${(ctx.offline ? ['p'] : (s.need[t.id] || [])).map(() => '<i></i>').join('') || '<span class="dim">—</span>'}</div>`}
      </div>`).join('')}
    </div>
    <div class="c-foot">
      ${rev
        ? `<button class="btn" data-act="next">${s.idx < s.order.length ? '다음 카드 ▶' : '최종 결과 ▶'}</button>
           <button class="btn ghost c-pause" data-act="pause">⏸ 멈춤</button>
           ${s.idx < s.order.length ? '<button class="btn ghost" data-act="final">여기까지 · 결과 ▶</button>' : ''}
           <span class="gk-hint c-auto"></span>`
        : `<button class="btn ghost" data-act="stop">바로 정답 보기</button>
           <span class="gk-hint">한 사람에 한 번 · 고른 사람은 ● 로 바뀐다</span>`}
    </div>
  </div>`;
}

// 포장 그림이 칸보다 크면(대신 누르기 칸이 열려 판이 낮아졌을 때 등) 통째로 줄인다.
// transform 은 들어오는 애니메이션이 쓰므로 따로 도는 scale 속성을 쓴다
function fitPack(el) {
  const box = el.querySelector('.c-packbox');
  const p = box && box.querySelector('.cp-pack');
  if (!p || !p.offsetHeight) return;
  const k = Math.min(1, (box.clientHeight - 8) / p.offsetHeight, box.clientWidth / p.offsetWidth);
  const v = k < 0.995 ? Math.max(0.45, k).toFixed(3) : '';
  if (p.style.scale !== v) p.style.scale = v;
}

function updateAsk(el, s, ctx, now) {
  const ready = now >= s.startAt;
  const rb = el.querySelector('.c-ready');
  if (rb) { rb.style.display = ready ? 'none' : ''; text(el, '.c-ready', '읽어 보세요…'); }
  const left = ready ? secsLeft(s.deadline, now) : ASK_SECONDS;
  timerUpdate(el, left);
  if (ready) tickSound(el, left);
  for (const t of ctx.teams) {
    const n = (s.prog || {})[t.id] || 0;
    el.querySelectorAll(`.c-team[data-tid="${t.id}"] .c-dots i`).forEach((d, i) => d.classList.toggle('on', i < n));
  }
}

function updateReveal(el, s, now) {
  text(el, '.c-pause', s.paused ? '▶ 계속' : '⏸ 멈춤');
  text(el, '.c-auto', s.paused ? '멈춤 — 설명이 끝나면 「다음」' : `${secsLeft(s.autoAt, now)}초 뒤 저절로 다음`);
}

function hostFinal(s, ctx) {
  const rows = ctx.teams.filter(t => s.total[t.id] !== undefined).sort((a, b) => s.rank[a.id] - s.rank[b.id]);
  const max = Math.max(1, ...rows.map(t => s.total[t.id]));
  const h = hardest(s);
  return `
  <div class="c-wrap">
    <div class="c-top"><div>
      <div class="eyebrow">장바구니 탐정 · 최종</div>
      <h1 class="c-title">${rows[0] ? `${medal(1)} 최고 탐정 ${rows[0].emoji} ${esc(rows[0].name)}` : '결과'}</h1>
    </div></div>
    <div class="c-final">
      <div class="c-rank">
        ${rows.map((t, i) => `
        <div class="c-rrow" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text};animation-delay:${(i * 0.07).toFixed(2)}s">
          <span class="c-rk">${medal(s.rank[t.id])}</span>
          <span class="c-rn">${t.emoji} ${esc(t.name)}</span>
          <span class="c-rbar"><i style="width:${(s.total[t.id] / max * 100).toFixed(1)}%"></i></span>
          <b class="c-rv num">${s.total[t.id]}점</b>
          <span class="c-rp num">+${s.rpts[t.id]}</span>
        </div>`).join('')}
      </div>
      <div class="c-sum">
        <div class="c-sumh">오늘 찾은 생명 기술</div>
        <div class="c-techs">${Object.entries(TECH).map(([, t]) => `<div class="c-tech"><span>${t.emoji}</span><b>${esc(t.label)}</b><small>${esc(t.what)}</small></div>`).join('')}</div>
        ${h ? `<p class="c-hard">😵 가장 헷갈린 카드: ${CARDS[h.ci].art} ${esc(CARDS[h.ci].name)} → <b>${esc(TECH[CARDS[h.ci].answer].label)}</b> (${h.ok}/${h.n}명)</p>` : ''}
      </div>
    </div>
    <p class="gk-note">🔎 포장지의 <b>표시</b>를 읽으면 그 식품을 만든 생명 기술이 보인다 — 알아야 우리 가족 식탁을 고를 수 있다.</p>
    <div class="c-foot"><button class="btn" data-act="finish">점수판으로 ▶</button><span class="gk-hint">점수: 카드 점수 합 순위 × 3</span></div>
  </div>`;
}

function playAsk(s, card, ready, got, inNeed) {
  const head = `<div class="cq-head"><span class="pv-eyebrow">장바구니 탐정 · 카드 ${s.idx}/${s.order.length}</span>
    <span class="cq-time"><b class="cq-left num">${ASK_SECONDS}</b>초</span></div>
    <div class="cq-card"><span class="cq-art" aria-hidden="true">${card.art}</span><b>${esc(card.name)}</b>
      <span class="cq-lab">${labelRows(card).slice(1).map(([, l, v]) => `<span><i>${esc(l)}</i> ${esc(v)}</span>`).join('')}</span></div>`;
  if (!inNeed) return `<div class="cq">${head}<div class="pv-center"><div class="pv-big">이번 카드는 구경!</div><p class="pv-sub">다음 카드부터 함께해요</p></div></div>`;
  if (got) {
    const i = s.choices.indexOf(got);
    return `<div class="cq">${head}<div class="pv-center">
      <div class="pv-eyebrow">✓ 골랐어요</div>
      <div class="cq-picked"><span>${SYM[i] || ''}</span><span>${TECH[got] ? TECH[got].emoji : ''}</span><b>${TECH[got] ? esc(TECH[got].label) : ''}</b></div>
      <p class="pv-sub">정답은 곧 화면에서! 처음 고른 답만 세요</p></div></div>`;
  }
  return `<div class="cq">${head}
    <h2 class="cq-q">${ready ? '이 식품에 들어간 생명 기술은?' : '포장지를 읽어 보세요…'}</h2>
    <div class="cq-grid">
      ${s.choices.map((c, i) => `<button class="cq-btn" data-c="${c}" ${ready ? '' : 'disabled'} aria-label="${LET[i]} ${esc(TECH[c].label)}">
        <span class="cq-sym" aria-hidden="true">${SYM[i]}</span><span class="cq-e" aria-hidden="true">${TECH[c].emoji}</span><b>${esc(TECH[c].label)}</b></button>`).join('')}
    </div></div>`;
}

function playReveal(s, card, me) {
  const res = s.res || {};
  const f = s.first && s.first[me.uid];
  const ok = f && f.c === res.ans;
  const T = TECH[res.ans];
  return `<div class="pv-center">
    <div class="pv-eyebrow">카드 ${s.idx}/${s.order.length} 정답</div>
    <div class="pv-huge">${!f ? '⏰' : ok ? '⭕' : '❌'}</div>
    <div class="pv-big">${!f ? '이번엔 못 골랐어요' : ok ? '맞았어요!' : '아쉬워요!'} 정답: ${T.emoji} ${esc(T.label)}</div>
    <p class="cq-clue">🔎 단서: <b>${esc(card.clueText || (clueRow(card) || [])[2] || '')}</b></p>
    <p class="pv-sub">${esc(card.why)}</p>
    ${res.pts && res.pts[me.team] !== undefined ? `<p class="pv-q num">우리 팀 +${res.pts[me.team]} · 맞힘 ${res.right[me.team]}/${res.size[me.team]}</p>` : ''}
  </div>`;
}

const CSS = `
.c-wrap,.cq{word-break:keep-all}
.c-wrap{position:relative;display:flex;flex-direction:column;height:100%;gap:10px}
.c-top{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;min-height:74px}
.c-title{font-size:34px;font-weight:800;letter-spacing:-.025em;margin:6px 0 0;line-height:1.2}
.c-okrate{display:flex;align-items:baseline;gap:4px;background:var(--grn-w);border:1.5px solid var(--grn-l);border-radius:14px;padding:6px 18px}
.c-okrate b{font-size:50px;font-weight:800;letter-spacing:-.045em;line-height:1;color:var(--grn-t)}
.c-okrate span{font-size:18px;font-weight:700;color:var(--grn-t)}
.c-main{flex:1;min-height:0;display:grid;grid-template-columns:470px 1fr;gap:20px;container-type:size}
.c-packbox{min-height:0;display:flex;align-items:center;justify-content:center}
.c-opts{position:relative;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr auto;gap:12px}
.c-opt{position:relative;overflow:hidden;display:grid;grid-template-columns:40px 1fr;grid-template-rows:auto auto;align-content:center;column-gap:10px;
  background:var(--card);border:2px solid var(--line);border-radius:16px;padding:12px 18px}
.c-sym{grid-row:1/3;font-size:34px;line-height:1;align-self:center;color:var(--ink)}
.c-let{font-size:15px;font-weight:800;color:var(--dim)}
.c-oe{position:absolute;right:16px;top:12px;font-size:46px;line-height:1}
.c-ol{font-size:30px;font-weight:800;letter-spacing:-.03em;line-height:1.2;padding-right:56px}
.c-cnt{position:absolute;right:16px;bottom:10px;font-size:22px;font-weight:800;z-index:1}
.c-bar{position:absolute;left:0;bottom:0;height:8px;background:var(--mid);border-radius:0 4px 4px 0}
.c-opt.ans{border:4px solid var(--grn);background:var(--grn-w);animation:gk-pop .4s both}
.c-opt.ans .c-ol,.c-opt.ans .c-cnt{color:var(--grn-t)}
.c-opt.ans .c-bar{background:var(--grn)}
.c-opt.no{opacity:.5}
.c-why{grid-column:1/3;margin:0;font-size:21px;line-height:1.5;font-weight:700;background:var(--org-w);border:1.5px solid var(--org-l);border-radius:14px;padding:10px 16px}
/* 비상 모드 묻기: 팀 줄은 아래 「대신 누르기」 칸과 같은 정보라 숨기고 포장 그림에 자리를 준다 */
.c-wrap.offask .c-teams{display:none}
.c-teams{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:8px}
.c-team{background:var(--card);border:1.5px solid var(--line);border-top:8px solid var(--tf);border-radius:12px;padding:6px 10px;min-width:0}
.c-tn{font-size:17px;font-weight:800;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.c-dots{display:flex;gap:5px;margin-top:4px;flex-wrap:wrap;min-height:26px}
.c-dots i{width:24px;height:24px;border-radius:50%;border:2.5px solid var(--mid-d)}
.c-dots i.on{background:var(--tf);border-color:#141413}
.c-tr{display:flex;align-items:baseline;gap:8px;min-height:26px}
.c-tr b{font-size:24px;font-weight:800;color:var(--grn-t)}.c-tr span{font-size:15px;font-weight:700;color:var(--dim)}
.c-foot{display:flex;align-items:center;gap:12px;min-height:48px}
.c-ready{position:absolute;inset:0;display:grid;place-items:center;font-size:44px;font-weight:800;color:var(--org-t);
  background:rgba(250,249,245,.88);border-radius:16px;pointer-events:none;z-index:2}
/* 판이 낮을 때(대신 누르기 칸 · 작은 화면): 보기 칸을 한 줄로 줄인다 */
@container (max-height:340px){
  .c-opts{gap:8px}
  .c-opt{padding:6px 14px;grid-template-columns:32px 1fr}
  .c-let{display:none}
  .c-sym{font-size:26px}
  .c-ol{font-size:25px}
  .c-oe{font-size:32px;top:50%;margin-top:-16px}
  .c-cnt{font-size:18px;bottom:4px}
  .c-why{font-size:17px;line-height:1.4;padding:6px 12px}
  .c-ready{font-size:32px}
}
/* 포장 */
.cp-pack{position:relative;width:440px;flex:none;display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 6px 0 rgba(20,20,19,.12));animation:cpin .45s cubic-bezier(.2,.75,.3,1) both}
@keyframes cpin{from{transform:translateY(-30px) rotate(-4deg);opacity:0}to{transform:none;opacity:1}}
.cp-body{position:relative;width:100%;border-radius:14px;padding:26px 22px 20px;display:flex;flex-direction:column;gap:12px;border:3px solid var(--pk-b);background:var(--pk-bg)}
.t-org{--pk-bg:#fbeee7;--pk-b:#d97757;--pk-n:#141413}
.t-blu{--pk-bg:#eaf1f8;--pk-b:#6a9bcc;--pk-n:#141413}
.t-grn{--pk-bg:#eff2e8;--pk-b:#788c5d;--pk-n:#141413}
.t-ink{--pk-bg:#3a3936;--pk-b:#141413;--pk-n:#ffffff}
.t-paper{--pk-bg:#f1efe6;--pk-b:#8d8a80;--pk-n:#141413}
.cp-virtual{position:absolute;top:8px;right:10px;font-size:13px;font-weight:800;padding:2px 8px;border-radius:99px;background:#fff;color:#6b6963;border:1.5px solid #e8e6dc}
.cp-front{display:flex;align-items:center;gap:14px}
.cp-fn{display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-width:0}
.cp-stk{font-size:17px;font-weight:800;padding:3px 12px;border-radius:99px;background:#fff;color:#141413;border:2px dashed var(--pk-b);transform:rotate(-2deg);line-height:1.3}
.cp-art{font-size:78px;line-height:1;display:block;height:1em;flex:none}
.cp-name{font-size:30px;font-weight:800;letter-spacing:-.03em;line-height:1.2;color:var(--pk-n)}
.cp-label{background:#fff;border:2px solid #141413;border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
.cp-row{display:grid;grid-template-columns:88px 1fr;gap:8px;font-size:19px;line-height:1.38}
.cp-row b{font-size:16px;color:#6b6963}
.cp-row.clue{background:var(--org-w);box-shadow:0 0 0 4px var(--org-l);border-radius:6px;margin:0 -6px;padding:2px 6px;animation:gkpulse .6s 3 alternate}
.cp-row.clue b{color:var(--org-t)}
.k-bag .cp-body{padding-top:36px;padding-bottom:30px;border:none;box-shadow:inset 0 0 0 3px var(--pk-b)}
.k-bottle .cp-neck{width:34%;height:46px;background:var(--pk-bg);border:3px solid var(--pk-b);border-bottom:none;border-radius:12px 12px 0 0;position:relative}
.k-bottle .cp-neck::before{content:'';position:absolute;left:-8%;right:-8%;top:-14px;height:16px;border-radius:6px;background:var(--pk-b)}
.k-bottle .cp-body{border-radius:36px 36px 18px 18px}
.k-jar .cp-lid{width:74%;height:34px;background:var(--pk-b);border-radius:10px 10px 4px 4px}
.k-jar .cp-body{border-radius:26px}
.k-carton .cp-gable{width:100%;height:40px;background:var(--pk-b);clip-path:polygon(0 100%,12% 0,88% 0,100% 100%)}
.k-carton .cp-body{border-radius:0 0 12px 12px}
.k-tray .cp-body{border-radius:26px;border-width:6px;box-shadow:inset 0 0 0 6px rgba(255,255,255,.6)}
.k-pouch .cp-body{border-radius:14px 14px 46px 46px;border-top:10px dashed var(--pk-b)}
.k-tag .cp-body{border-radius:12px;transform:rotate(-2deg);padding-top:36px}
.k-tag .cp-body::before{content:'';position:absolute;top:10px;left:16px;width:18px;height:18px;border-radius:50%;background:var(--paper);border:3px solid var(--pk-b)}
.k-box .cp-body::before{content:'';position:absolute;left:0;right:0;top:0;height:12px;background:var(--pk-b);border-radius:10px 10px 0 0}
/* 최종 */
.c-final{flex:1;min-height:0;display:grid;grid-template-columns:1fr 470px;gap:20px}
.c-rank{display:flex;flex-direction:column;gap:6px;justify-content:center;min-height:0;overflow:hidden}
.c-rrow{flex:1 1 0;max-height:62px;min-height:0;display:grid;grid-template-columns:56px 170px 1fr 96px 60px;gap:12px;align-items:center;background:var(--card);
  border:1.5px solid var(--line);border-left:10px solid var(--tf);border-radius:12px;padding:0 12px;animation:gk-in .35s cubic-bezier(.2,.75,.3,1) both}
.c-rk{font-size:28px;text-align:center}.c-rn{font-size:20px;font-weight:800;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.c-rbar{height:24px;background:var(--line);border-radius:6px;overflow:hidden}.c-rbar i{display:block;height:100%;background:var(--tf);animation:sbgrow .8s .2s both}
.c-rv{font-size:24px;font-weight:800;text-align:right}.c-rp{font-size:20px;font-weight:800;color:var(--grn-t)}
.c-sum{background:var(--card);border:1.5px solid var(--line);border-radius:14px;padding:12px 16px;display:flex;flex-direction:column;gap:8px;min-height:0}
.c-sumh{font-size:15px;font-weight:800;color:var(--dim)}
.c-techs{display:grid;grid-template-columns:1fr;gap:4px}
.c-tech{display:grid;grid-template-columns:34px 126px 1fr;align-items:center;gap:6px}
.c-tech span{font-size:24px}.c-tech b{font-size:18px}.c-tech small{font-size:15px;color:var(--dim);line-height:1.35}
.c-hard{margin:0;font-size:16px;background:var(--org-w);border-radius:10px;padding:6px 10px}
/* 조종기 */
.cq{display:flex;flex-direction:column;height:100%;gap:10px}
.cq-head{display:flex;justify-content:space-between;align-items:center}
.cq-time{font-size:20px;font-weight:800;padding:4px 14px;border-radius:12px;border:1.5px solid var(--line);background:var(--card)}
.cq-time b{font-size:34px}
.cq-time.hot{border-color:var(--bad);background:var(--bad-w);color:var(--bad)}
.cq-card{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;background:var(--card);border:1.5px solid var(--line);border-radius:14px;padding:8px 14px;font-size:20px}
.cq-art{font-size:34px;line-height:1}
.cq-lab{flex-basis:100%;display:flex;flex-direction:column;gap:2px;font-size:18px;line-height:1.35}
.cq-lab i{font-style:normal;font-size:15px;font-weight:800;color:var(--dim);margin-right:4px}
.cq-q{font-size:26px;font-weight:800;letter-spacing:-.025em;margin:2px 0 0;text-align:center}
.cq-grid{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:12px}
.cq-btn{display:flex;align-items:center;justify-content:center;gap:16px;border-radius:20px;border:2.5px solid var(--mid-d);background:var(--card);cursor:pointer;padding:8px 16px;min-height:0}
.cq-btn b{font-size:32px;letter-spacing:-.03em}
.cq-sym{font-size:34px}.cq-e{font-size:48px;line-height:1}
.cq-btn:hover:not(:disabled){border-color:var(--org);background:var(--org-w)}
.cq-btn:active:not(:disabled){transform:translateY(2px)}
.cq-btn.on{border-color:var(--org);background:var(--org-w);box-shadow:0 0 0 3px var(--org)}
.cq-btn:disabled:not(.on){opacity:.45;cursor:default}
.cq-clue{margin:4px 0 0;font-size:19px;background:var(--org-w);border:1.5px solid var(--org-l);border-radius:12px;padding:6px 14px}
.cq-picked{display:flex;align-items:center;gap:16px;font-size:52px;padding:16px 36px;border-radius:24px;border:3px solid var(--org);background:var(--org-w);animation:gk-pop .3s both}
.cq-picked b{font-size:44px;letter-spacing:-.03em}
@media (prefers-reduced-motion:reduce){.cp-pack,.c-rrow,.c-opt.ans,.cq-picked,.cp-row.clue{animation:none!important}}
`;
