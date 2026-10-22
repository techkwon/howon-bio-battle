# 미니게임 플러그인 만들기 (14~16차시 개발자용)

코어(`src/`)는 고치지 않는다. 게임 하나 = 파일 하나 `games/<id>.js` + `games/index.js` 에 한 줄.

```
games/<id>.js        게임 (export default 객체)
games/<id>-data.js   카드 · 문구 데이터 (교사가 고칠 수 있게 따로)
games/index.js       목록 — import 하고 배열에 넣는다
```
만든 뒤 `_개발/` 에서 `npm run build` → `site/dist/` 가 새로 묶인다.
시험: `npm run mock` + `npm run serve` → `http://127.0.0.1:8080/host.html?mock=http://127.0.0.1:8787` 와 `http://127.0.0.1:8080/?mock=http://127.0.0.1:8787` (학생은 다른 창 · 시크릿 창).

## 큰 규칙

1. **판정은 진행판만 한다.** 학생 화면(`playView`)은 그리기와 `ctx.send()` 만 한다. 점수 · 팀 결정 · 시간 판정은 `setup / onInput / tick / action / scoring` 안에서.
2. **게임 상태(`state`)는 JSON 객체 하나.** 진행판이 0.2초마다 바뀐 **맨 위 키만** DB 에 쓴다(`state/g/<키>` = JSON 문자열). 그러니
   - 자주 바뀌는 것(투표 집계)과 드물게 바뀌는 것(결과)을 **다른 맨 위 키**에 둔다 → 데이터가 적게 오간다
   - 학생 화면도 DB 를 읽을 수 있으므로 **비밀(정답 · 미래 배수)은 state 에 넣지 말고** `*-data.js` 에 두었다가 공개할 때 넣는다
   - 함수 · `undefined` · `Date` 는 넣지 않는다. 시간은 늘 `ctx.now()` (서버 시간 ms)
   - 상태를 바꿀 땐 **새 객체를 돌려준다**(`{ ...s, step: 'x' }`). 같은 객체를 돌려주면 「안 바뀜」으로 본다
3. **학생 입력은 `state.inputKey` 칸이 열려 있을 때만** 받는다. ⚠ `inputKey` 는 코어가 `state/inputKey` 로 따로 보내므로 **`playView` 가 받는 state 에는 없다** — 조종기에서 「지금 받는 중인가」는 시각(`ctx.now() < s.마감`)이나 단계로 판단한다. 키를 바꾸면(라운드마다 `'r1'`, `'r2'`…) 새 칸이 열린다. `null` 이면 입력 닫힘(규칙이 막는다). 코어가 게임 번호를 앞에 붙이므로 같은 게임을 두 번 해도 섞이지 않는다.
4. **입력 값은 납작하게**: `{ choice: 2, ok: true, text: '짧은 글' }` — 숫자 · 참거짓 · 200자 이하 글만. 키 20자 이하. 객체 · 배열은 안 된다. `t`(서버 시간)는 코어가 붙이고 규칙이 `t === now` 로 막아 학생이 시각을 꾸밀 수 없다. 학생은 같은 칸을 다시 쓸 수 있으므로 「한 번만」인 게임은 **처음 받은 값만** state 에 적어 둔다(`kimchi.js` 의 `first`).
5. **비상 모드**(인터넷 없음)에서도 돌아야 한다 → `proxyButtons` 를 꼭 만든다. 교사가 팀마다 누르면 그 팀의 가짜 팀원(`proxy-<팀id>`)이 입력한 것처럼 들어온다.
6. 학생 화면은 크롬북 1366×768 **세로 스크롤 없이**, 한 화면에 할 일 하나, 큰 버튼. 진행판은 뒷자리에서 보이게 큰 글씨. 색만으로 알리지 않는다(팀은 늘 이모지 + 이름).
7. 개인정보 없음 — 학생은 번호로만 보인다(`ctx.numOf(uid)`).

## 객체 모양

