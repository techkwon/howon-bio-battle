// 진행판(교사 화면) — 방 · 팀 · 단계 · 점수 · 비상 모드. 판정은 모두 여기서 한다(host-authoritative).
import { connectNet, isTestMode, netMode } from './net.js';
import {
  TEAM_DEFS, PICK_SECONDS, INTRO_SECONDS, DAY_MS, MAX_NUM, esc, newRoomCode, rankPoints, devTag,
} from './shared.js';
import { teamCountFor, computePick, finalizePick, randomSplit, smallestTeam } from './teams.js';
import { confetti, medal, beep } from './gamekit.js';
import GAMES from '../games/index.js';

const $ = s => document.querySelector(s);
const stage = $('#stage');
const LS_SNAP = 'bb.host.snap', LS_ROOMS = 'bb.host.rooms', LS_REC = 'bb.records', LS_PREF = 'bb.host.pref';

const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// ── 진행판 상태 ──────────────────────────────────────────────────
const H = {
  net: null,          // 연결 (비상 모드면 null 이거나 쓰지 않음)
  offline: false,     // 비상 모드
  connected: false,
  lostAt: 0,
  code: null,
  meta: null,
  teams: {},          // tid → {name, emoji, fill, tint, text, score, i}
  roster: {},         // uid → {team, num}
  core: {},           // 조종기에 보이는 공통 상태 (state/c)
  g: null,            // 지금 게임 상태 (state/g/*)
  gid: null,
  gameNo: 0,
  players: {},        // uid → {num, joinedAt, pick, pickAt, on}
  inputs: {}, inputKey: null, inputsOff: null,
  proxy: {},          // inputKey → {proxyUid: input}
  proxyOn: false,
  kicked: {},         // uid → joinedAt
  swaps: {},          // 번호 → [바뀐 시각] (2분 안에 여러 번 바뀌면 교사에게 묻는다)
  dupAsk: {},         // 번호 → {at, uids} — 「누가 진짜?」 교사 확인 대기
  lessonSel: null,    // 게임 고르기에서 보고 있는 차시
  draft: null,        // 팀 편집 중 배정 {uid: tid}
  sel: null,          // 편집 중 고른 번호(uid)
  lastW: {},          // 마지막으로 쓴 state 조각(JSON) — 바뀐 것만 보낸다
  syncTimer: null,
  playersOff: null,
  error: null,
  screenKey: '',
};
window.__bbSound = ls.get(LS_PREF, {}).sound !== false;
window.__bbHost = H; // 시험 · 점검용

const now = () => (H.net && !H.offline ? H.net.serverNow() : Date.now());
const SWAP_WINDOW_MS = 2 * 60 * 1000, SWAP_MAX = 2;   // 2분 안에 2번까지는 자동, 3번째부터 교사에게 묻는다
const online = () => !!(H.net && !H.offline && H.code);
const plugin = () => GAMES.find(g => g.id === H.gid);
const roomPath = p => `rooms/${H.code}/${p}`;

function U(obj) {
  if (!online()) return Promise.resolve();
  return H.net.update(`rooms/${H.code}`, obj).catch(e => toast('저장 실패: ' + (e.code || e.message), true));
}

// ── 저장 · 이어하기 ─────────────────────────────────────────────
function saveSnap() {
  if (!H.code && !H.offline) return;
  ls.set(LS_SNAP, {
    savedAt: Date.now(), code: H.code, offline: H.offline, meta: H.meta, teams: H.teams, roster: H.roster,
    core: H.core, g: H.g, gid: H.gid, gameNo: H.gameNo, proxy: H.proxy, kicked: H.kicked, draft: H.draft,
  });
}

function scheduleSync() {
  if (H.syncTimer) return;
  H.syncTimer = setTimeout(() => { H.syncTimer = null; syncState(); }, 120);
}

function fullKey(k) { return k ? `${H.gameNo}-${k}` : null; }

function syncState() {
  saveSnap();
  if (!online()) return;
  const upd = {};
  const put = (k, v) => {
    const j = (v === undefined || v === null) ? null : JSON.stringify(v);
    if ((H.lastW[k] ?? null) !== j) { upd[`state/${k}`] = j; if (j === null) delete H.lastW[k]; else H.lastW[k] = j; }
  };
  put('c', H.core);
  const g = H.g || {};
  for (const k of Object.keys(g)) if (k !== 'inputKey') put('g/' + k, g[k]);
  for (const k of Object.keys(H.lastW)) if (k.startsWith('g/') && !(k.slice(2) in g)) put(k, null);
  const ik = H.g ? fullKey(H.g.inputKey) : null;
  if ((H.lastW.inputKey ?? null) !== ik) { upd['state/inputKey'] = ik; if (ik === null) delete H.lastW.inputKey; else H.lastW.inputKey = ik; }
  if (Object.keys(upd).length) {
    // 쓰기가 거절되면 다음 번에 다시 보내도록 기억을 지운다
    H.net.update(`rooms/${H.code}`, upd).catch(e => {
      for (const p of Object.keys(upd)) delete H.lastW[p.slice('state/'.length)];
      toast('화면 상태 저장 실패: ' + (e.code || e.message), true);
    });
  }
}

function setMeta(patch) {
  Object.assign(H.meta, patch);
  const upd = {};
  for (const [k, v] of Object.entries(patch)) upd['meta/' + k] = v ?? null;
  U(upd); saveSnap();
}
function writeTeams() { U({ teams: H.teams }); saveSnap(); }
function writeRoster() { U({ roster: H.roster }); saveSnap(); }

// ── 시작 ─────────────────────────────────────────────────────────
let netReady = null;   // 연결이 끝날 때까지 기다리는 약속 (이어서 하기가 연결 전에 눌려도 되게)
async function boot() {
  renderStart({ connecting: !H.offline });
  try {
    netReady = connectNet();
    H.net = await netReady;
    H.net.onConnected(c => {
      H.connected = c;
      if (!c) H.lostAt = H.lostAt || Date.now(); else { if (H.lostAt) H.resumeAt = Date.now() + 1500; H.lostAt = 0; }
      renderBar();
    });
    await cleanupOldRooms();
    renderStart({});
  } catch (e) {
    H.error = '인터넷(데이터베이스)에 연결하지 못했어요. ' + (e.message || '');
    renderStart({ failed: true });
  }
}

async function cleanupOldRooms() {
  const list = ls.get(LS_ROOMS, []);
  const keep = [];
  for (const r of list) {
    if (Date.now() - r.at > DAY_MS) {
      try { await H.net.withTimeout(H.net.remove(`rooms/${r.code}`), 5000, '옛 방 지우기'); } catch { keep.push(r); }
    } else keep.push(r);
  }
  ls.set(LS_ROOMS, keep);
}

