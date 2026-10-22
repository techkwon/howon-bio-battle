// 조종기(학생 크롬북) — 방 코드 + 번호로 들어와 큰 버튼만 누른다. 판정은 하지 않는다.
import { connectNet } from './net.js';
import { esc, parseJSON, rankPoints, MAX_NUM, devTag } from './shared.js';
import { medal } from './gamekit.js';
import GAMES from '../games/index.js';

const $ = s => document.querySelector(s);
const main = $('#main');
const LS = 'bb.play';
const ls = {
  get(d = null) { try { return JSON.parse(localStorage.getItem(LS)) || d; } catch { return d; } },
  set(v) { try { localStorage.setItem(LS, JSON.stringify(v)); } catch {} },
  del() { try { localStorage.removeItem(LS); } catch {} },
};

const P = {
  net: null, netP: null, connected: false,
  code: null, num: null, joinedAt: null, joined: false,
  kicked: null, ended: false,
  meta: null, teams: {}, team: null, core: {}, g: {}, inputKey: null, mine: null,
  offs: [], mineOff: null, err: '', screen: '',
};
window.__bbPlay = P; // 시험 · 점검용

function connect() {
  if (!P.netP) {
    P.netP = connectNet().then(n => {
      P.net = n;
      n.onConnected(c => { P.connected = c; if (c) presence(); renderBar(); });
      return n;
    }).catch(e => { P.netP = null; throw e; });
  }
  return P.netP;
}

const myPath = () => `rooms/${P.code}/players/${P.net.uid}`;
const room = p => `rooms/${P.code}/${p}`;
const plugin = () => P.meta && GAMES.find(g => g.id === P.meta.game);

function presence() {
  if (!P.joined || P.kicked || P.ended || !P.net) return;
  P.net.onDisconnectUpdate(myPath(), { on: false, last: P.net.TS }).catch(() => {});
  P.net.update(myPath(), { on: true, last: P.net.TS }).catch(() => {});
}

// ── 들어가기 ──
async function join(code, num, auto = false) {
  P.err = '';
  if (!/^\d{4}$/.test(code)) { P.err = '방 코드는 숫자 4자리예요'; return renderJoin(); }
  if (!(Number.isInteger(num) && num >= 1 && num <= MAX_NUM)) { P.err = `번호는 1~${MAX_NUM} 사이예요`; return renderJoin(); }
  P.screen = ''; main.innerHTML = `<div class="pv-center"><div class="pv-big">${auto ? '다시 들어가는 중…' : '들어가는 중…'}</div></div>`;
  try {
    const net = await connect();
    const meta = await net.withTimeout(net.get(`rooms/${code}/meta`), 10000, '방 찾기');
    if (!meta) { P.err = '그런 방이 없어요. 화면의 방 코드를 다시 보세요'; if (auto) ls.del(); return renderJoin(); }
    leave();
    P.code = code; P.num = num; P.kicked = null; P.ended = false;
    // 순서가 중요하다: ① 「끊김」 상태로 자리를 만들고 ② 끊김 처리를 건 뒤 ③ 「접속」으로 바꾼다.
    // (Firebase 는 onDisconnect 를 걸 때 규칙을 검사한다 — 자리(num)가 없으면 거절된다)
    await net.withTimeout(net.set(myPath(), { num, joinedAt: net.TS, on: false, last: net.TS }), 10000, '들어가기');
    await net.withTimeout(net.onDisconnectUpdate(myPath(), { on: false, last: net.TS }), 10000, '끊김 처리');
    await net.withTimeout(net.update(myPath(), { on: true, last: net.TS }), 10000, '접속 표시');
    P.joinedAt = await net.withTimeout(net.get(myPath() + '/joinedAt'), 10000, '확인');
    P.joined = true;
    ls.set({ code, num, at: Date.now() });
    net.onDisconnectUpdate(myPath(), { on: false, last: net.TS }).catch(() => {});
    subscribe();
    render();
  } catch (e) {
    P.err = /PERMISSION/i.test(e.code || e.message || '') ? '들어갈 수 없어요(방이 닫혔거나 권한 문제). 선생님께 알려 주세요' : '연결이 안 돼요. 와이파이를 확인하고 다시 눌러 주세요';
    renderJoin();
  }
}

function leave() {
  for (const off of P.offs) off();
  P.offs = [];
  if (P.mineOff) { P.mineOff(); P.mineOff = null; }
  P.joined = false;
  P.meta = null; P.teams = {}; P.team = null; P.core = {}; P.g = {}; P.inputKey = null; P.mine = null; P.myPick = null;
}

