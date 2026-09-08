import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";

// Real-time In-Memory Data Store (Zero quota limits, zero delay)
interface ChatMessageData {
  id: string;
  uid: string;
  username: string;
  photoURL: string;
  text?: string;
  gif?: string;
  attachment?: string;
  timestamp: number;
}

interface VoiceUserData {
  uid: string;
  username: string;
  photoURL: string;
  isMuted?: boolean;
  isVideoOn?: boolean;
  isVideoLoading?: boolean;
  timestamp: number;
  lastSeen?: number;
}

interface PresenceData {
  uid: string;
  username: string;
  photoURL: string;
  status: "online" | "left" | "offline";
  lastSeen: number;
  isMuted?: boolean;
  inVoice?: boolean;
}

interface VoiceSignalData {
  id: string;
  senderId: string;
  receiverId: string;
  type: "offer" | "answer" | "candidate";
  data: string;
  timestamp: number;
}

const store = {
  messages: [] as ChatMessageData[],
  voiceUsers: new Map<string, VoiceUserData>(),
  presence: new Map<string, PresenceData>(),
  signals: new Map<string, VoiceSignalData>(),
};

// Map connected WebSockets to metadata
const connectedClients = new Map<WebSocket, { uid?: string }>();

function broadcast(payload: any, excludeWs?: WebSocket) {
  const messageStr = JSON.stringify(payload);
  for (const [client] of connectedClients) {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      try {
        client.send(messageStr);
      } catch (err) {}
    }
  }
}

function sendToUser(targetUid: string, payload: any) {
  const messageStr = JSON.stringify(payload);
  for (const [client, meta] of connectedClients) {
    if (meta.uid === targetUid && client.readyState === WebSocket.OPEN) {
      try {
        client.send(messageStr);
      } catch (err) {}
    }
  }
}

