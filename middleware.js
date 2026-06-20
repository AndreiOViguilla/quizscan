// Vercel Edge Middleware — runs at CDN before any serverless function
// Blocks obvious bot User-Agents on all /api/* routes

export const config = { matcher: ["/api/:path*"] };

const BOT_SIGNATURES = [
  "curl/", "python-requests/", "python-urllib", "python/",
  "Go-http-client/", "Java/", "libwww-perl", "wget/",
  "scrapy/", "httpx/", "aiohttp/", "axios/", "node-fetch/",
  "got/", "superagent/", "undici/",
];

export default function middleware(request) {
  const ua = request.headers.get("user-agent") || "";

  // No UA or matches a known script/bot signature → block
  if (!ua || BOT_SIGNATURES.some(sig => ua.toLowerCase().includes(sig.toLowerCase()))) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Pass through — actual rate limiting handled inside each function
}