function subscribe() {
  const n = P.net, on = (p, cb) => P.offs.push(n.on(room(p), cb, () => {}));
  on('meta', v => {
    if (!v && P.joined) { P.ended = true; ls.del(); n.onDisconnectCancel(myPath()).catch(() => {}); }
    P.meta = v; render();
  });
  on('teams', v => { P.teams = v || {}; render(); });
  on(`roster/${n.uid}`, v => { P.team = v ? v.team : null; render(); });
  on('state/c', v => { P.core = parseJSON(v, {}) || {}; render(); });
  on('state/g', v => {
    const g = {};
    for (const [k, s] of Object.entries(v || {})) g[k] = parseJSON(s);
    P.g = g; render();
  });
  on('state/inputKey', v => {
    if (v === P.inputKey) return;
    P.inputKey = v || null; P.mine = null;
    if (P.mineOff) { P.mineOff(); P.mineOff = null; }
    if (P.inputKey) P.mineOff = n.on(room(`inputs/${P.inputKey}/${n.uid}`), m => { P.mine = m || null; render(); }, () => {});
    render();
  });
  on(`kick/${n.uid}`, v => {
    if (v && v.at === P.joinedAt) {
      P.kicked = v.why || 'dup';
      n.onDisconnectCancel(myPath()).catch(() => {});
      render();
    }
  });
}

function send(input) {
  if (!P.inputKey || !P.joined || P.kicked) return;
  const clean = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (k === 't' || k.length > 20) continue;
    if (typeof v === 'number' || typeof v === 'boolean') clean[k] = v;
    else if (typeof v === 'string') clean[k] = v.slice(0, 200);
  }
  const key = P.inputKey, before = P.mine;
  P.mine = { ...clean };
  render();
  P.net.set(room(`inputs/${key}/${P.net.uid}`), { ...clean, t: P.net.TS })
    .catch(e => { if (P.inputKey === key) { P.mine = before; P.screen = ''; render(); } toast(/PERMISSION/i.test(e.code || e.message) ? '지금은 낼 수 없어요(시간이 끝났어요)' : '보내지 못했어요. 다시 눌러 주세요'); });
}

