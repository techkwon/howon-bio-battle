# 생명 기술 대작전 — 교실 실시간 팀 대결 판

호원중학교 3학년 2학기 기술 · 생명 기술 단원 **13~16차시** 수업용 실시간 팀 대결 게임.
교사 큰 화면(진행판) 하나 + 학생 크롬북(조종기) 1인 1대로, 짧은 팀 대결을 이어서 한다.

- 성취기준: `[9기가04-08]` 생명 기술 시스템 (2015 개정 교육과정) · 평가 없음(성적 미반영)
- 학생 화면: https://ict-bio-battle.netlify.app
- 교사 진행판: https://ict-bio-battle.netlify.app/host.html

## 게임

| 차시 | 게임 | 파일 |
|---|---|---|
| 13 | 효모 풍선 대결 · 김치 숙성 타이밍 | `site/games/yeast.js` · `kimchi.js` |
| 14 | 바이오 경매 · 분야 스피드 분류 | `auction.js` · `sort.js` |
| 15 | 장바구니 탐정 · 가족 저녁 회의 | `cart.js` · `dinner.js` |
| 16 | 2040 발명가 피칭 | `pitch.js` |

교사 사용법은 `site/README.md`, 게임 플러그인 규칙은 `site/GAMES.md`, 설계는 `SPEC.md`.

## 구조

- `site/` — 배포하는 폴더. `host.html`(진행판) · `index.html`(조종기) · `src/`(코어) · `games/`(게임) · `database.rules.json`(보안 규칙)
- `build.mjs` — esbuild 로 `site/src` → `site/dist` 묶기(Firebase SDK 포함 — 학교망 CDN 차단 대비)
- `test/` — 단위 시험 · 가짜 DB(`mockdb.mjs`, 규칙 파일을 그대로 판정) · Playwright 부하 · 화면 시험

## 실행 · 시험 · 배포

```bash
npm install
npm run build            # site/dist/ 생성
npm run serve            # 로컬에서 열어 보기
npm run test:unit        # 팀 나누기 · 규칙 단위 시험
node test/load.mjs       # 진행판 1 + 학생 30 (가짜 DB, Playwright 필요)
netlify deploy --prod --no-build --dir site --site <site-id>
```

## Firebase

실시간 DB(Realtime Database) + 익명 로그인. `site/src/net-firebase.js` 의 웹 설정값은 **공개되는 값**이며,
보안은 `site/database.rules.json` 규칙으로 지킨다(학생은 자기 입력 칸에만 쓸 수 있고, 판정은 진행판만 한다).
규칙은 Firebase 콘솔 → Realtime Database → 규칙 탭에 붙여 넣고 게시한다.

## 내 학교에서 쓰려면

이 저장소의 주소(Netlify · Firebase)는 호원중 수업용이고, 무료 요금제라 **동시 접속 100개**(약 세 반)까지만 된다.
그리고 Firebase 웹 키가 우리 배포 주소에서만 쓰이게 막혀 있다. 그래서 다른 학교에서는 **자기 Firebase 프로젝트로** 띄워야 한다.

1. [Firebase 콘솔](https://console.firebase.google.com)에서 새 프로젝트 → **Realtime Database** 만들기(지역은 가까운 곳) → **Authentication → 익명** 사용 설정
2. 프로젝트 설정 → 웹 앱 추가 → 나오는 설정값(`apiKey` · `authDomain` · `databaseURL` · `projectId` 등)으로 `site/src/net-firebase.js` 의 값을 바꾼다
3. Realtime Database → 규칙 탭에 `site/database.rules.json` 내용을 그대로 붙여 넣고 **게시**
4. `npm install` → `npm run build` → `site/` 폴더를 Netlify 등 정적 호스팅에 올린다
5. (권장) 구글 클라우드 콘솔 → API 및 서비스 → 사용자 인증 정보 → 그 브라우저 키에 **웹사이트 제한**으로 내 배포 주소를 넣는다

- 학생 이름은 받지 않는다(방 코드 + 번호). 수업이 끝나면 진행판에서 방을 지운다
- 무료(Spark) 요금제로 충분하다. 한 번에 세 반 넘게 쓰면 동시 접속 100개에 걸릴 수 있다

## 개인정보

이름을 받지 않는다 — **방 코드 + 번호(1~30)** 만 쓴다. 수업이 끝나면 방을 지운다.
반 대항 기록판은 교사 PC 브라우저(localStorage)에만 반 · 팀 이름으로 남는다.
