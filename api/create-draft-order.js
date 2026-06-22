// api/create-draft-order.js
// 8284 Don't Worry — 주문페이지 제출 → Shopify Draft Order 생성
// 페이지가 이미 계산한 값(한화 기준)을 그대로 받아 라인아이템으로 변환.
// 엔드포인트: https://8284-api.vercel.app/api/create-draft-order

const CONFIG = {
  shopDomain: process.env.SHOPIFY_STORE_DOMAIN || "8284dontworry.myshopify.com",
  adminToken: process.env.SHOPIFY_ADMIN_TOKEN, // 커스텀앱 8284_주문관리 토큰
  apiVersion: "2025-10",

  // ★ 스토어 통화. 현재 스토어가 KRW라 "KRW"면 오늘 바로 결제까지 됨.
  //   나중에 스토어 기본통화를 VND로 바꾸면 "VND"로만 변경.
  storeCurrency: "KRW", // "KRW" | "VND"

  // ★ 국제배송 단가 (₩/kg). 페이지 계산과 동일하게 맞출 것.
  shipPerKg: 12000,

  allowedOrigins: [
    "https://8284dontworry.com",
    "https://www.8284dontworry.com",
    "https://8284dontworry.myshopify.com",
  ],
  tags: "korean-shopping,pending-confirm",
};

function setCors(req, res) {
  const origin = req.headers.origin;
  if (CONFIG.allowedOrigins.includes(origin))
    res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!CONFIG.adminToken)
    return res.status(500).json({ error: "SHOPIFY_ADMIN_TOKEN 환경변수 미설정" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { customer = {}, items = [], note = "", rate = 0 } = body || {};

    if (!customer.email) return res.status(400).json({ error: "고객 이메일 필수" });
    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: "주문 상품이 없음" });

    // 청구 통화 변환 (KRW 모드면 원화 그대로, VND 모드면 환율 적용)
    const r = Number(rate) || 0;
    const charge = (krw) =>
      CONFIG.storeCurrency === "VND"
        ? String(Math.round((Number(krw) || 0) * r))
        : String(Math.round(Number(krw) || 0));

    // ── 1) 상품 라인 (단가 = 한화 입력가) ──
    let totalWeightG = 0,
      totalCommKrw = 0;

    const line_items = items.map((it) => {
      const qty = Math.max(1, parseInt(it.quantity, 10) || 1);
      totalWeightG += Number(it.weightG) || 0;
      totalCommKrw += Number(it.commKrw) || 0;

      return {
        title: it.title || (it.mall ? `${it.mall} 상품` : "상품"),
        price: charge(it.krwPrice),
        quantity: qty,
        requires_shipping: false,
        taxable: false,
        properties: [
          ...(it.url ? [{ name: "Link", value: it.url }] : []),
          { name: "한화단가(₩)", value: String(it.krwPrice || 0) },
          { name: "용량(ml/g)", value: String(it.mlG || 0) },
          { name: "무게(g)", value: String(it.weightG || 0) },
        ],
      };
    });

    // ── 2) 수수료 5% 라인 (제품가 기준, 페이지와 동일) ──
    if (totalCommKrw > 0) {
      line_items.push({
        title: "Phí dịch vụ 5% · 수수료",
        price: charge(totalCommKrw),
        quantity: 1,
        requires_shipping: false,
        taxable: false,
      });
    }

    // ── 3) 배송 라인 (★서버에서 무게로 직접 계산 — 프론트 shipKrw에 의존 X) ──
    //   무게는 각 아이템 weightG 합산값(= (용량 + 포장300g) × 수량).
    const totalShipKrw = Math.round((totalWeightG / 1000) * CONFIG.shipPerKg);
    if (totalShipKrw > 0) {
      line_items.push({
        title: `Phí vận chuyển · 국제배송비 (${(totalWeightG / 1000).toFixed(2)}kg)`,
        price: charge(totalShipKrw),
        quantity: 1,
        requires_shipping: false,
        taxable: false,
      });
    }

    // ── 4) note (관리자 확정용) ──
    const noteLines = [
      `■ 고객: ${customer.name || "-"}`,
      `■ 연락처: ${customer.phone || "-"}`,
      `■ 배송지: ${customer.address || "-"}`,
      `■ 적용환율: 1 KRW = ${r} VND`,
      `■ 청구통화: ${CONFIG.storeCurrency}`,
      `■ 총무게(포장포함): ${(totalWeightG / 1000).toFixed(2)} kg`,
      `■ 배송비: ${totalShipKrw.toLocaleString()}원 (${CONFIG.shipPerKg.toLocaleString()}원/kg)`,
      "",
      "■ 요청 상품:",
      ...items.map(
        (it, i) =>
          `${i + 1}. ${it.title || (it.mall || "상품")} x${it.quantity || 1}  ` +
          `[${it.krwPrice || 0}원 / ${it.mlG || 0}ml·g]` +
          (it.url ? `\n   ${it.url}` : "")
      ),
      note ? `\n■ 메모: ${note}` : "",
      "",
      "※ 한화단가/무게 검증 후 [인보이스 보내기] 클릭",
    ];

    // ── 5) Draft Order 생성 ──
    const payload = {
      draft_order: {
        line_items,
        email: customer.email,
        note: noteLines.join("\n"),
        tags: CONFIG.tags,
        ...(customer.address
          ? {
              shipping_address: {
                address1: customer.address,
                name: customer.name || customer.email,
                phone: customer.phone || "",
                country_code: "VN",
              },
            }
          : {}),
      },
    };

    const url = `https://${CONFIG.shopDomain}/admin/api/${CONFIG.apiVersion}/draft_orders.json`;
    const apiRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": CONFIG.adminToken,
      },
      body: JSON.stringify(payload),
    });
    const data = await apiRes.json();
    if (!apiRes.ok)
      return res.status(apiRes.status).json({ error: "임시주문 생성 실패", detail: data });

    const d = data.draft_order;
    const storeHandle = CONFIG.shopDomain.replace(".myshopify.com", "");
    return res.status(200).json({
      ok: true,
      draftOrderId: d.id,
      adminUrl: `https://admin.shopify.com/store/${storeHandle}/draft_orders/${d.id}`,
      message: "임시주문 생성 완료",
    });
  } catch (err) {
    return res.status(500).json({ error: "서버 오류", detail: String(err) });
  }
}
