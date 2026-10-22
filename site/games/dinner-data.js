// 15차시 「가족 저녁 회의」 데이터 — 교사가 고칠 수 있게 따로 둔다.
// 정답이 없는 토의다. 메뉴 정보는 어느 한쪽을 좋게 · 나쁘게 몰지 않게 쓴다.
// 건강에 좋다 · 나쁘다는 단정은 쓰지 않는다(연구 중이거나 제품마다 다른 것은 그렇다고 쓴다).
// 상황 카드도 공정하게: 가격 · 가족 사정 · 손님 · 숙제처럼 「고르는 기준」을 흔드는 일만 쓰고, 건강 효능은 지어내지 않는다.

// 근거 버튼 6개 (bit = 입력 rs 의 자리)
export const REASONS = [
  { id: 'health', bit: 1,  label: '건강', emoji: '🏥' },
  { id: 'price',  bit: 2,  label: '가격', emoji: '💰' },
  { id: 'taste',  bit: 4,  label: '맛',   emoji: '😋' },
  { id: 'env',    bit: 8,  label: '환경', emoji: '🌍' },
  { id: 'animal', bit: 16, label: '동물', emoji: '🐾' },
  { id: 'nutr',   bit: 32, label: '영양', emoji: '🥗' },
];

// 정보 카드 줄 이름 (날마다 쓰는 줄이 다르다)
export const ROW_DEFS = {
  price:  { label: '가격', emoji: '💰' },
  nutr:   { label: '영양', emoji: '🥗' },
  health: { label: '몸',   emoji: '🏥' },
  env:    { label: '환경', emoji: '🌍' },
  taste:  { label: '맛',   emoji: '😋' },
  animal: { label: '동물', emoji: '🐾' },
  label:  { label: '표시', emoji: '🔎' },
};

// 역할 카드. 앞 4개가 기본(4명 팀), 5명이면 아빠, 6명이면 삼촌, 7명이면 할아버지가 더해진다.
// cares = 이 역할이 중요하게 여기는 근거(REASONS id). lines = 어느 날에나 쓰는 대사(🔁 다른 대사)
// 역할은 날마다 한 칸씩 돌아간다 — 같은 학생이 여러 가족의 입장이 되어 본다.
export const ROLES = [
  { id: 'grandma', name: '할머니', emoji: '👵', cares: ['health', 'taste'], care: '건강 · 익숙한 맛',
    lines: ['「뭘 먹든 무엇으로 만들었는지는 알고 먹자꾸나.」'] },
  { id: 'mom', name: '엄마', emoji: '👩', cares: ['price', 'nutr'], care: '가격 · 영양',
    lines: ['「영양은 챙기면서 가격표도 같이 보자.」'] },
  { id: 'sib', name: '동생', emoji: '🧒', cares: ['taste'], care: '맛 (그리고 재미)',
    lines: ['「맛있으면 다 좋아! 새로운 것도 한번 먹어 볼래!」'] },
  { id: 'me', name: '나', emoji: '🧑', cares: ['env', 'animal'], care: '환경 · 동물',
    lines: ['「지구와 동물도 덜 힘든 방법이 있으면 그걸 고르고 싶어.」'] },
  { id: 'dad', name: '아빠', emoji: '👨', cares: ['taste', 'price'], care: '맛 · 가격',
    lines: ['「배부르고 맛있고 값도 착한 걸로 하자!」'] },
  { id: 'uncle', name: '삼촌', emoji: '🧔', cares: ['nutr', 'env'], care: '영양 · 환경',
    lines: ['「새 기술로 만든 음식도 표시를 꼼꼼히 읽으면 고를 수 있지.」'] },
  { id: 'grandpa', name: '할아버지', emoji: '👴', cares: ['health', 'price'], care: '건강 · 아껴 쓰기',
    lines: ['「처음 보는 음식이면 어떻게 만들었는지부터 알려 주렴.」'] },
];
export const FAMILY = { id: 'family', name: '우리 가족', emoji: '👪', cares: [], care: '팀이 함께 정하기', lines: ['「모두의 생각을 듣고 하나로 정하자!」'] };

