// Custom Real-Time Database Engine - Server-Sent Events (SSE) Streaming Layer
// 100% Standalone, Zero external software/services, Zero limits.
// Keeps HTTP stream alive, pushes changes instantly to connected clients.

import { subscribeToChanges } from "./data";

export default async function handler(req: any, res: any) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed. Use GET for SSE streaming." });
  }

  const { searchParams } = new URL(req.url, "http://localhost");
  const targetCol = (req.query?.collection || req.query?.path || searchParams.get("collection") || searchParams.get("path") || "all").toString();

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
  });

  // Proxy padding
  res.write(":" + " ".repeat(2048) + "\n\n");
  res.write(`data: ${JSON.stringify({ type: "connected", collection: targetCol, time: Date.now() })}\n\n`);

  let isAlive = true;

  const unsubscribe = subscribeToChanges((event) => {
    if (!isAlive) return;
    if (targetCol === "all" || event.collection === targetCol) {
      try {
        res.write(`data: ${JSON.stringify({ type: "change", ...event })}\n\n`);
        (res as any).flush?.();
      } catch {
        isAlive = false;
      }
    }
  });

  const heartbeat = setInterval(() => {
    if (!isAlive) {
      clearInterval(heartbeat);
      return;
    }
    try {
      res.write(": ping\n\n");
    } catch {
      isAlive = false;
      clearInterval(heartbeat);
    }
  }, 10000);

  req.on("close", () => {
    isAlive = false;
    clearInterval(heartbeat);
    unsubscribe();
  });
}
