// 13차시 「김치 숙성 타이밍」 — 발효 식품 · 영양 식생활
// 김치가 익어 가는 게이지가 흐른다. 팀원 각자 「꺼내!」를 한 번. 가장 맛있을 때에 가까울수록 점수(팀 = 평균).
// 라운드마다 온도가 다르다(냉장고 4℃ · 실온 20℃ · 깜짝 「한여름 정전!」) → 온도가 발효 속도를 바꾼다.
import {
  esc, clamp, keyed, text, rankPoints, confetti, injectCSS, medal, flash, beep, tickSound,
} from '../src/gamekit.js';

// ── 내용 ──
// 김치를 익히는 것은 유산균. 유산균이 채소의 당을 먹고 젖산을 만들어 새콤해진다.
// 온도가 높을수록 유산균이 빨리 일한다: 냉장고(4℃) 2~3주 · 실온(20℃) 2~3일.
const PEAK = 60;            // 가장 맛있는 숙성도
const ZONES = [
  { from: 0,  to: 25,  name: '생김치',     cls: 'z0' },
  { from: 25, to: 50,  name: '덜 익음',    cls: 'z1' },
  { from: 50, to: 70,  name: '딱 맛있음',  cls: 'z2' },
  { from: 70, to: 88,  name: '시어짐',     cls: 'z3' },
  { from: 88, to: 100, name: '너무 시어짐', cls: 'z4' },
];
// rate: 숙성도/초, dps: 게임 속 날짜/초
const ROUNDS = [
  { name: '냉장고', temp: 4,  rate: 3.4, dps: 1.0,
    say: '냉장고(4℃)에서는 유산균이 천천히 일해 2~3주에 걸쳐 맛있게 익는다.' },
  { name: '실온',   temp: 20, rate: 8.0, dps: 0.4,
    say: '실온(20℃)에서는 2~3일이면 익는다 — 온도가 높을수록 유산균이 빨리 일한다.' },
  { name: '냉장고', temp: 4,  rate: 3.4, dps: 1.0, event: { temp: 30, rate: 12, dps: 0.4 },
    say: '정전으로 온도가 오르자 유산균이 갑자기 바빠졌다 — 숙성이 확 빨라졌다!' },
];
const READY_MS = 3500;
// 라운드를 닫은 뒤(closeAt) 늦게 도착하는 입력을 기다리는 시간. 서버 시각 t ≤ closeAt 인 입력만 센다.
// (와이파이가 느리면 제때 누른 입력이 진행판에 1초 넘게 늦게 올 수 있다)
const GRACE_MS = 1500;

export function pressScore(p) { return Math.max(0, Math.round(100 - 2.5 * Math.abs(p - PEAK))); }
export function zoneOf(p) { return ZONES.find(z => p < z.to) || ZONES[ZONES.length - 1]; }

/** 서버 시간 now 의 숙성도 · 날짜 · 온도 */
export function ripeAt(s, now) {
  const R = ROUNDS[s.round - 1];
  const t = Math.max(0, (now - s.startAt) / 1000);
  if (R.event && s.eventSec != null && t > s.eventSec) {
    const p0 = R.rate * s.eventSec, d0 = R.dps * s.eventSec, dt = t - s.eventSec;
    return { p: Math.min(100, p0 + R.event.rate * dt), day: d0 + R.event.dps * dt, temp: R.event.temp, hot: true };
  }
  return { p: Math.min(100, R.rate * t), day: R.dps * t, temp: R.temp, hot: false };
}

function startRound(s, ctx, round) {
  const R = ROUNDS[round - 1];
  const need = {};
  for (const t of ctx.teams) need[t.id] = t.online.slice();
  return {
    ...s, step: 'ready', round, inputKey: `k${round}`, startAt: ctx.now() + READY_MS,
    eventSec: R.event ? Math.round((5 + ctx.rnd() * 3) * 10) / 10 : null,   // 5~8초 뒤 정전
    need, pressed: {}, first: {}, endAt: null, closeAt: null, finishAt: null,
  };
}

