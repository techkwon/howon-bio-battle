// 14~16차시 플레이테스트(재미 · 공정 · 장난 점검): 진행판 1 + 조종기 12 (가짜 DB, 실제 Firebase 아님)
//   node test/playtest14_16.mjs [--headed] [--only auction,sort,cart,dinner,pitch]
// 결과: test/playtest14_16/*.png (진행판 1366×768 · 조종기 1366×768) + test/playtest14_16/report.json
// 실제 games/index.js 목록을 test/site_pt14_16/ 에 따로 묶는다(site/dist 는 건드리지 않음).
// 학생 성격: comp(경쟁형) · normal · lazy(무기력 · 안 누름) · slow(느림 · 경쟁 싫음) · prank(장난: 연타 · 팀 코인 탕진 · 막말 이름 · 몰빵 투자)
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { startMock } from './mockdb.mjs';
import { startStatic } from './serve.mjs';
import { CARDS, BID_SECONDS, BID_CAP, baseOf } from '../site/games/auction-data.js';
import { CARDS as CART } from '../site/games/cart-data.js';
import { ROUNDS as DAYS } from '../site/games/dinner-data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : d; };
const HEADED = !!arg('headed', false);
const ONLY = String(arg('only', 'auction,sort,cart,dinner,pitch')).split(',');
const VIEW = { width: 1366, height: 768 };
const OUT = path.join(here, String(arg('out', 'playtest14_16')));   // 마지막 점검: --out playtest_final
const SITE_DIR = path.join(here, 'site_pt14_16');
fs.mkdirSync(OUT, { recursive: true });
const KEEP = !!arg('keep', false);   // 앞 판 스크린샷을 지우지 않고 이어 찍는다(--only 와 함께)
if (!KEEP) for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.unlinkSync(path.join(OUT, f));

// ── 묶기: 실제 목록 그대로 ──
fs.mkdirSync(path.join(SITE_DIR, 'dist'), { recursive: true });
for (const f of ['host.html', 'index.html', 'play.html', 'styles.css']) fs.copyFileSync(path.join(root, 'site', f), path.join(SITE_DIR, f));
await esbuild.build({
  entryPoints: { host: path.join(root, 'site/src/core-host.js'), play: path.join(root, 'site/src/core-play.js') },
  bundle: true, outdir: path.join(SITE_DIR, 'dist'), format: 'iife', target: ['chrome100'], minify: false, logLevel: 'warning',
});

async function loadPlaywright() {
  try { return await import('playwright'); } catch {}
  const cache = path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx');
  if (fs.existsSync(cache)) {
    const found = fs.readdirSync(cache).map(d => path.join(cache, d, 'node_modules', 'playwright'))
      .filter(p => fs.existsSync(path.join(p, 'package.json')));
    for (const p of found) { try { return await import(pathToFileURL(path.join(p, 'index.mjs')).href); } catch {} }
  }
  throw new Error('playwright 없음');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const R = { started: new Date().toISOString(), notes: [], timings: {}, errors: [], fonts: {}, auction: [], sort: [], cart: [], dinner: {}, pitch: {}, abuse: {} };
const note = (k, v) => { R.notes.push({ k, v }); console.log(`  · ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`); };
let shotNo = KEEP ? fs.readdirSync(OUT).filter(f => f.endsWith('.png') && !/FATAL/.test(f)).length : 0;
if (KEEP) for (const f of fs.readdirSync(OUT)) if (/FATAL/.test(f)) fs.unlinkSync(path.join(OUT, f));
async function shot(page, name) {
  shotNo++;
  await page.screenshot({ path: path.join(OUT, `${String(shotNo).padStart(2, '0')}-${name}.png`) }).catch(e => R.errors.push('shot ' + name + ': ' + e.message));
}
async function smallText(page, label) {
  R.fonts[label] = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('#stage *')) {
      const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
      if (!own) continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0 || b.bottom > innerHeight || b.right > innerWidth) continue;
      out.push({ fs: parseFloat(getComputedStyle(el).fontSize), t: own.slice(0, 40) });
    }
    out.sort((a, b) => a.fs - b.fs);
    return out.slice(0, 6);
  }).catch(() => []);
}

const stat = await startStatic({ port: 8133, root: SITE_DIR });
const mock = await startMock({ port: 8837, latency: 60 });
const SITE = `http://127.0.0.1:${stat.port}`;
const Q = `?mock=http://127.0.0.1:${mock.port}`;
const { chromium } = await loadPlaywright();
let browser;
try { browser = await chromium.launch({ channel: 'chrome', headless: !HEADED }); } catch { browser = await chromium.launch({ headless: !HEADED }); }

