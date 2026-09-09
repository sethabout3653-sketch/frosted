import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import multer from "multer";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Ensure uploads directory exists (fall back to /tmp/uploads on read-only environments like Cloud Run)
  let uploadsDir = path.join(process.cwd(), "uploads");
  try {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const testFile = path.join(uploadsDir, ".test");
    fs.writeFileSync(testFile, "test");
    fs.unlinkSync(testFile);
  } catch (e) {
    console.warn("Workspace uploads directory is not writable, falling back to /tmp/uploads");
    uploadsDir = "/tmp/uploads";
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
  }

  // Configure multer storage
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname);
      const safeName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, "_");
      cb(null, `${safeName}-${uniqueSuffix}${ext}`);
    },
  });

  const upload = multer({
    storage: storage,
    limits: {
      fileSize: Infinity, // Allow any file size (videos, GBs, etc.)
    },
  });

  // CORS and preflight headers for all API requests
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, X-Session");
    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }
    next();
  });

  // Serve uploads directory publicly with fallback to /tmp/uploads
  app.use("/uploads", express.static(uploadsDir));
  app.use("/uploads", express.static("/tmp/uploads"));

  app.get("/uploads/:filename", (req, res) => {
    const fn = path.basename(req.params.filename);
    const p1 = path.join(uploadsDir, fn);
    const p2 = path.join("/tmp/uploads", fn);
    if (fs.existsSync(p1)) {
      return res.sendFile(p1);
    }
    if (fs.existsSync(p2)) {
      return res.sendFile(p2);
    }
    res.status(404).json({ error: "File not found in storage" });
  });

  // JSON and URL parsing middleware with generous limit for large attachments
  app.use(express.json({ limit: "100mb" }));
  app.use(express.urlencoded({ extended: true, limit: "100mb" }));

  // ==========================================
  // SethBase Realtime Database Storage & State
  // ==========================================
  const sethbaseStoreFile = path.join(uploadsDir, "sethbase_store.json");
  let sethbaseData: Record<string, Record<string, any>> = {};
  let sethbaseChangeHistory: Array<{
    timestamp: number;
    collection: string;
    id: string;
    op: string;
    data: any;
  }> = [];

  try {
    if (fs.existsSync(sethbaseStoreFile)) {
      sethbaseData = JSON.parse(fs.readFileSync(sethbaseStoreFile, "utf-8"));
    }
  } catch (e) {
    console.warn("[SethBase] No prior disk store found, initializing empty store");
  }

  const saveSethbaseStore = () => {
    try {
      fs.writeFileSync(sethbaseStoreFile, JSON.stringify(sethbaseData), "utf-8");
    } catch (e) {
      // Ignore disk write failure in read-only sandbox
    }
  };

  // Connected SSE clients for real-time broadcasts (No WebSockets!)
  const sseClients = new Set<express.Response>();

  const broadcastSethBaseChange = (
    op: string,
    collection: string,
    id: string,
    data: any
  ) => {
    const payload = JSON.stringify({
      type: "change",
      op,
      collection,
      id,
      data,
      timestamp: Date.now(),
    });

    sseClients.forEach((client) => {
      try {
        client.write(`data: ${payload}\n\n`);
        (client as any).flush?.();
      } catch (e) {
        sseClients.delete(client);
      }
    });
  };

  // 1. SethBase Realtime SSE Stream (No WebSockets - 100% Vercel & HTTP Stream Compatible)
  app.get(["/api/sethbase/stream", "/api/sethbase-stream"], (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    // Send initial 2KB comment padding to force proxies/nginx to flush buffer immediately
    res.write(":" + " ".repeat(2048) + "\n\n");

    // Send initial connection handshake and all existing documents
    res.write(
      `data: ${JSON.stringify({
        type: "connected",
        provider: "SethBase Realtime Engine",
        quota: "Unlimited (0 / \u221E)",
        serverTime: Date.now(),
      })}\n\n`
    );

    res.write(
      `data: ${JSON.stringify({
        type: "init",
        data: sethbaseData,
      })}\n\n`
    );
    (res as any).flush?.();

    sseClients.add(res);

    // Heartbeat ping every 10 seconds to keep connection alive indefinitely
    const heartbeat = setInterval(() => {
      try {
        res.write(":ping\n\n");
      } catch (e) {
        clearInterval(heartbeat);
      }
    }, 10000);

    req.on("close", () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  // 2. SethBase Data / Query Endpoint
  app.get("/api/sethbase/data", (req, res) => {
    const col = req.query.collection as string;
    if (col) {
      return res.json(sethbaseData[col] || {});
    }
    res.json({
      status: "online",
      provider: "SethBase",
      quota: "Unlimited (0 / \u221E)",
      collections: Object.keys(sethbaseData),
      data: sethbaseData,
    });
  });

  // 3. SethBase Write Endpoint (Single, Update, Delete, and Batch)
  app.post("/api/sethbase/write", (req, res) => {
    try {
      const { op, collection: col, id, data } = req.body || {};
      if (!col || !id) {
        return res.status(400).json({ error: "Missing collection or id" });
      }

      if (!sethbaseData[col]) {
        sethbaseData[col] = {};
      }

      if (op === "delete") {
        delete sethbaseData[col][id];
      } else if (op === "update") {
        sethbaseData[col][id] = {
          ...(sethbaseData[col][id] || {}),
          ...data,
          id,
        };
      } else {
        sethbaseData[col][id] = { ...data, id };
      }

      saveSethbaseStore();

      const changeRecord = {
        timestamp: Date.now(),
        collection: col,
        id,
        op: op || "set",
        data,
      };

      sethbaseChangeHistory.push(changeRecord);
      if (sethbaseChangeHistory.length > 1000) {
        sethbaseChangeHistory = sethbaseChangeHistory.slice(-1000);
      }

      // Broadcast to all SSE listeners in real time
      broadcastSethBaseChange(op || "set", col, id, data);

      res.json({ success: true, timestamp: changeRecord.timestamp });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4. SethBase Poll Endpoint (Fallback for environments without persistent SSE)
  app.get("/api/sethbase/poll", (req, res) => {
    const since = parseInt(req.query.since as string, 10) || 0;
    const newChanges = sethbaseChangeHistory.filter((c) => c.timestamp > since);
    res.json({
      timestamp: Date.now(),
      changes: newChanges,
      ...(since === 0 ? { fullData: sethbaseData } : {}),
    });
  });

  // 5. SethBase Status
  app.get("/api/sethbase/status", (req, res) => {
    res.json({
      status: "online",
      provider: "SethBase Realtime Engine",
      quota: "Unlimited (0 / \u221E)",
      transport: "Server-Sent Events (SSE) - No WebSockets, Vercel Compatible",
      activeClients: sseClients.size,
      collections: Object.keys(sethbaseData),
      documentCount: Object.values(sethbaseData).reduce(
        (acc, col) => acc + Object.keys(col).length,
        0
      ),
    });
  });

  // ==========================================
  // SethBase Unlimited File Upload Engine
  // ==========================================
  const handleFileUpload = (req: express.Request, res: express.Response) => {
    try {
      // A. Multipart file from Multer
      const file = (req as any).file || (req as any).files?.[0];
      if (file) {
        const fileUrl = `/uploads/${file.filename}`;
        return res.json({
          url: fileUrl,
          filename: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
        });
      }

      // B. JSON payload with base64 data URL
      if (req.body && req.body.fileData) {
        const { fileData, filename, mimetype, size } = req.body;
        // Optionally save to disk as a file if it's base64
        const matches = fileData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          const ext = mimetype ? `.${mimetype.split("/")[1] || "bin"}` : ".bin";
          const uniqueName = `upload-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
          const filePath = path.join(uploadsDir, uniqueName);
          try {
            fs.writeFileSync(filePath, Buffer.from(matches[2], "base64"));
            return res.json({
              url: `/uploads/${uniqueName}`,
              filename: filename || uniqueName,
              mimetype: mimetype || matches[1],
              size: size || fileData.length,
            });
          } catch (e) {}
        }

        return res.json({
          url: fileData,
          filename: filename || "uploaded_file",
          mimetype: mimetype || "application/octet-stream",
          size: size || fileData.length,
        });
      }

      return res.status(400).json({ error: "No file provided" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // Support upload via multiple paths and methods to guarantee no 404
  app.post("/api/upload", upload.any(), handleFileUpload);
  app.post("/api/sethbase/upload", upload.any(), handleFileUpload);
  app.post("/upload", upload.any(), handleFileUpload);

  // Informative GET on /api/upload so it never 404s
  app.get(["/api/upload", "/api/sethbase/upload"], (req, res) => {
    res.json({
      status: "ready",
      provider: "SethBase Unlimited Storage Engine",
      quota: "Unlimited (0 / \u221E)",
      message: "Ready to accept uploads via POST multipart/form-data or JSON base64",
    });
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
