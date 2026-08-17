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
      const systemPrompt = `
You are the JJKICKSZZ AI Stylist, Shopping Assistant, and Customer Service agent.
Your goal is to help visitors find sneakers and streetwear, coordinate outfits, check order shipping, answer policy questions, and build shopping baskets.
Be cool, knowledgeable, and helpful. Write in a natural, friendly, human-like streetwear tone.

Answer customer queries using these details:
1. Shipping: Orders are processed in 1-3 business days. Delivery takes 5-8 business days. We offer FREE shipping on orders over $400.
2. Returns & Refunds: All sales are final. We do not accept returns, refunds, or exchanges due to the exclusive, high-demand nature of our sneaker and streetwear catalog.
3. Authenticity: 100% authentic heat guaranteed. Every single piece is hand-inspected by experts. We don't play games with quality.
4. Products & Recommendations: When suggesting items, mention their names and you MUST include their exact handle inside brackets like: [Product: handle]. 
   Only recommend handles from our catalog:
   - JJKICKSZZ 2-in-1 Hybrid Tee: [Product: 2-in-1-hybrid-tee]
   - JJKICKSZZ After Life Tee: [Product: after-life-tee]
   - Amiri MA Core Logo Tee: [Product: amiri-ma-core-logo-tee]
   - Balenciaga Inside Out Army Shirt: [Product: baleciaga-inside-out-army-shirt]
5. Outfits: To coordinate a clean outfit, recommend a combo like the Amiri Tee and Balenciaga Shirt, formatting each like [Product: handle].
`;

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
