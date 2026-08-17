/**
 * 🤖 JJKICKSZZ AI — Secure Cloudflare Worker (Google Gemini + Live Shopify Catalog)
 *
 * Setup:
 * 1. Get a free Gemini API key from https://aistudio.google.com
 * 2. In Cloudflare Workers > Settings > Variables, add:
 *    - GEMINI_API_KEY = your key
 *    - SHOPIFY_DOMAIN = jjkickszz.com  (no https://, no trailing slash)
 * 3. Paste this code and click Save and Deploy.
 */

const SHOPIFY_DOMAIN = "jjkickszz.com"; // fallback if env var missing
const CATALOG_CACHE_SECONDS = 300;       // cache product list for 5 minutes

// Infer clothing category from product title keywords
function inferCategory(title) {
  const t = title.toUpperCase();
  if (/\bSNEAKER|JORDAN|NIKE|DUNK|AIR MAX|YEEZY|NEW BALANCE|ADIDAS|SHOE|BOOT\b/.test(t)) return "Sneakers";
  if (/\bSHORT\b/.test(t)) return "Shorts";
  if (/\bPANT|JEAN|DENIM|TROUSER|CARGO\b/.test(t)) return "Pants";
  if (/\bHOODIE|SWEATSHIRT|CREWNECK|FLEECE\b/.test(t)) return "Hoodie";
  if (/\bJACKET|COAT|BOMBER|PARKA|WIND\b/.test(t)) return "Jacket";
  if (/\bLONGSLEEVE|LONG SLEEVE|THERMAL|RAGLAN\b/.test(t)) return "Longsleeve";
  if (/\bSHIRT\b/.test(t)) return "Shirt";
  if (/\bTEE|T-SHIRT\b/.test(t)) return "Tee";
  if (/\bBAG|TOTE|BACKPACK\b/.test(t)) return "Bag";
  if (/\bHAT|CAP|BEANIE\b/.test(t)) return "Hat";
  return "Apparel";
}