// 사흘 동안의 가족 회의. menus = 메뉴 3가지(rows = 정보 카드, 값은 예시 — 제품 · 연구에 따라 다르다)
// say = 그날 역할 대사, twists = 상황 카드(회의 뒤 한 장을 뽑는다. who = 특히 신경 쓸 역할, about = 관련 근거)
export const ROUNDS = [
  {
    id: 'meat', day: '월요일 저녁', topic: '고기 반찬', emoji: '🍖',
    q: '오늘 저녁 고기 반찬, 무엇으로 할까?',
    rows: ['price', 'nutr', 'env', 'taste', 'animal'],
    menus: [
      { id: 'cult', name: '배양육 스테이크', emoji: '🧫', tech: '세포 배양',
        rows: {
          price:  '아직 비싼 편 — 많이 만들면 내려갈 수도',
          nutr:   '고기처럼 단백질을 갖추도록 연구 중',
          env:    '땅 · 물을 덜 쓸 거라는 기대 — 배양에 드는 에너지에 따라 다름',
          taste:  '먹어 본 사람이 아직 적다',
          animal: '소에게서 떼어 낸 세포를 키운다 — 도축하지 않는다',
        } },
      { id: 'hanwoo', name: '한우 구이', emoji: '🐄', tech: '품종 개량 · 축산',
        rows: {
          price:  '비싼 편 — 부위마다 차이가 크다',
          nutr:   '단백질 · 철분이 많다 · 부위에 따라 지방도 많다',
          env:    '사료 · 물 · 땅이 많이 들고 메탄(온실가스)이 나온다',
          taste:  '익숙하고 맛있다는 사람이 많다',
          animal: '소를 길러 도축한다',
        } },
      { id: 'soy', name: '콩고기 불고기', emoji: '🫘', tech: '식물성 대체육',
        rows: {
          price:  '한우보다 싼 편 — 제품마다 다르다',
          nutr:   '식물성 단백질 · 나트륨은 제품마다 달라 표시 확인',
          env:    '가축보다 땅 · 물 · 온실가스가 적은 편',
          taste:  '고기와 식감이 조금 다르다는 사람이 많다',
          animal: '동물을 쓰지 않는다',
        } },
    ],
    say: {
      grandma: '「처음 보는 고기? 할미는 늘 먹던 게 속이 편하더라~」',
      mom:     '「이번 달 장보기 예산이 빠듯해! 영양도 챙기면서 아낄 수 없을까?」',
      sib:     '「고기 맛이 안 나면 안 먹을 거야! …근데 배양육은 궁금해!」',
      me:      '「소가 트림할 때 온실가스(메탄)가 나온대. 지구도 생각하자!」',
      dad:     '「고기는 역시 한우지! …근데 가격 보고 깜짝 놀랐어.」',
      uncle:   '「운동하려면 단백질이 중요해. 영양 표시부터 보자!」',
      grandpa: '「아껴 써야지. 그래도 몸에 맞는 걸로 먹자.」',
    },
    twists: [
      { emoji: '💸', head: '배양육 반값 세일!', body: '오늘만 배양육 스테이크가 한우의 절반 값이래요.', who: ['mom', 'dad', 'grandpa'], about: 'price' },
      { emoji: '🩺', head: '할머니 건강검진 — 콜레스테롤 주의', body: '의사 선생님이 기름진 고기는 조금 줄이자고 하셨어요.', who: ['grandma'], about: 'health' },
      { emoji: '🥗', head: '동생 친구가 같이 먹어요', body: '그 친구는 채식을 해서 고기를 먹지 않아요. 배양육은 채식일까, 아닐까?', who: ['sib', 'me'], about: 'animal' },
      { emoji: '🚜', head: '한우 농가 견학을 다녀왔어요', body: '농부 아저씨가 소를 정성껏 키우는 모습을 봤어요. 우리 동네 농가를 돕고 싶다는 가족도 있어요.', who: ['grandma', 'dad'], about: null },
    ],
  },
  {
    id: 'milk', day: '수요일 저녁', topic: '내일 아침 음료', emoji: '🥛',
    q: '내일 아침에 마실 음료, 무엇으로 살까?',
    rows: ['price', 'nutr', 'health', 'taste', 'env'],
    menus: [
      { id: 'milk', name: '보통 우유', emoji: '🥛', tech: '품종 개량 · 축산(젖소)',
        rows: {
          price:  '셋 가운데 싼 편',
          nutr:   '단백질 · 칼슘이 들어 있다',
          health: '유당이 있어 마시면 배가 불편한 사람도 있다',
          taste:  '늘 먹던 익숙한 맛',
          env:    '젖소를 기르는 데 사료 · 물 · 땅이 들고 메탄이 나온다',
        } },
      { id: 'lacto', name: '락토프리 우유', emoji: '🍼', tech: '효소 이용',
        rows: {
          price:  '보통 우유보다 조금 비싼 편',
          nutr:   '보통 우유와 비슷 — 유당만 효소로 잘게 나눴다',
          health: '유당이 불편한 사람도 마시기 편하다',
          taste:  '유당이 나뉘어 조금 더 달게 느껴진다',
          env:    '젖소 우유라서 보통 우유와 비슷하다',
        } },
      { id: 'oat', name: '귀리 음료', emoji: '🌾', tech: '식물성 음료 · 효소 이용',
        rows: {
          price:  '우유보다 비싼 편 — 제품마다 다르다',
          nutr:   '우유보다 단백질이 적은 편 · 칼슘은 제품마다 달라 표시 확인',
          health: '유당이 없다',
          taste:  '고소하지만 우유 맛과는 다르다',
          env:    '젖소보다 땅 · 물 · 온실가스가 적은 편',
        } },
    ],
    say: {
      grandma: '「아침엔 따뜻한 우유 한 잔이지~ 늘 먹던 걸로!」',
      mom:     '「우유 값도 올랐더라. 영양은 챙기되 너무 비싼 건 곤란해.」',
      sib:     '「달달한 게 좋아! 락토프리 우유가 더 달다던데?」',
      me:      '「젖소 대신 귀리로 만든 음료는 온실가스가 적대. 바꿔 볼까?」',
      dad:     '「아침은 바쁘니까 맛있고 싼 걸로 빨리 정하자!」',
      uncle:   '「귀리 음료는 단백질이 적은 편이래. 운동하는 나는 고민이야.」',
      grandpa: '「몸에 맞는지가 먼저다. 값도 따져 보고.」',
    },
    twists: [
      { emoji: '😣', head: '할머니 배가 부글부글', body: '할머니는 우유만 마시면 배가 아프대요 — 유당이 잘 소화되지 않는 몸이래요.', who: ['grandma'], about: 'health' },
      { emoji: '📏', head: '동생 키 크기 작전', body: '성장기 동생 — 단백질 · 칼슘을 잘 챙기라는 말을 들었어요.', who: ['sib', 'mom', 'uncle'], about: 'nutr' },
      { emoji: '🎁', head: '귀리 음료 1+1 행사!', body: '이번 주만 귀리 음료를 하나 사면 하나를 더 줘요.', who: ['mom', 'dad', 'grandpa'], about: 'price' },
      { emoji: '🌍', head: '기후 수업 숙제', body: '이번 주 숙제: 「우리 집 식탁에서 온실가스를 줄이는 방법」을 실천하고 써 오기!', who: ['me', 'uncle'], about: 'env' },
    ],
  },
  {
    id: 'bean', day: '금요일 저녁', topic: '콩 반찬', emoji: '🫘',
    q: '오늘 저녁 콩 반찬, 무엇으로 할까?',
    rows: ['price', 'nutr', 'taste', 'env', 'label'],
    menus: [
      { id: 'tofu-k', name: '국산 콩 두부 부침', emoji: '🌱', tech: '품종 개량(국산 콩)',
        rows: {
          price:  '비싼 편',
          nutr:   '식물성 단백질이 많다',
          taste:  '고소하다는 사람이 많다',
          env:    '가까운 밭에서 와 옮기는 거리가 짧다',
          label:  '원재료명 「대두(국산)」',
        } },
      { id: 'tofu-i', name: '수입 콩 두부 부침', emoji: '🚢', tech: '유전자 변형 콩',
        rows: {
          price:  '싼 편',
          nutr:   '식물성 단백질이 많다',
          taste:  '제품마다 다르다 — 먹어 보고 정하자',
          env:    '먼 나라에서 배로 실어 온다',
          label:  '「유전자변형 콩 포함」 — 걱정하는 사람도, 괜찮다는 사람도 있다',
        } },
      { id: 'cgj', name: '청국장 찌개', emoji: '🍲', tech: '발효(미생물)',
        rows: {
          price:  '보통',
          nutr:   '콩을 미생물이 발효한 음식 · 나트륨(소금)은 확인',
          taste:  '냄새가 강해 좋아하는 사람과 싫어하는 사람이 갈린다',
          env:    '콩이 어디서 왔는지에 따라 다르다',
          label:  '원재료명에서 콩의 원산지를 확인',
        } },
    ],
    say: {
      grandma: '「청국장은 할미가 좋아하는 맛이지! 냄새 좀 나도 괜찮아~」',
      mom:     '「수입 콩 두부가 훨씬 싸네? 표시도 같이 읽어 보자.」',
      sib:     '「청국장 냄새는 싫어! 두부 부침이 좋아!」',
      me:      '「멀리서 배로 실어 온 콩보다 가까운 콩이 옮기는 거리가 짧겠지?」',
      dad:     '「두부 맛은 먹어 보면 알지! 그럼 싼 걸로 해 볼까?」',
      uncle:   '「콩은 식물성 단백질이 많아. 어느 쪽이든 영양 표시를 보자.」',
      grandpa: '「「유전자변형 콩 포함」? 무슨 뜻인지 알고 먹자꾸나.」',
    },
    twists: [
      { emoji: '💳', head: '이번 주 식비 비상!', body: '갑자기 돈 쓸 일이 생겨 이번 주 장보기는 아껴야 해요.', who: ['mom', 'dad', 'grandpa'], about: 'price' },
      { emoji: '🔎', head: '할머니: 「표시부터 보자」', body: '할머니가 무엇으로 · 어떻게 만들었는지 표시를 꼭 읽고 고르자고 하셨어요.', who: ['grandma', 'grandpa'], about: null },
      { emoji: '👃', head: '냄새에 예민한 손님이 와요', body: '오늘 저녁, 냄새에 예민한 손님이 함께 먹어요.', who: ['sib', 'dad'], about: 'taste' },
      { emoji: '🌧️', head: '국산 콩 농사가 흉년', body: '올해 비가 많이 와서 국산 콩 값이 더 올랐대요.', who: ['mom', 'grandpa'], about: 'price' },
    ],
  },
];

