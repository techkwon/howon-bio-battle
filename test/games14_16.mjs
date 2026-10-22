// 14~16차시 게임 시험: 바이오 경매(auction) · 분야 스피드 분류(sort) · 2040 발명가 피칭(pitch)
//   node test/games14_16.mjs            학생 30명(8팀) · 가짜 DB(규칙 적용) · 스크린샷
//   옵션: --n 30 · --size 4|6 (팀 크기) · --headed · --only auction,sort,pitch · --no-offline
// site/games/index.js 는 건드리지 않는다 → test/registry14_16.js 를 목록으로 써서 test/site14_16/ 에 따로 묶는다.
// 결과: 콘솔 요약 + test/shots14_16/*.png (1366×768) + test/shots14_16/report.json
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { startMock } from './mockdb.mjs';
import { startStatic } from './serve.mjs';
import auctionGame, { foldBids, better, assetsOf, snipeExtend, valueOf, twistOf, capClose, CAP_CLOSE_MS } from '../site/games/auction.js';
import { CARDS, START_COINS, BID_CAP, SNIPE_MAX_MS, baseOf } from '../site/games/auction-data.js';
import { speedPart, DROP_MS } from '../site/games/sort.js';
import pitchGame, { cleanName, settleInvest, cleanAlloc, autoName, nameIdeas, predictBonus, shownName, HIDDEN_NAME } from '../site/games/pitch.js';
import { PREDICT_BONUS } from '../site/games/pitch-data.js';
import { rankPoints } from '../site/src/shared.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : d; };
const N = Number(arg('n', 30));
const SIZE = Number(arg('size', 4));
const HEADED = !!arg('headed', false);
const ONLY = String(arg('only', 'auction,sort,pitch')).split(',');
const OFFLINE = !arg('no-offline', false);
const VIEW = { width: 1366, height: 768 };
const SMALL = { width: 1366, height: 650 };      // 크롬북 실제 창(주소창 · 탭 빼고)
const SITE_DIR = path.join(here, 'site14_16');
const SHOT_DIR = path.join(here, String(arg('shots', 'shots14_16')));
fs.mkdirSync(SHOT_DIR, { recursive: true });
for (const f of fs.readdirSync(SHOT_DIR)) if (f.endsWith('.png')) fs.unlinkSync(path.join(SHOT_DIR, f));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const report = { n: N, size: SIZE, started: new Date().toISOString(), checks: [], errors: [], timings: {} };
let failures = 0;
function check(name, cond, detail = '') {
  report.checks.push({ name, ok: !!cond, detail: String(detail) });
  if (!cond) failures++;
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

// ── 0. 순수 함수 시험 (DOM 없음) ──
console.log('[0] 계산 함수');
{
  const teamOf = { a: 't1', b: 't2', c: 't1' };
  const coins = { t1: 300, t2: 1000 };
  let hi = foldBids(null, { a: { bid: 50, t: 100 }, b: { bid: 50, t: 99 } }, teamOf, coins, 0);
  check('경매: 같은 값이면 먼저 낸 팀', hi.team === 't2' && hi.bid === 50, JSON.stringify(hi));
  const hi2 = foldBids(hi, { a: { bid: 50, t: 100 }, b: { bid: 50, t: 99 } }, teamOf, coins, 0);
  check('경매: 같은 입력을 다시 받아도 그대로', hi2 === hi);
  const hi3 = foldBids(hi, { a: { bid: 350, t: 120 } }, teamOf, coins, 0);
  check('경매: 코인보다 많이는 거절', hi3 === hi, JSON.stringify(hi3));
  const hi4 = foldBids(hi, { a: { bid: 75, t: 130 } }, teamOf, coins, 0);
  check('경매: 50 단위가 아니면 거절', hi4 === hi);
  const late = foldBids(hi, { c: { bid: 300, t: 900 } }, teamOf, coins, 100);
  check('경매: 마감 뒤 입찰 거절', late === hi);
  const stale = foldBids(null, { c: { bid: 300, t: 100 } }, teamOf, coins, 0, () => 0, 5000);
  check('경매: 칸 열기 전 입력(앞 카드)은 거절', stale === null);
  const hi5 = foldBids(hi, { a: { bid: 300, t: 140 } }, teamOf, coins, 0);
  // 같은 팀원이 낮은 값을 다시 보내도(늦게 본 화면) 최고가는 내려가지 않는다
  const hi6 = foldBids(hi5, { a: { bid: 100, t: 150 }, b: { bid: 50, t: 99 } }, teamOf, coins, 0);
  check('경매: 최고가는 내려가지 않는다', hi6.bid === 300 && hi6.team === 't1');
  check('경매: better() 같은 팀 같은 값은 바꾸지 않음', !better({ bid: 300, t: 1, team: 't1' }, hi5));
  const s = { coins: { t1: 500, t2: 900 }, hist: [{ c: 0, team: 't1', paid: 500 }, { c: 6, team: 't2', paid: 100 }, { c: 1, team: null, paid: 0 }, { c: 2, team: 't1', paid: 50 }], fut: [{ x: CARDS[0].future.x }, { x: CARDS[6].future.x }] };
  const { a } = assetsOf(s, ['t1', 't2']);
  check('경매: 자산 = 남은 코인 + 기본값 × 배수(낙찰가와 무관 · 안 연 카드는 0)', a.t1 === 500 + Math.round(baseOf(CARDS[0]) * CARDS[0].future.x) && a.t2 === 900 + Math.round(baseOf(CARDS[6]) * CARDS[6].future.x), JSON.stringify(a));
  check('경매: 공개 한 줄 「400 주고 산 게 100!」', twistOf({ c: 6, team: 't1', paid: 400 }, 0.5).cls === 'loss' && /400 주고 산 게 100/.test(twistOf({ c: 6, team: 't1', paid: 400 }, 0.5).line.replace(/,/g, '')) && twistOf({ c: 10, team: 't1', paid: 100 }, 3).cls === 'gain',
    twistOf({ c: 6, team: 't1', paid: 400 }, 0.5).line + ' / ' + twistOf({ c: 10, team: 't1', paid: 100 }, 3).line);
  const big = { t1: 1000, t2: 1000 };
  const capHi = foldBids(null, { a: { bid: BID_CAP + 50, t: 100 } }, teamOf, big, 0);
  const capOk = foldBids(null, { a: { bid: BID_CAP, t: 100 } }, teamOf, big, 0);
  check(`경매: 카드당 상한 ${BID_CAP} 넘는 입찰 거절`, capHi === null && capOk && capOk.bid === BID_CAP);
  // P1-1: 최고가가 한도(400)에 닿으면 1.5초 뒤 낙찰 · 막판 연장으로 다시 늘지 않음
  {
    let now = 50000;
    const actx = { teams: [{ id: 't1', members: ['a'] }, { id: 't2', members: ['b'] }], now: () => now, numOf: () => 1, rnd: () => 0.5, cls: 'x' };
    let as = auctionGame.action({ step: 'look', i: 0, order: [0, 1], coins: { t1: 1000, t2: 1000 }, hist: [], fut: [], hi: null, ext: 0 }, 'open', null, actx);
    const dl0 = as.deadline;
    now += 2000;
    as = auctionGame.onInput(as, { a: { bid: 200, t: now } }, actx);
    const notCap = !as.capped && as.deadline === dl0;
    now += 1000;
    as = auctionGame.onInput(as, { a: { bid: 200, t: now - 1000 }, b: { bid: BID_CAP, t: now } }, actx);
    const capOk1 = as.capped === true && as.deadline === now + CAP_CLOSE_MS && as.hi.bid === BID_CAP && as.hi.team === 't2';
    // 한도 뒤 막판 입찰(같은 400 을 늦게 낸 팀)이 와도 마감은 늘지 않는다
    const dlCap = as.deadline;
    now += 1000;
    as = auctionGame.onInput(as, { a: { bid: BID_CAP, t: now }, b: { bid: BID_CAP, t: now - 1000 } }, actx);
    const capOk2 = as.deadline === dlCap && as.hi.team === 't2' && (as.ext || 0) === 0;
    now = dlCap;
    as = auctionGame.tick(as, actx);
    check(`경매: 최고가 ${BID_CAP} → ${CAP_CLOSE_MS / 1000}초 뒤 낙찰 · 연장 없음`, notCap && capOk1 && capOk2 && as.step === 'sold' && as.hist[0].paid === BID_CAP && as.hist[0].team === 't2',
      JSON.stringify({ notCap, capOk1, capOk2, step: as.step }));
    // 막판 3초 안에 400 → 연장 대신 1.5초 (원래 마감이 더 이르면 그대로)
    check('경매: 한도 마감은 원래 마감보다 늦추지 않음', capClose(10000, { bid: BID_CAP }, 9000) === 10000 && capClose(10000, { bid: BID_CAP }, 5000) === 5000 + CAP_CLOSE_MS && capClose(10000, { bid: 350 }, 5000) === 10000);
    const nx = auctionGame.action(as, 'next', null, actx);
    check('경매: 다음 카드는 한도 표시 없이 새로 시작', nx.step === 'look' && !nx.capped && !auctionGame.action(nx, 'open', null, actx).capped);
  }
  check('경매: 막판 입찰 +3초 · 최대 +6초', snipeExtend(10000, 10000, 5000) === 10000 && snipeExtend(10000, 10000, 8000) === 11000 && snipeExtend(14000, 10000, 13500) === 10000 + SNIPE_MAX_MS && snipeExtend(16000, 10000, 15900) === 16000,
    [snipeExtend(10000, 10000, 8000), snipeExtend(14000, 10000, 13500), snipeExtend(16000, 10000, 15900)].join());
  check('경매 데이터: 12장 · 배수 0.5~3 · 「예상」 문장', CARDS.length === 12 && CARDS.every(c => c.future.x >= 0.5 && c.future.x <= 3 && /예상$/.test(c.future.good) && /예상$/.test(c.future.worry)),
    CARDS.filter(c => !(/예상$/.test(c.future.good) && /예상$/.test(c.future.worry))).map(c => c.id).join());
  check('경매 데이터: 분야 셋 다 있음', ['food', 'med', 'env'].every(f => CARDS.some(c => c.field === f)), ['food', 'med', 'env'].map(f => f + CARDS.filter(c => c.field === f).length).join(' '));
  check('분류: 빠르기 0.5~1', speedPart(0) === 1 && speedPart(8000) === 0.5 && speedPart(99999) === 0.5 && Math.abs(speedPart(4000) - 0.75) < 1e-9);
  check('피칭: 이름 12자 · 꺾쇠 · 줄바꿈 제거', cleanName('미생물로 지구를 구하는 기계입니다') === '미생물로 지구를 구하는' && cleanName('<b>x</b>\n안녕') === 'bx/b 안녕' && Array.from(cleanName('🦠'.repeat(20))).length === 12);
  check('피칭: 이름 추천 12자 이하', [0, 1, 2, 3, 4, 5].every(b => [0, 1, 2, 3, 4, 5].every(o => nameIdeas({ bio: b, out: o, who: b }).every(x => Array.from(x).length <= 12) && Array.from(autoName({ bio: b, out: o })).length <= 12)));
  check('피칭: 투자 합 500 넘으면 무효 · 자기 팀 제외', cleanAlloc({ t2: 300, t3: 300 }, 't1', ['t1', 't2', 't3']) === null && JSON.stringify(cleanAlloc({ t1: 500, t2: 200 }, 't1', ['t1', 't2', 't3'])) === '{"t2":200}');
  const teams = [{ id: 't1', members: ['a', 'b'], online: ['a', 'b'] }, { id: 't2', members: ['c'], online: ['c'] }, { id: 't3', members: ['d'], online: [] }];
  const st = settleInvest(teams, { a: { t2: 500 }, b: { t2: 100, t3: 400 }, c: { t1: 200, t3: 300 } });
  check('피칭: 팀 투자 = 팀원 평균', st.recv.t2 === 300 && st.recv.t3 === 500 && st.recv.t1 === 200, JSON.stringify(st.recv));
  const pb = predictBonus({ t1: { t2: 100, t3: 400 }, t2: { t1: 200, t3: 300 }, t3: { t1: 250, t2: 250 }, t4: { t3: 100, t1: 400 } }, { t1: 850, t2: 350, t3: 800, t4: 0 }, { t1: 1, t3: 2, t2: 3, t4: 4 });
  check(`피칭: 1위 맞히기 보너스 = 1위에 절반(250) 이상 걸면 +${PREDICT_BONUS} · 1위 팀은 자동 +${PREDICT_BONUS}`, PREDICT_BONUS === 1 && pb.bonus.t1 === 1 && pb.bonus.t2 === 0 && pb.bonus.t3 === 1 && pb.bonus.t4 === 1, JSON.stringify(pb.bonus));
  // P1-3: 보너스로 투자 순위가 뒤집히지 않는다(무작위 2000판 · 3~8팀 · 투자 1위 = 점수 1위)
  {
    let rev = 0, topLost = 0, ex = '';
    for (let k = 0; k < 2000; k++) {
      const nT = 3 + (k % 6), ids = Array.from({ length: nT }, (_, i) => 't' + (i + 1));
      const gave = {}, recv = Object.fromEntries(ids.map(id => [id, 0]));
      for (const a of ids) { gave[a] = {}; let left = 500; for (const b of ids) { if (b === a || left <= 0) continue; const g = Math.min(left, 100 * Math.floor(Math.random() * 6)); if (g) { gave[a][b] = g; recv[b] += g; left -= g; } } }
      const { rank, points } = rankPoints(recv, true);
      const { bonus } = predictBonus(gave, recv, rank);
      const pts = Object.fromEntries(ids.map(t => [t, points[t] + (bonus[t] || 0)]));
      for (const a of ids) for (const b of ids) if (recv[a] > recv[b] && pts[a] < pts[b]) { rev++; ex = ex || JSON.stringify({ recv, pts }); }
      const top = ids.filter(t => rank[t] === 1 && recv[t] > 0);
      if (top.length && ids.some(t => !top.includes(t) && pts[t] >= Math.min(...top.map(x => pts[x])))) { topLost++; ex = ex || JSON.stringify({ recv, pts }); }
    }
    check('피칭: 보너스로 투자 순위가 뒤집히지 않음 · 투자 1위 = 점수 1위(무작위 2000판)', rev === 0 && topLost === 0, `${rev}/${topLost} ${ex}`);
  }
  // P2: 🎲 질문자 뽑기 — 게임 내내 한 번씩 다 뽑힌 뒤에야 겹친다
  {
    const pteams = [{ id: 't1', members: ['a', 'b'], online: ['a', 'b'] }, { id: 't2', members: ['c', 'd'], online: ['c', 'd'] }, { id: 't3', members: ['e', 'f'], online: ['e', 'f'] }];
    let r = 0.37;
    const pctx = { teams: pteams, inputs: {}, now: () => 1000, rnd: () => { r = (r * 9301 + 0.4927) % 1; return r; }, numOf: u => 'abcdef'.indexOf(u) + 1 };
    let ps = { step: 'pitch', sub: 'talk', turn: 0, order: ['t1', 't2', 't3'], qs: {}, talkAt: 0 };
    const picks = [];
    for (let turn = 0; turn < 3; turn++) {
      ps = { ...ps, turn, sub: 'talk' };
      const cur = ps.order[turn];
      pctx.inputs = Object.fromEntries(pteams.filter(t => t.id !== cur).flatMap(t => t.online).map(u => [u, { q1: true, t: 2000 }]));
      for (let k = 0; k < 2; k++) { ps = pitchGame.action(ps, 'pickq', null, pctx); picks.push(ps.qpick.u); }
      ps = pitchGame.action({ ...ps, sub: 'qa' }, 'next', null, pctx);
    }
    check('피칭: 🎲 질문자 — 세 차례 6번 뽑기에 6명 모두 한 번씩(겹침 없음)', new Set(picks).size === 6, picks.join(''));
  }
  const sv = { inv: { t1: { nm: '똥', bio: 0, out: 0 }, t2: { nm: '', bio: 1, out: 1 } }, shown: {} };
  check('피칭: 공개 전 이름 = 「팀 발명품」 · 이름 없으면 자동 이름', shownName(sv, 't1') === HIDDEN_NAME && shownName({ ...sv, shown: { t1: true } }, 't1') === '똥' && shownName(sv, 't2') === autoName(sv.inv.t2));
}

// ── 1. 묶기 (임시 목록) ──
console.log('\n[1] 시험용 묶음 만들기');
fs.mkdirSync(path.join(SITE_DIR, 'dist'), { recursive: true });
for (const f of ['host.html', 'index.html', 'play.html', 'styles.css']) fs.copyFileSync(path.join(root, 'site', f), path.join(SITE_DIR, f));
const registry = path.join(here, 'registry14_16.js');
await esbuild.build({
  entryPoints: { host: path.join(root, 'site/src/core-host.js'), play: path.join(root, 'site/src/core-play.js') },
  bundle: true, outdir: path.join(SITE_DIR, 'dist'), format: 'iife', target: ['chrome100'], minify: false, logLevel: 'warning',
  plugins: [{ name: 'registry', setup(b) { b.onResolve({ filter: /games[\\/]index\.js$/ }, () => ({ path: registry })); } }],
});
check('묶기 성공(임시 목록: yeast · kimchi · auction · sort · pitch)', fs.existsSync(path.join(SITE_DIR, 'dist/host.js')));

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

let shotNo = 0;
async function shot(page, name) {
  shotNo++;
  await page.screenshot({ path: path.join(SHOT_DIR, `${String(shotNo).padStart(2, '0')}-${name}.png`) }).catch(e => report.errors.push('shot ' + name + ': ' + e.message));
}
async function overflow(page) {
  return page.evaluate(() => {
    const els = [document.documentElement, document.querySelector('#stage') || document.querySelector('#main')];
    const bad = els.filter(e => e && e.scrollHeight > e.clientHeight + 1).map(e => `${e.id || e.tagName}:${e.scrollHeight}>${e.clientHeight}`);
    const vh = window.innerHeight, vw = window.innerWidth;
    const out = [...document.querySelectorAll('button, b, p, h1, h2, span, input, .so-card')].filter(el => {
      if (el.closest('.gk-confetti')) return false;
      const r = el.getBoundingClientRect();
      if (!(r.height > 0)) return false;
      // 잘려 안 보이는 것: 화면 밖 또는 overflow:hidden 부모 밖
      if (r.bottom > vh + 1 || r.right > vw + 1) return true;
      return false;
    }).slice(0, 5).map(el => `${el.tagName}.${el.className}:${(el.textContent || '').trim().slice(0, 20)}`);
    return [...bad, ...out];
  });
}
/** 세로 스크롤 · 화면 밖 글자 없음. small=true 면 1366×650 에서도 */
async function noScroll(page, name, small = false) {
  let o = await overflow(page);
  check(`스크롤 없음 1366×768: ${name}`, !o.length, o.join(' | '));
  if (small) {
    await page.setViewportSize(SMALL); await sleep(150);
    o = await overflow(page);
    check(`스크롤 없음 1366×650: ${name}`, !o.length, o.join(' | '));
    await page.setViewportSize(VIEW); await sleep(80);
  }
}

const mock = await startMock({ port: 8798, latency: 40 });
const stat = await startStatic({ port: 8091, root: SITE_DIR });
const SITE = `http://127.0.0.1:${stat.port}`;
const base = `?mock=http://127.0.0.1:${mock.port}`;
const dump = async p => (await (await fetch(`http://127.0.0.1:${mock.port}/admin/dump?path=${encodeURIComponent(p)}`)).json()).val;
const { chromium } = await loadPlaywright();
let browser;
try { browser = await chromium.launch({ channel: 'chrome', headless: !HEADED }); } catch { browser = await chromium.launch({ headless: !HEADED }); }

function watchErrors(page, who) {
  page.on('pageerror', e => report.errors.push(`${who}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|ERR_CONNECTION_REFUSED/.test(m.text())) report.errors.push(`${who} console: ${m.text().slice(0, 200)}`); });
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? (page.__promptAnswer || '') : undefined).catch(() => {}));
}

const T0 = Date.now();
const hostCtx = await browser.newContext({ viewport: VIEW, locale: 'ko-KR' });
const host = await hostCtx.newPage();
watchErrors(host, 'host');
const H = (fn, a) => host.evaluate(fn, a);
const waitH = (fn, a, timeout = 30000) => host.waitForFunction(fn, a, { timeout, polling: 100 });
const G = () => H(() => window.__bbHost.g);
const S = [];
let code = null, roster = {}, teamIds = [], byTeam = {};
const fullKey = async k => `${await H(() => window.__bbHost.gameNo)}-${k}`;

const LESSON = { auction: 14, sort: 14, pitch: 16 };
/** 게임 고르기: 코어가 차시 탭(.ltab)으로 묶었으면 그 차시 탭을 먼저 누른다 */
async function pickGame(page, gid) {
  const tab = await page.$(`.ltab[data-lesson="${LESSON[gid]}"]`);
  if (tab) { await tab.click(); await page.waitForSelector(`.gcard[data-gid="${gid}"]`, { timeout: 5000 }); }
  await page.click(`.gcard[data-gid="${gid}"]`);
}
async function startGame(gid) {
  await pickGame(host, gid);
  await host.waitForSelector('#bGo');
  await sleep(300);
  await host.click('#bGo');
  await waitH(() => window.__bbHost.g && window.__bbHost.g.step);
}
/**
 * 진행판 단추 누르기. 같은 PC 에서 다른 시험(학생 30명)이 함께 돌면 Playwright 의 click 이
 * 「스크롤 끝」 뒤에 멈추는 일이 있다(CPU 부족). 그때는 단추가 다른 것에 가려졌는지
 * (elementFromPoint) 확인하고, 가려지지 않았으면 DOM click 으로 누른다. 가려졌으면 오류로 남긴다.
 */
let clickFallbacks = 0;
async function clickSafe(page, sel, timeout) {
  try { await page.click(sel, { timeout }); return true; }
  catch (e) {
    const r = await page.evaluate(sel => {
      const b = document.querySelector(sel);
      if (!b) return 'none';
      const rc = b.getBoundingClientRect();
      if (!(rc.width > 0)) return 'hidden';
      const top = document.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2);
      if (top && top !== b && !b.contains(top)) return 'covered:' + (top.className || top.tagName);
      b.click(); return 'ok';
    }, sel).catch(x => 'err:' + x.message);
    if (r === 'ok') { clickFallbacks++; return true; }
    if (r === 'none') return false;
    report.errors.push(`단추 ${sel}: ${r}`);
    throw e;
  }
}
/**
 * 학생 조종기 누르기. 학생 30명 + 진행판이 한 PC 에서 돌면 Playwright click 의 「움직임 멈춤(stable)」 확인이
 * 몇 초씩 밀려 시간 안에 못 누르는 일이 생긴다(시험 도구 한계 · 실제 교실은 기기가 30대).
 * 그래서 학생 단추는 DOM click 으로 누른다 — 단추가 있고 꺼져 있지 않을 때만. 화면 배치는 스크린샷 · noScroll 로 따로 본다.
 */
async function tap(page, sel, timeout = 5000) {
  const end = Date.now() + timeout;
  for (;;) {
    const ok = await page.evaluate(sel => { const b = document.querySelector(sel); if (!b || b.disabled) return false; b.click(); return true; }, sel).catch(() => false);
    if (ok) return true;
    if (Date.now() > end) throw new Error(`누를 단추 없음(${timeout}ms): ${sel}`);
    await sleep(120);
  }
}
async function act(name) { if (!await clickSafe(host, `[data-act="${name}"]`, 8000)) throw new Error(`단추 없음: ${name}`); }
/** 저절로 넘어갔을 수도 있는 단추 (낙찰 · 정답 화면의 「다음」) */
async function actSoft(name) { await clickSafe(host, `[data-act="${name}"]`, 1500).catch(() => {}); }
async function scores() { return H(() => Object.fromEntries(Object.entries(window.__bbHost.teams).map(([k, t]) => [k, t.score]))); }
async function finishAndCheck(label, expectedPts) {
  const before = await scores();
  await act('finish');
  await waitH(() => window.__bbHost.meta.phase === 'result' && window.__bbHost.core.last, null, 15000);
  const after = await scores();
  const ok = Object.keys(after).every(t => after[t] - before[t] === (expectedPts[t] || 0));
  check(`${label}: 팀 점수 = 게임 점수`, ok, JSON.stringify(Object.fromEntries(Object.keys(after).map(t => [t, after[t] - before[t]]))));
  await sleep(900);
  await shot(host, `${label}-hub`);
  await noScroll(host, `${label} 결과 점수판`);
}

try {
  // ── 2. 방 · 학생 · 팀 ──
  console.log(`\n[2] 방 만들기 · 학생 ${N}명 · 교사 지정으로 팀 나누기`);
  await host.goto(`${SITE}/host.html${base}`, { timeout: 90000, waitUntil: 'domcontentloaded' });
  await host.waitForSelector('#bCreate:not([disabled])', { timeout: 20000 });
  await host.click('#segCls .segb[data-v="4"]');
  await host.click(`#segSize .segb[data-v="${SIZE}"]`);
  await host.click('#segMode .segb[data-v="assign"]');
  await host.click('#bCreate');
  await waitH(() => window.__bbHost.code && window.__bbHost.meta.phase === 'lobby');
  code = await H(() => window.__bbHost.code);
  // 같은 PC 에서 다른 시험이 함께 돌 때도 버티도록 6명씩 · 넉넉한 시간으로 들어온다
  for (let b = 0; b < N; b += 6) {
    S.push(...await Promise.all(Array.from({ length: Math.min(6, N - b) }, async (_, i) => {
      const num = b + i + 1;
      const ctx = await browser.newContext({ viewport: VIEW, locale: 'ko-KR' });
      const page = await ctx.newPage();
      watchErrors(page, 's' + num);
      await page.goto(`${SITE}/${base}`, { timeout: 90000, waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#iCode', { timeout: 60000 });
      await page.fill('#iCode', code); await page.fill('#iNum', String(num)); await page.click('button[type=submit]');
      return { ctx, page, num };
    })));
  }
  await waitH(n => Object.values(window.__bbHost.players).filter(p => p.on).length >= n, N, 90000);
  const uids = await Promise.all(S.map(s => s.page.evaluate(() => window.__bbPlay.net.uid)));
  S.forEach((s, i) => { s.uid = uids[i]; });
  await host.click('#bTeam');
  await host.waitForSelector('#bShuf', { timeout: 10000 });
  await host.click('#bShuf');
  await host.click('#bOK');
  await waitH(() => window.__bbHost.meta.phase === 'result' && Object.keys(window.__bbHost.roster).length > 0);
  roster = await H(() => window.__bbHost.roster);
  teamIds = await H(() => Object.keys(window.__bbHost.teams));
  for (const s of S) { s.team = roster[s.uid].team; (byTeam[s.team] = byTeam[s.team] || []).push(s); }
  check(`팀 ${teamIds.length}개 · ${N}명 배정`, Object.keys(roster).length === N, teamIds.map(t => t + ':' + byTeam[t].length).join(' '));
  await Promise.all(S.map(s => s.page.waitForSelector('.team-card', { timeout: 40000 })));
  check(`팀 크기 ${SIZE}명 → 팀 ${teamIds.length}개 · 팀 인원 차이 ≤ 1`, teamIds.length === Math.min(8, Math.max(2, Math.ceil(N / SIZE))) && Math.max(...teamIds.map(t => byTeam[t].length)) - Math.min(...teamIds.map(t => byTeam[t].length)) <= 1);
  if (await host.$('.ltab[data-lesson="14"]')) { await host.click('.ltab[data-lesson="14"]'); await sleep(300); }
  await shot(host, 'hub-14');
  await noScroll(host, '게임 고르기(14차시)');

  // ── 3. 바이오 경매 ──
  if (ONLY.includes('auction')) {
    console.log('\n[3] 바이오 경매 (12장)');
    const tA = Date.now();
    await pickGame(host, 'auction');
    await host.waitForSelector('#bGo');
    await sleep(400);
    await shot(host, 'auction-intro'); await shot(S[0].page, 'auction-play-intro');
    await host.click('#bGo');
    await waitH(() => window.__bbHost.g && window.__bbHost.g.step === 'look');
    let coinsOk = true, soldOk = true, overOk = true;
    for (let i = 0; i < 12; i++) {
      await waitH(i => window.__bbHost.g.step === 'look' && window.__bbHost.g.i === i, i, 20000);
      if (i === 0) {
        await sleep(500);
        await shot(host, 'auction-look'); await noScroll(host, '경매 광고(look)');
        await S[1].page.waitForSelector('.aup-wait', { timeout: 5000 });
        await shot(S[1].page, 'auction-play-look'); await noScroll(S[1].page, '조종기 경매 광고', true);
      }
      await act('open');
      await waitH(() => window.__bbHost.g.step === 'bid');
      const before = (await G()).coins;
      if (i === 0) {
        // 같은 값 동시 입찰: 두 팀이 동시에 +50
        const A = byTeam[teamIds[0]][0], B = byTeam[teamIds[1]][0];
        await Promise.all([A, B].map(s => s.page.waitForSelector('.aup-b[data-d="50"]:not([disabled])', { timeout: 8000 })));
        await Promise.all([tap(A.page, '.aup-b[data-d="50"]'), tap(B.page, '.aup-b[data-d="50"]')]);
        await sleep(1500);
        await waitH(() => !!window.__bbHost.g.hi, null, 10000).catch(() => {});   // 느린 PC 에서 진행판이 받을 때까지
        const g = await G();
        const k = await fullKey('b0');
        const inp = await dump(`rooms/${code}/inputs/${k}`) || {};
        const ta = inp[A.uid] && inp[A.uid].t, tb = inp[B.uid] && inp[B.uid].t;
        const expect = ta < tb ? A.team : tb < ta ? B.team : null;
        check('경매: 같은 값(50) 동시 입찰 → 먼저 낸 팀', g.hi && g.hi.bid === 50 && (expect === null || g.hi.team === expect), `A ${ta} B ${tb} → ${g.hi && g.hi.team} (기대 ${expect || '같은 ms'})`);
        // 진 쪽 조종기: 잠깐 뒤 다시 누를 수 있다
        const loser = g.hi.team === A.team ? B : A;
        await loser.page.waitForSelector('.aup-b[data-d="100"]:not([disabled])', { timeout: 6000 }).then(() => check('경매: 진 팀 조종기 단추 다시 켜짐', true)).catch(() => check('경매: 진 팀 조종기 단추 다시 켜짐', false));
        await shot(loser.page, 'auction-play-bid'); await noScroll(loser.page, '조종기 입찰', true);
        const winner = g.hi.team === A.team ? A : B;
        await shot(winner.page, 'auction-play-lead');
      }
      if (i === 2) {
        // P1-1: 한 팀이 한도(BID_CAP)까지 → 진행판 「한도 도달 — 낙찰!」 · 1.5초 뒤 저절로 낙찰(남은 시간을 끌지 않음)
        // 최고가 팀 조종기에는 올리기 단추가 없다 → 코인 많은 두 팀이 200 · 400 을 차례로
        const [rich, rich2] = teamIds.slice().sort((a, b) => before[b] - before[a]);
        const P = byTeam[rich][0], Q = byTeam[rich2][0];
        // 진행판이 받을 때까지 학생처럼 다시 누른다(느린 PC 에서 첫 누름이 칸이 열리기 전에 갈 수 있다)
        const press = async (who, want) => {
          for (let tr = 0; tr < 4; tr++) {
            // 조종기 화면이 지금 최고가를 받아 「→ want」로 바뀐 뒤에 누른다(옛 값을 보내면 같은 값 · 늦은 팀으로 거절)
            await who.page.waitForFunction(w => { const b = document.querySelector('.aup-b[data-d="200"]'); return b && !b.disabled && b.textContent.replace(/,/g, '').includes(String(w)); }, want, { timeout: 6000, polling: 100 }).catch(() => {});
            await tap(who.page, '.aup-b[data-d="200"]', 6000).catch(() => {});
            if (await waitH(w => window.__bbHost.g.hi && window.__bbHost.g.hi.bid >= w, want, 4000).then(() => true, () => false)) return;
          }
          throw new Error(`한도 시험: ${want} 입찰이 안 됨`);
        };
        await press(P, 200);
        await press(Q, BID_CAP);
        // 같은 순간의 상태 · 남은 시간 · 진행판 제목을 한 번에 읽는다(1.5초 안에 낙찰되므로)
        const snap = await H(() => { const g = window.__bbHost.g; return { g, left: g.deadline - window.__bbHost.net.serverNow(), title: document.querySelector('.au-title')?.textContent || '' }; });
        await sleep(250);
        const title2 = await host.$eval('.au-title', e => e.textContent).catch(() => '');
        const gc = snap.g;
        const capped = gc.step === 'bid' && gc.capped === true && gc.hi && gc.hi.bid === BID_CAP;
        const left = capped ? snap.left : -1;
        const title = /한도/.test(snap.title) ? snap.title : title2;
        if (capped) await shot(host, 'auction-cap');
        check(`경매: 최고가 ${BID_CAP} → 「한도 도달 — 낙찰!」 · 남은 시간 1.5초 이하`, capped && left <= 1600 && /한도/.test(title) && !/마감 임박/.test(title), `capped=${capped} 남은 ${left}ms · ${title}`);
        const tCap = Date.now();
        await waitH(i => window.__bbHost.g.hist.length > i, i, 8000);
        check('경매: 한도 도달 뒤 곧 낙찰(진행판 대기 4초 이내)', Date.now() - tCap < 4000 && (await G()).hist[i].paid === BID_CAP, `${Date.now() - tCap}ms`);
      }
      // 여러 팀이 몇 번씩 입찰
      const bidders = i === 2 ? [] : teamIds.map(t => pick(byTeam[t])).sort(() => Math.random() - 0.5).slice(0, 3 + Math.floor(Math.random() * 3));
      await Promise.all(bidders.map(async s => {
        for (let r = 0; r < 2; r++) {
          await sleep(rnd(100, 1400));
          const d = pick([50, 100, 200]);
          await tap(s.page, `.aup-b[data-d="${d}"]`, 1500).catch(() => {});
        }
      }));
      await sleep(700);
      if (i === 0) { await shot(host, 'auction-bid'); await noScroll(host, '경매 입찰'); }
      if (i === 1) {
        // 마감까지 그대로 → 마지막 3초 연출
        await waitH(() => window.__bbHost.g.deadline - window.__bbHost.net.serverNow() < 2600, null, 25000);
        await shot(host, 'auction-bid-hot');
        // 낙찰 화면(4.5초)은 저절로 넘어가므로 단계 대신 낙찰 기록 수로 기다린다(시험 도구가 느려도 놓치지 않게)
        await waitH(i => window.__bbHost.g.hist.length > i, i, 15000);
      } else {
        // 한도(400)에 닿은 카드는 1.5초 뒤 저절로 낙찰 → 이미 넘어갔으면 「지금 낙찰」을 누르지 않는다
        const gb = await G();
        if (gb.step === 'bid' && gb.hist.length <= i) await clickSafe(host, '[data-act="hammer"]', 3000).catch(() => {});
        await waitH(i => window.__bbHost.g.hist.length > i, i, 15000);
      }
      const g = await G();
      const h = g.hist[i];
      if (h.team) { if (g.coins[h.team] !== before[h.team] - h.paid) coinsOk = false; if (h.paid > before[h.team]) overOk = false; }
      if (h.c !== g.order[i]) soldOk = false;
      if (Object.values(g.coins).some(c => c < 0)) coinsOk = false;
      if (i === 0) {
        await sleep(700);
        await shot(host, 'auction-sold'); await noScroll(host, '경매 낙찰');
        await shot(byTeam[h.team || teamIds[0]][1].page, 'auction-play-sold');
      }
      if (i < 11) await actSoft('next');
    }
    check('경매: 낙찰가만큼 코인이 줄고 음수 없음', coinsOk);
    check('경매: 팀 코인보다 비싸게 낙찰된 적 없음', overOk);
    const go = (await G()).order;
    check('경매: 카드 12장 섞인 순서대로', soldOk && [...go].sort((x, y) => x - y).join() === CARDS.map((_, k) => k).join(), go.join(','));
    await actSoft('next');
    await waitH(() => window.__bbHost.g.step === 'fut');
    await waitH(() => window.__bbHost.g.fut.length >= 2, null, 15000);
    await sleep(400);
    await shot(host, 'auction-2040-reveal'); await noScroll(host, '2040 결과 카드');
    await shot(S[2].page, 'auction-play-2040'); await noScroll(S[2].page, '조종기 2040', true);
    const gMid = await G();
    check('경매: 공개 전 배수는 state 에 없음', gMid.fut.length < gMid.hist.length && !JSON.stringify(gMid).includes('"future"'), `${gMid.fut.length}/${gMid.hist.length}`);
    await act('all');
    await waitH(() => window.__bbHost.g.fut.length === window.__bbHost.g.hist.length);
    await sleep(800);
    await shot(host, 'auction-2040-all');
    await act('final');
    await waitH(() => window.__bbHost.g.step === 'final');
    const gf = await G();
    let assetOk = true;
    for (const t of teamIds) {
      let a = gf.coins[t];
      gf.hist.forEach((h, k) => { if (h.team === t) a += Math.round(baseOf(CARDS[h.c]) * CARDS[h.c].future.x); });
      if (a !== gf.assets[t]) assetOk = false;
    }
    check('경매: 최종 자산 = 남은 코인 + Σ(기본값 × 배수)', assetOk, teamIds.map(t => `${t}:${gf.assets[t]}`).join(' '));
    check(`경매: 낙찰가는 모두 ${BID_CAP} 이하`, gf.hist.every(h => h.paid <= BID_CAP), gf.hist.map(h => h.paid).join(','));
    check('경매: 순위 점수', JSON.stringify(rankPoints(gf.assets, true).points) === JSON.stringify(gf.pts));
    await sleep(1200);
    await shot(host, 'auction-final'); await noScroll(host, '경매 최종');
    await shot(S[3].page, 'auction-play-final');
    await finishAndCheck('auction', gf.pts);
    report.timings.auction = Date.now() - tA;
  }

  // ── 4. 분야 스피드 분류 ──
  if (ONLY.includes('sort')) {
    console.log('\n[4] 분야 스피드 분류 (12장)');
    const tS = Date.now();
    await startGame('sort');
    // 정답 화면 「15초 더 보기」는 진행판 페이지 안에서 바로 누른다(시험 도구가 느려 5.5초를 놓쳐도 카드를 건너뛰지 않게).
    // 카드 2(i=1)만은 누르지 않고 저절로 넘어가는지 본다.
    await host.evaluate(() => {
      window.__held = -1;
      window.__holdSort = setInterval(() => {
        const g = window.__bbHost.g;
        if (!g || g.step !== 'show' || g.i === 1 || window.__held === g.i) return;
        const b = document.querySelector('[data-act="hold"]');
        if (b) { b.click(); window.__held = g.i; }
      }, 50);
    });
    // 시험 도구가 진행을 맞추도록 정답 화면마다 「15초 더 보기」를 누르고 「다음 카드」로 넘긴다.
    // 단, 카드 2(i=1)는 아무것도 누르지 않고 정답 화면이 5.5초 뒤 저절로 넘어가는지 본다.
    let resOk = true, earlyOk = true, played = 0, autoOk = null;
    const earlyNote = [];
    const skipper = S[N - 1];
    for (let i = 0; i < 12; i++) {
      await waitH(i => window.__bbHost.g.step === 'end' || (window.__bbHost.g.step === 'drop' && window.__bbHost.g.i >= i), i, 30000);
      const g0 = await G();
      if (g0.step === 'end') break;
      if (g0.i !== i) report.errors.push(`분류 ${i}번 카드를 놓침 → ${g0.i}번부터`);
      i = g0.i;
      played++;
      const ans = CARDS[g0.order[i]].field;
      const others = ['food', 'med', 'env'].filter(f => f !== ans);
      const answerers = i === 0 ? S.filter(s => s !== skipper) : S;
      let failed = 0;
      const answering = Promise.all(answerers.map(async s => {
        await sleep(rnd(800, i === 0 ? 3500 : 2500));
        const f = Math.random() < 0.75 ? ans : pick(others);
        s.__dbg = await s.page.evaluate(() => { const P = window.__bbPlay; return `학생 카드 ${P.g.i} ${P.g.step} · ${(document.querySelector('#main').innerText || '').replace(/\s+/g, ' ').slice(0, 30)}`; }).catch(() => '');
        await tap(s.page, `.sp-b[data-f="${f}"]`, 4000).catch(async () => {
          failed++;
          const after = await s.page.evaluate(() => { const P = window.__bbPlay; return `학생 카드 ${P.g.i} ${P.g.step} · ${(document.querySelector('#main').innerText || '').replace(/\s+/g, ' ').slice(0, 30)}`; }).catch(() => '');
          report.errors.push(`분류 ${i} s${s.num} 누르기 실패(누르기 전: ${s.__dbg} / 뒤: ${after})`);
        });
      }));
      if (i === 0) {
        await S[0].page.waitForSelector('.sp-b', { timeout: 5000 });
        await shot(S[0].page, 'sort-play-drop');
        await sleep(700);
        await shot(host, 'sort-drop-start');
      }
      await answering;
      if (i === 0) { await sleep(200); await shot(host, 'sort-drop-mid'); await noScroll(host, '분류 떨어지는 중'); await shot(S[0].page, 'sort-play-picked'); await noScroll(S[0].page, '조종기 분류(고른 뒤)', true); }
      await waitH(i => window.__bbHost.g.step !== 'drop' || window.__bbHost.g.i !== i, i, 15000);
      const g = await G();
      if (g.i !== i || g.step !== 'show') { report.errors.push(`분류 ${i}번 정답 화면을 놓침(진행판 ${g.step} ${g.i})`); continue; }
      // 일찍 마감: 모두 골랐고 마지막 답이 마감 1.4초 전보다 앞이면 반드시 일찍 끝나야 한다
      if (i > 0 && !failed) {
        const needAll = Object.values(g.need).flat();
        const all = needAll.every(u => g.first[u]);
        const lastT = Math.max(...needAll.map(u => (g.first[u] ? g.first[u].t : 0)));
        const room = g.startAt + DROP_MS - lastT;
        if (all && !g.early && room > 1400) { earlyOk = false; report.errors.push(`분류 ${i}번: 모두 골랐는데(마감 ${room}ms 전) 일찍 마감 안 됨`); }
        if (all && !g.early && room <= 1400) earlyNote.push(`${i}번 마지막 답이 마감 ${room}ms 전`);
        if (!all) earlyNote.push(`${i}번 안 고른 사람 ${needAll.filter(u => !g.first[u]).length}`);
      }
      // 기대 점수 다시 셈
      for (const t of teamIds) {
        const uids = g.need[t];
        let sum = 0, ok = 0;
        for (const u of uids) { const a = g.first[u]; if (a && a.f === ans) { ok++; sum += speedPart(Math.max(0, a.t - g.startAt)); } }
        const pts = uids.length ? Math.round(100 * sum / uids.length) : 0;
        if (g.res[t].ok !== ok || g.res[t].pts !== pts) resOk = false;
      }
      if (i === 0) {
        check('분류: 안 누른 사람은 0점으로 셈(분모에 듦)', g.res[skipper.team].of === byTeam[skipper.team].length && !g.first[skipper.uid]);
        await sleep(600);
        await shot(host, 'sort-show'); await noScroll(host, '분류 정답 공개');
        await shot(S[0].page, 'sort-play-show'); await noScroll(S[0].page, '조종기 분류 정답', true);
        await shot(skipper.page, 'sort-play-missed');
      }
      if (i === 1) {
        const t0 = Date.now();
        autoOk = await waitH(() => window.__bbHost.g.step === 'drop' && window.__bbHost.g.i === 2, null, 12000).then(() => Date.now() - t0).catch(() => false);
        continue;
      }
      await actSoft('next');
    }
    await host.evaluate(() => clearInterval(window.__holdSort));
    check('분류: 정답 화면이 5.5초 뒤 저절로 다음 카드로', autoOk !== false && autoOk !== null, `${autoOk}ms`);
    check('분류: 카드 12장 모두 함께 진행', played === 12, `${played}/12장`);
    check('분류: 팀 점수 = 정답률 × 빠르기 (12장 모두)', resOk);
    check('분류: 모두 고르면 일찍 마감', earlyOk, earlyNote.join(' · '));
    await waitH(() => window.__bbHost.g.step === 'end');
    await sleep(1000);
    const ge = await G();
    await shot(host, 'sort-end'); await noScroll(host, '분류 결과');
    await shot(S[4].page, 'sort-play-end');
    await finishAndCheck('sort', rankPoints(ge.total, true).points);
    report.timings.sort = Date.now() - tS;
  }

  // ── 5. 2040 발명가 피칭 ──
  if (ONLY.includes('pitch')) {
    console.log('\n[5] 2040 발명가 피칭');
    const tP = Date.now();
    await startGame('pitch');
    await waitH(() => window.__bbHost.g.step === 'build');
    const pref = Object.fromEntries(teamIds.map(t => [t, [0, 1, 2, 3].map(() => Math.floor(Math.random() * 6))]));
    const votes = {};
    await Promise.all(S.map(async (s, idx) => {
      await s.page.waitForSelector('.pb-o', { timeout: 10000 });
      votes[s.uid] = [];
      for (let sub = 0; sub < 4; sub++) {
        await sleep(rnd(150, 700));
        const k = Math.random() < 0.7 ? pref[s.team][sub] : Math.floor(Math.random() * 6);
        votes[s.uid].push(k);
        if (idx === 0 && sub === 1) { await shot(s.page, 'pitch-play-build-bio'); await noScroll(s.page, '조종기 조립(생물)', true); }
        await tap(s.page, `.pb-o[data-i="${k}"]`, 8000);
        await s.page.waitForSelector(`.pb-tab.on[data-tab="${sub + 1}"]`, { timeout: 5000 });
      }
    }));
    // 이름: 팀마다 한 명 (긴 이름 · 꺾쇠 · 추천 단추 · 직접 DB 에 긴 글) — 팀에서 먼저 낸 이름 하나만 쓴다
    const namers = teamIds.map(t => byTeam[t][0]);
    await namers[0].page.fill('.pb-in', '미생물로 지구를 구하는 기계입니다');
    await namers[0].page.click('.pb-form button[type=submit]');
    await namers[1].page.fill('.pb-in', '<b>x</b>&"');
    await namers[1].page.click('.pb-form button[type=submit]');
    if (namers[2]) await tap(namers[2].page, '.pb-idea', 8000);
    if (namers[3]) {
      // 조종기를 거치지 않고 긴 글(30자)을 직접 써도 진행판이 12자로 자른다 — 규칙(≤200자)은 통과
      const r = await namers[3].page.evaluate(async ({ code, k }) => {
        const P = window.__bbPlay;
        try { await P.net.set(`rooms/${code}/inputs/${k}/${P.net.uid}`, { ...(P.mine || {}), nm: '가'.repeat(30), t: P.net.TS }); return 'ok'; } catch (e) { return e.code || e.message; }
      }, { code, k: await fullKey('pb') });
      check('규칙: 학생 입력 글 30자 쓰기 통과(≤200)', r === 'ok', r);
      const r2 = await namers[3].page.evaluate(async ({ code, k }) => {
        const P = window.__bbPlay;
        try { await P.net.set(`rooms/${code}/inputs/${k}/${P.net.uid}`, { nm: '가'.repeat(201), t: P.net.TS }); return 'ok'; } catch (e) { return e.code || e.message; }
      }, { code, k: await fullKey('pb') });
      check('규칙: 201자는 거절', r2 !== 'ok', r2);
    }
    await sleep(1500);
    // 진행판이 모든 표를 받을 때까지 (느린 PC 에서도 같은 값을 비교하도록)
    await waitH(() => Object.values(window.__bbHost.g.inv).every(v => v.done >= v.need), null, 20000).catch(() => report.errors.push('피칭: 진행판이 모든 표를 받지 못함(20초)'));
    await shot(namers[0].page, 'pitch-play-build-name'); await noScroll(namers[0].page, '조종기 이름 짓기', true);
    const gb = await G();
    // 다수결 확인
    let majOk = true;
    for (const t of teamIds) {
      for (let sub = 0; sub < 4; sub++) {
        const key = ['in', 'bio', 'out', 'who'][sub];
        const cnt = {};
        for (const s of byTeam[t]) { const v = votes[s.uid][sub]; cnt[v] = (cnt[v] || 0) + 1; }
        const sorted = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
        if (sorted.length === 1 || sorted[0][1] > sorted[1][1]) { if (Number(sorted[0][0]) !== gb.inv[t][key]) majOk = false; }
      }
    }
    check('피칭: 팀 결정 = 팀원 다수결', majOk);
    const nms = teamIds.map(t => gb.inv[t].nm);
    check('피칭: 이름 12자 이하 · 꺾쇠 없음', nms.every(n => Array.from(n).length <= 12 && !/[<>]/.test(n)), JSON.stringify(nms));
    check('피칭: 긴 이름은 12자로', gb.inv[teamIds[0]].nm === '미생물로 지구를 구하는', gb.inv[teamIds[0]].nm);
    if (namers[3]) check('피칭: DB 에 30자를 써도 12자로', gb.inv[teamIds[3]].nm === '가'.repeat(12), gb.inv[teamIds[3]].nm);
    await shot(host, 'pitch-build'); await noScroll(host, '피칭 조립');
    // 처음엔 이름이 모두 숨겨져 있다 → 진행판 · 다른 팀 조종기 모두 「팀 발명품」
    const shown = await host.$$eval('.pi-nm', a => a.map(x => x.textContent));
    check('피칭: 처음엔 진행판 이름 모두 숨김(「팀 발명품」)', !shown.some(x => x.includes('구하는') || x.includes('bx') || x.includes('가가가')) && shown.some(x => x.includes(HIDDEN_NAME)), shown.slice(0, 3).join(' / '));
    // 같은 팀 두 번째 학생이 나중에 다른 이름 → 무시(먼저 낸 이름 하나)
    const late = byTeam[teamIds[0]][1];
    if (late) {
      await tap(late.page, '.pb-tab[data-tab="4"]', 4000).catch(() => {});
      await sleep(300);
      const hasForm = await late.page.$('.pb-form');
      check('피칭: 이름이 정해지면 같은 팀 조종기 이름 칸 잠김', !hasForm && await late.page.evaluate(() => document.body.innerText.includes('먼저 낸 이름')));
      // 규칙 밖에서 직접 써도 진행판은 먼저 낸 이름을 지킨다
      await late.page.evaluate(async ({ code, k }) => { const P = window.__bbPlay; await P.net.set(`rooms/${code}/inputs/${k}/${P.net.uid}`, { ...(P.mine || {}), nm: '나중이름', t: P.net.TS }); }, { code, k: await fullKey('pb') });
      await sleep(1200);
      check('피칭: 나중에 낸 이름은 안 쓴다', (await G()).inv[teamIds[0]].nm === '미생물로 지구를 구하는', (await G()).inv[teamIds[0]].nm);
    }
    // 교사 👀 누르고 있기 → 그 팀 이름만 잠깐 보임
    await host.hover(`.pi-card[data-tid="${teamIds[1]}"] [data-peek]`);
    await host.mouse.down(); await sleep(350);
    const peek = await host.$eval(`.pi-card[data-tid="${teamIds[1]}"] .pi-nm`, e => e.textContent);
    await shot(host, 'pitch-build-peek');
    await host.mouse.up(); await sleep(350);
    const after = await host.$eval(`.pi-card[data-tid="${teamIds[1]}"] .pi-nm`, e => e.textContent);
    check('피칭: 👀 누르는 동안만 이름 확인', peek.includes('👀') && peek.includes('bx') && after.includes(HIDDEN_NAME), `${peek} → ${after}`);
    // 지우기 → 다시 받기
    await host.click(`.pi-card[data-tid="${teamIds[1]}"] [data-act="clrname"]`);
    await sleep(600);
    const clr = await G();
    check('피칭: 🗑 지우면 그 팀 이름 비움', !clr.inv[teamIds[1]].nm, JSON.stringify(clr.inv[teamIds[1]].nm));
    await namers[1].page.waitForSelector('.pb-form', { timeout: 6000 }).catch(() => {});
    await namers[1].page.fill('.pb-in', '새 이름');
    await namers[1].page.click('.pb-form button[type=submit]');
    await waitH(t => window.__bbHost.g.inv[t].nm === '새 이름', teamIds[1], 8000).catch(() => {});
    check('피칭: 지운 뒤 새 이름 받기', (await G()).inv[teamIds[1]].nm === '새 이름', (await G()).inv[teamIds[1]].nm);
    // 팀 하나 공개
    await host.click(`.pi-card[data-tid="${teamIds[0]}"] [data-act="show"]`);
    await sleep(500);
    const one = await host.$eval(`.pi-card[data-tid="${teamIds[0]}"] .pi-nm`, e => e.textContent);
    const two = await host.$eval(`.pi-card[data-tid="${teamIds[1]}"] .pi-nm`, e => e.textContent);
    check('피칭: 「공개」 누른 팀만 이름 보임', one.includes('구하는') && two.includes(HIDDEN_NAME), `${one} / ${two}`);
    await shot(host, 'pitch-build-shown');
    const other = S.find(s => s.team !== teamIds[1]);
    check('피칭: 다른 팀 조종기에는 공개 전 이름 안 보임', !(await other.page.evaluate(() => document.body.innerText.includes('새 이름'))));
    await act('lock');
    await waitH(() => window.__bbHost.g.step === 'pitch');
    let qOk = true;
    const order = (await G()).order;
    for (let k = 0; k < order.length; k++) {
      await waitH(k => window.__bbHost.g.turn === k && window.__bbHost.g.sub === 'ready', k, 10000);
      if (k === 0) { await sleep(300); await shot(host, 'pitch-ready'); }
      await act('talk');
      await waitH(() => window.__bbHost.g.sub === 'talk');
      const cur = order[k];
      const askers = S.filter(s => s.team !== cur);
      await Promise.all(askers.map(async s => {
        await s.page.waitForSelector('.pq-b', { timeout: 6000 }).catch(() => {});
        const qs = ['q1', 'q2', 'q3'].filter(() => Math.random() < 0.45);
        for (const q of qs) { await sleep(rnd(50, 500)); await tap(s.page, `.pq-b[data-q="${q}"]`, 2000).catch(() => {}); }
      }));
      // DB 에 들어간 질문 수가 멈추고 진행판이 그 수를 보일 때까지 기다린다(최대 10초)
      const qKey = await fullKey('q' + k);
      const countDb = async () => {
        const inp = await dump(`rooms/${code}/inputs/${qKey}`) || {};
        const e = { q1: 0, q2: 0, q3: 0 };
        for (const [u, x] of Object.entries(inp)) { if (roster[u] && roster[u].team !== cur) for (const q of Object.keys(e)) if (x[q] === true) e[q]++; }
        return e;
      };
      let exp = await countDb();
      for (let w = 0; w < 25; w++) {
        await sleep(400);
        const e2 = await countDb();
        const hq = await H(() => window.__bbHost.g.qnow);
        if (JSON.stringify(e2) === JSON.stringify(exp) && JSON.stringify(hq) === JSON.stringify(e2)) break;
        exp = e2;
      }
      const g = await G();
      if (JSON.stringify(exp) !== JSON.stringify(g.qnow)) qOk = false;
      if (k === 0) {
        await shot(host, 'pitch-talk'); await noScroll(host, '피칭 발표');
        await shot(byTeam[cur][0].page, 'pitch-play-presenter'); await noScroll(byTeam[cur][0].page, '조종기 발표 팀', true);
        const oth = askers[0];
        await shot(oth.page, 'pitch-play-asker'); await noScroll(oth.page, '조종기 질문', true);
        check('피칭: 발표 팀 조종기에 질문 수', (await byTeam[cur][0].page.$$eval('.pq-c b', a => a.map(x => Number(x.textContent)))).join() === [exp.q1, exp.q2, exp.q3].join());
        await act('stop');
        await waitH(() => window.__bbHost.g.sub === 'qa');
        await act('pickq');
        await waitH(() => !!window.__bbHost.g.qpick);
        const pk = (await G()).qpick;
        const cand = S.filter(s => s.team !== cur).filter(s => true);
        const pickedS = S.find(s => s.uid === pk.u);
        check('피칭: 🎲 질문자 = 질문 단추를 누른 다른 팀 학생', pk.none ? true : (!!pickedS && pickedS.team !== cur && pk.num === pickedS.num), JSON.stringify({ num: pk.num, team: pk.team, none: pk.none }));
        await sleep(700);
        await shot(host, 'pitch-qa-pick'); await noScroll(host, '피칭 질문자 뽑기');
        if (pickedS) {
          await pickedS.page.waitForSelector('.pq-picked', { timeout: 5000 }).then(() => check('피칭: 뽑힌 학생 조종기에 알림', true)).catch(() => check('피칭: 뽑힌 학생 조종기에 알림', false));
          await shot(pickedS.page, 'pitch-play-picked'); await noScroll(pickedS.page, '조종기 뽑힘', true);
        }
        await act('pickclose');
        await shot(host, 'pitch-qa');
      }
      await act('next');
    }
    check('피칭: 질문 수 = 다른 팀 학생이 누른 수', qOk);
    await waitH(() => window.__bbHost.g.step === 'invest');
    // 투자: 학생마다 + 를 1~5번
    await Promise.all(S.map(async s => {
      await s.page.waitForSelector('.pv-pm.plus', { timeout: 8000 });
      const times = 1 + Math.floor(Math.random() * 5);
      for (let r = 0; r < times; r++) {
        await sleep(rnd(100, 400));
        const btns = await s.page.$$('.pv-pm.plus:not([disabled])');
        if (!btns.length) break;
        await pick(btns).evaluate(b => b.click()).catch(() => {});
        await sleep(250);
      }
    }));
    // 투자 입력이 DB 에 다 들어가고 진행판이 센 수가 멈출 때까지
    for (let w = 0, last = ''; w < 25; w++) {
      await sleep(400);
      const cur = JSON.stringify([await dump(`rooms/${code}/inputs/${await fullKey('pi')}`), await H(() => window.__bbHost.g.ivDone)]);
      if (cur === last) break;
      last = cur;
    }
    await shot(S[5].page, 'pitch-play-invest'); await noScroll(S[5].page, '조종기 투자(7팀)', true);
    await shot(host, 'pitch-invest'); await noScroll(host, '피칭 투자');
    const ik = await fullKey('pi');
    const inputs = await dump(`rooms/${code}/inputs/${ik}`) || {};
    await act('close');
    await waitH(() => window.__bbHost.g.step === 'result');
    const gr = await G();
    const teamsForSettle = teamIds.map(t => ({ id: t, members: byTeam[t].map(s => s.uid), online: byTeam[t].map(s => s.uid) }));
    const exp = settleInvest(teamsForSettle, inputs);
    check('피칭: 받은 투자 = 팀원 평균의 합', JSON.stringify(exp.recv) === JSON.stringify(gr.recv), JSON.stringify(gr.recv));
    check('피칭: 팀이 낸 투자 ≤ 500', Object.values(gr.gave).every(g => Object.values(g).reduce((a, b) => a + b, 0) <= 500));
    const eb = predictBonus(gr.gave, gr.recv, gr.rank).bonus;
    check('피칭: 점수 = 순위 점수 + 1위 맞히기 보너스', teamIds.every(t => gr.pts[t] === rankPoints(gr.recv, true).points[t] + (eb[t] || 0)), JSON.stringify(gr.bonus));
    await sleep(2600);
    await shot(host, 'pitch-result'); await noScroll(host, '피칭 결과');
    await shot(S[6].page, 'pitch-play-result');
    await act('worry');
    await waitH(() => window.__bbHost.g.step === 'worry');
    await sleep(700);
    await shot(host, 'pitch-worry'); await noScroll(host, '걱정되는 점');
    await shot(S[6].page, 'pitch-play-worry'); await noScroll(S[6].page, '조종기 걱정', true);
    await finishAndCheck('pitch', gr.pts);
    report.timings.pitch = Date.now() - tP;
  }

  // ── 6. 비상 모드: 대신 누르기 ──
  if (OFFLINE) {
    console.log('\n[6] 비상 모드 — 대신 누르기');
    const offCtx = await browser.newContext({ viewport: VIEW, locale: 'ko-KR' });
    const off = await offCtx.newPage();
    watchErrors(off, 'offline-host');
    off.__promptAnswer = '4';
    await off.goto(`${SITE}/host.html?mock=http://127.0.0.1:1`);
    await off.waitForSelector('.errbox', { timeout: 20000 });
    await off.click('#bOffline');
    await off.waitForSelector('.gcard', { timeout: 10000 });
    const OG = () => off.evaluate(() => window.__bbHost.g);
    const oAct = n => off.click(`[data-act="${n}"]`);
    // 경매
    await pickGame(off, 'auction'); await off.click('#bGo');
    await off.waitForFunction(() => window.__bbHost.g && window.__bbHost.g.step === 'look');
    await oAct('open');
    await off.waitForSelector('.proxy-row .pbtn');
    await off.click('.proxy-row:nth-child(1) .pbtn:nth-child(3)');   // 1팀 +100
    await sleep(200);
    await off.click('.proxy-row:nth-child(1) .pbtn:nth-child(4)');   // 1팀이 최고가라 줄이 빠짐 → 첫 줄 = 2팀 +200 (→ 300)
    await shot(off, 'offline-auction-proxy'); await noScroll(off, '비상 경매 대신 누르기');
    await oAct('hammer');
    await off.waitForFunction(() => window.__bbHost.g.hist.length >= 1);
    const oh = (await OG()).hist[0];
    check('비상 경매: 대신 누르기로 낙찰', oh.team === 't2' && oh.paid === 300, JSON.stringify(oh));
    await off.click('[data-act="next"]', { timeout: 1500 }).catch(() => {});      // 낙찰 화면은 4.5초 뒤 저절로 넘어간다
    await off.waitForFunction(() => window.__bbHost.g.step === 'look');
    await oAct('skipall'); await off.waitForFunction(() => window.__bbHost.g.step === 'fut');
    await oAct('final'); await off.waitForFunction(() => window.__bbHost.g.step === 'final');
    await oAct('finish'); await off.waitForFunction(() => window.__bbHost.meta.phase === 'result');
    // 분류
    await pickGame(off, 'sort'); await off.click('#bGo');
    await off.waitForFunction(() => window.__bbHost.g && window.__bbHost.g.step === 'drop');
    await off.waitForSelector('.proxy-row .pbtn');
    const og = await OG();
    const ansIdx = ['food', 'med', 'env'].indexOf(CARDS[og.order[0]].field);
    await off.click(`.proxy-row:nth-child(1) .pbtn:nth-child(${2 + ansIdx})`);
    await shot(off, 'offline-sort-proxy');
    await oAct('stop'); await off.waitForFunction(() => window.__bbHost.g.step === 'show');
    const os = await OG();
    check('비상 분류: 1팀 맞힘 · 다른 팀 0점', os.res.t1.ok === 1 && os.res.t1.pts > 50 && os.res.t2.pts === 0, JSON.stringify(os.res));
    await off.click('#bAbort').catch(() => {});
    await off.waitForFunction(() => window.__bbHost.meta.phase === 'result');
    // 피칭
    await pickGame(off, 'pitch'); await off.click('#bGo');
    await off.waitForFunction(() => window.__bbHost.g && window.__bbHost.g.step === 'build');
    await off.waitForSelector('.proxy-row .pbtn');
    for (let b = 0; b < 4; b++) await off.click(`.proxy-row:nth-child(1) .pbtn:nth-child(${2 + b})`);
    await shot(off, 'offline-pitch-build');
    const ob = await OG();
    check('비상 피칭: 대신 누르기로 네 칸', ['in', 'bio', 'out', 'who'].every(k => ob.inv.t1[k] === 0), JSON.stringify(ob.inv.t1));
    await oAct('lock'); await off.waitForFunction(() => window.__bbHost.g.step === 'pitch');
    await oAct('talk'); await off.waitForSelector('.proxy-row .pbtn');
    await off.click('.proxy-row:nth-child(1) .pbtn:nth-child(2)');    // 2팀이 「근거는?」
    const oq = await OG();
    check('비상 피칭: 대신 질문', oq.qnow.q1 === 1, JSON.stringify(oq.qnow));
    for (let k = 0; k < 4; k++) { await off.waitForSelector('[data-act="next"], [data-act="talk"]'); if (await off.$('[data-act="talk"]')) await oAct('skip'); else await oAct('next'); await sleep(150); }
    await off.waitForFunction(() => window.__bbHost.g.step === 'invest');
    await off.waitForSelector('.proxy-row .pbtn');
    await off.click('.proxy-row:nth-child(2) .pbtn:nth-child(2)');    // 2팀 → 1팀 +100
    await off.click('.proxy-row:nth-child(2) .pbtn:nth-child(2)');
    await shot(off, 'offline-pitch-invest');
    await oAct('close'); await off.waitForFunction(() => window.__bbHost.g.step === 'result');
    const orr = await OG();
    check('비상 피칭: 대신 투자 200', orr.recv.t1 === 200, JSON.stringify(orr.recv));
    await offCtx.close();
  }

  const st = await (await fetch(`http://127.0.0.1:${mock.port}/admin/stats`)).json();
  const deniedInputs = st.deniedList.filter(d => /inputs/.test(d.path) && !/가가가가가가가가가가/.test(JSON.stringify(d)));
  report.mockStats = { ops: st.ops, writes: st.writes, denied: st.denied, deniedSample: st.deniedList.slice(-8) };
  check('규칙: 학생 입력 거절 (201자 시험 1건 빼고)', deniedInputs.length <= 1, JSON.stringify(deniedInputs.slice(0, 3)));
} catch (e) {
  check('시험 중단', false, e.message.split('\n')[0]);
  console.error(e);
  try { await shot(host, 'ERROR-host'); } catch {}
  try { for (const s of S.slice(0, 2)) await shot(s.page, 'ERROR-s' + s.num); } catch {}
} finally {
  try { await host.evaluate(() => { const H = window.__bbHost; if (H && H.code && H.net) return H.net.withTimeout(H.net.remove('rooms/' + H.code), 8000, '지우기'); }); } catch {}
  report.totalMs = Date.now() - T0;
  report.failures = failures;
  report.errors = [...new Set(report.errors)].slice(0, 50);
  fs.writeFileSync(path.join(SHOT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n결과: 확인 ${report.checks.length}개 중 실패 ${failures}개 · ${(report.totalMs / 1000).toFixed(0)}초 · 스크린샷 ${shotNo}장`);
  console.log('시간(ms):', JSON.stringify(report.timings));
  if (report.mockStats) console.log('가짜 DB:', JSON.stringify({ ops: report.mockStats.ops, writes: report.mockStats.writes, denied: report.mockStats.denied }));
  console.log(`페이지 오류 ${report.errors.length}건${report.errors.length ? ':\n  ' + report.errors.join('\n  ') : ''}`);
  await browser.close().catch(() => {});
  mock.close(); stat.close();
  process.exit(failures ? 1 : 0);
}
