// Storage Helper mapping to our local server storage
export const cassandra = {
  storage: {
    upload: async (
      file: File,
      onProgress?: (p: number) => void
    ): Promise<{ url: string; filename: string; mimetype: string; size: number }> => {
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        const json = await res.json();
        if (json.url) return json;
      } catch (e) {
        console.error("Local upload failed", e);
      }

      // Final fallback to Data URL if completely offline
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve({
          url: reader.result as string,
          filename: file.name,
          mimetype: file.type,
          size: file.size,
        });
        reader.readAsDataURL(file);
      });
    },
  },
};

// Remove all Supabase dependencies and rely strictly on our custom local SSE real-time engine.
export const db = { name: "CustomServerlessDB" };

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
  console.warn(`[LocalDB] Error during ${op} on ${path}:`, error);
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

// ==========================================
// Centralized SSE Connection Manager
// ==========================================
class CassandraClient {
  private static instance: CassandraClient;
  private sse: EventSource | null = null;
  private listeners: Map<string, Set<(data: Record<string, any>) => void>> = new Map();
  private cache: Map<string, Record<string, any>> = new Map();

  private constructor() {
    this.connect();
  }

  public static getInstance(): CassandraClient {
    if (!CassandraClient.instance) {
      CassandraClient.instance = new CassandraClient();
    }
    return CassandraClient.instance;
  }

  private connect() {
    if (this.sse) return;
    this.sse = new EventSource("/api/cassandra/stream");
    
    this.sse.addEventListener("message", (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "initial") {
          // Full state sync
          this.cache.clear();
          for (const [col, docs] of Object.entries(msg.data || {})) {
            this.cache.set(col, docs as Record<string, any>);
            this.notify(col);
          }
        } else if (msg.type === "change") {
          // Delta update
          const { op, collection, id, data } = msg;
          if (!this.cache.has(collection)) {
            this.cache.set(collection, {});
          }
          const colData = this.cache.get(collection)!;
          if (op === "delete") {
            delete colData[id];
          } else {
            colData[id] = { ...colData[id], ...data };
          }
          this.notify(collection);
        }
      } catch (err) {}
    });

    this.sse.onerror = () => {
      this.sse?.close();
      this.sse = null;
      setTimeout(() => this.connect(), 2000);
    };
  }

  private notify(colName: string) {
    const colListeners = this.listeners.get(colName);
    if (colListeners) {
      const data = this.cache.get(colName) || {};
      colListeners.forEach(cb => cb(data));
    }
  }

  public async getCollection(colName: string) {
    // Attempt local cache first to avoid redundant fetches
    if (this.cache.has(colName) && Object.keys(this.cache.get(colName)!).length > 0) {
      return this.cache.get(colName);
    }
    // Fetch directly if not in cache
    try {
      const res = await fetch(`/api/cassandra/data?collection=${encodeURIComponent(colName)}`);
      if (res.ok) {
        const json = await res.json();
        this.cache.set(colName, json);
        return json;
      }
    } catch (e) {}
    return {};
  }

  public subscribe(colName: string, cb: (data: Record<string, any>) => void) {
    if (!this.listeners.has(colName)) {
      this.listeners.set(colName, new Set());
    }
    this.listeners.get(colName)!.add(cb);
    
    // Immediately fire with current cache
    this.getCollection(colName).then(data => cb(data || {}));

    return () => {
      this.listeners.get(colName)?.delete(cb);
    };
  }

  public async write(op: string, colName: string, id: string, data?: any) {
    await fetch("/api/cassandra/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op, collection: colName, id, data })
    });
  }
}

// Database Operations mapping directly to CassandraClient
export async function getDocs(queryObj: any) {
  const colName = typeof queryObj === "string" ? queryObj : queryObj.colName;
  const constraints = queryObj?.constraints || [];
  
  if (!colName) {
    return { docs: [], forEach: () => {}, empty: true, size: 0 };
  }

  try {
    const dataMap = await CassandraClient.getInstance().getCollection(colName);
    const dataList = Object.entries(dataMap || {}).map(([id, val]: [string, any]) => ({
      id,
      ...val
    }));
    
    let filtered = dataList;
    for (const c of constraints) {
      if (c.type === "where") {
        if (c.op === "==") filtered = filtered.filter(d => d[c.field] === c.value);
      } else if (c.type === "orderBy") {
        filtered.sort((a, b) => {
          const valA = a[c.field];
          const valB = b[c.field];
          return c.direction === "asc" ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
        });
      }
    }

    return {
      docs: filtered.map(d => ({ id: d.id, data: () => d })),
      forEach: (cb: any) => filtered.forEach(d => cb({ id: d.id, data: () => d })),
      empty: filtered.length === 0,
      size: filtered.length
    };
  } catch (e) {
    return { docs: [], forEach: () => {}, empty: true, size: 0 };
  }
}

