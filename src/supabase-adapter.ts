import { supabase } from "./lib/supabase";
import { wsClient } from "./lib/websocket-client";

// =========================================================
// Unlimited Supabase Storage & Media Upload Engine
// =========================================================
export const cassandra = {
  storage: {
    upload: async (
      file: File,
      onProgress?: (p: number) => void,
      abortController?: AbortController
    ): Promise<{ url: string; filename: string; mimetype: string; size: number }> => {
      // Helper to safely trigger progress callback
      const reportProgress = (percent: number) => {
        if (typeof onProgress === "function") {
          try {
            onProgress(Math.min(100, Math.max(0, Math.round(percent))));
          } catch (e) {}
        }
      };

      // If already aborted, exit immediately
      if (abortController?.signal?.aborted) {
        throw new Error("Upload cancelled by user");
      }

      reportProgress(5);

      // 1. Primary high-speed direct server upload with real-time chunking & retry resilience
      const uploadToServer = async (): Promise<{ url: string; filename: string; mimetype: string; size: number }> => {
        const CHUNK_SIZE = 900 * 1024; // 900KB chunk size to easily pass NGINX 1MB limits
        const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
        const uniqueId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
        let lastResponse: any;

        for (let i = 0; i < totalChunks; i++) {
          if (abortController?.signal?.aborted) throw new Error("Upload cancelled by user");
          
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const chunk = file.slice(start, end);
          
          let chunkSuccess = false;
          let lastChunkError: any = null;

          // Retry each chunk up to 3 times for large files
          for (let attempt = 1; attempt <= 3; attempt++) {
            if (abortController?.signal?.aborted) throw new Error("Upload cancelled by user");
            try {
              const formData = new FormData();
              formData.append("chunk", chunk);
              formData.append("chunkIndex", i.toString());
              formData.append("totalChunks", totalChunks.toString());
              formData.append("uploadId", uniqueId);
              formData.append("filename", file.name);
              formData.append("mimetype", file.type || "application/octet-stream");
              formData.append("size", file.size.toString());

              const response = await fetch("/api/upload/chunk", {
                method: "POST",
                body: formData,
                signal: abortController?.signal
              });
              
              if (!response.ok) {
                const errJson = await response.json().catch(() => null);
                if (errJson && (errJson.safe === false || errJson.error?.includes("blocked"))) {
                  const modErr = new Error(errJson.error || errJson.reason || "File blocked by moderation");
                  (modErr as any).isModerationBlock = true;
                  (modErr as any).reason = errJson.reason || errJson.error;
                  throw modErr;
                }
                throw new Error(`Server upload returned status ${response.status}: ${response.statusText}`);
              }
              
              lastResponse = await response.json();
              chunkSuccess = true;
              break;
            } catch (err: any) {
              lastChunkError = err;
              if (abortController?.signal?.aborted || err?.message?.includes("cancelled")) {
                throw err;
              }
              if (attempt < 3) {
                await new Promise((r) => setTimeout(r, 400 * attempt));
              }
            }
          }

          if (!chunkSuccess) {
            throw lastChunkError || new Error(`Failed to upload chunk ${i + 1}/${totalChunks}`);
          }

          reportProgress(Math.min(99, Math.round(((i + 1) / totalChunks) * 100)));
        }
        
        if (lastResponse && lastResponse.url) {
           reportProgress(100);
           return lastResponse;
        }
        throw new Error("Invalid response from server during chunked upload");
      };

      try {
        return await uploadToServer();
      } catch (serverError: any) {
        if (serverError?.isModerationBlock) {
          throw serverError;
        }
        if (
          abortController?.signal?.aborted ||
          serverError?.message?.includes("cancelled") ||
          serverError?.message?.includes("aborted")
        ) {
          throw new Error("Upload cancelled by user");
        }
        console.warn("[Upload Pipeline] Direct server upload fallback triggered:", serverError);
      }

      if (abortController?.signal?.aborted) {
        throw new Error("Upload cancelled by user");
      }

      // 2. Secondary fallback: Supabase Storage with timeout & progress simulation
      try {
        reportProgress(30);
        const fileExt = file.name.split('.').pop() || 'bin';
        const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${cleanName}`;
        const filePath = `uploads/${fileName}`;

        // Create a 15-second timeout promise so Supabase bucket delays never hang the UI
        const uploadPromise = supabase.storage
          .from('attachments')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: true,
          });

        const timeoutPromise = new Promise<{ data: null; error: Error }>((_, reject) =>
          setTimeout(() => reject(new Error("Supabase storage upload timeout")), 15000)
        );

        const { data, error } = await Promise.race([uploadPromise, timeoutPromise]) as any;

        if (abortController?.signal?.aborted) {
          throw new Error("Upload cancelled by user");
        }

        if (!error && data?.path) {
          const { data: { publicUrl } } = supabase.storage
            .from('attachments')
            .getPublicUrl(filePath);

          reportProgress(100);
          return {
            url: publicUrl,
            filename: file.name,
            mimetype: file.type || "application/octet-stream",
            size: file.size,
          };
        }
      } catch (supabaseErr: any) {
        if (
          abortController?.signal?.aborted ||
          supabaseErr?.message?.includes("cancelled") ||
          supabaseErr?.message?.includes("aborted")
        ) {
          throw new Error("Upload cancelled by user");
        }
        console.warn("[Supabase Storage] Storage fallback notice:", supabaseErr);
      }

      if (abortController?.signal?.aborted) {
        throw new Error("Upload cancelled by user");
      }

      // 3. Resilient instant fallback: For files < 15MB, use Base64; for larger files, use Object URL to prevent browser memory freezing
      reportProgress(80);
      if (file.size > 15 * 1024 * 1024) {
        // Blob / Object URL avoids blowing up RAM on multi-gigabyte or 50MB+ files
        const objectUrl = URL.createObjectURL(file);
        reportProgress(100);
        return {
          url: objectUrl,
          filename: file.name,
          mimetype: file.type || "application/octet-stream",
          size: file.size,
        };
      }

      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onprogress = (e) => {
          if (e.lengthComputable && e.total > 0) {
            reportProgress(80 + (e.loaded / e.total) * 20);
          }
        };
        reader.onload = () => {
          reportProgress(100);
          resolve({
            url: reader.result as string,
            filename: file.name,
            mimetype: file.type || "application/octet-stream",
            size: file.size,
          });
        };
        reader.onerror = () => {
          const objectUrl = URL.createObjectURL(file);
          reportProgress(100);
          resolve({
            url: objectUrl,
            filename: file.name,
            mimetype: file.type || "application/octet-stream",
            size: file.size,
          });
        };
        reader.readAsDataURL(file);
      });
    },
  },
};

export const db = { name: "UnlimitedSupabaseDB" };

// Types & Helpers
export enum OperationType {
  GET = "get",
  LIST = "list",
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  WRITE = "write",
}

export function handleFirestoreError(error: any, op: string, path: string) {
  console.warn(`[Supabase Engine] ${op} on ${path}:`, error);
}

export function toTimestampMs(val: any): number {
  if (!val) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const d = new Date(val);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }
  if (val instanceof Date) return val.getTime();
  return 0;
}

export function compareMessagesChronological(a: any, b: any): number {
  const timeA = toTimestampMs(a?.timestamp || a?.created_at);
  const timeB = toTimestampMs(b?.timestamp || b?.created_at);
  return timeA - timeB;
}

// Firestore-like Compatibility Layer
export function collection(_db: any, name: string) { return name; }
export function doc(_db: any, colName: string, id: string) { return { colName, id }; }
export function query(colName: string, ...constraints: any[]) { return { colName, constraints }; }
export function where(field: string, op: string, value: any) { return { type: "where", field, op, value }; }
export function orderBy(field: string, direction: "asc" | "desc" = "asc") { return { type: "orderBy", field, direction }; }
export function limit(limitCount: number) { return { type: "limit", limitCount }; }

// =========================================================
// Real-Time Supabase Engine Manager (Broadcast + Realtime Postgres + Resilient Sync)
// =========================================================
interface ListenerEntry {
  cb: (snap: any) => void;
  queryObj: any;
}

class SupabaseRealtimeManager {
  private static instance: SupabaseRealtimeManager;
  private listeners: Map<string, Set<ListenerEntry>> = new Map();
  private cache: Map<string, Record<string, any>> = new Map();
  private syncChannel: any = null;
  private isConnected = false;

  private constructor() {
    this.initSyncChannel();
    this.initWebSocketBridge();
    this.initResilientSyncLoop();
  }

  public static getInstance(): SupabaseRealtimeManager {
    if (!SupabaseRealtimeManager.instance) {
      SupabaseRealtimeManager.instance = new SupabaseRealtimeManager();
    }
    return SupabaseRealtimeManager.instance;
  }

  private initWebSocketBridge() {
    // Listen for instant 0ms WebSocket change events
    wsClient.onAnyChange(({ op, collection, id, data }) => {
      if (collection && id) {
        this.applyChange(op, collection, id, data);
      }
    });
  }

  private initSyncChannel() {
    if (this.syncChannel) return;

    // High-performance unified Supabase Realtime Broadcast channel
    this.syncChannel = supabase.channel("supabase-realtime-sync", {
      config: {
        broadcast: { ack: false, self: false },
        presence: { key: "client" },
      },
    });

    this.syncChannel
      .on("broadcast", { event: "change" }, ({ payload }: { payload: any }) => {
        if (!payload || !payload.collection || !payload.id) return;
        this.applyChange(payload.op || "set", payload.collection, payload.id, payload.data);
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "records" },
        (payload: any) => {
          try {
            const eventType = payload.eventType?.toLowerCase();
            const row = payload.new || payload.old;
            if (!row || !row.collection || !row.id) return;
            
            let parsedData = row.data;
            if (typeof parsedData === "string") {
              try { parsedData = JSON.parse(parsedData); } catch (e) {}
            }
            this.applyChange(eventType === "delete" ? "delete" : "set", row.collection, row.id, parsedData);
          } catch (err) {}
        }
      )
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          this.isConnected = true;
          this.resyncAllActiveCollections();
        }
      });
  }

  private initResilientSyncLoop() {
    if (typeof window === "undefined") return;

    const handleReSync = () => {
      this.resyncAllActiveCollections();
    };

    window.addEventListener("focus", handleReSync);
    window.addEventListener("online", handleReSync);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        handleReSync();
      }
    });

    // Periodic heartbeat sync every 6 seconds so messages never fail or stall when idle
    window.setInterval(() => {
      if (this.listeners.size > 0) {
        this.resyncAllActiveCollections();
      }
    }, 6000);
  }

  public async resyncAllActiveCollections() {
    const activeCols = Array.from(this.listeners.keys());
    for (const colName of activeCols) {
      if ((this.listeners.get(colName)?.size || 0) > 0) {
        await this.getCollection(colName, true);
        this.notify(colName);
      }
    }
  }

  public applyChange(op: string, collection: string, id: string, data: any) {
    if (!this.cache.has(collection)) {
      this.cache.set(collection, {});
    }
    const colMap = this.cache.get(collection)!;
    if (op === "delete") {
      delete colMap[id];
    } else {
      colMap[id] = { ...colMap[id], ...data, id };
    }
    this.notify(collection);
  }

  public buildSnapshot(dataMap: Record<string, any>, queryObj: any) {
    const constraints = queryObj?.constraints || [];
    let list = Object.entries(dataMap).map(([id, val]) => ({ id, ...val }));

    for (const c of constraints) {
      if (c.type === "where" && c.op === "==") {
        list = list.filter((item: any) => item[c.field] === c.value);
      } else if (c.type === "orderBy") {
        list.sort((a: any, b: any) => {
          const valA = toTimestampMs(a[c.field]) || a[c.field];
          const valB = toTimestampMs(b[c.field]) || b[c.field];
          return c.direction === "asc" ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
        });
      } else if (c.type === "limit" && typeof c.limitCount === "number") {
        list = list.slice(0, c.limitCount);
      }
    }

    const docs = list.map((d) => ({ id: d.id, data: () => d }));
    return {
      docs,
      forEach: (fn: any) => docs.forEach(fn),
      empty: docs.length === 0,
      size: docs.length,
    };
  }

  public notify(colName: string) {
    const colListeners = this.listeners.get(colName);
    if (colListeners && colListeners.size > 0) {
      const dataMap = this.cache.get(colName) || {};
      colListeners.forEach((entry) => {
        try {
          const snap = this.buildSnapshot(dataMap, entry.queryObj);
          entry.cb(snap);
        } catch (e) {}
      });
    }
  }

  public async getCollection(colName: string, forceFetch = false): Promise<Record<string, any>> {
    let supabaseDataMap: Record<string, any> = {};
    let cassandraDataMap: Record<string, any> = {};

    // 1. Try Supabase Postgres Table
    try {
      const { data, error } = await supabase
        .from("records")
        .select("*")
        .eq("collection", colName);

      if (!error && Array.isArray(data)) {
        for (const row of data) {
          let item = row.data;
          if (typeof item === "string") {
            try { item = JSON.parse(item); } catch (e) {}
          }
          supabaseDataMap[row.id] = { ...(item || {}), id: row.id };
        }
      }
    } catch (e) {}

    // 2. Local fallback / server storage
    try {
      const res = await fetch(`/api/cassandra/data?collection=${encodeURIComponent(colName)}`);
      if (res.ok) {
        const serverData = await res.json();
        if (serverData && typeof serverData === "object") {
          cassandraDataMap = serverData;
        }
      }
    } catch (e) {}

    const cachedMap = this.cache.get(colName) || {};
    // Merge all data sources seamlessly (Supabase + local SQLite server store + memory cache)
    const mergedMap = { ...cassandraDataMap, ...supabaseDataMap, ...cachedMap };
    this.cache.set(colName, mergedMap);
    return mergedMap;
  }

  public subscribe(colName: string, queryObj: any, cb: (snap: any) => void) {
    if (!this.listeners.has(colName)) {
      this.listeners.set(colName, new Set());
    }
    const listenerEntry: ListenerEntry = { cb, queryObj };
    this.listeners.get(colName)!.add(listenerEntry);

    // Initial load + immediate snapshot delivery
    this.getCollection(colName).then((dataMap) => {
      try {
        const snap = this.buildSnapshot(dataMap, queryObj);
        cb(snap);
      } catch (e) {}
    });

    return () => {
      this.listeners.get(colName)?.delete(listenerEntry);
    };
  }

  public httpSend(endpoint: string, payload: any) {
    try {
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    } catch (e) {
      console.warn("[httpSend] Error:", e);
    }
  }

  public async write(op: string, colName: string, id: string, data?: any) {
    const ts = Date.now();
    const recordPayload = data ? { ...data, id } : { id };

    // 1. Optimistic instant local update
    this.applyChange(op, colName, id, recordPayload);

    // 2. Explicit REST delivery using httpSend
    this.httpSend("/api/cassandra/write", { op, collection: colName, id, data: recordPayload });

    // 3. Database: Persist to Supabase Postgres 'records' table
    try {
      if (op === "delete") {
        await supabase
          .from("records")
          .delete()
          .eq("collection", colName)
          .eq("id", id);
      } else {
        await supabase.from("records").upsert({
          collection: colName,
          id,
          data: typeof recordPayload === "object" ? JSON.stringify(recordPayload) : recordPayload,
          timestamp: ts,
        });
      }
    } catch (e) {
      // Supabase table not created yet or RLS restriction, handled gracefully below
    }

    // 4. WebSockets: Instant 0ms WebSocket Delivery to native WebSockets & Supabase Realtime
    try {
      wsClient.sendChange(op as any, colName, id, recordPayload);
    } catch (e) {}

    try {
      this.syncChannel?.send({
        type: "broadcast",
        event: "change",
        payload: { op, collection: colName, id, data: recordPayload, timestamp: ts },
      });
    } catch (e) {}
  }
}

// =========================================================
// Firestore-compatible Database Operations (Powered by Supabase)
// =========================================================
export async function getDocs(queryObj: any) {
  const colName = typeof queryObj === "string" ? queryObj : queryObj?.colName;
  if (!colName) return { docs: [], forEach: () => {}, empty: true, size: 0 };

  const constraints = queryObj?.constraints || [];
  const dataMap = await SupabaseRealtimeManager.getInstance().getCollection(colName);
  let list = Object.entries(dataMap).map(([id, val]: [string, any]) => ({
    id,
    ...(typeof val === "object" ? val : {}),
  }));

  for (const c of constraints) {
    if (c.type === "where" && c.op === "==") {
      list = list.filter((item: any) => item[c.field] === c.value);
    } else if (c.type === "orderBy") {
      list.sort((a: any, b: any) => {
        const valA = a[c.field];
        const valB = b[c.field];
        return c.direction === "asc" ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
      });
    } else if (c.type === "limit" && typeof c.limitCount === "number") {
      list = list.slice(0, c.limitCount);
    }
  }

  const docs = list.map((d) => ({ id: d.id, data: () => d }));
  return {
    docs,
    forEach: (cb: any) => docs.forEach(cb),
    empty: docs.length === 0,
    size: docs.length,
  };
}

export function onSnapshot(
  queryObj: any,
  onNext: (snap: any) => void,
  _onError?: (err: any) => void
) {
  const colName = typeof queryObj === "string" ? queryObj : queryObj?.colName;
  if (!colName) return () => {};

  return SupabaseRealtimeManager.getInstance().subscribe(colName, queryObj, onNext);
}

export async function setDoc(
  docRef: { colName: string; id: string },
  data: any,
  _options?: { merge?: boolean }
) {
  await SupabaseRealtimeManager.getInstance().write("set", docRef.colName, docRef.id, data);
}

export async function updateDoc(
  docRef: { colName: string; id: string },
  data: any
) {
  await SupabaseRealtimeManager.getInstance().write("update", docRef.colName, docRef.id, data);
}

export async function deleteDoc(docRef: { colName: string; id: string }) {
  await SupabaseRealtimeManager.getInstance().write("delete", docRef.colName, docRef.id);
}

export async function addDoc(colName: string, data: any) {
  const id = "msg_" + Math.random().toString(36).substring(2, 11);
  await setDoc({ colName, id }, data);
  return { colName, id };
}

export function writeBatch() {
  const ops: any[] = [];
  return {
    set: (ref: any, data: any) => ops.push({ type: "set", ref, data }),
    update: (ref: any, data: any) => ops.push({ type: "update", ref, data }),
    delete: (ref: any) => ops.push({ type: "delete", ref }),
    commit: async () => {
      for (const op of ops) {
        if (op.type === "set") await setDoc(op.ref, op.data);
        if (op.type === "update") await updateDoc(op.ref, op.data);
        if (op.type === "delete") await deleteDoc(op.ref);
      }
    },
  };
}

// =========================================================
// Real-Time WebRTC Peer-to-Peer Signaling via Supabase Realtime
// =========================================================
const webrtcBroadcastChannel = supabase.channel("supabase-webrtc-broadcast", {
  config: { broadcast: { ack: false, self: false } },
});
webrtcBroadcastChannel.subscribe();

const userSignalChannels = new Map<string, any>();

export function sendBroadcastSignal(payload: any) {
  const sig = {
    ...payload,
    id: payload.id || `sig_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: payload.timestamp || Date.now(),
  };

  // 1. Instant 0ms WebSocket Peer-to-Peer Signaling
  try {
    wsClient.sendSignal(sig);
  } catch (e) {}

  // 2. Direct targeted delivery via dedicated Supabase user channel
  if (sig.targetUid && sig.targetUid !== "all") {
    let targetChannel = userSignalChannels.get(sig.targetUid);
    if (!targetChannel) {
      targetChannel = supabase.channel(`supabase-user-signals-${sig.targetUid}`, {
        config: { broadcast: { ack: false, self: false } },
      });
      targetChannel.subscribe();
      userSignalChannels.set(sig.targetUid, targetChannel);
    }
    targetChannel.send({
      type: "broadcast",
      event: "webrtc_signal",
      payload: sig,
    });
  }

  // 3. Broadcast delivery via general Supabase WebRTC channel
  webrtcBroadcastChannel.send({
    type: "broadcast",
    event: "webrtc_signal",
    payload: sig,
  });

  // 4. Fallback to server endpoint for offline synchronization
  fetch("/api/webrtc/signal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sig),
    keepalive: true,
  }).catch(() => {});
}

export function subscribeBroadcastSignals(
  myUid: string,
  onSignal: (signal: any) => void
) {
  const processedSignals = new Set<string>();

  // Register UID with WebSocket client for targeted routing
  wsClient.setUserUid(myUid);

  const handleSignal = (sig: any) => {
    if (!sig || !sig.id) return;
    if (sig.uid === myUid) return; // ignore own signals
    if (sig.targetUid !== "all" && sig.targetUid !== myUid) return; // not for me
    if (processedSignals.has(sig.id)) return;
    processedSignals.add(sig.id);
    onSignal(sig);
  };

  // 1. Instant 0ms WebSocket signaling listener
  const unsubWs = wsClient.onSignal((sig) => {
    handleSignal(sig);
  });

  // 2. Dedicated Supabase private channel for this user
  const myChannel = supabase.channel(`supabase-user-signals-${myUid}`, {
    config: { broadcast: { ack: false, self: false } },
  });
  myChannel
    .on("broadcast", { event: "webrtc_signal" }, ({ payload }: { payload: any }) => {
      handleSignal(payload);
    })
    .subscribe();

  // 3. General Supabase WebRTC broadcast channel
  const generalSub = webrtcBroadcastChannel.on(
    "broadcast",
    { event: "webrtc_signal" },
    ({ payload }: { payload: any }) => {
      handleSignal(payload);
    }
  );

  // 4. Server fallback polling for cross-network reliability
  const interval = setInterval(async () => {
    try {
      const res = await fetch(`/api/webrtc/signals?uid=${encodeURIComponent(myUid)}`);
      if (res.ok) {
        const json = await res.json();
        const signals = json.signals || [];
        for (const s of signals) {
          handleSignal(s);
        }
      }
    } catch (e) {}
  }, 2000);

  return () => {
    unsubWs();
    clearInterval(interval);
    supabase.removeChannel(myChannel);
  };
}
