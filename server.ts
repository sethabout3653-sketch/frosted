import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

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
      if (!rawUrl) {
        return res.status(400).send("Missing url parameter");
      }

      const response = await fetch(rawUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        return res.redirect(rawUrl);
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
        // The hosted preview does not expose Vite's HMR websocket endpoint.
        // Disable it explicitly here so @vite/client never attempts a socket.
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