```js
export default {
  id: 'quiz',                 // 영문 소문자. 파일 이름과 같게
  title: 'OX 스피드 퀴즈',
  lesson: 14,                 // 몇 차시용 (게임 고르기 카드에 표시)
  minutes: 3,
  emoji: '⭕',
  blurb: '한 줄 소개',
  intro: { headline: '제목', lines: ['규칙 1', '규칙 2'], art: '<svg …>…</svg>' },  // 설명 화면 10초. art 는 HTML/SVG 문자열(없으면 emoji)

  // ── 진행판에서만 (판정) ──
  setup(ctx) → state                       // 게임 시작
  onInput(state, inputs, ctx) → state      // 학생 입력이 바뀔 때마다. inputs = { uid: {...입력, t} } (지금 inputKey 칸 전체)
  tick(state, ctx) → state                 // 0.2초마다 (시간 다 되면 다음 단계로)
  action(state, name, payload, ctx) → state  // 진행판 단추. hostView 에서 data-act="next" 단추 → name='next'
  proxyButtons(state, team, ctx) → [{ label, input, once? }]   // 비상 모드 · 대신 누르기 단추
  scoring(state, ctx) → { points: { 팀id: 점수 }, lines: ['결과 화면 한 줄', …] }   // state.done = true 가 되면 한 번 불림
  record(state, ctx) → { label, value, unit, team } | null     // (선택) 반 대항 기록판. 큰 값이 좋은 기록
  remap(state, fromUid, toUid) → state     // (선택) 같은 번호가 새 기기로 바뀌었을 때. state 에 uid 명단을 들고 있으면 꼭 만든다

  // ── 그리기 ──
  hostView(el, state, ctx)                 // 진행판. 0.2초마다 불린다 → keyed() 로 뼈대는 한 번만, 값만 제자리 갱신
  playView(el, state, me, ctx)             // 조종기. me = { uid, num, team, mine } (mine = 이 칸에 내가 낸 입력)
}
```

**끝내기**: 마지막 화면에서 `return { ...s, done: true }` → 코어가 `scoring` 을 불러 팀 점수에 더하고 결과 화면으로 간다.

### 진행판 `ctx`
| | |
|---|---|
| `ctx.now()` | 서버 시간(ms). 마감 · 시작 시각은 이것으로 |
| `ctx.teams` | `[{ id, name, emoji, fill, tint, text, score, members:[uid], online:[uid] }]` — `online` 은 지금 접속한 팀원(+ 대신 누르기) |
| `ctx.inputs` | 지금 칸의 입력 전체 (`tick` 에서 쓸 때) |
| `ctx.rnd()` | 0~1 난수 |
| `ctx.numOf(uid)` | 번호 (대신 누르기 = 0) |
| `ctx.act(name, payload)` | `hostView` 안 단추에서 부른다 (`data-act` 단추는 코어가 아니라 게임이 연결: 아래 예시) |
| `ctx.offline` · `ctx.cls` | 비상 모드인가 · 반(`'3-4'`) |

### 조종기 `ctx`
`ctx.now()` · `ctx.send(input)` · `ctx.teams` (팀 정보) · `ctx.team` (내 팀)

### 도구 (`src/gamekit.js`)
`keyed(el, key, html)` 뼈대 한 번만 · `text(el, sel, s)` 글자만 바꾸기 · `secsLeft(deadline, now)` ·
`timerHTML()` + `timerUpdate(el, 초)` 큰 초시계(마지막 3초 빨갛게) · `tickSound(el, 초)` 째깍 ·
`majority([{v, t}])` 다수결(동률은 먼저) · `rankPoints({팀: 값})` 순위 점수(10·8·6·5·4·3·2·1) ·
`teamTag(team)` 팀 이름표 · `confetti(el)` · `flash(el, cls)` · `beep(hz, ms)` · `injectCSS(id, css)` 게임 전용 CSS · `medal(순위)` · `esc()`