export function onSnapshot(
  queryObj: any,
  onNext: (snap: any) => void,
  _onError?: (err: any) => void
) {
  const colName = typeof queryObj === "string" ? queryObj : queryObj.colName;
  
  if (!colName) {
    return () => {};
  }

  const client = CassandraClient.getInstance();

  return client.subscribe(colName, (dataMap) => {
    const dataList = Object.entries(dataMap || {}).map(([id, val]: [string, any]) => ({
      id,
      ...val
    }));
    
    const constraints = queryObj?.constraints || [];
    let filtered = dataList;
    for (const c of constraints) {
      if (c.type === "where") {
        if (c.op === "==") filtered = filtered.filter(d => d[c.field] === c.value);
      } else if (c.type === "orderBy") {
        filtered.sort((a, b) => {
          const valA = a[c.field];
          const valB = b[c.field];
          return c.direction === "asc" ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
        });
      }
    }

    const docs = filtered.map(d => ({ id: d.id, data: () => d }));
    onNext({ docs, forEach: (cb: any) => docs.forEach(cb), empty: docs.length === 0, size: docs.length });
  });
}

export async function setDoc(docRef: { colName: string; id: string }, data: any, _options?: { merge?: boolean }) {
  await CassandraClient.getInstance().write("set", docRef.colName, docRef.id, data);
}

export async function updateDoc(docRef: { colName: string; id: string }, data: any) {
  await CassandraClient.getInstance().write("set", docRef.colName, docRef.id, data);
}

export async function deleteDoc(docRef: { colName: string; id: string }) {
  await CassandraClient.getInstance().write("delete", docRef.colName, docRef.id);
}

export async function addDoc(colName: string, data: any) {
  const id = "msg_" + Math.random().toString(36).substring(2, 11);
  await CassandraClient.getInstance().write("set", colName, id, data);
  return { colName, id };
}

export function writeBatch() {
  const ops: any[] = [];
  return {
    set: (ref: any, data: any) => ops.push({ type: 'set', ref, data }),
    update: (ref: any, data: any) => ops.push({ type: 'update', ref, data }),
    delete: (ref: any) => ops.push({ type: 'delete', ref }),
    commit: async () => {
      for (const op of ops) {
        if (op.type === 'set') await setDoc(op.ref, op.data);
        if (op.type === 'update') await updateDoc(op.ref, op.data);
        if (op.type === 'delete') await deleteDoc(op.ref);
      }
    }
  };
}

// Signaling Compatibility (used for WebRTC) using our local API
export function sendBroadcastSignal(payload: any) {
  fetch("/api/webrtc/signal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, id: payload.id || `sig_${Date.now()}` })
  }).catch(console.error);
}

export function subscribeBroadcastSignals(myUid: string, onSignal: (signal: any) => void) {
  let eventSource: EventSource | null = null;
  let isSubscribed = true;
  const processedSignals = new Set<string>();

  const connect = () => {
    if (!isSubscribed) return;
    eventSource = new EventSource("/api/cassandra/stream");
    
    eventSource.addEventListener("webrtc_signal", (event) => {
      try {
        const data = JSON.parse(event.data);
        const payload = data.payload;
        if (payload && payload.uid !== myUid && (payload.targetUid === myUid || payload.targetUid === "all")) {
          if (!processedSignals.has(payload.id)) {
            processedSignals.add(payload.id);
            onSignal(payload);
          }
        }
      } catch (e) {}
    });

    eventSource.onerror = () => {
      if (isSubscribed) {
        eventSource?.close();
        setTimeout(connect, 2000);
      }
    };
  };

  connect();

  // Active Polling for signals across serverless instances
  const interval = setInterval(async () => {
    if (!isSubscribed) return;
    try {
      const res = await fetch(`/api/webrtc/signals?uid=${encodeURIComponent(myUid)}`);
      if (res.ok) {
        const json = await res.json();
        const signals = json.signals || [];
        for (const s of signals) {
           if (!processedSignals.has(s.id)) {
              processedSignals.add(s.id);
              onSignal(s);
           }
        }
      }
    } catch(e) {}
  }, 1500);

  return () => {
    isSubscribed = false;
    clearInterval(interval);
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };
}