// 시간(초)
export const VOTE1_SECONDS = 20;   // 첫 마음(혼자, 역할대로)
export const TALK_SECONDS = 90;    // 입으로 하는 가족 회의
export const TWIST_SECONDS = 30;   // 상황 카드 읽고 짧은 회의
export const VOTE2_SECONDS = 30;   // 다시 투표(메뉴 + 근거)
export const TIE_TALK_SECONDS = 30;  // 동률! 30초 더 회의
export const TIE_VOTE_SECONDS = 20;  // 동률 팀만 다시 투표
export const SWAY_MIN = 2;         // 🗣️ 설득상: 첫 마음과 달랐다가 가족 결정 쪽으로 온 사람이 이만큼 이상(한 명 바뀐 건 흔하다)
export const SWAY_MAX = 2;         //   하루에 많아야 두 가족(셋 이상 똑같으면 그날은 없음)
export const MAX_REASONS = 2;      // 한 사람이 고르는 근거 수(대신 누르기는 제한 없음)

// 정리 화면 — 식품 생산 생명 기술이 가족 식생활에 미치는 영향
export const WRAP = [
  { emoji: '🛒', head: '고를 수 있는 것이 늘었다', body: '배양육 · 식물성 대체육 · 락토프리 우유 · 유전자 변형 콩 · 발효 식품 — 생명 기술이 식탁의 선택지를 바꾼다' },
  { emoji: '⚖️', head: '고르는 기준은 사람마다 · 날마다 다르다', body: '가격 · 건강 · 맛 · 환경 · 동물 — 가족 사정이 바뀌면 결정도 바뀐다. 근거를 들어 이야기해야 정할 수 있다' },
  { emoji: '🔎', head: '표시를 읽어야 고를 수 있다', body: '무엇으로 · 어떻게 만들었는지 식품 표시와 정보를 확인한다' },
];
