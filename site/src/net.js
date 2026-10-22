// 연결 고르기: 기본 = 실제 Firebase · ?emu=1 = 에뮬레이터(127.0.0.1) · ?mock=http://127.0.0.1:8787 = 시험용 가짜 DB
import { connectFirebase } from './net-firebase.js';
import { connectMock } from './net-mock.js';

export function netMode() {
  const q = new URLSearchParams(location.search);
  if (q.get('mock')) return { kind: 'mock', url: q.get('mock') };
  if (q.get('emu')) return { kind: 'emu', host: q.get('emu') === '1' ? '127.0.0.1' : q.get('emu') };
  return { kind: 'firebase' };
}

export async function connectNet() {
  const m = netMode();
  if (m.kind === 'mock') return connectMock(m.url);
  if (m.kind === 'emu') return connectFirebase({ emu: m.host });
  return connectFirebase();
}

/** 시험 모드면 방 코드를 9xxx 로 만든다 */
export function isTestMode() {
  const q = new URLSearchParams(location.search);
  return q.has('test') || netMode().kind !== 'firebase';
}
