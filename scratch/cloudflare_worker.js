/**
 * JJKICKSZZ AI — Cloudflare Worker
 * Fetches live Shopify catalog and powers the AI curator via Google Gemini.
 *
 * ENV VARS required in Cloudflare dashboard:
 *   GEMINI_API_KEY  — from https://aistudio.google.com
 */

const SHOPIFY_DOMAIN = "jjkickszz.com";

// Infer clothing category from product title — order matters: specific before generic
function getCategory(title) {
  const t = title.toUpperCase();
  // Sneakers first (some have "AIR" which would match other patterns)
  if (/SNEAKER|JORDAN|YEEZY|DUNK|AIR MAX|NEW BALANCE|ADIDAS|SHOE|\bBOOT\b|TRAINER/.test(t)) return "Sneakers";
  // Bottoms
  if (/MESH SHORT|CAMO SHORT|INSOMNIA|DETENTION SHORT|SKULL.*SHORT/.test(t)) return "Shorts";
  if (/\bSHORTS\b/.test(t)) return "Shorts";
  if (/PANT|JEAN|DENIM|TROUSER|CARGO/.test(t)) return "Pants";
  // Outerwear / Jackets
  if (/JACKET|COAT|BOMBER|PARKA|WINDBREAKER|FLANNEL/.test(t)) return "Jacket";
  // Hoodies / Crewnecks
  if (/HOODIE|SWEATSHIRT|CREWNECK|\bCREW\b|FLEECE/.test(t)) return "Hoodie";
  // Longsleeves — check BEFORE "short sleeve" to avoid conflict
  if (/LONGSLEEVE|LONG SLEEVE|LONG-SLEEVE|\bLS\b|THERMAL|RAGLAN/.test(t)) return "Longsleeve";
  // SHORT SLEEVE = a shirt/tee, NOT shorts — must come after shorts check
  if (/SHORT SLEEVE|SHORT-SLEEVE/.test(t)) return "Tee";
  // Jerseys and Rugby shirts count as Shirts
  if (/JERSEY|RUGBY|BASEBALL/.test(t)) return "Shirt";
  // Shirts (button-up style)
  if (/\bSHIRT\b/.test(t)) return "Shirt";
  // Tees
  if (/\bTEE\b|T-SHIRT/.test(t)) return "Tee";
  // Accessories
  if (/\bHAT\b|\bCAP\b|BEANIE/.test(t)) return "Hat";
  if (/\bBAG\b|TOTE|BACKPACK/.test(t)) return "Bag";
  // Sets
  if (/SET|NYLON SET/.test(t)) return "Set";
  return "Apparel";
}