// 처음 누른 시각만 센다(다시 보내도 안 바뀜). t 는 서버 시간(규칙이 t === now 로 막는다)
function foldFirst(s, inputs) {
  const first = { ...(s.first || {}) };
  for (const [u, inp] of Object.entries(inputs || {})) {
    if (inp && typeof inp.t === 'number' && inp.t >= s.startAt && (s.closeAt == null || inp.t <= s.closeAt) && first[u] === undefined) first[u] = inp.t;
  }
  return first;
}
// 이 팀에서 점수에 드는 사람: 라운드 시작 때 접속한 팀원(+ 대신 누르기). 비상 모드면 대신 누르기만
function members(s, tid, ctx, first) {
  const px = 'proxy-' + tid;
  if (ctx.offline) return [px];
  const list = (s.need[tid] || []).slice();
  if (first[px] !== undefined && !list.includes(px)) list.push(px);
  return list;
}

function finishRound(s, ctx, inputs) {
  const scores = {}, avg = {}, marks = {};
  const first = foldFirst(s, inputs);
  for (const tid of Object.keys(s.need)) {
    const uids = members(s, tid, ctx, first);
    let sum = 0;
    marks[tid] = [];
    for (const u of uids) {
      let p = null, sc = 0;
      if (first[u] !== undefined) { p = Math.round(ripeAt(s, first[u]).p * 10) / 10; sc = pressScore(p); }
      scores[u] = sc;
      sum += sc;
      marks[tid].push({ n: ctx.numOf(u), p });
    }
    // 팀원 3명 이상이면 가장 낮은 점수 하나는 빼고 평균(한 명 실수로 팀이 무너지지 않게)
    const list = uids.map(u => scores[u]);
    if (list.length >= 3) { sum -= Math.min(...list); avg[tid] = Math.round(sum / (list.length - 1)); }
    else avg[tid] = list.length ? Math.round(sum / list.length) : 0;
  }
  const { points, rank } = rankPoints(avg, true);
  const total = { ...(s.total || {}) };
  for (const tid of Object.keys(points)) total[tid] = (total[tid] || 0) + points[tid];
  const history = { ...(s.history || {}) };
  for (const tid of Object.keys(avg)) history[tid] = [...(history[tid] || []), { avg: avg[tid], rank: rank[tid], pts: points[tid] }];
  return { ...s, step: 'reveal', inputKey: null, first, scores, avg, rank, pts: points, marks, total, history };
}

/** 라운드 닫기: 이 시각 뒤 입력은 세지 않고, GRACE_MS 동안 늦게 오는 입력을 기다린 뒤 결과를 낸다 */
function closeRound(s, ctx, at) {
  if (s.closeAt != null) return s;
  const first = foldFirst({ ...s, closeAt: at }, ctx.inputs);
  // 모두 이미 눌렀으면 기다릴 것이 없다
  let all = true;
  for (const tid of Object.keys(s.need)) {
    const uids = members(s, tid, ctx, first);
    if (uids.some(u => first[u] === undefined)) all = false;
  }
  return { ...s, first, closeAt: at, finishAt: all ? ctx.now() : ctx.now() + GRACE_MS };
}

