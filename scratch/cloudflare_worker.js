/**
 * 🤖 JJKICKSZZ AI — Secure Cloudflare Worker API (Google Gemini Edition)
 * 
 * This script runs securely on Cloudflare Workers (or Vercel) to protect your Gemini API key
 * and connect your JJKICKSZZ storefront chat drawer directly to Google Gemini.
 * 
 * To Deploy:
 * 1. Go to Google AI Studio at https://aistudio.google.com and get a free API Key.
 * 2. Create a free account at cloudflare.com.
 * 3. Create a new Worker named `jjkickszz-ai`.
 * 4. Paste this code into the Worker editor.
 * 5. Add your Gemini API key in the Worker settings as an Environment Variable named `GEMINI_API_KEY`.
 * 6. Click Save and Deploy!
 */

export default {
  async fetch(request, env, ctx) {
    // 1. Handle CORS Options Preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*", // Replace with your domain in production: "https://jjkickszz.com"
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

      const { searchParams } = new URL(request.url);
      const testPrompt = searchParams.get("test");
      
      if (testPrompt) {
        try {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-3.5-flash:generateContent?key=${geminiApiKey}`;
          const response = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: testPrompt }] }]
            })
          });
          const listData = await response.json();
          return new Response(JSON.stringify(listData, null, 2), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        } catch (err) {
          return new Response(`Error running test: ${err.message}`, {
            headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" }
          });
        }
      }
      
      try {
        const listUrl = `https://generativelanguage.googleapis.com/v1/models?key=${geminiApiKey}`;
        const listRes = await fetch(listUrl);
        const listData = await listRes.json();
        
        // If there's an error listing models (e.g. invalid key) it will show here
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
      const liveCatalog = payload.catalog || "";

      // Build catalog section — use live data from Shopify if available, otherwise fallback
      const catalogSection = liveCatalog.trim().length > 20
        ? `LIVE STORE CATALOG (all products currently in the store):
${liveCatalog}

RULES FOR PRODUCT RECOMMENDATIONS:
- You MUST use the exact Handle from the catalog when recommending a product, formatted as: [Product: handle]
- NEVER recommend two items of the same product Type for an outfit (e.g. never two tops)
- When building an outfit, pick items from DIFFERENT Types — e.g. one top + one bottom, or one top + one jacket
- If the catalog has no bottoms or sneakers, say so honestly and suggest the customer browse the full shop
- Only recommend in-catalog products. Never make up handles.`
        : `PRODUCT CATALOG (fallback list):
- JJKICKSZZ 2-in-1 Hybrid Tee (Type: Top): [Product: 2-in-1-hybrid-tee]
- JJKICKSZZ After Life Tee (Type: Top): [Product: after-life-tee]
- Amiri MA Core Logo Tee (Type: Top): [Product: amiri-ma-core-logo-tee]
- Balenciaga Inside Out Army Shirt (Type: Top): [Product: baleciaga-inside-out-army-shirt]

RULES FOR PRODUCT RECOMMENDATIONS:
- Format every recommendation as: [Product: handle]
- NEVER recommend two items of the same type for one outfit`;

      const systemPrompt = `You are the JJKICKSZZ AI Stylist — a cool, knowledgeable streetwear plug and customer service rep for JJKICKSZZ.com.
Talk like a real person. Be short, direct, and useful. Keep responses to 2-3 short paragraphs MAX. Use line breaks between ideas.

STORE POLICIES:
- Shipping: 1-3 business days processing, 5-8 days delivery. FREE shipping over $400.
- Returns: All sales final — no returns, refunds, or exchanges.
- Authenticity: 100% authentic, hand-inspected. Never fake.

${catalogSection}

RESPONSE FORMAT RULES:
- Use short paragraphs, NOT one long block of text
- When recommending an outfit, list each item on its own line with what it is (top, bottom, etc.)
- Keep the total response under 120 words
- Never list items from the same category together as an "outfit"
- End with one short follow-up question or CTA`;

      // 3. Format history array for Gemini API (roles: user / model)
      const rawContents = [];
      
      chatHistory.forEach(msg => {
        const role = msg.role === "assistant" ? "model" : "user";
        rawContents.push({
          role: role,
          parts: [{ text: msg.content }]
        });
      });

      // Append current user message
      rawContents.push({
        role: "user",
        parts: [{ text: userMessage }]
      });

      // Gemini requires contents to start with 'user' and alternate roles strictly
      const cleanContents = [];
      let expectedRole = "user";
      
      for (const item of rawContents) {
        if (item.role === expectedRole) {
          cleanContents.push(item);
          expectedRole = expectedRole === "user" ? "model" : "user";
        }
      }

      // If we filtered out the current user message by accident because of consecutive roles, append it
      if (cleanContents.length === 0 || cleanContents[cleanContents.length - 1].role !== "user") {
        cleanContents.push({
          role: "user",
          parts: [{ text: userMessage }]
        });
      }

      // 4. Query Google Gemini API securely
      const geminiApiKey = env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        return new Response(JSON.stringify({ error: "GEMINI_API_KEY is not configured in the worker environment." }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-3.5-flash:generateContent?key=${geminiApiKey}`;
      
      const response = await fetch(geminiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }]
          },
          contents: cleanContents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1024,
            thinkingConfig: {
              thinkingBudget: 0
            }
          }
        })
      });

      const data = await response.json();
      
      // Parse output text from Gemini response structure.
      // gemini-3.5-flash is a "thinking" model — when systemInstruction is used,
      // it returns internal reasoning in parts[0] (thought: true) and the actual
      // reply in parts[1+]. We must skip thought parts and join only real text.
      let botResponse = "Yo! I had a connection issue. Ask me again in a second!";
      if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        const parts = data.candidates[0].content.parts || [];
        const realParts = parts.filter(p => !p.thought && p.text);
        if (realParts.length > 0) {
          botResponse = realParts.map(p => p.text).join("").trim();
        } else if (parts.length > 0 && parts[0].text) {
          // Fallback: no thought flags found, use all parts
          botResponse = parts.map(p => p.text || "").join("").trim();
        }
      } else if (data.error) {
        botResponse = `Gemini API Error: ${data.error.message} (${data.error.status})`;
      } else if (data.candidates === undefined) {
        botResponse = `API Response structure mismatch. Raw: ${JSON.stringify(data).slice(0, 200)}`;
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
