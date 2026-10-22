// 15차시 화면 모음 시험: 「장바구니 탐정」(cart) · 「가족 저녁 회의」(dinner)
//   node test/gallery15.mjs [--headed] [--only cart|dinner]
// 브라우저 30개를 띄우지 않고, 진행판 · 조종기 화면을 상태별로 직접 그려 1366×768 스크린샷 + 레이아웃 점검을 한다.
// 팀 3 · 4 · 5 · 8개, 4명 팀 · 6명 팀(+대신 누르기 표 1장 = 칩 7개), 카드 15장 전부, 역할 7개 × 사흘 대사 · 상황 카드 전부 · 동률 단계.
// 실제 Firebase · DB 를 쓰지 않는다. 결과: test/shots15/gallery/*.png + report.json
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { startStatic } from './serve.mjs';
import { layoutIssues } from './layout15.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE_SRC = path.join(here, '../site');
const arg = k => process.argv.includes('--' + k);
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i > 0 ? process.argv[i + 1] : ''; })();
const VIEW = { width: 1366, height: 768 };
const OUT = path.join(here, 'shots15', 'gallery');
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.unlinkSync(path.join(OUT, f));

// ── 임시 사이트: styles.css + 화면 틀 두 개 + 게임 묶음 ──
const root = path.join(os.tmpdir(), 'bb-gallery15');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
fs.copyFileSync(path.join(SITE_SRC, 'styles.css'), path.join(root, 'styles.css'));
const shell = (cls, main) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"></head>
<body class="${cls}"><header id="bar"><span class="b-title">🧬 생명 기술 대작전</span><span class="b-chip strong">반 3-5</span></header><div id="banner"></div>${main}<div id="toasts"></div><script src="g.js"></script></body></html>`;
fs.writeFileSync(path.join(root, 'host.html'), shell('host', '<main id="stage"><div class="gwrap"><div class="game" id="gameEl"></div><div class="proxy" id="proxyEl"></div></div></main>'));
fs.writeFileSync(path.join(root, 'play.html'), shell('play', '<main id="main"><div class="gp" id="gp"></div></main>'));
const entry = path.join(root, 'entry.js');
const imp = p => JSON.stringify(path.join(SITE_SRC, p).split(path.sep).join('/'));
fs.writeFileSync(entry, `
import cart from ${imp('games/cart.js')}; import * as CD from ${imp('games/cart-data.js')};
import dinner from ${imp('games/dinner.js')}; import * as DD from ${imp('games/dinner-data.js')};
import { TEAM_DEFS, mulberry32 } from ${imp('src/shared.js')};
window.G = { cart, dinner, CD, DD, TEAM_DEFS, mulberry32 };`);
await esbuild.build({ entryPoints: [entry], bundle: true, outfile: path.join(root, 'g.js'), format: 'iife', target: ['chrome100'], logLevel: 'warning' });

async function loadPlaywright() {
  try { return await import('playwright'); } catch {}
  const cache = path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx');
  if (fs.existsSync(cache)) {
    const found = fs.readdirSync(cache).map(d => path.join(cache, d, 'node_modules', 'playwright'))
      .filter(p => fs.existsSync(path.join(p, 'package.json')))
      .sort((a, b) => JSON.parse(fs.readFileSync(path.join(b, 'package.json'))).version.localeCompare(JSON.parse(fs.readFileSync(path.join(a, 'package.json'))).version, undefined, { numeric: true }));
    for (const p of found) { try { return await import(pathToFileURL(path.join(p, 'index.mjs')).href); } catch {} }
  }
  throw new Error('playwright 를 찾지 못했어요');
}

const stat = await startStatic({ port: 0, root });
const SITE = `http://127.0.0.1:${stat.server.address().port}`;
const { chromium } = await loadPlaywright();
let browser;
try { browser = await chromium.launch({ channel: 'chrome', headless: !arg('headed') }); } catch { browser = await chromium.launch({ headless: !arg('headed') }); }
// 움직임 줄이기: 애니메이션 중간 모습이 아니라 다 그려진 모습을 찍는다(CPU 가 바쁠 때도 같은 결과)
const ctxB = await browser.newContext({ viewport: VIEW, locale: 'ko-KR', reducedMotion: 'reduce' });
// 진행판 · 조종기를 서로 다른 창(컨텍스트)에 — 한 창의 뒤쪽 탭은 그림을 안 그려 스크린샷이 멈출 수 있다
const ctxP = await browser.newContext({ viewport: VIEW, locale: 'ko-KR', reducedMotion: 'reduce' });
const host = await ctxB.newPage();
const play = await ctxP.newPage();
const errors = [];
for (const [p, who] of [[host, 'host'], [play, 'play']]) {
  p.on('pageerror', e => errors.push(`${who}: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(`${who} console: ${m.text().slice(0, 200)}`); });
}
// 다른 시험이 같이 돌아 CPU 가 바쁠 수 있다 → 넉넉히 기다린다
ctxB.setDefaultTimeout(180000); ctxP.setDefaultTimeout(180000);
await host.goto(`${SITE}/host.html`); await play.goto(`${SITE}/play.html`);
await host.waitForFunction(() => !!window.G, null, { timeout: 120000 }).catch(e => { console.log(errors); throw e; }); await play.waitForFunction(() => !!window.G, null, { timeout: 120000 });

// 브라우저 안 도구: 팀 · ctx 만들기, 상태 만들기, 그리기
const BOOT = () => {
  const { cart, dinner, CD, DD, TEAM_DEFS, mulberry32 } = window.G;
  const W = window.W = {};
  W.rnd = mulberry32(7);
  W.teams = (sizes, proxyTeams = []) => {
    let n = 0;
    return sizes.map((k, i) => {
      const d = TEAM_DEFS[i];
      const members = Array.from({ length: k }, () => 'u' + (++n));
      const online = members.slice();
      // 코어(teamList)처럼 대신 누르기가 켜지면 members · online 둘 다에 가짜 팀원
      if (proxyTeams.includes(i)) { members.push('proxy-t' + (i + 1)); online.push('proxy-t' + (i + 1)); }
      return { id: 't' + (i + 1), ...d, score: 0, members, online };
    });
  };
  W.ctx = (teams, extra = {}) => {
    const c = { _now: 1_700_000_000_000, teams, inputs: {}, rnd: W.rnd, offline: false, cls: '3-5', act() {}, ...extra };
    c.now = () => c._now;
    c.numOf = u => (u.startsWith('proxy-') ? 0 : Number(u.slice(1)));
    return c;
  };
  // ── 장바구니: 카드 i 의 ask / reveal 상태 ──
  W.cartStates = (teams, rightRate = 0.7) => {
    const c = W.ctx(teams);
    let s = cart.setup(c);
    s = { ...s, order: [s.ci, ...CD.CARDS.map((_, i) => i).filter(i => i !== s.ci)] };
    const out = [];
    for (let k = 0; k < CD.CARDS.length; k++) {
      // 반쯤 고른 ask
      c._now = s.startAt + 3000;
      const inputs = {};
      const all = teams.flatMap(t => t.online);
      all.forEach((u, j) => {
        const ans = CD.CARDS[s.ci].answer;
        const wrong = s.choices.filter(x => x !== ans);
        if (j % 7 === 6) return;   // 몇 명은 안 고름
        inputs[u] = { c: W.rnd() < rightRate ? ans : wrong[j % 3], t: s.startAt + 400 + j * 120 };
      });
      const half = Object.fromEntries(Object.entries(inputs).filter((_, j) => j % 2 === 0));
      c.inputs = half;
      const ask = cart.onInput(s, half, c);
      c.inputs = inputs;
      const asked = cart.onInput(ask, inputs, c);
      const rev = cart.action(asked, 'stop', null, c);
      out.push({ ask, rev, now: c._now });
      s = rev;
      if (k < CD.CARDS.length - 1) { s = cart.action(s, 'next', null, c); }
    }
    const fin = cart.action(out[out.length - 1].rev, 'final', null, c);
    return { list: out, fin, now: c._now };
  };
  // ── 저녁 회의: 하루(첫 마음 · 회의 · 상황 카드 · 다시 투표 · 동률 · 결과) + 사흘 결과 · 정리 ──
  //   opt.tie = 다시 투표에서 팀마다 표를 번갈아(0 · 1) 내어 동률을 만든다 · opt.day = 그날 화면(0 · 1 · 2)
  W.dinnerStates = (teams, opt = {}) => {
    const c = W.ctx(teams, { offline: !!opt.offline });
    const firstIn = () => {
      const inp = {}; let j = 0;
      for (const t of teams) for (const u of t.online) {
        j++;
        if (opt.partial && j % 3 === 0) continue;
        inp[u] = { m: (j + Number(t.id.slice(1))) % 3, t: c._now + j * 50 };
      }
      return inp;
    };
    const secondIn = (tie) => {
      const inp = {}; let j = 0;
      for (const t of teams) for (const [k, u] of t.online.entries()) {
        j++;
        if (opt.partial && j % 3 === 0) continue;
        const ti = Number(t.id.slice(1));
        const m = tie ? k % 2 : (ti % 3 === 0 ? j % 3 : ti % 3);
        const bits = [1, 2, 4, 8, 16, 32];
        const rs = u.startsWith('proxy-') ? (1 | 4 | 8 | 32) : (bits[j % 6] | (j % 2 ? bits[(j + 1) % 6] : 0));
        inp[u] = { m, rs, t: c._now + j * 50 };
      }
      return inp;
    };
    const runDay = (s, tie) => {
      let v = dinner.action(s, 'v1', null, c);
      const in1 = firstIn(); c._now += 3000; c.inputs = in1; v = dinner.onInput(v, in1, c);
      const vote1 = v;
      c._now = v.deadline + 1000; c.inputs = in1;
      const talk = dinner.tick(v, c);
      c._now += 1000;
      const twist = dinner.action(talk, 'twist', null, c);
      let v2 = dinner.action(twist, 'v2', null, c);
      const in2 = secondIn(tie); c._now += 3000; c.inputs = in2; v2 = dinner.onInput(v2, in2, c);
      const vote2 = v2;
      c._now = v2.deadline + 1000;
      let after = dinner.tick(v2, c);
      let tieS = null, tiev = null;
      if (after.step === 'tie') {
        tieS = after;
        c._now = after.deadline + 10;
        tiev = dinner.tick(after, c);
        const in3 = {};
        for (const t of teams) if (tiev.tie.teams[t.id]) t.online.forEach((u, k) => { if (k % 3 !== 2) in3[u] = { m: tiev.tie.teams[t.id][0], t: c._now }; });
        c.inputs = in3; tiev = dinner.onInput(tiev, in3, c);
        c._now = tiev.deadline + 1000;
        after = dinner.tick(tiev, c);
        if (after.step === 'tie') after = dinner.action(after, 'draw', null, c);
      }
      return { vote1, talk, twist, vote2, tie: tieS, tiev, show: after };
    };
    const s0 = dinner.setup(c);
    let st = s0, info = s0, day;
    for (let d = 0; d < 3; d++) {
      if (d) { st = dinner.action(st, 'next', null, c); }
      const D = runDay(st, opt.tie && d === (opt.day || 0));
      if (d === (opt.day || 0)) { day = D; info = st; }
      st = D.show;
    }
    const final = dinner.action(st, 'next', null, c);
    const wrap = dinner.action(final, 'wrap', null, c);
    return { s0: info, ...day, final, wrap, now: c._now };
  };
  W.host = (game, s, teams, now, extra) => {
    const el = document.getElementById('gameEl');
    el.dataset.key = ''; el.innerHTML = '';
    document.querySelectorAll('.gk-confetti').forEach(x => x.remove());
    const c = W.ctx(teams, extra); c._now = now;
    window.G[game].hostView(el, s, c);
  };
  W.proxy = (game, s, teams) => {
    const box = document.getElementById('proxyEl');
    const c = W.ctx(teams, { offline: true });
    const rows = teams.map(t => ({ t, b: window.G[game].proxyButtons(s, t, c) || [] })).filter(r => r.b.length);
    box.innerHTML = rows.length ? `<div class="proxy-h">대신 누르기 <span class="dim">— 팀이 말하는 대로 교사가 누른다</span></div><div class="proxy-rows">${rows.map(({ t, b }) => `<div class="proxy-row" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}"><span class="proxy-t">${t.emoji} ${t.name}</span>${b.map(x => `<button class="pbtn">${x.label}</button>`).join('')}</div>`).join('')}</div>` : '';
  };
  // 코어처럼 다음 0.2초 틱에 한 번 더 그리기(뼈대는 그대로, 값만 갱신)
  W.again = (game, s, teams, now, extra) => { const c = W.ctx(teams, extra); c._now = now; window.G[game].hostView(document.getElementById('gameEl'), s, c); };
  W.noproxy = () => { document.getElementById('proxyEl').innerHTML = ''; };
  W.play = (game, s, me, teams, now, li) => {
    const el = document.getElementById('gp');
    el.dataset.key = ''; el.dataset.edit = ''; el.innerHTML = ''; el.__li = li || 0;
    const c = { now: () => now, send() {}, teams: Object.fromEntries(teams.map(t => [t.id, t])), team: teams.find(t => t.id === me.team) };
    window.G[game].playView(el, s, me, c);
  };
};
await host.evaluate(BOOT); await play.evaluate(BOOT);

const report = { started: new Date().toISOString(), shots: [], errors };
let fails = 0, n = 0;
async function snap(page, name, wait = 900) {
  await page.bringToFront();
  await page.waitForTimeout(wait);
  await page.evaluate(() => document.querySelectorAll('.gk-confetti').forEach(x => x.remove()));
  n++;
  const f = `${String(n).padStart(3, '0')}-${name}.png`;
  await page.screenshot({ path: path.join(OUT, f), timeout: 120000 });
  const issues = await page.evaluate(layoutIssues);
  report.shots.push({ f, issues });
  if (issues.length) { fails++; console.log(`  ✗ ${f} — ${issues.slice(0, 4).join(' | ')}`); }
  else console.log(`  ✓ ${f}`);
}

// 팀 구성: [이름, 팀 크기 배열, 대신 누르기 표가 섞인 팀]
const SETS = {
  t3: [4, 4, 2],                      // 작은 반 10명
  t4: [4, 4, 4, 4],
  t5x6: [6, 6, 6, 6, 6],              // 6명 팀 30명
  t5x6b: [6, 6, 5, 5, 5],             // 6명 팀 27명
  t8: [4, 4, 4, 4, 4, 4, 3, 3],       // 4명 팀 30명
};

try {
  if (!ONLY || ONLY === 'cart') {
    console.log('\n[장바구니 탐정] 진행판 — 카드 15장 정답 공개 (팀 8개)');
    const T8 = await host.evaluate(s => W.teams(s), SETS.t8);
    const st = await host.evaluate(t => { const r = W.cartStates(t); return r; }, T8);
    for (let i = 0; i < st.list.length; i++) {
      const x = st.list[i];
      await host.evaluate(([s, t, now]) => W.host('cart', s, t, now), [x.rev, T8, x.now]);
      await snap(host, `cart-host-reveal-${x.rev.idx}-${x.rev.ci}`, 700);
    }
    console.log('\n[장바구니 탐정] 진행판 — 묻기 (읽는 중 · 고르는 중) · 최종');
    const a0 = st.list[0].ask;
    await host.evaluate(([s, t]) => W.host('cart', s, t, s.startAt - 800), [a0, T8]);
    await snap(host, 'cart-host-ask-ready', 600);
    await host.evaluate(([s, t]) => W.host('cart', s, t, s.startAt + 4000), [a0, T8]);
    await snap(host, 'cart-host-ask-8teams', 600);
    await host.evaluate(([s, t]) => W.host('cart', s, t, s.startAt + 8200), [st.list[5].ask, T8]);
    await snap(host, 'cart-host-ask-hot', 600);
    await host.evaluate(([s, t, now]) => W.host('cart', s, t, now), [st.fin, T8, st.now]);
    await snap(host, 'cart-host-final-8teams', 1500);
    for (const [k, sizes] of [['t3', SETS.t3], ['t5x6', SETS.t5x6]]) {
      const T = await host.evaluate(s => W.teams(s), sizes);
      const r = await host.evaluate(t => W.cartStates(t), T);
      await host.evaluate(([s, t]) => W.host('cart', s, t, s.startAt + 4000), [r.list[0].ask, T]);
      await snap(host, `cart-host-ask-${k}`, 600);
      await host.evaluate(([s, t, now]) => W.host('cart', s, t, now), [r.list[1].rev, T, r.list[1].now]);
      await snap(host, `cart-host-reveal-${k}`, 700);
      await host.evaluate(([s, t, now]) => W.host('cart', s, t, now), [r.fin, T, r.now]);
      await snap(host, `cart-host-final-${k}`, 1500);
    }
    console.log('\n[장바구니 탐정] 비상 모드 — 대신 누르기 칸 (팀 8개)');
    const TO = await host.evaluate(s => W.teams(s.map(() => 0), s.map((_, i) => i)), SETS.t8);
    const so = await host.evaluate(t => W.cartStates(t), TO);
    await host.evaluate(([s, t]) => { W.host('cart', s, t, s.startAt + 3000, { offline: true }); W.proxy('cart', s, t); W.again('cart', s, t, s.startAt + 3000, { offline: true }); }, [so.list[3].ask, TO]);
    await snap(host, 'cart-host-offline-ask-8teams', 600);
    await host.evaluate(([s, t, now]) => { W.host('cart', s, t, now, { offline: true }); W.noproxy(); W.again('cart', s, t, now, { offline: true }); }, [so.list[3].rev, TO, so.list[3].now]);
    await snap(host, 'cart-host-offline-reveal-8teams', 700);

    console.log('\n[장바구니 탐정] 조종기 — 카드 15장 (고르기 · 정답)');
    for (let i = 0; i < st.list.length; i++) {
      const { ask, rev } = st.list[i];
      const me = { uid: 'u1', num: 1, team: 't1', mine: null };
      const askNoMe = { ...ask, first: {} };
      await play.evaluate(([s, me, t]) => W.play('cart', s, me, t, s.startAt + 2000), [askNoMe, me, T8]);
      await snap(play, `cart-play-ask-${i + 1}-${ask.ci}`, 350);
      await play.evaluate(([s, me, t]) => W.play('cart', s, me, t, s.startAt + 9000), [rev, { ...me, uid: i % 3 === 0 ? 'u7' : 'u1' }, T8]);
      await snap(play, `cart-play-reveal-${i + 1}-${ask.ci}`, 350);
    }
    const me1 = { uid: 'u1', num: 1, team: 't1', mine: null };
    await play.evaluate(([s, me, t]) => W.play('cart', s, me, t, s.startAt - 900), [{ ...st.list[0].ask, first: {} }, me1, T8]);
    await snap(play, 'cart-play-reading', 350);
    await play.evaluate(([s, me, t]) => W.play('cart', s, me, t, s.startAt + 3000), [st.list[0].ask, { ...me1, mine: { c: st.list[0].ask.choices[2] } }, T8]);
    await snap(play, 'cart-play-picked', 500);
    await play.evaluate(([s, me, t]) => W.play('cart', s, me, t, s.startAt + 3000), [st.list[0].ask, { ...me1, uid: 'late' }, T8]);
    await snap(play, 'cart-play-watch', 350);
    await play.evaluate(([s, me, t]) => W.play('cart', s, me, t, 0), [st.fin, me1, T8]);
    await snap(play, 'cart-play-final', 500);
  }

  if (!ONLY || ONLY === 'dinner') {
    console.log('\n[가족 저녁 회의] 진행판 — 팀 3 · 4 · 5 · 8개 (6명 팀 + 대신 누르기 표 섞임)');
    const H = (s, t, now, extra) => host.evaluate(([s, t, now, e]) => W.host('dinner', s, t, now, e), [s, t, now, extra]);
    for (const [k, sizes, px] of [['t3', SETS.t3, []], ['t4', SETS.t4, []], ['t5x6', SETS.t5x6, [0, 3]], ['t5x6b', SETS.t5x6b, [1]], ['t8', SETS.t8, [6]]]) {
      const T = await host.evaluate(([s, p]) => W.teams(s, p), [sizes, px]);
      const d = await host.evaluate(t => W.dinnerStates(t, { tie: true }), T);
      if (k === 't8' || k === 't5x6' || k === 't3') {
        await H(d.s0, T, 0); await snap(host, `dinner-host-info-d1-${k}`, 1000);
      }
      await H(d.vote1, T, d.vote1.deadline - 2500); await snap(host, `dinner-host-vote1-${k}`, 700);
      await H(d.talk, T, d.talk.deadline - 61000); await snap(host, `dinner-host-talk-${k}`, 900);
      if (k === 't8' || k === 't4') { await H(d.twist, T, d.twist.deadline - 20000); await snap(host, `dinner-host-twist-${k}`, 900); }
      await H(d.vote2, T, d.vote2.deadline - 2500); await snap(host, `dinner-host-vote2-${k}`, 700);
      if (d.tie) {
        await H(d.tie, T, d.tie.deadline - 20000); await snap(host, `dinner-host-tie-${k}`, 800);
        await H(d.tiev, T, d.tiev.deadline - 10000); await snap(host, `dinner-host-tiev-${k}`, 700);
      }
      await H(d.show, T, d.now); await snap(host, `dinner-host-show-${k}`, 1600);
      const plain = await host.evaluate(t => W.dinnerStates(t), T);
      await H(plain.show, T, plain.now); await snap(host, `dinner-host-show-notie-${k}`, 1600);
      if (k !== 't4') { await H(d.final, T, d.now); await snap(host, `dinner-host-final-${k}`, 1500); }
      if (k === 't8') { await H(d.wrap, T, d.now); await snap(host, 'dinner-host-wrap', 1300); }
    }
    // 2 · 3일째 (메뉴 이름이 다르다) — 정보 · 결과
    const T8 = await host.evaluate(s => W.teams(s), SETS.t8);
    for (const day of [1, 2]) {
      const d = await host.evaluate(([t, day]) => W.dinnerStates(t, { day }), [T8, day]);
      await H(d.s0, T8, 0); await snap(host, `dinner-host-info-d${day + 1}-t8`, 1000);
      await H(d.twist, T8, d.twist.deadline - 20000); await snap(host, `dinner-host-twist-d${day + 1}`, 900);
      await H(d.talk, T8, d.talk.deadline - 30000); await snap(host, `dinner-host-talk-d${day + 1}`, 800);
      await H(d.show, T8, d.now); await snap(host, `dinner-host-show-d${day + 1}-t8`, 1600);
    }
    // 상황 카드 전부 (3일 × 4장)
    for (let day = 0; day < 3; day++) {
      const d = await host.evaluate(([t, day]) => W.dinnerStates(t, { day }), [T8, day]);
      const n = await host.evaluate(day => window.G.DD.ROUNDS[day].twists.length, day);
      for (let i = 0; i < n; i++) {
        await H({ ...d.twist, tw: i }, T8, d.twist.deadline - 20000);
        await snap(host, `dinner-host-twistcard-d${day + 1}-${i}`, 700);
      }
    }
    // 덜 낸 투표(진행 중) · 비상 모드
    const T6 = await host.evaluate(s => W.teams(s), SETS.t5x6);
    const dp = await host.evaluate(t => W.dinnerStates(t, { partial: true }), T6);
    await H(dp.vote2, T6, dp.vote2.deadline - 20000); await snap(host, 'dinner-host-vote2-partial-t5x6', 800);
    const TO = await host.evaluate(s => W.teams(s.map(() => 0), s.map((_, i) => i)), SETS.t8);
    const dO = await host.evaluate(t => W.dinnerStates(t, { offline: true }), TO);
    await host.evaluate(([s, t]) => { W.host('dinner', s, t, 0, { offline: true }); W.noproxy(); }, [dO.s0, TO]);
    await snap(host, 'dinner-host-offline-info-8', 1000);
    for (const [nm, st] of [['vote1', dO.vote1], ['vote2', dO.vote2]]) {
      await host.evaluate(([s, t, now]) => { W.host('dinner', s, t, now, { offline: true }); W.proxy('dinner', s, t); W.again('dinner', s, t, now, { offline: true }); }, [st, TO, st.deadline - 10000]);
      await snap(host, `dinner-host-offline-${nm}-8`, 800);
    }
    await host.evaluate(([s, t, now]) => { W.host('dinner', s, t, now, { offline: true }); W.noproxy(); }, [dO.show, TO, dO.now]);
    await snap(host, 'dinner-host-offline-show-8', 1600);
    await host.evaluate(() => W.noproxy());

    console.log('\n[가족 저녁 회의] 조종기 — 역할 7개 × 3일 대사 + 같은 역할 다른 대사');
    const T7 = await play.evaluate(() => W.teams([7, 4]));
    const days7 = [];
    for (const day of [0, 1, 2]) days7.push(await play.evaluate(([t, day]) => W.dinnerStates(t, { day, tie: true }), [T7, day]));
    for (const [day, d7] of days7.entries()) {
      for (const u of T7[0].members) {
        const role = d7.s0.roles[u];
        await play.evaluate(([s, me, t, li]) => W.play('dinner', s, me, t, 0, li), [d7.s0, { uid: u, num: 1, team: 't1', mine: null }, T7, 0]);
        await snap(play, `dinner-play-role-d${day + 1}-${role}`, 650);
        if (day === 0) {
          await play.evaluate(([s, me, t, li]) => W.play('dinner', s, me, t, 0, li), [d7.s0, { uid: u, num: 1, team: 't1', mine: null }, T7, 1]);
          await snap(play, `dinner-play-role-d1-${role}-alt`, 500);
        }
      }
    }
    for (const [day, d7] of days7.entries()) {
      const u0 = T7[0].members[0];
      const me = { uid: u0, num: 1, team: 't1' };
      const P = (s, mine, now, extra = {}) => play.evaluate(([s, me, t, now]) => W.play('dinner', s, me, t, now), [s, { ...me, ...extra, mine }, T7, now]);
      const D = `d${day + 1}`;
      await P(d7.vote1, null, d7.vote1.deadline - 2000); await snap(play, `dinner-play-vote1-${D}`, 450);
      await P(d7.vote1, { m: 1 }, d7.vote1.deadline - 2000); await snap(play, `dinner-play-vote1-picked-${D}`, 400);
      await P(d7.talk, null, d7.talk.deadline - 40000); await snap(play, `dinner-play-talk-${D}`, 500);
      await P(d7.twist, null, d7.twist.deadline - 20000); await snap(play, `dinner-play-twist-${D}`, 500);
      await P(d7.vote2, null, d7.vote2.deadline - 2000); await snap(play, `dinner-play-vote2-menu-${D}`, 400);
      if (day === 0) {
        await P(d7.vote2, { m: 0, rs: 0 }, d7.vote2.deadline - 2000); await snap(play, 'dinner-play-why-none', 400);
        await play.evaluate(([s, me, t, now]) => { W.play('dinner', s, me, t, now); const w = document.querySelector('.dv-warn'); w.textContent = '근거는 2개까지! 하나를 끄고 골라요'; }, [d7.vote2, { ...me, mine: { m: 2, rs: 1 | 8 } }, T7, d7.vote2.deadline - 2000]);
        await snap(play, 'dinner-play-why-max', 400);
        // 회의: 한 사람만 있는 팀(작은 팀) · 첫 마음이 모두 같은 팀
        await P(d7.talk, null, d7.talk.deadline - 40000, { uid: T7[1].members[0], team: 't2' }); await snap(play, 'dinner-play-talk-team4', 450);
        // 상황 카드: 내 역할이 관련된 사람
        const tw = await play.evaluate(([day, i]) => window.G.DD.ROUNDS[day].twists[i].who, [day, d7.twist.tw]);
        const uWho = T7[0].members.find(u => tw.includes(d7.s0.roles[u]));
        if (uWho) { await P(d7.twist, null, d7.twist.deadline - 20000, { uid: uWho }); await snap(play, 'dinner-play-twist-mine', 450); }
      }
      if (d7.tie) {
        const tiedTid = Object.keys(d7.tie.tie.teams)[0];
        const tu = T7.find(t => t.id === tiedTid).members[0];
        const freeT = T7.find(t => !d7.tie.tie.teams[t.id]);
        await P(d7.tie, null, d7.tie.deadline - 20000, { uid: tu, team: tiedTid }); await snap(play, `dinner-play-tie-${D}`, 450);
        if (freeT) { await P(d7.tie, null, d7.tie.deadline - 20000, { uid: freeT.members[0], team: freeT.id }); await snap(play, `dinner-play-tie-wait-${D}`, 400); }
        await P(d7.tiev, null, d7.tiev.deadline - 10000, { uid: tu, team: tiedTid }); await snap(play, `dinner-play-tiev-${D}`, 400);
        await P(d7.tiev, { m: d7.tiev.tie.teams[tiedTid][0] }, d7.tiev.deadline - 10000, { uid: tu, team: tiedTid }); await snap(play, `dinner-play-tiev-picked-${D}`, 400);
      }
      // 결과: 설득 · 바꿈 · 지킴 · 투표 없음
      const per = d7.show.res.per;
      for (const tag of ['p', 's', 'c', 'k']) {
        const u = Object.keys(per).find(x => per[x] === tag);
        if (!u) continue;
        const tm = T7.find(t => t.members.includes(u)).id;
        await P(d7.show, null, 0, { uid: u, team: tm }); await snap(play, `dinner-play-show-${D}-${tag}`, 400);
      }
      if (day === 0) { await P(d7.show, null, 0, { uid: 'nobody' }); await snap(play, 'dinner-play-show-novote', 400); }
    }
    const dl = days7[0];
    await play.evaluate(([s, me, t]) => W.play('dinner', s, me, t, 0), [dl.final, { uid: T7[0].members[0], num: 1, team: 't1', mine: null }, T7]);
    await snap(play, 'dinner-play-final', 450);
    await play.evaluate(([s, me, t]) => W.play('dinner', s, me, t, 0), [dl.wrap, { uid: T7[0].members[0], num: 1, team: 't1', mine: null }, T7]);
    await snap(play, 'dinner-play-wrap', 400);
  }
} catch (e) {
  fails++; console.error(e); report.crash = e.message;
} finally {
  await browser.close().catch(() => {});
  stat.close();
  report.fails = fails; report.count = n;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n화면 ${n}장 · 레이아웃 문제 ${fails}장 · 페이지 오류 ${errors.length}건${errors.length ? '\n  ' + errors.slice(0, 8).join('\n  ') : ''}`);
  process.exit(fails || errors.length ? 1 : 0);
}