const game = {
  id: 'kimchi',
  title: '김치 숙성 타이밍',
  lesson: 13,
  minutes: 4,
  emoji: '🥬',
  blurb: '가장 맛있게 익었을 때 「꺼내!」 한 번',
  intro: {
    headline: '김치 숙성 타이밍',
    lines: [
      '김치가 익어 간다 🥬 → 새콤 → 너무 시큼',
      '각자 <b>「꺼내!」를 한 번만</b>. 가장 맛있을 때에 가까울수록 점수',
      '팀 점수 = 팀원 평균. 온도가 바뀌면 익는 속도도 바뀐다!',
    ],
    art: 'kimchi',
  },

  setup(ctx) { return startRound({ total: {}, history: {} }, ctx, 1); },

  onInput(s, inputs, ctx) {
    if (s.step !== 'ready' && s.step !== 'run') return s;
    const first = foldFirst(s, inputs);
    const pressed = {};
    let all = true, anyNeed = false;
    for (const tid of Object.keys(s.need)) {
      const uids = members(s, tid, ctx, first);
      pressed[tid] = uids.filter(u => first[u] !== undefined).length;
      if (uids.length) anyNeed = true;
      if (pressed[tid] < uids.length) all = false;
    }
    let endAt = s.endAt;
    if (s.step === 'run' && anyNeed && all && !endAt) endAt = ctx.now() + 1200;
    return { ...s, first, pressed, endAt };
  },

  // 같은 번호가 새 기기로 바뀌면(코어가 부른다) 참가 명단 · 누른 기록을 옮긴다
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
    if (s.step === 'ready' && now >= s.startAt) return { ...s, step: 'run' };
    if (s.step === 'run') {
      if (s.closeAt != null) return now >= s.finishAt ? finishRound(s, ctx, ctx.inputs) : s;
      const r = ripeAt(s, now);
      let next = s;
      if (r.hot && !s.eventOn) next = { ...next, eventOn: true };
      if (r.p >= 100 && !next.endAt) next = { ...next, endAt: now + 900 };
      if (next.endAt && now >= next.endAt) return closeRound(next, ctx, next.endAt);
      return next;
    }
    return s;
  },

  action(s, name, payload, ctx) {
    if (name === 'stop' && s.step === 'run') return closeRound(s, ctx, ctx.now());
    if (name === 'next' && s.step === 'reveal') return s.round < ROUNDS.length ? startRound(s, ctx, s.round + 1) : { ...s, step: 'fact' };
    if (name === 'finish' && s.step === 'fact') return { ...s, done: true };
    return s;
  },

  proxyButtons(s) {
    return (s.step === 'run' && s.closeAt == null) ? [{ label: '🫙 꺼내!', input: { out: true }, once: true }] : [];
  },

  scoring(s, ctx) {
    return {
      points: s.total || {},
      lines: [
        '김치가 익는 건 <b>유산균</b>이 <b>젖산</b>을 만들기 때문. 온도가 높으면 더 빨리 익는다.',
        '김치 · 된장 · 요구르트 · 빵 = 생물이 일하는 발효 식품',
      ],
    };
  },

  record(s) {
    let b = null;
    for (const [tid, h] of Object.entries(s.history || {})) for (const r of h) if (!b || r.avg > b.avg) b = { ...r, tid };
    return b ? { label: '김치 타이밍 최고 팀 평균', value: b.avg, unit: '점', team: b.tid } : null;
  },

  hostView(el, s, ctx) {
    injectCSS('kimchi', CSS);
    const now = ctx.now();
    if (s.step === 'ready' || s.step === 'run') {
      const R = ROUNDS[s.round - 1];
      if (keyed(el, `run-${s.round}-${ctx.teams.length}`, hostRun(s, ctx, R))) { /* 새 라운드 */ }
      updateRun(el, s, ctx, now);
    } else if (s.step === 'reveal') {
      if (keyed(el, `rev-${s.round}`, hostReveal(s, ctx))) { confetti(el, 40); beep(784, 200, 'triangle'); }
    } else if (s.step === 'fact') {
      keyed(el, 'fact', hostFact(s, ctx));
    }
    el.querySelectorAll('[data-act]').forEach(b => { b.onclick = () => ctx.act(b.dataset.act); });
  },

  playView(el, s, me, ctx) {
    injectCSS('kimchi', CSS);
    const now = ctx.now();
    const pressed = (s.first && s.first[me.uid] !== undefined) || (me.mine && me.mine.t >= s.startAt);
    const pressedLocal = me.mine && me.mine.out && !me.mine.t; // 보내는 중
    if (s.step === 'ready' || s.step === 'run') {
      const inNeed = (s.need[me.team] || []).includes(me.uid);
      const closed = s.closeAt != null && now >= s.closeAt;
      const key = `kp-${s.round}-${s.step}-${pressed || pressedLocal ? 1 : 0}-${s.eventOn ? 1 : 0}-${inNeed}-${closed}`;
      if (keyed(el, key, playRun(s, me, pressed || pressedLocal, inNeed, closed))) {
        const b = el.querySelector('.k-out');
        if (b) b.onclick = () => { b.disabled = true; ctx.send({ out: true }); };
      }
      if (s.step === 'ready') text(el, '.k-count', Math.max(1, Math.ceil((s.startAt - now) / 1000)));
    } else if (s.step === 'reveal') {
      const my = s.scores ? s.scores[me.uid] : undefined;
      const mark = (s.marks[me.team] || []).find(m => m.n === me.num);
      keyed(el, `kr-${s.round}`, `
        <div class="pv-center">
          <div class="pv-eyebrow">${s.round}라운드 결과</div>
          <div class="pv-huge">${s.rank && s.rank[me.team] ? medal(s.rank[me.team]) : '🥬'}</div>
          ${my !== undefined ? `<div class="pv-big num">내 점수 ${my} · 우리 팀 평균 ${s.avg[me.team]}</div>
            <p class="pv-sub">${mark && mark.p != null ? `꺼낸 때: 숙성도 ${mark.p} — ${zoneOf(mark.p).name}` : '이번엔 못 꺼냈어요 (0점)'}</p>`
            : '<div class="pv-big">결과는 화면에서!</div>'}
          <p class="pv-sub dim">${esc(ROUNDS[s.round - 1].say)}</p>
        </div>`);
    } else {
      keyed(el, 'kf', `<div class="pv-center"><div class="pv-eyebrow">정리</div><div class="pv-big">🥬 🫘 🥛 🍞</div>
        <p class="pv-sub">생물이 일하는 발효 식품 — 화면을 보세요</p></div>`);
    }
  },
};
export default game;

