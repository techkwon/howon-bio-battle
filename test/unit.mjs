// 단위 시험: 팀 나누기 · 순위 점수 · 게임 계산 · 보안 규칙(rules-eval)
//   node test/unit.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { teamCountFor, computePick, finalizePick, randomSplit, capsNow } from '../site/src/teams.js';
import { rankPoints, mulberry32 } from '../site/src/shared.js';
import { majority } from '../site/src/gamekit.js';
import yeast, { balloonCm, predOf, PRED, TEMPS } from '../site/games/yeast.js';
import kimchi, { pressScore, zoneOf, dodge, ripeAt } from '../site/games/kimchi.js';
import { Rules, setAt, split, resolveTS } from './rules-eval.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('  ✗', msg); } }
const sizesOf = (assign, ids) => ids.map(t => Object.values(assign).filter(x => x === t).length);

// ── 팀 ──
console.log('팀 나누기');
ok(teamCountFor(30, 4) === 8 && teamCountFor(30, 6) === 5 && teamCountFor(5, 6) === 2 && teamCountFor(1, 4) === 1, 'teamCountFor');
for (let seed = 1; seed <= 300; seed++) {
  const rnd = mulberry32(seed);
  const n = 2 + Math.floor(rnd() * 29);          // 2~30명
  const size = rnd() < 0.5 ? 4 : 6;
  const k = teamCountFor(n, size);
  const ids = Array.from({ length: k }, (_, i) => 't' + (i + 1));
  const uids = Array.from({ length: n }, (_, i) => 'u' + i);
  // 몰림: 70% 는 t1, 나머지 무작위, 10% 는 안 고름
  const picks = uids.map((u, i) => ({ uid: u, pick: rnd() < 0.1 ? null : rnd() < 0.7 ? 't1' : ids[Math.floor(rnd() * k)], pickAt: 1000 + i * 7 + Math.floor(rnd() * 5) }));
  const r = computePick(picks, ids, n);
  const counts = Object.fromEntries(ids.map(t => [t, 0]));
  for (const t of Object.values(r.got)) counts[t]++;
  const caps = capsNow(n, ids, counts);
  ok(ids.every(t => counts[t] <= caps[t]), `정원 초과 seed=${seed}`);
  const fin = finalizePick(r.got, uids, ids, rnd);
  const sz = sizesOf(fin.assign, ids);
  ok(Object.keys(fin.assign).length === n, `모두 배정 seed=${seed}`);
  ok(Math.max(...sz) - Math.min(...sz) <= 1, `인원 차이 ≤1 seed=${seed} ${sz}`);
  // 먼저 누른 사람 중 자리 잡은 사람은 그대로
  ok(Object.entries(r.got).every(([u, t]) => fin.assign[u] === t), `자리 잡은 사람 유지 seed=${seed}`);
  const rs = randomSplit(uids, ids, rnd);
  const s2 = sizesOf(rs, ids);
  ok(Math.max(...s2) - Math.min(...s2) <= 1, `무작위 나누기 균형 seed=${seed}`);
}
{ // 30명 모두 t1 → t1 은 4명만
  const ids = Array.from({ length: 8 }, (_, i) => 't' + (i + 1));
  const picks = Array.from({ length: 30 }, (_, i) => ({ uid: 'u' + i, pick: 't1', pickAt: 100 + i }));
  const r = computePick(picks, ids, 30);
  ok(Object.keys(r.got).length === 4 && r.seats.t1 === 0 && r.over.length === 26, '30명 한 팀 몰림: 4명만 자리');
  ok(['u0', 'u1', 'u2', 'u3'].every(u => r.got[u] === 't1'), '먼저 누른 4명');
  const f = finalizePick(r.got, picks.map(p => p.uid), ids, mulberry32(7));
  ok(JSON.stringify(sizesOf(f.assign, ids).sort()) === JSON.stringify([3, 3, 4, 4, 4, 4, 4, 4]), '30명 → 4·4·4·4·4·4·3·3');
  ok(f.filled.length === 26, '26명 무작위');
}

