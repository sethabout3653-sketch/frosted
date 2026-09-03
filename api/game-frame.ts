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
    if (!upstream.ok) {
      const body = await upstream.text();
      res.setHeader("Content-Type", type || "text/html; charset=utf-8");
      return res.status(upstream.status).send(body);
    }
    if (!type.includes("text/html")) {
      res.setHeader("Content-Type", type || "application/octet-stream");
      return res.status(200).send(await upstream.text());
    }
    let html = await upstream.text();
    const base = target.toString().replace(/[^/]*$/, "");
    if (!/<base\s/i.test(html)) html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, `$&<base href="${escapeHtml(base)}">`) : `<base href="${escapeHtml(base)}">${html}`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).send(html);
  } catch { return res.status(502).send("Unable to load game host"); }
}
