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

  // API Proxy Route: Resolve game details & direct URL
  app.get("/api/lumin-game-url/:id", async (req, res) => {
    try {
      const sessionHeader = req.headers["x-session"] as string || "";
      const response = await fetch(`https://a.luminsdk.com/api/v1/games/${req.params.id}`, {
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

  // API Proxy Route: Stream and Cache game icons/covers
  app.get("/api/lumin-icon/:token", async (req, res) => {
    try {
      const response = await fetch(`https://a.luminsdk.com/api/v1/icon/${req.params.token}`);
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

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", mode: process.env.NODE_ENV });
  });

  // Vite integration and static asset serving
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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