// ── 순위 · 다수결 ──
console.log('순위 · 다수결');
{
  const r = rankPoints({ a: 30, b: 40, c: 40, d: 10 });
  ok(r.rank.b === 1 && r.rank.c === 1 && r.rank.a === 3 && r.rank.d === 4, '공동 순위');
  ok(r.points.b === 10 && r.points.a === 6, '순위 점수');
  const m = majority([{ v: 40, t: 5 }, { v: 25, t: 3 }, { v: 40, t: 9 }, { v: 25, t: 8 }]);
  ok(m.winner === '25', '동률이면 먼저 낸 쪽');
  ok(majority([{ v: 40, t: 1 }, { v: 40, t: 2 }, { v: 10, t: 0 }]).winner === '40', '다수결');
}

// ── 게임 내용 ──
console.log('게임 계산');
{
  const r = mulberry32(3);
  let max = 0, min = 99;
  for (let i = 0; i < 500; i++) {
    const c40 = balloonCm(40, 2, r); max = Math.max(max, c40); min = Math.min(min, c40);
    ok(balloonCm(70, 2, r) === 10, '70℃ 효모 죽음 → 10cm');
  }
  ok(min >= 37 && max <= 42.5, `40℃·많이 37~42.5cm (${min}~${max})`);
  ok(balloonCm(40, 2, () => .5) > balloonCm(25, 2, () => .5) && balloonCm(25, 2, () => .5) > balloonCm(10, 2, () => .5), '40 > 25 > 10℃');
  ok(balloonCm(40, 2, () => .5) > balloonCm(40, 1, () => .5) && balloonCm(40, 1, () => .5) > balloonCm(40, 0, () => .5), '설탕 많이 > 조금 > 없음');
  ok(pressScore(60) === 100 && pressScore(50) === 75 && pressScore(0) === 0 && pressScore(100) === 0, '김치 점수');
  ok(zoneOf(60).name === '딱 맛있음' && zoneOf(10).name === '생김치' && zoneOf(95).name === '너무 시어짐', '김치 구간');
}

