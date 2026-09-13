import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";

// ==========================================
// Yjs P2P Mesh Network Setup
// ==========================================
const ydoc = new Y.Doc();
// Use public WebRTC signaling servers for 100% serverless, zero-config P2P sync
let provider: any = null;
try {
  provider = new WebrtcProvider("frosted-global-p2p-room-v1", ydoc, {
    signaling: [
      "wss://signaling.yjs.dev",
      "wss://y-webrtc-signaling-eu.herokuapp.com",
      "wss://y-webrtc-signaling-us.herokuapp.com"
    ]
  });
} catch(e) {
  console.error("Yjs WebrtcProvider init failed", e);
}

// Remove all Supabase dependencies and rely strictly on Yjs
export const db = { name: "YjsWebrtcDB" };

// Storage Helper mapping to our local server storage
export const cassandra = {
  storage: {
    upload: async (
      file: File,
      onProgress?: (p: number) => void
    ): Promise<{ url: string; filename: string; mimetype: string; size: number }> => {
      // Data URL for 100% serverless/P2P offline capability
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
  console.warn(`[P2P DB] Error during ${op} on ${path}:`, error);
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

// Database Operations mapping directly to Yjs Maps
export async function getDocs(queryObj: any) {
  const colName = typeof queryObj === "string" ? queryObj : queryObj.colName;
  const constraints = queryObj?.constraints || [];
  
  if (!colName) {
    return { docs: [], forEach: () => {}, empty: true, size: 0 };
  }
  
  try {
    const ymap = ydoc.getMap(colName);
    const dataList: any[] = [];
    ymap.forEach((val: any, id: string) => {
      dataList.push({ id, ...val });
    });
    
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
  
  const ymap = ydoc.getMap(colName);
  
  const triggerUpdate = () => {
    getDocs(queryObj).then(onNext).catch(console.error);
  };
  
  // Initial fetch
  triggerUpdate();
  
  // Listen for real-time mesh changes
  ymap.observe(triggerUpdate);
  
  return () => {
    ymap.unobserve(triggerUpdate);
  };
}

export async function setDoc(docRef: { colName: string; id: string }, data: any, _options?: { merge?: boolean }) {
  ydoc.getMap(docRef.colName).set(docRef.id, data);
}

export async function updateDoc(docRef: { colName: string; id: string }, data: any) {
  const ymap = ydoc.getMap(docRef.colName);
  const existing = ymap.get(docRef.id) || {};
  ymap.set(docRef.id, { ...(existing as any), ...data });
}

export async function deleteDoc(docRef: { colName: string; id: string }) {
  ydoc.getMap(docRef.colName).delete(docRef.id);
}

export async function addDoc(colName: string, data: any) {
  const id = "msg_" + Math.random().toString(36).substring(2, 11);
  ydoc.getMap(colName).set(id, data);
  return { colName, id };
}

export function writeBatch() {
  const ops: any[] = [];
  return {
    set: (ref: any, data: any) => ops.push({ type: 'set', ref, data }),
    update: (ref: any, data: any) => ops.push({ type: 'update', ref, data }),
    delete: (ref: any) => ops.push({ type: 'delete', ref }),
    commit: async () => {
      ydoc.transact(() => {
        for (const op of ops) {
          if (op.type === 'set') ydoc.getMap(op.ref.colName).set(op.ref.id, op.data);
          if (op.type === 'update') {
            const existing = ydoc.getMap(op.ref.colName).get(op.ref.id) || {};
            ydoc.getMap(op.ref.colName).set(op.ref.id, { ...(existing as any), ...op.data });
          }
          if (op.type === 'delete') ydoc.getMap(op.ref.colName).delete(op.ref.id);
        }
      });
    }
  };
}

// Signaling Compatibility (used for WebRTC voice/video handshakes)
const signalsMap = ydoc.getMap("webrtc_signals");

export function sendBroadcastSignal(payload: any) {
  const id = payload.id || `sig_${Date.now()}_${Math.random().toString(36).substring(2,8)}`;
  signalsMap.set(id, { ...payload, id, timestamp: Date.now() });
  
  // Cleanup old signals immediately in this client's view
  const cutoff = Date.now() - 30000;
  signalsMap.forEach((val: any, key: string) => {
    if (val.timestamp < cutoff) signalsMap.delete(key);
  });
}

export function subscribeBroadcastSignals(myUid: string, onSignal: (signal: any) => void) {
  const processedSignals = new Set<string>();
  
  const observer = (event: Y.YMapEvent<any>) => {
    event.changes.keys.forEach((change, key) => {
      if (change.action === 'add' || change.action === 'update') {
        const payload: any = signalsMap.get(key);
        if (payload && payload.uid !== myUid && (payload.targetUid === myUid || payload.targetUid === "all")) {
          if (!processedSignals.has(payload.id)) {
            processedSignals.add(payload.id);
            onSignal(payload);
          }
        }
      }
    });
  };
  
  signalsMap.observe(observer);
  
  return () => {
    signalsMap.unobserve(observer);
  };
}
