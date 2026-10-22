// 14차시 「바이오 경매」 — 활용 분야 · 발달 전망
// 팀 코인 1,000으로 생명 기술 카드 12장을 경매한다(카드 순서는 방마다 섞음 · 15초 · +50 · +100 · +200 · 같은 값이면 먼저 낸 팀).
// 카드 하나에 한 팀은 400까지만(BID_CAP). 마감 3초 안에 입찰이 오면 마감이 3초 늘어난다(카드마다 최대 +6초).
// 최고가가 400에 닿으면 더 올릴 팀이 없으니 1.5초 뒤 바로 낙찰(CAP_CLOSE_MS) — 막판 연장도 다시 늘리지 않는다.
// 다 끝나면 「2040 결과 카드」를 한 장씩 열어 배수(×0.5~×3)를 공개 → 팀 최종 자산 = 남은 코인 + Σ(카드 기본값 × 배수).
// 2040 가치는 낙찰가가 아니라 기본값으로 정한다 → 비싸게 산 팀은 손해 · 싸게 산 팀은 대박(「400 주고 산 게 100!」).
// 카드 · 기본값 · 배수 · 까닭은 auction-data.js (교사가 고칠 수 있게). 배수는 공개할 때만 state 에 넣는다.
import {
  esc, keyed, text, secsLeft, timerHTML, timerUpdate, tickSound, rankPoints, confetti, injectCSS, medal, beep, flash,
  shuffle, mulberry32,
} from '../src/gamekit.js';
import {
  CARDS, START_COINS, BID_STEPS, BID_SECONDS, BID_CAP, SNIPE_MS, SNIPE_MAX_MS, trendOf, fieldOf, baseOf,
} from './auction-data.js';

const SOLD_MS = 4500;
export const CAP_CLOSE_MS = 1500;  // 최고가가 한도(400)에 닿으면 이만큼 뒤 낙찰 (같은 400 이 늦게 도착할 여유)          // 낙찰 화면 → 다음 카드
const REVEAL_MS = 6500;        // 2040 카드 한 장씩 (낙찰된 카드) — 「다음 카드 ▶」로 바로 넘길 수 있다
const REVEAL_UNSOLD_MS = 3500; //                      (유찰 카드)
const fmt = n => Math.round(n).toLocaleString('ko-KR');
/** 2040 가치 = 카드 기본값 × 배수 (낙찰가와 상관없다) */
export const valueOf = (ci, x) => Math.round(baseOf(CARDS[ci]) * x);
const hashStr = str => { let h = 2166136261; for (const ch of String(str)) h = Math.imul(h ^ ch.codePointAt(0), 16777619); return h >>> 0; };

// ── 판정 (진행판) ─────────────────────────────────────────────────
function teamOfMap(ctx) {
  const m = {};
  for (const t of ctx.teams) for (const u of t.members) m[u] = t.id;
  for (const t of ctx.teams) m['proxy-' + t.id] = t.id;
  return m;
}

/** 새 입찰이 지금 최고가보다 나은가 — 더 높거나, 같은 값인데 먼저 낸 다른 팀 */
export function better(c, hi) {
  if (!hi) return true;
  if (c.bid > hi.bid) return true;
  return c.bid === hi.bid && c.t < hi.t && c.team !== hi.team;
}

/** 이 팀이 이 카드에 부를 수 있는 최고값: 남은 코인과 카드당 상한(400) 중 작은 쪽 */
export const maxBid = coins => Math.min(coins ?? 0, BID_CAP);

/** 입력 모음 → 새 최고가 (없으면 그대로). 같은 입력을 여러 번 받아도 결과가 같다 */
export function foldBids(hi, inputs, teamOf, coins, deadline, numOf = () => 0, openAt = 0) {
  const cands = [];
  for (const [u, inp] of Object.entries(inputs || {})) {
    if (!inp) continue;
    const bid = Number(inp.bid), t = Number(inp.t), team = teamOf[u];
    if (!team || !Number.isFinite(bid) || !Number.isFinite(t)) continue;
    if (bid < BID_STEPS[0] || bid % 50 !== 0 || bid > maxBid(coins[team])) continue;
    if (deadline && t > deadline + 500) continue;
    if (openAt && t < openAt - 2000) continue;     // 앞 카드 입력이 늦게 도착해도 섞이지 않게(시계 오차 2초 여유)
    cands.push({ bid, t, team, by: numOf(u) });
  }
  cands.sort((a, b) => a.t - b.t);
  let cur = hi, n = hi ? hi.n : 0;
  for (const c of cands) if (better(c, cur)) { n += 1; cur = { ...c, n }; }
  return cur;
}

/** 막판 입찰 연장: 마감 3초 안(서버 시각 bidT)에 들어온 입찰이면 마감 = bidT + 3초. 처음 마감(dl0) + 6초는 넘지 않는다 */
export function snipeExtend(deadline, dl0, bidT) {
  if (!Number.isFinite(bidT) || bidT < deadline - SNIPE_MS) return deadline;
  return Math.max(deadline, Math.min(dl0 + SNIPE_MAX_MS, bidT + SNIPE_MS));
}

/** 한도 도달: 최고가가 BID_CAP 이면 마감을 now + 1.5초로 당긴다(이미 더 이르면 그대로). 막판 연장은 그 뒤로 미루지 못한다 */
export function capClose(deadline, hi, now) {
  if (!hi || hi.bid < BID_CAP) return deadline;
  return Math.min(deadline, now + CAP_CLOSE_MS);
}

/** 팀 자산: 남은 코인 + 공개된 기술의 2040 가치(기본값 × 배수). 아직 안 연 카드는 0 */
export function assetsOf(s, teamIds) {
  const a = {}, tech = {};
  for (const tid of teamIds) { a[tid] = s.coins[tid] ?? START_COINS; tech[tid] = 0; }
  (s.hist || []).forEach((h, k) => {
    if (!h.team || a[h.team] === undefined) return;
    const f = (s.fut || [])[k];
    if (!f) return;
    const v = valueOf(h.c, f.x);
    a[h.team] += v; tech[h.team] += v;
  });
  return { a, tech };
}

/** 공개 한 줄: 「400 주고 산 게 100!」 · 「100에 산 게 600!」 */
export function twistOf(h, x) {
  const v = valueOf(h.c, x);
  if (!h.team) {
    if (x >= 2) return { cls: 'miss', icon: '😮', line: `아무도 안 산 게 ${fmt(v)}짜리!` };
    if (x < 1) return { cls: 'none', icon: '😌', line: `안 사길 잘했다 — ${fmt(v)}` };
    return { cls: 'none', icon: '🤷', line: `아무도 안 샀다 · 가치 ${fmt(v)}` };
  }
  if (v > h.paid) return { cls: 'gain', icon: v >= h.paid * 2 ? '🤑' : '😊', line: `${fmt(h.paid)}에 산 게 ${fmt(v)}!` };
  if (v < h.paid) return { cls: 'loss', icon: '😱', line: `${fmt(h.paid)} 주고 산 게 ${fmt(v)}!` };
  return { cls: 'even', icon: '😐', line: `${fmt(h.paid)}에 사서 ${fmt(v)} — 본전!` };
}