// ── 게임 진행(진행판 판정) — 가짜 ctx 로 ──
console.log('게임 진행 (효모 · 김치)');
{
  let T0 = 1e12;
  const mk = (teams, inputs = {}) => ({
    now: () => T0, rnd: mulberry32(5), teams, inputs, offline: false,
    numOf: u => ({ a: 1, b: 2, c: 3, d: 4, e: 5 }[u] || 0),
  });
  const teams = [{ id: 't1', online: ['a', 'b', 'c'] }, { id: 't2', online: ['d', 'e'] }];
  // 효모: 투표 시간 20초
  let s = yeast.setup(mk(teams));
  ok(s.step === 'vote' && s.deadline === T0 + 20000, '효모 1라운드 투표 20초');
  // 팀마다 한 명씩만 안 골랐으면 6초 뒤 마감(999℃ 는 안 고른 것으로 친다)
  let inp = { a: { temp: 40, sugar: 2, t: T0 }, b: { temp: 40, sugar: 1, t: T0 }, c: { temp: 999, sugar: 2, t: T0 }, d: { temp: 25, sugar: 2, t: T0 } };
  s = yeast.onInput(s, inp, mk(teams, inp));
  ok(s.deadline === T0 + 6000 && s.early, '한 명씩만 남으면 6초 뒤 마감');
  ok(!('999' in (s.tally.t1.tc || {})) && s.tally.t1.done === 2, '목록에 없는 값(999℃)은 표에서 뺀다');
  inp = { ...inp, c: { temp: 10, sugar: 0, t: T0 }, e: { temp: 25, sugar: 2, t: T0 } };
  s = yeast.onInput(s, inp, mk(teams, inp));
  ok(s.deadline === T0 + 3000, '모두 고르면 3초 뒤 마감');
  // 장난 입력만 있는 팀 → 무작위(목록 안의 값)
  const inpBad = { a: { temp: 999, sugar: 7, t: T0 }, b: { temp: -5, sugar: 2, t: T0 } };
  let sb = yeast.onInput(yeast.setup(mk(teams)), inpBad, mk(teams, inpBad));
  T0 += 21000; sb = yeast.tick(sb, mk(teams, inpBad));
  ok(sb.step === 'ferment' && TEMPS.some(x => x.v === sb.run.t1.temp) && sb.run.t1.rand, '장난 입력만 있으면 목록 안에서 무작위');
  // 발효 → 예측 칸이 열린다
  T0 += 1000; s = yeast.tick({ ...s, deadline: T0 }, mk(teams, inp));
  ok(s.step === 'ferment' && s.inputKey === 'p1' && s.predUntil === s.startAt + 8000, '발효 중 예측 칸(8초)');
  const ans1 = predOf(s.run.t1.cm), wrong1 = (ans1 + 1) % 4, ans2 = predOf(s.run.t2.cm);
  const pin = {
    a: { pred: ans1, t: T0 + 100 }, b: { pred: wrong1, t: T0 + 200 },              // c 는 안 냄
    d: { pred: ans2, t: s.predFrom - 1000 },                                          // 칸 열기 전(앞 칸) → 버림
    e: { pred: 7, t: T0 + 100 },                                                      // 목록에 없는 값 → 버림
  };
  s = yeast.onInput(s, pin, mk(teams, pin));
  ok(s.pred.a === ans1 && s.pred.d === undefined && s.pred.e === undefined && s.predDone.t1 === 2 && s.predDone.t2 === 0, '예측 모으기(앞 칸 · 엉뚱한 값 버림)');
  T0 = s.predUntil; s = yeast.tick(s, mk(teams, pin));
  ok(s.inputKey === null, '8초 뒤 예측 잠금');
  T0 = s.deadline; s = yeast.tick(s, mk(teams, pin));
  const h1 = s.history.t1.slice(-1)[0], h2 = s.history.t2.slice(-1)[0];
  ok(s.step === 'reveal' && h1.pred.ok === 1 && h1.pred.n === 3 && h1.pred.pts === 0.3 && h2.pred.pts === 0, `예측 점수 = 맞힌 비율(1/3 → 0.3) ${JSON.stringify(h1.pred)}`);
  ok(s.final.t1 === s.total.t1 + Math.round(0.3) && s.final.t2 === s.total.t2, '팀 점수 = 순위 점수 + 예측 합(반올림)');
  const rm = yeast.remap({ predNeed: { t1: ['a', 'b'] }, pred: { a: 2 } }, 'a', 'z');
  ok(rm.predNeed.t1.join() === 'z,b' && rm.pred.z === 2 && rm.pred.a === undefined, '효모: 새 기기로 바뀌면 예측 옮김');
  ok(PRED.every((x, i) => predOf(x.lo) === i) && predOf(14.4) === 0 && predOf(14.6) === 1 && predOf(42) === 3, '예측 칸 경계(정수 cm)');

  // 김치: 늦게 도착한 입력도 서버 시각이 마감 전이면 센다
  T0 = 2e12;
  let k = kimchi.setup(mk(teams));
  T0 = k.startAt; k = kimchi.tick(k, mk(teams));
  ok(k.step === 'run', '김치 시작');
  const kin = { a: { out: true, t: k.startAt + 5000 } };
  k = kimchi.onInput(k, kin, mk(teams, kin));
  for (let i = 0; i < 400 && k.closeAt == null; i++) { T0 += 100; k = kimchi.tick(k, mk(teams, kin)); }
  ok(k.closeAt != null && k.step === 'run' && k.finishAt === T0 + 1500, '마감 → 1.5초 더 기다림');
  const late = { ...kin, b: { out: true, t: k.startAt + 8000 }, d: { out: true, t: k.closeAt + 50 } };   // b: 늦게 도착(시각은 마감 전) · d: 마감 뒤
  T0 += 700; k = kimchi.onInput(k, late, mk(teams, late));
  T0 = k.finishAt; k = kimchi.tick(k, mk(teams, late));
  ok(k.step === 'reveal' && k.first.b !== undefined && k.first.d === undefined, '늦게 도착한 입력(시각은 마감 전) 셈 · 마감 뒤 입력 버림');
  ok(k.marks.t1.find(m => m.n === 2).p != null && k.marks.t2.find(m => m.n === 4).p == null, '결과 표시도 같음');
  // 정전 뒤 속도 12
  let k3 = { ...kimchi.setup(mk(teams)), round: 3, startAt: 0, eventSec: 6 };
  ok(Math.abs(ripeAt(k3, 7000).p - (3.4 * 6 + 12)) < 1e-9, '정전 뒤 숙성 속도 12/초');
}

