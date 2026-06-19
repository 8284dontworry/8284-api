export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: `한국 쇼핑몰 상품 URL을 받아서 상품 정보를 추출하는 전문가야.
반드시 JSON만 응답해. 마크다운 코드블록 없이 순수 JSON만.
{
  "name": "상품명",
  "price": 숫자(원화 실제 결제금액),
  "weightG": 숫자(그램, 없으면 카테고리 추정),
  "mall": "oliveyoung/musinsa/coupang/kurly/zigzag/ably/29cm/daiso/naver 중 하나",
  "weightSource": "page(직접감지) 또는 estimated(추정)",
  "image": "상품 대표 이미지 URL (없으면 빈 문자열)"
}
무게 추정: 화장품소용량150g/화장품일반300g/화장품대용량500g/의류400g/신발700g/식품400g/영양제350g/기타300g`,
        messages: [{ role: 'user', content: `상품 정보 추출해줘: ${url}` }]
      })
    });

    const data = await response.json();
    let resultText = '';
    for (const block of (data.content || [])) {
      if (block.type === 'text') resultText += block.text;
    }

    const jsonMatch = resultText.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'AI가 상품 정보를 읽지 못했어요' });

    const product = JSON.parse(jsonMatch[0]);
    if (!product.price || product.price === 0) {
      return res.status(500).json({ error: '가격을 찾지 못했어요' });
    }

    return res.status(200).json({ success: true, product });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
