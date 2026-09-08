import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

// JSON and URL parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// API Proxy Route: Fetch game iframe URL
app.get("/api/lumin-game-url/*", async (req, res) => {
  try {
    const sessionHeader = req.headers["x-session"] as string || "";
    const gameId = req.params[0];
    const response = await fetch(`https://a.luminsdk.com/api/v1/games/${gameId}/url`, {
      headers: { "X-Session": sessionHeader },
    });
    if (response.ok) {
      const data = await response.json();
      res.json(data);
    } else {
      res.status(response.status).json({ error: "Lumin game URL fetch failed" });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API Proxy Route: Fetch game icon image directly to avoid CORS issues
app.get("/api/lumin-icon/*", async (req, res) => {
  try {
    const iconUrl = req.params[0];
    if (!iconUrl) return res.status(400).send("No icon URL provided");
    const response = await fetch(iconUrl);
    if (!response.ok) throw new Error("Failed to fetch icon");
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "image/png";
    res.setHeader("Content-Type", contentType);
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).send("Icon proxy error");
  }
});

// Proxies game HTML to bypass strict CORS and inject auto-fit scripts
app.get("/api/game-frame", async (req, res) => {
  try {
    const rawUrl = req.query.url as string;
    if (!rawUrl) return res.status(400).send("Missing game URL");

    const response = await fetch(rawUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    if (!response.ok) {
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        return res.redirect(response.headers.get("location") as string);
      }
      return res.status(response.status).send(await response.text());
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return res.redirect(rawUrl);
    }

    let html = await response.text();

    if (!/<base\s/i.test(html)) {
      const lastSlashIndex = rawUrl.lastIndexOf("/");
      const baseDir = lastSlashIndex > 0 ? rawUrl.substring(0, lastSlashIndex + 1) : rawUrl;
      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, `$&<base href="${baseDir}">`);
      } else {
        html = `<base href="${baseDir}">` + html;
      }
    }

    const fitInjection = `<style id="frosted-game-fit-engine">  html, body {    margin: 0 !important;    padding: 0 !important;    width: 100vw !important;    height: 100vh !important;    max-width: 100vw !important;    max-height: 100vh !important;    overflow: hidden !important;    background: #000000 !important;    display: flex !important;    align-items: center !important;    justify-content: center !important;  }  #loading-text {    position: fixed !important;    top: 14px !important;    left: 50% !important;    transform: translateX(-50%) !important;    font-size: 15px !important;    font-weight: 600 !important;    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;    color: #ffffff !important;    background: rgba(18, 18, 18, 0.88) !important;    padding: 6px 18px !important;    border-radius: 9999px !important;    border: 1px solid rgba(255, 255, 255, 0.18) !important;    z-index: 999999 !important;    pointer-events: none !important;    margin: 0 !important;    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6) !important;    backdrop-filter: blur(8px) !important;  }  #unity-container, .unity-desktop, #gameContainer, #canvas-container, #game-container, #c2canvasdiv, .emscripten_border, #player, #root {    position: absolute !important;    top: 0 !important;    left: 0 !important;    right: 0 !important;    bottom: 0 !important;    width: 100% !important;    height: 100% !important;    max-width: 100vw !important;    max-height: 100vh !important;    margin: 0 !important;    padding: 0 !important;    display: flex !important;    align-items: center !important;    justify-content: center !important;    transform: none !important;  }  canvas, #unity-canvas, #canvas, .emscripten {    display: block !important;    max-width: 100vw !important;    max-height: 100vh !important;    object-fit: contain !important;    margin: auto !important;  }  #unity-loading-bar {    position: absolute !important;    left: 50% !important;    transform: translate(-50%, -50%) !important;    z-index: 99999 !important;  }</style><script id="frosted-game-fit-script">(function() {  function fitElements() {    try {      var vw = window.innerWidth;      var vh = window.innerHeight;      var canvases = document.querySelectorAll('canvas');      for (var i = 0; i < canvases.length; i++) {        var c = canvases[i];        if (c) {          var cw = c.width || c.clientWidth || 0;          var ch = c.height || c.clientHeight || 0;          if (cw > 0 && ch > 0) {            var ratio = cw / ch;            var targetW = vw;            var targetH = vw / ratio;            if (targetH > vh) {              targetH = vh;              targetW = vh * ratio;            }            c.style.setProperty('width', Math.floor(targetW) + 'px', 'important');            c.style.setProperty('height', Math.floor(targetH) + 'px', 'important');          } else {            c.style.setProperty('width', '100%', 'important');            c.style.setProperty('height', '100%', 'important');          }          c.style.setProperty('max-width', '100vw', 'important');          c.style.setProperty('max-height', '100vh', 'important');          c.style.setProperty('object-fit', 'contain', 'important');          c.style.setProperty('display', 'block', 'important');          c.style.setProperty('margin', 'auto', 'important');        }      }    } catch(e) {}  }  window.addEventListener('resize', fitElements);  window.addEventListener('DOMContentLoaded', fitElements);  setInterval(fitElements, 500);})();</script>`;

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

// --- Mock Sethbase Endpoints ---
const DB_FILE = process.env.VERCEL ? '/tmp/sethbase.json' : './sethbase.json';
let dbCollections: Record<string, Record<string, any>> = {};

try {
  if (fs.existsSync(DB_FILE)) {
    dbCollections = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  }
} catch (e) {
  dbCollections = {};
}

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(dbCollections));
  } catch (e) {}
}

app.get('/api/sethbase', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  const path = req.query.path as string;
  if (!path) return res.status(400).send('No path');
  const col = dbCollections[path] || {};
  const docs = Object.values(col).sort((a, b) => {
    const tA = a.createdAt || a.timestamp || 0;
    const tB = b.createdAt || b.timestamp || 0;
    return tA - tB;
  });
  res.json(docs);
});

