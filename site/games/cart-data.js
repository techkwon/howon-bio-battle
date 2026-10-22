// 15차시 「장바구니 탐정」 카드 데이터 — 교사가 고칠 수 있게 따로 둔다.
// 모두 가상 상품이다. 실제 회사 · 상표 이름을 쓰지 않는다. 표시 문구는 우리나라 식품 표시 방식을 본떴다.
//   - 유전자변형 표시: 「유전자변형 ○○ 포함」 또는 「유전자변형 ○○ 포함 가능성 있음」 (이 두 가지만 기술 이름이 그대로 보인다)
//   - 그 밖의 카드는 보기 이름(발효 · 효소 · 품종 개량 · 스마트팜 · 대체육 · 배양)을 포장에 쓰지 않는다.
//     원재료명 · 만드는 법 · 재배 · 주의 같은 줄에서 단서를 찾아 「추리」해야 한다.
//   - 앞면 문구(marks)는 광고 문구다 — 단서가 아닐 때가 많다(함정).
// 칸: type 식품유형 · ing 원재료명 · rows 그 밖의 줄 [[이름, 내용]] · clue 단서가 있는 줄('ing' 또는 'r0' · 'r1')
//     clueText 정답 공개 때 보여 줄 단서 한 줄 · answer 정답 기술 id · choices 보기 4개(정답 포함 — 순서는 게임이 섞는다) · why 한 줄 해설

// 기술 7가지 (보기)
export const TECH = {
  gmo:    { label: '유전자 변형',  emoji: '🧬', what: '다른 생물의 유전자를 넣어 성질을 바꾼 작물' },
  micro:  { label: '발효 · 미생물', emoji: '🦠', what: '유산균 · 효모 · 곰팡이 같은 미생물이 식품을 만든다' },
  enzyme: { label: '효소 이용',    emoji: '✂️', what: '생물이 만든 효소로 성분을 자르거나 바꾼다' },
  breed:  { label: '품종 개량',    emoji: '🌾', what: '좋은 성질을 가진 품종끼리 교배해 새 품종을 만든다' },
  farm:   { label: '스마트팜',     emoji: '📡', what: '센서 · 자동 제어로 작물이 자라는 환경을 맞춘다' },
  plant:  { label: '식물성 대체육', emoji: '🌿', what: '콩 · 밀 같은 식물 단백질로 고기 같은 식감을 낸다' },
  cell:   { label: '세포 배양',    emoji: '🧫', what: '동물 세포를 키워 고기를 만든다' },
};