async function newCtx() {
  const ctx = await browser.newContext({ viewport: VIEW, locale: 'ko-KR' });
  ctx.setDefaultTimeout(60000); ctx.setDefaultNavigationTimeout(90000);
  return ctx;
}
function watch(page, who) {
  page.on('pageerror', e => R.errors.push(`${who}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|WebSocket/.test(m.text())) R.errors.push(`${who} console: ${m.text().slice(0, 160)}`); });
  page.on('dialog', d => d.accept().catch(() => {}));
}
/** 학생 단추: DOM click (다른 시험과 CPU 를 나눠 써도 늦지 않게) */
async function tap(page, sel, timeout = 4000) {
  const end = Date.now() + timeout;
  for (;;) {
    const ok = await page.evaluate(sel => { const b = document.querySelector(sel); if (!b || b.disabled) return false; b.click(); return true; }, sel).catch(() => false);
    if (ok) return true;
    if (Date.now() > end) return false;
    await sleep(100);
  }
}

const N = 12;
const PERSONA = { 1: 'comp', 2: 'comp', 3: 'normal', 4: 'lazy', 5: 'normal', 6: 'slow', 7: 'comp', 8: 'normal', 9: 'prank', 10: 'normal', 11: 'slow', 12: 'normal' };
const hostCtx = await newCtx();
const host = await hostCtx.newPage();
watch(host, 'host');
const H = (fn, a) => host.evaluate(fn, a);
// 게임이 끝나 g 가 비는 순간에도 깨지지 않게: 판정 함수 안의 오류는 「아직」으로 본다
const waitH = (fn, a, timeout = 30000) => host.waitForFunction(`(() => { try { return (${fn.toString()})(${JSON.stringify(a ?? null)}); } catch (e) { return false; } })()`, null, { timeout, polling: 100 });
const G = () => H(() => window.__bbHost.g);
const act = async name => { const ok = await H(n => { const b = document.querySelector(`[data-act="${n}"]`); if (!b) return false; b.click(); return true; }, name); if (!ok) throw new Error('단추 없음 ' + name); };
const actSoft = name => H(n => { const b = document.querySelector(`[data-act="${n}"]`); if (b) b.click(); }, name).catch(() => {});
const S = [];
const T0 = Date.now();
const LESSON = { auction: 14, sort: 14, cart: 15, dinner: 15, pitch: 16 };
async function openGame(gid) {
  await H(l => { const t = document.querySelector(`.ltab[data-lesson="${l}"]`); if (t) t.click(); }, LESSON[gid]);
  await host.waitForSelector(`.gcard[data-gid="${gid}"]`, { timeout: 8000 });
  await host.click(`.gcard[data-gid="${gid}"]`);
  await host.waitForSelector('#bGo');
  await sleep(500);
}
const scores = () => H(() => Object.fromEntries(Object.entries(window.__bbHost.teams).map(([k, t]) => [k, t.score])));
const by = w => S.filter(s => s.who === w);
const C = () => S[0];   // 늘 찍는 조종기: 1번(경쟁형)

try {
  await host.goto(`${SITE}/host.html${Q}`);
  await host.waitForSelector('#bCreate:not([disabled])', { timeout: 20000 });
  await host.click('#segCls .segb[data-v="4"]');
  await host.click('#segSize .segb[data-v="4"]');
  await host.click('#segMode .segb[data-v="assign"]');
  await host.click('#bCreate');
  await waitH(() => window.__bbHost.code && window.__bbHost.meta.phase === 'lobby');
  const code = await H(() => window.__bbHost.code);
  for (let i = 1; i <= N; i++) {
    const ctx = await newCtx(); const page = await ctx.newPage(); watch(page, 's' + i);
    await page.goto(`${SITE}/${Q}`); await page.waitForSelector('#iCode', { timeout: 20000 });
    S.push({ ctx, page, num: i, who: PERSONA[i] });
  }
  await Promise.all(S.map(async s => { await s.page.fill('#iCode', code); await s.page.fill('#iNum', String(s.num)); await s.page.click('button[type=submit]'); }));
  await waitH(n => Object.values(window.__bbHost.players).filter(p => p.on).length >= n, N);
  for (const s of S) s.uid = await s.page.evaluate(() => window.__bbPlay.net.uid);
  await host.click('#bTeam');
  await host.waitForSelector('#bShuf', { timeout: 10000 });
  await host.click('#bShuf'); await sleep(300); await host.click('#bOK');
  await waitH(() => window.__bbHost.meta.phase === 'result' && Object.keys(window.__bbHost.roster).length >= 12);
  const roster = await H(() => window.__bbHost.roster);
  for (const s of S) s.team = roster[s.uid].team;
  const teamIds = [...new Set(S.map(s => s.team))].sort();
  note('팀(번호+성격 첫 글자)', Object.fromEntries(teamIds.map(t => [t, S.filter(s => s.team === t).map(s => `${s.num}${s.who[0]}`).join(',')])));
  R.team = Object.fromEntries(teamIds.map(t => [t, S.filter(s => s.team === t).map(s => s.who)]));
  R.timings.toHub = Date.now() - T0;
  await sleep(600);
  await H(() => { const t = document.querySelector('.ltab[data-lesson="14"]'); if (t) t.click(); });
  await sleep(300);
  await shot(host, 'host-hub-14');

  // ═══ 14차시 · 바이오 경매 ═══
  if (ONLY.includes('auction')) {
    const tA = Date.now();
    await openGame('auction');
    await shot(host, 'auction-intro'); await shot(C().page, 'auction-play-intro'); await smallText(host, 'auction-intro');
    await host.click('#bGo');
    await waitH(() => window.__bbHost.g && window.__bbHost.g.step === 'look');
    const prank = by('prank')[0];
    for (let i = 0; i < 12; i++) {
      await waitH(i => window.__bbHost.g.step === 'look' && window.__bbHost.g.i === i, i, 25000);
      if (i === 0) { await sleep(500); await shot(host, 'auction-look'); await shot(C().page, 'auction-play-look'); await smallText(host, 'auction-look'); }
      await sleep(1500);   // 「한 줄 광고」 자리(실제 수업은 20~30초 → 아래 시간 어림에 따로 더한다)
      await act('open');
      await waitH(() => window.__bbHost.g.step === 'bid');
      const tBid = Date.now();
      const natural = true;     // 모든 카드를 실제 마감(15초 + 막판 연장)까지
      const runBidders = Promise.all(S.map(async s => {
        const end = Date.now() + (BID_SECONDS * 1000 - 500);
        if (s.who === 'lazy') return;
        if (s.who === 'prank') {                                  // 장난: 팀 코인으로 +200 연타
          for (let r = 0; r < 6 && Date.now() < end; r++) { await tap(s.page, '.aup-b[data-d="200"]:not([disabled])', 600); await sleep(250); }
          return;
        }
        if (s.who === 'slow') {                                   // 마감 1초 전 끼어들기(스나이핑)
          if (!natural || Math.random() < 0.5) return;
          await sleep(Math.max(0, end - Date.now() - 1500));
          await tap(s.page, '.aup-b[data-d="50"]:not([disabled])', 800);
          return;
        }
        const cap = s.who === 'comp' ? BID_CAP : 250;
        while (Date.now() < end) {
          await sleep(rnd(700, 2500));
          const st = await s.page.evaluate(() => ({ price: Number((document.querySelector('.aup-price b')?.textContent || '0').replace(/[^0-9]/g, '')) || 0, lead: !!document.querySelector('.aup-wait.lead') })).catch(() => ({ price: 9999, lead: true }));
          if (st.lead || st.price >= cap) { if (s.who !== 'comp') return; continue; }
          if (Math.random() < (s.who === 'comp' ? 0.8 : 0.35)) await tap(s.page, `.aup-b[data-d="${pick([50, 100])}"]:not([disabled])`, 600);
        }
      }));
      if (i === 0) { await sleep(3000); await shot(host, 'auction-bid'); await shot(C().page, 'auction-play-bid'); await shot(prank.page, 'auction-play-prank'); await smallText(host, 'auction-bid'); }
      if (natural) {
        if (i === 1) { await waitH(() => window.__bbHost.g.deadline - window.__bbHost.net.serverNow() < 2500, null, 25000); await shot(host, 'auction-bid-hot'); }
        await waitH(i => window.__bbHost.g.hist.length > i, i, 30000);
      } else {
        await runBidders.catch(() => {});
        await sleep(400);
        await actSoft('hammer');
        await waitH(i => window.__bbHost.g.hist.length > i, i, 15000);
      }
      await runBidders.catch(() => {});
      const g = await G();
      const h = g.hist[i];
      R.auction.push({ card: CARDS[h.c].name, x: CARDS[h.c].future.x, value: Math.round(baseOf(CARDS[h.c]) * CARDS[h.c].future.x), team: h.team, paid: h.paid, bids: g.hi ? g.hi.n : 0, ext: g.ext || 0, bidMs: Date.now() - tBid, coins: { ...g.coins } });
      if (i === 0) { await sleep(600); await shot(host, 'auction-sold'); await shot(C().page, 'auction-play-sold'); }
      if (i === 5) await shot(host, 'auction-mid-coins');
      await actSoft('next');
    }
    note('카드 순서(섞임)', R.auction.map(a => a.card).join(' → '));
    note('경매 낙찰(낙찰가 → 2040 가치)', R.auction.map(a => `${a.card}:${a.team || '유찰'} ${a.paid}→${a.team ? a.value : '-'}`).join(' · '));
    note('막판 연장된 카드', R.auction.filter(a => a.ext > 0).map(a => `${a.card} +${a.ext / 1000}초`).join(' · ') || '없음');
    note('입찰 시간(카드마다 · 초)', R.auction.map(a => (a.bidMs / 1000).toFixed(1)).join(' '));
    note('경매 남은 코인(6장 뒤)', R.auction[5].coins);
    // 코인이 바닥난 팀이 몇 장째부터 구경만 했나
    R.abuse.brokeAfter = Object.fromEntries(teamIds.map(t => [t, (R.auction.findIndex(a => a.coins[t] < 50) + 1) || null]));
    note('코인 50 미만이 된 카드 번호(그 뒤로는 구경만)', R.abuse.brokeAfter);
    R.timings.auctionBidding = Date.now() - tA;
    await waitH(() => window.__bbHost.g.step === 'fut', null, 15000);
    const tR = Date.now();
    await waitH(() => window.__bbHost.g.fut.length >= 1, null, 10000);
    await sleep(500); await shot(host, 'auction-2040-1');
    await waitH(() => window.__bbHost.g.fut.length >= 4, null, 40000);
    await sleep(500); await shot(host, 'auction-2040-4'); await shot(C().page, 'auction-play-2040'); await smallText(host, 'auction-2040');
    // 저절로 다 열릴 때까지(낙찰 카드 6.5초 · 유찰 3.5초) — 교사가 「다음 카드」를 안 누를 때의 최장 시간
    await waitH(() => window.__bbHost.g.fut.length >= window.__bbHost.g.hist.length && !window.__bbHost.g.rvAt, null, 120000);
    R.timings.auctionReveal = Date.now() - tR;
    await sleep(900); await shot(host, 'auction-2040-all');
    await act('final'); await waitH(() => window.__bbHost.g.step === 'final');
    await sleep(1500);
    const gf = await G();
    R.auctionFinal = { assets: gf.assets, coins: gf.coins, tech: gf.tech, rank: gf.rank };
    note('경매 최종 자산', gf.assets);
    await shot(host, 'auction-final'); await shot(C().page, 'auction-play-final');
    const poor = S.find(s => gf.rank[s.team] === teamIds.length);
    if (poor) await shot(poor.page, 'auction-play-final-last');
    await act('finish');
    await waitH(() => window.__bbHost.meta.phase === 'result' && window.__bbHost.core.last && window.__bbHost.core.last.gid === 'auction', null, 15000);
    await sleep(1200); await shot(host, 'auction-result');
    R.timings.auction = Date.now() - tA;
    // 실제 수업 어림: 카드마다 한 줄 광고 25초(시험은 1.5초) + 낙찰 화면은 저절로 4.5초
    R.timings.auctionLessonEstimate = R.timings.auction + 12 * (25000 - 1500);
    note('경매 시간', `시험 ${(R.timings.auction / 60000).toFixed(1)}분(입찰 ${(R.timings.auctionBidding / 60000).toFixed(1)} · 2040 공개 ${(R.timings.auctionReveal / 1000).toFixed(0)}초) → 광고 25초씩 넣으면 약 ${(R.timings.auctionLessonEstimate / 60000).toFixed(1)}분`);
  }

  // ═══ 14차시 · 분야 스피드 분류 ═══
  if (ONLY.includes('sort')) {
    const tS = Date.now();
    await openGame('sort');
    await shot(host, 'sort-intro');
    await host.click('#bGo');
    for (let i = 0; i < 12; i++) {
      await waitH(i => window.__bbHost.g && (window.__bbHost.g.step === 'end' || (window.__bbHost.g.step === 'drop' && window.__bbHost.g.i >= i)), i, 30000);
      const g0 = await G(); if (g0.step === 'end') break; i = g0.i;
      const ans = CARDS[g0.order[i]].field;
      const others = ['food', 'med', 'env'].filter(f => f !== ans);
      const ansP = Promise.all(S.map(async s => {
        if (s.who === 'lazy') return;
        let at, f;
        if (s.who === 'prank') { at = rnd(800, 1100); f = pick(['food', 'med', 'env']); }          // 보지도 않고 바로
        else if (s.who === 'comp') { at = rnd(1500, 2600); f = Math.random() < 0.9 ? ans : pick(others); }
        else if (s.who === 'slow') { at = rnd(5500, 7800); f = Math.random() < 0.85 ? ans : pick(others); }
        else { at = rnd(2200, 4500); f = Math.random() < 0.7 ? ans : pick(others); }
        await sleep(at);
        await tap(s.page, `.sp-b[data-f="${f}"]`, 1500);
      }));
      if (i === 0) { await sleep(2000); await shot(host, 'sort-drop'); await shot(C().page, 'sort-play-drop'); await smallText(host, 'sort-drop'); }
      await ansP;
      await waitH(i => window.__bbHost.g.step !== 'drop' || window.__bbHost.g.i !== i, i, 15000);
      const g = await G();
      if (g.step === 'show') {
        const per = {};
        for (const s of S) { const a = g.first[s.uid]; per[`${s.num}${s.who[0]}`] = a ? (a.f === ans ? `O${((a.t - g.startAt) / 1000).toFixed(1)}` : 'X') : '-'; }
        R.sort.push({ card: CARDS[g.order[i]].name, early: g.early, res: g.res, per, fastest: g.fastest ? { tid: g.fastest.tid, dt: g.fastest.dt } : null });
        if (i === 0) { await sleep(500); await shot(host, 'sort-show'); await shot(C().page, 'sort-play-show'); await shot(by('lazy')[0].page, 'sort-play-show-lazy'); }
      }
    }
    await waitH(() => window.__bbHost.g.step === 'end', null, 30000);
    await sleep(1000); await shot(host, 'sort-end'); await shot(C().page, 'sort-play-end');
    const ge = await G(); R.sortTotal = ge.total; note('분류 합계', ge.total);
    note('분류: 「가장 빨리 맞힌」 반응 시간(초)', R.sort.map(x => (x.fastest ? (x.fastest.dt / 1000).toFixed(1) : '-')).join(' '));
    await act('finish');
    await waitH(() => window.__bbHost.meta.phase === 'result' && window.__bbHost.core.last && window.__bbHost.core.last.gid === 'sort', null, 15000);
    R.timings.sort = Date.now() - tS;
    R.scores14 = await scores(); note('14차시 점수판', R.scores14);
    await sleep(1000); await shot(host, 'sort-result-hub');
  }

  // ═══ 15차시 · 장바구니 탐정 ═══
  if (ONLY.includes('cart')) {
    const tC = Date.now();
    await openGame('cart');
    await shot(host, 'cart-intro');
    await host.click('#bGo');
    for (let k = 1; k <= 10; k++) {
      await waitH(k => window.__bbHost.g && (window.__bbHost.g.step === 'final' || (window.__bbHost.g.step === 'ask' && window.__bbHost.g.idx >= k)), k, 30000);
      const g0 = await G(); if (g0.step === 'final') break; k = g0.idx;
      const card = CART[g0.ci];
      const wrong = g0.choices.filter(c => c !== card.answer);
      const ansP = Promise.all(S.map(async s => {
        if (s.who === 'lazy') return;
        let at, c;
        if (s.who === 'prank') { at = 1700; c = g0.choices[0]; }                     // 열리자마자 첫 칸
        else if (s.who === 'comp') { at = rnd(2500, 4000); c = Math.random() < 0.9 ? card.answer : pick(wrong); }
        else if (s.who === 'slow') { at = rnd(8000, 11000); c = Math.random() < 0.85 ? card.answer : pick(wrong); }
        else { at = rnd(3000, 7000); c = Math.random() < 0.7 ? card.answer : pick(wrong); }
        await sleep(at);
        await tap(s.page, `.cq-btn[data-c="${c}"]:not([disabled])`, 1500);
      }));
      if (k === 1) { await sleep(2600); await shot(host, 'cart-ask'); await shot(C().page, 'cart-play-ask'); await smallText(host, 'cart-ask'); }
      await ansP;
      await waitH(k => window.__bbHost.g.step !== 'ask' || window.__bbHost.g.idx !== k, k, 20000);
      const g = await G();
      if (g.step === 'reveal') {
        R.cart.push({ card: card.name, mark: card.marks.join('/'), ans: card.answer, ok: g.res.ok, n: g.res.n, pts: g.res.pts });
        if (k === 1) { await sleep(600); await shot(host, 'cart-reveal'); await shot(C().page, 'cart-play-reveal'); await smallText(host, 'cart-reveal'); }
        await sleep(1200); await actSoft('next');
      }
    }
    await waitH(() => window.__bbHost.g.step === 'final', null, 30000);
    await sleep(1200); await shot(host, 'cart-final'); await shot(C().page, 'cart-play-final');
    const gc = await G(); R.cartTotal = gc.total; note('장바구니 합계', gc.total);
    await act('finish');
    await waitH(() => window.__bbHost.meta.phase === 'result' && window.__bbHost.core.last && window.__bbHost.core.last.gid === 'cart', null, 15000);
    R.timings.cart = Date.now() - tC;
  }

  // ═══ 15차시 · 가족 저녁 회의 (사흘: 첫 마음 → 90초 회의 → 상황 카드 → 다시 투표 → 동률이면 더 회의) ═══
  if (ONLY.includes('dinner')) {
    const tD = Date.now();
    await openGame('dinner');
    await shot(host, 'dinner-intro');
    await host.click('#bGo');
    await waitH(() => window.__bbHost.g && window.__bbHost.g.step === 'info');
    // 역할에 맞는 메뉴(날마다) — 0·1·2 = 그날 메뉴 순서
    const WANT = [
      { grandma: 1, mom: 2, sib: 0, me: 2, dad: 1, uncle: 0, grandpa: 1 },   // 월 배양육 · 한우 · 콩고기
      { grandma: 0, mom: 0, sib: 1, me: 2, dad: 0, uncle: 0, grandpa: 1 },   // 수 우유 · 락토프리 · 귀리
      { grandma: 2, mom: 1, sib: 0, me: 0, dad: 1, uncle: 0, grandpa: 0 },   // 금 국산 두부 · 수입 두부 · 청국장
    ];
    const BIT = { health: 1, price: 2, taste: 4, env: 8, animal: 16, nutr: 32 };
    const CARES = { grandma: ['health', 'taste'], mom: ['price', 'nutr'], sib: ['taste'], me: ['env', 'animal'], dad: ['taste', 'price'], uncle: ['nutr', 'env'], grandpa: ['health', 'price'] };
    const tag = s => `${s.num}${s.who[0]}`;
    const DONE_STEPS = ['tie', 'show'];
    R.dinner = { days: [] };
    const tieShots = { done: false };
    for (let r = 0; r < DAYS.length; r++) {
      await waitH(r => window.__bbHost.g.step === 'info' && window.__bbHost.g.r === r, r, 20000);
      await Promise.all(S.map(s => s.page.waitForSelector('.dr-card', { timeout: 20000 }).catch(() => {})));
      await sleep(700);
      const roles = (await G()).roles;
      if (r === 0) { await shot(host, 'dinner-info'); await shot(C().page, 'dinner-play-role'); await smallText(host, 'dinner-info'); }
      if (r === 1) { await shot(host, 'dinner-info-day2'); await shot(C().page, 'dinner-play-role-day2'); }
      // ① 첫 마음 (20초 · 혼자 · 비밀)
      await act('v1');
      await waitH(() => window.__bbHost.g.step === 'vote1');
      const t1 = Date.now();
      await Promise.all(S.map(async s => {
        if (s.who === 'lazy') return;
        const role = roles[s.uid];
        if (s.who === 'prank') {                                   // 장난: 아무거나 연타로 바꾸기
          for (let k = 0; k < 6; k++) { await tap(s.page, `.dv-m[data-m="${k % 3}"]`, 1500); await sleep(200); }
          return;
        }
        await sleep(s.who === 'slow' ? rnd(13000, 17000) : rnd(2000, 8000));
        const m = Math.random() < 0.8 ? WANT[r][role] : Math.floor(Math.random() * 3);
        await tap(s.page, `.dv-m[data-m="${m}"]`, 3000);
      }));
      if (r === 0) { await shot(host, 'dinner-vote1'); await shot(by('slow')[0].page, 'dinner-play-vote1-slow'); }
      await waitH(() => window.__bbHost.g.step === 'talk', null, 40000);
      const vote1Ms = Date.now() - t1;
      await sleep(1200);
      const gT = await G();
      // 팀마다 첫 마음 다수(자기 표 빼고)
      const famMaj = s => { const c = [0, 0, 0]; for (const [u, v] of Object.entries(gT.v1)) if (v.tid === s.team && u !== s.uid && v.m !== null) c[v.m]++; const top = Math.max(...c); return top ? c.indexOf(top) : null; };
      if (r === 0) {
        await shot(host, 'dinner-talk'); await shot(by('slow')[0].page, 'dinner-play-talk-slow'); await shot(by('lazy')[0].page, 'dinner-play-talk-lazy'); await smallText(host, 'dinner-talk');
      }
      await sleep(2500);
      await act('twist');                                          // 실제 수업은 90초 회의
      await waitH(() => window.__bbHost.g.step === 'twist');
      await sleep(900);
      if (r === 1) { await act('redraw'); await sleep(700); }      // 🔄 다른 카드
      const tw = DAYS[r].twists[(await G()).tw];
      if (r === 0) { await shot(host, 'dinner-twist'); await shot(C().page, 'dinner-play-twist'); await smallText(host, 'dinner-twist'); }
      const twWho = S.filter(s => tw.who.includes(roles[s.uid])).map(tag);
      await sleep(1500);
      // ② 다시 투표 (메뉴 + 근거 1~2개 · 30초)
      await act('v2');
      await waitH(() => window.__bbHost.g.step === 'vote2');
      const plan = {};
      await Promise.all(S.map(async s => {
        if (s.who === 'lazy') return;
        const role = roles[s.uid];
        const first = gT.v1[s.uid] ? gT.v1[s.uid].m : null;
        const maj = famMaj(s);
        let m = first ?? WANT[r][role];
        if (s.who === 'prank') m = [0, 1, 2].find(x => x !== maj) ?? 0;           // 가족과 반대로(한마음 깨기)
        else if (s.who === 'slow') { if (maj !== null && Math.random() < 0.7) m = maj; }  // 남 따라가기
        else if (s.who === 'normal') { if (maj !== null && Math.random() < 0.5) m = maj; }
        else if (s.who === 'comp' && tw.who.includes(role) && Math.random() < 0.5) m = WANT[r][role];   // 경쟁형은 고집
        plan[tag(s)] = `${first ?? '-'}→${m}`;
        await sleep(s.who === 'slow' ? rnd(18000, 24000) : s.who === 'prank' ? 500 : rnd(3000, 12000));
        await tap(s.page, `.dv-m[data-m="${m}"]`, 3000);
        await s.page.waitForSelector('.dv-r', { timeout: 5000 }).catch(() => {});
        let bits = (CARES[role] || ['health']).map(k => BIT[k]);
        if (tw.about && Math.random() < 0.5) bits = [BIT[tw.about], ...bits].slice(0, 2);
        if (s.who === 'prank') bits = [1, 2, 4, 8];                                 // 근거 연타(2개 제한 확인)
        for (const b of bits) { await tap(s.page, `.dv-r[data-r="${b}"]`, 1500); await sleep(250); }
      }));
      if (r === 0) { await shot(host, 'dinner-vote2'); await shot(by('prank')[0].page, 'dinner-play-vote2-prank'); await smallText(host, 'dinner-vote2'); }
      R.abuse['dinnerPrankReasons' + r] = await by('prank')[0].page.evaluate(() => [document.querySelectorAll('.dv-r.on').length, document.querySelector('.dv-warn')?.textContent || '']).catch(() => null);
      await waitH(st => st.includes(window.__bbHost.g.step), DONE_STEPS, 45000);
      // ③ 동률이면 30초 더 회의 → 동률 팀만 다시 투표 (두 번 넘게 같으면 🎲)
      const ties = [];
      for (let k = 0; k < 4; k++) {
        const g0 = await G();
        if (g0.step === 'show') break;
        ties.push(JSON.stringify(g0.tie.teams));
        if (k >= 2) { await act('draw'); break; }
        await sleep(900);
        const tiedTeam = Object.keys(g0.tie.teams)[0];
        if (!tieShots.done) {
          tieShots.done = true;
          await shot(host, 'dinner-tie');
          await shot(S.find(s => s.team === tiedTeam && s.who !== 'lazy').page, 'dinner-play-tie');
          const other = S.find(s => !g0.tie.teams[s.team]);
          if (other) await shot(other.page, 'dinner-play-tie-waiting');
        }
        await sleep(1500);
        await act('tv');                                           // 실제 수업은 30초 회의
        await waitH(() => window.__bbHost.g.step === 'tiev');
        const g1 = await G();
        await Promise.all(S.filter(s => g1.tie.teams[s.team] && s.who !== 'lazy').map(async s => {
          const opts = g1.tie.teams[s.team];
          const cur = g1.fin[s.uid];
          let m = opts.includes(cur) ? cur : opts[0];
          if (s.who === 'normal' || s.who === 'slow') m = Math.random() < 0.6 ? opts[0] : m;
          if (s.who === 'prank') m = opts[opts.length - 1];
          await sleep(s.who === 'slow' ? rnd(8000, 12000) : rnd(1500, 5000));
          await tap(s.page, `.dv-m[data-m="${m}"]`, 3000);
        }));
        if (k === 0) await shot(host, `dinner-tiev-d${r + 1}`);
        await waitH(st => st.includes(window.__bbHost.g.step), DONE_STEPS, 40000);
      }
      await waitH(() => window.__bbHost.g.step === 'show', null, 20000);
      await sleep(1500);
      const gd = await G();
      const res = gd.res;
      const day = {
        day: DAYS[r].day, twist: tw.head, twistWho: twWho, vote1Ms, ties,
        roles: Object.fromEntries(S.map(s => [tag(s), roles[s.uid]])), plan,
        teams: Object.fromEntries(Object.entries(res.teams).map(([t, v]) => [t, { m: v.m, how: v.how, sw: v.sw, ch: v.ch, uni: v.uni, voters: v.voters.map(x => `${x.role}:${x.a ?? '-'}→${x.b ?? '-'}`).join(' ') }])),
        sway: res.sway, uni: res.uniT, per: Object.fromEntries(S.map(s => [tag(s), res.per[s.uid] || ''])),
      };
      R.dinner.days.push(day);
      note(`저녁 ${r + 1}일째(${DAYS[r].topic}) 결정`, Object.fromEntries(Object.entries(day.teams).map(([t, v]) => [t, `${v.m ?? '-'}(${v.how}) 바꿈${v.ch} 설득${v.sw}${v.uni ? ' 한마음' : ''} | ${v.voters}`])));
      note(`저녁 ${r + 1}일째 상황 카드 · 동률`, `${tw.head} / 동률 ${ties.length}번 ${ties.join(' ')} / 설득상 ${res.sway.join(',') || '없음'} · 한마음 ${res.uniT.join(',') || '없음'}`);
      note(`저녁 ${r + 1}일째 학생별 꼬리표(p 설득 · s 따라감 · c 바꿈 · k 지킴)`, day.per);
      if (r === 0) {
        await shot(host, 'dinner-show'); await smallText(host, 'dinner-show');
        for (const want of ['p', 's', 'k']) { const s = S.find(x => res.per[x.uid] === want); if (s) await shot(s.page, `dinner-play-show-${want}${s.who[0]}`); }
        await shot(by('lazy')[0].page, 'dinner-play-show-lazy');
      }
      if (r === DAYS.length - 1) await shot(host, 'dinner-show-day3');
      await act('next');
    }
    await waitH(() => window.__bbHost.g.step === 'final', null, 15000);
    await sleep(1200);
    await shot(host, 'dinner-final'); await shot(C().page, 'dinner-play-final'); await smallText(host, 'dinner-final');
    await act('wrap'); await sleep(900); await shot(host, 'dinner-wrap'); await shot(C().page, 'dinner-play-wrap');
    await act('finish');
    await waitH(() => window.__bbHost.meta.phase === 'result' && window.__bbHost.core.last && window.__bbHost.core.last.gid === 'dinner', null, 15000);
    R.timings.dinnerPlayed = Date.now() - tD;
    // 실제 수업 어림: 설명 10 + 날마다(정보 읽기 30 + 첫 마음 20 + 회의 90 + 상황 30 + 다시 투표 30 + 결과 30 + 동률 50×횟수) + 사흘 결과 · 정리 60
    R.timings.dinnerReal = 10000 + R.dinner.days.reduce((a, d) => a + (30 + 20 + 90 + 30 + 30 + 30 + 50 * d.ties.length) * 1000, 0) + 60000;
    note('저녁 회의 시간', `시험 ${(R.timings.dinnerPlayed / 60000).toFixed(1)}분 → 실제 수업 어림 ${(R.timings.dinnerReal / 60000).toFixed(1)}분`);
    await sleep(1000); await shot(host, 'dinner-result-hub');
    R.scores15 = await scores(); note('15차시 점수판(누적 · 저녁 회의는 점수 없음)', R.scores15);
  }
  // ═══ 16차시 · 2040 발명가 피칭 ═══
  if (ONLY.includes('pitch')) {
    const tP = Date.now();
    await openGame('pitch');
    await shot(host, 'pitch-intro');
    await host.click('#bGo');
    await waitH(() => window.__bbHost.g && window.__bbHost.g.step === 'build');
    const prank = by('prank')[0];
    await Promise.all(S.map(async s => {
      if (s.who === 'lazy') return;
      await s.page.waitForSelector('.pb-o', { timeout: 10000 });
      for (let sub = 0; sub < 4; sub++) {
        await sleep(s.who === 'slow' ? rnd(2000, 4000) : rnd(300, 1200));
        await tap(s.page, `.pb-o[data-i="${Math.floor(Math.random() * 6)}"]`, 5000);
        await s.page.waitForSelector(`.pb-tab.on[data-tab="${sub + 1}"]`, { timeout: 5000 }).catch(() => {});
      }
    }));
    await sleep(600);
    await shot(C().page, 'pitch-play-build-name');
    // 이름: 장난꾼이 가장 먼저 막말 이름(시험용 가짜 말)을 보낸다 → 그 팀 이름으로 잠김 → 교사가 👀 확인 뒤 🗑 지우고 다시 받기
    await prank.page.waitForSelector('.pb-in', { timeout: 15000 }).catch(() => {});
    R.abuse.prankFormLocked = !(await prank.page.$('.pb-form'));
    if (!R.abuse.prankFormLocked) {
      await prank.page.fill('.pb-in', '똥방귀 ○○바보');
      await prank.page.evaluate(() => document.querySelector('.pb-form').requestSubmit());
    }
    await sleep(1500);
    const namers = teamIds.map(t => S.find(s => s.team === t && s.who !== 'lazy' && s.who !== 'prank'));
    for (const s of namers) if (s) await tap(s.page, '.pb-idea', 4000);
    await sleep(1200);
    const gb0 = await G();
    R.abuse.rudeNameCounted = Object.values(gb0.inv).some(v => v.nm && v.nm.includes('똥방귀'));
    note('피칭: 장난꾼이 먼저 보낸 막말 이름이 팀 이름으로 잠김', R.abuse.rudeNameCounted);
    R.abuse.rudeNameOnProjector = await host.evaluate(() => document.body.innerText.includes('똥방귀'));
    note('피칭: 막말 이름이 (공개 전) 프로젝터에 뜸', R.abuse.rudeNameOnProjector);
    const mate = S.find(s => s.team === prank.team && s !== prank && s.who !== 'lazy');
    R.abuse.rudeNameOnTeammates = await mate.page.evaluate(() => document.body.innerText.includes('똥방귀'));
    note('피칭: 막말 이름이 같은 팀 조종기에 보임', R.abuse.rudeNameOnTeammates);
    await shot(mate.page, 'pitch-play-build-mate-rude');
    await shot(host, 'pitch-build-before-clear');
    // 교사: 장난 이름 팀은 🗑, 나머지는 공개
    for (const t of teamIds) {
      if (gb0.inv[t].nm && gb0.inv[t].nm.includes('똥방귀')) {
        R.abuse.clearBtn = await H(t => { const b = document.querySelector(`[data-act="clrname"][data-p="${t}"]`); if (!b) return false; b.click(); return true; }, t);
        note('피칭: 진행판에 🗑(이름 지우기) 단추가 있음', R.abuse.clearBtn);
        await sleep(1200);
        await shot(mate.page, 'pitch-play-build-mate-cleared');
        await tap(mate.page, '.pb-idea', 4000);                     // 같은 팀 다른 학생이 다시 짓기
        await sleep(1000);
        R.abuse.prankRetryBlocked = await prank.page.evaluate(() => !document.querySelector('.pb-form'));
      }
    }
    await sleep(800);
    const gb = await G();
    R.pitch.names = Object.fromEntries(teamIds.map(t => [t, gb.inv[t].nm]));
    for (const t of teamIds) if (gb.inv[t].nm && !gb.inv[t].nm.includes('똥방귀')) await H(t => { const b = document.querySelector(`[data-act="show"][data-p="${t}"]`); if (b) b.click(); }, t);
    await sleep(600);
    R.pitch.shownAfterReveal = await host.$$eval('.pi-nm', a => a.map(x => x.textContent));
    note('피칭: 교사가 공개한 뒤 진행판 이름', R.pitch.shownAfterReveal.join(' / '));
    R.abuse.rudeNameOnOthers = await S.find(s => s.team !== prank.team).page.evaluate(() => document.body.innerText.includes('똥방귀'));
    await shot(host, 'pitch-build'); await smallText(host, 'pitch-build');
    await shot(prank.page, 'pitch-play-build-prank');
    await act('lock'); await waitH(() => window.__bbHost.g.step === 'pitch');
    const order = (await G()).order;
    R.pitch.q = [];
    for (let k = 0; k < order.length; k++) {
      await waitH(k => window.__bbHost.g.turn === k && window.__bbHost.g.sub === 'ready', k, 10000);
      await act('talk');
      await waitH(() => window.__bbHost.g.sub === 'talk');
      const cur = order[k];
      await Promise.all(S.filter(s => s.team !== cur).map(async s => {
        await s.page.waitForSelector('.pq-b', { timeout: 6000 }).catch(() => {});
        if (s.who === 'lazy') return;
        const qs = s.who === 'prank' ? ['q1', 'q2', 'q3'] : s.who === 'comp' ? [pick(['q1', 'q2', 'q3'])] : ['q1', 'q2', 'q3'].filter(() => Math.random() < 0.3);
        for (const q of qs) { await sleep(rnd(200, 2500)); await tap(s.page, `.pq-b[data-q="${q}"]`, 1500); }
      }));
      await sleep(1500);
      if (k === 0) {
        await shot(host, 'pitch-talk'); await smallText(host, 'pitch-talk');
        await shot(S.find(s => s.team === cur).page, 'pitch-play-presenter');
        await shot(S.find(s => s.team !== cur && s.who === 'comp').page, 'pitch-play-asker');
      }
      R.pitch.q.push({ team: cur, q: (await G()).qnow });
      await act('stop'); await waitH(() => window.__bbHost.g.sub === 'qa');
      if (k === 0) await shot(host, 'pitch-qa');
      await act('pickq'); await waitH(() => !!window.__bbHost.g.qpick);
      const pk = (await G()).qpick;
      (R.pitch.picks = R.pitch.picks || []).push(pk.none ? 'none' : `${pk.num}번(${S.find(x => x.uid === pk.u)?.who || '?'})`);
      if (k === 0) { await sleep(700); await shot(host, 'pitch-qa-pick'); const ps = S.find(x => x.uid === pk.u); if (ps) await shot(ps.page, 'pitch-play-picked'); }
      await act('next');
    }
    note('피칭: 팀별 받은 질문', R.pitch.q);
    await waitH(() => window.__bbHost.g.step === 'invest');
    // 투자: 경쟁형 = 가장 질문 적게 받은 팀에(경쟁자 견제) · 장난 = 한 팀 몰빵 · 보통 = 나눠서 · 무기력 = 안 함
    const qmap = Object.fromEntries(R.pitch.q.map(x => [x.team, (x.q.q1 || 0) + (x.q.q2 || 0) + (x.q.q3 || 0)]));
    await Promise.all(S.map(async s => {
      if (s.who === 'lazy') return;
      await s.page.waitForSelector('.pv-pm.plus', { timeout: 8000 }).catch(() => {});
      const others = teamIds.filter(t => t !== s.team);
      let plan;
      if (s.who === 'prank') plan = Array(5).fill(others[others.length - 1]);
      else if (s.who === 'comp') { const weak = others.slice().sort((a, b) => qmap[a] - qmap[b])[0]; plan = Array(5).fill(weak); }
      else plan = Array(s.who === 'slow' ? 2 : 5).fill(0).map(() => pick(others));
      for (const t of plan) { await sleep(rnd(200, 700)); await tap(s.page, `.pv-pm.plus[data-t="${t}"]:not([disabled])`, 1500); }
    }));
    await sleep(1500);
    await shot(host, 'pitch-invest'); await shot(C().page, 'pitch-play-invest'); await smallText(host, 'pitch-invest');
    await act('close'); await waitH(() => window.__bbHost.g.step === 'result');
    await sleep(2800);
    const gr = await G();
    R.pitch.recv = gr.recv; R.pitch.gave = gr.gave; R.pitch.rank = gr.rank;
    note('피칭: 받은 투자', gr.recv);
    R.pitch.bonus = gr.bonus; R.pitch.pts = gr.pts;
    note('피칭: 1위 맞히기 보너스', gr.bonus);
    note('피칭: 🎲 뽑힌 질문자', (R.pitch.picks || []).join(' · '));
    // 견제 투자(경쟁형 = 질문 적게 받은 팀에 몰빵)를 한 학생이 있는 팀의 보너스
    R.pitch.blockerTeams = [...new Set(S.filter(s => s.who === 'comp').map(s => s.team))];
    note('피칭: 경쟁형(견제 투자) 학생 팀 → 보너스', Object.fromEntries(R.pitch.blockerTeams.map(t => [t, gr.bonus[t]])));
    await shot(host, 'pitch-result'); await shot(C().page, 'pitch-play-result'); await smallText(host, 'pitch-result');
    await act('worry'); await sleep(800);
    await shot(host, 'pitch-worry'); await shot(C().page, 'pitch-play-worry'); await smallText(host, 'pitch-worry');
    await act('finish');
    await waitH(() => window.__bbHost.meta.phase === 'result' && window.__bbHost.core.last && window.__bbHost.core.last.gid === 'pitch', null, 15000);
    R.timings.pitchPlayed = Date.now() - tP;
    await sleep(1000); await shot(host, 'pitch-result-hub');
  }

  await host.click('#bEnd');
  await waitH(() => window.__bbHost.meta.phase === 'end');
  await sleep(1500); await shot(host, 'host-end'); await shot(C().page, 'play-end');
  R.timings.total = Date.now() - T0;
  await host.click('#bCloseRoom').catch(() => {});
  await sleep(800);
} catch (e) {
  R.errors.push('FATAL ' + e.stack);
  console.error(e);
  await shot(host, 'FATAL-host').catch(() => {});
  if (S[0]) await shot(S[0].page, 'FATAL-s1').catch(() => {});
} finally {
  fs.writeFileSync(path.join(OUT, KEEP ? `report_${ONLY.join('-')}.json` : 'report.json'), JSON.stringify(R, null, 2));
  console.log('\n시간', R.timings, '\n오류', R.errors.slice(0, 20));
  await browser.close();
  mock.close(); stat.close();
  process.exit(0);
}
