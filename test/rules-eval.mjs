// Firebase Realtime Database 보안 규칙 계산기(시험용 근사).
// 에뮬레이터(Java 필요)를 못 쓸 때 database.rules.json 을 그대로 읽어 같은 판정을 흉내 낸다.
// 다루는 것: .read/.write(위에서 하나라도 참이면 허용) · .validate(새 값이 있는 모든 마디, 위 · 아래) · $변수 · auth · now · root · data · newData
// 다루지 않는 것: .indexOn · 쿼리 규칙 · auth.token
import fs from 'node:fs';

// 규칙 식에서 쓰는 문자열 메서드
if (!String.prototype.matches) {
  Object.defineProperty(String.prototype, 'matches', { value(re) { return re.test(this); } });
  Object.defineProperty(String.prototype, 'contains', { value(s) { return this.includes(s); } });
  Object.defineProperty(String.prototype, 'beginsWith', { value(s) { return this.startsWith(s); } });
}

export const split = p => String(p || '').split('/').filter(Boolean);

export function getAt(tree, segs) {
  let n = tree;
  for (const s of segs) { if (n === null || typeof n !== 'object' || !(s in n)) return null; n = n[s]; }
  return n === undefined ? null : n;
}

/** Firebase 처럼: null 지우기 · 빈 객체 없애기 · 배열 → 객체 */
export function normalize(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) v = Object.fromEntries(v.map((x, i) => [String(i), x]));
  if (typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) { const y = normalize(x); if (y !== null) o[k] = y; }
    return Object.keys(o).length ? o : null;
  }
  return v;
}

export function resolveTS(v, now) {
  if (v && typeof v === 'object') {
    if (v['.sv'] === 'timestamp') return now;
    const o = Array.isArray(v) ? [] : {};
    for (const [k, x] of Object.entries(v)) o[k] = resolveTS(x, now);
    return o;
  }
  return v;
}

/** 깊은 복사 후 segs 자리에 val 넣기 (null 이면 지우고 빈 부모 정리) */
export function setAt(tree, segs, val) {
  const root = structuredClone(tree || {});
  if (!segs.length) return normalize(val) || {};
  let n = root;
  const stack = [];
  for (let i = 0; i < segs.length - 1; i++) {
    if (n[segs[i]] === null || typeof n[segs[i]] !== 'object') n[segs[i]] = {};
    stack.push([n, segs[i]]);
    n = n[segs[i]];
  }
  const last = segs[segs.length - 1];
  const v = normalize(val);
  if (v === null) delete n[last]; else n[last] = v;
  for (let i = stack.length - 1; i >= 0; i--) {
    const [parent, key] = stack[i];
    if (parent[key] && typeof parent[key] === 'object' && !Object.keys(parent[key]).length) delete parent[key];
  }
  return root;
}

class Snap {
  constructor(tree, segs) { this.tree = tree; this.segs = segs; }
  val() { const v = getAt(this.tree, this.segs); return v; }
  child(p) { return new Snap(this.tree, [...this.segs, ...split(p)]); }
  parent() { return new Snap(this.tree, this.segs.slice(0, -1)); }
  exists() { return this.val() !== null; }
  hasChild(p) { return this.child(p).exists(); }
  hasChildren(list) {
    const v = this.val();
    if (!v || typeof v !== 'object') return false;
    return list ? list.every(k => k in v) : Object.keys(v).length > 0;
  }
  isNumber() { return typeof this.val() === 'number'; }
  isString() { return typeof this.val() === 'string'; }
  isBoolean() { return typeof this.val() === 'boolean'; }
}

const fnCache = new Map();
function compile(expr, vars) {
  const key = expr + '|' + vars.join(',');
  if (!fnCache.has(key)) {
    // eslint-disable-next-line no-new-func
    fnCache.set(key, new Function('auth', 'now', 'root', 'data', 'newData', ...vars, `return (${expr});`));
  }
  return fnCache.get(key);
}