function openCard(s, ctx) {
  const now = ctx.now();
  const dl = now + BID_SECONDS * 1000;
  return { ...s, step: 'bid', inputKey: 'b' + s.i, hi: null, openAt: now, deadline: dl, dl0: dl, ext: 0, capped: false };
}

function sell(s, ctx) {
  const c = s.order[s.i];
  const coins = { ...s.coins };
  let row = { c, team: null, paid: 0 };
  if (s.hi && s.hi.team && coins[s.hi.team] >= s.hi.bid) { coins[s.hi.team] -= s.hi.bid; row = { c, team: s.hi.team, paid: s.hi.bid }; }
  return { ...s, step: 'sold', inputKey: null, coins, hist: [...s.hist, row], soldAt: ctx.now(), deadline: null };
}

function nextCard(s, ctx) {
  if (s.i + 1 < s.order.length) return { ...s, step: 'look', i: s.i + 1, hi: null, ext: 0, capped: false };
  return startFuture(s, ctx);
}

function startFuture(s, ctx) {
  return { ...s, step: 'fut', inputKey: null, hi: null, fut: [], rvAt: ctx.now() + 2000 };
}

function revealOne(s, ctx) {
  const k = s.fut.length;
  const h = s.hist[k];
  const f = CARDS[h.c].future;
  return { ...s, fut: [...s.fut, { x: f.x }], rvAt: ctx.now() + (h.team ? REVEAL_MS : REVEAL_UNSOLD_MS) };
}

function revealAll(s) {
  return { ...s, fut: s.hist.map(h => ({ x: CARDS[h.c].future.x })), rvAt: null };
}

function finalize(s, ctx) {
  const s2 = s.fut.length < s.hist.length ? revealAll(s) : s;
  const ids = ctx.teams.map(t => t.id);
  const { a, tech } = assetsOf(s2, ids);
  const { points, rank } = rankPoints(a, true);
  return { ...s2, step: 'final', assets: a, tech, rank, pts: points };
}

// 가장 남는 장사 · 가장 아까운 낙찰 · 가장 비싼 낙찰
function highlights(s) {
  let gain = null, loss = null, top = null;
  (s.hist || []).forEach((h, k) => {
    if (!h.team) return;
    const f = (s.fut || [])[k];
    if (f) {
      const v = valueOf(h.c, f.x), g = v - h.paid;
      if (!gain || g > gain.g) gain = { ...h, g, v, x: f.x };
      if (!loss || g < loss.g) loss = { ...h, g, v, x: f.x };
    }
    if (!top || h.paid > top.paid) top = h;
  });
  return { gain, loss, top };
}

