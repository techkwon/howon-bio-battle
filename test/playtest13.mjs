// 13차시 플레이테스트(재미 · 공정 · 장난 점검): 진행판 1 + 조종기 12 (가짜 DB, 실제 Firebase 아님)
//   node test/playtest13.mjs [--headed]
// 결과: test/playtest13/*.png (진행판 1366×768 · 조종기 1366×768) + test/playtest13/report.json
// 학생 성격(페르소나)을 흉내 낸다:
//   경쟁형(정답 조건 · 김치 타이밍 정확) · 무기력(안 누름) · 느림(늦게 누름) · 장난(연타 · 남의 번호 · 바로 누르기)
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startMock } from './mockdb.mjs';
import { startStatic } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const HEADED = process.argv.includes('--headed');
const VIEW = { width: 1366, height: 768 };
const OUT = path.join(here, 'playtest13');
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.unlinkSync(path.join(OUT, f));

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
const R = { started: new Date().toISOString(), notes: [], timings: {}, errors: [], yeast: [], kimchi: [], abuse: {}, fonts: {} };
const note = (k, v) => { R.notes.push({ k, v }); console.log(`  · ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`); };
let shotNo = 0;
async function shot(page, name) {
  shotNo++;
  const f = path.join(OUT, `${String(shotNo).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: f }).catch(e => R.errors.push('shot ' + name + ': ' + e.message));
}
// 진행판에서 보이는 글자 중 가장 작은 것들(뒷자리 가독성)
async function smallText(page, label) {
  const r = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('#stage *')) {
      if (!el.childNodes.length) continue;
      const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
      if (!own) continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0 || b.bottom > innerHeight || b.right > innerWidth) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      out.push({ fs, t: own.slice(0, 40), cls: el.className && el.className.baseVal === undefined ? String(el.className).slice(0, 30) : el.tagName });
    }
    out.sort((a, b) => a.fs - b.fs);
    return out.slice(0, 8);
  });
  R.fonts[label] = r;
  return r;
}

const stat = await startStatic({ port: 8113 });
const mock = await startMock({ port: 8817, latency: 60 });
const SITE = `http://127.0.0.1:${stat.port}`;
const Q = `?mock=http://127.0.0.1:${mock.port}`;
const { chromium } = await loadPlaywright();
let browser;
try { browser = await chromium.launch({ channel: 'chrome', headless: !HEADED }); } catch { browser = await chromium.launch({ headless: !HEADED }); }

async function newCtx() {
  const ctx = await browser.newContext({ viewport: VIEW, locale: 'ko-KR' });
  ctx.setDefaultTimeout(60000); ctx.setDefaultNavigationTimeout(90000);
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('bbt')) { sessionStorage.setItem('bbt', '1'); localStorage.clear(); } } catch {} });
  return ctx;
}
function watch(page, who) {
  page.on('pageerror', e => R.errors.push(`${who}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|WebSocket/.test(m.text())) R.errors.push(`${who} console: ${m.text().slice(0, 160)}`); });
  page.on('dialog', d => d.accept().catch(() => {}));
}

const N = 12;
// 페르소나: 번호 → 성격
const PERSONA = { 1: 'comp', 2: 'comp', 3: 'normal', 4: 'lazy', 5: 'normal', 6: 'slow', 7: 'comp', 8: 'normal', 9: 'prank', 10: 'normal', 11: 'slow', 12: 'normal' };

const hostCtx = await newCtx();
const host = await hostCtx.newPage();
watch(host, 'host');
const H = (fn, a) => host.evaluate(fn, a);
const waitH = (fn, a, timeout = 30000) => host.waitForFunction(fn, a, { timeout, polling: 100 });
const S = [];
const T0 = Date.now();

try {
  // ── 방 만들기 ──
  await host.goto(`${SITE}/host.html${Q}`);
  await host.waitForSelector('#bCreate:not([disabled])', { timeout: 20000 });
  await host.click('#segCls .segb[data-v="4"]');
  await host.click('#segSize .segb[data-v="4"]');
  await host.click('#segMode .segb[data-v="pick"]');
  await shot(host, 'host-start');
  await host.click('#bCreate');
  await waitH(() => window.__bbHost.code && window.__bbHost.meta.phase === 'lobby');
  const code = await H(() => window.__bbHost.code);
  await shot(host, 'host-lobby-empty');

  async function student(num) {
    const ctx = await newCtx();
    const page = await ctx.newPage();
    watch(page, 's' + num);
    await page.goto(`${SITE}/${Q}`);
    await page.waitForSelector('#iCode', { timeout: 20000 });
    return { ctx, page, num, who: PERSONA[num] || 'normal' };
  }
  for (let i = 1; i <= N; i++) S.push(await student(i));
  await S[0].page.fill('#iCode', code); await S[0].page.fill('#iNum', '1');
  await shot(S[0].page, 'play-join');
  // 잘못된 입력 체험: 31번
  await S[11].page.fill('#iCode', code); await S[11].page.fill('#iNum', '31'); await S[11].page.click('button[type=submit]');
  await sleep(400); await shot(S[11].page, 'play-join-err31');
  const tJoin = Date.now();
  await Promise.all(S.map(async s => { await s.page.fill('#iCode', code); await s.page.fill('#iNum', String(s.num)); await s.page.click('button[type=submit]'); }));
  await waitH(n => Object.values(window.__bbHost.players).filter(p => p.on).length >= n, N);
  R.timings.join = Date.now() - tJoin;
  await Promise.all(S.map(s => s.page.waitForFunction(() => window.__bbPlay.joined, null, { timeout: 20000 })));
  for (const s of S) s.uid = await s.page.evaluate(() => window.__bbPlay.net.uid);
  await sleep(500);
  await shot(host, 'host-lobby-full'); await shot(S[4].page, 'play-lobby');
  await smallText(host, 'lobby');

  // ── 팀 고르기: 인기 팀 몰림 + 2명은 안 고름 ──
  await host.click('#bTeam');
  const tPick0 = Date.now();
  const poll = setInterval(async () => { const st = await H(() => { const pk = window.__bbHost.core.pick; return pk ? { open: pk.open, left: pk.deadline ? Math.round(pk.deadline - window.__bbHost.net.serverNow()) : null, scr: window.__bbHost.screenKey } : null; }).catch(e => e.message.slice(0, 50)); if (process.env.PT_DEBUG) console.log('   [pick]', ((Date.now() - tPick0) / 1000).toFixed(1), JSON.stringify(st)); }, 400);
  await Promise.all(S.map(s => s.page.waitForSelector('.pk-btn', { timeout: 15000 })));
  await shot(S[0].page, 'play-pick');
  await shot(host, 'host-pick-open');
  await Promise.all(S.map(async s => {
    if (s.who === 'lazy' || s.num === 11) return;               // 안 고름
    await sleep(rnd(100, 1500));
    await s.page.click('.pk-btn[data-t="t1"]').catch(() => {});  // 다들 효모단
  }));
  await sleep(1500);
  note('pick 상태', await H(() => { const pk = window.__bbHost.core.pick; return pk ? { open: pk.open, left: pk.deadline - window.__bbHost.net.serverNow(), got: pk.got && Object.keys(pk.got).length, seats: pk.seats } : null; }));
  clearInterval(poll);
  const loser = [];
  for (const s of S) { const g = await H(u => ((window.__bbHost.core.pick || {}).got || {})[u], s.uid); if (!g && s.who !== 'lazy' && s.num !== 11) loser.push(s); }
  if (loser[0]) await shot(loser[0].page, 'play-pick-full');
  await shot(host, 'host-pick-rush');
  await Promise.all(loser.slice(0, 3).map(s => s.page.click('.pk-btn[data-t="t2"]').catch(() => {})));
  await sleep(1200);
  R.timings.pickElapsed = Date.now() - tPick0;
  if (await H(() => window.__bbHost.core.pick && window.__bbHost.core.pick.open)) await host.click('#bClose');
  else note('팀 고르기', '30초가 이미 끝나 저절로 마감됨');
  await waitH(() => window.__bbHost.core.pick && window.__bbHost.core.pick.open === false);
  await sleep(600);
  await shot(host, 'host-pick-result');
  await shot(S[3].page, 'play-pick-random');
  await host.click('#bOK');
  await waitH(() => window.__bbHost.meta.phase === 'result' && Object.keys(window.__bbHost.roster).length >= 12);
  const roster = await H(() => window.__bbHost.roster);
  for (const s of S) s.team = roster[s.uid].team;
  note('팀', Object.fromEntries(['t1', 't2', 't3'].map(t => [t, S.filter(s => s.team === t).map(s => `${s.num}${s.who[0]}`).join(',')])));
  await sleep(600);
  await shot(host, 'host-hub'); await shot(S[0].page, 'play-hub');
  R.timings.toHub = Date.now() - T0;

  // ── 장난 1: 학생이 DB 직접 쓰기(개발자 도구 흉내) ──
  const prank = S.find(s => s.who === 'prank');
  const victim = S.find(s => s.num === 3);
  R.abuse.writeScore = await prank.page.evaluate(async c => { try { await window.__bbPlay.net.set(`rooms/${c}/teams/t1/score`, 999); return 'OK(뚫림)'; } catch (e) { return '거절: ' + (e.code || e.message); } }, code);
  R.abuse.writeOtherInput = await prank.page.evaluate(async ([c, u]) => { try { await window.__bbPlay.net.set(`rooms/${c}/players/${u}/num`, 9); return 'OK(뚫림)'; } catch (e) { return '거절: ' + (e.code || e.message); } }, [code, victim.uid]);
  note('장난: 팀 점수 직접 쓰기', R.abuse.writeScore);
  note('장난: 남의 자리 쓰기', R.abuse.writeOtherInput);

  // ── 효모 풍선 대결 ──
  const tY = Date.now();
  await host.click('.gcard[data-gid="yeast"]');
  await host.waitForSelector('#bGo');
  await S[0].page.waitForFunction(() => document.body.innerText.includes('준비'), null, { timeout: 10000 });
  await shot(host, 'host-yeast-intro'); await shot(S[0].page, 'play-yeast-intro');
  await smallText(host, 'yeast-intro');
  // 설명 10초 그대로 기다린다(실제 수업처럼)
  await waitH(() => window.__bbHost.g && window.__bbHost.g.step === 'vote', null, 20000);
  R.timings.yeastIntro = Date.now() - tY;
  for (let round = 1; round <= 3; round++) {
    await waitH(r => window.__bbHost.g && window.__bbHost.g.step === 'vote' && window.__bbHost.g.round === r, round, 20000);
    await Promise.all(S.map(s => s.page.waitForSelector('[data-temp]', { timeout: 15000 })));
    const tv = Date.now();
    const choose = s => {
      if (s.who === 'comp') return round === 1 ? [40, 2] : [40, 2];
      if (s.who === 'prank') return [70, 0];
      if (round === 1) return [pick([10, 25, 40, 70]), pick([0, 1, 2])];
      return Math.random() < 0.8 ? [40, 2] : [pick([25, 40]), pick([1, 2])];
    };
    await Promise.all(S.map(async s => {
      if (s.who === 'lazy') return;                                           // 무기력: 안 누름
      if (s.who === 'slow') await sleep(rnd(8000, 14000)); else await sleep(rnd(500, 4000));
      const [t, su] = choose(s);
      if (s.who === 'prank') {                                                // 연타
        for (let i = 0; i < 12; i++) { await s.page.click(`[data-temp="${pick([10, 25, 40, 70])}"]`).catch(() => {}); }
        await s.page.click(`[data-temp="${t}"]`).catch(() => {});
        await s.page.click(`[data-sugar="${su}"]`).catch(() => {});
        return;
      }
      await s.page.click(`[data-temp="${t}"]`).catch(() => {});
      await s.page.click(`[data-sugar="${su}"]`).catch(() => {});
    }));
    if (round === 1) {
      await shot(host, 'host-yeast-vote'); await smallText(host, 'yeast-vote');
      await shot(S.find(s => s.who === 'comp').page, 'play-yeast-vote');
      await shot(S.find(s => s.who === 'lazy').page, 'play-yeast-vote-lazy');
    }
    await waitH(() => window.__bbHost.g.step === 'ferment', null, 45000);
    const voteMs = Date.now() - tv;
    if (round === 1) {
      await sleep(3000); await shot(host, 'host-yeast-ferment-early');
      await sleep(10000); await shot(host, 'host-yeast-ferment-mid'); await smallText(host, 'yeast-ferment');
      await shot(S[0].page, 'play-yeast-ferment');
    }
    await waitH(() => window.__bbHost.g.step === 'reveal', null, 45000);
    await sleep(900);
    const g = await H(() => window.__bbHost.g);
    R.yeast.push({ round, voteMs, early: g.early, run: Object.fromEntries(Object.entries(g.run).map(([t, r]) => [t, `${r.temp}℃/설탕${r.sugar}${r.rand ? '🎲' : ''} → ${r.cm}cm (${g.rank[t]}위 +${g.pts[t]}${g.bonus[t] ? '+보너스' : ''})`])) });
    note(`효모 ${round}R (투표 ${(voteMs / 1000).toFixed(1)}s, 일찍마감 ${g.early})`, R.yeast[round - 1].run);
    if (round === 1 || round === 3) { await shot(host, `host-yeast-reveal-r${round}`); await smallText(host, 'yeast-reveal'); await shot(S[0].page, `play-yeast-reveal-r${round}`); }
    if (round === 1) await shot(S.find(s => s.who === 'lazy').page, 'play-yeast-reveal-lazy');
    // 교사가 되먹임을 말하는 시간
    await sleep(2000);
    await host.click('[data-act="next"]');
  }
  await waitH(() => window.__bbHost.g && window.__bbHost.g.step === 'card');
  await sleep(1000); await shot(host, 'host-yeast-card-anim');
  await sleep(2500); await shot(host, 'host-yeast-card'); await smallText(host, 'yeast-card');
  await shot(S[0].page, 'play-yeast-card');
  await host.click('[data-act="finish"]');
  await waitH(() => window.__bbHost.meta.phase === 'result' && window.__bbHost.core.last && window.__bbHost.core.last.gid === 'yeast');
  R.timings.yeast = Date.now() - tY;
  await sleep(1300);
  await shot(host, 'host-yeast-result'); await shot(S[0].page, 'play-yeast-result');
  R.scoresAfterYeast = await H(() => Object.fromEntries(Object.entries(window.__bbHost.teams).map(([k, t]) => [k, t.score])));
  note('효모 뒤 점수', R.scoresAfterYeast);

  // ── 장난 2: 남의 번호(3번)로 들어가기 — 게임 사이 ──
  const imp = await student(3);
  await imp.page.fill('#iCode', code); await imp.page.fill('#iNum', '3'); await imp.page.click('button[type=submit]');
  await victim.page.waitForFunction(() => window.__bbPlay.kicked, null, { timeout: 15000 }).catch(() => {});
  await sleep(800);
  await shot(victim.page, 'play-impersonated-victim'); await shot(imp.page, 'play-impersonator');
  await shot(host, 'host-after-impersonate');
  R.abuse.impersonateHostNotice = await host.evaluate(() => document.querySelector('#toasts') ? document.querySelector('#toasts').innerText : '');
  note('장난: 3번 사칭 → 진행판 알림', R.abuse.impersonateHostNotice || '(없음)');
  // 피해자가 「다시 들어가기」 → 장난꾼이 다시 … (핑퐁 두 번)
  for (let i = 0; i < 2; i++) {
    await victim.page.click('#bRe').catch(() => {});
    await imp.page.waitForFunction(() => window.__bbPlay.kicked, null, { timeout: 10000 }).catch(() => {});
    await imp.page.click('#bRe').catch(() => {});
    await victim.page.waitForFunction(() => window.__bbPlay.kicked, null, { timeout: 10000 }).catch(() => {});
  }
  await sleep(800);
  R.abuse.pingpong = await host.evaluate(() => document.querySelector('#toasts').innerText);
  await shot(host, 'host-pingpong');
  // 마지막엔 진짜 3번이 이기도록: 장난꾼 창 닫고 피해자 다시
  await imp.ctx.close();
  await victim.page.click('#bRe').catch(() => {});
  await victim.page.waitForFunction(() => window.__bbPlay.joined && !window.__bbPlay.kicked, null, { timeout: 10000 }).catch(() => {});
  victim.uid = await victim.page.evaluate(() => window.__bbPlay.net.uid);
  // 늦게 온 학생 13번
  const late = await student(13);
  await late.page.fill('#iCode', code); await late.page.fill('#iNum', '13'); await late.page.click('button[type=submit]');
  await waitH(u => Object.values(window.__bbHost.roster).some(r => r.num === 13), null, 15000).catch(() => {});
  await sleep(800);
  await shot(host, 'host-late-joiner'); await shot(late.page, 'play-late-joiner');
  late.uid = await late.page.evaluate(() => window.__bbPlay.net.uid);
  S.push(late);

  // ── 김치 숙성 타이밍 ──
  const tK = Date.now();
  await host.click('.gcard[data-gid="kimchi"]');
  await host.waitForSelector('#bGo');
  await sleep(300);
  await shot(host, 'host-kimchi-intro'); await shot(S[0].page, 'play-kimchi-intro');
  await waitH(() => window.__bbHost.g && window.__bbHost.g.step === 'ready', null, 20000);
  R.timings.kimchiIntro = Date.now() - tK;
  const RATE = [3.4, 8.0, 3.4];
  for (let round = 1; round <= 3; round++) {
    await waitH(r => window.__bbHost.g && window.__bbHost.g.round === r && (window.__bbHost.g.step === 'ready' || window.__bbHost.g.step === 'run'), round, 20000);
    const g0 = await H(() => window.__bbHost.g);
    const serverNow = await H(() => window.__bbHost.net.serverNow());
    const startIn = g0.startAt - serverNow;
    const tStart = Date.now() + startIn;
    if (round === 1) { await sleep(600); await shot(host, 'host-kimchi-ready'); await shot(S[0].page, 'play-kimchi-ready'); }
    // 장난: 준비 중 미리 누르기(버튼은 잠겨 있다) → 직접 보내기 흉내
    if (round === 1) R.abuse.prePress = await prank.page.evaluate(() => { const b = document.querySelector('.k-out'); return b ? (b.disabled ? '준비 중 버튼 잠김' : '눌림') : '버튼 없음'; });
    await sleep(Math.max(0, tStart - Date.now()) + 30);
    // 가장 맛있는 때(숙성 60)까지 걸리는 초
    const peakSec = round === 3 ? g0.eventSec + (60 - 3.4 * g0.eventSec) / 12 : 60 / RATE[round - 1];
    const dur100 = round === 3 ? g0.eventSec + (100 - 3.4 * g0.eventSec) / 12 : 100 / RATE[round - 1];
    // 사람 반응 지연: 진행판을 보고 → 누르기 0.25~0.6초 (+ 네트워크 60ms)
    const pressAt = s => {
      if (s.who === 'lazy') return null;
      if (s.who === 'prank') return 0.3;                       // 시작하자마자 꽝
      if (s.who === 'comp') return peakSec - 0.35 + rnd(-0.4, 0.4);
      if (s.who === 'slow') return round === 3 ? Math.min(dur100 - 0.3, peakSec + rnd(1.5, 3)) : peakSec + rnd(1, 3);
      // 보통: 3라운드 정전에 당황해서 늦는다
      return round === 3 ? peakSec + rnd(0.3, 2.0) : peakSec + rnd(-2.5, 2.5);
    };
    const presses = Promise.all(S.map(async s => {
      const at = pressAt(s);
      if (at == null) return;
      await sleep(Math.max(0, tStart + at * 1000 - Date.now()));
      if (s.who === 'prank') { for (let i = 0; i < 6; i++) await s.page.click('.k-out', { timeout: 500 }).catch(() => {}); return; }
      await s.page.click('.k-out:not([disabled])', { timeout: 3000 }).catch(() => {});
    }));
    if (round === 1) { await sleep(peakSec * 1000 * 0.6); await shot(host, 'host-kimchi-run'); await smallText(host, 'kimchi-run'); await shot(S.find(s => s.who === 'comp').page, 'play-kimchi-run'); }
    if (round === 2) { await sleep(peakSec * 1000 * 0.95); await shot(host, 'host-kimchi-run-r2-peak'); }
    if (round === 3) { await sleep(g0.eventSec * 1000 + 400); await shot(host, 'host-kimchi-blackout'); await shot(S.find(s => s.who === 'slow').page, 'play-kimchi-blackout'); }
    await presses;
    await sleep(500);
    await shot(S.find(s => s.who === 'prank').page, `play-kimchi-pressed-r${round}`);
    await waitH(() => window.__bbHost.g.step === 'reveal', null, 45000);
    const gk = await H(() => window.__bbHost.g);
    const per = {};
    for (const s of S) per[`${s.num}${s.who[0]}`] = gk.scores[s.uid];
    R.kimchi.push({ round, peakSec: +peakSec.toFixed(2), avg: gk.avg, rank: gk.rank, per, endedBy: '자동' });
    note(`김치 ${round}R (맛있는 때 ${peakSec.toFixed(1)}s)`, { avg: gk.avg, per });
    await sleep(700);
    if (round !== 2) { await shot(host, `host-kimchi-reveal-r${round}`); await smallText(host, 'kimchi-reveal'); }
    await shot(S.find(s => s.who === 'lazy').page, `play-kimchi-reveal-lazy-r${round}`);
    if (round === 1) await shot(S.find(s => s.who === 'comp').page, 'play-kimchi-reveal-comp');
    await sleep(1500);
    await host.click('[data-act="next"]');
  }
  await waitH(() => window.__bbHost.g && window.__bbHost.g.step === 'fact');
  await sleep(1200); await shot(host, 'host-kimchi-fact'); await shot(S[0].page, 'play-kimchi-fact');
  await host.click('[data-act="finish"]');
  await waitH(() => window.__bbHost.meta.phase === 'result' && window.__bbHost.core.last && window.__bbHost.core.last.gid === 'kimchi');
  R.timings.kimchi = Date.now() - tK;
  await sleep(1300);
  await shot(host, 'host-kimchi-result'); await shot(S[0].page, 'play-kimchi-result');
  R.scoresAfterKimchi = await H(() => Object.fromEntries(Object.entries(window.__bbHost.teams).map(([k, t]) => [k, t.score])));
  note('김치 뒤 점수', R.scoresAfterKimchi);

  // ── 수업 끝 ──
  await host.click('#bEnd');
  await waitH(() => window.__bbHost.meta.phase === 'end');
  await sleep(1500);
  await shot(host, 'host-end');
  // 꼴찌 팀 학생 화면
  const fin = await H(() => window.__bbHost.core.final);
  const lastTeam = Object.entries(fin.rank).sort((a, b) => b[1] - a[1])[0][0];
  const firstTeam = Object.entries(fin.rank).sort((a, b) => a[1] - b[1])[0][0];
  const ls = S.find(s => roster[s.uid] && roster[s.uid].team === lastTeam) || S[0];
  const fs1 = S.find(s => roster[s.uid] && roster[s.uid].team === firstTeam) || S[0];
  await ls.page.waitForFunction(() => document.body.innerText.includes('최종 순위'), null, { timeout: 10000 }).catch(() => {});
  await shot(ls.page, 'play-end-lastteam'); await shot(fs1.page, 'play-end-firstteam');
  R.timings.total = Date.now() - T0;
  await host.click('#bCloseRoom');
  await sleep(1500);
} catch (e) {
  R.errors.push('FATAL ' + e.stack);
  console.error(e);
  await shot(host, 'FATAL-host').catch(() => {});
} finally {
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(R, null, 2));
  console.log('\n시간', R.timings, '\n오류', R.errors.slice(0, 20));
  await browser.close();
  mock.close(); stat.close();
  process.exit(0);
}