// Fetch and build a compact catalog string from Shopify's public API
async function fetchShopifyCatalog(shopifyDomain) {
  const url = `https://${shopifyDomain}/collections/all/products.json?limit=250`;

  // Use Cloudflare's built-in fetch cache (5 min TTL)
  const cacheKey = new Request(url, { method: "GET" });
  const cache = caches.default;
  let cachedRes = await cache.match(cacheKey);

  let products = [];
  if (cachedRes) {
    const json = await cachedRes.json();
    products = json.products || [];
  } else {
    try {
      const res = await fetch(url, {
        cf: { cacheTtl: CATALOG_CACHE_SECONDS, cacheEverything: true }
      });
      if (res.ok) {
        const json = await res.json();
        products = json.products || [];
        // Store in cache manually
        const cacheRes = new Response(JSON.stringify({ products }), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${CATALOG_CACHE_SECONDS}`
          }
        });
        await cache.put(cacheKey, cacheRes);
      }
    } catch (e) {
      // If fetch fails, return empty — worker falls back to minimal catalog
      return null;
    }
  }

  if (!products.length) return null;

  // Build compact catalog lines: one product per line
  const lines = products.map(p => {
    const price = p.variants && p.variants[0] ? `$${parseFloat(p.variants[0].price).toFixed(0)}` : "";
    const category = inferCategory(p.title);
    const available = p.variants && p.variants.some(v => v.available);
    if (!available) return null; // skip sold-out items
    return `${p.title} | Category: ${category} | Price: ${price} | Handle: ${p.handle}`;
  }).filter(Boolean);

  return lines.join("\n");
}

export default {
  async fetch(request, env, ctx) {

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const shopifyDomain = env.SHOPIFY_DOMAIN || SHOPIFY_DOMAIN;
    const geminiApiKey = env.GEMINI_API_KEY;

    // GET — debug / model list route
    if (request.method === "GET") {
      const { searchParams } = new URL(request.url);
      const action = searchParams.get("action");

      if (action === "catalog") {
        // Debug: show the live catalog we'll send to Gemini
        const catalog = await fetchShopifyCatalog(shopifyDomain);
        return new Response(catalog || "No products found", {
          headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" }
        });
      }

      if (!geminiApiKey) {
        return new Response("JJKICKSZZ AI is online! (Add GEMINI_API_KEY in Cloudflare env vars)", {
          headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" }
        });
      }

      const testPrompt = searchParams.get("test");
      if (testPrompt) {
        try {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-3.5-flash:generateContent?key=${geminiApiKey}`;
          const res = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: testPrompt }] }] })
          });
          return new Response(JSON.stringify(await res.json(), null, 2), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        } catch (err) {
          return new Response(`Error: ${err.message}`, {
            headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" }
          });
        }
      }

      // Default GET: list available Gemini models
      try {
        const listRes = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${geminiApiKey}`);
        return new Response(JSON.stringify(await listRes.json(), null, 2), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err) {
        return new Response(`Error listing models: ${err.message}`, {
          headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    if (!geminiApiKey) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured." }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    try {
      const payload = await request.json();
      const userMessage = payload.message || "";
      const chatHistory = payload.history || [];

      // Fetch live Shopify catalog server-side (cached 5 min)
      const liveCatalog = await fetchShopifyCatalog(shopifyDomain);

      const catalogSection = liveCatalog
        ? `LIVE STORE INVENTORY (${liveCatalog.split("\n").length} available products):
${liveCatalog}

HOW TO RECOMMEND PRODUCTS:
- Always use the exact Handle formatted as: [Product: handle]
- Category field tells you if it's a Tee, Shirt, Shorts, Hoodie, Sneakers, etc.
- For outfits: combine items from DIFFERENT categories (e.g. Tee + Shorts, or Hoodie + Pants)
- NEVER recommend two Tees, two Shorts, etc. in the same outfit
- If asked about something not in inventory (e.g. sneakers) — say we don't carry that and suggest browsing the full shop
- Only use Handles that exist in the inventory above`
        : `FALLBACK CATALOG (live fetch failed):
- 2 IN 1 HYBRID TEE | Category: Tee | Price: $200 | Handle: 2-in-1-hybrid-tee
- AFTER LIFE TEE | Category: Tee | Price: $189 | Handle: after-life-tee
- AMIRI MA CORE LOGO TEE | Category: Tee | Price: $220 | Handle: amiri-ma-core-logo-tee
- BALECIAGA INSIDE OUT ARMY SHIRT | Category: Shirt | Price: $350 | Handle: baleciaga-inside-out-army-shirt

HOW TO RECOMMEND PRODUCTS:
- Format as: [Product: handle]
- Do NOT recommend two items of the same category as an outfit`;

      const systemPrompt = `You are the JJKICKSZZ AI Stylist — a real, knowledgeable streetwear plug and customer service rep for JJKICKSZZ.com.

Personality: Cool, direct, human. Speak like a plug who knows their inventory inside out. No corporate speak.

STORE POLICIES:
- Shipping: 1-3 business days processing, 5-8 days delivery. FREE shipping over $400.
- Returns: All sales are final. No returns, refunds, or exchanges.
- Authenticity: 100% authentic. Every piece hand-inspected. No fakes, ever.

${catalogSection}

RESPONSE RULES:
- Keep it SHORT — max 3 short paragraphs or a compact list
- NEVER write one big block of text — use line breaks between points
- Outfit builds: list each piece on its own line, label the category (e.g. "Top:", "Bottom:")
- Stay under 150 words total
- End with a short question or call-to-action`;

      // Build Gemini conversation history (strictly alternating user/model)
      const rawContents = [];
      chatHistory.forEach(msg => {
        rawContents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }]
        });
      });
      rawContents.push({ role: "user", parts: [{ text: userMessage }] });

      const cleanContents = [];
      let expectedRole = "user";
      for (const item of rawContents) {
        if (item.role === expectedRole) {
          cleanContents.push(item);
          expectedRole = expectedRole === "user" ? "model" : "user";
        }
      }
      if (!cleanContents.length || cleanContents[cleanContents.length - 1].role !== "user") {
        cleanContents.push({ role: "user", parts: [{ text: userMessage }] });
      }

      // Call Gemini
      const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-3.5-flash:generateContent?key=${geminiApiKey}`;
      const geminiRes = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: cleanContents,
          generationConfig: {
            temperature: 0.75,
            maxOutputTokens: 600,
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      });

      const data = await geminiRes.json();

      let botResponse = "Yo! Had a hiccup — send that again!";
      if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        const parts = data.candidates[0].content.parts || [];
        const realParts = parts.filter(p => !p.thought && p.text);
        botResponse = (realParts.length ? realParts : parts)
          .map(p => p.text || "").join("").trim();
      } else if (data.error) {
        botResponse = `Gemini API Error: ${data.error.message} (${data.error.status})`;
      }

      return new Response(JSON.stringify({ response: botResponse }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
  }
};
