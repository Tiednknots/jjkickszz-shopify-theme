/**
 * 🤖 JJKICKSZZ AI — Secure Cloudflare Worker API (Google Gemini Edition)
 * 
 * Now with Live Shopify Catalog Syncing!
 * Every request dynamically pulls the active products, prices, types, and handles 
 * directly from your live store and feeds them as real-time context to Gemini 3.7.
 */

export default {
  async fetch(request, env, ctx) {
    // 1. Handle CORS Options Preflight requests
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

    // 2. Handle GET request checks (friendly confirmation and model list debugging)
    if (request.method === "GET") {
      const geminiApiKey = env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        return new Response("JJKICKSZZ AI Stylist API is online! (But GEMINI_API_KEY is not configured in Cloudflare variables)", {
          headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" }
        });
      }
      
      try {
        const listUrl = `https://generativelanguage.googleapis.com/v1/models?key=${geminiApiKey}`;
        const listRes = await fetch(listUrl);
        const listData = await listRes.json();
        
        return new Response(JSON.stringify(listData, null, 2), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err) {
        return new Response(`Error listing models: ${err.message}`, {
          headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    if (request.method !== "POST" && request.method !== "OPTIONS") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const payload = await request.json();
      const userMessage = payload.message || "";
      const chatHistory = payload.history || [];

      // 3. Query live product list from your Shopify store
      let liveCatalogText = "";
      try {
        const storeUrl = "https://jjkickszz.com/collections/all/products.json?limit=150";
        const catalogResponse = await fetch(storeUrl, {
          headers: { "User-Agent": "JJKICKSZZ-AI-Agent/1.0" }
        });
        const catalogData = await catalogResponse.json();
        if (catalogData && catalogData.products) {
          liveCatalogText = catalogData.products.map(p => {
            const minPrice = p.variants && p.variants[0] ? p.variants[0].price : "Contact us";
            const inStock = p.variants && p.variants.some(v => v.available) ? "In Stock" : "Sold Out";
            return `- ${p.title} (${p.product_type} - $${minPrice} - ${inStock}) Handle: [Product: ${p.handle}]`;
          }).join("\n");
        }
      } catch (catalogErr) {
        console.error("Failed to query live Shopify catalog:", catalogErr);
        liveCatalogText = "Jordan 4 Retro Black Cat ($300): [Product: jordan-4-retro-black-cat]";
      }

      // 4. Define the Brand System Rules & Product Catalog Context
      const systemPrompt = `
You are the official JJKICKSZZ AI Stylist, an expert sneakerhead and streetwear stylist helping customers on JJKICKSZZ.com.
Maintain a cool, helpful, streetwear-fluent, and confident tone. Keep responses relatively concise (2-4 sentences max) and avoid excessive corporate politeness.

Follow these brand rules:
1. Shipping: Orders are processed in 1-3 business days. Delivery takes 5-8 business days. We offer FREE shipping on orders over $400.
2. Returns: All sales are final. We do not accept returns or exchanges due to the exclusive nature of our catalog.
3. Authenticity: 100% authentic heat guaranteed. Every piece is hand-inspected. We don't play games with quality.
4. Product recommendations: Whenever you recommend a product, you MUST include its exact handle inside brackets in this format: [Product: product-handle].
   Example: "Check out the Amiri MA Tee: [Product: amiri-ma-tee]."
   Only recommend handles that you are confident exist in the catalog.
5. Outfits: When building an outfit, try to recommend a sneaker, a tee/hoodie, and pants together, formatting each handle like [Product: handle].

Here is JJKICKSZZ's real-time inventory feed:
${liveCatalogText}

Search the inventory list above to suggest relevant products matching the user's questions about brands, clothing types, budgets, or outfit styles.
`;

      // 5. Format history array for Gemini API (roles: user / model)
      const contents = [];
      
      chatHistory.forEach(msg => {
        const role = msg.role === "assistant" ? "model" : "user";
        contents.push({
          role: role,
          parts: [{ text: msg.content }]
        });
      });

      // Append current user message
      contents.push({
        role: "user",
        parts: [{ text: userMessage }]
      });

      // 6. Query Google Gemini API securely (Stable v1 endpoint targeting gemini-3.7-flash)
      const geminiApiKey = env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        return new Response(JSON.stringify({ error: "GEMINI_API_KEY is not configured in the worker environment." }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-3.7-flash:generateContent?key=${geminiApiKey}`;
      
      const response = await fetch(geminiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }]
          },
          contents: contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 300
          }
        })
      });

      const data = await response.json();
      
      // Parse output text from Gemini response structure
      let botResponse = "Yo! I had a connection issue. Ask me again in a second!";
      if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts[0]) {
        botResponse = data.candidates[0].content.parts[0].text;
      } else if (data.error) {
        botResponse = `Gemini API Error: ${data.error.message} (${data.error.status})`;
      } else {
        botResponse = `API Response structure mismatch. Raw response: ${JSON.stringify(data)}`;
      }

      return new Response(JSON.stringify({ response: botResponse }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
  }
};