// Fetch all available products from Shopify public REST API
async function getLiveCatalog(env) {
  try {
    const shopifyToken = env ? (env.SHOPIFY_ADMIN_TOKEN || env.SHOPIFY_TOKEN) : null;
    let url = `https://${SHOPIFY_DOMAIN}/collections/all/products.json?limit=250`;
    let headers = {
      "Accept": "application/json",
      "User-Agent": "JJKICKSZZ-AI-Bot/1.0"
    };

    if (shopifyToken) {
      url = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/products.json?limit=250`;
      headers["X-Shopify-Access-Token"] = shopifyToken;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(url, {
      headers,
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) return { error: `HTTP ${res.status} from Shopify`, products: null };
    const json = await res.json();
    const products = json.products || [];
    if (!products.length) return { error: "No products returned", products: null };

    // Filter to only available products with at least one image
    const validProducts = products.filter(p => 
      p.images && 
      p.images.length > 0 && 
      p.variants && 
      p.variants.some(v => {
        if (typeof v.available !== 'undefined') return v.available;
        if (v.inventory_management === null || v.inventory_management === '') return true;
        return (v.inventory_quantity !== undefined && v.inventory_quantity > 0) || v.inventory_policy === 'continue';
      })
    );

    // Sort by ID descending (newest first)
    const sorted = validProducts.sort((a, b) => b.id - a.id);

    // Keep top 15 newest items at the top to prioritize fresh arrivals
    const newest = sorted.slice(0, 15);
    const rest = sorted.slice(15);

    // Fisher-Yates shuffle on the remaining products to add variety and prevent repetitive recommendations
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = rest[i];
      rest[i] = rest[j];
      rest[j] = temp;
    }

    const shuffledCatalog = [...newest, ...rest];

    const lines = shuffledCatalog.map(p => {
      const price = `$${parseFloat(p.variants[0].price).toFixed(0)}`;
      // Prefer Shopify's product_type field — fall back to title inference
      const cat = (p.product_type && p.product_type.trim())
        ? p.product_type.trim()
        : getCategory(p.title);
      return `${p.title} | ${cat} | ${price} | handle:${p.handle}`;
    });

    return { error: null, products: lines.join("\n"), count: lines.length };
  } catch (e) {
    return { error: e.message, products: null };
  }
}

function buildSystemPrompt(catalog) {
  const catalogBlock = catalog
    ? `## LIVE INVENTORY (${catalog.split("\n").length} items available right now)
Format per line: Name | Category | Price | handle:xxx

${catalog}

## PRODUCT RECOMMENDATION RULES
- To recommend a product write EXACTLY: [Product: handle] — nothing else
- Example: "Check the AMIRI MA TEE [Product: amiri-ma-tee]"
- ONLY use handles that appear in the live inventory above
- NEVER fabricate a handle`
    : `## INVENTORY (limited fallback — update worker)
- 2 IN 1 HYBRID TEE | Tee | $200 | handle:2-in-1-hybrid-tee [Product: 2-in-1-hybrid-tee]
- AFTER LIFE TEE | Tee | $189 | handle:after-life-tee [Product: after-life-tee]
- AMIRI MA CORE LOGO TEE | Tee | $220 | handle:amiri-ma-core-logo-tee [Product: amiri-ma-core-logo-tee]
- BALECIAGA INSIDE OUT ARMY SHIRT | Shirt | $350 | handle:baleciaga-inside-out-army-shirt [Product: baleciaga-inside-out-army-shirt]`;

  return `You are the JJKICKSZZ AI Outfit Curator. You work for JJKICKSZZ.com — a premium sneaker and streetwear boutique.
Speak like a knowledgeable plug. Short, real, confident. Never robotic or corporate.

## STORE FAQ & KNOWLEDGE BASE (IMPORTANT — USE THIS TO ANSWER USER INQUIRIES)
### 1. BRAND-SPECIFIC SIZING & FIT GUIDE
- Yeezy (350, 700, Slides): Runs small. Advise going half a size up (0.5 size up) from Nike size. For Yeezy Slides, go a full size up if in between sizes.
- Jordan (1, 3, 4, 11): True to size (TTS). Jordan 4s can be narrow, so wide feet should go half a size up.
- New Balance (990, 2002R, 550, 9060): TTS, extremely comfortable.
- Amiri (Tees, Hoodies, Jeans): Slim fit. Sizing up is recommended for a standard/relaxed fit.
- Chrome Hearts (Tees, Hoodies): Thick cotton, standard US boxy sizing, generally TTS.
- Corteiz & Trapstar (Tracksuits, Hoodies): UK streetwear fit, fits baggy/loose, generally TTS.
- Denim Tears (Hoodies, Wreath Jeans): Wreath Hoodies are TTS but cropped; Wreath Jeans have no stretch (standard Levi 501 fit), advise TTS.
- Sp5der (Hoodies, Sweatpants): Boxy/cropped streetwear fit. Recommend TTS.

### 2. SHIPPING & DELIVERY
- Processing: 1-3 business days.
- Delivery: 5-8 business days standard shipping.
- Free shipping: Orders over $400 USD automatically qualify for free shipping.
- Worldwide shipping: Yes, we ship internationally. Taxes/duties are calculated at delivery.

### 3. RETURN & EXCHANGE POLICY
- ALL SALES ARE FINAL. No returns, refunds, or size exchanges are accepted. Sizing advice should be checked beforehand.

### 4. SNEAKER & APPAREL CARE
- Sneaker care: Brush cleaning only, keep water away from suede/nubuck (like Jordan 4s). Never machine wash.
- Clothing care: Wash inside out in cold water, hang dry to prevent graphics from cracking or garments shrinking.

### 5. ORDER TRACKING & CUSTOMER SERVICE
- Tracking: An email with tracking link is automatically sent when the order ships.
- Order Status: If a customer inputs their order number (e.g. #1005), our automatic system retrieves tracking live.
- Customer support: Email support@jjkickszz.com or submit the Ask a Question form for escalation.

### 6. RESTOCKS
- Sourced products are highly limited. Restocks are rare. Follow JJKICKSZZ on Instagram for restock alerts.

${catalogBlock}

## OUTFIT BUILDING RULES — READ CAREFULLY
An outfit is clothes worn TOGETHER at the same time:
- TOP layer = ONE item (Tee, Shirt, Hoodie, Jacket, or Longsleeve) — NEVER recommend two tops
- BOTTOM layer = ONE item (Shorts or Pants) — recommend from inventory if available
- A Shirt goes OVER a Tee. A Tee does NOT go over another Tee.
- If no bottoms/sneakers exist in inventory, say so honestly — never pretend
- When building outfits: pick items from DIFFERENT categories only

## RESPONSE FORMAT RULES
- Be brief: 2-3 short paragraphs MAX, under 120 words
- Use line breaks between sections — NEVER one wall of text
- For outfit recommendations, use this exact format per item:
  **[Category]:** Product Name [Product: handle]
- Always end with one short follow-up question`;
}

// ── Auto-Enrichment Helpers (Shopify Webhook → Gemini Vision → Shopify Update) ──

const ENRICH_PROMPT = `You are a streetwear expert. Given a product title and image, return ONLY this JSON:
{"category":"<Tee|Shirt|Longsleeve|Hoodie|Jacket|Shorts|Pants|Set|Hat|Sneakers|Apparel>","description":"<50-70 word premium streetwear product description>"}`;

async function imageToBase64(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "JJKICKSZZ-AI/1.0" } });
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  } catch { return null; }
}

async function enrichProduct(product, geminiKey, shopifyToken) {
  const title = product.title;
  const imgUrl = product.images?.[0]?.src;
  const imgB64 = imgUrl ? await imageToBase64(imgUrl) : null;

  const parts = [{ text: `Product: ${title}` }];
  if (imgB64) parts.push({ inline_data: { mime_type: "image/jpeg", data: imgB64 } });

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: ENRICH_PROMPT }] },
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 250 }
      })
    }
  );
  const gData = await geminiRes.json();
  let raw = gData?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  raw = raw.replace(/```json|```/g, "").trim();
  const { category = "Apparel", description = "" } = JSON.parse(raw);

  // Write back to Shopify
  const update = { product: { id: product.id } };
  if (!(product.product_type || "").trim()) update.product.product_type = category;
  if (!(product.body_html || "").trim()) update.product.body_html = `<p>${description}</p>`;

  await fetch(
    `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/products/${product.id}.json`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": shopifyToken
      },
      body: JSON.stringify(update)
    }
  );
  return { category, description };
}
// ─────────────────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {

    // CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const geminiKey = env.GEMINI_API_KEY;

    // GET debug routes
    if (request.method === "GET") {
      const { searchParams } = new URL(request.url);

      // ?action=catalog — see what Gemini receives
      if (searchParams.get("action") === "catalog") {
        const result = await getLiveCatalog(env);
        const body = result.error
          ? `❌ Catalog fetch failed: ${result.error}`
          : `✅ ${result.count} products loaded:\n\n${result.products}`;
        return new Response(body, {
          headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" }
        });
      }

      // ?test=YOUR QUESTION — raw Gemini test (no system prompt)
      if (searchParams.get("test") && geminiKey) {
        const prompt = searchParams.get("test");
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] })
          }
        );
        return new Response(JSON.stringify(await res.json(), null, 2), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      return new Response(
        geminiKey ? "✅ JJKICKSZZ AI online. Use ?action=catalog to inspect inventory." : "⚠️ GEMINI_API_KEY not set.",
        { headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" } }
      );
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    if (!geminiKey) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured." }), {
        status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    // Shopify Webhook enrichment route
    const urlObj = new URL(request.url);

    // ── OAuth Route: Initiate install flow ──
    if (urlObj.pathname === "/auth" || urlObj.pathname.endsWith("/auth")) {
      const shop = urlObj.searchParams.get("shop") || "jjkickszz.myshopify.com";
      const clientId = env.SHOPIFY_CLIENT_ID;
      if (!clientId) {
        return new Response("Error: SHOPIFY_CLIENT_ID environment variable not configured in Cloudflare settings.", { status: 400 });
      }
      const redirectUri = `https://${urlObj.hostname}/auth/callback`;
      const authorizeUrl = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=read_products,write_products&redirect_uri=${encodeURIComponent(redirectUri)}`;
      return Response.redirect(authorizeUrl, 302);
    }

    // ── OAuth Callback Route: Exchange code for shpat_ token ──
    if (urlObj.pathname === "/auth/callback" || urlObj.pathname.endsWith("/auth/callback")) {
      const code = urlObj.searchParams.get("code");
      const shop = urlObj.searchParams.get("shop");
      if (!code || !shop) {
        return new Response("Missing code or shop parameters.", { status: 400 });
      }
      const clientId = env.SHOPIFY_CLIENT_ID;
      const clientSecret = env.SHOPIFY_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        return new Response("Error: SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET not configured in Cloudflare settings.", { status: 500 });
      }

      try {
        const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code
          })
        });
        const tokenData = await tokenRes.json();
        if (tokenData.access_token) {
          return new Response(`🎉 SUCCESS! Your Admin Access Token has been generated.\n\nCopy this token and save it as your SHOPIFY_TOKEN secret in GitHub:\n\n${tokenData.access_token}\n`, {
            headers: { "Content-Type": "text/plain" }
          });
        }
        return new Response(`Failed to generate token: ${JSON.stringify(tokenData)}`, { status: 500 });
      } catch (err) {
        return new Response(`Exchange error: ${err.message}`, { status: 500 });
      }
    }

    if (urlObj.pathname === "/enrich" || urlObj.pathname.endsWith("/enrich")) {
      try {
        const product = await request.json();
        const shopifyToken = env.SHOPIFY_ADMIN_TOKEN || env.SHOPIFY_TOKEN;
        if (!shopifyToken) {
          return new Response(JSON.stringify({ error: "SHOPIFY_ADMIN_TOKEN env var missing in Cloudflare." }), {
            status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }
        const enrichment = await enrichProduct(product, geminiKey, shopifyToken);
        return new Response(JSON.stringify({ success: true, enriched: enrichment }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    try {
      const { message = "", history = [] } = await request.json();

      // Check if message contains an order number (e.g. #1005 or 1005)
      let trackingContext = "";
      const orderMatch = message.match(/#(\d{4,})/);
      if (orderMatch && env.SHOPIFY_ADMIN_TOKEN) {
        const orderName = `#${orderMatch[1]}`;
        try {
          const shopifyToken = env.SHOPIFY_ADMIN_TOKEN || env.SHOPIFY_TOKEN;
          const orderUrl = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/orders.json?name=${encodeURIComponent(orderName)}&status=any`;
          const orderRes = await fetch(orderUrl, {
            headers: {
              "X-Shopify-Access-Token": shopifyToken,
              "Accept": "application/json"
            }
          });
          if (orderRes.ok) {
            const { orders } = await orderRes.json();
            if (orders && orders.length > 0) {
              const order = orders[0];
              const fStatus = order.fulfillment_status || "Unfulfilled";
              let trackingInfo = "No tracking information available yet. The order is currently processing.";
              if (order.fulfillments && order.fulfillments.length > 0) {
                const f = order.fulfillments[0];
                trackingInfo = `Shipped via ${f.tracking_company || "carrier"}. Tracking Number: ${f.tracking_number || "N/A"}. Tracking Link: ${f.tracking_url || "N/A"}`;
              }
              trackingContext = `\n\n## CUSTOMER ORDER LOOKUP DETAILS:
Order Status for ${orderName}:
- Fulfillment Status: ${fStatus}
- Financial Status: ${order.financial_status || "Paid"}
- Shipping/Tracking Info: ${trackingInfo}
- Order Date: ${order.created_at || "N/A"}
Please tell the customer these exact details in a friendly, conversational plug tone.`;
            } else {
              trackingContext = `\n\n## CUSTOMER ORDER LOOKUP DETAILS:
Order ${orderName} was not found in the shop database. Suggest they verify the order number.`;
            }
          }
        } catch (e) {
          console.error("Order lookup failed:", e);
        }
      }

      // Fetch live catalog (cached 5 min via Cloudflare CDN)
      const catalogResult = await getLiveCatalog(env);
      let systemPrompt = buildSystemPrompt(catalogResult ? catalogResult.products : null);
      if (trackingContext) {
        systemPrompt += trackingContext;
      }

      // Build conversation — Gemini requires strict user/model alternation
      const raw = [
        ...history.map(m => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }]
        })),
        { role: "user", parts: [{ text: message }] }
      ];

      // Filter to enforce alternation starting with user
      const contents = [];
      let expect = "user";
      for (const item of raw) {
        if (item.role === expect) {
          contents.push(item);
          expect = expect === "user" ? "model" : "user";
        }
      }
      if (!contents.length || contents[contents.length - 1].role !== "user") {
        contents.push({ role: "user", parts: [{ text: message }] });
      }

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 600,
              thinkingConfig: { thinkingBudget: 0 }
            }
          })
        }
      );

      const data = await geminiRes.json();

      let reply = "Yo! Ran into an issue — hit me again.";
      if (data.candidates?.[0]?.content?.parts) {
        const parts = data.candidates[0].content.parts;
        reply = parts.filter(p => !p.thought && p.text).map(p => p.text).join("").trim()
          || parts.map(p => p.text || "").join("").trim();
      } else if (data.error) {
        reply = `Gemini Error: ${data.error.message} (${data.error.status})`;
      }

      return new Response(JSON.stringify({ response: reply }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
  }
};
