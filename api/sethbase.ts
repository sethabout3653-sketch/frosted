// Vercel Serverless Function: /api/sethbase
// SethBase Realtime Engine - Zero WebSockets, Server-Sent Events (SSE) & Stream

let globalMemoryStore: Record<string, Record<string, any>> = {};
let changeHistory: Array<{
  timestamp: number;
  collection: string;
  id: string;
  op: string;
  data: any;
}> = [];

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { stream, action, since, collection } = req.query || {};

  // 1. SSE Stream on Vercel
  if (stream === "1" || action === "stream" || req.url?.includes("/stream")) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    res.write(`data: ${JSON.stringify({ type: "connected", quota: "unlimited", provider: "SethBase" })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "init", data: globalMemoryStore })}\n\n`);

    // Keep stream open on Vercel for the duration of the serverless function
    const interval = setInterval(() => {
      res.write(":ping\n\n");
    }, 5000);

    req.on("close", () => {
      clearInterval(interval);
      res.end();
    });

    return;
  }

  // 2. Poll changes
  if (action === "poll" || since !== undefined || req.url?.includes("/poll")) {
    const sinceTime = parseInt(since as string, 10) || 0;
    const newChanges = changeHistory.filter((c) => c.timestamp > sinceTime);
    return res.status(200).json({
      timestamp: Date.now(),
      changes: newChanges,
    });
  }

  // 3. Read collection / full data
  if (req.method === "GET") {
    if (collection) {
      return res.status(200).json(globalMemoryStore[collection as string] || {});
    }
    return res.status(200).json({
      status: "online",
      provider: "SethBase Realtime Engine",
      quota: "Unlimited (0 / \u221E)",
      transport: "SSE & HTTP Stream - No WebSockets",
      data: globalMemoryStore,
    });
  }

  // 4. Write data
  if (req.method === "POST") {
    try {
      const { op, collection: col, id, data } = req.body || {};
      if (!col || !id) {
        return res.status(400).json({ error: "Missing collection or id" });
      }

      if (!globalMemoryStore[col]) {
        globalMemoryStore[col] = {};
      }

      if (op === "delete") {
        delete globalMemoryStore[col][id];
      } else if (op === "update") {
        globalMemoryStore[col][id] = {
          ...(globalMemoryStore[col][id] || {}),
          ...data,
          id,
        };
      } else {
        globalMemoryStore[col][id] = { ...data, id };
      }

      const changeRecord = {
        timestamp: Date.now(),
        collection: col,
        id,
        op: op || "set",
        data,
      };

      changeHistory.push(changeRecord);
      if (changeHistory.length > 500) {
        changeHistory = changeHistory.slice(-500);
      }

      return res.status(200).json({
        success: true,
        timestamp: changeRecord.timestamp,
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