공용 CSS 클래스(styles.css): `.btn` `.btn.ghost` `.btn.big` · `.eyebrow` `.title` · `.gk-note`(설명 띠) `.gk-hint` · `.pv-center` `.pv-big` `.pv-huge` `.pv-sub` `.pv-eyebrow`(조종기) · 팀 색은 `style="--tf:${t.fill};--tt:${t.tint};--tx:${t.text}"`

## 가장 작은 예시 — 「OX 한 문제」

```js
// games/ox.js
import { keyed, text, secsLeft, rankPoints, esc } from '../src/gamekit.js';

const Q = { q: '김치를 익히는 생물은 효모다', a: false, why: '김치는 유산균이 젖산을 만들어 익힌다' };

export default {
  id: 'ox', title: 'OX 한 문제', lesson: 13, minutes: 1, emoji: '⭕', blurb: '맞히면 팀 점수!',
  intro: { headline: 'OX 한 문제', lines: ['O 또는 X 를 누른다', '팀에서 맞힌 사람 비율로 순위'] },

  setup(ctx) { return { step: 'ask', inputKey: 'q1', deadline: ctx.now() + 10000 }; },

  onInput(s) { return s; },                        // 셀 것이 없으면 그대로

  tick(s, ctx) {
    if (s.step !== 'ask' || ctx.now() < s.deadline) return s;
    const rate = {};
    for (const t of ctx.teams) {
      const right = t.online.filter(u => ctx.inputs[u] && ctx.inputs[u].ox === Q.a).length;
      rate[t.id] = t.online.length ? right / t.online.length : 0;
    }
    return { ...s, step: 'show', inputKey: null, rate, a: Q.a };   // 정답은 이때 공개
  },

  action(s, name) { return name === 'finish' ? { ...s, done: true } : s; },

  proxyButtons(s) { return s.step === 'ask' ? [{ label: 'O', input: { ox: true } }, { label: 'X', input: { ox: false } }] : []; },

  scoring(s) { return { points: rankPoints(s.rate || {}).points, lines: [Q.why] }; },

  hostView(el, s, ctx) {
    if (s.step === 'ask') {
      keyed(el, 'ask', `<h1 class="title">${esc(Q.q)}</h1><p class="pv-huge num" id="left"></p>`);
      text(el, '#left', secsLeft(s.deadline, ctx.now()));
    } else {
      keyed(el, 'show', `<h1 class="title">정답: ${s.a ? 'O' : 'X'}</h1><p class="gk-note">${esc(Q.why)}</p>
        <button class="btn big" data-act="finish">결과 ▶</button>`);
      el.querySelector('[data-act]').onclick = () => ctx.act('finish');
    }
  },

  playView(el, s, me, ctx) {
    if (s.step !== 'ask') return keyed(el, 'wait', '<div class="pv-center"><div class="pv-big">화면을 보세요</div></div>');
    const mine = me.mine ? me.mine.ox : null;
    if (keyed(el, 'ask-' + mine, `<div class="pv-center"><div class="pv-big">${esc(Q.q)}</div>
        <div class="pv-row"><button class="btn big" data-v="1">${mine === true ? '✓ ' : ''}O</button>
        <button class="btn big ghost" data-v="0">${mine === false ? '✓ ' : ''}X</button></div></div>`)) {
      el.querySelectorAll('[data-v]').forEach(b => b.onclick = () => ctx.send({ ox: b.dataset.v === '1' }));
    }
  },
};
```
```js
// games/index.js 에 한 줄
import ox from './ox.js';
export default [yeast, kimchi, ox];
```

더 큰 예시는 `games/yeast.js`(투표 → 애니메이션 → 순위 → 정리 카드)와 `games/kimchi.js`(한 번 누르기 · 깜짝 이벤트 · 평균 점수).

## 하지 말 것
- `src/` 의 코어 파일 고치기 (필요한 기능이 있으면 코어 담당에게)
- 조종기에서 점수 계산 · DB 직접 쓰기 (`ctx.send` 만)
- 외부 이미지 · 폰트 · CDN (학교망에서 막힌다). 그림은 인라인 SVG · 이모지
- 실제 회사 · 상표 이름, 학생 이름