function playRun(s, me, pressed, inNeed, closed) {
  const R = ROUNDS[s.round - 1];
  if (!inNeed) return `<div class="pv-center"><div class="pv-big">이번 라운드는 구경!</div><p class="pv-sub">다음 라운드부터 함께해요</p></div>`;
  if (closed && !pressed) return `<div class="pv-center"><div class="pv-huge">⏱</div><div class="pv-big">끝! 결과를 모으는 중…</div><p class="pv-sub">화면을 보세요</p></div>`;
  if (pressed) return `<div class="pv-center"><div class="pv-huge">🫙</div><div class="pv-big">꺼냈다!</div><p class="pv-sub">결과는 화면에서 — 친구들은 언제 꺼낼까?</p></div>`;
  return `
  <div class="k-play ${s.eventOn ? 'hot' : ''}">
    <div class="pv-eyebrow">${s.round}라운드 · ${s.eventOn ? '⚡ 정전! 30℃' : `${R.name} ${R.temp}℃`}</div>
    ${s.step === 'ready'
      ? `<div class="k-ready">준비… <b class="k-count num">3</b></div><button class="k-out" disabled>꺼내!</button>`
      : `<p class="k-tip">화면의 김치를 보다가 <b>가장 맛있을 때</b> 누르세요 — 한 번뿐!</p><button class="k-out">🫙 꺼내!</button>`}
  </div>`;
}

function curvePath(w, h) {
  // 맛 그래프: 숙성도 60에서 가장 높은 종 모양
  let d = '';
  for (let i = 0; i <= 100; i += 2) {
    const y = Math.exp(-Math.pow((i - PEAK) / 17, 2));
    d += `${i ? 'L' : 'M'}${(i / 100 * w).toFixed(1)} ${(h - y * (h - 10)).toFixed(1)} `;
  }
  return d;
}

