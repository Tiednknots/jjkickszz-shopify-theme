/**
 * JJKICKSZZ AI — Cloudflare Worker
 * Model: gemini-3.6-flash (with automatic fallback to gemini-2.5-flash / gemini-3.5-flash-lite)
 * Catalog: Live Shopify Storefront Feed + Real-Time Product Context
 *
 * FIXES APPLIED (Aug 2026):
 * - Removed dead/retired models from the fallback chain (gemini-2.0-flash, gemini-1.5-flash,
 *   gemini-1.5-flash-latest all return 404 now — they were burning every request before ever
 *   reaching a model that works).
 * - De-duplicated the model fallback list.
 * - Added a timeout to the Gemini generateContent call itself (previously only the Shopify
 *   catalog fetch had one, so a slow/hung Gemini call could exhaust the Worker's execution time
 *   with no fallback).
 * - Capped the catalog injected into the prompt, and prioritized productContext so a specific
 *   product question isn't buried under up to 250 unrelated product lines.
 * - Hardened response parsing so a malformed Gemini response can't slip through as a "success"
 *   with an empty reply.
 */

const SHOPIFY_DOMAIN = "jjkickszz.com";

// Only currently-live models as of Aug 2026. Do NOT add gemini-2.0-flash, gemini-1.5-flash,
// or gemini-1.5-flash-latest back in — Google has fully retired those and they will 404 every time.
const CANDIDATE_MODELS = [
  "gemini-3.6-flash",
  "gemini-2.5-flash",
  "gemini-3.5-flash-lite"
];
const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const CATALOG_CAP_DEFAULT = 120; // full catalog for general browsing questions
const CATALOG_CAP_WITH_PRODUCT = 25; // trimmed "you might also like" list when a specific product is already in context
const GEMINI_TIMEOUT_MS = 9000; // per-model timeout for the actual AI call

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
      headers: { "Accept": "application/json", "User-Agent": "JJKICKSZZ-AI/2.1" },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) return { error: `HTTP ${res.status} from Shopify`, products: null, rawList: [] };
    const data = await res.json();
    const products = data.products || [];
    if (!products.length) return { error: "No products returned from Shopify", products: null, rawList: [] };

    const validProducts = products.filter(p =>
      p.images &&
      p.images.length > 0 &&
      p.variants &&
      p.variants.some(v => v.available !== false)
    );

    const sorted = validProducts.sort((a, b) => b.id - a.id);

    return { rawList: sorted, count: sorted.length, error: null };
  } catch (err) {
    return { error: err.message, products: null, rawList: [] };
  }
}

