// 14차시 「분야 스피드 분류」 — 생명 기술 활용 분야 세 갈래
// 기술 카드가 하나씩 떨어진다(8초). 팀원 각자 조종기에서 식품·농업 / 의료 / 환경·에너지 중 하나(한 번만).
// 카드 점수 = 팀 정답률 × 빠르기(맞힌 사람마다 0.5 + 0.5 × 남은 시간 비율) → 0~100. 12장 합계로 순위.
// 정답 공개 때 그 기술의 「일하는 생물」 한 줄. 카드는 auction-data.js 의 12장을 그대로 쓴다.
import {
  esc, keyed, text, secsLeft, timerHTML, timerUpdate, tickSound, rankPoints, confetti, injectCSS, medal, beep, flash, shuffle,
} from '../src/gamekit.js';
import { CARDS, FIELDS, fieldOf } from './auction-data.js';

export const DROP_MS = 8000;
const LEAD_MS = 700;        // 카드가 나타나고 떨어지기 시작할 때까지
const SHOW_MS = 5500;       // 정답 공개 → 다음 카드
export const FAST_MIN_MS = 1000; // 「가장 빨리 맞힌」 표시는 1초 이상 걸려 누른 답만

/** 맞힌 사람 한 명의 점수(0.5~1). dt = 떨어지기 시작한 뒤 누른 데까지 ms */
export function speedPart(dt) { return 0.5 + 0.5 * Math.max(0, Math.min(1, 1 - dt / DROP_MS)); }

function startCard(s, ctx, i) {
  const need = {};
  for (const t of ctx.teams) need[t.id] = t.online.slice();
  const now = ctx.now(), startAt = now + LEAD_MS;
  return { ...s, step: 'drop', i, inputKey: 's' + i, openAt: now, startAt, deadline: startAt + DROP_MS, need, first: {}, answered: {}, early: false };
}

