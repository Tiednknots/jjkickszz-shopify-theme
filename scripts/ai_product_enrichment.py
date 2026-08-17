"""
JJKICKSZZ — AI Product Enrichment Script
=========================================
Analyzes every Shopify product via Gemini Vision (image + title)
and writes back the category (product_type) and description (body_html).

SETUP:
  1. Create a Shopify private app with read_products + write_products scopes
  2. Copy the Admin API access token
  3. Set the three environment variables below and run:

     export SHOPIFY_STORE="jjkickszz.myshopify.com"
     export SHOPIFY_TOKEN="shpat_XXXXXXXXXXXXXXXX"
     export GEMINI_API_KEY="AIzaXXXXXXXXXXXX"
     python3 ai_product_enrichment.py
"""

import os, time, json, base64, urllib.request, urllib.parse

SHOPIFY_STORE  = os.environ.get("SHOPIFY_STORE")
SHOPIFY_TOKEN  = os.environ.get("SHOPIFY_TOKEN")
SHOPIFY_CLIENT_ID = os.environ.get("SHOPIFY_CLIENT_ID")
SHOPIFY_CLIENT_SECRET = os.environ.get("SHOPIFY_CLIENT_SECRET")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

# If client credentials are provided and token is missing or a storefront token (shpss_), exchange them
if (not SHOPIFY_TOKEN or SHOPIFY_TOKEN.startswith("shpss_")) and SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET and SHOPIFY_STORE:
    print("🔑 Authenticating with Shopify Client Credentials...")
    try:
        auth_url = f"https://{SHOPIFY_STORE}/admin/oauth/access_token"
        payload = urllib.parse.urlencode({
            "client_id": SHOPIFY_CLIENT_ID,
            "client_secret": SHOPIFY_CLIENT_SECRET,
            "grant_type": "client_credentials"
        }).encode("utf-8")
        req = urllib.request.Request(auth_url, data=payload, method="POST", headers={
            "Content-Type": "application/x-www-form-urlencoded"
        })
        with urllib.request.urlopen(req, timeout=15) as r:
            token_data = json.loads(r.read())
            SHOPIFY_TOKEN = token_data.get("access_token")
            print("✅ Successfully generated temporary Admin Access Token.")
    except Exception as e:
        print(f"❌ Failed to generate access token from Client Credentials: {e}")
        exit(1)

if not SHOPIFY_STORE or not SHOPIFY_TOKEN or not GEMINI_API_KEY:
    missing = []
    if not SHOPIFY_STORE: missing.append("SHOPIFY_STORE")
    if not SHOPIFY_TOKEN and not (SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET):
        missing.append("SHOPIFY_TOKEN (or SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET)")
    if not GEMINI_API_KEY: missing.append("GEMINI_API_KEY")
    print(f"❌ Error: Missing required credentials: {', '.join(missing)}")
    exit(1)

GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1/models/"
    f"gemini-3.5-flash:generateContent?key={GEMINI_API_KEY}"
)

VISION_PROMPT = """You are a streetwear expert and product merchandiser.
Given a product title and image, return ONLY a valid JSON object:
{
  "category": "<Tee | Shirt | Longsleeve | Hoodie | Jacket | Shorts | Pants | Set | Hat | Sneakers | Apparel>",
  "description": "<50-70 word premium streetwear description — mention colors, fit, graphic details, and brand vibe>"
}
No extra text, no markdown, just the JSON object."""


def shopify(method, path, body=None):
    url = f"https://{SHOPIFY_STORE}/admin/api/2024-01/{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        "Content-Type": "application/json"
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        print(f"\n❌ Shopify API HTTP Error {e.code}: {e.reason}")
        print(f"URL attempted: {url}")
        print(f"Response: {error_body}")
        print("\nPossible solutions:")
        if e.code == 401:
            print("1. Your SHOPIFY_TOKEN may be incorrect or missing scopes.")
        elif e.code == 404:
            print("1. Your SHOPIFY_STORE domain might be wrong (must be the .myshopify.com name, e.g. jjkickszz.myshopify.com).")
        exit(1)
    except urllib.error.URLError as e:
        print(f"\n❌ Network Connection Error: {e.reason}")
        print(f"Failed to connect to: {url}")
        print("Please check your SHOPIFY_STORE domain secret.")
        exit(1)


def to_b64(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            return base64.b64encode(r.read()).decode()
    except:
        return None


def analyze(title, img_b64):
    parts = [{"text": f"Product: {title}"}]
    if img_b64:
        parts.append({"inline_data": {"mime_type": "image/jpeg", "data": img_b64}})
    payload = json.dumps({
        "systemInstruction": {"parts": [{"text": VISION_PROMPT}]},
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 250}
    }).encode()
    req = urllib.request.Request(GEMINI_URL, data=payload, method="POST",
                                  headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read())
    raw = data["candidates"][0]["content"]["parts"][0]["text"]
    raw = raw.strip().replace("```json","").replace("```","").strip()
    return json.loads(raw)


def main():
    print("🤖  JJKICKSZZ AI Product Enrichment")
    print("─" * 50)

    # Fetch all products
    all_products = []
    page = 1
    while True:
        r = shopify("GET", f"products.json?limit=250&fields=id,title,product_type,body_html,images&page={page}")
        batch = r.get("products", [])
        all_products.extend(batch)
        if len(batch) < 250:
            break
        page += 1
    print(f"✅  {len(all_products)} products found\n")

    updated = skipped = failed = 0

    for i, p in enumerate(all_products):
        pid, title = p["id"], p["title"]
        has_type = bool((p.get("product_type") or "").strip())
        has_desc = bool((p.get("body_html") or "").strip())

        prefix = f"[{i+1}/{len(all_products)}]"

        if has_type and has_desc:
            print(f"{prefix} SKIP     {title}")
            skipped += 1
            continue

        print(f"{prefix} ANALYZING  {title} ...", end=" ", flush=True)

        img_url = None
        if p.get("images"):
            img_url = p["images"][0].get("src")

        try:
            result = analyze(title, to_b64(img_url) if img_url else None)
            cat  = result.get("category", "Apparel")
            desc = result.get("description", "")

            update = {"product": {"id": pid}}
            if not has_type: update["product"]["product_type"] = cat
            if not has_desc: update["product"]["body_html"] = f"<p>{desc}</p>"

            shopify("PUT", f"products/{pid}.json", update)
            print(f"→ {cat}")
            updated += 1

        except Exception as e:
            print(f"→ FAILED ({e})")
            failed += 1

        time.sleep(0.6)   # ~1.6 req/sec — safe for both APIs

    print(f"\n{'─'*50}")
    print(f"Done.  Updated: {updated}  |  Skipped: {skipped}  |  Failed: {failed}")
    print("The AI chat will use new categories and descriptions immediately.")


if __name__ == "__main__":
    main()
