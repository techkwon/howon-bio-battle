// 15차시 미니게임 시험: 「장바구니 탐정」(cart) · 「가족 저녁 회의」(dinner)
//   node test/games15.mjs            단위 시험 + 브라우저 시험(가짜 DB · 임시 게임 목록)
//   옵션: --unit (단위 시험만) · --headed · --n 30 · --n6 27
// 실제 Firebase 는 건드리지 않는다. games/index.js 도 고치지 않는다 —
// 임시 목록(yeast · kimchi · cart · dinner)으로 묶은 사이트를 임시 폴더에 만들어 띄운다.
// 결과: 콘솔 요약 + test/shots15/*.png (1366×768) + test/shots15/report.json
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { startMock } from './mockdb.mjs';
import { startStatic } from './serve.mjs';
import { layoutIssues } from './layout15.mjs';

import cart, { pickOrder, speedOf, packHTML, labelRows } from '../site/games/cart.js';
import { TECH, CARDS, PLAY_COUNT } from '../site/games/cart-data.js';
import dinner, { rolePool, assignRoles, rotateRoles, summary, reasonsOf, swayWinners, roundResult } from '../site/games/dinner.js';
import { REASONS, ROLES, ROUNDS, MAX_REASONS, SWAY_MIN } from '../site/games/dinner-data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE_SRC = path.join(here, '../site');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : d; };
const UNIT_ONLY = !!arg('unit', false);
const HEADED = !!arg('headed', false);
const N = Number(arg('n', 30));        // A: 4명 팀 (30명 → 8팀)
const N6 = Number(arg('n6', 27));      // B: 6명 팀 (27명 → 5팀)
const VIEW = { width: 1366, height: 768 };
const SHOT_DIR = path.join(here, 'shots15');
fs.mkdirSync(SHOT_DIR, { recursive: true });
for (const f of fs.readdirSync(SHOT_DIR)) if (f.endsWith('.png')) fs.unlinkSync(path.join(SHOT_DIR, f));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const report = { started: new Date().toISOString(), checks: [], layout: [], errors: [], timings: {} };
let failures = 0;
let T0 = Date.now();
function check(name, cond, detail = '') {
  report.checks.push({ name, ok: !!cond, detail: String(detail) });
  if (!cond) failures++;
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${detail !== '' ? ' — ' + detail : ''}`);
}

// ══════════════════ 1. 단위 시험 (DOM 없이) ══════════════════
function fakeCtx(teams, t0 = 1_000_000) {
  const c = {
    _now: t0, now: () => c._now, rnd: Math.random, offline: false, cls: '3-1', inputs: {},
    teams: teams.map((m, i) => ({ id: 't' + (i + 1), name: '팀' + (i + 1), emoji: '🍞', fill: '#000', tint: '#fff', text: '#000', members: m.slice(), online: m.slice() })),
    numOf: u => (u.startsWith('proxy-') ? 0 : Number(u.replace(/\D/g, '')) || 0),
  };
  return c;
}
const BRANDS = /(풀무원|CJ|씨제이|오뚜기|농심|롯데|빙그레|남양|매일|서울우유|동원|하림|대상|청정원|삼양|해태|오리온|비비고|햇반|종가|코카|펩시|네슬레|다논|야쿠르트|Beyond|Impossible|Upside)/i;

function unitTests() {
  console.log('\n[단위] 장바구니 탐정 데이터 · 규칙');
  check('카드 15장', CARDS.length === 15, CARDS.length);
  check('카드: 보기 4개 · 정답 포함 · 겹침 없음 · 모두 기술 목록 안', CARDS.every(c => c.choices.length === 4 && c.choices.includes(c.answer) && new Set(c.choices).size === 4 && c.choices.every(x => TECH[x])));
  check('카드: 실제 상표 · 회사 이름 없음', CARDS.every(c => !BRANDS.test(JSON.stringify(c))));
  check('유전자변형 표시는 「유전자변형 ○○ 포함(가능성 있음)」 꼴', CARDS.filter(c => c.answer === 'gmo').every(c => labelRows(c).some(([, , v]) => /^유전자변형 \S+ 포함( 가능성 있음)?$/.test(v))));
  // 탐정 카드: 보기 이름이 포장에 그대로 적히면 낱말 맞히기가 된다 → 유전자변형 법정 표시 말고는 금지
  const GIVE = { gmo: ['유전자 변형'], micro: ['발효', '미생물'], enzyme: ['효소'], breed: ['품종', '개량'], farm: ['스마트팜', '스마트 팜'], plant: ['대체육', '식물성 고기'], cell: ['배양'] };
  const shownText = c => [c.name, c.type, c.ing, ...(c.marks || []), ...(c.rows || []).flat()].join(' ');
  const leak = CARDS.filter(c => Object.values(GIVE).flat().some(w => shownText(c).includes(w)));
  check('포장에 보기 이름(발효 · 효소 · 품종 · 스마트팜 · 대체육 · 배양 …)이 없음', leak.length === 0, leak.map(c => c.id).join(','));
  const gmoWord = CARDS.filter(c => /유전자변형/.test(shownText(c)));
  check('기술 이름이 보이는 카드는 유전자변형 법정 표시 2장뿐', gmoWord.length <= 2 && gmoWord.every(c => c.answer === 'gmo'), gmoWord.map(c => c.id).join(','));
  check('카드마다 단서 줄 · 단서 한 줄', CARDS.every(c => labelRows(c).some(r => r[0] === c.clue) && c.clueText));
  check('카드 id 겹침 없음', new Set(CARDS.map(c => c.id)).size === CARDS.length);
  const counts = {}; CARDS.forEach(c => { counts[c.answer] = (counts[c.answer] || 0) + 1; });
  check('정답 기술 7가지 모두 있음', Object.keys(counts).length === Object.keys(TECH).length, JSON.stringify(counts));
  let okOrder = true;
  for (let i = 0; i < 200; i++) {
    const o = pickOrder();
    if (o.length !== PLAY_COUNT || new Set(o).size !== o.length || new Set(o.map(j => CARDS[j].answer)).size !== 7) okOrder = false;
  }
  check(`카드 순서: ${PLAY_COUNT}장 · 겹침 없음 · 7기술 모두 (200번)`, okOrder);
  check('빠르기: 바로 1 · 마감 0.5', speedOf(0, 0, 10000) === 1 && speedOf(10000, 0, 10000) === 0.5 && speedOf(5000, 0, 10000) === 0.75);
  check('포장 그림: 외부 이미지 · url() 없음', CARDS.every(c => !/<img|url\(|https?:/.test(packHTML(c, { clue: true }))));

  // 흐름: 처음 고른 답만 · 보기 밖 · 열리기 전 무시 · 점수 계산
  const ctx = fakeCtx([['u1', 'u2', 'u3', 'u4'], ['u5', 'u6', 'u7']]);
  let s = cart.setup(ctx);
  check('setup: 1번 카드 · 입력 칸 c1 · 비밀(정답) 없음', s.idx === 1 && s.inputKey === 'c1' && s.ans === undefined && !JSON.stringify(s).includes('"answer"'));
  const ans = CARDS[s.ci].answer, wrong = s.choices.find(c => c !== ans);
  ctx._now = s.startAt + 1000;
  let inp = { u1: { c: ans, t: s.startAt + 1000 }, u2: { c: wrong, t: s.startAt + 2000 }, u3: { c: 'zzz', t: s.startAt + 2000 }, u5: { c: ans, t: s.startAt - 1000 } };
  s = cart.onInput(s, inp, ctx);
  inp = { ...inp, u1: { c: wrong, t: s.startAt + 3000 }, u2: { c: ans, t: s.startAt + 3000 } };   // 답 바꾸기 시도
  s = cart.onInput(s, inp, ctx);
  check('처음 고른 답만 센다(바꿔 보내도 그대로)', s.first.u1.c === ans && s.first.u2.c === wrong);
  check('보기 밖 값 · 열리기 전 입력은 무시', !s.first.u3 && !s.first.u5);
  inp = { ...inp, u4: { c: ans, t: s.startAt + 9000 }, u6: { c: ans, t: s.startAt + 5000 }, u7: { c: ans, t: s.deadline + 500 } };
  ctx._now = s.deadline + 1000; ctx.inputs = inp;
  s = cart.tick(cart.onInput(s, inp, ctx), ctx);
  const e1 = Math.round(100 * (speedOf(s.startAt + 1000, s.startAt, s.deadline) + speedOf(s.startAt + 9000, s.startAt, s.deadline)) / 4);
  const e2 = Math.round(100 * speedOf(s.startAt + 5000, s.startAt, s.deadline) / 3);
  check('정답 공개: 팀 점수 = 100 × Σ빠르기 ÷ 팀원 수 · 마감 뒤 입력은 무시', s.step === 'reveal' && s.res.pts.t1 === e1 && s.res.pts.t2 === e2 && s.res.right.t2 === 1, `${JSON.stringify(s.res.pts)} 기대 t1=${e1} t2=${e2}`);
  check('정답 공개 뒤 입력 칸 닫힘', s.inputKey === null);
  // 끝까지
  for (let k = 0; k < 40 && s.step !== 'final'; k++) s = cart.action(s, s.step === 'ask' ? 'stop' : 'next', null, ctx);
  check(`${PLAY_COUNT}장 뒤 최종`, s.step === 'final');
  const sc = cart.scoring(s, ctx);
  check('최종 점수 = 순위 점수 × 3', Object.keys(sc.points).length === 2 && Object.values(sc.points).every(v => [30, 24].includes(v)), JSON.stringify(sc.points));
  // 비상 모드: 대신 누르기 1명
  const octx = fakeCtx([['proxy-t1'], ['proxy-t2']]); octx.offline = true;
  let o = cart.setup(octx);
  const pb = cart.proxyButtons(o, octx.teams[0], octx);
  check('대신 누르기 단추 4개 · 한 번만', pb.length === 4 && pb.every(b => b.once && Object.keys(b.input).length === 1));
  {
    // 접속 중 「대신 누르기」를 켠 팀: 가짜 팀원은 누른 경우에만 한 사람으로 센다(안 누르면 기다리지도, 나누지도 않음)
    const c = fakeCtx([['a', 'b', 'proxy-t1'], ['c', 'd']]);
    let st = cart.setup(c);
    check('접속 중 대신 누르기: 기다릴 사람에 proxy 없음', !st.need.t1.includes('proxy-t1') && st.need.t1.length === 2);
    const a1 = CARDS[st.ci].answer;
    c._now = st.startAt + 1000;
    const inp = { a: { c: a1, t: st.startAt }, b: { c: a1, t: st.startAt }, c: { c: a1, t: st.startAt }, d: { c: a1, t: st.startAt } };
    st = cart.onInput(st, inp, c);
    check('접속 중 대신 누르기: 진짜 팀원이 다 내면 일찍 공개 준비', !!st.endAt);
    c.inputs = inp; st = cart.action(st, 'stop', null, c);
    check('접속 중 대신 누르기: 안 누른 proxy 는 팀원 수에 안 들어감', st.res.size.t1 === 2 && st.res.pts.t1 === 100, JSON.stringify(st.res.size));
  }

  console.log('\n[단위] 가족 저녁 회의');
  check('역할 묶음 크기: 3→4 · 4→4 · 5→5(아빠) · 6→6(삼촌)', rolePool(3).length === 4 && rolePool(4).length === 4 && rolePool(5).includes('dad') && !rolePool(5).includes('uncle') && rolePool(6).includes('uncle'));
  let okRoles = true, detail = '';
  for (const n of [2, 3, 4, 5, 6, 7, 8]) {
    const mem = Array.from({ length: n }, (_, i) => 'u' + n + '_' + i);
    const c = fakeCtx([mem]);
    const st = assignRoles({ roles: {} }, c);
    const rs = mem.map(u => st.roles[u]);
    const pool = rolePool(n);
    const distinct = new Set(rs).size === Math.min(n, ROLES.length);
    if (!rs.every(Boolean) || !distinct || (n <= ROLES.length && !rs.every(r => pool.includes(r)))) { okRoles = false; detail += ` n=${n}:${rs}`; }
    if (n === 6 && new Set(rs).size !== 6) { okRoles = false; detail += ' 6명 팀 역할 6가지 아님'; }
    if (assignRoles(st, c) !== st) { okRoles = false; detail += ' 바뀐 게 없는데 새 객체'; }
    if (n <= ROLES.length) {
      const rot = rotateRoles(st, c);
      const r2 = mem.map(u => rot.roles[u]);
      if (new Set(r2).size !== new Set(rs).size || mem.some(u => rot.roles[u] === st.roles[u])) { okRoles = false; detail += ` 돌리기 n=${n}:${r2}`; }
    }
  }
  check('역할: 팀 안에서 겹치지 않음(7명까지) · 같은 상태면 같은 객체 · 다음 날 모두 한 칸씩 바뀜', okRoles, detail);
  {
    const c = fakeCtx([['a', 'b', 'c']]);
    let st = assignRoles({ roles: {} }, c);
    c.teams[0].members.push('d'); c.teams[0].online.push('d');
    st = assignRoles(st, c);
    check('늦게 온 학생: 남은 역할을 받는다', new Set(['a', 'b', 'c', 'd'].map(u => st.roles[u])).size === 4);
  }
  {
    // 하루 흐름: 첫 마음 → 회의 → 상황 카드 → 다시 투표 → 동률 → 더 회의 → 동률 팀만 다시 투표 → 결과
    const c = fakeCtx([['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h']]);
    let st = dinner.setup(c);
    check('setup: 1일째 메뉴 · 정보 화면 · 입력 닫힘', st.step === 'info' && st.r === 0 && st.inputKey === null);
    st = dinner.action(st, 'v1', null, c);
    check('첫 마음 투표 20초 · 칸 r1a', st.step === 'vote1' && st.inputKey === 'r1a' && st.deadline - c._now === 20000);
    const in1 = { a: { m: 0, t: 1 }, b: { m: 1, t: 2 }, c: { m: 1, t: 3 }, d: { m: 2, t: 4 }, e: { m: 2, t: 5 }, f: { m: 2, t: 6 }, g: { m: 2, t: 7 }, h: { m: 2, t: 8 }, x: { m: 0, t: 9 } };
    st = dinner.onInput(st, in1, c);
    check('첫 마음: 진행 · 팀 밖 입력 무시 · 모두 내면 3초 뒤 마감', st.prog.t1.done === 4 && st.prog.t2.done === 4 && !st.v1.x && st.early === true && st.deadline - c._now === 3000);
    c._now = st.deadline + 500; c.inputs = in1;
    st = dinner.tick(st, c);
    check('첫 마음 마감 → 90초 회의 · 첫 마음 공개', st.step === 'talk' && st.inputKey === null && st.deadline - c._now === 90000 && st.v1.b.m === 1 && st.v1.e.m === 2);
    st = dinner.action(st, 'more', null, c);
    check('회의 ＋30초', st.deadline - c._now === 120000);
    c._now = st.deadline;
    st = dinner.tick(st, c);
    check('회의 끝 → 상황 카드 30초 (카드는 이때 뽑음)', st.step === 'twist' && Number.isInteger(st.tw) && st.tw >= 0 && st.tw < ROUNDS[0].twists.length && st.deadline - c._now === 30000);
    const tw0 = st.tw;
    st = dinner.action(st, 'redraw', null, c);
    check('「다른 카드」', st.tw === (tw0 + 1) % ROUNDS[0].twists.length);
    st = dinner.action(st, 'v2', null, c);
    check('다시 투표 30초 · 칸 r1b', st.step === 'vote2' && st.inputKey === 'r1b' && st.deadline - c._now === 30000);
    // t1: 모두 0 (b · c · d 가 0 쪽으로) / t2: 1 · 1 · 2 · 2 동률 — 먼저 낸 쪽(e)이 있어도 빠르기로 가르지 않는다
    const in2 = { a: { m: 0, rs: 1 | 2 | 4, t: 1 }, b: { m: 0, rs: 2, t: 2 }, c: { m: 0, rs: 8, t: 3 }, d: { m: 0, rs: 16, t: 4 }, e: { m: 1, rs: 2, t: 5 }, f: { m: 1, rs: 2, t: 6 }, g: { m: 2, rs: 4, t: 7 }, h: { m: 2, rs: 0, t: 8 } };
    st = dinner.onInput(st, in2, c);
    check('근거는 한 사람 2개까지 · 근거 없으면 아직 안 낸 것', reasonsOf(st.v2.a.rs).length === MAX_REASONS && st.prog.t2.done === 3, `${st.prog.t2.done}`);
    c._now = st.deadline + 500; c.inputs = in2;
    st = dinner.tick(st, c);
    check('동률 → 「30초 더 회의」 (빠르기로 정하지 않음)', st.step === 'tie' && st.tie.teams.t2 && st.tie.teams.t2.join() === '1,2' && !st.tie.teams.t1 && st.dec.t1.m === 0 && !st.dec.t2 && st.deadline - c._now === 30000, JSON.stringify(st.tie));
    c._now = st.deadline;
    st = dinner.tick(st, c);
    check('동률 팀만 다시 투표 20초 · 칸 r1t1', st.step === 'tiev' && st.inputKey === 'r1t1' && st.deadline - c._now === 20000);
    const in3 = { a: { m: 2, t: 1 }, e: { m: 1, t: 2 }, f: { m: 1, t: 3 }, g: { m: 1, t: 4 }, h: { m: 0, t: 5 } };
    st = dinner.onInput(st, in3, c);
    check('동률 다시 투표: 그 팀만 · 후보 밖 메뉴 무시', !st.tv.a && st.tv.e.m === 1 && !st.tv.h && st.prog.t2 && !st.prog.t1);
    c._now = st.deadline + 500; c.inputs = in3;
    st = dinner.tick(st, c);
    const R = st.res;
    check('동률 다시 투표로 결정 → 결과', st.step === 'show' && st.dec.t2.m === 1 && st.dec.t2.how === 'tie', JSON.stringify(st.dec));
    check('설득: 첫 마음과 다른 사람이 결정 쪽으로 온 수', R.teams.t1.sw === 3 && R.teams.t2.sw === 3, `${R.teams.t1.sw}/${R.teams.t2.sw}`);
    check('설득한 가족 = 처음부터 결정 메뉴(t1 a) · 마음 바꾼 수', R.teams.t1.pers.length === 1 && R.teams.t1.pers[0] === st.roles.a && R.teams.t2.ch === 3 && R.per.a === 'p' && R.per.b === 's' && R.per.h === 'k', JSON.stringify(R.per));
    check('🤝 한마음상: 갈렸다가 모두 같아진 t1 만', R.uniT.join() === 't1');
    check('🗣️ 설득상: 가장 많이 돌린 팀(동점이면 둘 다)', R.sway.slice().sort().join() === 't1,t2');
    // P1-2: 설득상은 2명 이상 돌린 팀만 · 여럿이면 가장 많이 · 그래도 셋 이상이면 돌린 비율
    const w = (...xs) => swayWinners(Object.fromEntries(xs.map((x, i) => ['t' + (i + 1), { sw: x[0], opp: x[1] }]))).join();
    check(`🗣️ 설득상: 한 명만 돌린 팀은 못 받음(SWAY_MIN ${SWAY_MIN})`, SWAY_MIN === 2 && w([1, 2], [1, 1], [0, 0], [1, 3]) === '', w([1, 2], [1, 1], [0, 0], [1, 3]));
    check('🗣️ 설득상: 2명 이상 중 가장 많이 돌린 팀만', w([2, 3], [3, 3], [2, 2], [1, 1]) === 't2' && w([2, 2], [2, 3], [0, 1]) === 't1,t2', `${w([2, 3], [3, 3], [2, 2], [1, 1])} / ${w([2, 2], [2, 3], [0, 1])}`);
    check('🗣️ 설득상: 셋 이상 같으면 돌린 비율로 한두 팀', w([2, 2], [2, 3], [2, 4], [2, 2], [2, 3]) === 't1,t4', w([2, 2], [2, 3], [2, 4], [2, 2], [2, 3]));
    check('🗣️ 설득상: 비율까지 셋 이상 똑같으면 그날은 없음', w([2, 2], [2, 2], [2, 2], [1, 1]) === '' && w([3, 3], [2, 2], [2, 2], [2, 2]) === 't1', `${w([2, 2], [2, 2], [2, 2], [1, 1])} / ${w([3, 3], [2, 2], [2, 2], [2, 2])}`);
    {
      // 한 사람만 마음을 바꾼 하루(장난으로 엉뚱한 첫 마음 → 가족 쪽)는 설득상이 없다
      const one = { ...st, v1: { a: { m: 0 }, b: { m: 0 }, c: { m: 0 }, d: { m: 2 }, e: { m: 1 }, f: { m: 1 }, g: { m: 1 }, h: { m: 0 } },
        fin: { a: 0, b: 0, c: 0, d: 0, e: 1, f: 1, g: 1, h: 1 }, dec: { t1: { m: 0, how: 'vote' }, t2: { m: 1, how: 'vote' } } };
      const R1 = roundResult(one, c);
      check('🗣️ 설득상: 팀마다 한 명씩만 바뀐 날은 아무도 못 받음', R1.teams.t1.sw === 1 && R1.teams.t2.sw === 1 && R1.sway.length === 0, JSON.stringify(R1.sway));
    }
    check('반 전체: 첫 마음 → 다시 투표 · 마음 바꾼 사람', R.cls.c1.join() === '1,2,5' && R.cls.c2.join() === '4,3,1' && R.cls.ch === 6, `${R.cls.c1}→${R.cls.c2} ch=${R.cls.ch}`);
    check('결과 화면에 비밀 없음 · 입력 닫힘', st.inputKey === null && st.tie === null);
    // 다음 날
    const roles1 = { ...st.roles };
    st = dinner.action(st, 'next', null, c);
    check('다음 날: 2일째 · 역할 한 칸씩 · 표 비움', st.step === 'info' && st.r === 1 && Object.keys(st.v1).length === 0 && Object.keys(st.fin).length === 0 && ['a', 'b', 'c', 'd'].every(u => st.roles[u] !== roles1[u]));
    st = dinner.action(st, 'v1', null, c);
    check('2일째 칸 이름 r2a', st.inputKey === 'r2a');
    // 동률이 이어지면 또 회의 · 선생님이 정하기
    c.inputs = {}; c._now = st.deadline + 500; st = dinner.tick(st, c);
    st = dinner.action(dinner.action(st, 'twist', null, c), 'v2', null, c);
    const in4 = { a: { m: 0, rs: 1, t: 1 }, b: { m: 0, rs: 1, t: 2 }, c: { m: 1, rs: 1, t: 3 }, d: { m: 1, rs: 1, t: 4 }, e: { m: 2, rs: 1, t: 5 }, f: { m: 2, rs: 1, t: 6 }, g: { m: 0, rs: 1, t: 7 }, h: { m: 0, rs: 1, t: 8 } };
    c.inputs = in4; c._now = st.deadline + 500; st = dinner.tick(st, c);
    check('첫 마음 없이도 다시 투표로 결정 · 두 팀 동률', st.step === 'tie' && Object.keys(st.tie.teams).length === 2);
    st = dinner.action(st, 'tv', null, c);
    const in5 = { a: { m: 1, t: 1 }, c: { m: 0, t: 2 }, e: { m: 0, t: 3 }, g: { m: 2, t: 4 } };
    c.inputs = in5; c._now = st.deadline + 500; st = dinner.tick(st, c);
    check('그래도 동률이면 또 30초 회의(2번째)', st.step === 'tie' && st.tie.n === 2 && Object.keys(st.tie.teams).length === 2);
    st = dinner.action(st, 'pick', { tid: 't1', m: 2 }, c);
    check('선생님이 정하기: 후보 밖 메뉴는 안 됨', st.step === 'tie' && !st.dec.t1);
    st = dinner.action(st, 'pick', { tid: 't1', m: 1 }, c);
    check('선생님이 한 팀 정하기 → 남은 동률은 그대로', st.step === 'tie' && st.dec.t1.m === 1 && st.dec.t1.how === 'teacher' && !st.tie.teams.t1 && st.tie.teams.t2);
    st = dinner.action(st, 'draw', null, c);
    check('남은 동률 제비뽑기 → 결과', st.step === 'show' && [0, 2].includes(st.dec.t2.m) && st.dec.t2.how === 'draw');
    st = dinner.action(st, 'next', null, c);
    check('3일째', st.r === 2 && st.step === 'info');
    st = dinner.action(st, 'v1', null, c); c.inputs = {}; c._now = st.deadline + 500; st = dinner.tick(st, c);
    st = dinner.action(dinner.action(st, 'twist', null, c), 'v2', null, c);
    c.inputs = { a: { m: 2, rs: 1, t: 1 } }; c._now = st.deadline + 500; st = dinner.tick(st, c);
    check('표가 없는 팀은 「못 정함」(멈추지 않음)', st.step === 'show' && st.dec.t1.m === 2 && st.dec.t2.m === null);
    st = dinner.action(st, 'next', null, c);
    check('3일 뒤 → 사흘 결과', st.step === 'final' && st.hist.length === 3);
    const sum = summary(st, c);
    check('사흘 합계: 날별 결정 · 설득상 수', sum.teams.t1.decs.join() === '0,1,2' && sum.teams.t1.sway === 1 && sum.days === 3, JSON.stringify(sum.teams.t1));
    st = dinner.action(dinner.action(st, 'wrap', null, c), 'finish', null, c);
    check('정리 → 끝', st.done === true);
    const sc = dinner.scoring(st, c);
    check('점수 없음 · 결과 줄(설득왕 · 한마음 · 마음 바꾼 사람 · 정답 없음)', Object.keys(sc.points).length === 0 && sc.lines.some(l => l.includes('🗣️')) && sc.lines.some(l => l.includes('🤝')), sc.lines.map(l => l.replace(/<[^>]+>/g, '')).join(' / '));
  }
  {
    // 2일째에서 「여기까지」
    const c = fakeCtx([['a', 'b'], ['e', 'f']]);
    let st = dinner.action(dinner.setup(c), 'v1', null, c);
    c.inputs = { a: { m: 0, t: 1 } }; c._now = st.deadline + 500; st = dinner.tick(st, c);
    st = dinner.action(dinner.action(st, 'twist', null, c), 'v2', null, c);
    c.inputs = { a: { m: 0, rs: 1, t: 1 }, e: { m: 1, rs: 2, t: 1 } }; c._now = st.deadline + 500; st = dinner.tick(st, c);
    st = dinner.action(st, 'final', null, c);
    check('「여기까지 · 결과」 → 1일만 합계', st.step === 'final' && summary(st, c).days === 1);
  }
  {
    // 비상 모드: 대신 누르기
    const c = fakeCtx([['proxy-t1']]); c.offline = true;
    let st = dinner.action(dinner.setup(c), 'v1', null, c);
    const t = c.teams[0];
    check('대신 누르기: 첫 마음 = 메뉴 3개', dinner.proxyButtons(st, t, c).length === 3);
    st = dinner.onInput(st, { 'proxy-t1': { m: 1, t: c._now } }, c);
    c.inputs = { 'proxy-t1': { m: 1, t: c._now } }; c._now = st.deadline + 500; st = dinner.tick(st, c);
    st = dinner.action(dinner.action(st, 'twist', null, c), 'v2', null, c);
    let px = {};
    const press = b => { px = { ...px, ...b.input, t: c._now }; st = dinner.onInput(st, { 'proxy-t1': px }, c); };
    press(dinner.proxyButtons(st, t, c)[3 + 1]);       // 근거 먼저(가격)
    press(dinner.proxyButtons(st, t, c)[0]);           // 메뉴
    press(dinner.proxyButtons(st, t, c)[3 + 3]);       // 환경
    press(dinner.proxyButtons(st, t, c)[3 + 1]);       // 가격 끄기
    check('대신 누르기: 근거 켜고 끄기 · 메뉴', st.v2['proxy-t1'].m === 0 && st.v2['proxy-t1'].rs === 8, JSON.stringify(st.v2['proxy-t1']));
    check('대신 누르기 단추에 ✓ 표시', dinner.proxyButtons(st, t, c).some(b => b.label.startsWith('✓ ')));
    c.inputs = { 'proxy-t1': px }; c._now = st.deadline + 500; st = dinner.tick(st, c);
    check('비상 모드: 결정 · 대신 누르기는 설득상 없음', st.step === 'show' && st.dec.t1.m === 0 && st.res.sway.length === 0 && st.res.teams.t1.ch === 1);
  }
  {
    // 데이터: 사흘 · 메뉴 3개 · 정보 줄 · 역할 대사 · 상황 카드
    let ok = true, why = '';
    for (const R of ROUNDS) {
      if (R.menus.length !== 3) { ok = false; why += ` ${R.id} 메뉴 수`; }
      for (const m of R.menus) for (const id of R.rows) if (!m.rows[id]) { ok = false; why += ` ${R.id}/${m.id}/${id}`; }
      for (const r of ROLES) if (!R.say[r.id]) { ok = false; why += ` ${R.id} 대사 ${r.id}`; }
      if (R.twists.length < 3) { ok = false; why += ` ${R.id} 카드 수`; }
      for (const tw of R.twists) if (!tw.who.every(id => ROLES.some(r => r.id === id)) || (tw.about && !REASONS.some(r => r.id === tw.about))) { ok = false; why += ` ${R.id} 카드 ${tw.head}`; }
    }
    check(`데이터: ${ROUNDS.length}일 · 메뉴 3개 · 정보 줄 · 역할 7개 대사 · 상황 카드 3장 이상`, ok && ROUNDS.length >= 2, why);
  }
  check('메뉴 정보 · 상황 카드: 건강을 단정하는 말 없음', ROUNDS.every(R => !/(몸에 좋|몸에 나쁘|해롭|안전하다|위험하다|건강에 좋|건강에 나쁘|암을|병을 고)/.test(JSON.stringify(R))));
  check('실제 상표 · 회사 이름 없음(저녁 회의)', ROUNDS.every(R => !BRANDS.test(JSON.stringify(R))));
}

unitTests();
if (UNIT_ONLY) finish();

// ══════════════════ 2. 브라우저 시험 ══════════════════
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

// 임시 사이트: html · css 는 그대로 복사, dist 는 임시 게임 목록으로 새로 묶는다
async function buildTempSite() {
  const root = path.join(os.tmpdir(), 'bb-games15-site');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  for (const f of ['host.html', 'index.html', 'play.html', 'styles.css']) if (fs.existsSync(path.join(SITE_SRC, f))) fs.copyFileSync(path.join(SITE_SRC, f), path.join(root, f));
  const gamesDir = path.join(SITE_SRC, 'games');
  const registry = {
    name: 'registry15',
    setup(b) {
      b.onResolve({ filter: /games[\\/]index\.js$/ }, () => ({ path: 'registry15', namespace: 'reg15' }));
      b.onLoad({ filter: /.*/, namespace: 'reg15' }, () => ({
        contents: `import yeast from './yeast.js'; import kimchi from './kimchi.js'; import cart from './cart.js'; import dinner from './dinner.js';
          export default [yeast, kimchi, cart, dinner];`,
        resolveDir: gamesDir, loader: 'js',
      }));
    },
  };
  await esbuild.build({
    entryPoints: { host: path.join(SITE_SRC, 'src/core-host.js'), play: path.join(SITE_SRC, 'src/core-play.js') },
    bundle: true, outdir: path.join(root, 'dist'), format: 'iife', target: ['chrome100'], minify: false,
    plugins: [registry], logLevel: 'warning',
  });
  return root;
}

let shotNo = 0;
async function shot(page, name) {
  shotNo++;
  const f = path.join(SHOT_DIR, `${String(shotNo).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: f }).catch(e => report.errors.push('shot ' + name + ': ' + e.message));
  await layout(page, name);
}
// 레이아웃 점검: 세로 · 가로 스크롤, 화면 밖 요소, 게임 안에서 잘린(넘친) 칸
async function layout(page, name) {
  const r = await page.evaluate(layoutIssues);
  report.layout.push({ name, issues: r });
  if (r.length) check(`레이아웃: ${name}`, false, r.slice(0, 4).join(' | '));
  return r;
}