function hostRun(s, ctx, R) {
  const W = 1200, H = 200;
  return `
  <div class="k-wrap">
    <div class="k-top">
      <div>
        <div class="eyebrow">김치 숙성 타이밍 · ${s.round}/${ROUNDS.length}라운드</div>
        <h1 class="k-title">언제 꺼낼까? <span class="k-state"></span></h1>
      </div>
      <div class="k-meters">
        <div class="k-therm"><span>🌡</span><b class="k-temp num">${R.temp}℃</b><small class="k-place">${R.name}</small></div>
        <div class="k-day"><small>숙성</small><b class="k-dayn num">0.0</b><small>일째</small></div>
      </div>
    </div>
    <div class="k-gauge"><div class="k-gin">
      <svg viewBox="0 0 ${W} ${H + 60}" preserveAspectRatio="none" class="k-svg" aria-hidden="true">
        ${ZONES.map(z => `<rect class="k-zone ${z.cls}" x="${z.from / 100 * W}" y="0" width="${(z.to - z.from) / 100 * W}" height="${H}"/>`).join('')}
        <path d="${curvePath(W, H)}" fill="none" stroke="#141413" stroke-width="3" stroke-opacity=".55"/>
        <line class="k-now" x1="0" x2="0" y1="0" y2="${H}" stroke="#141413" stroke-width="4"/>
        ${ZONES.map(z => `<text x="${(z.from + z.to) / 200 * W}" y="${H + 38}" text-anchor="middle" font-size="26" font-weight="800" fill="${z.cls === 'z2' ? '#55683f' : '#6b6963'}">${z.cls === 'z2' ? '★ ' : ''}${z.name}</text>`).join('')}
      </svg>
      <div class="k-jar" aria-hidden="true">🫙</div>
      <div class="k-ready-big"></div>
    </div></div>
    <div class="k-teams" style="--n:${ctx.teams.length}">
      ${ctx.teams.map(t => `
      <div class="k-team" data-tid="${t.id}" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}">
        <div class="k-tn">${t.emoji} ${esc(t.name)}</div>
        <div class="k-dots">${(ctx.offline ? ['p'] : (s.need[t.id] || [])).map(() => '<i></i>').join('') || '<span class="dim">—</span>'}</div>
      </div>`).join('')}
    </div>
    <div class="k-foot"><button class="btn ghost" data-act="stop">여기서 멈추기</button>
      <span class="gk-hint">「꺼내!」는 한 사람에 한 번. 누른 사람은 ● 로 바뀐다</span></div>
    <div class="k-event" aria-live="assertive"></div>
  </div>`;
}

function updateRun(el, s, ctx, now) {
  const wrap = el.querySelector('.k-wrap');
  if (s.step === 'ready') {
    const n = Math.max(1, Math.ceil((s.startAt - now) / 1000));
    text(el, '.k-ready-big', n);
    text(el, '.k-state', '준비…');
    tickSound(el, n);
    el.querySelector('.k-ready-big').style.display = '';
    setJar(el, 0);
    return;
  }
  el.querySelector('.k-ready-big').style.display = 'none';
  const r = ripeAt(s, s.closeAt != null ? Math.min(now, s.closeAt) : now);   // 닫은 뒤에는 멈춘다
  setJar(el, r.p);
  text(el, '.k-dayn', r.day.toFixed(1));
  const z = zoneOf(r.p);
  text(el, '.k-state', s.closeAt != null && now >= s.closeAt ? '— 끝! 결과 모으는 중…' : `— 지금 ${z.name}`);
  wrap.classList.toggle('sour', r.p >= 85);
  wrap.classList.toggle('yum', r.p >= 50 && r.p < 70);
  if (r.hot) {
    text(el, '.k-temp', '30℃');
    text(el, '.k-place', '정전!');
    if (!wrap.classList.contains('evented')) {
      wrap.classList.add('evented');
      const ev = el.querySelector('.k-event');
      ev.innerHTML = '<div><b>⚡ 한여름 정전!</b><span>냉장고가 꺼졌다 — 30℃</span></div>';
      flash(wrap, 'k-shake', 900);
      beep(220, 500, 'sawtooth', 0.12);
      setTimeout(() => { ev.innerHTML = ''; }, 2600);
    }
  }
  for (const t of ctx.teams) {
    const n = (s.pressed || {})[t.id] || 0;
    const dots = el.querySelectorAll(`.k-team[data-tid="${t.id}"] .k-dots i`);
    dots.forEach((d, i) => d.classList.toggle('on', i < n));
  }
}