// ── 그리기 ──
function renderBar() {
  const t = P.team && P.teams[P.team];
  $('#bar').innerHTML = `
    <span class="b-title">🧬 생명 기술 대작전</span>
    ${P.joined ? `<span class="b-chip strong"><b class="num">${P.num}</b>번</span>` : ''}
    ${t ? `<span class="gk-tag" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}">${t.emoji} ${esc(t.name)}</span>` : ''}
    <span class="b-sp"></span>
    ${P.joined ? `<span class="b-conn ${P.connected ? 'ok' : 'bad'}"><i></i>${P.connected ? '연결됨' : '끊김 — 다시 연결 중'}</span>` : ''}
    ${P.net && P.net.uid ? `<span class="b-dev" title="같은 번호가 두 기기일 때 선생님이 이 글자로 구분해요">기기 ${devTag(P.net.uid)}</span>` : ''}`;
}

function setScreen(key, html) {
  if (P.screen === key) return false;
  P.screen = key; main.innerHTML = html; return true;
}

function renderJoin() {
  P.screen = 'join';
  renderBar();
  const saved = ls.get();
  main.innerHTML = `
  <form class="join card" id="joinF" autocomplete="off">
    <h1 class="title">들어가기</h1>
    <label class="jl">방 코드 <span class="dim">(화면의 숫자 4자리)</span>
      <input id="iCode" class="jin num" inputmode="numeric" maxlength="4" pattern="[0-9]*" value="${esc(P.code || (saved && saved.code) || '')}" aria-label="방 코드"></label>
    <label class="jl">내 번호 <span class="dim">(1~${MAX_NUM})</span>
      <input id="iNum" class="jin num" inputmode="numeric" maxlength="2" pattern="[0-9]*" value="${esc(P.num || (saved && saved.num) || '')}" aria-label="내 번호"></label>
    <button class="btn big" type="submit">들어가기 ▶</button>
    <p class="errbox" ${P.err ? '' : 'hidden'}>${esc(P.err)}</p>
    <p class="dim small">이름은 넣지 않아요. 번호만!</p>
  </form>`;
  $('#joinF').onsubmit = e => {
    e.preventDefault();
    join($('#iCode').value.trim(), Number($('#iNum').value.trim()));
  };
  (P.code ? $('#iNum') : $('#iCode')).focus();
}

function render() {
  renderBar();
  if (!P.joined) return;
  if (P.kicked) {
    return setScreen('kicked', `
    <div class="pv-center">
      <div class="pv-huge">📵</div>
      <div class="pv-big">${P.kicked === 'host' ? '선생님이 이 기기를 내보냈어요' : `다른 기기에서 ${P.num}번으로 들어왔어요`}</div>
      <p class="pv-sub">내 번호가 맞나요? 맞으면 다시 들어가고, 틀리면 번호를 고쳐요.</p>
      <div class="pv-row"><button class="btn big" id="bRe">${P.num}번으로 다시 들어가기</button><button class="btn ghost" id="bNum">번호 고치기</button></div>
    </div>`) && bindKicked();
  }
  if (P.ended || !P.meta) {
    return setScreen('ended', `<div class="pv-center"><div class="pv-huge">👋</div><div class="pv-big">수업이 끝났어요. 수고했어요!</div>
      <p class="pv-sub">이 창은 닫아도 돼요.</p></div>`);
  }
  const ph = P.meta.phase;
  const t = P.team && P.teams[P.team];
  if (ph === 'lobby') {
    return setScreen('lobby', `<div class="pv-center"><div class="pv-eyebrow">연결됨 ✅</div><div class="pv-huge num">${P.num}번</div>
      <div class="pv-big">선생님 화면을 보세요</div><p class="pv-sub">곧 팀을 정해요</p></div>`);
  }
  if (ph === 'teampick') return renderPick();
  if (ph === 'game') return renderGame(t);
  if (ph === 'result') return renderHub(t);
  if (ph === 'end') return renderEnd(t);
}

function bindKicked() {
  $('#bRe').onclick = () => join(P.code, P.num);
  $('#bNum').onclick = () => { const c = P.code; leave(); P.code = c; P.num = null; P.kicked = null; renderJoin(); };
  return true;
}

function renderPick() {
  const pk = P.core.pick || {};
  const uid = P.net.uid;
  if (pk.open) {
    const ids = pk.teamIds || [];
    if (P.pickOpen !== pk.openedAt) { P.pickOpen = pk.openedAt; P.myPick = null; }
    const mineT = (pk.got || {})[uid];
    const want = P.myPick;
    const key = 'pick-' + JSON.stringify([pk.seats, mineT, want]);
    if (P.screen === key) return;
    P.screen = key;
    main.innerHTML = `
    <div class="pk">
      <div class="pv-eyebrow">팀 고르기 · 먼저 누른 순서</div>
      <h1 class="title">${mineT ? `✅ ${esc(P.teams[mineT].emoji)} ${esc(P.teams[mineT].name)}에 자리 잡았어요!` : want ? '😮 그 팀은 자리가 찼어요 — 다른 팀을 골라요' : '들어갈 팀을 눌러요!'}</h1>
      <div class="pk-grid" style="--n:${Math.min(ids.length, 4)}">
        ${ids.map(t => {
          const T = P.teams[t] || {}; const seats = (pk.seats || {})[t] ?? 0; const me = mineT === t;
          const locked = seats === 0 && !me;
          return `<button class="pk-btn ${me ? 'on' : ''} ${locked ? 'locked' : ''}" data-t="${t}" ${locked ? 'disabled' : ''}
            style="--tf:${T.fill};--tt:${T.tint};--tx:${T.text}" aria-pressed="${me}">
            <span class="pk-e">${T.emoji}</span><b>${esc(T.name)}</b>
            <span class="pk-s">${me ? '✓ 내 자리' : locked ? '🔒 꽉 참' : `남은 자리 ${seats}`}</span></button>`;
        }).join('')}
      </div>
      <p class="pv-sub dim">못 고르면 빈자리에 무작위로 들어가요. 바꾸면 다시 줄을 서요.</p>
    </div>`;
    main.querySelectorAll('.pk-btn').forEach(b => b.onclick = () => {
      if (mineT === b.dataset.t) return;
      P.myPick = b.dataset.t;
      P.net.update(`rooms/${P.code}/players/${uid}`, { pick: b.dataset.t, pickAt: P.net.TS }).catch(() => toast('보내지 못했어요. 다시 눌러 주세요'));
      P.screen = ''; renderPick();
    });
    return;
  }
  const r = pk.result && pk.result[uid];
  const T = r && P.teams[r];
  const rnd = (pk.filled || []).includes(uid);
  setScreen('pick-closed-' + r + rnd, T ? `
    <div class="pv-center"><div class="pv-eyebrow">${rnd ? '🎲 무작위로 들어갔어요' : '자리 잡기 성공'}</div>
      <div class="team-card" style="--tf:${T.fill};--tt:${T.tint};--tx:${T.text}"><span>${T.emoji}</span><b>${esc(T.name)}</b></div>
      <p class="pv-sub">선생님이 확정하면 시작해요</p></div>` :
    `<div class="pv-center"><div class="pv-huge">🧑‍🏫</div><div class="pv-big">선생님이 팀을 정하고 있어요</div><p class="pv-sub">잠시만 기다려요</p></div>`);
}

function renderGame(t) {
  const p = plugin();
  if (!p) return setScreen('nog', `<div class="pv-center"><div class="pv-big">게임을 불러오지 못했어요</div><p class="pv-sub">새로 고침(F5) 해 보세요</p></div>`);
  if (!t) return setScreen('noteam', `<div class="pv-center"><div class="pv-big">팀 배정을 기다리는 중…</div><p class="pv-sub">선생님 화면을 보세요</p></div>`);
  if (P.core.intro) {
    return setScreen('intro-' + p.id + P.meta.round, `<div class="pv-center">
      <div class="pv-eyebrow">준비!</div><div class="pv-huge">${p.emoji || '🎮'}</div><div class="pv-big">${esc(p.title)}</div>
      <ol class="pv-lines">${((p.intro && p.intro.lines) || []).map(l => `<li>${l}</li>`).join('')}</ol></div>`);
  }
  if (!P.g || !P.g.step) return setScreen('wait', `<div class="pv-center"><div class="pv-big">곧 시작해요…</div></div>`);
  if (setScreen('game-' + p.id + P.meta.round, '<div class="gp" id="gp"></div>')) { /* 새 판 */ }
  const el = $('#gp');
  try {
    p.playView(el, P.g, { uid: P.net.uid, num: P.num, team: P.team, mine: P.mine }, {
      now: () => P.net.serverNow(), send, teams: P.teams, team: t,
    });
  } catch (e) { console.error(e); el.innerHTML = `<p class="errbox">화면 오류: ${esc(e.message)}</p>`; }
}

function myRank() {
  const scores = Object.fromEntries(Object.entries(P.teams).map(([id, t]) => [id, t.score || 0]));
  return rankPoints(scores, true).rank[P.team];
}

function renderHub(t) {
  const last = P.core.last;
  if (!t) return setScreen('hub-none', `<div class="pv-center"><div class="pv-big">팀 배정을 기다리는 중…</div></div>`);
  const g = last && last.gained ? last.gained[P.team] : null;
  setScreen('hub-' + P.team + (t.score || 0) + (last ? last.gid : ''), `
    <div class="pv-center">
      <div class="pv-eyebrow">${last ? esc(last.title) + ' 끝!' : '우리 팀'}</div>
      <div class="team-card" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}"><span>${t.emoji}</span><b>${esc(t.name)}</b></div>
      <div class="pv-big num">${g != null ? `이번 +${g}점 · ` : ''}누적 ${t.score || 0}점 · ${medal(myRank())}</div>
      <p class="pv-sub">다음 게임을 기다려요 — 화면을 보세요</p>
    </div>`);
}

function renderEnd(t) {
  if (!t) return setScreen('end-none', `<div class="pv-center"><div class="pv-big">수고했어요!</div></div>`);
  const r = (P.core.final && P.core.final.rank && P.core.final.rank[P.team]) || myRank();
  setScreen('end-' + r, `<div class="pv-center"><div class="pv-eyebrow">최종 순위</div><div class="pv-huge">${medal(r)}</div>
    <div class="team-card" style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}"><span>${t.emoji}</span><b>${esc(t.name)}</b></div>
    <div class="pv-big num">${t.score || 0}점 — 수고했어요!</div></div>`);
}

function toast(msg) {
  const box = $('#toasts');
  const same = [...box.children].find(x => x.dataset.msg === msg);
  if (same) { clearTimeout(same.__t); same.__t = setTimeout(() => same.remove(), 4000); return; }
  const d = document.createElement('div');
  d.className = 'toast bad'; d.textContent = msg; d.dataset.msg = msg;
  box.appendChild(d);
  d.__t = setTimeout(() => d.remove(), 4000);
}

// 초시계 갱신용 (게임 화면만)
setInterval(() => { if (P.joined && P.meta && P.meta.phase === 'game' && !P.kicked) renderGame(P.team && P.teams[P.team]); }, 250);

// ── 시작: 저장된 방이 있으면 다시 들어간다(새로 고침 · 잠깐 끊김) ──
const saved = ls.get();
const q = new URLSearchParams(location.search);
if (q.get('code')) P.code = q.get('code').slice(0, 4);
if (saved && Date.now() - saved.at < 3 * 3600 * 1000 && (!P.code || P.code === saved.code)) {
  P.code = saved.code; P.num = saved.num;
  join(saved.code, saved.num, true);
} else {
  renderJoin();
  connect().catch(() => {});
}