function renderStart(st) {
  H.screenKey = 'start';
  const pref = ls.get(LS_PREF, { cls: 1, size: 4, mode: 'pick' });
  const snap = ls.get(LS_SNAP);
  const canResume = snap && Date.now() - snap.savedAt < 8 * 3600 * 1000 && snap.meta && snap.meta.phase !== 'closed';
  const mode = netMode();
  renderBar();
  stage.innerHTML = `
  <div class="start">
    <div class="start-l">
      <div class="eyebrow">13~16차시 · 생명 기술</div>
      <h1 class="hero">생명 기술 대작전</h1>
      <p class="lead">학생은 크롬북에서 <b>방 코드 + 번호</b>만 넣는다. 이름은 받지 않는다.</p>
      ${mode.kind !== 'firebase' ? `<p class="warnbox">시험 모드: ${esc(mode.kind)} ${esc(mode.url || mode.host || '')} · 방 코드 9xxx</p>` : ''}
      ${canResume ? `
      <div class="card resume">
        <div><b>이어서 하기</b><span>${esc(snap.meta.cls || '')}반 · ${snap.offline ? '비상 모드' : '방 ' + esc(snap.code)} · ${new Date(snap.savedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 저장</span></div>
        <button class="btn" id="bResume">이어서 ▶</button>
        <button class="btn ghost" id="bDrop">버리기</button>
      </div>` : ''}
    </div>
    <div class="start-r card">
      <div class="lbl">반</div>
      <div class="seg" id="segCls">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button class="segb ${pref.cls === n ? 'on' : ''}" data-v="${n}" aria-pressed="${pref.cls === n}">3-${n}</button>`).join('')}</div>
      <div class="lbl">팀 크기</div>
      <div class="seg" id="segSize">${[4, 6].map(n => `<button class="segb ${pref.size === n ? 'on' : ''}" data-v="${n}" aria-pressed="${pref.size === n}">${n}명씩</button>`).join('')}</div>
      <div class="lbl">팀 정하는 방식</div>
      <div class="seg" id="segMode">
        <button class="segb ${pref.mode === 'pick' ? 'on' : ''}" data-v="pick" aria-pressed="${pref.mode === 'pick'}">학생이 고르기 (30초)</button>
        <button class="segb ${pref.mode === 'assign' ? 'on' : ''}" data-v="assign" aria-pressed="${pref.mode === 'assign'}">교사가 정하기</button>
      </div>
      <button class="btn big" id="bCreate" ${st.connecting || st.failed ? 'disabled' : ''}>${st.connecting ? '연결하는 중…' : '방 만들기 ▶'}</button>
      ${st.failed || H.error ? `<p class="errbox">${esc(H.error || '')}</p>` : ''}
      <div class="emerg">
        <span>와이파이가 안 되나요?</span>
        <button class="btn ghost" id="bOffline">비상 모드 (인터넷 없이, 교사가 대신 누르기)</button>
      </div>
    </div>
  </div>`;
  const segs = { segCls: 'cls', segSize: 'size', segMode: 'mode' };
  for (const [id, key] of Object.entries(segs)) {
    $('#' + id).querySelectorAll('.segb').forEach(b => b.onclick = () => {
      const p = ls.get(LS_PREF, { cls: 1, size: 4, mode: 'pick' });
      p[key] = key === 'mode' ? b.dataset.v : Number(b.dataset.v);
      ls.set(LS_PREF, p);
      renderStart(st);
    });
  }
  $('#bCreate').onclick = () => createRoom();
  $('#bOffline').onclick = () => startOffline();
  if ($('#bResume')) $('#bResume').onclick = () => resume(snap);
  if ($('#bDrop')) $('#bDrop').onclick = () => { if (confirm('저장된 수업을 버릴까요?')) { ls.del(LS_SNAP); renderStart(st); } };
}

async function createRoom() {
  const pref = ls.get(LS_PREF, { cls: 1, size: 4, mode: 'pick' });
  const btn = $('#bCreate');
  btn.disabled = true; btn.textContent = '방 만드는 중…';
  try {
    let code = null;
    for (let i = 0; i < 6 && !code; i++) {
      const c = newRoomCode(Math.random, isTestMode());
      const ex = await H.net.withTimeout(H.net.get(`rooms/${c}/meta`), 8000, '방 확인');
      if (!ex) code = c;
    }
    if (!code) throw new Error('빈 방 코드를 찾지 못했어요');
    const meta = {
      host: H.net.uid, createdAt: H.net.TS, cls: `3-${pref.cls}`, teamSize: pref.size, teamCount: 0,
      mode: pref.mode, phase: 'lobby', game: null, round: 0, deadline: null, version: 1,
    };
    await H.net.withTimeout(H.net.set(`rooms/${code}/meta`, meta), 8000, '방 만들기');
    H.code = code;
    H.meta = { ...meta, createdAt: Date.now() };
    H.teams = {}; H.roster = {}; H.core = {}; H.g = null; H.gid = null; H.gameNo = 0; H.lastW = {}; H.kicked = {};
    const rooms = ls.get(LS_ROOMS, []); rooms.push({ code, at: Date.now() }); ls.set(LS_ROOMS, rooms);
    attachRoom();
    syncState();
    render();
  } catch (e) {
    const denied = /PERMISSION|permission/i.test(e.code || e.message || '');
    H.error = denied
      ? '데이터베이스가 쓰기를 막았어요(보안 규칙이 아직 잠금 모드일 수 있어요). database.rules.json 을 콘솔에 올렸는지 확인하세요.'
      : '방을 만들지 못했어요: ' + (e.message || e);
    renderStart({ failed: true });
  }
}

function attachRoom() {
  if (H.playersOff) H.playersOff();
  H.playersOff = H.net.on(roomPath('players'), v => { H.players = v || {}; onPlayers(); },
    e => toast('학생 목록을 못 읽어요: ' + (e.code || e.message), true));
  watchInputs();
}

async function resume(snap) {
  Object.assign(H, {
    code: snap.code, offline: snap.offline, meta: snap.meta, teams: snap.teams || {}, roster: snap.roster || {},
    core: snap.core || {}, g: snap.g, gid: snap.gid, gameNo: snap.gameNo || 0, proxy: snap.proxy || {}, kicked: snap.kicked || {}, lastW: {},
    draft: snap.draft || (snap.meta && snap.meta.phase === 'teampick' ? (snap.core && snap.core.pick && snap.core.pick.result) || Object.fromEntries(Object.entries(snap.roster || {}).map(([u, r]) => [u, r.team])) : null),
  });
  if (H.offline) { H.proxyOn = true; render(); return; }
  if (!H.net && netReady) { stage.innerHTML = '<p class="lead">연결하는 중…</p>'; try { H.net = await netReady; } catch {} }
  if (!H.net) { toast('연결이 없어 비상 모드로 이어 갑니다', true); H.offline = true; H.proxyOn = true; render(); return; }
  try {
    const meta = await H.net.withTimeout(H.net.get(roomPath('meta')), 8000, '방 확인');
    if (!meta || meta.host !== H.net.uid) throw new Error('방이 없거나 다른 사람 방이에요');
    await H.net.withTimeout(H.net.update(`rooms/${H.code}`, { teams: H.teams, roster: H.roster }), 8000, '다시 쓰기');
    attachRoom();
    syncState();
    render();
  } catch (e) {
    H.code = null; H.error = '이어서 하지 못했어요: ' + (e.message || e);
    renderStart({});
  }
}

function startOffline() {
  const n = Number(prompt('비상 모드 — 팀이 몇 개인가요? (2~8)', '6'));
  if (!(n >= 2 && n <= 8)) return;
  const pref = ls.get(LS_PREF, { cls: 1, size: 4, mode: 'pick' });
  H.offline = true; H.proxyOn = true; H.code = null;
  H.meta = { host: 'local', createdAt: Date.now(), cls: `3-${pref.cls}`, teamSize: pref.size, teamCount: n, mode: 'offline', phase: 'result', game: null, round: 0 };
  H.teams = makeTeams(n);
  H.roster = {}; H.core = { hub: { formed: true } }; H.g = null; H.gid = null;
  saveSnap();
  render();
}

function goOffline() {
  if (!confirm('비상 모드로 바꿀까요?\n학생 화면 입력은 받지 않고, 교사가 팀 대신 누르기로 진행합니다.\n점수와 팀은 그대로 이어집니다.')) return;
  H.offline = true; H.proxyOn = true;
  saveSnap(); render();
}

// ── 학생 접속 · 같은 번호 · 늦게 온 학생 ─────────────────────────
function present() {
  return Object.entries(H.players)
    .filter(([u, p]) => p && Number.isInteger(p.num) && p.num >= 1 && p.num <= MAX_NUM && !H.kicked[u])
    .map(([uid, p]) => ({ uid, ...p }));
}
const isOn = u => !!(H.players[u] && H.players[u].on && !H.kicked[u]);

function onPlayers() {
  if (!H.meta) return;
  // 0) 내보냈던 기기가 새로 들어오면(새 joinedAt) 내보냄을 푼다
  for (const [u, at] of Object.entries(H.kicked)) {
    const p = H.players[u];
    if (p && p.joinedAt && p.joinedAt > at) { delete H.kicked[u]; U({ [`kick/${u}`]: null }); }
  }
  // 1) 같은 번호가 둘이면 나중에 들어온 기기를 받고 앞의 것은 내보낸다.
  //    단, 같은 번호가 2분 안에 2번 넘게 바뀌면(서로 번갈아 들어오는 장난 · 번호 착각) 자동으로 내보내지 않고 교사에게 묻는다
  const byNum = {};
  for (const p of present()) (byNum[p.num] = byNum[p.num] || []).push(p);
  for (const n of Object.keys(H.dupAsk)) {
    const list = byNum[n] || [];
    if (list.length < 2) delete H.dupAsk[n];                       // 한쪽이 나갔으면 물을 것 없음
    else H.dupAsk[n].uids = list.map(p => p.uid);
  }
  for (const [n, list] of Object.entries(byNum)) {
    if (list.length < 2 || H.dupAsk[n]) continue;
    const t = Date.now();
    const recent = (H.swaps[n] || []).filter(x => t - x < SWAP_WINDOW_MS);
    if (recent.length >= SWAP_MAX) {
      H.swaps[n] = recent;
      H.dupAsk[n] = { at: t, uids: list.map(p => p.uid) };
      beep(330, 300, 'square', 0.1);
      continue;
    }
    H.swaps[n] = [...recent, t];
    list.sort((a, b) => (b.joinedAt || 0) - (a.joinedAt || 0));
    const keep = list[0];
    for (const old of list.slice(1)) replaceDevice(old.uid, keep, 'dup');
    writeRoster();
  }
  // 2) 팀이 정해진 뒤 새로 온 학생 → 가장 작은 팀
  const formed = Object.keys(H.teams).length && H.meta.phase !== 'lobby' && H.meta.phase !== 'teampick';
  if (formed) {
    let changed = false;
    for (const p of present()) {
      if (H.roster[p.uid]) {
        if (H.roster[p.uid].num !== p.num) { H.roster[p.uid].num = p.num; changed = true; }
        continue;
      }
      if (!p.on || H.dupAsk[p.num]) continue;        // 「누가 진짜?」를 교사가 고르기 전에는 팀을 넘기지 않는다
      // 같은 번호가 roster 에 다른 uid 로 남아 있으면(그 기기는 이미 나감) 팀을 물려받는다
      const prev = Object.entries(H.roster).find(([u, r]) => r.num === p.num && u !== p.uid);
      if (prev) { H.roster[p.uid] = { team: prev[1].team, num: p.num }; delete H.roster[prev[0]]; remapGame(prev[0], p.uid); }
      else {
        const assign = Object.fromEntries(Object.entries(H.roster).map(([u, r]) => [u, r.team]));
        const t = smallestTeam(assign, Object.keys(H.teams));
        H.roster[p.uid] = { team: t, num: p.num };
        toast(`${p.num}번 → ${H.teams[t].emoji} ${H.teams[t].name}`);
      }
      changed = true;
    }
    if (changed) writeRoster();
  }
  if (H.meta.phase === 'teampick' && H.core.pick && H.core.pick.open) updatePick();
  if (H.g && plugin()) feedInputs();
  render();
}

// 같은 번호 기기 바꾸기: old 를 내보내고 팀 · 게임 기록을 keep 에게 넘긴다
function replaceDevice(oldUid, keep, why) {
  kick(oldUid, why);
  if (H.roster[oldUid] && !H.roster[keep.uid]) {
    H.roster[keep.uid] = { ...H.roster[oldUid], num: keep.num };
    toast(`${keep.num}번이 다른 기기로 바뀌었어요`);
  }
  delete H.roster[oldUid];
  remapGame(oldUid, keep.uid);
  if (H.draft && H.draft[oldUid]) { if (!H.draft[keep.uid]) H.draft[keep.uid] = H.draft[oldUid]; delete H.draft[oldUid]; }
}

// 교사가 「이 기기가 진짜」를 고름 → 나머지는 내보낸다
function resolveDup(n, keepUid) {
  const ask = H.dupAsk[n];
  if (!ask) return;
  const keepP = H.players[keepUid];
  delete H.dupAsk[n];
  H.swaps[n] = [];
  if (keepP) {
    const keep = { uid: keepUid, ...keepP };
    for (const u of ask.uids) if (u !== keepUid && H.players[u]) replaceDevice(u, keep, 'host');
    writeRoster();
  }
  onPlayers();
}

function remapGame(from, to) {
  const p = plugin();
  if (H.g && p && p.remap) { H.g = p.remap(H.g, from, to); scheduleSync(); }
}

function kick(uid, why) {
  const at = (H.players[uid] && H.players[uid].joinedAt) || Date.now();
  H.kicked[uid] = at;
  U({ [`kick/${uid}`]: { at, why }, [`players/${uid}`]: null });
}

// ── 팀 ──────────────────────────────────────────────────────────
function makeTeams(k, keepScores = false) {
  const out = {};
  for (let i = 0; i < k; i++) {
    const d = TEAM_DEFS[i], id = 't' + (i + 1);
    out[id] = { i, name: d.name, emoji: d.emoji, fill: d.fill, tint: d.tint, text: d.text, score: keepScores && H.teams[id] ? H.teams[id].score : 0 };
  }
  return out;
}
const teamIds = () => Object.keys(H.teams).sort((a, b) => H.teams[a].i - H.teams[b].i);

function openTeamPick(fresh = true) {
  const people = present().filter(p => p.on);
  const n = people.length;
  if (n < 2 && !confirm(`지금 접속한 학생이 ${n}명이에요. 그래도 팀을 정할까요?`)) return;
  const k = teamCountFor(Math.max(n, 2), H.meta.teamSize);
  if (fresh) { H.teams = makeTeams(k); H.roster = {}; writeRoster(); }
  const mode = H.meta.mode;
  if (mode === 'pick' && fresh) {
    H.draft = null;
    H.core = { pick: { open: true, openedAt: now(), deadline: now() + PICK_SECONDS * 1000, n, teamIds: teamIds(), seats: {}, got: {} } };
    updatePick();
  } else {
    // 교사 지정(또는 확정 뒤 고치기): 지금 roster 를 출발점으로
    H.draft = Object.fromEntries(Object.entries(H.roster).map(([u, r]) => [u, r.team]));
    H.core = { pick: { open: false, editing: true, teamIds: teamIds() } };
  }
  setMeta({ phase: 'teampick', teamCount: Object.keys(H.teams).length });
  writeTeams();
  scheduleSync(); render();
}

function updatePick() {
  const pk = H.core.pick;
  const picks = present().filter(p => p.pick && (p.pickAt || 0) >= pk.openedAt - 2000)
    .map(p => ({ uid: p.uid, pick: p.pick, pickAt: p.pickAt }));
  const r = computePick(picks, pk.teamIds, pk.n);
  pk.got = r.got; pk.seats = r.seats; pk.over = r.over.length;
  scheduleSync();
}

function closePick() {
  const pk = H.core.pick;
  updatePick();
  const all = present().filter(p => p.on || pk.got[p.uid]).map(p => p.uid);
  const { assign, filled } = finalizePick(pk.got, all, pk.teamIds);
  H.draft = assign;
  H.core = { pick: { open: false, editing: true, teamIds: pk.teamIds, filled, result: assign } };
  beep(880, 200, 'triangle');
  scheduleSync(); render();
}

function confirmTeams() {
  const ids = teamIds();
  const assign = { ...H.draft };
  // 아직 팀 없는 학생(접속 중) → 가장 작은 팀
  for (const p of present()) if (!assign[p.uid] && p.on) assign[p.uid] = smallestTeam(assign, ids);
  // 빈 팀은 없앤다
  const used = new Set(Object.values(assign));
  for (const t of ids) if (!used.has(t) && ids.length > 1) delete H.teams[t];
  const oldRoster = H.roster;
  H.roster = {};
  for (const [u, t] of Object.entries(assign)) {
    if (!H.teams[t]) continue;
    const num = H.players[u] ? H.players[u].num : (oldRoster[u] && oldRoster[u].num);
    if (num) H.roster[u] = { team: t, num };
  }
  H.draft = null; H.sel = null;
  H.core = { hub: { formed: true } };
  setMeta({ phase: 'result', teamCount: Object.keys(H.teams).length });
  writeTeams(); writeRoster(); scheduleSync();
  beep(660, 120); setTimeout(() => beep(990, 200, 'triangle'), 130);
  render();
  confetti(stage, 40);
}

function moveDraft(uid, tid) {
  if (!H.draft) return;
  if (tid === 'pool') delete H.draft[uid]; else H.draft[uid] = tid;
  H.sel = null;
  render();
}
function shuffleDraft() {
  const uids = present().filter(p => p.on || (H.draft && H.draft[p.uid])).map(p => p.uid);
  H.draft = randomSplit(uids, teamIds());
  render();
}
function changeTeamCount(d) {
  const k = Math.max(2, Math.min(8, teamIds().length + d));
  H.teams = makeTeams(k, true);
  for (const [u, t] of Object.entries(H.draft || {})) if (!H.teams[t]) delete H.draft[u];
  H.core.pick.teamIds = teamIds();
  setMeta({ teamCount: k });
  writeTeams(); scheduleSync(); render();
}

// ── 게임 ────────────────────────────────────────────────────────
function teamList() {
  const ids = teamIds();
  return ids.map(id => {
    const t = H.teams[id];
    const members = Object.entries(H.roster).filter(([, r]) => r.team === id).map(([u]) => u);
    const on = members.filter(isOn);
    const proxyUid = 'proxy-' + id;
    const useProxy = H.offline || H.proxyOn;
    return { id, name: t.name, emoji: t.emoji, fill: t.fill, tint: t.tint, text: t.text, score: t.score,
      members: useProxy ? [...members, proxyUid] : members,
      online: useProxy ? [...(H.offline ? [] : on), proxyUid] : on };
  });
}

function mergedInputs() {
  const k = H.g && H.g.inputKey;
  const base = H.offline ? {} : (H.inputs || {});
  return { ...base, ...((k && H.proxy[fullKey(k)]) || {}) };
}

function gctx() {
  return {
    now, teams: teamList(), inputs: mergedInputs(), rnd: Math.random,
    numOf: u => (u.startsWith('proxy-') ? 0 : (H.roster[u] && H.roster[u].num) || (H.players[u] && H.players[u].num) || 0),
    act: (name, payload) => { const p = plugin(); if (!p || !H.g) return; H.g = p.action ? p.action(H.g, name, payload, gctx()) : H.g; afterGame(); },
    offline: H.offline, cls: H.meta.cls,
  };
}

function startGame(gid) {
  const p = GAMES.find(g => g.id === gid);
  if (!p) return;
  if (p.lesson) { H.lessonSel = p.lesson; const pr = ls.get(LS_PREF, {}); pr.lesson = p.lesson; ls.set(LS_PREF, pr); }
  H.gid = gid; H.g = null; H.gameNo += 1; H.proxy = {};
  H.core = { intro: { gid, until: now() + INTRO_SECONDS * 1000 } };
  setMeta({ phase: 'game', game: gid, round: H.gameNo });
  scheduleSync(); render();
}

function beginGame() {
  const p = plugin();
  H.core = { playing: H.gid };
  H.g = p.setup(gctx());
  afterGame();
}

function watchInputs() {
  const k = H.g ? fullKey(H.g.inputKey) : null;
  if (k === H.inputKey) return;
  if (H.inputsOff) { H.inputsOff(); H.inputsOff = null; }
  H.inputKey = k; H.inputs = {};
  if (k && online()) {
    // 칸이 바뀐 뒤 앞 칸 구독 값이 늦게 와도(구독을 끊기 전에 이미 날아온 것) 새 칸 입력을 덮지 않게 한다
    H.inputsOff = H.net.on(roomPath(`inputs/${k}`), v => { if (H.inputKey !== k) return; H.inputs = v || {}; feedInputs(); render(); });
  }
}

function feedInputs() {
  const p = plugin();
  if (!p || !H.g || !p.onInput) return;
  const g2 = p.onInput(H.g, mergedInputs(), gctx());
  if (g2 !== H.g) { H.g = g2; afterGame(false); }
}

function afterGame(rerender = true) {
  if (!H.g) return;
  watchInputs();
  if (H.g.done) return finishGame();
  scheduleSync();
  if (rerender) render();
}

function finishGame() {
  const p = plugin(), c = gctx();
  const res = (p.scoring && p.scoring(H.g, c)) || { points: {}, lines: [] };
  const gained = {};
  for (const id of teamIds()) { gained[id] = Math.round(res.points[id] || 0); H.teams[id].score += gained[id]; }
  const rec = p.record ? p.record(H.g, c) : null;
  let recInfo = null;
  if (rec && rec.team && H.teams[rec.team]) recInfo = saveRecord(p, rec);
  H.core = { last: { gid: p.id, title: p.title, emoji: p.emoji, gained, lines: res.lines || [], rec: recInfo } };
  H.g = null; watchInputs();
  U({ inputs: null });
  setMeta({ phase: 'result', game: null });
  writeTeams(); scheduleSync();
  render();
  confetti(stage, 70);
  beep(784, 150); setTimeout(() => beep(1046, 280, 'triangle'), 160);
}

function abortGame() {
  if (!confirm('이 게임을 그만할까요? (점수는 더하지 않아요)')) return;
  H.g = null; H.core = { hub: { formed: true } }; watchInputs();
  U({ inputs: null });
  setMeta({ phase: 'result', game: null });
  scheduleSync(); render();
}

function proxyPress(tid, btn) {
  const k = fullKey(H.g && H.g.inputKey);
  if (!k) return;
  const pu = 'proxy-' + tid;
  H.proxy[k] = H.proxy[k] || {};
  const prev = H.proxy[k][pu];
  if (btn.once && prev) return;
  H.proxy[k][pu] = { ...(prev || {}), ...btn.input, t: now() };
  feedInputs(); render();
}

// ── 반 대항 기록판 (이 PC localStorage 에만) ─────────────────────
function saveRecord(p, rec) {
  const all = ls.get(LS_REC, {});
  const list = all[p.id] || [];
  const t = H.teams[rec.team];
  const entry = { cls: H.meta.cls, team: t.name, emoji: t.emoji, value: rec.value, unit: rec.unit || '', label: rec.label, at: Date.now() };
  const prevBest = list.length ? list[0].value : null;
  list.push(entry);
  list.sort((a, b) => b.value - a.value);
  all[p.id] = list.slice(0, 10);
  ls.set(LS_REC, all);
  return { ...entry, best: prevBest === null || rec.value > prevBest, prevBest };
}

// ── 단계: 수업 끝 · 방 닫기 ───────────────────────────────────────
function endClass() {
  if (!confirm('수업을 끝내고 최종 순위를 보여 줄까요?')) return;
  const scores = Object.fromEntries(teamIds().map(id => [id, H.teams[id].score]));
  const { rank } = rankPoints(scores, true);
  H.core = { final: { rank, scores } };
  setMeta({ phase: 'end', game: null });
  scheduleSync(); render();
  setTimeout(() => confetti(stage, 120), 300);
}

async function closeRoom() {
  if (!confirm('방을 지우고 끝낼까요? 학생 화면도 끝납니다.')) return;
  if (online()) {
    try { await H.net.withTimeout(H.net.remove(`rooms/${H.code}`), 8000, '방 지우기'); }
    catch (e) { toast('방을 지우지 못했어요(내일 진행판을 열면 다시 지웁니다): ' + e.message, true); }
    ls.set(LS_ROOMS, ls.get(LS_ROOMS, []).filter(r => r.code !== H.code));
  }
  if (H.playersOff) H.playersOff();
  if (H.inputsOff) H.inputsOff();
  ls.del(LS_SNAP);
  Object.assign(H, { code: null, meta: null, teams: {}, roster: {}, core: {}, g: null, gid: null, players: {}, offline: false, proxyOn: false, draft: null, lastW: {}, swaps: {}, dupAsk: {} });
  renderStart({});
}

// ── 그리기 ──────────────────────────────────────────────────────
function renderBar() {
  const bar = $('#bar');
  const conn = H.offline ? ['off', '비상 모드'] : !H.net ? ['wait', '연결 전'] : H.connected ? ['ok', '연결됨'] : ['bad', '끊김'];
  const ppl = present().filter(p => p.on).length;
  bar.innerHTML = `
    <span class="b-title">🧬 생명 기술 대작전</span>
    ${H.meta ? `<span class="b-chip">${esc(H.meta.cls)}반</span>` : ''}
    ${H.code ? `<span class="b-chip strong">방 <b class="num">${esc(H.code)}</b></span>` : ''}
    <span class="b-conn ${conn[0]}"><i></i>${conn[1]}</span>
    ${H.code && !H.offline ? `<span class="b-chip">접속 <b class="num">${ppl}</b>명</span>` : ''}
    <span class="b-sp"></span>
    ${H.g && !H.offline ? `<button class="b-btn ${H.proxyOn ? 'on' : ''}" id="bProxy" aria-pressed="${H.proxyOn}">대신 누르기</button>` : ''}
    ${H.g ? `<button class="b-btn" id="bAbort">게임 그만</button>` : ''}
    <button class="b-btn" id="bSound" aria-label="소리">${window.__bbSound ? '🔊' : '🔇'}</button>`;
  $('#bSound').onclick = () => { window.__bbSound = !window.__bbSound; const p = ls.get(LS_PREF, {}); p.sound = window.__bbSound; ls.set(LS_PREF, p); renderBar(); };
  if ($('#bProxy')) $('#bProxy').onclick = () => { H.proxyOn = !H.proxyOn; feedInputs(); render(); };
  if ($('#bAbort')) $('#bAbort').onclick = abortGame;
  // 연결이 6초 넘게 끊기면 안내
  const lost = H.code && !H.offline && H.lostAt && Date.now() - H.lostAt > 6000;
  const ban = $('#banner');
  if (lost) {
    if (!ban.dataset.on) {
      ban.dataset.on = '1';
      ban.innerHTML = `<b>⚠ 인터넷이 끊겼어요.</b> 학생 입력이 멈췄습니다. 다시 연결되면 저절로 이어져요. <button class="btn ghost" id="bGoOff">비상 모드로 바꾸기</button>`;
      $('#bGoOff').onclick = goOffline;
    }
  } else if (ban.dataset.on) { ban.dataset.on = ''; ban.innerHTML = ''; }
  renderAsks();
}

// 「⚠ 7번 두 기기 — 누가 진짜?」 — 같은 번호가 2분 안에 여러 번 바뀌면 교사가 고른다
function renderAsks() {
  let box = $('#asks');
  if (!box) { box = document.createElement('div'); box.id = 'asks'; box.setAttribute('role', 'alert'); document.body.appendChild(box); }
  const nums = Object.keys(H.dupAsk).sort((a, b) => a - b);
  const items = nums.map(n => ({ n, devs: H.dupAsk[n].uids.filter(u => H.players[u]).map(u => ({ u, ...H.players[u] })).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0)) }));
  const key = JSON.stringify(items.map(it => [it.n, it.devs.map(d => [d.u, !!d.on])]));
  if (box.dataset.k === key) return;
  box.dataset.k = key;
  box.innerHTML = items.map(({ n, devs }) => `
    <div class="ask">
      <div class="ask-h"><b>⚠ ${n}번 두 기기 — 누가 진짜?</b><span>2분 안에 여러 번 바뀌어서 자동으로 내보내지 않았어요. 학생 화면 위쪽의 <b>기기 글자</b>를 보고 진짜를 고르세요.</span></div>
      <div class="ask-b">${devs.map((d, i) => `<button class="btn ${i === devs.length - 1 ? '' : 'ghost'}" data-n="${n}" data-u="${esc(d.u)}">기기 <b>${devTag(d.u)}</b> · ${i === 0 ? '먼저' : '나중에'} 들어옴${d.on ? '' : ' (끊김)'}</button>`).join('')}</div>
    </div>`).join('');
  box.querySelectorAll('[data-u]').forEach(b => { b.onclick = () => { resolveDup(b.dataset.n, b.dataset.u); renderAsks(); render(); }; });
}

function render() {
  renderBar();
  if (!H.meta) return;
  const ph = H.meta.phase;
  if (ph === 'lobby') return renderLobby();
  if (ph === 'teampick') return renderTeamPick();
  if (ph === 'game') return renderGame();
  if (ph === 'result') return renderHub();
  if (ph === 'end') return renderEnd();
}

function setScreen(key, html) {
  if (H.screenKey === key) return false;
  H.screenKey = key;
  stage.innerHTML = html;
  return true;
}

function joinURL() {
  const u = location.origin + location.pathname.replace(/host\.html$/, '');
  return u.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function numGrid() {
  const byNum = {};
  for (const p of present()) byNum[p.num] = p;
  let h = '';
  for (let n = 1; n <= MAX_NUM; n++) {
    const p = byNum[n];
    const r = p && H.roster[p.uid];
    const t = r && H.teams[r.team];
    const cls = !p ? 'none' : p.on ? 'on' : 'lost';
    h += `<button class="ng ${cls}" data-uid="${p ? p.uid : ''}" ${p ? '' : 'disabled'} style="${t ? `--tf:${t.fill}` : ''}"
      aria-label="${n}번 ${!p ? '안 들어옴' : p.on ? '접속' : '끊김'}">${t ? `<span class="ng-e">${t.emoji}</span>` : ''}<b class="num">${n}</b>${cls === 'lost' ? '<small>끊김</small>' : ''}</button>`;
  }
  return h;
}

function renderLobby() {
  const ppl = present().filter(p => p.on).length;
  setScreen('lobby', `
  <div class="lobby">
    <div class="lobby-l">
      <div class="eyebrow">들어오세요</div>
      <div class="join-url">${esc(joinURL())}</div>
      <div class="code-lbl">방 코드</div>
      <div class="code-big num">${esc(H.code)}</div>
      <p class="lead">크롬북에서 주소를 열고 <b>방 코드</b>와 <b>내 번호</b>를 넣어요.</p>
      <button class="btn big" id="bTeam">팀 정하기 ▶</button>
      <p class="dim small" id="lobbyInfo"></p>
    </div>
    <div class="lobby-r card">
      <div class="lbl">접속한 번호 <span class="legend"><i class="sw on"></i>접속 <i class="sw lost"></i>끊김 <i class="sw none"></i>아직</span></div>
      <div class="ngrid" id="ngrid"></div>
      <p class="dim small">번호를 누르면 그 기기를 내보낼 수 있어요(번호를 잘못 넣었을 때).</p>
    </div>
  </div>`);
  $('#ngrid').innerHTML = numGrid();
  $('#lobbyInfo').textContent = `지금 ${ppl}명 · ${H.meta.teamSize}명씩 → ${teamCountFor(Math.max(ppl, 2), H.meta.teamSize)}팀 · ${H.meta.mode === 'pick' ? '학생이 고르기' : '교사가 정하기'}`;
  $('#bTeam').onclick = () => openTeamPick(true);
  $('#ngrid').querySelectorAll('.ng[data-uid]').forEach(b => {
    if (!b.dataset.uid) return;
    b.onclick = () => {
      const p = H.players[b.dataset.uid];
      if (p && confirm(`${p.num}번 기기를 내보낼까요?`)) { kick(b.dataset.uid, 'host'); }
    };
  });
}

function chip(uid, extra = '') {
  const p = H.players[uid];
  const r = H.roster[uid];
  const num = p ? p.num : r ? r.num : '?';
  const off = !isOn(uid);
  return `<button class="chip ${off ? 'lost' : ''} ${H.sel === uid ? 'sel' : ''} ${extra}" draggable="true" data-uid="${uid}" aria-label="${num}번">${num}${off ? '<small>끊김</small>' : ''}</button>`;
}

function renderTeamPick() {
  const pk = H.core.pick || {};
  const ids = teamIds();
  if (pk.open) {
    // 학생이 고르는 중 — 실시간 자리
    const secs = Math.max(0, Math.ceil((pk.deadline - now()) / 1000));
    if (secs === 0) return closePick();
    const members = Object.fromEntries(ids.map(t => [t, []]));
    for (const [u, t] of Object.entries(pk.got || {})) if (members[t]) members[t].push(u);
    const picked = Object.keys(pk.got || {}).length;
    setScreen('pick-' + ids.length, `
    <div class="tp">
      <div class="tp-top">
        <div><div class="eyebrow">팀 고르기</div><h1 class="title">크롬북에서 들어갈 팀을 눌러요! <span class="dim" id="tpInfo"></span></h1></div>
        <div class="gk-timer" id="tpTimer"><span class="gk-timer-l">남은 시간</span><b class="gk-timer-n num"></b><span class="gk-timer-u">초</span></div>
      </div>
      <div class="tp-cols" id="tpCols" style="--n:${ids.length}"></div>
      <div class="tp-foot"><button class="btn ghost" id="bMore">+10초</button><button class="btn" id="bClose">지금 마감 ▶</button>
        <span class="dim">자리가 다 찬 팀은 잠긴다 · 못 고른 사람은 빈자리에 🎲 무작위</span></div>
    </div>`);
    const tm = $('#tpTimer');
    tm.querySelector('.gk-timer-n').textContent = secs;
    tm.classList.toggle('hot', secs <= 3);
    if (stage.__lastSec !== secs) { stage.__lastSec = secs; if (secs <= 3) beep(660 + (3 - secs) * 110, 110, 'square', 0.08); }
    $('#tpInfo').textContent = `${picked}/${pk.n}명 자리 잡음`;
    $('#tpCols').innerHTML = ids.map(t => teamCol(t, members[t], pk.seats[t])).join('');
    $('#bMore').onclick = () => { pk.deadline += 10000; scheduleSync(); render(); };
    $('#bClose').onclick = closePick;
    return;
  }
  // 편집(교사 지정 · 마감 뒤 고치기)
  const members = Object.fromEntries(ids.map(t => [t, []]));
  const pool = [];
  const all = new Set([...present().filter(p => p.on).map(p => p.uid), ...Object.keys(H.draft || {})]);
  if (!H.draft) H.draft = Object.fromEntries(Object.entries(H.roster).map(([u, r]) => [u, r.team]));
  for (const u of all) { const t = H.draft[u]; if (t && members[t]) members[t].push(u); else pool.push(u); }
  const sizes = ids.map(t => members[t].length);
  const unbalanced = sizes.length && Math.max(...sizes) - Math.min(...sizes) > 1;
  const sortNum = arr => arr.sort((a, b) => ((H.players[a] || H.roster[a] || {}).num || 0) - ((H.players[b] || H.roster[b] || {}).num || 0));
  const filled = new Set(pk.filled || []);
  H.screenKey = 'edit';
  stage.innerHTML = `
  <div class="tp">
    <div class="tp-top">
      <div><div class="eyebrow">${pk.result ? '팀 고르기 결과' : '팀 정하기'}</div>
      <h1 class="title">${pk.result ? '팀 완성! 고칠 곳이 있으면 번호를 옮겨요' : '번호를 끌어다 팀에 넣어요'}</h1></div>
      <div class="tp-tools">
        <button class="btn ghost" id="bFewer" ${ids.length <= 2 ? 'disabled' : ''}>팀 −</button>
        <span class="num tp-k">${ids.length}팀</span>
        <button class="btn ghost" id="bMoreT" ${ids.length >= 8 ? 'disabled' : ''}>팀 +</button>
        <button class="btn ghost" id="bShuf">${Object.keys(H.draft || {}).length ? '다시 섞기' : '무작위로 나누기'}</button>
      </div>
    </div>
    <div class="tp-cols" style="--n:${ids.length + (pool.length ? 1 : 0)}">
      ${pool.length ? `<div class="tcol pool" data-tid="pool"><div class="tcol-h">아직 팀 없음 <b class="num">${pool.length}</b></div>
        <div class="tcol-b">${sortNum(pool).map(u => chip(u)).join('')}</div></div>` : ''}
      ${ids.map(t => { const T = H.teams[t]; return `
        <div class="tcol" data-tid="${t}" style="--tf:${T.fill};--tt:${T.tint};--tx:${T.text}">
          <button class="tcol-h" data-tid="${t}">${T.emoji} ${esc(T.name)} <b class="num">${members[t].length}</b></button>
          <div class="tcol-b">${sortNum(members[t]).map(u => chip(u, filled.has(u) ? 'rnd' : '')).join('')}</div>
        </div>`; }).join('')}
    </div>
    <div class="tp-foot">
      <button class="btn big" id="bOK">이대로 확정 ▶</button>
      <span class="${unbalanced ? 'warn' : 'dim'}">${unbalanced ? '⚠ 팀 인원 차이가 2명 이상이에요' : pool.length ? `팀 없는 ${pool.length}명은 확정할 때 작은 팀에 들어가요` : (pk.result ? '🎲 = 빈자리에 무작위로 들어간 사람' : '번호를 누르고 팀 이름을 눌러도 옮겨져요')}</span>
    </div>
  </div>`;
  $('#bOK').onclick = confirmTeams;
  $('#bShuf').onclick = shuffleDraft;
  $('#bFewer').onclick = () => changeTeamCount(-1);
  $('#bMoreT').onclick = () => changeTeamCount(1);
  stage.querySelectorAll('.chip').forEach(c => {
    c.onclick = () => { H.sel = H.sel === c.dataset.uid ? null : c.dataset.uid; render(); };
    c.ondragstart = e => { e.dataTransfer.setData('text/plain', c.dataset.uid); };
  });
  stage.querySelectorAll('.tcol').forEach(col => {
    col.ondragover = e => { e.preventDefault(); col.classList.add('over'); };
    col.ondragleave = () => col.classList.remove('over');
    col.ondrop = e => { e.preventDefault(); const u = e.dataTransfer.getData('text/plain'); if (u) moveDraft(u, col.dataset.tid); };
  });
  stage.querySelectorAll('.tcol-h[data-tid]').forEach(h => { h.onclick = () => { if (H.sel) moveDraft(H.sel, h.dataset.tid); }; });
}

function teamCol(t, members, seats) {
  const T = H.teams[t];
  return `<div class="tcol ${seats === 0 ? 'full' : ''}" style="--tf:${T.fill};--tt:${T.tint};--tx:${T.text}">
    <div class="tcol-h">${T.emoji} ${esc(T.name)}</div>
    <div class="tcol-seat">${seats === 0 ? '🔒 꽉 참' : `남은 자리 <b class="num">${seats}</b>`}</div>
    <div class="tcol-b">${members.map(u => chip(u)).join('')}</div>
  </div>`;
}

function renderGame() {
  const p = plugin();
  if (!p) { H.meta.phase = 'result'; return render(); }
  const intro = H.core.intro;
  if (intro) {
    const secs = Math.max(0, Math.ceil((intro.until - now()) / 1000));
    if (setScreen('intro-' + H.gid + H.gameNo, `
      <div class="intro">
        <div class="intro-art" aria-hidden="true">${introArt(p)}</div>
        <div class="intro-txt">
          <div class="eyebrow">${p.lesson ? p.lesson + '차시 · ' : ''}다음 게임</div>
          <h1 class="hero">${p.emoji || ''} ${esc(p.intro ? p.intro.headline : p.title)}</h1>
          <ol class="intro-lines">${((p.intro && p.intro.lines) || []).map(l => `<li>${l}</li>`).join('')}</ol>
          <div class="intro-go"><div class="intro-count num" id="introN"></div><button class="btn big" id="bGo">바로 시작 ▶</button></div>
        </div>
      </div>`)) $('#bGo').onclick = () => { H.core.intro.until = now(); };
    $('#introN').textContent = secs;
    if (secs === 0) beginGame();
    return;
  }
  if (!H.g) return;
  if (setScreen('game-' + H.gid + H.gameNo, `<div class="gwrap"><div class="game" id="gameEl"></div><div class="proxy" id="proxyEl"></div></div>`)) { /* 새 판 */ }
  const el = $('#gameEl');
  try { p.hostView(el, H.g, gctx()); }
  catch (e) { console.error(e); el.innerHTML = `<p class="errbox">게임 화면 오류: ${esc(e.message)}</p>`; }
  renderProxy();
}

function renderProxy() {
  const box = $('#proxyEl');
  if (!box) return;
  const p = plugin();
  const show = (H.offline || H.proxyOn) && p.proxyButtons;
  if (!show) { box.innerHTML = ''; box.dataset.k = ''; return; }
  const k = fullKey(H.g.inputKey);
  const rows = teamList().map(t => ({ t, btns: p.proxyButtons(H.g, t, gctx()) || [] })).filter(r => r.btns.length);
  const key = JSON.stringify([k, rows.map(r => [r.t.id, r.btns.map(b => b.label)]), H.proxy[k]]);
  if (box.dataset.k === key) return;
  box.dataset.k = key;
  if (!rows.length) { box.innerHTML = ''; return; }
  const mine = (k && H.proxy[k]) || {};
  box.innerHTML = `<div class="proxy-h">대신 누르기 <span class="dim">— 팀이 말하는 대로 교사가 누른다</span></div>
    <div class="proxy-rows">${rows.map(({ t, btns }) => {
      const cur = mine['proxy-' + t.id] || {};
      return `<div class="proxy-row" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}"><span class="proxy-t">${t.emoji} ${esc(t.name)}</span>
        ${btns.map((b, i) => { const on = Object.entries(b.input).every(([kk, v]) => cur[kk] === v); return `<button class="pbtn ${on ? 'on' : ''}" data-t="${t.id}" data-i="${i}" ${b.once && on ? 'disabled' : ''}>${esc(b.label)}</button>`; }).join('')}</div>`;
    }).join('')}</div>`;
  box.querySelectorAll('.pbtn').forEach(b => {
    b.onclick = () => {
      const t = teamList().find(x => x.id === b.dataset.t);
      const btn = (p.proxyButtons(H.g, t, gctx()) || [])[Number(b.dataset.i)];
      if (btn) proxyPress(t.id, btn);
    };
  });
}

function introArt(p) {
  const arts = {
    yeast: '<div class="art-row"><span>🦠</span><span class="plus">+</span><span>🍚</span><span class="plus">+</span><span>💧</span></div><div class="art-big">🎈</div><div class="art-cap">효모 · 설탕 · 물 → 풍선</div>',
    kimchi: '<div class="art-big">🥬</div><div class="art-row"><span>🧊 4℃</span><span class="plus">·</span><span>🏠 20℃</span><span class="plus">·</span><span>⚡ ?</span></div><div class="art-cap">언제 꺼낼까?</div>',
  };
  const a = p.intro && p.intro.art;
  if (a && arts[a]) return arts[a];
  if (a && a.includes('<')) return a;       // 플러그인이 직접 준 SVG · HTML
  return `<div class="art-big">${p.emoji || '🎮'}</div>`;
}

function scoreRows(gained) {
  const ids = teamIds();
  const scores = Object.fromEntries(ids.map(id => [id, H.teams[id].score]));
  const { rank } = rankPoints(scores, true);
  const max = Math.max(1, ...Object.values(scores));
  return ids.slice().sort((a, b) => rank[a] - rank[b]).map((id, i) => {
    const t = H.teams[id], g = gained ? gained[id] || 0 : 0;
    const before = t.score - g;
    return `<div class="sb-row" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text};animation-delay:${(i * 0.05).toFixed(2)}s">
      <span class="sb-rk">${medal(rank[id])}</span><span class="sb-n">${t.emoji} ${esc(t.name)}</span>
      <span class="sb-bar"><i class="sb-old" style="width:${(before / max * 100).toFixed(1)}%"></i><i class="sb-new" style="width:${(g / max * 100).toFixed(1)}%"></i></span>
      <b class="sb-v num">${t.score}</b>${gained ? `<span class="sb-g num">${g ? '+' + g : ''}</span>` : ''}
    </div>`;
  }).join('');
}

function renderHub() {
  const last = H.core.last;
  const recs = ls.get(LS_REC, {});
  // 차시별 묶음: 고른 차시(없으면 지난번에 한 게임의 차시 → 첫 차시)만 크게 보인다
  const lessons = [...new Set(GAMES.map(g => g.lesson || 0))].sort((a, b) => a - b);
  let cur = H.lessonSel ?? ls.get(LS_PREF, {}).lesson ?? lessons[0];
  if (!lessons.includes(cur)) cur = lessons[0];
  const shown = GAMES.filter(g => (g.lesson || 0) === cur);
  const others = GAMES.filter(g => (g.lesson || 0) !== cur);      // 다른 차시 게임도 작게 — 바로 고를 수 있게
  const key = 'hub-' + (last ? last.gid + H.gameNo : 'none') + '-' + teamIds().join() + '-' + teamIds().map(t => H.teams[t].score).join() + '-' + Object.keys(H.roster).length + '-L' + cur;
  if (H.screenKey === key) return;
  setScreen(key, `
  <div class="hub">
    <div class="hub-l">
      <div class="eyebrow">${last ? `${esc(last.emoji || '')} ${esc(last.title)} 결과` : '팀 완성'}</div>
      <h1 class="title">${last ? '누적 팀 점수' : '우리 반 팀들 — 게임을 골라요!'}</h1>
      ${last && last.lines && last.lines.length ? `<div class="hub-lines">${last.lines.map(l => `<p>${l}</p>`).join('')}</div>` : ''}
      ${last && last.rec ? `<p class="recbox">${last.rec.best ? '🏆 <b>반 대항 신기록!</b>' : '반 대항 기록'} ${esc(last.rec.label)}: ${esc(last.rec.cls)}반 ${last.rec.emoji} ${esc(last.rec.team)} <b class="num">${last.rec.value}${esc(last.rec.unit)}</b>${!last.rec.best && last.rec.prevBest != null ? ` (최고 ${last.rec.prevBest}${esc(last.rec.unit)})` : ''}</p>` : ''}
      <div class="sb">${scoreRows(last ? last.gained : null)}</div>
      ${!last ? `<div class="hub-members">${teamIds().map(id => { const t = H.teams[id]; const nums = Object.values(H.roster).filter(r => r.team === id).map(r => r.num).sort((a, b) => a - b); return `<span class="gk-tag" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}">${t.emoji} ${esc(t.name)} · ${nums.join(' ') || (H.offline ? '대신 누르기' : '—')}</span>`; }).join('')}</div>` : ''}
    </div>
    <div class="hub-r">
      <div class="lbl">게임 고르기</div>
      ${lessons.length > 1 ? `<div class="ltabs" role="tablist">${lessons.map(n => `<button class="ltab ${n === cur ? 'on' : ''}" role="tab" aria-selected="${n === cur}" data-lesson="${n}">${n ? n + '차시' : '기타'} <small class="num">${GAMES.filter(g => (g.lesson || 0) === n).length}</small></button>`).join('')}</div>` : ''}
      <div class="games ${shown.length >= 4 ? 'two' : ''}">${shown.map(g => {
        const r = (recs[g.id] || [])[0];
        return `<button class="gcard" data-gid="${g.id}">
          <span class="gc-e">${g.emoji || '🎮'}</span>
          <span class="gc-t">${esc(g.title)}</span>
          <span class="gc-b">${esc(g.blurb || '')}</span>
          <span class="gc-m">${g.lesson ? g.lesson + '차시 · ' : ''}약 ${g.minutes || 3}분${r ? ` · 기록 ${r.value}${esc(r.unit)} (${esc(r.cls)})` : ''}</span>
        </button>`; }).join('')}</div>
      ${others.length ? `<div class="gmini"><span class="gmini-l">다른 차시</span>${others.map(g => `<button class="gcard mini" data-gid="${g.id}" title="${esc(g.blurb || '')}"><span class="gc-e">${g.emoji || '🎮'}</span><span class="gc-t">${esc(g.title)}</span><small>${g.lesson ? g.lesson + '차시' : ''}</small></button>`).join('')}</div>` : ''}
      <div class="hub-tools">
        ${H.offline ? '' : '<button class="btn ghost" id="bFix">팀 고치기</button>'}
        ${H.offline ? '' : '<button class="btn ghost" id="bRedo">팀 처음부터</button>'}
        <button class="btn ghost" id="bEnd">수업 끝 ▶</button>
      </div>
    </div>
  </div>`);
  stage.querySelectorAll('.gcard').forEach(b => b.onclick = () => startGame(b.dataset.gid));
  stage.querySelectorAll('.ltab').forEach(b => b.onclick = () => {
    H.lessonSel = Number(b.dataset.lesson);
    const pr = ls.get(LS_PREF, {}); pr.lesson = H.lessonSel; ls.set(LS_PREF, pr);
    renderHub();
  });
  if ($('#bFix')) $('#bFix').onclick = () => openTeamPick(false);
  if ($('#bRedo')) $('#bRedo').onclick = () => { if (confirm('팀을 처음부터 다시 정할까요? 팀 점수가 0으로 돌아가요.')) openTeamPick(true); };
  $('#bEnd').onclick = endClass;
}

function renderEnd() {
  const f = H.core.final || { rank: {}, scores: {} };
  const ids = teamIds().slice().sort((a, b) => (f.rank[a] || 99) - (f.rank[b] || 99));
  const pod = ids.filter(id => f.rank[id] <= 3);
  const rest = ids.filter(id => f.rank[id] > 3);
  setScreen('end', `
  <div class="end">
    <div class="eyebrow">${esc(H.meta.cls)}반 · 최종 순위</div>
    <h1 class="hero">생명 기술 대작전 — 시상식 🏆</h1>
    <div class="podium">${[1, 0, 2].map(i => pod[i]).filter(Boolean).map(id => {
      const t = H.teams[id], r = f.rank[id];
      return `<div class="pod p${r}" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}">
        <div class="pod-e">${t.emoji}</div><div class="pod-n">${esc(t.name)}</div><div class="pod-s num">${t.score}점</div>
        <div class="pod-b"><span>${medal(r)}</span></div></div>`; }).join('')}</div>
    ${rest.length ? `<div class="rest">${rest.map(id => { const t = H.teams[id]; return `<span class="gk-tag" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}">${f.rank[id]}위 ${t.emoji} ${esc(t.name)} ${t.score}점</span>`; }).join('')}</div>` : ''}
    <p class="lead">모두 수고했어요! 오늘 배운 것: 살아 있는 생물이 일하는 기술 = <b>생명 기술</b></p>
    <div class="end-tools"><button class="btn ghost" id="bBack">점수판으로 돌아가기</button><button class="btn big" id="bCloseRoom">방 닫고 끝내기</button></div>
  </div>`);
  $('#bBack').onclick = () => { H.core = { hub: { formed: true } }; setMeta({ phase: 'result' }); scheduleSync(); render(); };
  $('#bCloseRoom').onclick = closeRoom;
}

// ── 알림 ────────────────────────────────────────────────────────
function toast(msg, bad = false) {
  const box = $('#toasts');
  const ms = bad ? 6000 : 3500;
  // 같은 글이 떠 있으면 새로 쌓지 않고 「×2」로 세고 시간을 늘린다
  const same = [...box.children].find(x => x.dataset.msg === msg);
  if (same) {
    same.dataset.n = String(Number(same.dataset.n || 1) + 1);
    same.querySelector('.toast-n').textContent = '×' + same.dataset.n;
    clearTimeout(same.__t); same.__t = setTimeout(() => same.remove(), ms);
    return;
  }
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.dataset.msg = msg;
  t.append(msg);
  const n = document.createElement('span'); n.className = 'toast-n'; t.appendChild(n);
  box.appendChild(t);
  while (box.children.length > 3) box.firstElementChild.remove();
  t.__t = setTimeout(() => t.remove(), ms);
}

// ── 0.2초마다: 게임 진행 · 초시계 ──────────────────────────────────
setInterval(() => {
  if (!H.meta) return;
  const ph = H.meta.phase;
  if (ph === 'game') {
    const p = plugin();
    const paused = online() && (!H.connected || Date.now() < (H.resumeAt || 0));   // 끊긴 동안은 판정을 멈춘다
    if (H.g && p && p.tick && !paused) {
      const g2 = p.tick(H.g, gctx());
      if (g2 !== H.g) { H.g = g2; afterGame(false); if (!H.g) return; }
    }
    render();
  } else if (ph === 'teampick' && H.core.pick && H.core.pick.open) {
    render();
  } else {
    renderBar();
  }
}, 200);

window.addEventListener('beforeunload', e => {
  if (H.meta && H.meta.phase !== 'end' && (H.code || H.offline)) { saveSnap(); e.preventDefault(); e.returnValue = ''; }
});

boot();