function setJar(el, p) {
  const jar = el.querySelector('.k-jar');
  if (jar) jar.style.left = `calc(${p}% - 28px)`;
  const ln = el.querySelector('.k-now');
  if (ln) { const x = (p / 100 * 1200).toFixed(1); ln.setAttribute('x1', x); ln.setAttribute('x2', x); }
}

/**
 * 결과 줄의 번호 동그라미가 겹치지 않게 옆으로 비킨다(1차원 벌집).
 * ps: 숙성도(0~100) 목록 → 같은 순서의 그릴 위치(%). 가까운 것끼리 묶어 원래 평균 자리를 중심으로 gap 간격으로 편다.
 */
export function dodge(ps, gap = 4) {
  const idx = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
  const groups = [];
  for (const [p, i] of idx) {
    groups.push({ items: [i], sum: p, start: p });
    // 앞 무리와 겹치면 합친다(합친 무리가 또 앞과 겹칠 수 있으니 되풀이)
    while (groups.length > 1) {
      const b = groups[groups.length - 1], a = groups[groups.length - 2];
      if (a.start + a.items.length * gap <= b.start + 1e-9) break;
      const items = [...a.items, ...b.items], sum = a.sum + b.sum, n = items.length;
      groups.splice(-2, 2, { items, sum, start: sum / n - (n - 1) * gap / 2 });
    }
  }
  const out = new Array(ps.length);
  for (const g of groups) {
    const n = g.items.length;
    const start = clamp(g.start, 0, Math.max(0, 100 - (n - 1) * gap));
    g.items.forEach((i, k) => { out[i] = Math.round((start + k * gap) * 10) / 10; });
  }
  return out;
}

function markHTML(marks) {
  const ms = (marks || []).filter(m => m.p != null);
  const xs = dodge(ms.map(m => m.p));
  return ms.map((m, i) => {
    const moved = Math.abs(xs[i] - m.p) > 0.2;
    return `${moved ? `<i class="k-tick" style="left:${m.p}%"></i>` : ''}<i class="k-mk" style="left:${xs[i]}%" title="${m.n ? m.n + '번' : '대신 누르기'} · 숙성도 ${m.p}">${m.n || '★'}</i>`;
  }).join('');
}

function hostReveal(s, ctx) {
  const R = ROUNDS[s.round - 1];
  const rows = ctx.teams.filter(t => s.avg[t.id] !== undefined).sort((a, b) => s.rank[a.id] - s.rank[b.id]);
  return `
  <div class="k-wrap">
    <div class="k-top"><div>
      <div class="eyebrow">${s.round}라운드 결과 · ${R.name} ${R.temp}℃${R.event ? ' → ⚡ 정전 30℃' : ''}</div>
      <h1 class="k-title">${rows[0] ? `${medal(1)} ${rows[0].emoji} ${esc(rows[0].name)} — 평균 ${s.avg[rows[0].id]}점` : '결과'}</h1>
    </div></div>
    <div class="k-rev">
      <div class="k-rrow k-scalerow"><span></span><span></span><span class="k-revscale">${ZONES.map(z => `<span class="k-zone ${z.cls}" style="flex:${z.to - z.from}">${z.cls === 'z2' ? '★ ' : ''}${z.name}</span>`).join('')}</span><span></span><span></span></div>
      ${rows.map((t, i) => `
      <div class="k-rrow" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text};animation-delay:${(i * 0.06).toFixed(2)}s">
        <span class="k-rk">${medal(s.rank[t.id])}</span>
        <span class="k-rn">${t.emoji} ${esc(t.name)}</span>
        <span class="k-track"><i class="k-peak" style="left:${PEAK}%"></i>${markHTML(s.marks[t.id])}</span>
        <b class="k-rv num">${s.avg[t.id]}점</b>
        <span class="k-rp num">+${s.pts[t.id]}</span>
      </div>`).join('')}
    </div>
    <p class="gk-note">🌡 ${esc(R.say)}</p>
    <div class="k-foot"><button class="btn" data-act="next">${s.round < ROUNDS.length ? `${s.round + 1}라운드 ▶` : '발효 식품 정리 ▶'}</button>
      <span class="gk-hint">숫자 = 번호(겹치면 옆으로 비키고 아래 눈금이 실제 자리) · 초록 세로선 = 가장 맛있는 때 · 3명 이상 팀은 가장 낮은 점수 하나 빼고 평균</span></div>
  </div>`;
}

