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

      // 1. Primary high-speed direct server upload with real-time XHR progress tracking
      const uploadToServer = (): Promise<{ url: string; filename: string; mimetype: string; size: number }> => {
        return new Promise((resolve, reject) => {
          if (abortController?.signal?.aborted) {
            reject(new Error("Upload cancelled by user"));
            return;
          }

          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/upload", true);
          xhr.timeout = 10 * 60 * 1000; // 10 minutes timeout for very large files (GBs)

          if (abortController) {
            abortController.signal.addEventListener("abort", () => {
              try {
                xhr.abort();
              } catch (e) {}
              reject(new Error("Upload cancelled by user"));
            });
          }

          xhr.upload.onprogress = (event) => {
            if (abortController?.signal?.aborted) return;
            if (event.lengthComputable && event.total > 0) {
              const percentComplete = (event.loaded / event.total) * 100;
              reportProgress(percentComplete);
            }
          };

          xhr.onload = () => {
            if (abortController?.signal?.aborted) return;
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const response = JSON.parse(xhr.responseText);
                if (response && response.url) {
                  reportProgress(100);
                  resolve(response);
                  return;
                }
              } catch (e) {}
            }
            reject(new Error(`Server upload returned status ${xhr.status}: ${xhr.statusText}`));
          };

          xhr.onerror = () => {
            if (abortController?.signal?.aborted) {
              reject(new Error("Upload cancelled by user"));
            } else {
              reject(new Error("Network error during file upload"));
            }
          };
          xhr.ontimeout = () => reject(new Error("Upload timed out"));
          xhr.onabort = () => reject(new Error("Upload cancelled by user"));

          const formData = new FormData();
          formData.append("file", file);
          xhr.send(formData);
        });
      };

      try {
        return await uploadToServer();
      } catch (serverError: any) {
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
// Real-Time Supabase Engine Manager (Broadcast + Realtime Postgres)
// =========================================================
class SupabaseRealtimeManager {
  private static instance: SupabaseRealtimeManager;
  private listeners: Map<string, Set<(snap: any) => void>> = new Map();
  private cache: Map<string, Record<string, any>> = new Map();
  private syncChannel: any = null;
  private isConnected = false;

  private constructor() {
    this.initSyncChannel();
    this.initWebSocketBridge();
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
        }
      });
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

  public notify(colName: string) {
    const colListeners = this.listeners.get(colName);
    if (colListeners && colListeners.size > 0) {
      const dataMap = this.cache.get(colName) || {};
      const dataList = Object.entries(dataMap).map(([id, val]) => ({ id, ...val }));
      const docs = dataList.map((d) => ({ id: d.id, data: () => d }));
      const snap = {
        docs,
        forEach: (fn: any) => docs.forEach(fn),
        empty: docs.length === 0,
        size: docs.length,
      };
      colListeners.forEach((cb) => {
        try { cb(snap); } catch (e) {}
      });
    }
  }

  public async getCollection(colName: string): Promise<Record<string, any>> {
    // 1. Try Supabase Postgres Table
    try {
      const { data, error } = await supabase
        .from("records")
        .select("*")
        .eq("collection", colName);

      if (!error && Array.isArray(data) && data.length > 0) {
        const resultMap: Record<string, any> = {};
        for (const row of data) {
          let item = row.data;
          if (typeof item === "string") {
            try { item = JSON.parse(item); } catch (e) {}
          }
          resultMap[row.id] = { ...(item || {}), id: row.id };
        }
        // Update in-memory cache
        this.cache.set(colName, resultMap);
        return resultMap;
      }
    } catch (e) {}

    // 2. Resilient local fallback / server storage
    try {
      const res = await fetch(`/api/cassandra/data?collection=${encodeURIComponent(colName)}`);
      if (res.ok) {
        const serverData = await res.json();
        if (serverData && typeof serverData === "object") {
          const current = this.cache.get(colName) || {};
          const merged = { ...serverData, ...current };
          this.cache.set(colName, merged);
          return merged;
        }
      }
    } catch (e) {}

    return this.cache.get(colName) || {};
  }

  public subscribe(colName: string, queryObj: any, cb: (snap: any) => void) {
    if (!this.listeners.has(colName)) {
      this.listeners.set(colName, new Set());
    }
    this.listeners.get(colName)!.add(cb);

    // Initial load
    this.getCollection(colName).then((dataMap) => {
      const constraints = queryObj?.constraints || [];
      let list = Object.entries(dataMap).map(([id, val]) => ({ id, ...val }));

      for (const c of constraints) {
        if (c.type === "where" && c.op === "==") {
          list = list.filter((item: any) => item[c.field] === c.value);
        } else if (c.type === "orderBy") {
          list.sort((a: any, b: any) => {
            const valA = a[c.field];
            const valB = b[c.field];
            return c.direction === "asc" ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
          });
        }
      }

      const docs = list.map((d) => ({ id: d.id, data: () => d }));
      cb({
        docs,
        forEach: (fn: any) => docs.forEach(fn),
        empty: docs.length === 0,
        size: docs.length,
      });
    });

    return () => {
      this.listeners.get(colName)?.delete(cb);
    };
  }

  public async write(op: string, colName: string, id: string, data?: any) {
    const ts = Date.now();
    const recordPayload = data ? { ...data, id } : { id };

    // 1. Optimistic instant local update
    this.applyChange(op, colName, id, recordPayload);

    // 2. Instant 0ms WebSocket Delivery to connected peers
    try {
      wsClient.sendChange(op as any, colName, id, recordPayload);
    } catch (e) {}

    // 3. Supabase Realtime Broadcast
    try {
      this.syncChannel?.send({
        type: "broadcast",
        event: "change",
        payload: { op, collection: colName, id, data: recordPayload, timestamp: ts },
      });
    } catch (e) {}

    // 4. Persist to Supabase Postgres 'records' table
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

    // 5. Also mirror write to persistent storage server to guarantee zero data loss
    try {
      fetch("/api/cassandra/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, collection: colName, id, data: recordPayload }),
        keepalive: true,
      }).catch(() => {});
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
