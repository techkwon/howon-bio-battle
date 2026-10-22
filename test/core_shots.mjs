// 코어 화면 확인(스크린샷 1366×768): 게임 7개 차시 묶음 · 팀 8개 효모 화면(1등 표시 · 풍선 크기)
//   node test/core_shots.mjs        → test/shots_core/*.png
// site/games/index.js 는 건드리지 않는다 → 게임 7개 임시 목록으로 test/site_core/ 에 따로 묶는다.
// DB 없이(비상 모드 · 대신 누르기) 돌린다.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { startStatic } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const SITE_DIR = path.join(here, 'site_core');
const SHOT_DIR = path.join(here, 'shots_core');
const VIEW = { width: 1366, height: 768 };
fs.mkdirSync(path.join(SITE_DIR, 'dist'), { recursive: true });
fs.mkdirSync(SHOT_DIR, { recursive: true });
for (const f of fs.readdirSync(SHOT_DIR)) if (f.endsWith('.png')) fs.unlinkSync(path.join(SHOT_DIR, f));
for (const f of ['host.html', 'index.html', 'play.html', 'styles.css']) fs.copyFileSync(path.join(root, 'site', f), path.join(SITE_DIR, f));

// 있는 게임 파일을 모두 모은 임시 목록
const ids = ['yeast', 'kimchi', 'auction', 'sort', 'cart', 'dinner', 'pitch'].filter(id => fs.existsSync(path.join(root, 'site/games', id + '.js')));
const registry = path.join(SITE_DIR, 'registry.js');
fs.writeFileSync(registry, ids.map(id => `import ${id} from ${JSON.stringify(path.join(root, 'site/games', id + '.js').split(path.sep).join('/'))};`).join('\n') + `\nexport default [${ids.join(', ')}];\n`);
await esbuild.build({
  entryPoints: { host: path.join(root, 'site/src/core-host.js') },
  bundle: true, outdir: path.join(SITE_DIR, 'dist'), format: 'iife', target: ['chrome100'], minify: false, logLevel: 'warning',
  plugins: [{ name: 'registry', setup(b) { b.onResolve({ filter: /games[\\/]index\.js$/ }, () => ({ path: registry })); } }],
});

async function loadPlaywright() {
  try { return await import('playwright'); } catch {}
  const cache = path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx');
  for (const d of fs.existsSync(cache) ? fs.readdirSync(cache) : []) {
    const p = path.join(cache, d, 'node_modules', 'playwright', 'index.mjs');
    if (fs.existsSync(p)) { try { return await import(pathToFileURL(p).href); } catch {} }
  }
  throw new Error('playwright 없음');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const stat = await startStatic({ port: 8093, root: SITE_DIR });
const { chromium } = await loadPlaywright();
let browser;
try { browser = await chromium.launch({ channel: 'chrome' }); } catch { browser = await chromium.launch(); }
const errors = [];
let n = 0;
const shot = async (page, name) => { n++; await page.screenshot({ path: path.join(SHOT_DIR, `${String(n).padStart(2, '0')}-${name}.png`) }); };

async function offlineHost(teams) {
  const ctx = await browser.newContext({ viewport: VIEW, locale: 'ko-KR' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? String(teams) : undefined).catch(() => {}));
  await page.goto(`http://127.0.0.1:${stat.port}/host.html?mock=http://127.0.0.1:1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#bOffline', { timeout: 20000 });
  await page.click('#bOffline');
  await page.waitForSelector('.gcard', { timeout: 10000 });
  return { ctx, page };
}

try {
  console.log('게임:', ids.join(', '));
  // ── 게임 고르기: 차시 묶음 ──
  const { ctx, page } = await offlineHost(8);
  const tabs = await page.$$eval('.ltab', a => a.map(x => x.dataset.lesson));
  for (const l of tabs) {
    await page.click(`.ltab[data-lesson="${l}"]`);
    await sleep(1500);
    await shot(page, `hub-lesson${l}`);
    const cut = await page.evaluate(() => {
      const vh = innerHeight;
      const end = document.querySelector('#bEnd').getBoundingClientRect();
      return { cards: [...document.querySelectorAll('.gcard')].filter(c => c.getBoundingClientRect().bottom > end.top - 4).length, endVisible: end.bottom <= vh };
    });
    console.log(`  ${l}차시 탭: 카드 ${await page.$$eval('.gcard', a => a.length)}개 · 잘린 카드 ${cut.cards} · 수업 끝 보임 ${cut.endVisible}`);
  }
  // ── 팀 8개 효모: 1등 표시 · 풍선 크기 ──
  await page.click('.ltab[data-lesson="13"]').catch(() => {});
  await page.click('.gcard[data-gid="yeast"]');
  await page.click('#bGo');
  await page.waitForSelector('.pbtn', { timeout: 10000 });
  const rows = await page.$$('.proxy-row');
  for (let i = 0; i < rows.length; i++) {
    await page.click(`.proxy-row:nth-child(${i + 1}) .pbtn:nth-child(${i % 2 ? 4 : 3})`);        // 40℃ 또는 25℃
    await page.click(`.proxy-row:nth-child(${i + 1}) .pbtn:nth-child(${i % 3 ? 8 : 7})`);        // 설탕 많이 / 조금
  }
  await page.click('[data-act="skip"]', { timeout: 2000 }).catch(() => {});   // 모두 누르면 3초 뒤 저절로 마감
  await page.waitForFunction(() => window.__bbHost.g && window.__bbHost.g.step === 'ferment', null, { timeout: 10000 });
  await sleep(3000);
  await shot(page, 'yeast8-ferment-pred');
  await page.waitForFunction(() => window.__bbHost.g.deadline - Date.now() < 15000, null, { timeout: 30000 });
  await shot(page, 'yeast8-ferment-mid');
  await page.waitForFunction(() => window.__bbHost.g.deadline - Date.now() < 2500, null, { timeout: 30000 });
  await shot(page, 'yeast8-ferment-end');
  const overlap = await page.evaluate(() => {
    const lead = document.querySelector('.y-col.lead');
    if (!lead) return 'no lead';
    const cm = lead.querySelector('.y-cm').getBoundingClientRect();
    const badgeBottom = lead.getBoundingClientRect().top + parseFloat(getComputedStyle(lead).borderTopWidth) - 15 + 24;
    return { cmTop: Math.round(cm.top), badgeBottom: Math.round(badgeBottom) };
  });
  console.log('  1등 표시 · cm 숫자:', JSON.stringify(overlap));
  await page.waitForFunction(() => window.__bbHost.g.step === 'reveal', null, { timeout: 10000 });
  await sleep(2000);
  await shot(page, 'yeast8-reveal');
  await ctx.close();
} catch (e) {
  console.error(e); errors.push(e.message);
} finally {
  await browser.close();
  stat.close();
  console.log(`페이지 오류 ${errors.length}건${errors.length ? ': ' + errors.join(' | ') : ''} · 스크린샷 ${SHOT_DIR}`);
  process.exit(errors.length ? 1 : 0);
}
