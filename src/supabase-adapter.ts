import { realtimeDb } from "./lib/realtime-db";

// Remove all Supabase dependencies and rely strictly on our custom 
// local/Vercel-compatible SSE real-time engine.

export const db = { name: "CustomServerlessDB" };

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

// Database Operations mapping directly to realtimeDb
export async function getDocs(queryObj: any) {
  const colName = typeof queryObj === "string" ? queryObj : queryObj.colName;
  const constraints = queryObj?.constraints || [];
  
  if (!colName) {
    return { docs: [], forEach: () => {}, empty: true, size: 0 };
  }

  try {
    const dataMap = await realtimeDb.get(colName);
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

  // Initial fetch
  getDocs(queryObj).then(onNext).catch(console.error);

  // Local realtime SSE fallback
  return realtimeDb.subscribe(colName, {
    onSnapshot: (data) => {
      const docs = Object.entries(data || {}).map(([id, val]: [string, any]) => ({
        id,
        data: () => val
      }));
      onNext({ docs, forEach: (cb: any) => docs.forEach(cb), empty: docs.length === 0, size: docs.length });
    },
    onChange: () => {
      getDocs(queryObj).then(onNext).catch(console.error);
    }
  });
}

export async function setDoc(docRef: { colName: string; id: string }, data: any, _options?: { merge?: boolean }) {
  await realtimeDb.set(docRef.colName, docRef.id, data);
}

export async function updateDoc(docRef: { colName: string; id: string }, data: any) {
  const existing = await realtimeDb.get(docRef.colName, docRef.id);
  await realtimeDb.set(docRef.colName, docRef.id, { ...existing, ...data });
}

export async function deleteDoc(docRef: { colName: string; id: string }) {
  await realtimeDb.delete(docRef.colName, docRef.id);
}

export async function addDoc(colName: string, data: any) {
  const id = "msg_" + Math.random().toString(36).substring(2, 11);
  await realtimeDb.set(colName, id, data);
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

  const connect = () => {
    if (!isSubscribed) return;
    eventSource = new EventSource("/api/cassandra/stream");
    
    eventSource.addEventListener("webrtc_signal", (event) => {
      try {
        const data = JSON.parse(event.data);
        const payload = data.payload;
        if (payload && payload.uid !== myUid && (payload.targetUid === myUid || payload.targetUid === "all")) {
          onSignal(payload);
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

  return () => {
    isSubscribed = false;
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };
}