const game = {
  id: 'auction',
  title: '바이오 경매',
  lesson: 14,
  minutes: 12,
  emoji: '🔨',
  blurb: '코인 1,000으로 생명 기술을 사고 2040년 가치를 확인!',
  intro: {
    headline: '바이오 경매',
    lines: [
      '팀 코인 <b>1,000</b> 🪙 · 생명 기술 카드 <b>12장</b> (순서는 방마다 섞여요)',
      `카드마다 ${BID_SECONDS}초 — 팀원 누구나 <b>+50 · +100 · +200</b> · 카드 하나에 <b>${BID_CAP}까지</b> · 막판 입찰은 +3초!`,
      '<b>2040 가치 = 카드 기본값 × 배수</b> — 낙찰가가 아니에요. 비싸게 사면 손해!',
    ],
    art: `<div class="art-row"><span>🌿</span><span>💉</span><span>🌊</span></div><div class="art-big">🔨</div><div class="art-cap">🪙 1,000 → 2040년엔 얼마?</div>`,
  },

  setup(ctx) {
    const coins = {};
    for (const t of ctx.teams) coins[t.id] = START_COINS;
    const seed = (hashStr(`${ctx.cls || ''}|${ctx.now()}`) ^ Math.floor(ctx.rnd() * 4294967296)) >>> 0;
    const order = shuffle(CARDS.map((_, k) => k), mulberry32(seed));
    return { step: 'look', i: 0, order, coins, hist: [], fut: [], hi: null, inputKey: null, deadline: null, ext: 0 };
  },

  onInput(s, inputs, ctx) {
    if (s.step !== 'bid') return s;
    const hi = foldBids(s.hi, inputs, teamOfMap(ctx), s.coins, s.deadline, ctx.numOf, s.openAt);
    if (hi === s.hi) return s;
    const dl0 = s.dl0 || s.deadline;
    if (s.capped) return { ...s, hi };   // 이미 한도 도달 — 마감은 그대로(같은 400 을 먼저 낸 팀이 늦게 도착하면 최고가만 바뀐다)
    if (hi.bid >= BID_CAP) return { ...s, hi, deadline: capClose(s.deadline, hi, ctx.now()), capped: true };
    const deadline = snipeExtend(s.deadline, dl0, hi.t);
    return { ...s, hi, deadline, ext: deadline - dl0 };
  },

  tick(s, ctx) {
    const now = ctx.now();
    if (s.step === 'bid' && now >= s.deadline) return sell(s, ctx);
    if (s.step === 'sold' && now >= s.soldAt + SOLD_MS) return nextCard(s, ctx);
    if (s.step === 'fut' && s.rvAt && now >= s.rvAt) {
      if (s.fut.length < s.hist.length) return revealOne(s, ctx);
      return { ...s, rvAt: null };
    }
    return s;
  },

  action(s, name, payload, ctx) {
    if (name === 'open' && s.step === 'look') return openCard(s, ctx);
    if (name === 'more' && s.step === 'bid') return { ...s, deadline: s.deadline + 5000, dl0: (s.dl0 || s.deadline) + 5000 };
    if (name === 'hammer' && s.step === 'bid') return sell(s, ctx);
    if (name === 'next' && s.step === 'sold') return nextCard(s, ctx);
    if (name === 'skipall' && s.step === 'look') return startFuture(s, ctx);
    if (name === 'rv' && s.step === 'fut' && s.fut.length < s.hist.length) return revealOne(s, ctx);
    if (name === 'all' && s.step === 'fut') return revealAll(s);
    if (name === 'final' && s.step === 'fut') return finalize(s, ctx);
    if (name === 'finish' && s.step === 'final') return { ...s, done: true };
    return s;
  },

  proxyButtons(s, team) {
    if (s.step !== 'bid') return [];
    const price = s.hi ? s.hi.bid : 0;
    const most = maxBid(s.coins[team.id] ?? 0);
    if (s.hi && s.hi.team === team.id) return [];
    return BID_STEPS.filter(d => price + d <= most).map(d => ({ label: `+${d} → ${price + d}`, input: { bid: price + d } }));
  },

  scoring(s, ctx) {
    const f = s.step === 'final' ? s : finalize(s, ctx);
    const { gain, loss, top } = highlights(f);
    const lines = [];
    const tn = tid => { const t = ctx.teams.find(x => x.id === tid); return t ? `${t.emoji} ${esc(t.name)}` : ''; };
    if (gain && gain.g > 0) lines.push(`🤑 가장 남는 장사: ${tn(gain.team)} — ${CARDS[gain.c].emoji} ${esc(CARDS[gain.c].name)} ${fmt(gain.paid)}에 사서 ${fmt(gain.v)} (×${gain.x})`);
    if (loss && loss.g < 0) lines.push(`😱 가장 아까운 낙찰: ${tn(loss.team)} — ${CARDS[loss.c].emoji} ${esc(CARDS[loss.c].name)} ${fmt(loss.paid)} 주고 ${fmt(loss.v)} (×${loss.x})`);
    if (!lines.length && top) lines.push(`🔨 최고 낙찰가: ${CARDS[top.c].emoji} ${esc(CARDS[top.c].name)} ${fmt(top.paid)}코인`);
    lines.push('📈 2040 가치 = 기본값 × 배수(<b>예상</b>) — 낙찰가가 아니다. 기술마다 좋은 점과 걱정되는 점을 함께 따져 보자');
    return { points: f.pts || {}, lines };
  },

  record(s) {
    const { top } = highlights(s);
    return top ? { label: '최고 낙찰가', value: top.paid, unit: '코인', team: top.team } : null;
  },

  // ── 진행판 그리기 ──
  hostView(el, s, ctx) {
    injectCSS('auction', CSS);
    const now = ctx.now();
    if (s.step === 'look' || s.step === 'bid' || s.step === 'sold') {
      keyed(el, `card-${s.i}-${ctx.teams.length}`, hostCard(s, ctx));
      updateCard(el, s, ctx, now);
    } else if (s.step === 'fut') {
      if (keyed(el, `fut-${ctx.teams.length}`, hostFuture(s, ctx))) el.__rv = 0;
      updateFuture(el, s, ctx);
    } else if (s.step === 'final') {
      if (keyed(el, 'final', hostFinal(s, ctx))) { confetti(el, 70); beep(784, 150); setTimeout(() => beep(1046, 300, 'triangle'), 170); }
    }
    el.querySelectorAll('[data-act]').forEach(b => { b.onclick = () => ctx.act(b.dataset.act); });
  },

  // ── 조종기 그리기 ──
  playView(el, s, me, ctx) {
    injectCSS('auction', CSS);
    const now = ctx.now();
    const coins = (s.coins || {})[me.team] ?? START_COINS;
    if (s.step === 'look' || s.step === 'bid') {
      const c = CARDS[s.order[s.i]];
      const hi = s.hi;
      const price = hi ? hi.bid : 0;
      const lead = hi && hi.team === me.team;
      const key = `pb-${s.i}-${s.step}-${price}-${hi ? hi.team : ''}-${coins}`;
      if (keyed(el, key, playBid(s, c, hi, price, lead, coins, ctx))) {
        el.__sent = 0;
        el.querySelectorAll('[data-d]').forEach(b => b.onclick = () => {
          const d = Number(b.dataset.d);
          ctx.send({ bid: price + d });
          el.__sent = Date.now();
          el.querySelectorAll('[data-d]').forEach(x => { x.disabled = true; });
          text(el, '.aup-me', `⏳ ${fmt(price + d)} 보내는 중…`);
        });
      }
      // 진행판이 받아 주지 않았으면(다른 팀이 같은 값을 먼저 냄) 잠깐 뒤 다시 누를 수 있게
      if (el.__sent && Date.now() - el.__sent > 1500) {
        el.__sent = 0;
        el.querySelectorAll('[data-d][data-ok]').forEach(x => { x.disabled = false; });
        text(el, '.aup-me', '같은 값을 다른 팀이 먼저 냈어요 — 다시 눌러요');
      }
      if (s.step === 'bid') {
        const left = secsLeft(s.deadline, now);
        text(el, '.aup-left', left);
        el.querySelector('.aup-time')?.classList.toggle('hot', left <= 3 && !s.capped);
        text(el, '.aup-ext', s.capped ? `🔒 한도 ${fmt(BID_CAP)} — 곧 낙찰` : s.ext > 0 ? `⏱ 막판 입찰 · +${Math.round(s.ext / 1000)}초` : '');
      }
    } else if (s.step === 'sold') {
      const h = s.hist[s.hist.length - 1];
      const c = CARDS[h.c];
      const T = h.team && ctx.teams[h.team];
      const mine = h.team === me.team;
      keyed(el, `ps-${s.i}`, `
        <div class="pv-center">
          <div class="pv-eyebrow">카드 ${s.i + 1}/${s.order.length} · ${h.team ? '낙찰' : '유찰'}</div>
          <div class="pv-huge">${mine ? '🎉' : h.team ? '🔨' : '💨'}</div>
          <div class="pv-big">${c.emoji} ${esc(c.name)}</div>
          <p class="pv-sub">${T ? `${T.emoji} ${esc(T.name)} · <b class="num">${fmt(h.paid)}</b>코인에 낙찰` : '아무도 사지 않았어요'}</p>
          <p class="pv-q">${mine ? `우리 팀이 샀어요! 남은 코인 ${fmt(coins)}` : `우리 팀 남은 코인 🪙 ${fmt(coins)}`}</p>
          ${h.team ? `<p class="pv-sub dim">2040 가치 = 기본값 ${fmt(baseOf(c))} × ? — 끝나고 공개!</p>` : ''}
        </div>`);
    } else if (s.step === 'fut') {
      keyed(el, `pf-${s.fut.length}`, playFuture(s, me, ctx));
    } else if (s.step === 'final') {
      const r = s.rank[me.team];
      keyed(el, 'pfin', `
        <div class="pv-center">
          <div class="pv-eyebrow">최종 자산 순위</div>
          <div class="pv-huge">${r ? medal(r) : '🪙'}</div>
          <div class="pv-big num">우리 팀 ${fmt(s.assets[me.team] || 0)}코인</div>
          <p class="pv-sub">남은 코인 ${fmt(s.coins[me.team] || 0)} + 기술 가치 ${fmt(s.tech[me.team] || 0)}</p>
          <p class="pv-sub dim">2040 배수는 예상일 뿐! 우리 팀이 산 기술의 걱정되는 점도 생각해 봐요</p>
        </div>`);
    }
  },
};
export default game;

