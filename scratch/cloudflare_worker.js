/**
 * JJKICKSZZ AI — Cloudflare Worker
 * Model: gemini-3.6-flash (with automatic fallback to gemini-2.0-flash / gemini-1.5-flash)
 * Catalog: Live Shopify Storefront Feed (Zero-Auth / 100% Reliable)
 */

const SHOPIFY_DOMAIN = "jjkickszz.com";
const CANDIDATE_MODELS = [
  "gemini-3.6-flash",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-1.5-flash-latest"
];
const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function getCategory(title) {
  const t = title.toUpperCase();
  if (/SNEAKER|JORDAN|YEEZY|DUNK|AIR MAX|NEW BALANCE|ADIDAS|SHOE|\bBOOT\b|TRAINER/.test(t)) return "Sneakers";
  if (/MESH SHORT|CAMO SHORT|INSOMNIA|DETENTION SHORT|SKULL.*SHORT|\bSHORTS\b/.test(t)) return "Shorts";
  if (/PANT|JEAN|DENIM|TROUSER|CARGO/.test(t)) return "Pants";
  if (/JACKET|COAT|BOMBER|PARKA|WINDBREAKER|FLANNEL/.test(t)) return "Jacket";
  if (/HOODIE|SWEATSHIRT|CREWNECK|\bCREW\b|FLEECE/.test(t)) return "Hoodie";
  if (/LONGSLEEVE|LONG SLEEVE|LONG-SLEEVE|\bLS\b|THERMAL|RAGLAN/.test(t)) return "Longsleeve";
  if (/SHORT SLEEVE|SHORT-SLEEVE|\bTEE\b|T-SHIRT/.test(t)) return "Tee";
  if (/JERSEY|RUGBY|BASEBALL|\bSHIRT\b/.test(t)) return "Shirt";
  if (/\bHAT\b|\bCAP\b|BEANIE/.test(t)) return "Hat";
  if (/\bBAG\b|TOTE|BACKPACK/.test(t)) return "Bag";
  if (/SET|NYLON SET/.test(t)) return "Set";
  return "Apparel";
}

async function getLiveCatalog() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`https://${SHOPIFY_DOMAIN}/products.json?limit=250`, {
      headers: { "Accept": "application/json", "User-Agent": "JJKICKSZZ-AI/2.0" },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) return { error: `HTTP ${res.status} from Shopify`, products: null };
    const data = await res.json();
    const products = data.products || [];
    if (!products.length) return { error: "No products returned from Shopify", products: null };

    const validProducts = products.filter(p => 
      p.images && 
      p.images.length > 0 && 
      p.variants && 
      p.variants.some(v => v.available !== false)
    );

    const sorted = validProducts.sort((a, b) => b.id - a.id);

    const formatted = sorted.map(p => {
      const cat = getCategory(p.title);
      const minPrice = p.variants.reduce((min, v) => Math.min(min, parseFloat(v.price)), Infinity);
      const sizes = p.variants
        .filter(v => v.available !== false)
        .map(v => v.title)
        .filter(s => s && s !== "Default Title")
        .join(", ");
      const img = p.images[0] ? (p.images[0].src || p.images[0]) : "";
      return `- "${p.title}" | Category: ${cat} | Price: $${minPrice.toFixed(0)} | Available Sizes: ${sizes || "One Size"} | Handle: ${p.handle} | Image: ${img}`;
    }).join("\n");

    return { products: formatted, count: sorted.length, rawList: sorted };
  } catch (err) {
    return { error: err.message, products: null };
  }
}