// Auto-prune inactive voice users and presence
setInterval(() => {
  const now = Date.now();
  let voiceChanged = false;
  for (const [uid, user] of store.voiceUsers) {
    const ts = user.timestamp || user.lastSeen || 0;
    if (now - ts > 75000) {
      store.voiceUsers.delete(uid);
      voiceChanged = true;
    }
  }
  if (voiceChanged) {
    broadcast({
      type: "sync_collection",
      collection: "voice_users",
      data: Array.from(store.voiceUsers.values()),
    });
  }

  // Clear stale signals older than 30s
  for (const [id, signal] of store.signals) {
    if (now - signal.timestamp > 30000) {
      store.signals.delete(id);
    }
  }
}, 15000);

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = 3000;

  // JSON and URL parsing middleware
  app.use(express.json({ limit: "15mb" }));
  app.use(express.urlencoded({ extended: true, limit: "15mb" }));

  // WebSocket Server setup
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const pathname = request.url
      ? new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname
      : "";
    if (pathname === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });

  wss.on("connection", (ws: WebSocket) => {
    connectedClients.set(ws, {});

    // Send full initial state snapshots on connection
    ws.send(
      JSON.stringify({
        type: "sync_collection",
        collection: "messages",
        data: store.messages.slice(-100),
      })
    );
    ws.send(
      JSON.stringify({
        type: "sync_collection",
        collection: "voice_users",
        data: Array.from(store.voiceUsers.values()),
      })
    );
    ws.send(
      JSON.stringify({
        type: "sync_collection",
        collection: "presence",
        data: Array.from(store.presence.values()),
      })
    );

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const { action, collection: colName, data, id, uid, merge } = msg;

        if (action === "identify" && uid) {
          const meta = connectedClients.get(ws) || {};
          meta.uid = uid;
          connectedClients.set(ws, meta);
          return;
        }

        if (action === "add_doc") {
          const docId = id || "doc_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
          const fullDoc = { ...data, id: docId };

          if (colName === "messages") {
            store.messages.push(fullDoc);
            if (store.messages.length > 500) {
              store.messages = store.messages.slice(-500);
            }
            broadcast({ type: "add_doc", collection: "messages", doc: fullDoc });
          } else if (colName === "signals") {
            store.signals.set(docId, fullDoc);
            // Route signal immediately to receiver with 0ms delay
            if (fullDoc.receiverId) {
              sendToUser(fullDoc.receiverId, {
                type: "signal",
                collection: "signals",
                doc: fullDoc,
              });
            }
          }
          ws.send(JSON.stringify({ type: "doc_added", docId, collection: colName }));
        } else if (action === "set_doc") {
          const docId = id || data?.uid || "doc_" + Date.now();
          const docData = { ...data, id: docId };

          if (colName === "voice_users") {
            const existing = merge ? store.voiceUsers.get(docId) || {} : {};
            const merged = { ...existing, ...docData, uid: docId };
            store.voiceUsers.set(docId, merged as VoiceUserData);
            broadcast({ type: "set_doc", collection: "voice_users", doc: merged });
          } else if (colName === "presence") {
            const existing = merge ? store.presence.get(docId) || {} : {};
            const merged = { ...existing, ...docData, uid: docId };
            store.presence.set(docId, merged as PresenceData);
            broadcast({ type: "set_doc", collection: "presence", doc: merged });
          } else if (colName === "messages") {
            const idx = store.messages.findIndex((m) => m.id === docId);
            if (idx >= 0) {
              store.messages[idx] = { ...(merge ? store.messages[idx] : {}), ...docData };
            } else {
              store.messages.push(docData as ChatMessageData);
            }
            broadcast({ type: "set_doc", collection: "messages", doc: docData });
          }
        } else if (action === "update_doc") {
          const docId = id;
          if (colName === "voice_users") {
            const existing = store.voiceUsers.get(docId);
            if (existing) {
              const updated = { ...existing, ...data };
              store.voiceUsers.set(docId, updated);
              broadcast({ type: "update_doc", collection: "voice_users", doc: updated });
            }
          } else if (colName === "presence") {
            const existing = store.presence.get(docId);
            if (existing) {
              const updated = { ...existing, ...data };
              store.presence.set(docId, updated);
              broadcast({ type: "update_doc", collection: "presence", doc: updated });
            }
          } else if (colName === "messages") {
            const idx = store.messages.findIndex((m) => m.id === docId);
            if (idx >= 0) {
              store.messages[idx] = { ...store.messages[idx], ...data };
              broadcast({
                type: "update_doc",
                collection: "messages",
                doc: store.messages[idx],
              });
            }
          }
        } else if (action === "delete_doc") {
          const docId = id;
          if (colName === "messages") {
            store.messages = store.messages.filter((m) => m.id !== docId);
            broadcast({ type: "delete_doc", collection: "messages", id: docId });
          } else if (colName === "voice_users") {
            store.voiceUsers.delete(docId);
            broadcast({ type: "delete_doc", collection: "voice_users", id: docId });
          } else if (colName === "presence") {
            store.presence.delete(docId);
            broadcast({ type: "delete_doc", collection: "presence", id: docId });
          } else if (colName === "signals") {
            store.signals.delete(docId);
            // Notify receiver that signal was consumed
            broadcast({ type: "delete_doc", collection: "signals", id: docId });
          }
        }
      } catch (err) {
        console.error("WS message handling error:", err);
      }
    });

    ws.on("close", () => {
      const meta = connectedClients.get(ws);
      connectedClients.delete(ws);
      if (meta?.uid) {
        // If no other connection for this UID exists, mark presence as left
        const hasOtherConn = Array.from(connectedClients.values()).some(
          (m) => m.uid === meta.uid
        );
        if (!hasOtherConn) {
          const pres = store.presence.get(meta.uid);
          if (pres) {
            pres.status = "left";
            pres.inVoice = false;
            pres.lastSeen = Date.now();
            broadcast({ type: "set_doc", collection: "presence", doc: pres });
          }
          if (store.voiceUsers.has(meta.uid)) {
            store.voiceUsers.delete(meta.uid);
            broadcast({ type: "delete_doc", collection: "voice_users", id: meta.uid });
          }
        }
      }
    });
  });

  // REST API Endpoints for Real-Time fallback and hydration
  app.get("/api/realtime/messages", (req, res) => {
    res.json(store.messages.slice(-100));
  });

  app.post("/api/realtime/messages", (req, res) => {
    const docId = "msg_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
    const msg: ChatMessageData = { ...req.body, id: docId, timestamp: req.body.timestamp || Date.now() };
    store.messages.push(msg);
    if (store.messages.length > 500) {
      store.messages = store.messages.slice(-500);
    }
    broadcast({ type: "add_doc", collection: "messages", doc: msg });
    res.json(msg);
  });

  app.delete("/api/realtime/messages/:id", (req, res) => {
    const { id } = req.params;
    store.messages = store.messages.filter((m) => m.id !== id);
    broadcast({ type: "delete_doc", collection: "messages", id });
    res.json({ success: true, id });
  });

  app.get("/api/realtime/voice_users", (req, res) => {
    res.json(Array.from(store.voiceUsers.values()));
  });

  app.post("/api/realtime/voice_users", (req, res) => {
    const user: VoiceUserData = { ...req.body, uid: req.body.uid || "user_" + Date.now(), timestamp: Date.now() };
    store.voiceUsers.set(user.uid, user);
    broadcast({ type: "set_doc", collection: "voice_users", doc: user });
    res.json(user);
  });

  app.delete("/api/realtime/voice_users/:uid", (req, res) => {
    const { uid } = req.params;
    store.voiceUsers.delete(uid);
    broadcast({ type: "delete_doc", collection: "voice_users", id: uid });
    res.json({ success: true, uid });
  });

  app.get("/api/realtime/presence", (req, res) => {
    res.json(Array.from(store.presence.values()));
  });

  app.post("/api/realtime/presence", (req, res) => {
    const pres: PresenceData = { ...req.body, uid: req.body.uid, lastSeen: Date.now() };
    store.presence.set(pres.uid, pres);
    broadcast({ type: "set_doc", collection: "presence", doc: pres });
    res.json(pres);
  });

  app.post("/api/realtime/signals", (req, res) => {
    const docId = "sig_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
    const signal: VoiceSignalData = { ...req.body, id: docId, timestamp: Date.now() };
    store.signals.set(docId, signal);
    sendToUser(signal.receiverId, {
      type: "signal",
      collection: "signals",
      doc: signal,
    });
    res.json(signal);
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

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT} with Realtime Engine & WebSockets active`);
  });
}

startServer();