function watchErrors(page, who) {
  page.on('pageerror', e => report.errors.push(`${who}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION_REFUSED|favicon/.test(m.text())) report.errors.push(`${who} console: ${m.text().slice(0, 200)}`); });
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? (page.__promptAnswer || '') : undefined).catch(() => {}));
}

function validInput(rec) {
  if (!rec || typeof rec !== 'object' || typeof rec.t !== 'number') return false;
  return Object.entries(rec).every(([k, v]) => k.length <= 20 && (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 200)));
}

const siteRoot = await buildTempSite();
// 다른 개발자의 시험과 부딪히지 않게 빈 포트를 OS 가 고른다
const stat = await startStatic({ port: 0, root: siteRoot });
const mock = await startMock({ port: 0, latency: 40 });
stat.port = stat.server.address().port; mock.port = mock.server.address().port;
const SITE = `http://127.0.0.1:${stat.port}`, base = `?mock=http://127.0.0.1:${mock.port}`;
const dump = async p => (await (await fetch(`http://127.0.0.1:${mock.port}/admin/dump?path=${encodeURIComponent(p)}`)).json()).val;
const { chromium } = await loadPlaywright();
let browser;
try { browser = await chromium.launch({ channel: 'chrome', headless: !HEADED }); } catch { browser = await chromium.launch({ headless: !HEADED }); }
const hostCtx = await browser.newContext({ viewport: VIEW, locale: 'ko-KR' });
const host = await hostCtx.newPage();
watchErrors(host, 'host');
const H = (fn, a) => host.evaluate(fn, a);
const waitH = (fn, a, timeout = 30000) => host.waitForFunction(fn, a, { timeout, polling: 100 });
T0 = Date.now();

async function makeRoom(size, n, cls) {
  await host.goto(`${SITE}/host.html${base}`);
  await host.waitForSelector('#bCreate:not([disabled])', { timeout: 20000 });
  await host.click(`#segCls .segb[data-v="${cls}"]`);
  await host.click(`#segSize .segb[data-v="${size}"]`);
  await host.click('#segMode .segb[data-v="assign"]');
  await host.click('#bCreate');
  await waitH(() => window.__bbHost.code && window.__bbHost.meta.phase === 'lobby');
  const code = await H(() => window.__bbHost.code);
  const S = [];
  for (let b = 0; b < n; b += 10) {
    S.push(...await Promise.all(Array.from({ length: Math.min(10, n - b) }, async (_, i) => {
      const num = b + i + 1;
      const ctx = await browser.newContext({ viewport: VIEW, locale: 'ko-KR' });
      const page = await ctx.newPage();
      watchErrors(page, `s${num}`);
      await page.goto(`${SITE}/${base}`);
      await page.waitForSelector('#iCode', { timeout: 20000 });
      await page.fill('#iCode', code); await page.fill('#iNum', String(num)); await page.click('button[type=submit]');
      return { ctx, page, num };
    })));
  }
  await waitH(k => Object.values(window.__bbHost.players).filter(p => p.on).length >= k, n, 40000);
  const uids = await Promise.all(S.map(s => s.page.evaluate(() => window.__bbPlay.net.uid)));
  S.forEach((s, i) => { s.uid = uids[i]; });
  await host.click('#bTeam');
  await host.waitForSelector('#bShuf', { timeout: 10000 });
  await host.click('#bShuf');
  await host.click('#bOK');
  await waitH(k => window.__bbHost.meta.phase === 'result' && Object.keys(window.__bbHost.roster).length >= k, n);
  await Promise.all(S.map(s => s.page.waitForSelector('.team-card', { timeout: 15000 })));
  return { code, S };
}
async function teamsOf() {
  return H(() => {
    const r = window.__bbHost.roster, out = {};
    for (const [u, x] of Object.entries(r)) (out[x.team] = out[x.team] || []).push(u);
    return out;
  });
}
async function startPlugin(gid, S, shotName) {
  await host.click(`.gcard[data-gid="${gid}"]`);
  await host.waitForSelector('#bGo');
  await S[0].page.waitForFunction(() => document.body.innerText.includes('준비'), null, { timeout: 30000 });
  if (shotName) { await sleep(300); await shot(host, `host-${shotName}-intro`); await shot(S[0].page, `play-${shotName}-intro`); }
  await host.click('#bGo');
}
const scores = () => H(() => Object.fromEntries(Object.entries(window.__bbHost.teams).map(([k, t]) => [k, t.score])));

// ── 장바구니 탐정 (A) ──
async function runCart(S, code) {
  console.log('\n[A-1] 장바구니 탐정');
  const t0 = Date.now();
  const before = await scores();
  await startPlugin('cart', S, 'cart');
  const total = await waitH(() => window.__bbHost.g && window.__bbHost.g.order).then(() => H(() => window.__bbHost.g.order.length));
  let okScore = true, okFirst = true, scoreDetail = '', lateAll = 0, missEarly = 0;
  let missed = 0;
  for (let k = 1; k <= total; k++) {
    // CPU 가 바쁘면 시험이 늦어 진행판이 정답 공개 7초 뒤 저절로 다음 카드로 넘어가 버릴 수 있다 → 놓친 카드는 건너뛴다
    await waitH(i => { const g = window.__bbHost.g; return g && ((g.step === 'ask' && g.idx === i) || g.idx > i || g.step === 'final'); }, k, 60000);
    const cur = await H(() => [window.__bbHost.g.step, window.__bbHost.g.idx]);
    if (cur[0] === 'final') { missed += total - k + 1; break; }
    if (cur[0] !== 'ask' || cur[1] !== k) { missed++; k = cur[0] === 'ask' ? cur[1] - 1 : cur[1]; continue; }
    const g = await H(() => window.__bbHost.g);
    const ans = CARDS[g.ci].answer;
    const chosen = {};
    const skip = k === 1 ? S.length - 1 : -1;                // 1번 카드: 한 명은 안 고른다 → 10초 다 쓴다
    if (k === 1) {
      await sleep(400); await shot(host, 'host-cart-ready');
      await S[skip].page.waitForSelector('.cq-btn:not([disabled])', { timeout: 8000 });
    }
    // 학생 누르기: 보기가 열리면 잠깐 읽고 누른다. Playwright 의 「안정될 때까지 기다리기」 대신 화면에 보이는 단추를
    // 그 자리에서 누른다(학생처럼) — CPU 가 바쁜 PC 에서 30개 창을 띄워도 10초 안에 누를 수 있게.
    // 마감 뒤에 누른 것(CPU 가 밀려서)은 진행판이 버리는 게 맞으므로 따로 센다(late).
    const presses = Promise.all(S.map(async (s, i) => {
      if (i === skip) return;
      await s.page.waitForSelector('.cq-btn:not([disabled])', { timeout: 20000 }).catch(() => {});
      await sleep(rnd(100, k === 1 ? 6000 : 3500));
      const c = Math.random() < 0.7 ? ans : pick(g.choices.filter(x => x !== ans));
      const r = await s.page.evaluate(c => {
        const b = document.querySelector(`.cq-btn[data-c="${c}"]:not([disabled])`);
        if (!b) return { ok: false, scr: document.querySelector('#main').innerText.replace(/\s+/g, ' ').slice(0, 90) };
        b.click();
        return { ok: true, at: window.__bbPlay.net.serverNow() };
      }, c).catch(e => ({ ok: false, scr: e.message.slice(0, 90) }));
      if (r.ok) chosen[s.uid] = { c, at: r.at };
      else report.errors.push(`cart click s${s.num} 카드 ${k}: 단추 없음 :: ${r.scr}`);
    }));
    if (k === 1) {
      await sleep(2200);
      await shot(host, 'host-cart-ask'); await shot(S[skip].page, 'play-cart-ask');
      await presses;
      await sleep(300);
      await shot(S[0].page, 'play-cart-picked');
    } else await presses;
    if (k === 3) {
      const inp = await dump(`rooms/${code}/inputs`);
      const recs = Object.values(inp || {}).flatMap(r => Object.values(r || {}));
      check('장바구니: DB 입력 모양(키 ≤20자 · t · 값 형식)', recs.length > 0 && recs.every(validInput), `${recs.length}개 · 예: ${JSON.stringify(recs[0])}`);
      check('장바구니: 입력에 c 하나뿐 (+t)', recs.every(r => Object.keys(r).sort().join() === 'c,t'));
    }
    const tAsk = Date.now();
    // 정답 공개 순간의 상태를 그 자리에서 떠 온다(바쁜 PC 에서 읽는 사이 다음 카드로 넘어가도 이 카드 값으로 본다)
    const gr = await (await waitH(i => { const g = window.__bbHost.g; return g && g.step === 'reveal' && g.idx === i && JSON.parse(JSON.stringify(g)); }, k, 20000)).jsonValue();
    // 마감(+ 진행판이 기다리는 0.4초) 안에 누른 것만 세어야 맞다. 그 뒤에 누른 것은 늦음(CPU 가 바빠서) — 버려져야 한다
    const onTime = Object.values(chosen).filter(x => x.at <= gr.deadline).length;
    const late = Object.keys(chosen).length - onTime;
    lateAll += late;
    if (k === 2) check('장바구니: 모두 고르면 일찍 공개', (Date.now() - tAsk < 4000 && gr.res.n === S.length) || late > 0, `${gr.res.n}명${late ? ` · 늦게 누름 ${late}명(CPU) → 일찍 공개 확인 못 함` : ''}`);
    if (k === 1) check('장바구니: 안 고른 사람이 있으면 10초 다 씀 · 늦은 입력은 안 셈', gr.res.n <= S.length - 1 && gr.res.n >= onTime - 1 && gr.res.n <= onTime + 1, `${gr.res.n}명 고름 · 마감 전 누름 ${onTime} · 늦음 ${late}`);
    // 처음 고른 답 = 누른 답, 팀 점수 다시 계산
    for (const [u, x] of Object.entries(chosen)) {
      if (gr.first[u] && gr.first[u].c !== x.c) okFirst = false;                 // 센 답은 누른 답이어야
      if (!gr.first[u] && x.at < gr.deadline - 1000) missEarly++;              // 일찍 눌렀는데 안 셈 = 도착이 마감 뒤(서버 시각 t 는 도착 시각)
    }
    for (const [tid, uids] of Object.entries(gr.need)) {
      const sum = uids.reduce((a, u) => a + (gr.first[u] && gr.first[u].c === ans ? speedOf(gr.first[u].t, gr.startAt, gr.deadline) : 0), 0);
      const e = uids.length ? Math.round(100 * sum / uids.length) : 0;
      if (e !== gr.res.pts[tid]) { okScore = false; scoreDetail += ` ${k}:${tid} ${gr.res.pts[tid]}≠${e}`; }
    }
    if (k === 1) {
      await sleep(900);
      await shot(host, 'host-cart-reveal'); await shot(S[0].page, 'play-cart-reveal'); await shot(S[skip].page, 'play-cart-timeout');
      // 저절로 다음 카드
      const t1 = Date.now();
      await waitH(() => window.__bbHost.g.step === 'ask' && window.__bbHost.g.idx === 2, null, 12000);
      check('장바구니: 정답 공개 뒤 저절로 다음 카드', true, `${((Date.now() - t1) / 1000).toFixed(1)}초`);
      continue;
    }
    if (k === 2) {
      await host.click('[data-act="pause"]');
      await sleep(8500);
      const p = await H(() => [window.__bbHost.g.step, window.__bbHost.g.paused]);
      check('장바구니: 「멈춤」이면 기다린다', p[0] === 'reveal' && p[1] === true);
      await shot(host, 'host-cart-paused');
    } else await sleep(500);
    await host.click('[data-act="next"]');
  }
  if (missed) report.errors.push(`장바구니: 시험이 늦어 놓친 카드 ${missed}장(진행판은 저절로 넘어감 — 시험 PC CPU)`);
  check('장바구니: 처음 고른 답 = 학생이 누른 답', okFirst, (lateAll || missEarly) ? `마감 뒤 누름 ${lateAll}건 · 일찍 눌렀으나 마감 뒤 도착 ${missEarly}건(시험 PC 가 바빠서) — 진행판이 버림` : '');
  check('장바구니: 일찍 누른 입력이 빠진 것은 3건 이하(CPU 지연 허용)', missEarly <= 3, `${missEarly}건`);
  check('장바구니: 카드마다 팀 점수 = 100 × Σ빠르기 ÷ 팀원 수', okScore, scoreDetail);
  await waitH(() => window.__bbHost.g && window.__bbHost.g.step === 'final');
  await sleep(1200);
  await shot(host, 'host-cart-final'); await shot(S[0].page, 'play-cart-final');
  const gf = await H(() => window.__bbHost.g);
  await host.click('[data-act="finish"]');
  await waitH(() => window.__bbHost.meta.phase === 'result' && window.__bbHost.core.last && window.__bbHost.core.last.gid === 'cart');
  const after = await scores();
  check('장바구니: 팀 점수 += 순위 점수 × 3', Object.keys(after).every(t => after[t] - before[t] === (gf.rpts[t] || 0)), JSON.stringify(gf.rpts));
  const lines = await H(() => window.__bbHost.core.last.lines);
  check('장바구니: 결과 줄(최고 탐정 · 헷갈린 카드 · 표시)', lines.length === 3, lines.map(l => l.replace(/<[^>]+>/g, '')).join(' / '));
  report.timings.cart = Date.now() - t0;
  await sleep(1200);
  await shot(host, 'host-cart-hub');
}

// ── 가족 저녁 회의 ──
// days = 몇 일 할지(나머지는 「여기까지」). plan(day) = 'random' | 'tie' | 'uni'
//   tie: 4명 팀은 다시 투표에서 2:2 로 갈라 「동률 → 30초 더 회의 → 동률 팀만 다시 투표」를 거친다
//   uni: 첫 마음은 갈리고(번호 차례로 0 · 1 · 2) 다시 투표에서 모두 0 → 🤝 한마음 · 🗣️ 설득상 확인
// 누른 뒤 원하는 모습이 안 되면(입력 칸이 막 열리는 중 · PC 가 바쁨) 학생처럼 한 번 더 누른다
async function pressTill(p, sel, want, who) {
  for (let tr = 0; tr < 6; tr++) {
    if (await p.$(want)) return;
    const b = await p.$(sel);
    if (b) await b.click({ timeout: 5000 }).catch(() => {});
    if (await p.waitForSelector(want, { timeout: 3000 }).then(() => true, () => false)) return;
  }
  throw new Error(`${who}: ${want} 이(가) 안 됨`);
}

async function runDinner(S, code, tag, days = 1, plans = ['random']) {
  console.log(`\n[${tag}] 가족 저녁 회의 (${days}일)`);
  const t0 = Date.now();
  const before = await scores();
  const SHOTS = tag === 'A-2';
  await startPlugin('dinner', S, SHOTS ? 'dinner' : '');
  await waitH(() => window.__bbHost.g && window.__bbHost.g.step === 'info');
  await sleep(500);
  const teams = await teamsOf();
  const teamOf = {};
  for (const [tid, uids] of Object.entries(teams)) for (const u of uids) teamOf[u] = tid;
  let roles = await H(() => window.__bbHost.g.roles);
  let okR = true, rd = '';
  for (const [tid, uids] of Object.entries(teams)) {
    const rs = uids.map(u => roles[u]);
    const pool = rolePool(uids.length);
    if (!rs.every(Boolean) || new Set(rs).size !== rs.length || !rs.every(r => pool.includes(r))) { okR = false; rd += ` ${tid}:${rs}`; }
  }
  const sizes = Object.values(teams).map(u => u.length);
  check(`${tag} 역할: 모두 받음 · 팀 안 겹침 없음 · 팀 크기에 맞는 묶음`, okR, `팀 크기 ${sizes.join('·')}${rd}`);
  const six = Object.values(teams).filter(u => u.length === 6);
  if (six.length) check(`${tag} 6명 팀: 할머니 · 엄마 · 동생 · 나 · 아빠 · 삼촌`, six.every(u => new Set(u.map(x => roles[x])).size === 6 && u.some(x => roles[x] === 'dad') && u.some(x => roles[x] === 'uncle')));
  await Promise.all(S.map(s => s.page.waitForSelector('.dr-card', { timeout: 30000 })));
  const shown = await Promise.all(S.slice(0, 6).map(s => s.page.evaluate(() => document.querySelector('.dr-n').textContent)));
  const expect = S.slice(0, 6).map(s => ROLES.find(r => r.id === roles[s.uid]).name);
  check(`${tag} 조종기 역할 카드 = 진행판이 준 역할`, shown.join() === expect.join(), shown.join(' · '));
  if (SHOTS || tag === 'B') { await sleep(600); await shot(host, `host-dinner-info-${tag}`); await shot(S[0].page, `play-dinner-role-${tag}`); }
  if (SHOTS) {
    const l1 = await S[0].page.textContent('.dr-line');
    await S[0].page.click('.dr-next');
    const l2 = await S[0].page.textContent('.dr-line');
    check('역할 대사 「다른 대사」 · 그날 대사가 먼저', l1 && l2 && l1 !== l2 && l1 === ROUNDS[0].say[roles[S[0].uid]], `${l1} → ${l2}`);
  }
  const allInputs = [];
  let changedAll = 0;
  for (let day = 0; day < days; day++) {
    const plan = plans[day] || 'random';
    const D = `${tag} ${day + 1}일째`;
    if (day > 0) {
      await host.click('[data-act="next"]');
      await waitH(r => window.__bbHost.g.step === 'info' && window.__bbHost.g.r === r, day);
      const r2 = await H(() => window.__bbHost.g.roles);
      check(`${D}: 역할이 한 칸씩 바뀜 · 팀 안 겹침 없음`, S.every(s => r2[s.uid] && r2[s.uid] !== roles[s.uid]) && Object.values(teams).every(u => new Set(u.map(x => r2[x])).size === u.length));
      roles = r2;
      await Promise.all(S.map(s => s.page.waitForFunction(n => (document.querySelector('.dr-n') || {}).textContent === n, ROLES.find(r => r.id === roles[s.uid]).name, { timeout: 20000 })));
      if (SHOTS) { await sleep(500); await shot(host, `host-dinner-info-d${day + 1}`); await shot(S[1].page, `play-dinner-role-d${day + 1}`); }
    }
    // ① 첫 마음 (혼자, 역할대로)
    await host.click('[data-act="v1"]');
    await waitH(() => window.__bbHost.g.step === 'vote1');
    const first = {};
    const idxInTeam = u => teams[teamOf[u]].indexOf(u);
    const v1 = Promise.all(S.map(async (s, i) => {
      await s.page.waitForSelector('.dv.first .dv-m', { timeout: 30000 });
      await sleep(rnd(150, 2000));
      const m = plan === 'uni' ? idxInTeam(s.uid) % 3 : plan === 'tie' ? 0 : Math.floor(Math.random() * 3);
      await pressTill(s.page, `.dv.first .dv-m[data-m="${m}"]`, `.dv.first .dv-m.on[data-m="${m}"]`, `s${s.num} 첫 마음`);
      first[s.uid] = m;
    }));
    if (SHOTS && day === 0) { await sleep(1300); await shot(host, 'host-dinner-vote1'); }
    await v1;
    if (SHOTS && day === 0) { await sleep(300); await shot(S[0].page, 'play-dinner-vote1'); }
    await waitH(() => window.__bbHost.g.step === 'talk', null, 20000);
    let g = await H(() => window.__bbHost.g);
    check(`${D}: 첫 마음 모두 받음 · 일찍 마감 · 90초 회의`, S.every(s => g.v1[s.uid] && g.v1[s.uid].m === first[s.uid]) && g.early === true && Math.abs(g.deadline - (await H(() => window.__bbHost.net.serverNow())) - 90000) < 2500);
    // 회의 화면: 우리 가족 첫 마음이 조종기에 보인다
    await S[0].page.waitForSelector('.dt-f', { timeout: 15000 });
    const famN = await S[0].page.$$eval('.dt-f', a => a.length);
    check(`${D}: 조종기 「우리 가족 첫 마음」 = 팀원 수`, famN === teams[teamOf[S[0].uid]].length, `${famN}`);
    if (SHOTS && day === 0) {
      await sleep(900); await shot(host, 'host-dinner-talk'); await shot(S[0].page, 'play-dinner-talk');
      const d0 = g.deadline;
      await host.click('[data-act="more"]');
      check('회의 「＋30초」', (await H(() => window.__bbHost.g.deadline)) - d0 === 30000);
    }
    // ② 상황 카드
    await host.click('[data-act="twist"]');
    await waitH(() => window.__bbHost.g.step === 'twist');
    g = await H(() => window.__bbHost.g);
    check(`${D}: 상황 카드 공개 (조종기도 같은 카드)`, Number.isInteger(g.tw) && await S[1].page.waitForFunction(h => document.body.innerText.includes(h), ROUNDS[day].twists[g.tw].head, { timeout: 15000 }).then(() => true, () => false), ROUNDS[day].twists[g.tw].head);
    if (SHOTS && day === 0) {
      await sleep(900); await shot(host, 'host-dinner-twist');
      const who = ROUNDS[0].twists[g.tw].who;
      const sMe = S.find(s => who.includes(roles[s.uid])) || S[0];
      await shot(sMe.page, 'play-dinner-twist');
      await host.click('[data-act="redraw"]');
      check('「다른 카드」', (await H(() => window.__bbHost.g.tw)) === (g.tw + 1) % ROUNDS[0].twists.length);
    }
    // ③ 다시 투표 (메뉴 + 근거). S[1] 은 근거 3개 시도, S[2] 는 메뉴 바꾸기
    await host.click('[data-act="v2"]');
    await waitH(() => window.__bbHost.g.step === 'vote2');
    const fin = {};
    const last = S.length - 1;
    const votes = Promise.all(S.map(async (s, i) => {
      const p = s.page;
      await p.waitForSelector('.dv.again .dv-m', { timeout: 30000 });
      await sleep(i === last ? 3500 : rnd(200, 2200));
      const k = idxInTeam(s.uid);
      let m = plan === 'uni' ? 0 : plan === 'tie' ? (teams[teamOf[s.uid]].length === 4 ? k % 2 : 0) : Math.floor(Math.random() * 3);
      // 학생처럼: 눌렀는데 다음 화면이 안 뜨면(입력 칸이 막 열리는 중 · PC 가 바쁨) 한 번 더 누른다
      const pressUntil = async (sel, want) => {
        for (let tr = 0; tr < 6; tr++) {
          if (await p.$(want)) return;
          const b = await p.$(sel);
          if (b) await b.click({ timeout: 5000 }).catch(() => {});
          if (await p.waitForSelector(want, { timeout: 3000 }).then(() => true, () => false)) return;
        }
        throw new Error(`s${s.num} 다시 투표: ${want} 화면이 안 뜸`);
      };
      if (i === 2 && plan === 'random') {
        await pressUntil(`.dv.again .dv-m[data-m="${(m + 1) % 3}"]`, '.dv-change');
        await p.click('.dv-change');
        await p.waitForSelector('.dv-m.on', { timeout: 5000 });
      }
      // 학생처럼: 눌렀는데 근거 화면이 안 뜨면(입력 칸이 막 열리는 중) 한 번 더 누른다
      await pressUntil(`.dv.again .dv-m[data-m="${m}"]`, '.dv-r');
      const kk = i === 1 ? 3 : 1 + Math.floor(Math.random() * 2);
      const rs = REASONS.slice().sort(() => Math.random() - 0.5).slice(0, kk);
      let mask = 0;
      for (const r of rs) {
        await p.click(`.dv-r[data-r="${r.bit}"]`);
        if (reasonsOf(mask).length < MAX_REASONS) mask |= r.bit;
        await p.waitForFunction(b => !!document.querySelector(`.dv-r[data-r="${b}"]`), r.bit, { timeout: 3000 }).catch(() => {});
        await sleep(150);
      }
      fin[s.uid] = m;
      if (i === 1 && SHOTS && day === 0) {
        const w = await p.evaluate(() => { const x = document.querySelector('.dv-warn'); return x ? x.textContent : ''; });
        check('근거 3개째: 「2개까지」 안내 · 2개만 켜짐', /2개까지/.test(w) && (await p.$$('.dv-r.on')).length === 2, w);
        await shot(p, 'play-dinner-why-max');
      }
      if (i === 0 && SHOTS && day === 0) await shot(p, 'play-dinner-why');
    }));
    if (SHOTS && day === 0) { await sleep(1200); await shot(S[last].page, 'play-dinner-menu2'); await shot(host, 'host-dinner-vote2'); }
    await votes;
    await waitH(() => ['show', 'tie'].includes(window.__bbHost.g.step), null, 20000);
    g = await H(() => window.__bbHost.g);
    check(`${D}: 다시 투표 모두 받음 · 일찍 마감`, g.early === true && S.every(s => g.v2[s.uid] && g.v2[s.uid].m === fin[s.uid]));
    // 동률 확인: 다시 투표 표로 다시 센다 — 동률 팀은 결정이 없어야 한다(빠르기로 가르지 않음)
    let okT = true, td = '';
    const tiedExp = {};
    for (const [tid, uids] of Object.entries(teams)) {
      const c = [0, 0, 0];
      for (const u of uids) c[fin[u]]++;
      const top = Math.max(...c), opts = c.map((x, i) => (x === top ? i : -1)).filter(i => i >= 0);
      if (opts.length > 1) { tiedExp[tid] = opts; if (g.dec[tid] || !g.tie || (g.tie.teams[tid] || []).join() !== opts.join()) { okT = false; td += ` ${tid} 동률 ${opts}`; } }
      else if (!g.dec[tid] || g.dec[tid].m !== opts[0]) { okT = false; td += ` ${tid} 결정 ${g.dec[tid] && g.dec[tid].m}≠${opts[0]}`; }
    }
    check(`${D}: 팀 결정 = 다수결 · 동률은 「더 회의」(빠르기 아님)`, okT && (Object.keys(tiedExp).length ? g.step === 'tie' : g.step === 'show'), `${td} 동률 ${Object.keys(tiedExp).length}팀`);
    if (plan === 'tie') check(`${D}: 4명 팀이 2:2 → 동률 단계`, g.step === 'tie' && Object.keys(tiedExp).length > 0);
    // ④ 동률: 30초 더 회의 → 동률 팀만 다시 투표 (모두 첫 후보로) — 4명 팀 한 곳은 교사가 정한다
    let pickedTid = null;
    if (g.step === 'tie') {
      const tiedS = S.filter(s => tiedExp[teamOf[s.uid]]);
      const freeS = S.find(s => !tiedExp[teamOf[s.uid]]);
      await tiedS[0].page.waitForFunction(() => document.body.innerText.includes('동률'), null, { timeout: 15000 });
      if (SHOTS || plan === 'tie') { await sleep(700); await shot(host, `host-dinner-tie-${tag}`); await shot(tiedS[0].page, `play-dinner-tie-${tag}`); if (freeS) await shot(freeS.page, `play-dinner-tie-wait-${tag}`); }
      // 교사가 한 팀 정하기(메뉴 누르기)
      if (Object.keys(tiedExp).length > 1) {
        pickedTid = Object.keys(tiedExp)[0];
        await host.click(`.d-pk[data-tid="${pickedTid}"][data-pick="${tiedExp[pickedTid][1]}"]`);
        await waitH(t => window.__bbHost.g.dec[t] && window.__bbHost.g.dec[t].how === 'teacher', pickedTid, 10000);
      }
      await host.click('[data-act="tv"]');
      await waitH(() => window.__bbHost.g.step === 'tiev');
      const tvS = tiedS.filter(s => teamOf[s.uid] !== pickedTid);
      await Promise.all(tvS.map(async s => {
        const m = tiedExp[teamOf[s.uid]][0];
        await s.page.waitForSelector(`.dv.tiev .dv-m[data-m="${m}"]`, { timeout: 20000 });
        await sleep(rnd(100, 1200));
        await pressTill(s.page, `.dv.tiev .dv-m[data-m="${m}"]`, `.dv.tiev .dv-m.on[data-m="${m}"]`, `s${s.num} 동률 투표`);
        fin[s.uid] = m;
      }));
      if (SHOTS || plan === 'tie') { await sleep(500); await shot(host, `host-dinner-tiev-${tag}`); await shot(tvS[0].page, `play-dinner-tiev-${tag}`); }
      await waitH(() => window.__bbHost.g.step === 'show', null, 25000);
      g = await H(() => window.__bbHost.g);
      check(`${D}: 동률 팀 다시 투표로 결정 · 교사가 정한 팀은 그대로`, Object.keys(tiedExp).every(tid => g.dec[tid] && (tid === pickedTid ? g.dec[tid].how === 'teacher' && g.dec[tid].m === tiedExp[tid][1] : g.dec[tid].how === 'tie' && g.dec[tid].m === tiedExp[tid][0])), JSON.stringify(g.dec));
      if (pickedTid) for (const u of teams[pickedTid]) fin[u] = g.fin[u];
    }
    // ⑤ 결과: 설득 · 한마음 · 반 전체를 학생이 누른 값으로 다시 계산
    const res = g.res;
    let okS = true, sd = '';
    const swE = {}, uniE = {};
    for (const [tid, uids] of Object.entries(teams)) {
      const d = g.dec[tid].m;
      swE[tid] = uids.filter(u => first[u] !== d && fin[u] === d).length;
      const firsts = uids.map(u => first[u]);
      uniE[tid] = uids.length >= 2 && uids.every(u => fin[u] === d) && new Set(firsts).size > 1;
      if (res.teams[tid].sw !== swE[tid]) { okS = false; sd += ` ${tid} 설득 ${res.teams[tid].sw}≠${swE[tid]}`; }
      if (res.teams[tid].uni !== uniE[tid]) { okS = false; sd += ` ${tid} 한마음 ${res.teams[tid].uni}≠${uniE[tid]}`; }
    }
    const oppE = Object.fromEntries(Object.entries(teams).map(([tid, uids]) => [tid, uids.filter(u => first[u] !== g.dec[tid].m).length]));
    const swayE = swayWinners(Object.fromEntries(Object.keys(swE).map(t => [t, { sw: swE[t], opp: oppE[t] }]))).sort().join();
    const best = Math.max(...Object.values(swE));
    check(`${D}: 설득 수 · 한마음 = 학생이 누른 값`, okS, sd);
    check(`${D}: 🗣️ 설득상 = ${SWAY_MIN}명 이상 · 가장 많이 돌린 팀`, res.sway.slice().sort().join() === swayE, `${swayE || '없음'} (${best}명)`);
    if (plan === 'uni') check(`${D}: 갈렸다가 모두 같아진 팀 = 🤝 한마음`, Object.keys(teams).every(t => res.uniT.includes(t)));
    check(`${D}: 🗣️ 설득상은 하루 두 가족 이하`, res.sway.length <= 2, `${res.sway.length}팀`);
    const ch = S.filter(s => first[s.uid] !== fin[s.uid]).length;
    changedAll += ch;
    check(`${D}: 반 전체 첫 마음 → 다시 투표 · 마음 바꾼 사람`, res.cls.n1 === S.length && res.cls.n2 === S.length && res.cls.ch === ch, `${res.cls.c1}→${res.cls.c2} 바꿈 ${res.cls.ch}`);
    const inp = await dump(`rooms/${code}/inputs`);
    const recs = Object.values(inp || {}).flatMap(r => Object.values(r || {}));
    allInputs.push(...recs);
    check(`${D}: DB 입력 모양(키 ≤20자 · t · 값 형식 · m · rs 만)`, recs.length >= S.length && recs.every(validInput) && recs.every(r => Object.keys(r).every(k => ['m', 'rs', 't'].includes(k))), `${recs.length}개 · 칸 ${Object.keys(inp || {}).join(',')}`);
    if (SHOTS || tag === 'B' || plan === 'uni') {
      await sleep(1300);
      await shot(host, `host-dinner-show-${tag}-d${day + 1}`);
      const swayS = S.find(s => res.sway.includes(teamOf[s.uid]) && res.per[s.uid] === 'p') || S[0];
      await shot(swayS.page, `play-dinner-show-${tag}-d${day + 1}`);
    }
  }
  // 끝: 마지막 날이 아니면 「여기까지」
  const gl = await H(() => window.__bbHost.g);
  await host.click(gl.r + 1 >= ROUNDS.length ? '[data-act="next"]' : '[data-act="final"]');
  await waitH(() => window.__bbHost.g.step === 'final');
  const gf = await H(() => window.__bbHost.g);
  check(`${tag} 사흘 결과: ${days}일 합계`, gf.hist.length === days);
  if (SHOTS || tag === 'B') { await sleep(1300); await shot(host, `host-dinner-final-${tag}`); await shot(S[0].page, `play-dinner-final-${tag}`); }
  await host.click('[data-act="wrap"]');
  await waitH(() => window.__bbHost.g.step === 'wrap');
  if (SHOTS) { await sleep(900); await shot(host, 'host-dinner-wrap'); await shot(S[0].page, 'play-dinner-wrap'); }
  await host.click('[data-act="finish"]');
  await waitH(() => window.__bbHost.meta.phase === 'result' && window.__bbHost.core.last && window.__bbHost.core.last.gid === 'dinner');
  const after = await scores();
  check(`${tag} 점수 그대로(점수 없는 게임)`, JSON.stringify(after) === JSON.stringify(before));
  const lines = await H(() => window.__bbHost.core.last.lines);
  check(`${tag} 결과 줄: 마음 바꾼 사람 ${changedAll}명`, lines.some(l => l.includes(`${changedAll}명`)), lines.map(l => l.replace(/<[^>]+>/g, '')).join(' / '));
  report.timings['dinner' + tag] = Date.now() - t0;
}

async function closeRoom(S) {
  await host.click('#bEnd');
  await waitH(() => window.__bbHost.meta.phase === 'end');
  await host.click('#bCloseRoom');
  await host.waitForSelector('#bCreate', { timeout: 15000 });
  await Promise.all(S.map(s => s.ctx.close().catch(() => {})));
}

try {
  console.log(`\n[A] 방 만들기 · 학생 ${N}명 · 4명 팀`);
  let room = await makeRoom(4, N, 5);
  const ta = await teamsOf();
  check(`A 팀 ${Object.keys(ta).length}개`, Object.keys(ta).length === Math.min(8, Math.ceil(N / 4)), Object.values(ta).map(u => u.length).join('·'));
  await runCart(room.S, room.code);
  await runDinner(room.S, room.code, 'A-2', 3, ['random', 'tie', 'uni']);
  await closeRoom(room.S);

  console.log(`\n[B] 6명 팀 · 학생 ${N6}명`);
  room = await makeRoom(6, N6, 6);
  const tb = await teamsOf();
  check(`B 팀 ${Object.keys(tb).length}개`, true, Object.values(tb).map(u => u.length).join('·'));
  await runDinner(room.S, room.code, 'B', 1, ['uni']);
  await closeRoom(room.S);

  // 작은 반: 4명 팀 3개(12명) — 진행판 결과 화면 2×2 배치
  console.log('\n[B2] 작은 반 · 학생 10명 · 4명 팀');
  room = await makeRoom(4, 10, 7);
  await runDinner(room.S, room.code, 'B2', 1, ['tie']);
  await shot(host, 'host-small-hub');
  await closeRoom(room.S);

  // ── C. 비상 모드 ──
  console.log('\n[C] 비상 모드 — 교사가 대신 누르기');
  const offCtx = await browser.newContext({ viewport: VIEW, locale: 'ko-KR' });
  const off = await offCtx.newPage();
  watchErrors(off, 'offline');
  off.__promptAnswer = '4';
  await off.goto(`${SITE}/host.html?mock=http://127.0.0.1:1`);
  await off.waitForSelector('.errbox', { timeout: 20000 });
  await off.click('#bOffline');
  await off.waitForSelector('.gcard[data-gid="cart"]', { timeout: 10000 });
  await off.click('.gcard[data-gid="cart"]'); await off.click('#bGo');
  await off.waitForSelector('.pbtn', { timeout: 10000 });
  // 「포장지를 읽어 보세요…」(startAt 전)에는 대신 누르기도 안 받는다 → 읽는 시간이 끝난 뒤 누른다
  await off.waitForFunction(() => { const g = window.__bbHost.g; return g && g.startAt && Date.now() >= g.startAt + 300; }, null, { timeout: 15000 });
  const rows = await off.$$('.proxy-row');
  for (let i = 0; i < rows.length; i++) await off.click(`.proxy-row:nth-child(${i + 1}) .pbtn:nth-child(${2 + (i % 4)})`);
  await shot(off, 'host-offline-cart');
  await off.waitForFunction(() => window.__bbHost.g.step === 'reveal', null, { timeout: 15000 });
  const og = await off.evaluate(() => window.__bbHost.g);
  check('비상 · 장바구니: 4팀 대신 누르기로 일찍 공개', og.res.n === 4, `${og.res.n}팀`);
  await sleep(700);
  await shot(off, 'host-offline-cart-reveal');
  await off.click('[data-act="final"]');
  await off.click('[data-act="finish"]');
  await off.waitForSelector('.gcard[data-gid="dinner"]', { timeout: 10000 });
  await off.click('.gcard[data-gid="dinner"]'); await off.click('#bGo');
  await off.waitForFunction(() => window.__bbHost.g && window.__bbHost.g.step === 'info', null, { timeout: 15000 });
  await sleep(500);
  await shot(off, 'host-offline-dinner-info');
  await off.click('[data-act="v1"]');
  await off.waitForSelector('.pbtn', { timeout: 10000 });
  for (let i = 0; i < 4; i++) await off.click(`.proxy-row:nth-child(${i + 1}) .pbtn:nth-child(${2 + ((i + 1) % 3)})`);
  await shot(off, 'host-offline-dinner-vote1');
  await off.waitForFunction(() => window.__bbHost.g.step === 'talk', null, { timeout: 15000 });
  await off.click('[data-act="twist"]'); await off.click('[data-act="v2"]');
  await off.waitForFunction(() => window.__bbHost.g.step === 'vote2', null, { timeout: 15000 });
  await off.waitForSelector('.pbtn', { timeout: 10000 });
  for (let i = 0; i < 4; i++) {
    await off.click(`.proxy-row:nth-child(${i + 1}) .pbtn:nth-child(${2 + (i % 3)})`);
    for (let j = 0; j <= i % 3 + 1; j++) await off.click(`.proxy-row:nth-child(${i + 1}) .pbtn:nth-child(${5 + ((i + j) % 6)})`);
  }
  await shot(off, 'host-offline-dinner-vote');
  await off.waitForFunction(() => window.__bbHost.g.step === 'show', null, { timeout: 15000 });
  const od = await off.evaluate(() => window.__bbHost.g.res);
  check('비상 · 저녁 회의: 4팀 모두 결정 · 마음 바꾼 팀(첫 마음 ≠ 다시 투표) 표시', Object.values(od.teams).every(t => t.m !== null) && od.cls.ch >= 1, Object.values(od.teams).map(t => `${t.m}/${t.ch}`).join(' '));
  await sleep(1300);
  await shot(off, 'host-offline-dinner-show');
  await offCtx.close();

  const st = await (await fetch(`http://127.0.0.1:${mock.port}/admin/stats`)).json();
  const deniedIn = st.deniedList.filter(d => /\/inputs\//.test(d.path));
  report.mockStats = { ops: st.ops, writes: st.writes, denied: st.denied, deniedInputs: deniedIn.length, sample: st.deniedList.slice(-5) };
  check('가짜 DB: 학생 입력 거절 0건', deniedIn.length === 0, deniedIn.slice(0, 3).map(d => d.why).join(' | '));
} catch (e) {
  check('시험 중단', false, e.message.split('\n')[0]);
  console.error(e);
  try { await shot(host, 'ERROR-host'); } catch {}
} finally {
  await browser.close().catch(() => {});
  stat.close(); mock.close();
  finish();
}

function finish() {
  report.totalMs = Date.now() - T0;
  report.failures = failures;
  report.errors = [...new Set(report.errors)].slice(0, 50);
  fs.writeFileSync(path.join(SHOT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n결과: 확인 ${report.checks.length}개 중 실패 ${failures}개`);
  console.log('시간(ms):', JSON.stringify(report.timings));
  if (report.mockStats) console.log('가짜 DB:', JSON.stringify(report.mockStats));
  console.log(`페이지 오류 ${report.errors.length}건${report.errors.length ? ':\n  ' + report.errors.join('\n  ') : ''}`);
  process.exit(failures ? 1 : 0);
}
