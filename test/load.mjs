// 부하 · 흐름 시험: 진행판 1 + 조종기 N(기본 30) 브라우저 컨텍스트
//   node test/load.mjs                 가짜 DB(test/mockdb.mjs, 규칙 적용)로
//   node test/load.mjs --target emu    Firebase 에뮬레이터(127.0.0.1:9000/9099, 먼저 `npm run emu`)
//   node test/load.mjs --target real   실제 Firebase(규칙을 올린 뒤에만). 방 코드는 9xxx, 끝나면 지운다
//   옵션: --n 30 · --headed · --no-shots · --focus kimchi|yeast(그 게임만) · --repeat 3(김치 여러 판)
// 결과: 콘솔 요약 + test/shots/*.png (1366×768) + test/shots/report.json
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startMock } from './mockdb.mjs';
import { startStatic } from './serve.mjs';
import { predOf } from '../site/games/yeast.js';
import { devTag } from '../site/src/shared.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : d; };
const TARGET = arg('target', 'mock');
const N = Number(arg('n', 30));
const HEADED = !!arg('headed', false);
const SHOTS = !arg('no-shots', false);
const FOCUS = String(arg('focus', ''));          // --focus kimchi | yeast : 그 게임만(4~6 · 다른 게임 건너뜀)
const REPEAT = Number(arg('repeat', 1));          // --repeat 3 : 김치를 여러 판(타이밍 문제 재현용)
const VIEW = { width: 1366, height: 768 };
const SHOT_DIR = path.join(here, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

async function loadPlaywright() {
  try { return await import('playwright'); } catch {}
  const cache = path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx');
  if (fs.existsSync(cache)) {
    const found = fs.readdirSync(cache).map(d => path.join(cache, d, 'node_modules', 'playwright'))
      .filter(p => fs.existsSync(path.join(p, 'package.json')))
      .sort((a, b) => JSON.parse(fs.readFileSync(path.join(b, 'package.json'))).version.localeCompare(JSON.parse(fs.readFileSync(path.join(a, 'package.json'))).version, undefined, { numeric: true }));
    for (const p of found) { try { return await import(pathToFileURL(path.join(p, 'index.mjs')).href); } catch {} }
  }
  throw new Error('playwright 를 찾지 못했어요: npx playwright --version 으로 한 번 받아 두세요');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
// 학생의 「탭」: page.click() 은 애니메이션 프레임을 기다려서 한 컴퓨터에 31쪽이면 몇 초씩 걸린다(그래서 김치에서 누르기가 늦었다).
// DOM 에서 바로 누르고, 단추가 아직 없으면 0.2초 간격으로 다시 본다
async function tap(page, sel, tries = 15) {
  for (let k = 0; k < tries; k++) {
    const ok = await page.evaluate(q => { const b = document.querySelector(q); if (!b || b.disabled) return false; b.click(); return true; }, sel).catch(() => false);
    if (ok) return true;
    await sleep(200);
  }
  return false;
}
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const report = { target: TARGET, n: N, started: new Date().toISOString(), checks: [], timings: {}, errors: [] };
let failures = 0;
function check(name, cond, detail = '') {
  report.checks.push({ name, ok: !!cond, detail: String(detail) });
  if (!cond) failures++;
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
}
let shotNo = 0;
async function shot(page, name) {
  if (!SHOTS) return;
  shotNo++;
  const f = path.join(SHOT_DIR, `${String(shotNo).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: f }).catch(e => report.errors.push('shot ' + name + ': ' + e.message));
}
async function noScroll(page, name) {
  const r = await page.evaluate(() => {
    const els = [document.documentElement, document.querySelector('#stage') || document.querySelector('#main')];
    const out = els.map(e => e ? [e.scrollHeight, e.clientHeight] : [0, 0]);
    // 넘친 것이 잘려 안 보이는 경우도 잡는다: 화면 밖(아래)으로 나간 글자 · 단추
    const vh = window.innerHeight;
    const over = [...document.querySelectorAll('button, b, p, h1, h2, span, i')].filter(el => {
      if (el.closest('.gk-confetti')) return false;
      const b = el.getBoundingClientRect();
      return b.height > 0 && b.bottom > vh + 1;
    }).length;
    out.push([over, 0]);
    return out;
  });
  const okk = r.every(([s, c]) => s <= c + 1);
  if (!okk) check(`세로 스크롤 없음: ${name}`, false, JSON.stringify(r));
  return okk;
}

// ── 준비 ──
let mock = null, base = '';
const stat = await startStatic({ port: 8090 });
const SITE = `http://127.0.0.1:${stat.port}`;
if (TARGET === 'mock') { mock = await startMock({ port: 8797, latency: 40 }); base = `?mock=http://127.0.0.1:${mock.port}`; }
else if (TARGET === 'emu') base = '?emu=1';
else base = '?test=1';
console.log(`대상: ${TARGET} · 학생 ${N}명 · ${SITE}/host.html${base}`);

const { chromium } = await loadPlaywright();
let browser;
try { browser = await chromium.launch({ channel: 'chrome', headless: !HEADED }); }
catch { browser = await chromium.launch({ headless: !HEADED }); }

const AUTH_DIR = path.join(here, '.auth');
async function newCtx(name) {
  const f = path.join(AUTH_DIR, `${TARGET}-${name}.json`);
  const opts = { viewport: VIEW, locale: 'ko-KR' };
  if (TARGET !== 'mock' && fs.existsSync(f)) opts.storageState = f;
  const ctx = await browser.newContext(opts);
  // 지난 시험의 방 기억은 첫 로드 때 한 번만 지운다(새로 고침 시험은 그대로 둔다)
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('bbt')) { sessionStorage.setItem('bbt', '1'); localStorage.removeItem('bb.play'); localStorage.removeItem('bb.host.snap'); localStorage.removeItem('bb.host.rooms'); } } catch {} });
  ctx.__save = async () => { if (TARGET === 'mock') return; fs.mkdirSync(AUTH_DIR, { recursive: true }); await ctx.storageState({ path: f, indexedDB: true }).catch(() => {}); };
  return ctx;
}

