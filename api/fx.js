// ============================================================
//  API/fx.js  —  8284 단일 환율 소스 (Single Source of Truth)
// ------------------------------------------------------------
//  랜딩페이지 환율 카드 + 주문/견적 로직이 "모두 이 엔드포인트만" 호출합니다.
//  → 환율은 이 한 곳에서만 관리됩니다.
//
//  앞으로 수정할 일:  없음.
//   - 환율은 외부 소스에서 자동으로 갱신됩니다.
//   - 소스나 폴백값을 바꾸고 싶을 때만 "이 파일만" 고치면 됩니다.
//
//  호출 예:  https://8284-api.vercel.app/api/fx
//  응답 예:  { "rate": 17.32, "base":"KRW", "quote":"VND",
//             "live": true, "source":"open.er-api", "updatedAt":"..." }
//            → 1 KRW = rate VND
// ============================================================

// API가 모두 실패했을 때 쓰는 안전 환율 (1 KRW = ? VND)
const FALLBACK = 17.5;

// 엣지 캐시 시간(초). 이 시간 동안 랜딩/주문이 "동일한 값"을 읽습니다.
// 환율은 보통 하루 1회 갱신되므로 1시간 캐시면 충분히 신선하고, 두 화면이 항상 일치합니다.
const CACHE_SECONDS = 3600;

// 타임아웃 있는 fetch (주문 요청이 느린 소스 때문에 멈추지 않도록)
async function fetchJson(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 4000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

// 우선순위대로 시도 → 첫 번째 성공 값을 사용 (소스 하나가 죽어도 자동 폴백)
const SOURCES = [
  {
    name: 'open.er-api',
    get: async () => {
      const j = await fetchJson('https://open.er-api.com/v6/latest/KRW');
      const v = j && j.rates && j.rates.VND;
      if (v && isFinite(v)) return v;
      throw new Error('no VND');
    },
  },
  {
    name: 'jsdelivr',
    get: async () => {
      const j = await fetchJson('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/krw.json');
      const v = j && j.krw && j.krw.vnd;
      if (v && isFinite(v)) return v;
      throw new Error('no vnd');
    },
  },
];

export default async function handler(req, res) {
  // CORS — Shopify 도메인(8284dontworry.com)에서 호출할 수 있게
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // 엣지 공유 캐시 → 랜딩과 주문이 같은 캐시 값을 읽어 "완전 일치"
  res.setHeader(
    'Cache-Control',
    `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=86400`
  );

  let rate = FALLBACK;
  let source = 'fallback';
  let live = false;

  for (const s of SOURCES) {
    try {
      const v = await s.get();
      rate = Math.round(v * 10000) / 10000; // 소수점 4자리 정리
      source = s.name;
      live = true;
      break;
    } catch (e) {
      // 다음 소스로 넘어감
    }
  }

  res.status(200).json({
    rate,            // 1 KRW = rate VND  (예: 17.32)
    base: 'KRW',
    quote: 'VND',
    live,            // true=실시간 / false=폴백(소스 전부 실패 시)
    source,
    updatedAt: new Date().toISOString(),
  });
}

// ── 참고: 만약 프로젝트가 ESM(import/export)이 아니라 CommonJS라면,
//    위 'export default async function handler' 줄을 아래처럼 바꾸세요:
//
//      module.exports = async function handler(req, res) { ... }
//
//    (기존 create-draft-order.js 가 'export default'를 쓰면 ESM이라 위 코드 그대로 OK)
