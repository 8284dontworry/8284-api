// api/oauth.js — Shopify OAuth 헬퍼 (Admin API 토큰 1회 발급용)
// 방문: https://8284-api.vercel.app/api/oauth  → 승인 → 토큰이 화면에 표시됨

const CONFIG = {
  shop: process.env.SHOPIFY_STORE_DOMAIN || "8284dontworry.myshopify.com",
  clientId: process.env.SHOPIFY_CLIENT_ID,
  clientSecret: process.env.SHOPIFY_CLIENT_SECRET,
  scopes: "write_draft_orders,read_draft_orders",
  redirectUri: "https://8284-api.vercel.app/api/oauth",
};

export default async function handler(req, res) {
  const { code, shop } = req.query;

  if (!CONFIG.clientId || !CONFIG.clientSecret) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res
      .status(500)
      .send("<p>SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET 환경변수가 없습니다. Vercel에 먼저 넣어주세요.</p>");
  }

  // 1) code 없으면 → Shopify 승인 페이지로 보냄
  if (!code) {
    const authUrl =
      `https://${CONFIG.shop}/admin/oauth/authorize` +
      `?client_id=${CONFIG.clientId}` +
      `&scope=${encodeURIComponent(CONFIG.scopes)}` +
      `&redirect_uri=${encodeURIComponent(CONFIG.redirectUri)}`;
    res.writeHead(302, { Location: authUrl });
    return res.end();
  }

  // 2) code 받으면 → 액세스 토큰으로 교환
  try {
    const shopDomain = shop || CONFIG.shop;
    const r = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CONFIG.clientId,
        client_secret: CONFIG.clientSecret,
        code,
      }),
    });
    const data = await r.json();
    res.setHeader("Content-Type", "text/html; charset=utf-8");

    if (!data.access_token) {
      return res
        .status(400)
        .send(
          `<div style="font-family:sans-serif;padding:40px"><h2>토큰 교환 실패</h2><pre>${JSON.stringify(
            data,
            null,
            2
          )}</pre></div>`
        );
    }

    return res.status(200).send(`
      <div style="font-family:sans-serif;padding:40px;max-width:760px;margin:auto">
        <h2>✅ 토큰 발급 완료</h2>
        <p>아래 토큰을 복사해서 Vercel 환경변수 <b>SHOPIFY_ADMIN_TOKEN</b> 값에 넣으세요:</p>
        <textarea readonly style="width:100%;height:90px;font-size:15px;padding:10px;box-sizing:border-box">${data.access_token}</textarea>
        <p style="color:#888">한 번만 표시됩니다. 바로 복사해서 저장하세요.</p>
      </div>
    `);
  } catch (err) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(500).send("<p>오류: " + String(err) + "</p>");
  }
}
