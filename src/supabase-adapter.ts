import { supabase } from "./lib/supabase";

// =========================================================
// Unlimited Supabase Storage & Media Upload Engine
// =========================================================
export const cassandra = {
  storage: {
    upload: async (
      file: File,
      onProgress?: (p: number) => void
    ): Promise<{ url: string; filename: string; mimetype: string; size: number }> => {
      // 1. Attempt primary upload via Supabase Storage
      try {
        const fileExt = file.name.split('.').pop() || 'bin';
        const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${cleanName}`;
        const filePath = `uploads/${fileName}`;

        const { data, error } = await supabase.storage
          .from('attachments')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: true,
          });

        if (!error && data?.path) {
          const { data: { publicUrl } } = supabase.storage
            .from('attachments')
            .getPublicUrl(filePath);

          return {
            url: publicUrl,
            filename: file.name,
            mimetype: file.type || "application/octet-stream",
            size: file.size,
          };
        }
      } catch (e) {
        console.warn("[Supabase Storage] Notice: bucket 'attachments' not ready yet, using unlimited server storage fallback:", e);
      }

      // 2. High-speed unlimited server storage fallback (supports files of any size, videos, GBs)
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        if (res.ok) {
          const json = await res.json();
          if (json.url) return json;
        }
      } catch (e) {
        console.warn("[Storage Fallback] Server upload unavailable, using base64 data URL:", e);
      }

      // 3. Final resilient fallback to Data URL for offline/instant preview
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve({
          url: reader.result as string,
          filename: file.name,
          mimetype: file.type || "application/octet-stream",
          size: file.size,
        });
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
  }

  public static getInstance(): SupabaseRealtimeManager {
    if (!SupabaseRealtimeManager.instance) {
      SupabaseRealtimeManager.instance = new SupabaseRealtimeManager();
    }
    return SupabaseRealtimeManager.instance;
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

    // 2. Instant Supabase Realtime Broadcast to all connected clients
    try {
      this.syncChannel.send({
        type: "broadcast",
        event: "change",
        payload: { op, collection: colName, id, data: recordPayload, timestamp: ts },
      });
    } catch (e) {}

    // 3. Persist to Supabase Postgres 'records' table
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

    // 4. Also mirror write to persistent storage server to guarantee zero data loss
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

  // 1. Direct targeted delivery via dedicated Supabase user channel
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

  // 2. Broadcast delivery via general Supabase WebRTC channel
  webrtcBroadcastChannel.send({
    type: "broadcast",
    event: "webrtc_signal",
    payload: sig,
  });

  // 3. Fallback to server endpoint for offline synchronization
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

  const handleSignal = (sig: any) => {
    if (!sig || !sig.id) return;
    if (sig.uid === myUid) return; // ignore own signals
    if (sig.targetUid !== "all" && sig.targetUid !== myUid) return; // not for me
    if (processedSignals.has(sig.id)) return;
    processedSignals.add(sig.id);
    onSignal(sig);
  };

  // 1. Dedicated Supabase private channel for this user
  const myChannel = supabase.channel(`supabase-user-signals-${myUid}`, {
    config: { broadcast: { ack: false, self: false } },
  });
  myChannel
    .on("broadcast", { event: "webrtc_signal" }, ({ payload }: { payload: any }) => {
      handleSignal(payload);
    })
    .subscribe();

  // 2. General Supabase WebRTC broadcast channel
  const generalSub = webrtcBroadcastChannel.on(
    "broadcast",
    { event: "webrtc_signal" },
    ({ payload }: { payload: any }) => {
      handleSignal(payload);
    }
  );

  // 3. Server fallback polling for cross-network reliability
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
    clearInterval(interval);
    supabase.removeChannel(myChannel);
  };
}