// 처음 낸 답만 센다
function foldFirst(s, inputs) {
  const first = { ...(s.first || {}) };
  for (const [u, inp] of Object.entries(inputs || {})) {
    if (!inp || first[u] !== undefined) continue;
    if (!FIELDS.some(f => f.id === inp.f) || typeof inp.t !== 'number') continue;
    // 칸을 연 뒤에 낸 것만 (앞 카드 입력이 늦게 도착해도 섞이지 않게)
    if (s.openAt && inp.t < s.openAt - 2000) continue;   // 시계 오차 2초 여유
    first[u] = { f: inp.f, t: inp.t };
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

function judge(s, ctx, inputs) {
  const first = foldFirst(s, inputs);
  const c = CARDS[s.order[s.i]];
  const res = {}, total = { ...(s.total || {}) }, picks = { food: 0, med: 0, env: 0 };
  let fastest = null;
  for (const tid of Object.keys(s.need)) {
    const uids = members(s, tid, ctx, first);
    let sum = 0, ok = 0, ans = 0;
    for (const u of uids) {
      const a = first[u];
      if (!a) continue;
      ans++;
      picks[a.f] = (picks[a.f] || 0) + 1;
      if (a.f === c.field) {
        ok++;
        const dt = Math.max(0, a.t - s.startAt);
        sum += speedPart(dt);
        // 「가장 빨리 맞힌 팀」은 떨어지기 시작하고 1초 넘어서 누른 사람만(보지도 않고 찍은 답은 빼고)
        if (dt >= FAST_MIN_MS && (!fastest || dt < fastest.dt)) fastest = { tid, dt };
      }
    }
    const pts = uids.length ? Math.round(100 * sum / uids.length) : 0;
    res[tid] = { ok, of: uids.length, ans, pts };
    total[tid] = (total[tid] || 0) + pts;
  }
  const hist = [...(s.hist || []), { c: s.order[s.i], rate: sumRate(res) }];
  return { ...s, step: 'show', inputKey: null, first, ans: c.field, res, picks, fastest, total, hist, showAt: ctx.now() };
}
function sumRate(res) {
  let ok = 0, of = 0;
  for (const r of Object.values(res)) { ok += r.ok; of += r.of; }
  return of ? Math.round(ok / of * 100) : 0;
}

const game = {
  id: 'sort',
  title: '분야 스피드 분류',
  lesson: 14,
  minutes: 3,
  emoji: '🗂️',
  blurb: '떨어지는 기술 카드를 세 분야로 — 빠르고 정확하게!',
  intro: {
    headline: '분야 스피드 분류',
    lines: [
      '생명 기술 카드가 하나씩 떨어진다 ⬇️ (8초)',
      '각자 <b>🌾 식품 · 농업 / 🏥 의료 / 🌍 환경 · 에너지</b> 중 하나 — <b>한 번만!</b>',
      '팀 점수 = 맞힌 비율 × 빠르기. 12장!',
    ],
    art: `<div class="art-big">🗂️</div><div class="art-row"><span>🌾</span><span class="plus">·</span><span>🏥</span><span class="plus">·</span><span>🌍</span></div><div class="art-cap">어느 분야일까?</div>`,
  },

  setup(ctx) {
    const order = shuffle(CARDS.map((_, k) => k), ctx.rnd);
    return startCard({ order, total: {}, hist: [] }, ctx, 0);
  },

  onInput(s, inputs, ctx) {
    if (s.step !== 'drop') return s;
    const first = foldFirst(s, inputs);
    const answered = {};
    let all = true, anyNeed = false;
    for (const tid of Object.keys(s.need)) {
      const uids = members(s, tid, ctx, first);
      answered[tid] = uids.filter(u => first[u] !== undefined).length;
      if (uids.length) anyNeed = true;
      if (answered[tid] < uids.length) all = false;
    }
    let deadline = s.deadline, early = s.early;
    const now = ctx.now();
    if (anyNeed && all && deadline - now > 900) { deadline = Math.max(s.startAt, now) + 900; early = true; }
    return { ...s, first, answered, deadline, early };
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
    if (s.step === 'drop' && now >= s.deadline) return judge(s, ctx, ctx.inputs);
    if (s.step === 'show' && now >= s.showAt + SHOW_MS) return s.i + 1 < s.order.length ? startCard(s, ctx, s.i + 1) : { ...s, step: 'end' };
    return s;
  },

  action(s, name, payload, ctx) {
    if (name === 'stop' && s.step === 'drop') return judge(s, ctx, ctx.inputs);
    if (name === 'next' && s.step === 'show') return s.i + 1 < s.order.length ? startCard(s, ctx, s.i + 1) : { ...s, step: 'end' };
    if (name === 'hold' && s.step === 'show') return { ...s, showAt: s.showAt + 15000 };
    if (name === 'finish' && s.step === 'end') return { ...s, done: true };
    return s;
  },

  proxyButtons(s) {
    return s.step === 'drop' ? FIELDS.map(f => ({ label: `${f.emoji} ${f.label}`, input: { f: f.id }, once: true })) : [];
  },

  scoring(s, ctx) {
    const lines = [];
    const hard = (s.hist || []).slice().sort((a, b) => a.rate - b.rate)[0];
    if (hard) { const c = CARDS[hard.c]; lines.push(`🤔 가장 헷갈린 기술: ${c.emoji} ${esc(c.name)} — ${fieldOf(c.field).emoji} ${esc(fieldOf(c.field).label)} (맞힌 비율 ${hard.rate}%)`); }
    lines.push('🌾 식품 · 농업 / 🏥 의료 / 🌍 환경 · 에너지 — 어느 분야든 <b>살아 있는 생물</b>이 일한다');
    return { points: rankPoints(s.total || {}, true).points, lines };
  },

  record(s) {
    let best = null;
    for (const [tid, v] of Object.entries(s.total || {})) if (!best || v > best.value) best = { value: v, team: tid };
    return best ? { label: '분야 분류 최고 팀 점수', value: best.value, unit: '점', team: best.team } : null;
  },

  // ── 진행판 ──
  hostView(el, s, ctx) {
    injectCSS('sort', CSS);
    const now = ctx.now();
    if (s.step === 'drop' || s.step === 'show') {
      if (keyed(el, `card-${s.i}-${ctx.teams.length}`, hostDrop(s, ctx, now))) beep(660, 90, 'triangle', 0.1);
      updateDrop(el, s, ctx, now);
    } else if (s.step === 'end') {
      if (keyed(el, 'end', hostEnd(s, ctx))) { confetti(el, 60); beep(784, 160); }
    }
    el.querySelectorAll('[data-act]').forEach(b => { b.onclick = () => ctx.act(b.dataset.act); });
  },

  // ── 조종기 ──
  playView(el, s, me, ctx) {
    injectCSS('sort', CSS);
    const now = ctx.now();
    if (s.step === 'drop') {
      const c = CARDS[s.order[s.i]];
      // me.mine 은 앞 카드 입력이 잠깐 남아 있을 수 있어 쓰지 않는다 → 진행판 기록 + 이 카드에서 누른 것만
      const mine = (s.first && s.first[me.uid]) || (el.__picked && el.__picked.i === s.i ? el.__picked : null);
      const inNeed = (s.need[me.team] || []).includes(me.uid);
      const key = `sd-${s.i}-${mine ? mine.f : ''}-${inNeed}`;
      if (keyed(el, key, playDrop(s, c, mine, inNeed))) {
        el.querySelectorAll('[data-f]').forEach(b => b.onclick = () => {
          el.querySelectorAll('[data-f]').forEach(x => { x.disabled = true; });
          b.classList.add('on');
          el.__picked = { i: s.i, f: b.dataset.f };
          ctx.send({ f: b.dataset.f });
        });
      }
      const left = secsLeft(s.deadline, now);
      text(el, '.sp-left', left);
      el.querySelector('.sp-time')?.classList.toggle('hot', left <= 3);
    } else if (s.step === 'show') {
      const c = CARDS[s.order[s.i]], f = fieldOf(c.field);
      const a = s.first && s.first[me.uid];
      const ok = a && a.f === c.field;
      const r = (s.res || {})[me.team];
      keyed(el, `ss-${s.i}`, `
        <div class="pv-center">
          <div class="pv-eyebrow">카드 ${s.i + 1}/${s.order.length} · 정답</div>
          <div class="pv-huge">${!a ? '⏰' : ok ? '⭕' : '❌'}</div>
          <div class="pv-big">${!a ? '이번엔 못 골랐어요' : ok ? `맞았어요! ⚡ ${((a.t - s.startAt) / 1000).toFixed(1)}초` : '아쉬워요!'}</div>
          <p class="pv-sub">${c.emoji} <b>${esc(c.name)}</b> = ${f.emoji} <b>${esc(f.label)}</b></p>
          <p class="pv-q">🧬 일하는 생물: ${esc(c.worker)}</p>
          ${r ? `<p class="pv-sub dim">우리 팀 ${r.ok}/${r.of}명 맞힘 · +${r.pts}점</p>` : ''}
        </div>`);
    } else {
      const { rank } = rankPoints(s.total || {}, true);
      keyed(el, 'se', `<div class="pv-center"><div class="pv-eyebrow">분야 스피드 분류 끝</div>
        <div class="pv-huge">${rank[me.team] ? medal(rank[me.team]) : '🗂️'}</div>
        <div class="pv-big num">우리 팀 ${(s.total || {})[me.team] || 0}점</div>
        <p class="pv-sub">🌾 식품 · 농업 / 🏥 의료 / 🌍 환경 · 에너지</p></div>`);
    }
  },
};
export default game;

function hostDrop(s, ctx, now) {
  const c = CARDS[s.order[s.i]];
  const delay = ((s.startAt - now) / 1000).toFixed(2);   // 늦게 그려도 같은 자리에서
  return `
  <div class="so-wrap">
    <div class="so-top">
      <div>
        <div class="eyebrow">분야 스피드 분류 · 카드 ${s.i + 1}/${s.order.length}</div>
        <h1 class="so-title">이 기술은 어느 분야? <span class="so-state"></span></h1>
      </div>
      ${timerHTML('남은 시간')}
    </div>
    <div class="so-sky">
      <div class="so-card" style="animation-delay:${delay}s;animation-duration:${DROP_MS / 1000}s">
        <span class="so-ce">${c.emoji}</span>
        <div><b class="so-cn">${esc(c.name)}</b><span class="so-cl">${esc(c.line)}</span></div>
      </div>
      <div class="so-worker" aria-live="polite"></div>
    </div>
    <div class="so-bins">
      ${FIELDS.map(f => `<div class="so-bin" data-f="${f.id}"><span class="so-be">${f.emoji}</span><b>${esc(f.label)}</b><span class="so-bc num"></span></div>`).join('')}
    </div>
    <div class="so-teams" style="--n:${ctx.teams.length}">
      ${ctx.teams.map(t => `
      <div class="so-team" data-tid="${t.id}" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}">
        <span class="so-tn">${t.emoji} ${esc(t.name)}</span>
        <span class="so-tr"></span>
      </div>`).join('')}
    </div>
    <div class="so-foot"></div>
  </div>`;
}

function updateDrop(el, s, ctx, now) {
  const wrap = el.querySelector('.so-wrap');
  if (!wrap) return;
  const show = s.step === 'show';
  wrap.classList.toggle('is-show', show);
  const secs = show ? 0 : (now < s.startAt ? DROP_MS / 1000 : secsLeft(s.deadline, now));
  timerUpdate(el, secs);
  if (!show) tickSound(el, secs);
  text(el, '.so-state', show ? '' : now < s.startAt ? '— 준비…' : s.early ? '— 모두 골랐다!' : '');
  for (const t of ctx.teams) {
    const box = el.querySelector(`.so-team[data-tid="${t.id}"]`);
    if (!box) continue;
    if (show) {
      const r = s.res[t.id] || { ok: 0, of: 0, pts: 0 };
      text(box, '.so-tr', `${r.ok}/${r.of} ✓ +${r.pts}`);
      box.classList.toggle('fast', !!s.fastest && s.fastest.tid === t.id);
    } else {
      const n = (s.answered || {})[t.id] || 0, of = members(s, t.id, ctx, s.first || {}).length;
      text(box, '.so-tr', `${'●'.repeat(n)}${'○'.repeat(Math.max(0, of - n))}`);
      box.classList.toggle('ready', of > 0 && n >= of);
    }
  }
  if (show && el.__shown !== s.i) {
    el.__shown = s.i;
    const c = CARDS[s.order[s.i]];
    wrap.classList.add('land-' + c.field);
    el.querySelectorAll('.so-bin').forEach(b => {
      b.classList.toggle('right', b.dataset.f === c.field);
      text(b, '.so-bc', `${(s.picks || {})[b.dataset.f] || 0}명`);
    });
    el.querySelector('.so-worker').innerHTML = `<div><span class="so-wl">🧬 일하는 생물</span><b>${esc(c.worker)}</b></div>`;
    const rate = s.hist[s.hist.length - 1].rate;
    beep(rate >= 50 ? 988 : 330, 200, 'triangle', 0.14);
    if (rate >= 80) confetti(el, 30);
    flash(el.querySelector(`.so-bin[data-f="${c.field}"]`), 'so-pop', 600);
  }
  const last = s.i + 1 >= s.order.length;
  keyed(el.querySelector('.so-foot'), s.step, show
    ? `<button class="btn" data-act="next">${last ? '결과 보기 ▶' : '다음 카드 ▶'}</button><button class="btn ghost" data-act="hold">⏸ 15초 더 보기</button>
       <span class="gk-hint">${s.fastest ? `⚡ 가장 빨리 맞힌 팀: ${(t => t ? t.emoji + ' ' + esc(t.name) : '')(ctx.teams.find(t => t.id === s.fastest.tid))} ${(s.fastest.dt / 1000).toFixed(1)}초` : '잠시 뒤 다음 카드'}</span>`
    : `<button class="btn ghost" data-act="stop">여기서 마감</button><span class="gk-hint">한 사람에 한 번 · ● = 고른 사람</span>`);
}

function hostEnd(s, ctx) {
  const { rank, points } = rankPoints(s.total || {}, true);
  const rows = ctx.teams.slice().sort((a, b) => rank[a.id] - rank[b.id]);
  const max = Math.max(1, ...Object.values(s.total || {}));
  const hard = (s.hist || []).slice().sort((a, b) => a.rate - b.rate).slice(0, 3);
  return `
  <div class="so-wrap">
    <div class="so-top"><div>
      <div class="eyebrow">분야 스피드 분류 · 결과</div>
      <h1 class="so-title">${rows[0] ? `${medal(1)} ${rows[0].emoji} ${esc(rows[0].name)} — ${s.total[rows[0].id] || 0}점!` : '결과'}</h1>
    </div></div>
    <div class="so-end">
      <div class="so-rank">
        ${rows.map((t, k) => `
        <div class="so-rr" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text};animation-delay:${(k * 0.06).toFixed(2)}s">
          <span class="so-rk">${medal(rank[t.id])}</span><span class="so-rn">${t.emoji} ${esc(t.name)}</span>
          <span class="so-bar"><i style="width:${((s.total[t.id] || 0) / max * 100).toFixed(1)}%"></i></span>
          <b class="num">${s.total[t.id] || 0}</b><span class="so-rp num">+${points[t.id]}</span>
        </div>`).join('')}
      </div>
      <div class="so-hard">
        <div class="so-hl">🤔 우리 반이 헷갈린 기술</div>
        ${hard.map(h => { const c = CARDS[h.c], f = fieldOf(c.field); return `<div class="so-hc"><span>${c.emoji}</span><div><b>${esc(c.name)}</b><small>정답 ${f.emoji} ${esc(f.label)} · 맞힌 비율 ${h.rate}%</small></div></div>`; }).join('')}
      </div>
    </div>
    <p class="gk-note">생명 기술은 <b>🌾 식품 · 농업 / 🏥 의료 / 🌍 환경 · 에너지</b>에서 쓰인다. 어느 분야든 <b>살아 있는 생물(또는 생물의 일부)</b>이 일한다.</p>
    <div class="so-foot"><button class="btn big" data-act="finish">결과 보기 ▶</button></div>
  </div>`;
}

