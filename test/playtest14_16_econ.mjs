// 14차시 바이오 경매 경제 시뮬레이션 (DOM 없음 · 순수 계산)
//   node test/playtest14_16_econ.mjs [--games 4000]
// 반 크기별(팀 5 · 6 · 7개) · 팀 성격별 「1위 비율」(그 성격 팀이 1등을 한 비율)을 여러 판 돌려 본다.
//   예전 규칙: 자산 = 남은 코인 + Σ(낙찰가 × 배수) · 상한 없음 · 카드 순서 고정
//   지금 규칙: 자산 = 남은 코인 + Σ(카드 기본값 × 배수) · 카드당 팀 상한 BID_CAP · 카드 순서 방마다 섞음
// 목표: 어느 성격도 1위 35%를 넘지 않고(특히 「처음부터 몰빵」), 비싸게 산 카드는 평균 손해.
// 오름 경매 모형: 가장 높게 부를 팀이 「두 번째 팀이 멈춘 값 + 50」에 산다(같으면 무작위 = 먼저 누른 팀).
import { CARDS, START_COINS, BID_CAP, baseOf } from '../site/games/auction-data.js';

const STEP = 50;
const G = Number((process.argv.indexOf('--games') > 0 && process.argv[process.argv.indexOf('--games') + 1]) || 4000);
const X = CARDS.map(c => c.future.x);
const MEANX = X.reduce((a, b) => a + b, 0) / X.length;
const shuffled = n => { const a = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const LABEL = {
  allin: '처음부터 몰빵', saver: '아꼈다 막판', balanced: '고르게 나눠',
  spread: '카드마다 100', pick4: '맘에 든 4장', none: '안 삼', random: '아무렇게나', thinker: '근거로 짐작(참고)',
};
// (k = 몇 번째 카드 0~11, coins = 남은 코인, me = 팀, c = 카드) → 이 카드에 부를 수 있는 최고값
const POL = {
  allin: (k, coins) => coins,                                                                     // 장난꾼 · 충동형: 첫 카드부터 다 건다
  saver: (k, coins) => (k >= 8 ? Math.floor(coins / (12 - k) / STEP) * STEP + STEP * 2 : 0),     // 마지막 4장까지 아꼈다가 나눠 쓴다
  balanced: (k, coins) => Math.max(100, Math.floor(coins / (12 - k) * 1.5 / STEP) * STEP),        // 남은 코인 ÷ 남은 카드 × 1.5
  spread: (k, coins) => Math.min(coins, 100),
  pick4: (k, coins, me, c) => (me.like.has(c) ? Math.min(coins, 250) : 0),                       // 이름이 좋아 보이는 4장(배수와 상관없이)
  none: () => 0,
  random: (k, coins) => Math.floor(Math.random() * coins / 2 / STEP) * STEP,
  // 참고: 카드 설명을 읽고 배수를 반쯤 맞히는 팀(학습 목표 — 근거로 전망하기)
  thinker: (k, coins, me, c, rule) => Math.floor(Math.min(coins, (rule.value(c, 1) * (MEANX * 0.5 + X[c] * 0.5)) * (0.7 + Math.random() * 0.6) * 0.9) / STEP) * STEP,
};

const RULES = {
  old: { name: '예전(낙찰가 × 배수 · 상한 없음 · 순서 고정)', cap: Infinity, shuffle: false, value: (c, paid) => Math.round(paid * X[c]) },
  now: { name: `지금(기본값 × 배수 · 카드당 ${BID_CAP} · 순서 섞음)`, cap: BID_CAP, shuffle: true, value: c => Math.round(baseOf(CARDS[c]) * X[c]) },
};

function play(rule, nTeams, names) {
  const teams = Array.from({ length: nTeams }, () => {
    const like = new Set(); while (like.size < 4) like.add(Math.floor(Math.random() * 12));
    return { pol: names[Math.floor(Math.random() * names.length)], coins: START_COINS, buys: [], like };
  });
  const order = rule.shuffle ? shuffled(CARDS.length) : CARDS.map((_, i) => i);
  order.forEach((c, k) => {
    const wants = teams.map(t => ({ t, w: Math.min(t.coins, rule.cap, POL[t.pol](k, t.coins, t, c, rule)), r: Math.random() }))
      .filter(x => x.w >= STEP).sort((a, b) => b.w - a.w || a.r - b.r);
    if (!wants.length) return;
    const price = Math.min(wants[0].w, Math.max(STEP, (wants[1] ? wants[1].w : 0) + STEP));
    wants[0].t.coins -= price; wants[0].t.buys.push({ c, paid: price });
  });
  for (const t of teams) t.asset = t.coins + t.buys.reduce((a, b) => a + rule.value(b.c, b.paid), 0);
  return teams;
}

function run(rule, nTeams, names) {
  const agg = Object.fromEntries(names.map(n => [n, { n: 0, win: 0, asset: 0 }]));
  const pricey = { n: 0, gain: 0, lost: 0 }, cheap = { n: 0, gain: 0 };
  for (let g = 0; g < G; g++) {
    const teams = play(rule, nTeams, names);
    const best = Math.max(...teams.map(t => t.asset));
    const nb = teams.filter(t => t.asset === best).length;
    for (const t of teams) {
      const a = agg[t.pol]; a.n++; a.asset += t.asset; if (t.asset === best) a.win += 1 / nb;
      for (const b of t.buys) {
        const g2 = rule.value(b.c, b.paid) - b.paid;
        if (b.paid >= 300) { pricey.n++; pricey.gain += g2; if (g2 < 0) pricey.lost++; } else if (b.paid <= 150) { cheap.n++; cheap.gain += g2; }
      }
    }
  }
  return { agg, pricey, cheap };
}

const MAIN = ['allin', 'saver', 'balanced', 'spread', 'pick4', 'none', 'random'];
const out = {};
for (const key of ['old', 'now']) {
  const rule = RULES[key];
  console.log(`\n규칙: ${rule.name}`);
  out[key] = {};
  for (const n of [5, 6, 7]) {
    const { agg, pricey, cheap } = run(rule, n, MAIN);
    out[key][n] = Object.fromEntries(MAIN.map(k => [k, agg[k].win / agg[k].n]));
    const row = MAIN.map(k => `${LABEL[k]} ${(agg[k].win / agg[k].n * 100).toFixed(0)}%`).join(' · ');
    console.log(`  팀 ${n}개 1위 비율: ${row}`);
    console.log(`           300 이상에 산 카드 평균 손익 ${pricey.n ? (pricey.gain / pricey.n >= 0 ? '+' : '') + Math.round(pricey.gain / pricey.n) : '-'} (손해 본 비율 ${pricey.n ? Math.round(pricey.lost / pricey.n * 100) : 0}%) · 150 이하에 산 카드 ${cheap.n ? '+' + Math.round(cheap.gain / cheap.n) : '-'}`);
  }
}
// 참고: 「근거로 짐작하는 팀」을 섞었을 때(지금 규칙 · 팀 7개)
{
  const names = [...MAIN, 'thinker'];
  const { agg } = run(RULES.now, 7, names);
  console.log(`\n참고(지금 규칙 · 팀 7개 · 근거로 짐작하는 팀 포함): ` + names.map(k => `${LABEL[k]} ${(agg[k].win / agg[k].n * 100).toFixed(0)}%`).join(' · '));
}
const worst = Math.max(...[5, 6, 7].flatMap(n => ['allin', 'saver', 'balanced'].map(k => out.now[n][k])));
console.log(`\n지금 규칙에서 몰빵 · 아낌 · 나눔 중 가장 높은 1위 비율: ${(worst * 100).toFixed(0)}% (목표 35% 안팎)`);
console.log(`배수 평균 ×${MEANX.toFixed(2)} · 기본값 ${[...new Set(CARDS.map(baseOf))].join('/')} → 2040 가치 평균 ${Math.round(CARDS.reduce((a, c, i) => a + baseOf(c) * X[i], 0) / CARDS.length)} · 카드당 상한 ${BID_CAP}`);