app.post('/api/sethbase', (req, res) => {
  const path = req.query.path as string;
  if (!path) return res.status(400).send('No path');
  if (!dbCollections[path]) dbCollections[path] = {};
  
  const id = Date.now().toString() + Math.random().toString(36).substring(7);
  const docData = { ...req.body, id, _id: id };
  dbCollections[path][id] = docData;
  saveDb();
  res.json({ id });
});

app.all('/api/sethbase/:collection/:id', (req, res) => {
  const { collection, id } = req.params;
  if (!dbCollections[collection]) dbCollections[collection] = {};
  
  if (req.method === 'DELETE') {
    delete dbCollections[collection][id];
    saveDb();
    return res.json({ success: true });
  }

  if (req.method === 'PUT') {
    const { data, options } = req.body;
    if (options?.merge) {
      dbCollections[collection][id] = { ...dbCollections[collection][id], ...data, id, _id: id };
    } else {
      dbCollections[collection][id] = { ...data, id, _id: id };
    }
    saveDb();
    return res.json({ success: true });
  }

  if (req.method === 'PATCH') {
    dbCollections[collection][id] = { ...dbCollections[collection][id], ...req.body, id, _id: id };
    saveDb();
    return res.json({ success: true });
  }

  res.status(405).send('Method not allowed');
});

app.post('/api/sethbase_batch', (req, res) => {
  const ops = req.body.ops || [];
  for (const op of ops) {
    const parts = op.path.split('/');
    const col = parts[0];
    const id = parts[1];
    if (!dbCollections[col]) dbCollections[col] = {};
    
    if (op.type === 'delete') {
      delete dbCollections[col][id];
    } else if (op.type === 'set') {
      if (op.options?.merge) {
        dbCollections[col][id] = { ...dbCollections[col][id], ...op.data, id, _id: id };
      } else {
        dbCollections[col][id] = { ...op.data, id, _id: id };
      }
    } else if (op.type === 'update') {
      dbCollections[col][id] = { ...dbCollections[col][id], ...op.data, id, _id: id };
    }
  }
  saveDb();
  res.json({ success: true });
});
// --------------------------------

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", mode: process.env.NODE_ENV });
});

async function startServer() {
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

// Only start the server naturally if we are NOT in Vercel
if (!process.env.VERCEL) {
  startServer();
}

// Export the Express app universally so Vercel can mount it as a Serverless Function
export default app;