function watchErrors(page, who) {
  page.on('pageerror', e => report.errors.push(`${who}: ${e.message}`));
  page.on('console', m => { if ((m.type() === 'error' || /FIREBASE|permission/i.test(m.text())) && !/Failed to load resource|ERR_CONNECTION_REFUSED|favicon|WebSocket connection to/.test(m.text())) report.errors.push(`${who} console: ${m.text().slice(0, 200)}`); });
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? (page.__promptAnswer || '') : undefined).catch(() => {}));
}

const T0 = Date.now();
const hostCtx = await newCtx('host');
const host = await hostCtx.newPage();
watchErrors(host, 'host');
const H = (fn, a) => host.evaluate(fn, a);
const waitH = (fn, a, timeout = 20000) => host.waitForFunction(fn, a, { timeout, polling: 100 });

const S = [];   // {ctx, page, num}
try {
  // ── 1. 방 만들기 ──
  console.log('\n[1] 방 만들기');
  await host.goto(`${SITE}/host.html${base}`);
  await host.waitForSelector('#bCreate:not([disabled])', { timeout: 20000 });
  await host.click('#segCls .segb[data-v="4"]');
  await host.click('#segSize .segb[data-v="4"]');
  await host.click('#segMode .segb[data-v="pick"]');
  await shot(host, 'host-start');
  await host.click('#bCreate');
  await waitH(() => window.__bbHost.code && window.__bbHost.meta.phase === 'lobby');
  const code = await H(() => window.__bbHost.code);
  check('방 코드 9xxx', /^9\d{3}$/.test(code), code);
  await shot(host, 'host-lobby-empty');

  // ── 2. 학생 N명 접속 ──
  console.log(`\n[2] 학생 ${N}명 접속`);
  // S = 학생 목록 (위에서 선언)
  async function student(num, label = '') {
    const ctx = await newCtx(`s${num}${label}`);
    const page = await ctx.newPage();
    watchErrors(page, `s${num}${label}`);
    await page.goto(`${SITE}/${base}`);
    await page.waitForSelector('#iCode', { timeout: 20000 });
    return { ctx, page, num };
  }
  const tJoin = Date.now();
  for (let b = 0; b < N; b += 10) {
    const batch = await Promise.all(Array.from({ length: Math.min(10, N - b) }, (_, i) => student(b + i + 1)));
    S.push(...batch);
  }
  if (SHOTS) { await S[0].page.fill('#iCode', code); await S[0].page.fill('#iNum', '1'); await shot(S[0].page, 'play-join'); }
  await Promise.all(S.map(async s => {
    await s.page.fill('#iCode', code);
    await s.page.fill('#iNum', String(s.num));
    await s.page.click('button[type=submit]');
  }));
  await waitH(n => Object.values(window.__bbHost.players).filter(p => p.on).length >= n, N, 40000);
  report.timings.join30 = Date.now() - tJoin;
  check(`${N}명 접속`, true, `${report.timings.join30}ms`);
  await hostCtx.__save(); await Promise.all(S.map(s => s.ctx.__save()));
  await Promise.all(S.map(s => s.page.waitForFunction(() => window.__bbPlay.joined && document.querySelector('.pv-huge'), null, { timeout: 20000 })));
  const uids = await Promise.all(S.map(s => s.page.evaluate(() => window.__bbPlay.net.uid)));
  S.forEach((s, i) => { s.uid = uids[i]; });
  check('uid 모두 다름', new Set(uids).size === N);
  await shot(host, 'host-lobby-full'); await noScroll(host, 'host lobby');
  await shot(S[6].page, 'play-lobby'); await noScroll(S[6].page, 'play lobby');

  // ── 3. 자유 선택: 모두 한 팀으로 몰림 ──
  console.log('\n[3] 팀 고르기 — 모두 1팀으로 몰림');
  await host.click('#bTeam');
  await Promise.all(S.map(s => s.page.waitForSelector('.pk-btn[data-t="t1"]', { timeout: 15000 })));
  const k = await H(() => Object.keys(window.__bbHost.teams).length);
  const cap = Math.ceil(N / k);
  check('팀 수 = ceil(N/4)', k === Math.min(8, Math.max(2, Math.ceil(N / 4))), `${k}팀`);
  await shot(S[0].page, 'play-pick');
  const tPick = Date.now();
  await Promise.all(S.map(s => s.page.click('.pk-btn[data-t="t1"]', { timeout: 5000 }).catch(() => {})));
  await waitH(() => { const pk = window.__bbHost.core.pick; return pk && Object.keys(pk.got).length >= 1 && pk.seats.t1 === 0; }, null, 15000);
  await sleep(2500);
  const got = await H(() => window.__bbHost.core.pick.got);
  const inT1 = Object.values(got).filter(t => t === 't1').length;
  check(`1팀 정원(${cap}) 안에서만 자리`, inT1 <= cap && inT1 >= 1, `${inT1}명`);
  report.timings.pickRush = Date.now() - tPick;
  // 조종기에서 1팀 잠김 확인
  const locked = await Promise.all(S.map(s => s.page.evaluate(() => { const b = document.querySelector('.pk-btn[data-t="t1"]'); return b ? (b.disabled || b.classList.contains('on')) : null; })));
  check('조종기: 1팀 버튼 잠김(자리 잡은 사람 빼고)', locked.every(Boolean), locked.filter(x => !x).length + '명 안 잠김');
  const loser = S.find(s => got[s.uid] !== 't1');
  if (loser) await shot(loser.page, 'play-pick-full');
  await shot(host, 'host-pick');
  // 몇 명은 다른 팀으로 바꾼다
  const movers = S.filter(s => !got[s.uid]).slice(0, 8);
  await Promise.all(movers.map(async s => { const t = 't' + (2 + Math.floor(Math.random() * (k - 1))); await s.page.click(`.pk-btn[data-t="${t}"]`, { timeout: 3000 }).catch(() => {}); }));
  await sleep(1500);
  await host.click('#bClose');
  await waitH(() => window.__bbHost.core.pick && window.__bbHost.core.pick.open === false);
  const draft = await H(() => window.__bbHost.draft);
  const sizes = Object.keys(await H(() => window.__bbHost.teams)).map(t => Object.values(draft).filter(x => x === t).length);
  check(`마감: ${N}명 모두 배정`, Object.keys(draft).length === N, Object.keys(draft).length);
  check('마감: 팀 인원 차이 ≤ 1', Math.max(...sizes) - Math.min(...sizes) <= 1, sizes.join('·'));
  check('마감: 먼저 자리 잡은 사람 그대로', Object.entries(got).every(([u, t]) => draft[u] === t));
  await shot(host, 'host-pick-result'); await noScroll(host, 'host pick result');
  await S[5].page.waitForSelector('.team-card, .pv-big', { timeout: 5000 });
  await shot(S[5].page, 'play-pick-result');
  await host.click('#bOK');
  await waitH(() => window.__bbHost.meta.phase === 'result' && Object.keys(window.__bbHost.roster).length > 0);
  check('확정: roster 인원', (await H(() => Object.keys(window.__bbHost.roster).length)) === N);
  await Promise.all(S.map(s => s.page.waitForSelector('.team-card', { timeout: 15000 })));
  check('조종기: 모두 내 팀 카드', true);
  await shot(host, 'host-hub-teams'); await noScroll(host, 'host hub');
  await shot(S[2].page, 'play-hub');

  if (!FOCUS) {
  // ── 4. 같은 번호 다른 기기 ──
  console.log('\n[4] 같은 번호로 다른 기기 접속(7번)');
  const old7 = S[6];
  const old7Team = await H(u => window.__bbHost.roster[u].team, old7.uid);
  const new7 = await student(7, 'b');
  await new7.page.fill('#iCode', code); await new7.page.fill('#iNum', '7'); await new7.page.click('button[type=submit]');
  await old7.page.waitForFunction(() => window.__bbPlay.kicked, null, { timeout: 15000 });
  new7.uid = await new7.page.evaluate(() => window.__bbPlay.net.uid);
  await new7.ctx.__save();
  await waitH(u => window.__bbHost.roster[u], new7.uid, 10000);
  const r7 = await H(([a, b]) => [window.__bbHost.roster[a] || null, window.__bbHost.roster[b] || null], [old7.uid, new7.uid]);
  check('앞 기기 「다른 기기에서 접속」으로 나감', await old7.page.evaluate(() => document.body.innerText.includes('다른 기기에서')));
  check('새 기기가 같은 팀을 물려받음', r7[1] && r7[1].team === old7Team && !r7[0], JSON.stringify(r7));
  await new7.page.waitForSelector('.team-card', { timeout: 10000 });
  await shot(old7.page, 'play-kicked');
  await old7.ctx.close();
  S[6] = new7;

  // ── 4b. 같은 번호가 2분 안에 계속 바뀜 → 교사에게 묻기 ──
  console.log('\n[4b] 7번이 2분 안에 3번 바뀜 → 「누가 진짜?」');
  const join7 = async label => {
    const st = await student(7, label);
    await st.page.fill('#iCode', code); await st.page.fill('#iNum', '7'); await st.page.click('button[type=submit]');
    await st.page.waitForFunction(() => window.__bbPlay.joined, null, { timeout: 15000 });
    st.uid = await st.page.evaluate(() => window.__bbPlay.net.uid);
    return st;
  };
  const c7 = await join7('c');                                   // 2번째 바뀜 → 아직 자동
  await new7.page.waitForFunction(() => window.__bbPlay.kicked, null, { timeout: 15000 });
  await waitH(u => window.__bbHost.roster[u], c7.uid, 10000);
  check('2번째 바뀜은 자동(앞 기기 내보냄 · 팀 물려받음)', (await H(u => window.__bbHost.roster[u].team, c7.uid)) === old7Team);
  check('같은 알림은 하나로 합침', (await host.$$eval('#toasts .toast', a => a.filter(x => x.textContent.startsWith('7번이 다른 기기로')).length)) <= 1);
  const d7 = await join7('d');                                   // 3번째 → 묻는다
  await waitH(() => window.__bbHost.dupAsk[7], null, 10000);
  await sleep(600);
  const kc = await c7.page.evaluate(() => window.__bbPlay.kicked), kd = await d7.page.evaluate(() => window.__bbPlay.kicked);
  check('3번째 바뀜 → 자동으로 내보내지 않음(두 기기 다 남음)', !kc && !kd, `${kc}/${kd}`);
  const askTxt = await host.innerText('#asks');
  check('진행판 「⚠ 7번 두 기기 — 누가 진짜?」 + 기기 글자', askTxt.includes('7번 두 기기') && askTxt.includes(devTag(c7.uid)) && askTxt.includes(devTag(d7.uid)), askTxt.replace(/\s+/g, ' ').slice(0, 80));
  check('조종기에 기기 글자', (await d7.page.innerText('#bar')).includes('기기 ' + devTag(d7.uid)));
  await shot(host, 'host-dup-ask'); await shot(d7.page, 'play-dup-device');
  check('묻는 동안 새 기기는 팀을 안 가져감', !(await H(u => window.__bbHost.roster[u], d7.uid)) && (await H(u => window.__bbHost.roster[u].team, c7.uid)) === old7Team);
  await host.click(`#asks [data-u="${c7.uid}"]`);
  await d7.page.waitForFunction(() => window.__bbPlay.kicked === 'host', null, { timeout: 10000 });
  check('교사가 고른 기기만 남음', (await H(u => window.__bbHost.roster[u] && window.__bbHost.roster[u].team, c7.uid)) === old7Team && !(await H(() => Object.keys(window.__bbHost.dupAsk).length)) && (await host.innerText('#asks')).trim() === '');
  await new7.ctx.close(); await d7.ctx.close();
  S[6] = c7;

  // ── 5. 끊김 · 다시 접속 ──
  console.log('\n[5] 끊김 · 다시 접속(12번)');
  const s12 = S[11];
  const team12 = await H(u => window.__bbHost.roster[u].team, s12.uid);
  if (mock) {
    await fetch(`http://127.0.0.1:${mock.port}/admin/drop?uid=${s12.uid}`, { method: 'POST' });
    await waitH(u => window.__bbHost.players[u] && window.__bbHost.players[u].on === false, s12.uid, 10000);
    check('끊기면 진행판에 「끊김」(onDisconnect)', true);
    await shot(host, 'host-hub-lost');
    await waitH(u => window.__bbHost.players[u] && window.__bbHost.players[u].on === true, s12.uid, 15000);
    check('저절로 다시 붙으면 「접속」', true);
  } else {
    await s12.ctx.setOffline(true); await sleep(4000); await s12.ctx.setOffline(false);
  }
  await s12.page.reload();
  await s12.page.waitForSelector('.team-card', { timeout: 20000 });
  const uid12b = await s12.page.evaluate(() => window.__bbPlay.net.uid);
  check('새로 고침 → 저절로 다시 들어옴 · 같은 uid · 같은 팀', uid12b === s12.uid && (await H(u => window.__bbHost.roster[u].team, s12.uid)) === team12);

  // ── 6. 교사 지정 모드 ──
  console.log('\n[6] 교사 지정 모드');
  await H(() => { window.__bbHost.meta.mode = 'assign'; });
  await host.click('#bRedo');
  await host.waitForSelector('.tcol.pool', { timeout: 10000 });
  check('교사 지정: 처음엔 모두 「아직 팀 없음」', (await host.$$eval('.tcol.pool .chip', a => a.length)) === N);
  await shot(host, 'host-assign-pool');
  await host.click('#bShuf');
  const d1 = await H(() => window.__bbHost.draft);
  const sz1 = Object.keys(await H(() => window.__bbHost.teams)).map(t => Object.values(d1).filter(x => x === t).length);
  check('무작위로 나누기: 차이 ≤ 1', Math.max(...sz1) - Math.min(...sz1) <= 1, sz1.join('·'));
  // 한 명 옮기기: 번호 누르고 → 다른 팀 이름 누르기
  const mvUid = Object.keys(d1)[0], from = d1[mvUid], to = from === 't1' ? 't2' : 't1';
  await host.click(`.chip[data-uid="${mvUid}"]`);
  await host.click(`.tcol-h[data-tid="${to}"]`);
  check('한 명 옮기기(누르기 방식)', (await H(u => window.__bbHost.draft[u], mvUid)) === to);
  // 끌어다 놓기도
  const mv2 = Object.keys(d1)[1], to2 = (await H(u => window.__bbHost.draft[u], mv2)) === 't3' ? 't4' : 't3';
  await host.dragAndDrop(`.chip[data-uid="${mv2}"]`, `.tcol[data-tid="${to2}"]`).catch(e => report.errors.push('drag: ' + e.message));
  check('한 명 옮기기(끌어다 놓기)', (await H(u => window.__bbHost.draft[u], mv2)) === to2);
  await shot(host, 'host-assign-edit'); await noScroll(host, 'host assign');
  await host.click('#bOK');
  await waitH(() => window.__bbHost.meta.phase === 'result');
  const ros = await H(() => window.__bbHost.roster);
  check('교사 지정 확정: 모두 팀 있음', Object.keys(ros).length === N);
  await H(() => { window.__bbHost.meta.mode = 'pick'; });

  }
  if (FOCUS !== 'kimchi') {
  // ── 7. 효모 풍선 대결 ──
  console.log('\n[7] 효모 풍선 대결 (3라운드)');
  const tYeast = Date.now();
  await host.click('.gcard[data-gid="yeast"]');
  await host.waitForSelector('#bGo');
  await S[0].page.waitForFunction(() => document.body.innerText.includes('준비'), null, { timeout: 10000 });
  await shot(host, 'host-yeast-intro'); await shot(S[0].page, 'play-yeast-intro');
  await host.click('#bGo');
  const TEMPS = [10, 25, 40, 70], SUG = [0, 1, 2];
  for (let round = 1; round <= 3; round++) {
    await waitH(r => window.__bbHost.g && window.__bbHost.g.step === 'vote' && window.__bbHost.g.round === r, round, 15000);
    // 한 컴퓨터에 31쪽이면 화면이 늦게 뜬다 → 진행판 「+10초」로 여유를 둔다(모두 고르면 어차피 일찍 마감)
    await host.click('[data-act="more"]').catch(() => {});
    const choice = {}, taps = {};
    const tv = Date.now();
    await Promise.all(S.map(async (s, i) => {
      await s.page.waitForSelector('[data-temp]', { timeout: 40000 });
      await sleep(rnd(0, 2500));
      // 3라운드에는 대부분 40℃ · 많이(되먹임을 배운 셈)
      const t = round === 3 && Math.random() < 0.7 ? 40 : pick(TEMPS), su = round === 3 && Math.random() < 0.7 ? 2 : pick(SUG);
      choice[s.uid] = { t, su };
      const a = await tap(s.page, `[data-temp="${t}"]`);
      const b = await tap(s.page, `[data-sugar="${su}"]`);
      // 진단용: 누른 뒤 내 입력(P.mine)에 온도 · 설탕이 다 들어갔나 (! = 안 들어감)
      const mineNow = await s.page.evaluate(() => window.__bbPlay.mine).catch(() => null);
      taps[s.uid] = `${a ? 'T' : 't'}${b ? 'S' : 's'}${mineNow && mineNow.temp != null && mineNow.sugar != null ? '' : '!'}`;
    }));
    if (round === 1) { await sleep(300); await shot(host, 'host-yeast-vote'); await shot(S[3].page, 'play-yeast-vote'); await noScroll(S[3].page, 'play yeast vote'); }
    await waitH(() => window.__bbHost.g.step === 'ferment', null, 40000);
    report.timings['yeastVote' + round] = Date.now() - tv;
    const g = await H(() => window.__bbHost.g);
    const ros2 = await H(() => window.__bbHost.roster);
    // 팀 결정 = 팀원 표 중 하나(무작위 아님), 분명한 다수결이면 그 값.
    // 표는 DB 에서 마감(발효 시작 predFrom) 전에 서버에 들어간 것만 센다 — 컴퓨터가 바쁘면 늦게 낸 표는 빠지는 것이 맞다
    const gnoV = await H(() => window.__bbHost.gameNo);
    const vdb = (await H(([c, k]) => window.__bbHost.net.get(`rooms/${c}/inputs/${k}`), [code, `${gnoV}-y${round}`])) || {};
    let okMaj = true, detail = [];
    for (const [tid, r] of Object.entries(g.run)) {
      const mem = S.filter(s => ros2[s.uid] && ros2[s.uid].team === tid);
      const cnt = {}; mem.forEach(s => { const v = vdb[s.uid]; if (v && typeof v.temp === 'number' && v.t <= g.predFrom) cnt[v.temp] = (cnt[v.temp] || 0) + 1; });
      const sorted = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
      if (r.rand) { okMaj = false; detail.push(tid + ' 무작위'); }
      if (sorted.length && (sorted.length === 1 || sorted[0][1] > sorted[1][1]) && Number(sorted[0][0]) !== r.temp) { okMaj = false; detail.push(`${tid} ${JSON.stringify(cnt)}→${r.temp}`); }
    }
    check(`${round}라운드 팀 결정 = 팀원 다수결`, okMaj, detail.join(' '));
    check(`${round}라운드 모두 고르면 일찍 마감`, g.early === true, g.early ? '' : JSON.stringify(Object.fromEntries(Object.entries(g.tally || {}).map(([k, v]) => [k, `${v.done}/${v.need}`]))) + ' 누름 ' + JSON.stringify(Object.values(taps).reduce((a, x) => (a[x] = (a[x] || 0) + 1, a), {})));
    // 발효 중 「우리 풍선 몇 cm?」 예측 — 두 명은 안 낸다
    const pchoice = {};
    const tp = Date.now();
    const preds = Promise.all(S.map(async (s, i) => {
      if (i === 1 || i === 2) return;
      await sleep(rnd(200, 3000));
      const v = Math.floor(Math.random() * 4);
      if (await tap(s.page, `[data-pred="${v}"]`)) pchoice[s.uid] = v;
    }));
    if (round === 1) {
      await sleep(2500);
      await shot(host, 'host-yeast-ferment-pred'); await noScroll(host, 'host yeast ferment pred');
      await shot(S[3].page, 'play-yeast-pred'); await noScroll(S[3].page, 'play yeast pred');
    }
    await preds;
    report.timings['yeastPred' + round] = Date.now() - tp;
    if (round === 1) {
      await sleep(9000);
      await shot(host, 'host-yeast-ferment'); await noScroll(host, 'host yeast ferment');
      await shot(S[3].page, 'play-yeast-ferment');
      await waitH(() => window.__bbHost.g.deadline - window.__bbHost.net.serverNow() < 1200, null, 30000);
      await shot(host, 'host-yeast-ferment-end');
    }
    await waitH(() => window.__bbHost.g.step === 'reveal', null, 45000);
    await sleep(800);
    const gr = await H(() => window.__bbHost.g);
    const ok70 = Object.values(gr.run).every(r => (r.temp === 70 ? r.cm === 10 : r.cm > 10));
    check(`${round}라운드 70℃ = 10cm(효모 죽음), 나머지는 부풂`, ok70);
    {
      const goal = [null, 25, 30][round - 1];
      const val = Object.fromEntries(Object.entries(gr.run).map(([k, r]) => [k, goal == null ? Math.round(r.cm) : -Math.abs(Math.round(r.cm) - goal)]));
      const best = Math.max(...Object.values(val));
      const firsts = Object.keys(val).filter(k => val[k] === best);
      check(`${round}라운드 1위 = ${goal == null ? '가장 큰 정수 cm' : '목표 ' + goal + 'cm 에 가장 가까움'}`, firsts.every(k => gr.rank[k] === 1) && Object.keys(gr.rank).filter(k => gr.rank[k] === 1).length === firsts.length, firsts.join(','));
    }
    {
      // 예측 점수 = 팀에서 맞힌 사람 비율(0.1 단위) — DB 에 들어간 예측(서버 시각이 잠금 전인 것)으로 다시 센다.
      // 시험이 누른 값과도 맞춰 본다(이 컴퓨터가 바쁘면 잠금 뒤에 도착한 것은 안 세는 것이 맞다)
      const gno = await H(() => window.__bbHost.gameNo);
      const pdb = (await H(([c, k]) => window.__bbHost.net.get(`rooms/${c}/inputs/${k}`), [code, `${gno}-p${round}`])) || {};
      const onTime = Object.fromEntries(Object.entries(pdb).filter(([, v]) => v && typeof v.pred === 'number' && v.t >= gr.predFrom - 300 && v.t <= gr.predUntil).map(([u, v]) => [u, v.pred]));
      const lateP = Object.values(pdb).filter(v => v && v.t > gr.predUntil).length;
      const mism = Object.entries(onTime).filter(([u, v]) => pchoice[u] !== undefined && pchoice[u] !== v).length;
      let okP = mism === 0; const det = [];
      for (const [tid, r] of Object.entries(gr.run)) {
        const mem = (gr.predNeed || {})[tid] || [];
        const ans = predOf(r.cm);
        const right = mem.filter(u => onTime[u] === ans).length;
        const h = gr.history[tid].slice(-1)[0];
        const want = mem.length ? Math.round(right / mem.length * 10) / 10 : 0;
        if (!h.pred || h.pred.pts !== want || h.pred.n !== mem.length) { okP = false; det.push(`${tid} ${JSON.stringify(h.pred)} ≠ ${right}/${mem.length}`); }
      }
      check(`${round}라운드 예측 점수 = 맞힌 비율`, okP, det.join(' ') || `제때 ${Object.keys(onTime).length}/${N}${lateP ? ` · 잠금 뒤 도착 ${lateP}(시험 컴퓨터 부하)` : ''}${mism ? ` · 누른 값과 다름 ${mism}` : ''}`);
    }
    if (round === 1) { await shot(host, 'host-yeast-reveal'); await noScroll(host, 'host yeast reveal'); await shot(S[3].page, 'play-yeast-reveal'); }
    await host.click('[data-act="next"]');
  }
  await waitH(() => window.__bbHost.g && window.__bbHost.g.step === 'card');
  await sleep(2800);
  await shot(host, 'host-yeast-card'); await noScroll(host, 'host yeast card');
  const before = await H(() => Object.fromEntries(Object.entries(window.__bbHost.teams).map(([k, t]) => [k, t.score])));
  const totalY = await H(() => window.__bbHost.g.final);
  await host.click('[data-act="finish"]');
  await waitH(() => window.__bbHost.meta.phase === 'result' && window.__bbHost.core.last);
  const after = await H(() => Object.fromEntries(Object.entries(window.__bbHost.teams).map(([k, t]) => [k, t.score])));
  check('효모: 팀 점수 = 3라운드 합(+예측)', Object.keys(after).every(t => after[t] - before[t] === (totalY[t] || 0)), JSON.stringify(totalY));
  report.timings.yeast = Date.now() - tYeast;
  await sleep(1200);
  await shot(host, 'host-yeast-result'); await noScroll(host, 'host result');
  await S[3].page.waitForSelector('.team-card'); await shot(S[3].page, 'play-yeast-result');

  // ── 7b. 진행판 새로 고침 → 이어서 하기 ──
  console.log('\n[7b] 진행판 새로 고침 → 이어서 하기');
  const scoresBefore = await H(() => Object.values(window.__bbHost.teams).map(t => t.score).join());
  const hostUid = await H(() => window.__bbHost.net.uid);
  await host.reload();
  await host.waitForSelector('#bResume', { timeout: 20000 });
  await host.click('#bResume');
  await waitH(() => window.__bbHost.meta && window.__bbHost.meta.phase === 'result' && Object.values(window.__bbHost.players).filter(p => p.on).length > 0, null, 20000);
  check('새로 고침 뒤 같은 진행판 uid', (await H(() => window.__bbHost.net.uid)) === hostUid);
  check('이어서 하기: 점수 · 팀 그대로', (await H(() => Object.values(window.__bbHost.teams).map(t => t.score).join())) === scoresBefore);
  await waitH(n => Object.values(window.__bbHost.players).filter(p => p.on).length >= n, N, 15000);
  check('이어서 하기: 학생 접속 그대로', true);

  }

  // ── 8. 김치 숙성 타이밍 ──
  for (let rep = 1; rep <= (FOCUS === 'yeast' ? 0 : REPEAT); rep++) {
  console.log('\n[8] 김치 숙성 타이밍 (3라운드, 3라운드 정전)');
  const tK = Date.now();
  await host.click('.gcard[data-gid="kimchi"]');
  await host.waitForSelector('#bGo');
  await shot(host, 'host-kimchi-intro');
  await host.click('#bGo');
  const RATE = [3.4, 8.0, 3.4];
  for (let round = 1; round <= 3; round++) {
    await waitH(r => window.__bbHost.g && window.__bbHost.g.round === r && (window.__bbHost.g.step === 'ready' || window.__bbHost.g.step === 'run'), round, 15000);
    const g0 = await H(() => window.__bbHost.g);
    const startIn = g0.startAt - (await H(() => window.__bbHost.net.serverNow()));
    if (round === 1) { await sleep(500); await shot(host, 'host-kimchi-ready'); }
    await sleep(Math.max(0, startIn) + 100);
    // 이 라운드에 숙성도 100 이 되기까지 걸리는 시간(초)
    const dur = round === 3 ? g0.eventSec + (100 - 3.4 * g0.eventSec) / 12 : 100 / RATE[round - 1];
    const tPress = Date.now();
    const clicks = {};
    const presses = Promise.all(S.map(async (s, i) => {
      if (i === N - 1) return;                       // 한 명은 안 누른다(0점)
      const want = rnd(0.15, 0.85) * dur * 1000;
      await sleep(want);
      const t1 = Date.now();
      const c = { want: Math.round(want), start: t1 - tPress };
      // page.click() 은 애니메이션 프레임을 기다린다 → 한 컴퓨터에 31쪽이면 3초를 넘겨 누르기 자체가 안 됐다(2026-10-20 진단)
      c.ok = await tap(s.page, '.k-out', 10);
      if (!c.ok) c.err = 'no button';
      c.took = Date.now() - t1; c.end = Date.now();
      clicks[s.uid] = c;
    }));
    if (round === 1) { await sleep(dur * 400); await shot(host, 'host-kimchi-run'); await noScroll(host, 'host kimchi run'); await shot(S[0].page, 'play-kimchi-run'); }
    if (round === 3) { await sleep(g0.eventSec * 1000 + 500); await shot(host, 'host-kimchi-blackout'); await shot(S[N - 1].page, 'play-kimchi-blackout'); }
    await presses;
    await waitH(() => window.__bbHost.g.step === 'reveal', null, 40000);
    const gk = await H(() => window.__bbHost.g);
    // 팀 점수 = 팀원 평균 (못 누른 사람 0 · 3명 이상이면 가장 낮은 점수 하나 뺌)
    let okAvg = true;
    for (const [tid, uids] of Object.entries(gk.need)) {
      const list = uids.map(u => gk.scores[u] || 0);
      const sum = list.reduce((x, y) => x + y, 0);
      const m = list.length >= 3 ? Math.round((sum - Math.min(...list)) / (list.length - 1)) : list.length ? Math.round(sum / list.length) : 0;
      if (m !== gk.avg[tid]) okAvg = false;
    }
    const pressedN = Object.values(gk.marks).flat().filter(m => m.p != null).length;
    check(`김치 ${round}라운드 팀 점수 = 팀원 평균(3명↑ 최저 1개 뺌)`, okAvg);
    const okClicks = Object.values(clicks).filter(c => c.ok).length;
    {
      // 못 센 사람 진단: 클릭이 실패했나(시험 문제) · 클릭은 됐는데 진행판이 못 받았나(게임 문제)
      const miss = S.filter((s, i) => i !== N - 1 && (!gk.first || gk.first[s.uid] === undefined));
      const diag = await Promise.all(miss.map(async s => {
        const inNeed = Object.values(gk.need).some(l => l.includes(s.uid));
        const mine = await s.page.evaluate(() => window.__bbPlay.mine).catch(() => 'err');
        const c = clicks[s.uid];
        return { num: s.num, inNeed, click: c && { ...c, end: undefined, endVsClose: gk.closeAt ? c.end - gk.closeAt : null }, mine };
      }));
      // DB 에 들어간 입력 중 서버 시각이 마감(closeAt) 이전인 것은 반드시 세어야 한다 — 어기면 게임이 입력을 버린 것
      const gno = await H(() => window.__bbHost.gameNo);
      const db = (await H(([c, k]) => window.__bbHost.net.get(`rooms/${c}/inputs/${k}`), [code, `${gno}-k${round}`])) || {};
      const dropped = Object.entries(db).filter(([u, v]) => v && v.t && v.t <= gk.closeAt && gk.first[u] === undefined).map(([u, v]) => ({ u: u.slice(0, 6), early: gk.closeAt - v.t }));
      check(`김치 ${round}라운드 마감 전에 들어온 입력은 모두 셈`, dropped.length === 0, dropped.length ? JSON.stringify(dropped) : `DB ${Object.keys(db).length}건`);
      // 센 사람 = 서버 시각이 마감 전인 입력 수(정확히 같아야 한다). 마감 뒤 시각은 늦게 낸 것 — 이 컴퓨터가 바쁘면 생긴다
      const onTime = Object.values(db).filter(v => v && v.t >= gk.startAt && v.t <= gk.closeAt).length;
      const lateMs = Object.values(db).filter(v => v && v.t > gk.closeAt).map(v => v.t - gk.closeAt);
      check(`김치 ${round}라운드 누른 사람 수 = 마감 전 서버 시각 입력 수`, pressedN === onTime && pressedN >= N / 2,
        `${pressedN}/${N} · 누르기 ${okClicks} · 마감 뒤 서버 도착 ${lateMs.length}건${lateMs.length ? `(최대 +${Math.max(...lateMs)}ms — 시험 컴퓨터 부하)` : ''}`);
      report.kimchiDiag = report.kimchiDiag || [];
      report.kimchiDiag.push({ rep, round, dur: Math.round(dur * 1000), eventSec: gk.eventSec, closeAt: gk.closeAt, miss: diag });
      if (diag.length) console.log('    못 센 사람:', JSON.stringify(diag));
    }
    if (round === 3) check('김치 3라운드 정전 이벤트', gk.eventOn === true, `정전 ${gk.eventSec}초`);
    if (round === 1) { await sleep(600); await shot(host, 'host-kimchi-reveal'); await noScroll(host, 'host kimchi reveal'); await shot(S[0].page, 'play-kimchi-reveal'); }
    await host.click('[data-act="next"]');
  }
  await waitH(() => window.__bbHost.g && window.__bbHost.g.step === 'fact');
  await sleep(900);
  await shot(host, 'host-kimchi-fact');
  await host.click('[data-act="finish"]');
  await waitH(() => window.__bbHost.meta.phase === 'result' && window.__bbHost.core.last && window.__bbHost.core.last.gid === 'kimchi');
  report.timings.kimchi = Date.now() - tK;
  await sleep(1200);
  await shot(host, 'host-kimchi-result');
  }

  // ── 9. 수업 끝 · 방 지우기 ──
  console.log('\n[9] 수업 끝 · 시상 · 방 지우기');
  await host.click('#bEnd');
  await waitH(() => window.__bbHost.meta.phase === 'end');
  await Promise.all(S.map(s => s.page.waitForFunction(() => document.body.innerText.includes('최종 순위'), null, { timeout: 15000 })));
  await sleep(1500);
  await shot(host, 'host-end'); await noScroll(host, 'host end');
  await shot(S[0].page, 'play-end');
  await host.click('#bCloseRoom');
  await host.waitForSelector('#bCreate', { timeout: 15000 });
  await Promise.all(S.map(s => s.page.waitForFunction(() => document.body.innerText.includes('수업이 끝났어요'), null, { timeout: 15000 })));
  check('방 지우기 → 조종기 모두 「수업이 끝났어요」', true);
  await shot(S[0].page, 'play-ended');
  if (mock) {
    const left = await (await fetch(`http://127.0.0.1:${mock.port}/admin/dump?path=rooms/${code}`)).json();
    check('DB 에서 방이 지워짐', left.val === null);
    const st = await (await fetch(`http://127.0.0.1:${mock.port}/admin/stats`)).json();
    report.mockStats = { ops: st.ops, writes: st.writes, pushes: st.pushes, denied: st.denied, deniedSample: st.deniedList.slice(-10) };
  } else {
    const m = await H(c => window.__bbHost.net.get(`rooms/${c}/meta`), code).catch(() => 'err');
    check('DB 에서 방이 지워짐', m === null);
  }

  // ── 10. 비상 모드 (DB 없음) ──
  console.log('\n[10] 비상 모드 — DB 연결 실패');
  const offCtx = await browser.newContext({ viewport: VIEW, locale: 'ko-KR' });
  const off = await offCtx.newPage();
  watchErrors(off, 'offline-host');
  off.__promptAnswer = '4';
  await off.goto(`${SITE}/host.html?mock=http://127.0.0.1:1`);
  await off.waitForSelector('.errbox', { timeout: 20000 });
  await shot(off, 'host-offline-fail');
  await off.click('#bOffline');
  await off.waitForSelector('.gcard[data-gid="kimchi"]', { timeout: 10000 });
  check('비상 모드: 팀 4개', (await off.evaluate(() => Object.keys(window.__bbHost.teams).length)) === 4);
  await off.click('.gcard[data-gid="yeast"]');
  await off.click('#bGo');
  await off.waitForSelector('.pbtn', { timeout: 10000 });
  const pb = await off.$$('.proxy-row');
  for (let i = 0; i < pb.length; i++) {
    await off.click(`.proxy-row:nth-child(${i + 1}) .pbtn:nth-child(${2 + (i % 4)})`);
    await off.click(`.proxy-row:nth-child(${i + 1}) .pbtn:nth-child(${6 + (i % 3)})`);
  }
  await shot(off, 'host-offline-proxy');
  await off.click('[data-act="skip"]');
  await off.waitForFunction(() => window.__bbHost.g && window.__bbHost.g.step === 'ferment', null, { timeout: 10000 });
  const offRun = await off.evaluate(() => window.__bbHost.g.run);
  check('비상 모드: 교사가 누른 조건 그대로', Object.values(offRun).every(r => !r.rand), JSON.stringify(Object.values(offRun).map(r => r.temp + '/' + r.sugar)));
  await offCtx.close();
} catch (e) {
  check('시험 중단', false, e.message.split('\n')[0]);
  try { for (const s of S.slice(0, 3)) report.errors.push('s' + s.num + ' 화면: ' + (await s.page.innerText('#main')).replace(/\s+/g, ' ').slice(0, 160)); } catch {}
  console.error(e);
  try { await shot(host, 'ERROR-host'); } catch {}
} finally {
  // 실패해도 시험 방은 지운다(진행판만 지울 수 있다)
  try { await host.evaluate(() => { const H = window.__bbHost; if (H && H.code && H.net) return H.net.withTimeout(H.net.remove('rooms/' + H.code), 8000, '지우기'); }); } catch {}
  report.totalMs = Date.now() - T0;
  report.failures = failures;
  report.errors = [...new Set(report.errors)].slice(0, 50);
  fs.writeFileSync(path.join(SHOT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n결과: 확인 ${report.checks.length}개 중 실패 ${failures}개 · 걸린 시간 ${(report.totalMs / 1000).toFixed(0)}초`);
  console.log('시간(ms):', JSON.stringify(report.timings));
  if (report.mockStats) console.log('가짜 DB:', JSON.stringify(report.mockStats));
  console.log(`페이지 오류 ${report.errors.length}건${report.errors.length ? ':\n  ' + report.errors.join('\n  ') : ''}`);
  await browser.close().catch(() => {});
  stat.close(); if (mock) mock.close();
  process.exit(failures || report.errors.length ? 1 : 0);
}
