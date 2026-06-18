// api/calculate.js
// 8284 Don't Worry — 한국 전체 쇼핑몰 가격+무게 자동 계산 API
// 🖊 배송비 정책 변경 시 CONFIG만 수정하세요

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
  if (url.includes('oliveyoung'))  return 'oliveyoung';
  if (url.includes('coupang'))     return 'coupang';
  if (url.includes('musinsa'))     return 'musinsa';
  if (url.includes('kurly'))       return 'kurly';
  if (url.includes('zigzag'))      return 'zigzag';
  if (url.includes('ably'))        return 'ably';
  if (url.includes('29cm'))        return '29cm';
  if (url.includes('daiso'))       return 'daiso';
  if (url.includes('naver'))       return 'naver';
  return 'unknown';
}

// 올리브영 내부 API로 상품 정보 가져오기
async function fetchOliveyoung(url) {
  try {
    // goodsNo 추출
    const match = url.match(/goodsNo=([A-Z0-9]+)/i);
    if (!match) throw new Error('goodsNo not found');
    const goodsNo = match[1];

    // 올리브영 상품 상세 API 호출
    const apiUrl = `https://www.oliveyoung.co.kr/store/ajax/getGoodsAjax.do?goodsNo=${goodsNo}`;
    const res = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.oliveyoung.co.kr/',
        'Accept': 'application/json, text/javascript, */*',
        'X-Requested-With': 'XMLHttpRequest',
      }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // 응답 파싱
    const goods = data?.goodsDetail || data?.result || data;
    const name = goods?.goodsNm || goods?.goodsName || goods?.name || null;
    const price = parseInt(goods?.price || goods?.goodsPrice || goods?.salePrice || 0);
    const image = goods?.imageUrl || goods?.goodsImgUrl || goods?.mainImageUrl || null;
    const weightG = parseInt(goods?.weight || goods?.netWeight || 0) || null;

    if (!name && !price) throw new Error('parse failed');

    return { name, price, image, weightG, source: 'oliveyoung-api' };
  } catch(e) {
    // API 실패시 페이지 직접 크롤링 시도
    return await fetchOliveyoungPage(url);
  }
}

// 올리브영 페이지 직접 크롤링 (fallback)
async function fetchOliveyoungPage(url) {
  try {
    const match = url.match(/goodsNo=([A-Z0-9]+)/i);
    const goodsNo = match ? match[1] : null;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Referer': 'https://www.oliveyoung.co.kr/',
      }
    });

    const html = await res.text();

    // 상품명 추출
    let name = null;
    const nameMatch = html.match(/"goodsNm"\s*:\s*"([^"]+)"/) ||
                      html.match(/class="prd-name"[^>]*>\s*<[^>]+>\s*([^<]+)/) ||
                      html.match(/<title>([^|<]+)/);
    if (nameMatch) name = nameMatch[1].trim();

    // 가격 추출
    let price = 0;
    const priceMatch = html.match(/"price"\s*:\s*"?(\d+)"?/) ||
                       html.match(/class="price-1"[^>]*>[\s\S]*?(\d[\d,]+)원/) ||
                       html.match(/finalPrice['"]\s*:\s*(\d+)/);
    if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));

    // 이미지 추출
    let image = null;
    const imgMatch = html.match(/"mainImageUrl"\s*:\s*"([^"]+)"/) ||
                     html.match(/id="mainImg"[^>]*src="([^"]+)"/);
    if (imgMatch) image = imgMatch[1];

    // 무게 추출
    let weightG = null;
    const weightMatch = html.match(/내용량[^>]*>[\s\S]*?(\d+(?:\.\d+)?)\s*(ml|g|ML|G)/i);
    if (weightMatch) weightG = parseFloat(weightMatch[1]);

    return { name, price, image, weightG, source: 'oliveyoung-page', goodsNo };
  } catch(e) {
    return { name: null, price: 0, image: null, weightG: null, source: 'failed' };
  }
}