export class Rules {
  constructor(rulesOrPath) {
    const r = typeof rulesOrPath === 'string' ? JSON.parse(fs.readFileSync(rulesOrPath, 'utf8')) : rulesOrPath;
    this.root = r.rules;
  }

  /** segs 를 따라 규칙 마디들: [{node, vars}] (깊이 0 = 뿌리) */
  chain(segs) {
    const out = [];
    let node = this.root, vars = {};
    out.push({ node, vars: { ...vars } });
    for (const s of segs) {
      if (!node) { out.push({ node: null, vars: { ...vars } }); continue; }
      let next = node[s];
      if (next === undefined) {
        const wk = Object.keys(node).find(k => k.startsWith('$'));
        if (wk) { next = node[wk]; vars = { ...vars, [wk]: s }; }
      }
      node = next && typeof next === 'object' ? next : null;
      out.push({ node, vars: { ...vars } });
    }
    return out;
  }

  ev(expr, ctx, vars) {
    if (expr === true || expr === false) return expr;
    const names = Object.keys(vars);
    try {
      return !!compile(String(expr), names)(ctx.auth, ctx.now, new Snap(ctx.oldRoot, []), ctx.data, ctx.newData, ...names.map(n => vars[n]));
    } catch { return false; }  // Firebase: 식 오류 = 거짓
  }

  canRead(oldRoot, path, auth, now) {
    const segs = split(path);
    const ch = this.chain(segs);
    for (let i = 0; i < ch.length; i++) {
      const { node, vars } = ch[i];
      if (node && '.read' in node) {
        const sp = segs.slice(0, i);
        if (this.ev(node['.read'], { auth, now, oldRoot, data: new Snap(oldRoot, sp), newData: new Snap(oldRoot, sp) }, vars)) return true;
      }
    }
    return false;
  }

  /** 쓰기 하나(path)가 허용되는가 + 새 값 검증. 돌려줌: null(허용) 또는 까닭 */
  checkWrite(oldRoot, newRoot, path, auth, now) {
    const segs = split(path);
    const ch = this.chain(segs);
    let ok = false;
    for (let i = 0; i < ch.length && !ok; i++) {
      const { node, vars } = ch[i];
      if (node && '.write' in node) {
        const sp = segs.slice(0, i);
        if (this.ev(node['.write'], { auth, now, oldRoot, data: new Snap(oldRoot, sp), newData: new Snap(newRoot, sp) }, vars)) ok = true;
      }
    }
    if (!ok) return 'write denied at ' + path;
    // 위쪽 마디 검증
    for (let i = 0; i < ch.length - 1; i++) {
      const { node, vars } = ch[i];
      const sp = segs.slice(0, i);
      if (node && '.validate' in node && getAt(newRoot, sp) !== null) {
        if (!this.ev(node['.validate'], { auth, now, oldRoot, data: new Snap(oldRoot, sp), newData: new Snap(newRoot, sp) }, vars)) return 'validate failed at /' + sp.join('/');
      }
    }
    // 쓴 자리와 그 아래 모든 마디 검증
    const last = ch[ch.length - 1];
    return this.validateDown(oldRoot, newRoot, segs, last.node, last.vars, auth, now);
  }

  validateDown(oldRoot, newRoot, segs, node, vars, auth, now) {
    const v = getAt(newRoot, segs);
    if (v === null || !node) return null;
    if ('.validate' in node) {
      if (!this.ev(node['.validate'], { auth, now, oldRoot, data: new Snap(oldRoot, segs), newData: new Snap(newRoot, segs) }, vars)) return 'validate failed at /' + segs.join('/');
    }
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        let next = node[k], nv = vars;
        if (next === undefined) {
          const wk = Object.keys(node).find(x => x.startsWith('$'));
          if (wk) { next = node[wk]; nv = { ...vars, [wk]: k }; }
        }
        const r = this.validateDown(oldRoot, newRoot, [...segs, k], next && typeof next === 'object' ? next : null, nv, auth, now);
        if (r) return r;
      }
    }
    return null;
  }
}