function buildSystemPrompt(catalogString) {
  return `You are the exclusive AI Stylist and Brand Concierge for JJKICKSZZ (jjkickszz.com) — a premier streetwear and rare sneaker archive.
Your name is JJKICKSZZ AI. Speak in a confident, knowledgeable, culturally fluent tone (high-end streetwear, grail hunter, archive fashion).
Keep replies concise, punchy, and helpful. Do not write walls of text.

STORE POLICIES:
- 100% Authenticity Guaranteed: Hand-inspected and verified before dispatch.
- Shipping: Ships in 1-3 business days. Free shipping on orders over $400.
- Returns: All sales are final unless an item is proven inauthentic (full refund guarantee).

CURRENT LIVE INVENTORY:
${catalogString || "Catalog temporarily unavailable."}

RULES FOR PRODUCT RECOMMENDATIONS:
1. ONLY recommend products that appear in the CURRENT LIVE INVENTORY list above.
2. When mentioning a product, write its exact title and price.
3. Link format: [Product Name](https://jjkickszz.com/products/HANDLE)`;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const geminiKey = env.GEMINI_API_KEY;
    const urlObj = new URL(request.url);

    if (request.method === "GET") {
      const action = urlObj.searchParams.get("action");

      if (action === "catalog") {
        const result = await getLiveCatalog();
        const body = result.error ? `❌ Error: ${result.error}` : `✅ ${result.count} live products loaded:\n\n${result.products}`;
        return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS_HEADERS } });
      }

      if (action === "models" && geminiKey) {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`);
        const data = await res.json();
        const names = (data.models || [])
          .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
          .map(m => `  ${m.name}`)
          .join("\n");
        return new Response(`✅ Models for your API key:\n\n${names}`, { headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS_HEADERS } });
      }

      return new Response(`✅ JJKICKSZZ AI online.\nActive model: ${env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL}\n\nRoutes:\n  ?action=catalog\n  ?action=models`, {
        headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS_HEADERS }
      });
    }

    if (request.method === "POST") {
      if (!geminiKey) {
        return new Response(JSON.stringify({ error: "GEMINI_API_KEY is missing in Cloudflare variables." }), {
          status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });
      }

      let reqBody;
      try {
        reqBody = await request.json();
      } catch (e) {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: CORS_HEADERS });
      }

      const { message, history = [] } = reqBody;
      if (!message) {
        return new Response(JSON.stringify({ error: "Missing 'message' field" }), { status: 400, headers: CORS_HEADERS });
      }

      const catalogResult = await getLiveCatalog();
      const systemPrompt = buildSystemPrompt(catalogResult.products || "");

      const contents = [];
      contents.push({ role: "user", parts: [{ text: systemPrompt }] });
      contents.push({ role: "model", parts: [{ text: "Understood. I am JJKICKSZZ AI, ready to curate." }] });

      const recentHistory = history.slice(-6);
      for (const turn of recentHistory) {
        contents.push({
          role: turn.role === "user" ? "user" : "model",
          parts: [{ text: turn.text || turn.content || "" }]
        });
      }
      contents.push({ role: "user", parts: [{ text: message }] });

      // List of candidate models to try in sequence
      const modelsToTry = env.GEMINI_MODEL 
        ? [env.GEMINI_MODEL.trim(), ...CANDIDATE_MODELS]
        : CANDIDATE_MODELS;

      let lastError = null;

      for (const modelName of modelsToTry) {
        try {
          const geminiRes = await fetch(`${GEMINI_API_BASE}/${modelName}:generateContent?key=${geminiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents,
              generationConfig: { temperature: 0.7, maxOutputTokens: 600 }
            })
          });

          const geminiData = await geminiRes.json();

          if (geminiData.error) {
            lastError = geminiData.error.message;
            // If model not found or deprecated, try next model in candidate list
            if (geminiData.error.code === 404 || geminiData.error.message.includes("not found") || geminiData.error.message.includes("no longer available")) {
              continue;
            }
            return new Response(JSON.stringify({ error: `Gemini Error: ${geminiData.error.message}` }), {
              status: 502, headers: { "Content-Type": "application/json", ...CORS_HEADERS }
            });
          }

          const reply = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "Let me know what pieces you're looking for!";
          return new Response(JSON.stringify({ reply }), {
            headers: { "Content-Type": "application/json", ...CORS_HEADERS }
          });
        } catch (err) {
          lastError = err.message;
        }
      }

      return new Response(JSON.stringify({ error: `Gemini Error: ${lastError || "Could not generate content"}` }), {
        status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });
    }

    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }
};