// ── 진행판: 카드 · 입찰 ──
function sysBoxes(c, big = false) {
  const rows = [['투입', '📥', c.sys.in], ['과정', '⚙️', c.sys.proc], ['산출', '📦', c.sys.out], ['되먹임', '🔁', c.sys.fb]];
  return `<div class="au-sys ${big ? 'big' : ''}">${rows.map(([h, e, v], k) => `
    <div class="au-sb"><b>${e} ${h}</b><span>${esc(v)}</span></div>${k < 3 ? '<i class="au-ar" aria-hidden="true">→</i>' : ''}`).join('')}</div>`;
}

function hostCard(s, ctx) {
  const c = CARDS[s.order[s.i]];
  const f = fieldOf(c.field);
  return `
  <div class="au-wrap">
    <div class="au-top">
      <div>
        <div class="eyebrow">바이오 경매 · 카드 ${s.i + 1}/${s.order.length}</div>
        <h1 class="au-title"></h1>
      </div>
      <div class="au-tm">${timerHTML('입찰')}</div>
    </div>
    <div class="au-main">
      <div class="au-card">
        <div class="au-ch">
          <span class="au-emo" aria-hidden="true">${c.emoji}</span>
          <div>
            <span class="au-field">${f.emoji} ${esc(f.label)}</span>
            <h2 class="au-name">${esc(c.name)}</h2>
          </div>
        </div>
        <p class="au-line">${esc(c.line)}</p>
        ${sysBoxes(c)}
      </div>
      <div class="au-side">
        <div class="au-lbl">지금 최고가</div>
        <div class="au-price num">—</div>
        <div class="au-lead"></div>
        <div class="au-cnt"></div>
        <div class="au-base">2040 가치 = 기본값 🪙<b class="num">${fmt(baseOf(c))}</b> × <b>?</b></div>
        <div class="au-sact"></div>
      </div>
    </div>
    <div class="au-teams" style="--n:${ctx.teams.length}">
      ${ctx.teams.map(t => `
      <div class="au-tm-t" data-tid="${t.id}" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}">
        <span class="au-tn">${t.emoji} ${esc(t.name)}</span>
        <span class="au-tc"><b class="num">0</b> 🪙</span>
        <span class="au-to"></span>
      </div>`).join('')}
    </div>
    <div class="au-foot"></div>
    <div class="au-sold" aria-live="assertive"></div>
  </div>`;
}

function updateCard(el, s, ctx, now) {
  const wrap = el.querySelector('.au-wrap');
  if (!wrap) return;
  const hi = s.hi;
  const secs = s.step === 'bid' ? secsLeft(s.deadline, now) : (s.step === 'look' ? BID_SECONDS : 0);
  timerUpdate(el, secs);
  if (s.step === 'bid' && !s.capped) tickSound(el, secs);
  wrap.classList.toggle('is-look', s.step === 'look');
  wrap.classList.toggle('is-bid', s.step === 'bid');
  wrap.classList.toggle('hot', s.step === 'bid' && secs <= 3 && !s.capped);
  text(el, '.au-title', s.step === 'look' ? '📣 이 기술을 조사한 모둠의 한 줄 광고!'
    : s.step === 'sold' ? (s.hist[s.hist.length - 1].team ? '🔨 탕! 탕! 탕! 낙찰!' : '💨 유찰 — 아무도 사지 않았다')
    : s.capped ? `🔒 한도 ${fmt(BID_CAP)} 도달 — 낙찰!`
    : s.ext > 0 && secs <= 3 ? `⏱ 막판 입찰! +${Math.round(s.ext / 1000)}초 연장 — 더 낼 팀?`
    : secs <= 3 ? '⏰ 마감 임박!! 더 낼 팀?' : '입찰! 조종기에서 +50 · +100 · +200');
  if (s.step === 'bid' && (el.__ext || 0) !== (s.ext || 0)) {
    if ((s.ext || 0) > (el.__ext || 0)) { flash(el.querySelector('.au-tm'), 'au-bump', 500); beep(1200, 90, 'square', 0.08); }
    el.__ext = s.ext || 0;
  }

  // 최고가
  const T = hi && ctx.teams.find(t => t.id === hi.team);
  const priceEl = el.querySelector('.au-price');
  const pkey = hi ? `${hi.team}-${hi.bid}` : '';
  if (el.__pkey !== pkey) {
    el.__pkey = pkey;
    text(priceEl, priceEl, hi ? fmt(hi.bid) : (s.step === 'look' ? '—' : '0'));
    const lead = el.querySelector('.au-lead');
    lead.innerHTML = T ? `<span class="gk-tag" style="--tf:${T.fill};--tt:${T.tint};--tx:${T.text}">👑 ${T.emoji} ${esc(T.name)}</span>` : `<span class="dim">${s.step === 'look' ? '곧 입찰 시작' : '아직 입찰 없음'}</span>`;
    if (hi) { flash(priceEl, 'au-bump', 500); beep(880 + Math.min(600, hi.bid / 4), 70, 'triangle', 0.1); }
  }
  text(el, '.au-cnt', hi ? `입찰 ${hi.n}번${hi.bid >= BID_CAP ? ` · 한도 ${BID_CAP} 도달!` : ''}` : '');
  el.querySelector('.au-side').classList.toggle('has', !!hi);

  // 팀 코인
  for (const t of ctx.teams) {
    const box = el.querySelector(`.au-tm-t[data-tid="${t.id}"]`);
    if (!box) continue;
    text(box, '.au-tc b', fmt((s.coins || {})[t.id] ?? 0));
    const owned = (s.hist || []).filter(h => h.team === t.id).map(h => CARDS[h.c].emoji).join('');
    text(box, '.au-to', owned);
    box.classList.toggle('lead', !!hi && hi.team === t.id && s.step !== 'look');
  }

  // 단추 (단계가 바뀔 때만 다시 그린다)
  const last = s.order.length - s.i - 1;
  keyed(el.querySelector('.au-sact'), s.step, s.step === 'look' ? `<button class="btn big au-go" data-act="open">입찰 시작 ▶</button>` : '');
  keyed(el.querySelector('.au-foot'), s.step + s.i, s.step === 'look'
    ? `<span class="gk-hint">광고가 끝나면 「입찰 시작」 · 남은 카드 ${last}장</span><span class="au-sp"></span><button class="btn ghost" data-act="skipall">남은 카드 건너뛰고 2040 결과로 ⏭</button>`
    : s.step === 'bid'
      ? `<button class="btn ghost" data-act="more">+5초</button><button class="btn" data-act="hammer">지금 낙찰 🔨</button><span class="gk-hint">카드 하나에 팀당 ${BID_CAP}까지 · 같은 값이면 먼저 낸 팀 · 마지막 3초 입찰은 +3초(최대 +6초)</span>`
      : `<button class="btn" data-act="next">${last ? '다음 카드 ▶' : '2040 결과 카드 열기 ▶'}</button><span class="gk-hint">잠시 뒤 저절로 넘어간다</span>`);

  // 낙찰 연출
  const sold = el.querySelector('.au-sold');
  if (s.step === 'sold') {
    const h = s.hist[s.hist.length - 1];
    const W = h.team && ctx.teams.find(t => t.id === h.team);
    if (keyed(sold, 'sold-' + s.i, `<div class="au-sbox ${W ? '' : 'none'}" ${W ? `style="--tf:${W.fill};--tt:${W.tint};--tx:${W.text}"` : ''}>
        <div class="au-gavel" aria-hidden="true">🔨</div>
        <div class="au-sw">${W ? `${W.emoji} ${esc(W.name)}` : '유찰'}</div>
        <div class="au-sp2 num">${W ? `${fmt(h.paid)}코인` : '다음 기회에!'}</div></div>`)) {
      if (W) { beep(330, 90, 'square', 0.12); setTimeout(() => beep(330, 90, 'square', 0.12), 180); setTimeout(() => beep(523, 260, 'triangle', 0.15), 360); confetti(el, 40); }
      else beep(220, 300, 'sine', 0.1);
    }
  } else keyed(sold, 'none', '');
}

