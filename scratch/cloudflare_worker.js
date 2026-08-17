/**
 * 🤖 JJKICKSZZ AI — Secure Cloudflare Worker API
 * 
 * This script runs securely on Cloudflare Workers (or Vercel) to protect your OpenAI API key
 * and connect your JJKICKSZZ storefront chat drawer directly to OpenAI.
 * 
 * To Deploy:
 * 1. Create a free account at cloudflare.com.
 * 2. Create a new Worker named `jjkickszz-ai`.
 * 3. Paste this code into the Worker editor.
 * 4. Add your OpenAI API key in the Worker settings as an Environment Variable named `OPENAI_API_KEY`.
 * 5. Click Save and Deploy!
 */

export default {
  async fetch(request, env, ctx) {
    // 1. Handle CORS Options Preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*", // Or replace with your domain: "https://jjkickszz.com"
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
   Example: "Check out the Jordan 4 Black Cat: [Product: jordan-4-retro-black-cat]."
   Only recommend handles that you are confident exist in the catalog.
5. Outfits: When building an outfit, try to recommend a sneaker, a tee/hoodie, and pants together, formatting each handle like [Product: handle].

Here are the catalog handles you can reference:
- JJKICKSZZ 2-in-1 Hybrid Tee: [Product: 2-in-1-hybrid-tee]
- JJKICKSZZ After Life Tee: [Product: after-life-tee]
- Amiri MA Core Logo Tee: [Product: amiri-ma-core-logo-tee]
- Balenciaga Inside Out Army Shirt: [Product: baleciaga-inside-out-army-shirt]
- (Add more handles here as your inventory updates!)
`;

      // 3. Construct messages array for OpenAI
      const messages = [
        { role: "system", content: systemPrompt }
      ];

      // Append chat history (role mapping: assistant/user)
      chatHistory.forEach(msg => {
        messages.push({ role: msg.role, content: msg.content });
      });

      // Append current user message
      messages.push({ role: "user", content: userMessage });

      // 4. Query OpenAI API securely
      const openAiApiKey = env.OPENAI_API_KEY;
      if (!openAiApiKey) {
        return new Response(JSON.stringify({ error: "OPENAI_API_KEY is not configured in the worker environment." }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      const openAiUrl = "https://api.openai.com/1/chat/completions";
      const response = await fetch(openAiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${openAiApiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini", // Cost-effective, lightning-fast model
          messages: messages,
          temperature: 0.7,
          max_tokens: 250
        })
      });

      const data = await response.json();
      const botResponse = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "Yo! I had a connection issue. Ask me again in a second!";

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
