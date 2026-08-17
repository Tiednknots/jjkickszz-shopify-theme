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

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const payload = await request.json();
      const userMessage = payload.message || "";
      const chatHistory = payload.history || [];

      // 2. Define the Brand System Rules & Product Catalog Context
      const systemPrompt = `
You are the official JJKICKSZZ AI Stylist, an expert sneakerhead and streetwear stylist helping customers on JJKICKSZZ.com.
Maintain a cool, helpful, streetwear-fluent, and confident tone. Keep responses relatively concise (2-4 sentences max) and avoid excessive corporate politeness.

Follow these brand rules:
1. Shipping: Orders are processed in 1-3 business days. Delivery takes 5-8 business days. We offer FREE shipping on orders over $400.
2. Returns: All sales are final. We do not accept returns or exchanges due to the exclusive nature of our catalog.
3. Authenticity: 100% authentic heat guaranteed. Every piece is hand-inspected. We don't play games with quality.
4. Product recommendations: Whenever you recommend a product, you MUST include its handle inside brackets in this exact format: [Product: product-handle]. 
   Example: "Check out the Amiri MA Tee: [Product: amiri-ma-tee]."
   Only recommend handles that you are confident exist in the catalog.
5. Outfits: When building an outfit, try to recommend a sneaker, a tee/hoodie, and pants together, formatting each handle like [Product: handle].

Here are the catalog handles you can reference:
- JJKICKSZZ 2-in-1 Hybrid Tee: [Product: 2-in-1-hybrid-tee]
- JJKICKSZZ After Life Tee: [Product: after-life-tee]
- Amiri MA Core Logo Tee: [Product: amiri-ma-core-logo-tee]
- Balenciaga Inside Out Army Shirt: [Product: baleciaga-inside-out-army-shirt]
- (Add more handles here as your inventory updates!)
`;

      // 3. Format history array for Gemini API (roles: user / model)
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

      // 4. Query Google Gemini API securely
      const geminiApiKey = env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        return new Response(JSON.stringify({ error: "GEMINI_API_KEY is not configured in the worker environment." }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      // Using gemini-1.5-flash for ultra-low latency responses
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;
      
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
            maxOutputTokens: 250
          }
        })
      });

      const data = await response.json();
      
      // Parse output text from Gemini response structure
      let botResponse = "Yo! I had a connection issue. Ask me again in a second!";
      if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts[0]) {
        botResponse = data.candidates[0].content.parts[0].text;
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
