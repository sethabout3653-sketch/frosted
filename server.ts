import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { pool } from "./src/db/index.ts";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // JSON and URL parsing middleware
  app.use(express.json({ limit: "15mb" }));
  app.use(express.urlencoded({ extended: true, limit: "15mb" }));

  // Realtime SSE Event Bus
  const sseClients = new Set<express.Response>();

  function normalizeRow(row: any) {
    if (!row || typeof row !== "object") return row;
    const result: any = { ...row };
    if ("photo_url" in row) {
      result.photoURL = row.photo_url;
      result.photoUrl = row.photo_url;
    }
    if ("last_seen" in row && row.last_seen !== null) {
      result.lastSeen = Number(row.last_seen);
    }
    if ("in_voice" in row) {
      result.inVoice = Boolean(row.in_voice);
    }
    if ("is_muted" in row) {
      result.isMuted = Boolean(row.is_muted);
    }
    if ("is_video_on" in row) {
      result.isVideoOn = Boolean(row.is_video_on);
    }
    if ("is_video_loading" in row) {
      result.isVideoLoading = Boolean(row.is_video_loading);
    }
    if ("sender_id" in row) {
      result.senderId = row.sender_id;
    }
    if ("receiver_id" in row) {
      result.receiverId = row.receiver_id;
    }
    if ("timestamp" in row && row.timestamp !== null) {
      result.timestamp = Number(row.timestamp);
    }
    return result;
  }

  function broadcastDbEvent(table: string, eventType: string, record: any) {
    const norm = normalizeRow(record);
    const payload = JSON.stringify({
      table,
      eventType,
      schema: "public",
      new: eventType !== "DELETE" ? norm : null,
      old: eventType !== "INSERT" ? norm : null,
      record: norm,
    });
    for (const client of sseClients) {
      try {
        client.write(`data: ${payload}\n\n`);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  // SSE Realtime Endpoint
  app.get("/api/db-realtime", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    res.write(`data: ${JSON.stringify({ status: "connected" })}\n\n`);
    sseClients.add(res);

    const keepAlive = setInterval(() => {
      res.write(": keepalive\n\n");
    }, 15000);

    req.on("close", () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
  });

  const ALLOWED_TABLES = new Set(["messages", "presence", "voice_users", "signals"]);
  const FIELD_MAP: Record<string, string> = {
    photoURL: "photo_url",
    photoUrl: "photo_url",
    lastSeen: "last_seen",
    inVoice: "in_voice",
    isMuted: "is_muted",
    isVideoOn: "is_video_on",
    isVideoLoading: "is_video_loading",
    senderId: "sender_id",
    receiverId: "receiver_id",
  };

  function toDbField(field: string): string {
    return FIELD_MAP[field] || field;
  }

  function parseFilter(query: any): { whereClauses: string[]; params: any[] } {
    const whereClauses: string[] = [];
    const params: any[] = [];
    const reserved = new Set(["select", "order", "ascending", "limit", "on_conflict"]);

    for (const [key, value] of Object.entries(query)) {
      if (reserved.has(key)) continue;
      const col = toDbField(key);
      const strVal = String(value);
      if (strVal.startsWith("eq.")) {
        params.push(strVal.substring(3));
        whereClauses.push(`"${col}" = $${params.length}`);
      } else if (strVal.startsWith("neq.")) {
        params.push(strVal.substring(4));
        whereClauses.push(`"${col}" != $${params.length}`);
      } else if (strVal.startsWith("gt.")) {
        params.push(strVal.substring(3));
        whereClauses.push(`"${col}" > $${params.length}`);
      } else if (strVal.startsWith("gte.")) {
        params.push(strVal.substring(4));
        whereClauses.push(`"${col}" >= $${params.length}`);
      } else if (strVal.startsWith("lt.")) {
        params.push(strVal.substring(3));
        whereClauses.push(`"${col}" < $${params.length}`);
      } else if (strVal.startsWith("lte.")) {
        params.push(strVal.substring(4));
        whereClauses.push(`"${col}" <= $${params.length}`);
      } else {
        params.push(strVal);
        whereClauses.push(`"${col}" = $${params.length}`);
      }
    }
    return { whereClauses, params };
  }

  // Database Query API: GET /api/db/:table
  app.get("/api/db/:table", async (req, res) => {
    const table = req.params.table;
    if (!ALLOWED_TABLES.has(table)) {
      return res.status(400).json({ data: null, error: `Invalid table ${table}` });
    }

    try {
      const { whereClauses, params } = parseFilter(req.query);
      let queryText = `SELECT * FROM "${table}"`;
      if (whereClauses.length > 0) {
        queryText += ` WHERE ${whereClauses.join(" AND ")}`;
      }

      if (req.query.order) {
        const orderCol = toDbField(String(req.query.order));
        const dir = req.query.ascending === "true" ? "ASC" : "DESC";
        queryText += ` ORDER BY "${orderCol}" ${dir}`;
      }

      if (req.query.limit) {
        const limitNum = parseInt(String(req.query.limit), 10);
        if (!isNaN(limitNum) && limitNum > 0) {
          queryText += ` LIMIT ${limitNum}`;
        }
      }

      const result = await pool.query(queryText, params);
      const rows = result.rows.map(normalizeRow);
      res.json({ data: rows, error: null });
    } catch (err: any) {
      console.error(`Error querying ${table}:`, err);
      res.status(500).json({ data: null, error: err.message });
    }
  });

  // Database Insert / Upsert API: POST /api/db/:table
  app.post("/api/db/:table", async (req, res) => {
    const table = req.params.table;
    if (!ALLOWED_TABLES.has(table)) {
      return res.status(400).json({ data: null, error: `Invalid table ${table}` });
    }

    try {
      const rawRows = Array.isArray(req.body) ? req.body : [req.body];
      const insertedRows: any[] = [];

      for (const rawItem of rawRows) {
        if (!rawItem || typeof rawItem !== "object") continue;

        const record: Record<string, any> = {};
        for (const [k, v] of Object.entries(rawItem)) {
          record[toDbField(k)] = v;
        }

        // Auto-generate id if missing
        if (!record.id && (table === "messages" || table === "signals")) {
          record.id = "id_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
        }

        const keys = Object.keys(record);
        if (keys.length === 0) continue;

        const cols = keys.map((k) => `"${k}"`).join(", ");
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
        const values = keys.map((k) => record[k]);

        const onConflict = String(req.query.on_conflict || (table === "presence" || table === "voice_users" ? "uid" : ""));

        let queryText = `INSERT INTO "${table}" (${cols}) VALUES (${placeholders})`;

        if (onConflict) {
          const conflictCol = toDbField(onConflict);
          const updateSets = keys
            .filter((k) => k !== conflictCol)
            .map((k) => `"${k}" = EXCLUDED."${k}"`)
            .join(", ");

          if (updateSets.length > 0) {
            queryText += ` ON CONFLICT ("${conflictCol}") DO UPDATE SET ${updateSets}`;
          } else {
            queryText += ` ON CONFLICT ("${conflictCol}") DO NOTHING`;
          }
        }

        queryText += " RETURNING *";

        const result = await pool.query(queryText, values);
        if (result.rows[0]) {
          const norm = normalizeRow(result.rows[0]);
          insertedRows.push(norm);
          broadcastDbEvent(table, "INSERT", norm);
        }
      }

      res.json({ data: insertedRows, error: null });
    } catch (err: any) {
      console.error(`Error inserting into ${table}:`, err);
      res.status(500).json({ data: null, error: err.message });
    }
  });

  // Database Update API: PATCH /api/db/:table
  app.patch("/api/db/:table", async (req, res) => {
    const table = req.params.table;
    if (!ALLOWED_TABLES.has(table)) {
      return res.status(400).json({ data: null, error: `Invalid table ${table}` });
    }

    try {
      const updates: Record<string, any> = {};
      for (const [k, v] of Object.entries(req.body)) {
        updates[toDbField(k)] = v;
      }

      const updateKeys = Object.keys(updates);
      if (updateKeys.length === 0) {
        return res.json({ data: [], error: null });
      }

      const params: any[] = [];
      const setClauses: string[] = [];

      for (const key of updateKeys) {
        params.push(updates[key]);
        setClauses.push(`"${key}" = $${params.length}`);
      }

      const { whereClauses, params: whereParams } = parseFilter(req.query);
      for (const wp of whereParams) {
        params.push(wp);
      }

      const adjustedWhere = whereClauses.map((clause, idx) => {
        return clause.replace(/\$\d+/, `$${updateKeys.length + idx + 1}`);
      });

      let queryText = `UPDATE "${table}" SET ${setClauses.join(", ")}`;
      if (adjustedWhere.length > 0) {
        queryText += ` WHERE ${adjustedWhere.join(" AND ")}`;
      }
      queryText += " RETURNING *";

      const result = await pool.query(queryText, params);
      const rows = result.rows.map(normalizeRow);
      rows.forEach((r) => broadcastDbEvent(table, "UPDATE", r));
      res.json({ data: rows, error: null });
    } catch (err: any) {
      console.error(`Error updating ${table}:`, err);
      res.status(500).json({ data: null, error: err.message });
    }
  });

  // Database Delete API: DELETE /api/db/:table
  app.delete("/api/db/:table", async (req, res) => {
    const table = req.params.table;
    if (!ALLOWED_TABLES.has(table)) {
      return res.status(400).json({ data: null, error: `Invalid table ${table}` });
    }

    try {
      const { whereClauses, params } = parseFilter(req.query);
      let queryText = `DELETE FROM "${table}"`;
      if (whereClauses.length > 0) {
        queryText += ` WHERE ${whereClauses.join(" AND ")}`;
      }
      queryText += " RETURNING *";

      const result = await pool.query(queryText, params);
      const rows = result.rows.map(normalizeRow);
      rows.forEach((r) => broadcastDbEvent(table, "DELETE", r));
      res.json({ data: rows, error: null });
    } catch (err: any) {
      console.error(`Error deleting from ${table}:`, err);
      res.status(500).json({ data: null, error: err.message });
    }
  });

  // API Proxy Route: Create session
  app.post("/api/lumin-session", async (req, res) => {
    try {
      const response = await fetch("https://a.luminsdk.com/api/v1/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (response.ok) {
        const data = await response.json();
        res.json(data);
      } else {
        res.status(response.status).json({ error: "Lumin session creation failed" });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // API Proxy Route: Fetch game list
  app.get("/api/lumin-games", async (req, res) => {
    try {
      const sessionHeader = req.headers["x-session"] as string || "";
      const response = await fetch("https://a.luminsdk.com/api/v1/games?limit=5000", {
        headers: { "X-Session": sessionHeader },
      });
      if (response.ok) {
        const data = await response.json();
        res.json(data);
      } else {
        res.status(response.status).json({ error: "Lumin games fetch failed" });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // API Proxy Route: Resolve game details & direct URL (using wildcard to support slashes in game IDs)
  app.get("/api/lumin-game-url/*", async (req, res) => {
    try {
      const gameId = req.params[0];
      const sessionHeader = (req.headers["x-session"] as string) || "";
      const response = await fetch(`https://a.luminsdk.com/api/v1/games/${gameId}`, {
        headers: { "X-Session": sessionHeader },
      });
      if (response.ok) {
        const data = await response.json();
        res.json(data);
      } else {
        res.status(response.status).json({ error: "Lumin game details fetch failed" });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // API Proxy Route: Stream and Cache game icons/covers (using wildcard to support slashes in tokens)
  app.get("/api/lumin-icon/*", async (req, res) => {
    try {
      const token = req.params[0];
      const response = await fetch(`https://a.luminsdk.com/api/v1/icon/${token}`);
      if (response.ok && response.body) {
        res.setHeader("Content-Type", response.headers.get("Content-Type") || "image/png");
        res.setHeader("Cache-Control", "public, max-age=86400"); // Cache locally for 1 day
        const arrayBuffer = await response.arrayBuffer();
        res.send(Buffer.from(arrayBuffer));
      } else {
        res.status(response.status || 404).end();
      }
    } catch (err) {
      res.status(500).end();
    }
  });

  // API Proxy Route: Game Frame with Auto-Fit Responsive Engine
  app.get("/api/game-frame", async (req, res) => {
    try {
      const rawUrl = req.query.url as string;
      if (!rawUrl) return res.status(400).send("Missing url parameter");
      let target: URL;
      try { target = new URL(rawUrl); } catch { return res.status(400).send("Invalid game URL"); }
      const allowedHosts = ["myinstants.com", "www.myinstants.com", "raw.githubusercontent.com", "rawcdn.githack.com", "cdn.jsdelivr.net"];
      if (target.protocol !== "https:" || !allowedHosts.includes(target.hostname)) {
        return res.status(403).send("Game host is not allowed");
      }

      const response = await fetch(target, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        res.setHeader("Content-Type", response.headers.get("content-type") || "text/html; charset=utf-8");
        return res.status(response.status).send(await response.text());
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) {
        // If not HTML, redirect directly to asset
        return res.redirect(rawUrl);
      }

      let html = await response.text();

      // Ensure <base> tag exists pointing to the origin directory of the file so relative paths resolve cleanly
      if (!/<base\s/i.test(html)) {
        const lastSlashIndex = rawUrl.lastIndexOf("/");
        const baseDir = lastSlashIndex > 0 ? rawUrl.substring(0, lastSlashIndex + 1) : rawUrl;
        if (/<head[^>]*>/i.test(html)) {
          html = html.replace(/<head[^>]*>/i, `$&<base href="${baseDir}">`);
        } else {
          html = `<base href="${baseDir}">` + html;
        }
      }

      // Auto-fit responsive injection for canvas, Unity containers, and loading elements
      const fitInjection = `
<style id="frosted-game-fit-engine">
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    max-width: 100vw !important;
    max-height: 100vh !important;
    overflow: hidden !important;
    background: #000000 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
  }
  #loading-text {
    position: fixed !important;
    top: 14px !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    font-size: 15px !important;
    font-weight: 600 !important;
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    color: #ffffff !important;
    background: rgba(18, 18, 18, 0.88) !important;
    padding: 6px 18px !important;
    border-radius: 9999px !important;
    border: 1px solid rgba(255, 255, 255, 0.18) !important;
    z-index: 999999 !important;
    pointer-events: none !important;
    margin: 0 !important;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6) !important;
    backdrop-filter: blur(8px) !important;
  }
  #unity-container, .unity-desktop, #gameContainer, #canvas-container, #game-container, #c2canvasdiv, .emscripten_border, #player, #root {
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    width: 100% !important;
    height: 100% !important;
    max-width: 100vw !important;
    max-height: 100vh !important;
    margin: 0 !important;
    padding: 0 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    transform: none !important;
  }
  canvas, #unity-canvas, #canvas, .emscripten {
    display: block !important;
    max-width: 100vw !important;
    max-height: 100vh !important;
    object-fit: contain !important;
    margin: auto !important;
  }
  #unity-loading-bar {
    position: absolute !important;
    left: 50% !important;
    top: 50% !important;
    transform: translate(-50%, -50%) !important;
    z-index: 99999 !important;
  }
</style>
<script id="frosted-game-fit-script">
(function() {
  function fitElements() {
    try {
      var vw = window.innerWidth;
      var vh = window.innerHeight;
      var canvases = document.querySelectorAll('canvas');
      for (var i = 0; i < canvases.length; i++) {
        var c = canvases[i];
        if (c) {
          var cw = c.width || c.clientWidth || 0;
          var ch = c.height || c.clientHeight || 0;
          if (cw > 0 && ch > 0) {
            var ratio = cw / ch;
            var targetW = vw;
            var targetH = vw / ratio;
            if (targetH > vh) {
              targetH = vh;
              targetW = vh * ratio;
            }
            c.style.setProperty('width', Math.floor(targetW) + 'px', 'important');
            c.style.setProperty('height', Math.floor(targetH) + 'px', 'important');
          } else {
            c.style.setProperty('width', '100%', 'important');
            c.style.setProperty('height', '100%', 'important');
          }
          c.style.setProperty('max-width', '100vw', 'important');
          c.style.setProperty('max-height', '100vh', 'important');
          c.style.setProperty('object-fit', 'contain', 'important');
          c.style.setProperty('display', 'block', 'important');
          c.style.setProperty('margin', 'auto', 'important');
        }
      }
    } catch(e) {}
  }
  window.addEventListener('resize', fitElements);
  window.addEventListener('DOMContentLoaded', fitElements);
  setInterval(fitElements, 500);
})();
</script>
`;

      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<\/head>/i, `${fitInjection}</head>`);
      } else {
        html = `${fitInjection}${html}`;
      }

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.removeHeader("X-Frame-Options");
      res.removeHeader("Content-Security-Policy");
      res.send(html);
    } catch (err: any) {
      if (req.query.url) {
        return res.redirect(req.query.url as string);
      }
      res.status(500).send("Game proxy error");
    }
  });

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", mode: process.env.NODE_ENV });
  });

  // Vite integration and static asset serving
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: null,
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