function hostFact() {
  const foods = [
    ['🥬', '김치', '유산균', '젖산 → 새콤한 맛'],
    ['🥛', '요구르트', '유산균', '젖산 → 우유가 엉긴다'],
    ['🫘', '된장', '곰팡이 · 세균', '콩 단백질 분해 → 구수한 맛'],
    ['🍞', '빵', '효모', '이산화탄소 → 빵이 부푼다'],
  ];
  return `
  <div class="k-wrap">
    <div class="k-top"><div><div class="eyebrow">정리 · 발효 식품</div>
      <h1 class="k-title">생물이 일하는 식품 = 발효 식품</h1></div></div>
    <div class="k-foods">
      ${foods.map(([e, n, who, out], i) => `
      <div class="k-food" style="animation-delay:${(i * 0.15).toFixed(2)}s">
        <div class="k-fe">${e}</div><div class="k-fn">${n}</div>
        <div class="k-fw">일하는 생물: <b>${who}</b></div><div class="k-fo">${out}</div>
      </div>`).join('')}
    </div>
    <p class="gk-note">김치가 익는 건 <b>유산균</b>이 채소의 당을 먹고 <b>젖산</b>을 만들기 때문. 온도가 높을수록 빨리 익는다 — 그래서 김치는 냉장고에!</p>
    <div class="k-foot"><button class="btn" data-act="finish">결과 보기 ▶</button></div>
  </div>`;
}

