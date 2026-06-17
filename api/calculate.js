// api/calculate.js
// 8284 Don't Worry — 한국 전체 쇼핑몰 가격+무게 자동 계산 API
// ✏️ 배송비 정책 변경 시 CONFIG만 수정하세요

const CONFIG = {
  shippingPerKg: 12000,  // KG당 배송비 (원)
  commission:    0.05,   // 수수료 5%
  maxWeightKg:   10,     // 최대 주문 무게
  fallbackRate:  17.5,   // 환율 기본값 (KRW→VND)
  packagingG:    40,     // 포장재 무게 (g)
};

// 카테고리별 기본 무게
const CATEGORY_WEIGHT = {
  'skin': 180, 'toner': 180, 'serum': 60, 'essence': 60,
  'cream': 130, 'lotion': 150, 'mask': 30, 'suncare': 100,
  'cleanser': 150, 'shampoo': 400, 'body': 400,
  'supplement': 150, 'vitamin': 100, 'collagen': 100,
  'lipstick': 20, 'foundation': 50, 'eyeshadow': 15,
  'fashion': 300, 'shoes': 800, 'bag': 500,
  'default': 200,
};

// 쇼핑몰 감지
function detectMall(url) {
  if (url.includes('oliveyoung'))   return 'oliveyoung';
  if (url.includes('coupang'))      return 'coupang';
  if (url.includes('musinsa'))      return 'musinsa';
  if (url.includes('kurly'))        return 'kurly';
  if (url.includes('zigzag'))       return 'zigzag';
  if (url.includes('ably'))         return 'ably';
  if (url.includes('29cm'))         return '29cm';
  if (url.includes('gmarket'))      return 'gmarket';
  if (url.includes('auction'))      return 'auction';
  if (url.includes('11st'))         return '11st';
  if (url.includes('smartstore') || url.includes('shopping.naver')) return 'naver';
  if (url.includes('daiso'))        return 'daiso';
  return 'other';
}

// JSON-LD 구조화 데이터에서 가격 추출 (가장 신뢰성 높음)
function extractFromJsonLd(html) {
  const ldMatches = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of ldMatches) {
    try {
      const json = JSON.parse(block.replace(/<script[^>]*>|<\/script>/gi, ''));
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        const product = item['@type'] === 'Product' ? item
          : item['@graph']?.find(i => i['@type'] === 'Product');
        if (!product) continue;
        const name  = product.name || '';
        const price = product.offers?.price || product.offers?.[0]?.price || 0;
        const image = product.image?.[0] || product.image || '';
        if (name && price) return { name, price: parseInt(String(price).replace(/[^0-9]/g,'')), image };
      }
    } catch (_) {}
  }
  return null;
}

// OG 메타 태그 추출 (범용)
function extractOgMeta(html) {
  const title = (html.match(/property="og:title"\s+content="([^"]+)"/i) || [])[1] || '';
  const image = (html.match(/property="og:image"\s+content="([^"]+)"/i) || [])[1] || '';
  const price = (html.match(/property="(?:og:price:amount|product:price:amount)"\s+content="([^"]+)"/i) || [])[1] || '';
  return { title: title.trim(), image, price: parseInt(price.replace(/[^0-9]/g,'')) || 0 };
}

// 쇼핑몰별 가격 패턴
function extractPriceMall(html, mall) {
  const patterns = {
    oliveyoung: [
      /class="[^"]*price-2[^"]*"[^>]*>[\s\S]{0,300}?(\d{1,3}(?:,\d{3})+)\s*원/i,
      /판매가[\s\S]{0,200}?(\d{1,3}(?:,\d{3})+)\s*원/i,
    ],
    coupang: [
      /"sellerPrice"\s*:\s*(\d+)/,
      /class="[^"]*total-price[^"]*"[^>]*>[\s\S]{0,100}?(\d{1,3}(?:,\d{3})+)/i,
      /"salePrice"\s*:\s*(\d+)/,
    ],
    musinsa: [
      /"price"\s*:\s*(\d+)/,
      /class="[^"]*price[^"]*"[^>]*>[\s\S]{0,100}?(\d{1,3}(?:,\d{3})+)\s*원/i,
    ],
    kurly: [
      /"price"\s*:\s*(\d+)/,
      /class="[^"]*price[^"]*"[^>]*>[\s\S]{0,100}?(\d{1,3}(?:,\d{3})+)/i,
    ],
    naver: [
      /"price"\s*:\s*(\d+)/,
      /discountedSalePrice[^:]*:\s*(\d+)/,
    ],
    default: [
      /판매가[\s\S]{0,200}?(\d{1,3}(?:,\d{3})+)\s*원/i,
      /"price"\s*:\s*(\d+)/,
      /"salePrice"\s*:\s*(\d+)/,
      /(\d{1,3}(?:,\d{3})+)\s*원[\s\S]{0,50}?장바구니/i,
      /class="[^"]*price[^"]*"[^>]*>[\s\S]{0,100}?(\d{1,3}(?:,\d{3})+)/i,
    ],
  };

  const mallPatterns = [...(patterns[mall] || []), ...patterns.default];
  for (const p of mallPatterns) {
    const m = html.match(p);
    if (m?.[1]) {
      const v = parseInt(m[1].replace(/,/g,''));
      if (v > 0 && v < 10000000) return v;
    }
  }
  return 0;
}

