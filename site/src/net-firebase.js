// Firebase Realtime Database 연결 (실제 DB 또는 에뮬레이터)
// 진행판 · 조종기는 이 파일의 함수만 쓴다 → 시험용 net-mock.js 와 모양이 같다.
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously, connectAuthEmulator, onAuthStateChanged } from 'firebase/auth';
import {
  getDatabase, ref, get, set, update, remove, onValue, onDisconnect,
  serverTimestamp, connectDatabaseEmulator,
} from 'firebase/database';

export const firebaseConfig = {
  apiKey: 'AIzaSyCYPfj-xv510BQO4N3UfhY52bv4qiWJLRU',
  authDomain: 'bio-battle-howon.firebaseapp.com',
  databaseURL: 'https://bio-battle-howon-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'bio-battle-howon',
  storageBucket: 'bio-battle-howon.firebasestorage.app',
  messagingSenderId: '745743255981',
  appId: '1:745743255981:web:1aea10bce8aa2a8e313924',
};

function withTimeout(p, ms, what) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('시간 초과: ' + what)), ms)),
  ]);
}

/**
 * opts.emu: 에뮬레이터 주소(예: '127.0.0.1') — 없으면 실제 DB
 */
export async function connectFirebase(opts = {}) {
  const config = { ...firebaseConfig };
  if (opts.emu) {
    // 에뮬레이터는 실제 프로젝트와 섞이지 않게 demo- 프로젝트로 띄운다
    config.projectId = 'demo-bio-battle';
    config.databaseURL = `http://${opts.emu}:9000?ns=demo-bio-battle-default-rtdb`;
  }
  // 앱 이름을 고정해야 익명 로그인 정보가 새로 고침 뒤에도 그대로 남는다(저장 키에 앱 이름이 들어간다)
  const name = opts.emu ? 'bb-emu' : 'bb';
  const app = getApps().find(a => a.name === name) || initializeApp(config, name);
  const auth = getAuth(app);
  const db = getDatabase(app);
  if (opts.emu) {
    connectAuthEmulator(auth, `http://${opts.emu}:9099`, { disableWarnings: true });
    connectDatabaseEmulator(db, opts.emu, 9000);
  }

  // 같은 브라우저면 같은 익명 uid 를 다시 쓴다(새로 고침해도 같은 사람)
  const existing = await withTimeout(new Promise(res => {
    const off = onAuthStateChanged(auth, u => { off(); res(u); });
  }), 8000, '로그인 확인');
  const user = existing || (await withTimeout(signInAnonymously(auth), 10000, '익명 로그인')).user;

  let offset = 0;
  onValue(ref(db, '.info/serverTimeOffset'), s => { offset = s.val() || 0; });

  const r = p => ref(db, p);
  return {
    kind: opts.emu ? 'emu' : 'firebase',
    uid: user.uid,
    TS: serverTimestamp(),
    serverNow: () => Date.now() + offset,
    onConnected(cb) { return onValue(r('.info/connected'), s => cb(!!s.val())); },
    get: async p => (await get(r(p))).val(),
    set: (p, v) => set(r(p), v),
    update: (p, obj) => update(r(p), obj),
    remove: p => remove(r(p)),
    on(p, cb, onErr) { return onValue(r(p), s => cb(s.val()), e => onErr && onErr(e)); },
    onDisconnectUpdate: (p, obj) => onDisconnect(r(p)).update(obj),
    onDisconnectCancel: p => onDisconnect(r(p)).cancel(),
    withTimeout,
  };
}
