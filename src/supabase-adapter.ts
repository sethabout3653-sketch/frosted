import { io, Socket } from "socket.io-client";

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

export const db = { name: "SocketIODB" };

export enum OperationType {
  GET = "get",
  LIST = "list",
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  WRITE = "write",
}

export function handleFirestoreError(error: any, op: string, path: string) {
  console.warn(`[SocketIO] Error during ${op} on ${path}:`, error);
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
// Centralized Socket.io Connection Manager
// ==========================================
class SocketClient {
  private static instance: SocketClient;
  private socket: Socket;
  private listeners: Map<string, Set<(snap: any) => void>> = new Map();
  private cache: Map<string, Record<string, any>> = new Map();

  private constructor() {
    this.socket = io({
      transports: ["websocket"] // Required for Vercel according to docs
    });

    this.socket.on("change", (msg) => {
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
    });
  }

  public static getInstance(): SocketClient {
    if (!SocketClient.instance) {
      SocketClient.instance = new SocketClient();
    }
    return SocketClient.instance;
  }

  private notify(colName: string) {
    const colListeners = this.listeners.get(colName);
    if (colListeners) {
      const dataMap = this.cache.get(colName) || {};
      const dataList = Object.entries(dataMap).map(([id, val]) => ({ id, ...val }));
      const docs = dataList.map(d => ({ id: d.id, data: () => d }));
      colListeners.forEach(cb => cb({ docs, forEach: (fn: any) => docs.forEach(fn), empty: docs.length === 0, size: docs.length }));
    }
  }

  public async getCollection(colName: string) {
    try {
      const res = await fetch(`/api/cassandra/data?collection=${encodeURIComponent(colName)}`);
      if (res.ok) {
        const json = await res.json();
        this.cache.set(colName, json);
        return json;
      }
    } catch (e) {}
    return this.cache.get(colName) || {};
  }

  public subscribe(colName: string, queryObj: any, cb: (snap: any) => void) {
    if (!this.listeners.has(colName)) {
      this.listeners.set(colName, new Set());
      this.socket.emit("subscribe", colName);
    }
    
    const wrapper = (snap: any) => {
      // Re-apply filters from queryObj if necessary
      // For now, onSnapshot usually takes the whole collection and filters locally
      cb(snap);
    };

    this.listeners.get(colName)!.add(wrapper);
    
    // Initial fetch
    this.getCollection(colName).then(dataMap => {
      const docs = Object.entries(dataMap).map(([id, val]: [string, any]) => ({ id, data: () => val }));
      cb({ docs, forEach: (fn: any) => docs.forEach(fn), empty: docs.length === 0, size: docs.length });
    });

    return () => {
      this.listeners.get(colName)?.delete(wrapper);
      if (this.listeners.get(colName)?.size === 0) {
        this.listeners.delete(colName);
        this.socket.emit("unsubscribe", colName);
      }
    };
  }

  public async write(op: string, colName: string, id: string, data?: any) {
    try {
      await fetch("/api/cassandra/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, collection: colName, id, data }),
        keepalive: true,
      });
    } catch (e) {
      console.warn("Write error:", e);
    }
  }

  public identify(uid: string) {
    this.socket.emit("identify", uid);
  }

  public sendSignal(payload: any) {
    this.socket.emit("webrtc-signal", payload);
  }

  public onSignal(cb: (signal: any) => void) {
    this.socket.on("webrtc-signal", cb);
    return () => this.socket.off("webrtc-signal", cb);
  }
}

export async function getDocs(queryObj: any) {
  const colName = typeof queryObj === "string" ? queryObj : queryObj.colName;
  if (!colName) return { docs: [], forEach: () => {}, empty: true, size: 0 };

  const dataMap = await SocketClient.getInstance().getCollection(colName);
  const docs = Object.entries(dataMap).map(([id, val]: [string, any]) => ({
    id,
    data: () => ({ ...val, id })
  }));

  return {
    docs,
    forEach: (cb: any) => docs.forEach(cb),
    empty: docs.length === 0,
    size: docs.length
  };
}

export function onSnapshot(
  queryObj: any,
  onNext: (snap: any) => void,
  _onError?: (err: any) => void
) {
  const colName = typeof queryObj === "string" ? queryObj : queryObj.colName;
  if (!colName) return () => {};

  return SocketClient.getInstance().subscribe(colName, queryObj, onNext);
}

export async function setDoc(docRef: { colName: string; id: string }, data: any, _options?: { merge?: boolean }) {
  await SocketClient.getInstance().write("set", docRef.colName, docRef.id, data);
}

export async function updateDoc(docRef: { colName: string; id: string }, data: any) {
  await SocketClient.getInstance().write("update", docRef.colName, docRef.id, data);
}

export async function deleteDoc(docRef: { colName: string; id: string }) {
  await SocketClient.getInstance().write("delete", docRef.colName, docRef.id);
}

export async function addDoc(colName: string, data: any) {
  const id = "msg_" + Math.random().toString(36).substring(2, 11);
  await setDoc({ colName, id }, data);
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

// Signaling Compatibility
export function sendBroadcastSignal(payload: any) {
  SocketClient.getInstance().sendSignal(payload);
}

export function subscribeBroadcastSignals(myUid: string, onSignal: (signal: any) => void) {
  SocketClient.getInstance().identify(myUid);
  return SocketClient.getInstance().onSignal(onSignal);
}