// ── 진행판: 2040 결과 카드 ──
function hostFuture(s, ctx) {
  return `
  <div class="au-wrap">
    <div class="au-top">
      <div>
        <div class="eyebrow">2040 결과 카드 · 낙찰 ${s.hist.filter(h => h.team).length}장</div>
        <h1 class="au-title">2040년, 이 기술들의 가치는? 📅</h1>
      </div>
      <div class="au-fprog num"></div>
    </div>
    <div class="au-fmain">
      <div class="au-grid">
        ${s.hist.map((h, k) => {
          const c = CARDS[h.c];
          const T = h.team && ctx.teams.find(t => t.id === h.team);
          return `<div class="au-fc ${T ? '' : 'unsold'}" data-k="${k}" ${T ? `style="--tf:${T.fill};--tt:${T.tint};--tx:${T.text}"` : ''}>
            <div class="au-fh"><span class="au-fe">${c.emoji}</span><span class="au-fn">${esc(c.name)}</span></div>
            <div class="au-fx num">?</div>
            <div class="au-fo">${T ? `${T.emoji} ${fmt(h.paid)}` : '유찰'}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="au-board"><div class="au-blbl">팀 자산 = 남은 코인 + 연 카드의 2040 가치</div><div class="au-rows"></div></div>
    </div>
    <div class="au-why" aria-live="polite"></div>
    <div class="au-foot au-ffoot"></div>
  </div>`;
}

function updateFuture(el, s, ctx) {
  const n = s.fut.length;
  text(el, '.au-fprog', `${n}/${s.hist.length}`);
  for (let k = 0; k < n; k++) {
    const cell = el.querySelector(`.au-fc[data-k="${k}"]`);
    if (!cell || cell.classList.contains('open')) continue;
    const x = s.fut[k].x, tr = trendOf(x), h = s.hist[k];
    cell.classList.add('open', tr.cls);
    text(cell, '.au-fx', `×${x}`);
    const v = valueOf(h.c, x);
    if (h.team) { text(cell, '.au-fo', `${ctx.teams.find(t => t.id === h.team)?.emoji || ''} ${fmt(h.paid)} → ${fmt(v)}`); cell.classList.add(v > h.paid ? 'gain' : v < h.paid ? 'loss' : 'even'); }
    else text(cell, '.au-fo', `유찰 · ${fmt(v)}`);
  }
  // 막 열린 카드의 까닭 한 줄
  if (n && el.__rv !== n) {
    el.__rv = n;
    const k = n - 1, h = s.hist[k], c = CARDS[h.c], f = c.future, tr = trendOf(f.x), tw = twistOf(h, f.x);
    const W = h.team && ctx.teams.find(t => t.id === h.team);
    el.querySelector('.au-why').innerHTML = `<div class="au-wx ${tr.cls}"><span class="num">×${f.x}</span><small>${tr.icon} ${tr.label}</small></div>
      <div class="au-tw ${tw.cls}"><span class="au-twi" aria-hidden="true">${tw.icon}</span><span class="au-twt"><small>${W ? `${W.emoji} ${esc(W.name)} · ` : ''}${c.emoji} ${esc(c.name)} · 기본값 ${fmt(baseOf(c))} × ${f.x}</small><b class="num">${tw.line}</b></span></div>
      <div class="au-wt"><span>👍 ${esc(f.good)}</span><span>🤔 ${esc(f.worry)}</span></div>`;
    flash(el.querySelector('.au-why'), 'au-pop', 500);
    const fc = el.querySelector(`.au-fc[data-k="${k}"]`);
    if (fc) flash(fc, 'au-flip', 700);
    if (h.team) {
      if (tw.cls === 'loss') { beep(392, 160, 'sawtooth', 0.08); setTimeout(() => beep(262, 320, 'sawtooth', 0.08), 170); }
      else beep(f.x >= 2 ? 1046 : f.x > 1 ? 784 : 523, 220, 'triangle', 0.14);
    }
  }
  // 자산 순위표
  const ids = ctx.teams.map(t => t.id);
  const { a } = assetsOf(s, ids);
  const sorted = ids.slice().sort((x, y) => a[y] - a[x]);
  const max = Math.max(1, ...Object.values(a));
  keyed(el.querySelector('.au-rows'), JSON.stringify(sorted.map(t => [t, a[t]])), sorted.map((tid, r) => {
    const t = ctx.teams.find(x => x.id === tid);
    return `<div class="au-br" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}">
      <span class="au-brk">${r + 1}</span><span class="au-brn">${t.emoji} ${esc(t.name)}</span>
      <span class="au-bar"><i style="width:${(a[tid] / max * 100).toFixed(1)}%"></i></span><b class="num">${fmt(a[tid])}</b></div>`;
  }).join(''));
  const done = n >= s.hist.length;
  keyed(el.querySelector('.au-ffoot'), done ? 'done' : 'go', done
    ? `<button class="btn big" data-act="final">최종 순위 ▶</button><span class="gk-hint">배수는 재미로 한 「예상」 — 장점과 걱정을 함께!</span>`
    : `<button class="btn big" data-act="rv">다음 카드 열기 ▶</button><button class="btn ghost" data-act="all">한 번에 모두 열기 ⏩</button><span class="gk-hint">6초쯤 지나면 저절로 다음 장 · 한 줄을 함께 읽어요</span>`);
}

function hostFinal(s, ctx) {
  const rows = ctx.teams.slice().sort((x, y) => s.rank[x.id] - s.rank[y.id]);
  const max = Math.max(1, ...Object.values(s.assets));
  const { gain, loss } = highlights(s);
  const top = rows[0];
  return `
  <div class="au-wrap">
    <div class="au-top"><div>
      <div class="eyebrow">바이오 경매 · 최종 자산</div>
      <h1 class="au-title">${top ? `${medal(1)} ${top.emoji} ${esc(top.name)} — ${fmt(s.assets[top.id])}코인!` : '최종 자산'}</h1>
    </div></div>
    <div class="au-fin">
      ${rows.map((t, k) => `
      <div class="au-frow" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text};animation-delay:${(k * 0.08).toFixed(2)}s">
        <span class="au-frk">${medal(s.rank[t.id])}</span>
        <span class="au-frn">${t.emoji} ${esc(t.name)}</span>
        <span class="au-frd">🪙 ${fmt(s.coins[t.id] || 0)} + 🧬 ${fmt(s.tech[t.id] || 0)}</span>
        <span class="au-bar"><i style="width:${(s.assets[t.id] / max * 100).toFixed(1)}%"></i></span>
        <b class="au-frv num">${fmt(s.assets[t.id])}</b>
        <span class="au-frp num">+${s.pts[t.id]}</span>
      </div>`).join('')}
    </div>
    <p class="gk-note">${gain && gain.g > 0 ? `🤑 가장 남는 장사: ${CARDS[gain.c].emoji} ${esc(CARDS[gain.c].name)} ${fmt(gain.paid)} → ${fmt(gain.v)} · ` : ''}${loss && loss.g < 0 ? `😱 가장 아까운 낙찰: ${CARDS[loss.c].emoji} ${esc(CARDS[loss.c].name)} ${fmt(loss.paid)} → ${fmt(loss.v)} · ` : ''}
      2040 배수는 <b>예상</b>이다. 생명 기술은 <b>식품 · 농업 / 의료 / 환경 · 에너지</b>에서 쓰이고, 좋은 점과 걱정되는 점이 함께 있다.</p>
    <div class="au-foot"><button class="btn big" data-act="finish">결과 보기 ▶</button></div>
  </div>`;
}

// ── 조종기 ──
function playBid(s, c, hi, price, lead, coins, ctx) {
  const T = hi && ctx.teams[hi.team];
  const most = maxBid(coins);
  const look = s.step === 'look';
  const f = fieldOf(c.field);
  return `
  <div class="aup">
    <div class="aup-head">
      <span class="pv-eyebrow">카드 ${s.i + 1}/${s.order.length} · ${look ? '광고 듣기' : '입찰 중'}</span>
      <span class="aup-ext"></span><span class="aup-time">${look ? '' : '<b class="aup-left num">--</b>초'}</span>
    </div>
    <div class="aup-card"><span class="aup-e">${c.emoji}</span><div><b class="aup-n">${esc(c.name)}</b><span class="aup-f">${f.emoji} ${esc(f.label)} · 2040 가치 = 기본값 ${fmt(baseOf(c))} × ?</span></div></div>
    <div class="aup-price">
      <span>지금 최고가</span><b class="num">${hi ? fmt(price) : '—'}</b>
      <span class="aup-lead">${T ? `👑 ${T.emoji} ${esc(T.name)}` : look ? '곧 입찰 시작!' : '아직 아무도 안 냈어요'}</span>
    </div>
    ${look ? `<p class="aup-wait">📣 조사한 모둠의 광고를 들어 봐요</p>` : lead
      ? `<p class="aup-wait lead">👑 우리 팀이 최고가! 다른 팀이 올리면 다시 낼 수 있어요</p>`
      : price + BID_STEPS[0] > most
        ? `<p class="aup-wait">${price + BID_STEPS[0] > BID_CAP ? `🔒 최고가가 한도 ${fmt(BID_CAP)} — 이 카드는 더 올릴 수 없어요` : '🪙 우리 팀 코인으로는 더 올릴 수 없어요'}</p>`
        : `<div class="aup-btns">${BID_STEPS.map(d => {
          const ok = price + d <= most;
          return `<button class="aup-b" data-d="${d}" ${ok ? 'data-ok="1"' : 'disabled'}><b>+${d}</b><span class="num">${ok ? `→ ${fmt(price + d)}` : price + d > BID_CAP ? `한도 ${fmt(BID_CAP)}` : '코인 부족'}</span></button>`;
        }).join('')}</div>`}
    <p class="aup-coins">우리 팀 코인 🪙 <b class="num">${fmt(coins)}</b> <span class="aup-capn">· 카드 하나에 ${fmt(BID_CAP)}까지</span> <span class="aup-me"></span></p>
  </div>`;
}

function playFuture(s, me, ctx) {
  const mine = s.hist.map((h, k) => ({ h, k })).filter(x => x.h.team === me.team);
  const ids = Object.keys(ctx.teams);
  const { a } = assetsOf(s, ids);
  const lastK = s.fut.length - 1;
  const last = lastK >= 0 ? s.hist[lastK] : null;
  return `
  <div class="aup">
    <div class="aup-head"><span class="pv-eyebrow">2040 결과 카드 · ${s.fut.length}/${s.hist.length}</span></div>
    <div class="aup-price"><span>우리 팀 자산</span><b class="num">${fmt(a[me.team] ?? 0)}</b><span class="aup-lead">남은 코인 ${fmt(s.coins[me.team] ?? 0)} + 기술 가치</span></div>
    ${last && last.team === me.team ? (tw => `<p class="aup-wait ${tw.cls === 'loss' ? 'loss' : 'lead'}">${tw.icon} 우리 팀 ${CARDS[last.c].emoji} ${esc(CARDS[last.c].name)} — ${tw.line}</p>`)(twistOf(last, s.fut[lastK].x)) : ''}
    <div class="aup-own">${mine.length ? mine.map(({ h, k }) => {
      const f = s.fut[k];
      const tw = f && twistOf(h, f.x);
      return `<span class="aup-oc ${tw ? tw.cls : ''}">${CARDS[h.c].emoji} ${esc(CARDS[h.c].name)} <b class="num">${f ? `${tw.icon} ${fmt(h.paid)} → ${fmt(valueOf(h.c, f.x))}` : `${fmt(h.paid)} → ?`}</b></span>`;
    }).join('') : '<span class="dim">우리 팀은 기술을 사지 않았어요 — 코인을 지켰다!</span>'}</div>
    <p class="pv-sub dim">👀 화면에서 한 장씩 열려요 — 우리 팀 기술 ${mine.length}개</p>
  </div>`;
}

const CSS = `
.au-wrap{position:relative;display:flex;flex-direction:column;height:100%;gap:12px}
.au-top{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;min-height:62px}
.au-title{font-size:32px;font-weight:800;letter-spacing:-.025em;line-height:1.25;margin:6px 0 0}
.au-wrap.is-look .au-tm{opacity:.35}
.au-wrap.hot .au-title{color:var(--bad)}
.au-main{flex:1;display:grid;grid-template-columns:minmax(0,1fr) 360px;grid-template-rows:minmax(0,1fr);gap:16px;min-height:0;container-type:size}
.au-card{background:var(--card);border:1.5px solid var(--line);border-top:8px solid var(--org);border-radius:var(--r-l);padding:18px 22px;display:flex;flex-direction:column;gap:10px;min-height:0;overflow:hidden;animation:gk-pop .4s cubic-bezier(.2,.75,.3,1) both}
.au-ch{display:flex;align-items:center;gap:18px}
.au-emo{font-size:104px;line-height:1}
.au-field{display:inline-block;font-size:17px;font-weight:800;padding:3px 12px;border-radius:99px;background:var(--paper);border:1.5px solid var(--line)}
.au-name{font-size:52px;font-weight:800;letter-spacing:-.035em;line-height:1.15;margin:4px 0 0}
.au-line{font-size:28px;font-weight:700;letter-spacing:-.015em;line-height:1.45;margin:0}
.au-sys{display:grid;grid-template-columns:1fr 18px 1fr 18px 1fr 18px 1fr;gap:4px;align-items:stretch;margin-top:auto}
.au-sb{background:var(--paper);border:1.5px solid var(--line);border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:2px;min-width:0}
.au-sb b{font-size:19px;color:var(--org-t)}
.au-sb span{font-size:21px;line-height:1.38;font-weight:700;word-break:keep-all}
.au-sb{padding:10px 12px}
.au-ar{align-self:center;text-align:center;font-style:normal;font-weight:800;color:var(--mid-d)}
.au-side{background:var(--card);border:1.5px solid var(--line);border-radius:var(--r-l);padding:18px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center}
.au-side.has{border-color:var(--org);box-shadow:0 0 0 2px var(--org-l)}
.au-wrap.hot .au-side{animation:au-shake .35s infinite;background:var(--bad-w);border-color:var(--bad);box-shadow:0 0 0 3px var(--bad)}
.au-wrap.hot .au-price{color:var(--bad)}
@keyframes au-shake{0%,100%{transform:none}25%{transform:translateX(-4px) rotate(-.6deg)}75%{transform:translateX(4px) rotate(.6deg)}}
.au-lbl{font-size:18px;font-weight:800;color:var(--dim)}
.au-price{font-size:104px;font-weight:800;letter-spacing:-.05em;line-height:1}
.au-bump{animation:au-bump .45s cubic-bezier(.2,.75,.3,1)}
@keyframes au-bump{0%{transform:scale(1.35);color:var(--org-t)}100%{transform:none}}
.au-lead .gk-tag{font-size:24px;padding:5px 16px}
.au-lead .dim{font-size:20px}
.au-cnt{font-size:17px;font-weight:700;color:var(--dim);min-height:22px}
.au-base{font-size:19px;font-weight:800;background:var(--paper);border:1.5px dashed var(--mid-d);border-radius:12px;padding:6px 12px}
.au-base b{font-size:24px}
.au-sact:empty{display:none}
.au-go{font-size:24px;padding:16px 28px}
.au-teams{display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));gap:8px}
.au-tm-t{display:flex;flex-direction:column;gap:0;background:var(--card);border:1.5px solid var(--line);border-top:7px solid var(--tf);border-radius:12px;padding:6px 10px;min-width:0}
.au-tm-t.lead{background:var(--tt);box-shadow:0 0 0 3px var(--tf)}
.au-tn{font-size:16px;font-weight:800;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.au-tc{font-size:15px;font-weight:700}.au-tc b{font-size:24px;letter-spacing:-.03em}
.au-to{font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:22px}
.au-foot{display:flex;align-items:center;gap:12px;min-height:48px}
.au-sp{flex:1}
.au-sold{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;z-index:20}
.au-sold:empty{display:none}
.au-sbox{background:var(--card);border:3px solid #141413;border-top:16px solid var(--tf);border-radius:24px;padding:24px 64px 28px;text-align:center;box-shadow:0 18px 50px rgba(20,20,19,.25);animation:au-in .45s cubic-bezier(.2,.75,.3,1) both}
.au-sbox.none{border-top-color:var(--mid)}
.au-gavel{font-size:90px;line-height:1;display:inline-block;transform-origin:80% 80%;animation:au-hit .6s ease-in-out 3}
@keyframes au-hit{0%,100%{transform:rotate(0)}40%{transform:rotate(-40deg)}60%{transform:rotate(8deg)}}
@keyframes au-in{from{transform:scale(.5);opacity:0}to{transform:none;opacity:1}}
.au-sw{font-size:52px;font-weight:800;letter-spacing:-.03em;color:var(--tx,var(--ink))}
.au-sp2{font-size:40px;font-weight:800;letter-spacing:-.03em}
/* 2040 */
.au-fprog{font-size:40px;font-weight:800;color:var(--dim)}
.au-fmain{flex:1;display:grid;grid-template-columns:minmax(0,1fr) 400px;grid-template-rows:minmax(0,1fr);gap:16px;min-height:0}
.au-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-rows:minmax(0,1fr);gap:8px;min-height:0}
.au-fc{position:relative;background:var(--card);border:1.5px solid var(--line);border-left:8px solid var(--tf,var(--mid));border-radius:12px;padding:8px 10px;display:flex;flex-direction:column;justify-content:space-between;min-height:0;overflow:hidden}
.au-fc.unsold{opacity:.6;border-left-style:dashed}
.au-fh{display:flex;align-items:center;gap:6px;min-width:0}
.au-fe{font-size:28px;line-height:1}
.au-fn{font-size:17px;font-weight:800;line-height:1.25;letter-spacing:-.02em}
.au-fo{font-size:17px;font-weight:800;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.au-fc.gain .au-fo{color:var(--grn-t)}.au-fc.loss .au-fo{color:var(--bad)}
.au-fx{align-self:flex-end;font-size:34px;font-weight:800;letter-spacing:-.04em;line-height:1;color:var(--mid-d)}
.au-fc.open .au-fx{color:var(--ink)}
.au-fc.open.up2{background:var(--grn-w);border-color:var(--grn-l)}
.au-fc.open.up2 .au-fx,.au-fc.open.up .au-fx{color:var(--grn-t)}
.au-fc.open.down{background:var(--bad-w)}
.au-fc.open.down .au-fx{color:var(--bad)}
.au-fc.open.down .au-fx::after{content:' ▼';font-size:18px}
.au-fc.open.up2 .au-fx::after{content:' ▲▲';font-size:16px}
.au-fc.open.up .au-fx::after{content:' ▲';font-size:18px}
.au-flip{animation:au-flip .6s cubic-bezier(.2,.75,.3,1)}
@keyframes au-flip{0%{transform:rotateY(90deg)}100%{transform:none}}
.au-board{background:var(--card);border:1.5px solid var(--line);border-radius:var(--r-l);padding:12px 14px;display:flex;flex-direction:column;gap:6px;min-height:0;overflow:hidden}
.au-blbl{font-size:15px;font-weight:800;color:var(--dim)}
.au-rows{display:flex;flex-direction:column;gap:6px;flex:1;min-height:0;justify-content:center}
.au-br{display:grid;grid-template-columns:24px 112px 1fr 76px;align-items:center;gap:8px;flex:1 1 0;max-height:52px;min-height:0}
.au-brk{font-size:18px;font-weight:800;color:var(--dim);text-align:center}
.au-brn{font-size:16px;font-weight:800;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.au-br b{font-size:22px;text-align:right;letter-spacing:-.03em}
.au-bar{height:20px;background:var(--line);border-radius:6px;overflow:hidden}
.au-bar i{display:block;height:100%;background:var(--tf);border-radius:6px;transition:width .6s cubic-bezier(.2,.75,.3,1)}
.au-why{min-height:104px;display:flex;align-items:center;gap:18px;background:var(--org-w);border:1.5px solid var(--org-l);border-radius:var(--r-l);padding:8px 18px}
.au-why:empty{background:none;border-color:transparent}
.au-pop{animation:gk-pop .4s cubic-bezier(.2,.75,.3,1)}
.au-wx{display:flex;flex-direction:column;align-items:center;min-width:120px}
.au-wx .num{font-size:52px;font-weight:800;letter-spacing:-.045em;line-height:1}
.au-wx small{font-size:15px;font-weight:800}
.au-wx.up2 .num,.au-wx.up .num{color:var(--grn-t)}.au-wx.down .num{color:var(--bad)}
.au-wt{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.au-wt span{font-size:18px;line-height:1.4}
.au-tw{display:flex;align-items:center;gap:10px;flex:0 0 auto;max-width:48%;border-radius:14px;padding:4px 14px 4px 8px;background:var(--card);border:2px solid var(--line)}
.au-twi{font-size:52px;line-height:1}
.au-twt{display:flex;flex-direction:column;min-width:0}
.au-twt b{font-size:36px;font-weight:800;letter-spacing:-.04em;line-height:1.1;white-space:nowrap}
.au-twt small{font-size:17px;font-weight:800;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.au-tw.gain{border-color:var(--grn);background:var(--grn-w)}.au-tw.gain b{color:var(--grn-t)}
.au-tw.loss{border-color:var(--bad);background:var(--bad-w)}.au-tw.loss b{color:var(--bad)}
.au-tw.miss b{color:var(--org-t)}
/* 최종 */
.au-fin{flex:1;display:flex;flex-direction:column;gap:6px;justify-content:center;min-height:0;overflow:hidden}
.au-frow{flex:1 1 0;min-height:0;max-height:62px;display:grid;grid-template-columns:60px 170px 230px 1fr 110px 64px;gap:12px;align-items:center;background:var(--card);border:1.5px solid var(--line);border-left:10px solid var(--tf);border-radius:12px;padding:0 14px;overflow:hidden;animation:gk-in .35s cubic-bezier(.2,.75,.3,1) both}
.au-frk{font-size:30px;text-align:center}.au-frn{font-size:21px;font-weight:800;color:var(--tx)}
.au-frd{font-size:16px;font-weight:700}
.au-frv{font-size:28px;text-align:right;letter-spacing:-.03em}.au-frp{font-size:20px;font-weight:800;color:var(--grn-t)}
/* 조종기 */
.aup{display:flex;flex-direction:column;gap:14px;height:100%;justify-content:center;max-width:1100px;width:100%;margin:0 auto}
.aup-head{display:flex;justify-content:space-between;align-items:center;min-height:30px}
.aup-time{font-size:24px;font-weight:800}
.aup-time.hot{color:var(--bad);animation:gkpulse .5s infinite alternate}
.aup-card{display:flex;align-items:center;gap:16px}
.aup-e{font-size:64px;line-height:1}
.aup-n{display:block;font-size:34px;letter-spacing:-.03em;line-height:1.2}
.aup-f{font-size:17px;font-weight:700;color:var(--dim)}
.aup-price{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;background:var(--card);border:1.5px solid var(--line);border-radius:var(--r-l);padding:10px 20px}
.aup-price>span:first-child{font-size:18px;font-weight:800;color:var(--dim)}
.aup-price b{font-size:64px;letter-spacing:-.05em;line-height:1.05}
.aup-lead{font-size:22px;font-weight:800}
.aup-btns{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.aup-b{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:170px;border-radius:20px;border:none;background:var(--org);color:#141413;cursor:pointer;box-shadow:0 7px 0 #a84f2e}
.aup-b b{font-size:52px;letter-spacing:-.04em;line-height:1}
.aup-b span{font-size:22px;font-weight:700}
.aup-b:active{transform:translateY(5px);box-shadow:0 2px 0 #a84f2e}
.aup-b:disabled{background:var(--line);color:var(--dim);box-shadow:none;cursor:default}
.aup-wait{font-size:26px;font-weight:800;text-align:center;background:var(--paper);border:2px dashed var(--mid-d);border-radius:20px;padding:40px 16px;margin:0}
.aup-wait.lead{background:var(--grn-w);border:2px solid var(--grn);color:var(--grn-t)}
.aup-coins{font-size:20px;margin:0}.aup-coins b{font-size:26px}
.aup-capn{font-size:18px;font-weight:700;color:var(--dim)}
.aup-ext{margin-left:auto;margin-right:14px;font-size:20px;font-weight:800;color:var(--bad)}
.aup-wait.loss{background:var(--bad-w);border:2px solid var(--bad);color:var(--bad)}
.aup-me{font-size:17px;font-weight:700;color:var(--org-t);margin-left:12px}
.aup-own{display:flex;flex-wrap:wrap;gap:10px}
.aup-oc{font-size:20px;font-weight:700;background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:8px 14px}
.aup-oc.gain{background:var(--grn-w);border-color:var(--grn-l)}.aup-oc.loss{background:var(--bad-w);border-color:var(--bad)}
@container (max-height:330px){.au-card{padding:10px 16px;gap:6px}.au-emo{font-size:52px}.au-name{font-size:32px}.au-line{font-size:18px}.au-sys{display:none}
  .au-price{font-size:64px}.au-side{padding:10px;gap:4px}.au-go{font-size:20px;padding:10px 20px}.au-lead .gk-tag{font-size:18px}.au-base{font-size:16px;padding:3px 8px}.au-base b{font-size:19px}}
@media (prefers-reduced-motion:reduce){.au-card,.au-sbox,.au-gavel,.au-frow,.au-flip,.au-bump,.au-pop{animation:none!important}.au-wrap.hot .au-side{animation:none}}
`;