// 무게 자동 추출
function extractWeight(html) {
  const patterns = [
    /중량[\s\S]{0,80}?([0-9,]+\.?[0-9]*)\s*(ml|ML|mL|g|G|kg|KG)/,
    /용량[\s\S]{0,80}?([0-9,]+\.?[0-9]*)\s*(ml|ML|mL|g|G|kg|KG)/,
    /내용량[\s\S]{0,80}?([0-9,]+\.?[0-9]*)\s*(ml|ML|mL|g|G|kg|KG)/,
    /Volume[\s\S]{0,80}?([0-9,]+\.?[0-9]*)\s*(ml|ML|mL|g|G)/i,
    /"weight"\s*:\s*"?([0-9.]+)"?\s*,?\s*"weightUnit"\s*:\s*"?(g|kg)"?/i,
    /\b([0-9]+)\s*(ml|ML|mL)\b/,
    /\b([0-9]+)\s*g\b(?!\s*[이가을를은])/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (!m) continue;
    const val  = parseFloat(m[1].replace(/,/g,''));
    const unit = (m[2]||'g').toLowerCase();
    if (val <= 0 || val > 5000) continue;
    let g = 0;
    if (unit==='ml'||unit==='l'&&val<10) g = Math.round(val + CONFIG.packagingG);
    else if (unit==='g')                  g = Math.round(val + CONFIG.packagingG);
    else if (unit==='kg')                 g = Math.round(val*1000 + CONFIG.packagingG);
    if (g > 0) return { weight: g, source: 'auto', raw: `${val}${unit}` };
  }
  return null;
}

// 카테고리 키워드로 기본 무게 추정
function guessWeightFromContent(name, url) {
  const text = (name + url).toLowerCase();
  for (const [key, w] of Object.entries(CATEGORY_WEIGHT)) {
    if (key !== 'default' && text.includes(key)) return { weight: w, source: 'category' };
  }
  return { weight: CATEGORY_WEIGHT.default, source: 'default' };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: '상품 URL을 입력해주세요' });

  // 한국 쇼핑몰인지 확인
  const KOREAN_MALLS = ['oliveyoung','coupang','musinsa','kurly','zigzag','ably','29cm','gmarket','auction','11st','naver','shopping','smartstore','daiso','lohb','sivillage'];
  const isKorean = KOREAN_MALLS.some(m => url.includes(m));
  if (!isKorean) {
    return res.status(400).json({
      error: '한국 쇼핑몰 링크를 입력해주세요',
      errorVn: 'Vui lòng nhập link từ cửa hàng Hàn Quốc',
      supportedMalls: '올리브영, 쿠팡, 무신사, 마켓컬리, 지그재그, 에이블리, 29CM, G마켓 등'
    });
  }

  const mall = detectMall(url);

  try {
    // ── 1. 페이지 fetch ──
    const pageRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Referer': new URL(url).origin + '/',
      }
    });
    const html = await pageRes.text();

    // ── 2. 상품 정보 추출 (우선순위: JSON-LD → OG 메타 → 몰별 패턴) ──
    let name = '', krwPrice = 0, image = '';

    // JSON-LD (가장 신뢰성 높음)
    const ldData = extractFromJsonLd(html);
    if (ldData) { name = ldData.name; krwPrice = ldData.price; image = ldData.image; }

    // OG 메타
    const og = extractOgMeta(html);
    if (!name)     name     = og.title;
    if (!krwPrice) krwPrice = og.price;
    if (!image)    image    = og.image;

    // 몰별 패턴
    if (!krwPrice) krwPrice = extractPriceMall(html, mall);

    // 이미지 정리
    if (image && image.startsWith('//')) image = 'https:' + image;

    // ── 3. 무게 추출 ──
    const weightResult = extractWeight(html) || guessWeightFromContent(name, url);

    // ── 4. 실시간 환율 ──
    let exchangeRate = CONFIG.fallbackRate;
    try {
      const r = await fetch('https://open.er-api.com/v6/latest/KRW');
      const d = await r.json();
      if (d?.rates?.VND) exchangeRate = d.rates.VND;
    } catch (_) {}

    // ── 5. 쇼핑몰 이름 ──
    const mallNames = {
      oliveyoung:'올리브영', coupang:'쿠팡', musinsa:'무신사',
      kurly:'마켓컬리', zigzag:'지그재그', ably:'에이블리',
      '29cm':'29CM', gmarket:'G마켓', auction:'옥션',
      '11st':'11번가', naver:'네이버쇼핑', daiso:'다이소', other:'한국 쇼핑몰'
    };

    return res.json({
      success: true,
      mall: { id: mall, name: mallNames[mall] || '한국 쇼핑몰' },
      product: { name: name || '(제품명 조회 실패)', image, krwPrice, url },
      weight: {
        grams: weightResult.weight,
        source: weightResult.source,
        raw: weightResult.raw || null,
      },
      config: {
        shippingPerKg: CONFIG.shippingPerKg,
        commission: CONFIG.commission,
      },
      exchangeRate: Math.round(exchangeRate * 100) / 100,
    });

  } catch (err) {
    return res.status(500).json({
      error: '상품 정보를 가져오는 데 실패했습니다',
      errorVn: 'Không thể lấy thông tin sản phẩm',
      details: err.message
    });
  }
}