// 포장 모양(kind): box · bag · bottle · carton · tray · pouch · jar · tag
// tone: 포장 바탕색 계열 (org · blu · grn · ink · paper)
export const CARDS = [
  { id: 'tofu', kind: 'box', tone: 'paper', art: '🫘', name: '고소한 부침 두부',
    marks: ['부침용 단단한 두부'],
    type: '두부', ing: '대두(외국산), 정제수, 응고제(염화마그네슘)',
    rows: [['표시', '유전자변형 콩 포함']], clue: 'r0', clueText: '표시 「유전자변형 콩 포함」',
    answer: 'gmo', choices: ['gmo', 'plant', 'breed', 'micro'],
    why: '다른 생물의 유전자를 넣어 성질을 바꾼 콩을 썼다는 표시예요. 두부는 콩 음식이지만 고기 흉내를 낸 대체육은 아니에요.' },

  { id: 'cornchip', kind: 'bag', tone: 'org', art: '🌽', name: '바삭 옥수수칩',
    marks: ['통옥수수 그대로!'],
    type: '과자', ing: '옥수수(외국산), 정제소금, 해바라기유',
    rows: [['표시', '유전자변형 옥수수 포함 가능성 있음']], clue: 'r0', clueText: '표시 「…포함 가능성 있음」',
    answer: 'gmo', choices: ['gmo', 'farm', 'breed', 'enzyme'],
    why: '「포함 가능성 있음」 = 유전자변형 옥수수가 섞였을 수 있다는 뜻 — 이것도 유전자 변형 표시예요.' },

  // 식빵(이스트)은 15차시 슬라이드의 「단서 추리 보기」라 게임 카드로 쓰지 않는다(정답을 미리 알려 주지 않게)
  { id: 'natto', kind: 'box', tone: 'grn', art: '🫘', name: '끈적 낫토',
    marks: ['실이 쭉쭉 늘어나요'],
    type: '낫토', ing: '대두, 정제수, 낫토균',
    rows: [['먹는 법', '실이 길게 늘어날 때까지 저어 드세요 · 냉장 보관']], clue: 'ing', clueText: '낫토균(균 = 미생물)이 콩을 삭힘',
    answer: 'micro', choices: ['micro', 'gmo', 'plant', 'farm'],
    why: '낫토균(고초균의 한 종류)이 삶은 콩을 발효시켜 끈적한 실이 생겨요 — 청국장과 사촌인 발효 식품.' },

  { id: 'kimchi', kind: 'pouch', tone: 'org', art: '🥬', name: '포기 배추김치',
    marks: ['손맛 그대로'],
    type: '배추김치', ing: '배추(국산), 무, 고춧가루, 마늘, 멸치액젓, 생강',
    rows: [['주의', '익으면서 가스가 생겨 포장이 부풀 수 있어요']], clue: 'r0', clueText: '「익으면서 가스가 생겨 포장이 부풀 수 있어요」',
    answer: 'micro', choices: ['micro', 'breed', 'farm', 'enzyme'],
    why: '유산균이 일해 김치가 익어요 — 새콤해지는 것도, 포장이 부푸는 것도 유산균이 낸 젖산 · 가스 때문.' },

  { id: 'soysauce', kind: 'bottle', tone: 'ink', art: '🍶', name: '진한 간장',
    marks: ['6개월 기다린 깊은 맛'],
    type: '양조간장', ing: '탈지대두, 소맥(밀), 정제소금, 정제수, 종국(누룩곰팡이)',
    rows: [], clue: 'ing', clueText: '종국(누룩곰팡이) · 6개월 기다림 · 「양조」',
    answer: 'micro', choices: ['micro', 'farm', 'cell', 'plant'],
    why: '누룩곰팡이 · 효모 · 유산균이 콩과 밀을 오래 발효시켜 만든 간장이에요(「양조」 = 미생물로 빚음).' },

  { id: 'msg', kind: 'jar', tone: 'paper', art: '🧂', name: '감칠맛 조미료',
    marks: ['한 꼬집이면 감칠맛 듬뿍'],
    type: '향미증진제', ing: 'L-글루탐산나트륨',
    rows: [['만드는 법', '사탕수수 당밀에 균을 길러 얻은 글루탐산으로 만듦']], clue: 'r0', clueText: '「당밀에 균을 길러」',
    answer: 'micro', choices: ['micro', 'farm', 'breed', 'cell'],
    why: '균(미생물)이 당밀(설탕을 만들고 남은 즙)을 먹고 글루탐산을 만들어요 — 발효로 만드는 조미료.' },

  { id: 'probiotic', kind: 'box', tone: 'grn', art: '💊', name: '튼튼 캡슐',
    marks: ['건강기능식품'],
    type: '건강기능식품', ing: '프로바이오틱스(락토바실러스 ○○), 결정셀룰로스',
    rows: [['보관', '개봉 뒤 냉장 보관 — 살아 있는 균이 들어 있어요']], clue: 'ing', clueText: '락토바실러스 · 「살아 있는 균」',
    answer: 'micro', choices: ['micro', 'gmo', 'farm', 'plant'],
    why: '락토바실러스는 유산균이에요. 살아 있는 유산균을 많이 키워(배양) 담았어요 — 미생물을 쓰는 생명 기술.' },

  { id: 'lactofree', kind: 'carton', tone: 'blu', art: '🥛', name: '속 편한 우유',
    marks: ['우유 마시면 배가 부글부글? 이제 그만'],
    type: '가공유', ing: '원유 99.9%, 락타아제',
    rows: [['만드는 법', '락타아제가 우유 속 유당을 포도당 · 갈락토스로 잘게 나눔']], clue: 'ing', clueText: '락타아제(「-아제」로 끝나면 효소 이름)',
    answer: 'enzyme', choices: ['enzyme', 'micro', 'gmo', 'breed'],
    why: '락타아제는 유당을 자르는 효소예요 — 「-아제」로 끝나는 이름은 효소! 유당이 불편한 사람도 마시기 편해요.' },

  { id: 'sikhye', kind: 'bottle', tone: 'org', art: '🍚', name: '살얼음 전통 식혜',
    marks: ['밥알 동동'],
    type: '식혜', ing: '쌀(국산), 엿기름(보리), 설탕, 정제수',
    rows: [['만드는 법', '엿기름 물에 밥을 담가 따뜻하게 4시간 삭힘']], clue: 'ing', clueText: '엿기름(싹 튼 보리) — 그 속의 효소',
    answer: 'enzyme', choices: ['enzyme', 'micro', 'breed', 'gmo'],
    why: '엿기름 속 효소가 밥의 녹말을 단맛(엿당)으로 바꿔요. 「삭힘」이라 해도 미생물 발효가 아니라 효소가 한 일 — 함정 카드!' },

  { id: 'watermelon', kind: 'tag', tone: 'grn', art: '🍉', name: '씨 없는 수박',
    marks: ['씨 뱉을 필요 없어요'],
    type: '과일', ing: '수박(국산)',
    rows: [['재배', '염색체 수가 다른 두 수박을 교배해 얻은 씨앗으로 키움']], clue: 'r0', clueText: '「두 수박을 교배해 얻은 씨앗」',
    answer: 'breed', choices: ['breed', 'gmo', 'farm', 'cell'],
    why: '유전자를 넣은 게 아니라 교배로 만든 새 품종 = 품종 개량. 「씨 없는」 = 유전자 변형이라고 착각하기 쉬워요!' },

  { id: 'rice', kind: 'bag', tone: 'paper', art: '🍚', name: '햇살 찰현미',
    marks: ['병에 강한 새 벼'],
    type: '쌀(현미)', ing: '현미(국산)',
    rows: [['벼 이야기', '병에 강한 벼와 밥맛 좋은 벼를 교배해 10년 동안 골라 키움']], clue: 'r0', clueText: '「두 벼를 교배해 골라 키움」',
    answer: 'breed', choices: ['breed', 'gmo', 'micro', 'farm'],
    why: '좋은 성질을 가진 벼끼리 교배하고 골라 키운 새 벼 = 품종 개량. 「병에 강한」만 보면 유전자 변형과 헷갈려요.' },

  { id: 'lettuce', kind: 'tray', tone: 'grn', art: '🥬', name: '아삭 꽃상추',
    marks: ['사계절 같은 맛'],
    type: '채소', ing: '상추(국산)',
    rows: [['재배', '실내 농장 — 센서가 빛 · 온도 · 물 · 양분을 재고 컴퓨터가 알아서 맞춤']], clue: 'r0', clueText: '센서 + 컴퓨터가 환경을 맞춤',
    answer: 'farm', choices: ['farm', 'gmo', 'breed', 'cell'],
    why: '센서와 컴퓨터가 작물이 자라는 환경을 맞춰 주는 농장 = 스마트팜 (생명 기술 + 정보 기술).' },

  { id: 'sprout', kind: 'tray', tone: 'blu', art: '🌱', name: '365 새싹채소',
    marks: ['흙 묻지 않은 깨끗한 잎'],
    type: '채소', ing: '새싹채소(국산)',
    rows: [['재배', '층층이 쌓은 선반에서 흙 없이 양분 물로 — 휴대폰으로 원격 관리']], clue: 'r0', clueText: '흙 없이 양분 물 · 휴대폰으로 원격 관리',
    answer: 'farm', choices: ['farm', 'micro', 'plant', 'enzyme'],
    why: '층층이 쌓은 실내 농장(수직 농장)에서 환경을 자동 · 원격으로 맞춰 키워요 = 스마트팜.' },

  { id: 'patty', kind: 'tray', tone: 'org', art: '🍔', name: '육즙 가득 버거 패티',
    marks: ['채식하는 친구도 OK'],
    type: '기타가공품', ing: '분리대두단백(콩), 밀글루텐(밀), 코코넛오일, 비트즙(빨간색)',
    rows: [['원료', '동물에게서 얻은 원료를 쓰지 않았어요']], clue: 'ing', clueText: '콩 · 밀 단백질 + 비트즙으로 고기 색',
    answer: 'plant', choices: ['plant', 'cell', 'farm', 'micro'],
    why: '고기가 아니라 콩 · 밀 단백질로 고기 같은 결과 색을 냈어요 = 식물성 대체육. 세포 배양과 헷갈리지 않기!' },

  { id: 'nugget', kind: 'box', tone: 'ink', art: '🍗', name: '미래 닭고기 너겟',
    marks: ['닭을 키우지 않은 닭고기?!'],
    type: '가상 미래 상품', ing: '닭 근육 세포, 세포 먹이(영양액), 밀가루, 해바라기유',
    rows: [['만드는 법', '닭에게서 떼어 낸 작은 세포를 큰 통에서 3주 동안 불려 키움']], clue: 'r0', clueText: '「세포를 큰 통에서 3주 동안 키움」',
    answer: 'cell', choices: ['cell', 'plant', 'gmo', 'breed'],
    why: '닭을 기르는 대신 닭 세포를 키워 고기를 만들어요 = 세포 배양 — 나라마다 허가가 다른 미래 식품.' },
];

// 한 판에 낼 카드 수. 기술 7가지가 한 번씩은 나오고 나머지는 무작위
export const PLAY_COUNT = 10;
export const ASK_SECONDS = 12;      // 카드 한 장 제한 시간 (단서를 읽어야 해서 10 → 12초)
export const REVEAL_SECONDS = 8;    // 정답 공개 뒤 저절로 다음 카드까지 (교사가 멈출 수 있다)
