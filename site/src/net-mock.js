// 시험용 가짜 DB 연결 (test/mockdb.mjs). 실제 수업에서는 쓰지 않는다.
// ?mock=http://127.0.0.1:8787 처럼 localhost 주소만 받는다.
// Firebase 와 같은 모양: 실시간 구독 · 서버 시간 · 접속 끊김 처리 · 보안 규칙(서버가 database.rules.json 으로 판정)

export async function connectMock(base) {
  const u = new URL(base);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('mock 은 localhost 만');
  base = u.origin;
  const KEY = 'bb.mock.uid';
  let uid = null;
  try { uid = localStorage.getItem(KEY); } catch {}
  const auth = await (await fetch(base + '/auth', { method: 'POST', body: JSON.stringify({ uid }) })).json();
  uid = auth.uid;
  try { localStorage.setItem(KEY, uid); } catch {}

  let offset = 0, cid = null, connected = false, es = null;
  const subs = new Map();          // sid → {path, cb, last}
  const connCbs = new Set();
  let sidSeq = 0;

  async function op(body) {
    // 끊겨 있으면 다시 붙을 때까지 기다렸다가 보낸다(Firebase 의 쓰기 대기열처럼)
    for (let i = 0; ; i++) {
      if (!cid) { await new Promise(r => setTimeout(r, 200)); if (i > 600) throw new Error('mock 연결 안 됨'); continue; }
      try {
        const res = await fetch(base + '/op', { method: 'POST', body: JSON.stringify({ ...body, cid, uid }) });
        const j = await res.json();
        if (j.error === 'NO_CONN') { cid = null; continue; }
        if (j.error) { const e = new Error(j.error); e.code = j.error; throw e; }
        return j.val;
      } catch (e) {
        if (e.code) throw e;
        await new Promise(r => setTimeout(r, 300));
        if (i > 600) throw e;
      }
    }
  }

  // 쓰기는 보낸 순서대로 하나씩(Firebase 처럼). 동시에 보내면 HTTP 요청이 앞뒤가 바뀌어 앞의 값이 뒤의 값을 덮을 수 있다
  let wq = Promise.resolve();
  function wop(body) {
    const p = wq.then(() => op(body));
    wq = p.catch(() => {});
    return p;
  }

  function setConnected(v) {
    if (connected === v) return;
    connected = v;
    for (const cb of connCbs) cb(v);
  }

  function open() {
    const myCid = Math.random().toString(36).slice(2);
    es = new EventSource(`${base}/events?uid=${encodeURIComponent(uid)}&cid=${myCid}`);
    es.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.type === 'hello') {
        offset = m.now - Date.now();
        cid = myCid;
        for (const [sid, s] of subs) op({ op: 'sub', sid, path: s.path }).catch(e => s.onErr && s.onErr(e));
        setConnected(true);
      } else if (m.type === 'val') {
        const s = subs.get(m.sid);
        if (s) s.cb(m.val);
      }
    };
    es.onerror = () => {
      cid = null; setConnected(false);
      // EventSource 가 스스로 다시 붙는다. 서버가 닫았으면 새로 연다
      if (es.readyState === 2) setTimeout(open, 500);
    };
  }
  open();

  return {
    kind: 'mock',
    uid,
    TS: { '.sv': 'timestamp' },
    serverNow: () => Date.now() + offset,
    onConnected(cb) { connCbs.add(cb); cb(connected); return () => connCbs.delete(cb); },
    get: p => op({ op: 'get', path: p }),
    set: (p, v) => wop({ op: 'set', path: p, val: v }),
    update: (p, obj) => wop({ op: 'update', path: p, val: obj }),
    remove: p => wop({ op: 'set', path: p, val: null }),
    on(p, cb, onErr) {
      const sid = 's' + (++sidSeq);
      subs.set(sid, { path: p, cb, onErr });
      if (cid) op({ op: 'sub', sid, path: p }).catch(e => onErr && onErr(e));
      return () => { subs.delete(sid); if (cid) op({ op: 'unsub', sid }).catch(() => {}); };
    },
    onDisconnectUpdate: (p, obj) => wop({ op: 'odc', path: p, val: obj }),
    onDisconnectCancel: p => wop({ op: 'odc-cancel', path: p }),
    withTimeout: (pr, ms, what) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error('시간 초과: ' + what)), ms))]),
    _close() { es && es.close(); },
  };
}
