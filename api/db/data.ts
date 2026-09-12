// Vercel Serverless Function: /api/db/data
// Custom Unrestricted Real-Time Database Engine - Data API
// Accepts any arbitrary raw JSON document with zero restrictions or schema validation

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";

// In-memory fallback for environments without Upstash credentials configured
const memoryStore: Record<string, Record<string, any>> = {};
const memorySubscribers: Record<string, Set<(event: any) => void>> = {};

export function notifyLocalSubscribers(path: string, event: any) {
  if (memorySubscribers[path]) {
    memorySubscribers[path].forEach((cb) => {
      try {
        cb(event);
      } catch {}
    });
  }
}

export function addLocalSubscriber(path: string, cb: (event: any) => void) {
  if (!memorySubscribers[path]) memorySubscribers[path] = new Set();
  memorySubscribers[path].add(cb);
  return () => {
    memorySubscribers[path]?.delete(cb);
  };
}

export function getLocalSnapshot(path: string) {
  return memoryStore[path] || {};
}

async function redisRest(command: string, ...args: (string | number)[]) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    const url = `${REDIS_URL}/${command}/${args.map((a) => encodeURIComponent(String(a))).join("/")}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Redis HTTP error: ${res.statusText}`);
    const json = await res.json();
    return json.result;
  } catch (err) {
    console.warn("[RealtimeDB] Upstash request failed:", err);
    return null;
  }
}

export default async function handler(req: any, res: any) {
  // CORS configuration
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { searchParams } = new URL(req.url, "http://localhost");
  const path = (req.query?.path || searchParams.get("path") || "root").toString();
  const id = (req.query?.id || searchParams.get("id") || "").toString();

  // 1. GET: Read document or full collection
  if (req.method === "GET") {
    try {
      if (REDIS_URL && REDIS_TOKEN) {
        if (id) {
          const doc = await redisRest("HGET", `db:${path}`, id);
          return res.status(200).json({ success: true, id, data: doc ? JSON.parse(doc) : null });
        }
        const rawMap = await redisRest("HGETALL", `db:${path}`);
        const parsed: Record<string, any> = {};
        if (rawMap && typeof rawMap === "object") {
          for (const [k, v] of Object.entries(rawMap)) {
            try {
              parsed[k] = JSON.parse(v as string);
            } catch {
              parsed[k] = v;
            }
          }
        }
        return res.status(200).json({ success: true, path, data: parsed });
      }

      // In-memory fallback
      if (id) {
        return res.status(200).json({ success: true, id, data: memoryStore[path]?.[id] || null });
      }
      return res.status(200).json({ success: true, path, data: memoryStore[path] || {} });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  }

  // 2. POST / PUT: Upsert raw JSON document
  if (req.method === "POST" || req.method === "PUT") {
    try {
      const body = req.body || {};
      const targetPath = body.path || path || "root";
      const docId = body.id || id || `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const data = body.data !== undefined ? body.data : body;

      const serialized = JSON.stringify(data);
      const timestamp = Date.now();

      // Persist to Upstash Redis if configured
      if (REDIS_URL && REDIS_TOKEN) {
        await redisRest("HSET", `db:${targetPath}`, docId, serialized);
        await redisRest(
          "XADD",
          `stream:${targetPath}`,
          "MAXLEN",
          "~",
          2000,
          "*",
          "op",
          "upsert",
          "path",
          targetPath,
          "id",
          docId,
          "data",
          serialized,
          "timestamp",
          timestamp
        );
      }

      // Update in-memory store
      if (!memoryStore[targetPath]) memoryStore[targetPath] = {};
      memoryStore[targetPath][docId] = data;

      // Broadcast delta to local SSE listeners
      notifyLocalSubscribers(targetPath, {
        op: "upsert",
        path: targetPath,
        id: docId,
        data,
        timestamp,
      });

      return res.status(200).json({
        success: true,
        op: "upsert",
        path: targetPath,
        id: docId,
        data,
        timestamp,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  }

  // 3. DELETE: Remove document
  if (req.method === "DELETE") {
    try {
      if (!id) {
        return res.status(400).json({ success: false, error: "Missing required 'id' parameter" });
      }

      const timestamp = Date.now();

      if (REDIS_URL && REDIS_TOKEN) {
        await redisRest("HDEL", `db:${path}`, id);
        await redisRest(
          "XADD",
          `stream:${path}`,
          "MAXLEN",
          "~",
          2000,
          "*",
          "op",
          "delete",
          "path",
          path,
          "id",
          id,
          "timestamp",
          timestamp
        );
      }

      if (memoryStore[path]) {
        delete memoryStore[path][id];
      }

      notifyLocalSubscribers(path, {
        op: "delete",
        path,
        id,
        timestamp,
      });

      return res.status(200).json({ success: true, op: "delete", path, id, timestamp });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