function formatCatalog(rawList, cap) {
  const slice = rawList.slice(0, cap);
  return slice.map(p => {
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
}

function buildSystemPrompt(catalogString, productContext, totalCount) {
  let contextExtra = "";
  if (productContext) {
    const sizes = Array.isArray(productContext.available_sizes)
      ? productContext.available_sizes.join(", ")
      : (productContext.available_sizes || "Available now");
    contextExtra = `\n\n⚡ CUSTOMER IS INQUIRING ABOUT THIS SPECIFIC PRODUCT:
- Product Title: ${productContext.title}
- Price: ${productContext.price}
- Brand / Designer: ${productContext.vendor || "JJKICKSZZ Archive"}
- Exact Available Sizes / Variants: ${sizes}
- Product Link: ${productContext.url || ""}
INSTRUCTION: This question is about the specific product above. Answer using ONLY the details given for this product (sizes, price, condition, verification, fit). Do not substitute or recommend a different product unless the customer asks for alternatives. Speak as the knowledgeable JJKICKSZZ concierge.`;
  }

  return `You are the exclusive AI Stylist and Brand Concierge for JJKICKSZZ (jjkickszz.com), a premier streetwear and rare sneaker archive.
Your name is JJKICKSZZ AI. Speak in a confident, knowledgeable, culturally fluent tone (high-end streetwear, grail hunter, archive fashion).
Keep replies concise, punchy, and helpful. If asked who you are, introduce yourself by name and role in one or two sentences.

PRODUCT TAGGING (required whenever you recommend or reference a specific item):
Whenever your reply mentions a specific product from CURRENT LIVE INVENTORY below (recommending it, confirming it's in stock, answering a question about it), append its tag using its exact Handle value like this: [Product: the-handle-here]
- Place the tag right after you mention that product, it will be stripped from the visible text and turned into a clickable product card automatically.
- Only use handles that appear in CURRENT LIVE INVENTORY below. Never invent a handle.
- Do not tag more than 3 products in a single reply.

STORE POLICIES:
- 100% Authenticity Guaranteed: Hand-inspected and verified before dispatch.
- Shipping: Ships in 1-3 business days. Free shipping on orders over $400.
- Returns: All sales are final unless an item is proven inauthentic (full refund guarantee).

CURRENT LIVE INVENTORY (showing ${catalogString ? "a subset of" : ""} ${totalCount || 0} available items):
${catalogString || "Live catalog loaded."}${contextExtra}`;
}

async function callGeminiWithFallback(modelsToTry, contents, geminiKey) {
  let lastError = null;

  for (const modelName of modelsToTry) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

      const geminiRes = await fetch(`${GEMINI_API_BASE}/${modelName}:generateContent?key=${geminiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: { maxOutputTokens: 600 }
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      let geminiData;
      try {
        geminiData = await geminiRes.json();
      } catch (parseErr) {
        lastError = `Non-JSON response from ${modelName} (HTTP ${geminiRes.status})`;
        continue;
      }

      if (geminiData.error) {
        lastError = geminiData.error.message;
        const msg = (geminiData.error.message || "").toLowerCase();
        if (geminiData.error.code === 404 || msg.includes("not found") || msg.includes("no longer available")) {
          continue; // try next model
        }
        // Non-recoverable error (quota, auth, etc.) — stop and report it.
        return { error: `Gemini Error: ${geminiData.error.message}`, fatal: true };
      }

      const reply = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!reply || !reply.trim()) {
        lastError = `Empty reply from ${modelName}`;
        continue;
      }

      return { reply };
    } catch (err) {
      lastError = err.name === "AbortError" ? `${modelName} timed out` : err.message;
    }
  }

  return { error: `Gemini Error: ${lastError || "Could not generate content"}`, fatal: true };
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
        const body = result.error
          ? `❌ Error: ${result.error}`
          : `✅ ${result.count} live products loaded:\n\n${formatCatalog(result.rawList, result.rawList.length)}`;
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
        return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
      }

      const { message, history = [], productContext = null } = reqBody;
      if (!message) {
        return new Response(JSON.stringify({ error: "Missing 'message' field" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
      }

      const catalogResult = await getLiveCatalog();
      const cap = productContext ? CATALOG_CAP_WITH_PRODUCT : CATALOG_CAP_DEFAULT;
      const catalogString = catalogResult.rawList ? formatCatalog(catalogResult.rawList, cap) : "";
      const systemPrompt = buildSystemPrompt(catalogString, productContext, catalogResult.count);

      const contents = [];
      contents.push({ role: "user", parts: [{ text: systemPrompt }] });
      contents.push({ role: "model", parts: [{ text: "Understood. I am JJKICKSZZ AI, ready to assist." }] });

      const recentHistory = history.slice(-6);
      for (const turn of recentHistory) {
        contents.push({
          role: turn.role === "user" ? "user" : "model",
          parts: [{ text: turn.text || turn.content || "" }]
        });
      }
      contents.push({ role: "user", parts: [{ text: message }] });

      const rawModelList = env.GEMINI_MODEL
        ? [env.GEMINI_MODEL.trim(), ...CANDIDATE_MODELS]
        : CANDIDATE_MODELS;
      const modelsToTry = [...new Set(rawModelList)]; // de-dupe so we never retry the same model twice

      const result = await callGeminiWithFallback(modelsToTry, contents, geminiKey);

      if (result.error) {
        return new Response(JSON.stringify({ error: result.error }), {
          status: 502, headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });
      }

      return new Response(JSON.stringify({ reply: result.reply }), {
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });
    }

    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }
};
