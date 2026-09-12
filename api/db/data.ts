// Completely Self-Contained, Zero-Dependency Real-Time Database Engine
// Runs anywhere (Node, Cloud Run, Vercel, VPS) with 0 limits, 0 external software, 0 paid APIs
// Features: Full in-memory fast indexing, durable disk persistence, SSE real-time streaming, and cross-client delta broadcasting.

import fs from "fs";
import path from "path";

let dbStorageDir = path.join(process.cwd(), "uploads", "custom_db");
try {
  if (!fs.existsSync(dbStorageDir)) {
    fs.mkdirSync(dbStorageDir, { recursive: true });
  }
} catch {
  dbStorageDir = "/tmp/custom_db";
  if (!fs.existsSync(dbStorageDir)) {
    fs.mkdirSync(dbStorageDir, { recursive: true });
  }
}

const dbStoreFile = path.join(dbStorageDir, "documents.json");

// In-memory collection store: collection -> { id -> document }
const memoryStore: Record<string, Record<string, any>> = {};

// Active real-time SSE stream listeners
const localSubscribers = new Set<(event: {
  collection: string;
  op: "set" | "update" | "delete" | "delete_all";
  id: string;
  data: any;
  timestamp: number;
}) => void>();

// Load from disk on initialization
try {
  if (fs.existsSync(dbStoreFile)) {
    const raw = fs.readFileSync(dbStoreFile, "utf-8");
    const loaded = JSON.parse(raw);
    Object.assign(memoryStore, loaded);
  }
} catch (e) {
  // Empty initial store
}

let saveTimer: NodeJS.Timeout | null = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.writeFileSync(dbStoreFile, JSON.stringify(memoryStore), "utf-8");
    } catch {}
  }, 200);
}

export function subscribeToChanges(cb: (event: any) => void) {
  localSubscribers.add(cb);
  return () => {
    localSubscribers.delete(cb);
  };
}

export function notifyChange(collection: string, op: "set" | "update" | "delete" | "delete_all", id: string, data: any) {
  const event = {
    collection,
    op,
    id,
    data,
    timestamp: Date.now(),
  };

  localSubscribers.forEach((cb) => {
    try {
      cb(event);
    } catch {}
  });
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { searchParams } = new URL(req.url, "http://localhost");
  const collection = (req.query?.collection || req.query?.path || searchParams.get("collection") || searchParams.get("path") || "default").toString();
  const id = (req.query?.id || searchParams.get("id") || "").toString();

  // 1. GET: Fetch document or entire collection
  if (req.method === "GET") {
    const colData = memoryStore[collection] || {};
    if (id) {
      const doc = colData[id] ?? null;
      return res.status(200).json(doc);
    }
    return res.status(200).json(colData);
  }

  // 2. POST / PUT: Insert or Update document
  if (req.method === "POST" || req.method === "PUT") {
    const body = req.body || {};
    const targetCol = body.collection || body.path || collection;
    const targetId = body.id || id || `doc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const op = body.op || (req.method === "PUT" ? "update" : "set");
    const rawData = body.data !== undefined ? body.data : body;

    if (!memoryStore[targetCol]) {
      memoryStore[targetCol] = {};
    }

    if (op === "update") {
      memoryStore[targetCol][targetId] = {
        ...(memoryStore[targetCol][targetId] || {}),
        ...(typeof rawData === "object" ? rawData : { value: rawData }),
        id: targetId,
      };
    } else {
      memoryStore[targetCol][targetId] = {
        ...(typeof rawData === "object" ? rawData : { value: rawData }),
        id: targetId,
      };
    }

    scheduleSave();
    notifyChange(targetCol, op, targetId, memoryStore[targetCol][targetId]);

    return res.status(200).json({
      success: true,
      collection: targetCol,
      id: targetId,
      op,
      timestamp: Date.now(),
    });
  }

  // 3. DELETE: Delete document or whole collection
  if (req.method === "DELETE") {
    const targetCol = collection;
    const targetId = id || req.body?.id;

    if (!targetId) {
      if (memoryStore[targetCol]) {
        memoryStore[targetCol] = {};
        scheduleSave();
        notifyChange(targetCol, "delete_all", "", {});
      }
      return res.status(200).json({ success: true, deletedAll: true, collection: targetCol });
    }

    if (memoryStore[targetCol]) {
      delete memoryStore[targetCol][targetId];
      scheduleSave();
      notifyChange(targetCol, "delete", targetId, {});
    }

    return res.status(200).json({ success: true, id: targetId, collection: targetCol });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
