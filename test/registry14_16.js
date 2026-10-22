// 시험 전용 임시 게임 목록 (site/games/index.js 는 건드리지 않는다)
// test/games14_16.mjs 가 esbuild 로 묶을 때 '../games/index.js' 대신 이 파일을 쓴다
import yeast from '../site/games/yeast.js';
import kimchi from '../site/games/kimchi.js';
import auction from '../site/games/auction.js';
import sort from '../site/games/sort.js';
import pitch from '../site/games/pitch.js';

export default [yeast, kimchi, auction, sort, pitch];
