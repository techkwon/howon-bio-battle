// 시험용 가짜 실시간 DB (Firebase 에뮬레이터 대신 — Java 없이 돈다)
// HTTP + Server-Sent Events. site/database.rules.json 을 그대로 읽어 읽기 · 쓰기를 판정한다.
//   node test/mockdb.mjs [--port 8787] [--latency 40]
// 시험 도구용: GET /admin/dump?path=  ·  POST /admin/drop?uid=  (그 uid 연결을 끊는다)  ·  GET /admin/stats
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rules, split, getAt, setAt, resolveTS } from './rules-eval.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

export function startMock({ port = 8787, latency = 0, rulesPath = path.join(here, '../site/database.rules.json'), log = false } = {}) {
  const rules = new Rules(rulesPath);
  let tree = {};
  const conns = new Map();   // cid → {uid, res, subs: Map(sid → {path, last}), odc: []}
  const stats = { ops: 0, denied: 0, pushes: 0, writes: 0, deniedList: [] };
  const delay = () => latency ? new Promise(r => setTimeout(r, latency * (0.5 + Math.random()))) : Promise.resolve();

  function push(conn, sid, val) {
    stats.pushes++;
    conn.res.write(`data: ${JSON.stringify({ type: 'val', sid, val })}\n\n`);
  }
  function related(a, b) {
    const x = split(a), y = split(b);
    const n = Math.min(x.length, y.length);
    for (let i = 0; i < n; i++) if (x[i] !== y[i]) return false;
    return true;
  }
  async function notify(changed) {
    await delay();
    for (const conn of conns.values()) {
      for (const [sid, s] of conn.subs) {
        if (!changed.some(c => related(c, s.path))) continue;
        const v = getAt(tree, split(s.path));
        const j = JSON.stringify(v);
        if (j !== s.last) { s.last = j; push(conn, sid, v); }
      }
    }
  }

  /** writes: [{path, val}] — 한 번에(원자적으로) 적용. 돌려줌: null 또는 거절 까닭 */
  function applyWrites(writes, uid) {
    const now = Date.now();
    const auth = uid ? { uid, provider: 'anonymous' } : null;
    let next = tree;
    for (const w of writes) next = setAt(next, split(w.path), resolveTS(w.val, now));
    for (const w of writes) {
      const why = rules.checkWrite(tree, next, w.path, auth, now);
      if (why) { stats.denied++; stats.deniedList.push({ uid, path: w.path, why }); if (stats.deniedList.length > 200) stats.deniedList.shift(); return why; }
    }
    tree = next;
    stats.writes++;
    notify(writes.map(w => w.path));
    return null;
  }

  function multi(base, obj) {
    return Object.entries(obj || {}).map(([k, v]) => ({ path: [...split(base), ...split(k)].join('/'), val: v }));
  }

  function closeConn(cid) {
    const c = conns.get(cid);
    if (!c) return;
    conns.delete(cid);
    for (const o of c.odc) {
      const why = applyWrites(multi(o.path, o.val), c.uid);
      if (log && why) console.log('[odc denied]', c.uid, o.path, why);
    }
    try { c.res.end(); } catch {}
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const body = () => new Promise(r => { let b = ''; req.on('data', d => b += d); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
    const json = (o, code = 200) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };

    if (u.pathname === '/auth' && req.method === 'POST') {
      const b = await body();
      return json({ uid: (b.uid && /^[A-Za-z0-9]{6,40}$/.test(b.uid)) ? b.uid : 'u' + Math.random().toString(36).slice(2, 14) });
    }
    if (u.pathname === '/events') {
      const uid = u.searchParams.get('uid'), cid = u.searchParams.get('cid');
      res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const conn = { uid, res, subs: new Map(), odc: [] };
      conns.set(cid, conn);
      res.write(`retry: 1000\ndata: ${JSON.stringify({ type: 'hello', now: Date.now() })}\n\n`);
      const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch {} }, 15000);
      req.on('close', () => { clearInterval(ka); closeConn(cid); });
      return;
    }
    if (u.pathname === '/op' && req.method === 'POST') {
      const b = await body();
      stats.ops++;
      await delay();
      const conn = conns.get(b.cid);
      if (!conn) return json({ error: 'NO_CONN' });
      const uid = conn.uid, now = Date.now();
      const auth = { uid };
      switch (b.op) {
        case 'get': {
          if (!rules.canRead(tree, b.path, auth, now)) { stats.denied++; return json({ error: 'PERMISSION_DENIED' }); }
          return json({ val: getAt(tree, split(b.path)) });
        }
        case 'sub': {
          if (!rules.canRead(tree, b.path, auth, now)) { stats.denied++; return json({ error: 'PERMISSION_DENIED' }); }
          const v = getAt(tree, split(b.path));
          conn.subs.set(b.sid, { path: b.path, last: JSON.stringify(v) });
          push(conn, b.sid, v);
          return json({ ok: true });
        }
        case 'unsub': conn.subs.delete(b.sid); return json({ ok: true });
        case 'set': {
          const why = applyWrites([{ path: b.path, val: b.val }], uid);
          return json(why ? { error: 'PERMISSION_DENIED', why } : { ok: true });
        }
        case 'update': {
          const why = applyWrites(multi(b.path, b.val), uid);
          return json(why ? { error: 'PERMISSION_DENIED', why } : { ok: true });
        }
        case 'odc': {
          // Firebase 처럼 걸 때 규칙을 검사한다(쓰지는 않는다)
          const writes = multi(b.path, b.val), nowT = Date.now();
          let next = tree;
          for (const w of writes) next = setAt(next, split(w.path), resolveTS(w.val, nowT));
          for (const w of writes) {
            const why = rules.checkWrite(tree, next, w.path, auth, nowT);
            if (why) { stats.denied++; stats.deniedList.push({ uid, path: w.path, why: 'odc ' + why }); return json({ error: 'PERMISSION_DENIED', why }); }
          }
          conn.odc = conn.odc.filter(o => o.path !== b.path); conn.odc.push({ path: b.path, val: b.val });
          return json({ ok: true });
        }
        case 'odc-cancel': conn.odc = conn.odc.filter(o => o.path !== b.path); return json({ ok: true });
      }
      return json({ error: 'BAD_OP' }, 400);
    }
    if (u.pathname === '/admin/dump') return json({ val: getAt(tree, split(u.searchParams.get('path') || '')) });
    if (u.pathname === '/admin/stats') return json({ ...stats, conns: conns.size });
    if (u.pathname === '/admin/drop' && req.method === 'POST') {
      const uid = u.searchParams.get('uid');
      let n = 0;
      for (const [cid, c] of conns) if (c.uid === uid) { closeConn(cid); n++; }
      return json({ dropped: n });
    }
    res.writeHead(404, cors); res.end();
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r({ server, port, stats, dump: () => tree, close: () => { for (const c of conns.keys()) closeConn(c); server.close(); } })));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const m = await startMock({ port: Number(arg('port', 8787)), latency: Number(arg('latency', 0)), log: true });
  console.log(`가짜 DB: http://127.0.0.1:${m.port}  (진행판 주소에 ?mock=http://127.0.0.1:${m.port})`);
}