function playDrop(s, c, mine, inNeed) {
  if (!inNeed) return `<div class="pv-center"><div class="pv-big">이번 카드는 구경!</div><p class="pv-sub">다음 카드부터 함께해요</p></div>`;
  if (mine) {
    const f = fieldOf(mine.f);
    return `<div class="pv-center"><div class="pv-eyebrow">카드 ${s.i + 1}/${s.order.length}</div><div class="pv-huge">${f.emoji}</div>
      <div class="pv-big">✓ ${esc(f.label)} 골랐어요</div><p class="pv-sub">정답은 화면에서!</p></div>`;
  }
  return `
  <div class="sp">
    <div class="sp-head"><span class="pv-eyebrow">카드 ${s.i + 1}/${s.order.length} · 한 번만!</span><span class="sp-time"><b class="sp-left num">--</b>초</span></div>
    <div class="sp-card"><span class="sp-e">${c.emoji}</span><b class="sp-n">${esc(c.name)}</b></div>
    <div class="sp-btns">
      ${FIELDS.map(f => `<button class="sp-b" data-f="${f.id}"><span class="sp-be">${f.emoji}</span><b>${esc(f.label)}</b></button>`).join('')}
    </div>
  </div>`;
}

const CSS = `
.so-wrap{position:relative;display:flex;flex-direction:column;height:100%;gap:10px}
.so-top{display:flex;align-items:flex-end;justify-content:space-between;gap:24px}
.so-title{font-size:32px;font-weight:800;letter-spacing:-.025em;line-height:1.25;margin:6px 0 0}
.so-state{font-size:24px;color:var(--grn-t)}
.so-sky{position:relative;flex:1;min-height:0;container-type:size;background:var(--card);border:1.5px solid var(--line);border-radius:var(--r-l);overflow:hidden;
  background-image:linear-gradient(var(--rule) 1px,transparent 1px);background-size:100% 48px}
.so-card{position:absolute;left:50%;top:0;width:min(760px,80%);display:flex;align-items:center;gap:20px;background:var(--card);border:3px solid #141413;border-radius:20px;
  padding:14px 26px;box-shadow:0 10px 0 rgba(20,20,19,.12);transform:translate(-50%,-110%);animation-name:so-fall;animation-timing-function:linear;animation-fill-mode:both}
@keyframes so-fall{0%{top:0;transform:translate(-50%,-110%)}8%{top:0;transform:translate(-50%,6%)}100%{top:100%;transform:translate(-50%,-104%)}}
.so-wrap.is-show .so-card{animation:none;top:8px;transform:translate(-50%,0);transition:none}
.so-ce{font-size:72px;line-height:1}
.so-cn{display:block;font-size:42px;letter-spacing:-.035em;line-height:1.15}
.so-cl{display:block;font-size:19px;color:var(--dim);font-weight:700;line-height:1.4;margin-top:2px}
.so-worker{position:absolute;left:0;right:0;bottom:12px;display:flex;justify-content:center;pointer-events:none}
.so-worker div{background:var(--grn-w);border:2px solid var(--grn);border-radius:16px;padding:10px 22px;max-width:92%;text-align:center;animation:gk-pop .4s both}
.so-wl{display:block;font-size:16px;font-weight:800;color:var(--grn-t)}
.so-worker b{font-size:26px;letter-spacing:-.02em;line-height:1.35}
.so-bins{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.so-bin{display:flex;align-items:center;justify-content:center;gap:12px;height:86px;background:var(--paper);border:2.5px dashed var(--mid-d);border-radius:var(--r-l)}
.so-be{font-size:44px;line-height:1}.so-bin b{font-size:28px;letter-spacing:-.025em}
.so-bc{font-size:20px;font-weight:800;color:var(--dim)}
.so-wrap.is-show .so-bin{opacity:.45}
.so-wrap.is-show .so-bin.right{opacity:1;border:3px solid var(--grn);background:var(--grn-w)}
.so-wrap.is-show .so-bin.right b::after{content:' ✓';color:var(--grn-t)}
.so-pop{animation:so-pop .5s cubic-bezier(.2,.75,.3,1)}
@keyframes so-pop{0%{transform:scale(1.12)}100%{transform:none}}
.so-teams{display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));gap:8px}
.so-team{display:flex;flex-direction:column;background:var(--card);border:1.5px solid var(--line);border-top:7px solid var(--tf);border-radius:12px;padding:6px 10px;min-width:0}
.so-team.ready{background:var(--tt)}
.so-team.fast{box-shadow:0 0 0 3px var(--tf)}
.so-team.fast .so-tn::after{content:' ⚡'}
.so-tn{font-size:16px;font-weight:800;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.so-tr{font-size:20px;font-weight:800;letter-spacing:.02em;white-space:nowrap;overflow:hidden}
.so-foot{display:flex;align-items:center;gap:12px;min-height:48px}
.so-end{flex:1;display:grid;grid-template-columns:minmax(0,1fr) 400px;grid-template-rows:minmax(0,1fr);gap:16px;min-height:0}
.so-rank{display:flex;flex-direction:column;gap:6px;justify-content:center;min-height:0;overflow:hidden}
.so-rr{flex:1 1 0;min-height:0;max-height:60px;display:grid;grid-template-columns:56px 160px 1fr 80px 56px;gap:12px;align-items:center;background:var(--card);border:1.5px solid var(--line);border-left:10px solid var(--tf);border-radius:12px;padding:0 12px;animation:gk-in .35s cubic-bezier(.2,.75,.3,1) both}
.so-rk{font-size:28px;text-align:center}.so-rn{font-size:20px;font-weight:800;color:var(--tx)}
.so-rr b{font-size:26px;text-align:right}.so-rp{font-size:20px;font-weight:800;color:var(--grn-t)}
.so-bar{height:22px;background:var(--line);border-radius:6px;overflow:hidden}
.so-bar i{display:block;height:100%;background:var(--tf);border-radius:6px}
.so-hard{background:var(--card);border:1.5px solid var(--line);border-radius:var(--r-l);padding:16px;display:flex;flex-direction:column;gap:12px;justify-content:center}
.so-hl{font-size:20px;font-weight:800}
.so-hc{display:flex;align-items:center;gap:12px}.so-hc>span{font-size:44px;line-height:1}
.so-hc b{display:block;font-size:22px;letter-spacing:-.02em}.so-hc small{font-size:16px;color:var(--dim);font-weight:700}
/* 조종기 */
.sp{display:flex;flex-direction:column;gap:16px;height:100%;justify-content:center;max-width:1100px;width:100%;margin:0 auto}
.sp-head{display:flex;justify-content:space-between;align-items:center}
.sp-time{font-size:24px;font-weight:800}
.sp-time.hot{color:var(--bad);animation:gkpulse .5s infinite alternate}
.sp-card{display:flex;align-items:center;justify-content:center;gap:18px;background:var(--card);border:3px solid #141413;border-radius:20px;padding:14px}
.sp-e{font-size:64px;line-height:1}.sp-n{font-size:40px;letter-spacing:-.035em}
.sp-btns{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.sp-b{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:230px;border-radius:22px;background:var(--card);border:3px solid var(--line);cursor:pointer;color:var(--ink)}
.sp-b:hover{border-color:var(--mid-d)}
.sp-be{font-size:72px;line-height:1}.sp-b b{font-size:30px;letter-spacing:-.025em}
.sp-b.on{border-color:var(--org);background:var(--org-w);box-shadow:0 0 0 3px var(--org)}
.sp-b:disabled{cursor:default}
@container (max-height:220px){.so-card{padding:6px 16px;gap:12px;border-width:2px}.so-ce{font-size:40px}.so-cn{font-size:28px}.so-cl{display:none}
  .so-worker{bottom:6px}.so-worker div{padding:4px 14px}.so-wl{display:none}.so-worker b{font-size:19px}}
@media (prefers-reduced-motion:reduce){.so-card{animation-duration:0s!important;top:8px;transform:translate(-50%,0)}.so-rr,.so-worker div,.so-pop{animation:none!important}}
`;
