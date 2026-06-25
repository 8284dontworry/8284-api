// ============================================================
//  API/config.js  —  8284 비즈니스 상수 단일 소스 (Single Source of Truth)
// ------------------------------------------------------------
//  주문페이지 / calculate.js / create-draft-order.js 가
//  "모두 이 엔드포인트만" 읽습니다. → 상수는 이 한 곳에서만 관리됩니다.
//
//  앞으로 포장무게·배송단가·수수료를 바꾸려면
//  ★ 이 파일의 숫자만 고치면 ★ 전 페이지에 자동 반영됩니다. (그 외 수정 불필요)
//
//  호출 예:  https://8284-api.vercel.app/api/config
//  응답 예:  { "packagingG":300, "shipPerKg":12000, "commission":0.05, "maxKg":30 }
// ============================================================

// ▼▼▼ 여기 숫자만 바꾸면 전부 따라옵니다 ▼▼▼
const BIZ = {
  packagingG: 300,    // 품목당 포장(용기+완충재) 무게 (g)
  shipPerKg:  12000,  // 국제배송 단가 (원/kg)
  commission: 0.05,   // 구매대행 수수료 (제품가 기준, 5%)
  maxKg:      30,      // 1주문 최대 무게 (kg)
};
// ▲▲▲ 여기 숫자만 바꾸면 전부 따라옵니다 ▲▲▲

export default async function handler(req, res) {
  // CORS — Shopify 도메인(8284dontworry.com)에서 호출 가능하게
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // 엣지 공유 캐시 1시간 → 모든 페이지가 같은 값을 읽음
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

  res.status(200).json(BIZ);
}