const CSS = `
.k-wrap{position:relative;display:flex;flex-direction:column;height:100%;gap:12px}
.k-top{display:flex;align-items:flex-end;justify-content:space-between;gap:24px}
.k-title{font-size:32px;font-weight:800;letter-spacing:-.025em;margin:6px 0 0}
.k-state{color:var(--dim);font-size:26px}
.k-wrap.yum .k-state{color:var(--grn-t)}
.k-wrap.sour .k-state{color:#b3261e}
.k-meters{display:flex;gap:12px}
.k-therm,.k-day{display:flex;align-items:baseline;gap:6px;background:var(--card);border:1.5px solid var(--line);border-radius:14px;padding:8px 16px}
.k-therm span{font-size:30px}.k-therm b,.k-day b{font-size:44px;font-weight:800;letter-spacing:-.04em}
.k-therm small,.k-day small{font-size:16px;color:var(--dim);font-weight:700}
.k-wrap.evented .k-therm{border-color:#b3261e;background:#fdecea}
.k-gauge{position:relative;background:var(--card);border:1.5px solid var(--line);border-radius:14px;padding:16px 16px 4px;flex:1;min-height:260px}
.k-gin{position:relative;height:100%}
.k-svg{width:100%;height:100%;display:block}
.k-zone.z0{fill:#eff2e8;background:#eff2e8}.k-zone.z1{fill:#dfe6d2;background:#dfe6d2}
.k-zone.z2{fill:#b9c99f;background:#b9c99f}.k-zone.z3{fill:#f6dccd;background:#f6dccd}.k-zone.z4{fill:#eab59c;background:#eab59c}
.k-wrap.yum .k-zone.z2{animation:kglow .6s infinite alternate}
@keyframes kglow{to{fill:#9fb67f}}
.k-jar{position:absolute;top:-6px;font-size:56px;transition:left .22s linear;filter:drop-shadow(0 2px 0 #fff)}
.k-ready-big{position:absolute;inset:0;display:grid;place-items:center;font-size:150px;font-weight:800;color:var(--org-t);background:rgba(250,249,245,.75);border-radius:14px}
.k-teams{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:8px}
.k-team{background:var(--card);border:1.5px solid var(--line);border-top:8px solid var(--tf);border-radius:12px;padding:8px 10px}
.k-tn{font-size:22px;font-weight:800;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.k-dots{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}
.k-dots i{width:28px;height:28px;border-radius:50%;border:2.5px solid var(--mid-d);background:transparent}
.k-dots i.on{background:var(--tf);border-color:#141413}
.k-foot{display:flex;align-items:center;gap:12px;min-height:48px}
.k-event{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}
.k-event div{background:#b3261e;color:#fff;border-radius:20px;padding:28px 56px;text-align:center;animation:kev .35s cubic-bezier(.2,.75,.3,1)}
.k-event b{display:block;font-size:64px;letter-spacing:-.03em}.k-event span{font-size:28px;font-weight:700}
@keyframes kev{from{transform:scale(.6);opacity:0}to{transform:none;opacity:1}}
.k-shake{animation:kshake .5s 2}
@keyframes kshake{0%,100%{transform:none}20%{transform:translateX(-10px)}40%{transform:translateX(10px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}
.k-rev{flex:1;display:flex;flex-direction:column;gap:6px;min-height:0;justify-content:center;overflow:hidden}
.k-scalerow{flex:none!important;background:none!important;border:none!important;padding-top:0!important;padding-bottom:0!important}
.k-revscale{display:flex;border-radius:8px;overflow:hidden}
.k-revscale span{font-size:14px;font-weight:800;text-align:center;padding:4px 0;color:#141413}
.k-rrow{flex:1 1 0;min-height:0;max-height:60px;display:grid;grid-template-columns:60px 178px 1fr 100px 72px;gap:12px;align-items:center;background:var(--card);border:1.5px solid var(--line);
  border-left:10px solid var(--tf);border-radius:12px;padding:0 12px;overflow:hidden;animation:gk-in .35s cubic-bezier(.2,.75,.3,1) both}
.k-rk{font-size:28px;text-align:center}.k-rn{font-size:20px;font-weight:800;color:var(--tx)}
.k-track{position:relative;height:38px;background:var(--paper);border:1.5px solid var(--line);border-radius:8px}
.k-mk{position:absolute;top:1px;transform:translateX(-50%);min-width:32px;height:32px;border-radius:16px;background:var(--tf);color:#141413;
  border:2px solid #141413;font-style:normal;font-size:18px;font-weight:800;display:grid;place-items:center;padding:0 3px}
.k-peak{position:absolute;top:-4px;bottom:-4px;width:3px;background:var(--grn-t);transform:translateX(-50%)}
.k-tick{position:absolute;bottom:-4px;height:10px;width:3px;border-radius:2px;background:#141413;transform:translateX(-50%)}
.k-rv{font-size:26px;font-weight:800;text-align:right}.k-rp{font-size:20px;font-weight:800;color:var(--grn-t)}
.k-foods{flex:1;display:grid;grid-template-columns:repeat(4,1fr);gap:16px;min-height:0}
.k-food{background:var(--card);border:1.5px solid var(--line);border-radius:14px;padding:20px;display:flex;flex-direction:column;gap:8px;
  animation:gk-pop .45s cubic-bezier(.2,.75,.3,1) both}
.k-fe{font-size:72px;line-height:1}.k-fn{font-size:32px;font-weight:800;letter-spacing:-.025em}
.k-fw{font-size:19px}.k-fo{font-size:18px;color:var(--dim)}
/* 조종기 */
.k-play{display:flex;flex-direction:column;gap:14px;height:100%;justify-content:center;align-items:stretch;text-align:center}
.k-play.hot .pv-eyebrow{color:#b3261e}
.k-tip{font-size:20px;margin:0}
.k-ready{font-size:34px;font-weight:800}
.k-out{font-size:72px;font-weight:800;letter-spacing:-.03em;padding:24px;min-height:300px;border-radius:24px;border:none;
  background:var(--org);color:#141413;cursor:pointer;box-shadow:0 8px 0 #a84f2e}
.k-out:active{transform:translateY(6px);box-shadow:0 2px 0 #a84f2e}
.k-out:disabled{background:var(--line);color:var(--dim);box-shadow:none;cursor:default}
@media (prefers-reduced-motion:reduce){.k-rrow,.k-food,.k-event div,.k-shake{animation:none!important}}
`;
