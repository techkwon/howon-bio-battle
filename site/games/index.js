// 미니게임 목록. 새 게임을 더하려면: games/<id>.js 를 만들고 아래에 한 줄 더한 뒤 `npm run build`.
// 진행판 · 조종기 코어(src/)는 고치지 않는다. 자세한 규칙은 GAMES.md
import yeast from './yeast.js';
import kimchi from './kimchi.js';
import auction from './auction.js';
import sort from './sort.js';
import cart from './cart.js';
import dinner from './dinner.js';
import pitch from './pitch.js';

export default [
  yeast,   // 13차시
  kimchi,  // 13차시
  auction, // 14차시
  sort,    // 14차시
  cart,    // 15차시
  dinner,  // 15차시
  pitch,   // 16차시
];