// ── 결과 번호 동그라미 비키기 ──
console.log('김치 결과 동그라미');
{
  const r = mulberry32(11);
  for (let t = 0; t < 300; t++) {
    const n = 1 + Math.floor(r() * 6);
    const ps = Array.from({ length: n }, () => Math.round(r() * 1000) / 10);
    const xs = dodge(ps, 4);
    const order = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    let good = xs.every(x => x >= 0 && x <= 100);
    for (let i = 1; i < order.length; i++) if (xs[order[i]] - xs[order[i - 1]] < 4 - 0.11) good = false;
    ok(good, `겹치지 않음 · 순서 유지 ${ps} → ${xs}`);
  }
  ok(JSON.stringify(dodge([10, 50, 90])) === '[10,50,90]', '떨어져 있으면 그대로');
  ok(JSON.stringify(dodge([60, 60])) === '[58,62]', '같은 자리는 양옆으로');
}

// ── 보안 규칙 ──
console.log('보안 규칙 (site/database.rules.json)');
{
  const R = new Rules(path.join(here, '../site/database.rules.json'));
  const host = { uid: 'HOST' }, s1 = { uid: 'S1' }, s2 = { uid: 'S2' }, now = 1e12;
  let db = {};
  const W = (auth, p, v) => {
    const next = setAt(db, split(p), resolveTS(v, now));
    const why = R.checkWrite(db, next, p, auth, now);
    if (!why) db = next;
    return !why;
  };
  const TS = { '.sv': 'timestamp' };
  ok(!W(null, 'rooms/9001/meta', { host: 'X', createdAt: TS, phase: 'lobby' }), '로그인 안 하면 못 씀');
  ok(!W(s1, 'rooms/9001/meta', { host: 'HOST', createdAt: TS, phase: 'lobby' }), '남의 uid 로 방 못 만듦');
  ok(!W(host, 'rooms/90a1/meta', { host: 'HOST', createdAt: TS, phase: 'lobby' }), '방 코드는 숫자 4자리');
  ok(W(host, 'rooms/9001/meta', { host: 'HOST', createdAt: TS, cls: '3-4', teamSize: 4, phase: 'lobby', round: 0, version: 1 }), '진행판 방 만들기');
  ok(!W(s1, 'rooms/9001/meta', { host: 'S1', createdAt: TS, phase: 'lobby' }), '있는 방 빼앗기 금지');
  ok(!W(s1, 'rooms/9001/meta/phase', 'end'), '학생은 meta 못 씀');
  ok(W(host, 'rooms/9001/meta/phase', 'teampick'), '진행판 meta 고침');
  ok(!W(host, 'rooms/9001/meta/host', 'S1'), 'host 바꾸기 금지');
  ok(W(s1, 'rooms/9001/players/S1', { num: 7, joinedAt: TS, on: true, last: TS }), '학생 들어가기');
  ok(!W(s1, 'rooms/9001/players/S2', { num: 8, joinedAt: TS }), '남의 칸 못 씀');
  ok(!W(s2, 'rooms/9001/players/S2', { num: 31 }), '번호 31 거절');
  ok(!W(s2, 'rooms/9001/players/S2', { num: 0 }), '번호 0 거절');
  ok(!W(s2, 'rooms/9001/players/S2', { num: '7' }), '번호 문자열 거절');
  ok(!W(s2, 'rooms/9001/players/S2', { num: 8, name: '홍길동' }), '모르는 칸(이름 등) 거절');
  ok(!W(s2, 'rooms/9001/players/S2', { num: 8, joinedAt: now + 99999 }), '미래 시간 거절');
  ok(!W(s2, 'rooms/9001/players/S2/on', true), 'num 없이 on 만 쓰기 거절(내보낸 뒤 되살아나기 막음)');
  ok(W(s2, 'rooms/9001/players/S2', { num: 8, joinedAt: TS, on: true }), '학생 2');
  ok(W(s1, 'rooms/9001/players/S1/pick', 't1') && W(s1, 'rooms/9001/players/S1/pickAt', TS), '팀 고르기');
  ok(!W(s1, 'rooms/9001/players/S1/pickAt', now - 5000), '팀 고르기 시각 조작(과거) 거절');
  ok(!W(s1, 'rooms/9001/players/S1/pick', 'x'.repeat(30)), '긴 pick 거절');
  ok(!W(s1, 'rooms/9001/teams/t1', { name: '해킹', score: 999 }), '학생 teams 못 씀');
  ok(!W(s1, 'rooms/9001/roster/S1', { team: 't1', num: 7 }), '학생 roster 못 씀');
  ok(!W(s1, 'rooms/9001/state/c', '{}'), '학생 state 못 씀');
  ok(W(host, 'rooms/9001/teams', { t1: { name: '효모단', score: 0, emoji: '🍞' } }), '진행판 teams');
  ok(W(host, 'rooms/9001/roster/S1', { team: 't1', num: 7 }), '진행판 roster');
  ok(!W(s1, 'rooms/9001/inputs/1-y1/S1', { temp: 40, t: TS }), '입력 칸이 안 열렸으면 거절');
  ok(W(host, 'rooms/9001/state/inputKey', '1-y1'), '진행판이 입력 칸 엶');
  ok(W(s1, 'rooms/9001/inputs/1-y1/S1', { temp: 40, sugar: 2, t: TS }), '학생 입력');
  ok(!W(s1, 'rooms/9001/inputs/1-y1/S1', { temp: 40, t: now - 3000 }), '입력 시각 조작(과거) 거절');
  ok(!W(s1, 'rooms/9001/inputs/1-y1/S1', { temp: 40 }), '서버 시각 없는 입력 거절');
  ok(!W(s1, 'rooms/9001/inputs/1-y1/S2', { temp: 40, t: TS }), '남의 입력 거절');
  ok(!W(s1, 'rooms/9001/inputs/1-y1/S1', { note: 'x'.repeat(201) }), '201자 거절');
  ok(W(s1, 'rooms/9001/inputs/1-y1/S1', { note: 'x'.repeat(200), t: TS }), '200자 허용');
  ok(!W(s1, 'rooms/9001/inputs/1-y1/S1', { obj: { a: 1 } }), '입력 안에 객체 거절');
  ok(!W(s1, 'rooms/9001/inputs/9-zz/S1', { temp: 40 }), '닫힌 칸 거절');
  ok(!W({ uid: 'S9' }, 'rooms/9001/inputs/1-y1/S9', { temp: 40 }), '들어오지 않은 사람 입력 거절');
  ok(!W(s1, 'rooms/9001/hack', 'x'), '모르는 칸 거절');
  ok(!W(s1, 'rooms/9002/players/S1', { num: 3 }), '없는 방에 못 들어감');
  // 읽기
  ok(R.canRead(db, 'rooms/9001/meta', s1, now) && R.canRead(db, 'rooms/9001/state', s1, now) && R.canRead(db, 'rooms/9001/teams', s1, now), '학생 공개 칸 읽기');
  ok(!R.canRead(db, 'rooms/9001/players', s1, now), '학생은 남의 번호 목록 못 읽음');
  ok(!R.canRead(db, 'rooms/9001/inputs/1-y1', s1, now) && R.canRead(db, 'rooms/9001/inputs/1-y1/S1', s1, now), '입력은 자기 것만');
  ok(R.canRead(db, 'rooms/9001/roster/S1', s1, now) && !R.canRead(db, 'rooms/9001/roster', s1, now), 'roster 자기 것만');
  ok(R.canRead(db, 'rooms/9001', host, now), '진행판 전체 읽기');
  ok(!R.canRead(db, 'rooms', host, now), '방 목록은 아무도 못 읽음');
  ok(!R.canRead(db, 'rooms/9001/meta', null, now), '로그인 안 하면 못 읽음');
  // 내보내기 · 지우기
  ok(W(host, 'rooms/9001/kick/S2', { at: now, why: 'dup' }) && W(host, 'rooms/9001/players/S2', null), '진행판 내보내기');
  ok(!W(s1, 'rooms/9001/kick/S2', null), '학생 kick 못 지움');
  ok(!W(s1, 'rooms/9001', null), '학생 방 못 지움');
  ok(W(host, 'rooms/9001', null), '진행판 방 지우기');
}

console.log(`\n통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