// 일반 페이지 크롤링 (다른 쇼핑몰)
async function fetchGeneric(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      }
    });
    const html = await res.text();

    // OG 태그에서 추출
    const nameMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/) ||
                      html.match(/<title>([^<|–-]+)/);
    const priceMatch = html.match(/<meta[^>]+property="product:price:amount"[^>]+content="([^"]+)"/) ||
                       html.match(/"price"\s*:\s*"?(\d+)"?/);
    const imgMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/);

    // JSON-LD에서 추출
    const jsonLdMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
    let jsonPrice = 0, jsonName = null, jsonImage = null;
    if (jsonLdMatch) {
      try {
        const ld = JSON.parse(jsonLdMatch[1]);
        jsonName = ld.name || null;
        jsonPrice = parseInt(ld.offers?.price || ld.price || 0);
        jsonImage = ld.image || null;
      } catch(e) {}
    }

    const name = jsonName || (nameMatch ? nameMatch[1].trim() : null);
    const price = jsonPrice || (priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : 0);
    const image = jsonImage || (imgMatch ? imgMatch[1] : null);

    // 무게 추출
    let weightG = null;
    const weightMatch = html.match(/(\d+(?:\.\d+)?)\s*(ml|g|ML|G)(?:\s*[,\/]|\s*$)/i);
    if (weightMatch) weightG = parseFloat(weightMatch[1]);

    return { name, price, image, weightG, source: 'generic' };
  } catch(e) {
    return { name: null, price: 0, image: null, weightG: null, source: 'failed' };
  }
}

// 환율 가져오기
async function getExchangeRate() {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/KRW');
    const data = await res.json();
    return data?.rates?.VND || CONFIG.fallbackRate;
  } catch(e) {
    return CONFIG.fallbackRate;
  }
}

// 무게 추정
function estimateWeight(name, category, weightG) {
  if (weightG && weightG > 0) return { g: weightG + CONFIG.packagingG, source: '✓ 자동' };

  const text = (name || '').toLowerCase();
  for (const [key, w] of Object.entries(CATEGORY_WEIGHT)) {
    if (key !== 'default' && text.includes(key)) {
      return { g: w + CONFIG.packagingG, source: '≈ 카테고리' };
    }
  }
  return { g: CATEGORY_WEIGHT.default + CONFIG.packagingG, source: '≈ 기본값' };
}

// 메인 핸들러
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url, qty = 1 } = req.query;
  if (!url) return res.status(400).json({ error: 'url 파라미터가 필요합니다' });

  try {
    const mall = detectMall(url);

    // 쇼핑몰별 데이터 가져오기
    let productData;
    if (mall === 'oliveyoung') {
      productData = await fetchOliveyoung(url);
    } else {
      productData = await fetchGeneric(url);
    }

    const { name, price, image, weightG, source, goodsNo } = productData;
    const quantity = parseInt(qty) || 1;

    // 환율
    const exchangeRate = await getExchangeRate();

    // 무게 계산
    const weight = estimateWeight(name, mall, weightG);
    const totalWeightKg = (weight.g * quantity) / 1000;

    // 금액 계산
    const productTotal = price * quantity;
    const shippingKRW = Math.round(totalWeightKg * CONFIG.shippingPerKg);
    const commissionKRW = Math.round(productTotal * CONFIG.commission);
    const totalKRW = productTotal + shippingKRW + commissionKRW;
    const totalVND = Math.round(totalKRW * exchangeRate);
    const minVND = 10000;

    res.status(200).json({
      success: true,
      mall,
      product: {
        name: name || '상품명을 가져올 수 없습니다',
        price,
        image,
        url,
        goodsNo: goodsNo || null,
        weightSource: source,
      },
      weight: {
        perItemG: weight.g,
        totalKg: Math.round(totalWeightKg * 1000) / 1000,
        source: weight.source,
      },
      calculation: {
        quantity,
        productKRW: productTotal,
        shippingKRW,
        commissionKRW,
        totalKRW,
        exchangeRate,
        totalVND: Math.max(totalVND, minVND),
      },
      config: {
        shippingPerKg: CONFIG.shippingPerKg,
        commissionRate: CONFIG.commission,
      }
    });

  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
