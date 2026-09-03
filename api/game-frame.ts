const ALLOWED_HOSTS = new Set([
  "myinstants.com",
  "www.myinstants.com",
  "raw.githubusercontent.com",
  "rawcdn.githack.com",
  "cdn.jsdelivr.net",
]);

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default async function handler(req: { method?: string; query: Record<string, string | string[] | undefined> }, res: { status: (code: number) => any; send: (body: string) => any; setHeader: (name: string, value: string) => any }) {
  if (req.method !== "GET") return res.status(405).send("Method not allowed");
  const rawUrl = typeof req.query.url === "string" ? req.query.url : "";
  let target: URL;
  try { target = new URL(rawUrl); } catch { return res.status(400).send("Invalid game URL"); }
  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) return res.status(403).send("Game host is not allowed");

  try {
    const upstream = await fetch(target, { headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html,application/xhtml+xml,*/*;q=0.8" } });
    const type = upstream.headers.get("content-type") || "";
    if (!upstream.ok || !type.includes("text/html")) {
      const safeTarget = escapeHtml(target.toString());
      return res.status(200).setHeader("Content-Type", "text/html; charset=utf-8").send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;min-height:100%;background:#050505;color:#fff;font:600 16px system-ui;display:grid;place-items:center;text-align:center}main{max-width:26rem;padding:2rem}p{color:#999;font-size:13px;font-weight:400;line-height:1.5}a{display:inline-block;margin-top:1rem;background:#fff;color:#000;padding:.7rem 1rem;border-radius:.6rem;text-decoration:none;font-size:13px}</style><main><strong>This game host blocked the embedded request.</strong><p>Open the original game page to continue.</p><a href="${safeTarget}" target="_blank" rel="noopener noreferrer">Open original</a></main>`);
    }
    let html = await upstream.text();
    const base = target.toString().replace(/[^/]*$/, "");
    if (!/<base\s/i.test(html)) html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, `$&<base href="${escapeHtml(base)}">`) : `<base href="${escapeHtml(base)}">${html}`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).send(html);
  } catch { return res.status(502).send("Unable to load game host"); }
}
