import { Client, Databases, ID, Query } from "appwrite";

// ==========================================
// Appwrite Configuration & Client Initialization
// ==========================================
const env = (import.meta as any).env || {};
const APPWRITE_ENDPOINT = env.VITE_APPWRITE_ENDPOINT || "https://cloud.appwrite.io/v1";
const APPWRITE_PROJECT_ID = env.VITE_APPWRITE_PROJECT_ID || "";
const APPWRITE_DATABASE_ID = env.VITE_APPWRITE_DATABASE_ID || "main";

export const appwriteClient = new Client();
if (APPWRITE_PROJECT_ID) {
  appwriteClient.setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID);
}
export const appwriteDatabases = new Databases(appwriteClient);

// Dummy db reference object for compatibility with existing imports
export const db = { type: "appwrite_custom_db", id: "main" };

// Storage helper
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
        if (res.ok) {
          const data = await res.json();
          return {
            url: data.url || data.fileUrl,
            filename: file.name,
            mimetype: file.type || "application/octet-stream",
            size: file.size,
          };
        }
      } catch (err) {}

      // Fallback local blob URL
      const blobUrl = URL.createObjectURL(file);
      return {
        url: blobUrl,
        filename: file.name,
        mimetype: file.type || "application/octet-stream",
        size: file.size,
      };
    },
  },
};

// ==========================================
// Pure Appwrite + Express Realtime Database Engine
// ==========================================
const store: Record<string, Map<string, any>> = {};
const listeners: Map<string, Set<(docsMap: Map<string, any>) => void>> = new Map();

function getColMap(colName: string): Map<string, any> {
  if (!store[colName]) {
    store[colName] = new Map<string, any>();
  }
  return store[colName];
}

function notifyListeners(colName: string) {
  const map = getColMap(colName);
  const colListeners = listeners.get(colName);
  if (colListeners) {
    colListeners.forEach((fn) => {
      try { fn(map); } catch (e) {}
    });
  }
}

// Global Server-Sent Events (SSE) Stream Listener for instant cross-device updates
let sseSource: EventSource | null = null;
function initSSE() {
  if (typeof window === "undefined" || sseSource) return;
  try {
    const streamUrl = `${window.location.origin}/api/db/stream?collection=all`;
    sseSource = new EventSource(streamUrl);

    sseSource.onmessage = (event) => {
      try {
        if (!event.data || event.data.startsWith(":")) return;
        const payload = JSON.parse(event.data);
        if (payload.type === "change" && payload.collection) {
          const colName = payload.collection;
          const colMap = getColMap(colName);
          const { op, id, data } = payload;

          if (op === "delete" && id) {
            colMap.delete(id);
          } else if ((op === "set" || op === "update") && id) {
            const existing = colMap.get(id) || {};
            colMap.set(id, { id, ...existing, ...data });
          } else if (op === "delete_all") {
            colMap.clear();
          }

          notifyListeners(colName);
        }
      } catch (e) {}
    };

    sseSource.onerror = () => {
      setTimeout(() => {
        if (sseSource) {
          try { sseSource.close(); } catch (e) {}
          sseSource = null;
          initSSE();
        }
      }, 3000);
    };
  } catch (e) {}
}

if (typeof window !== "undefined") {
  initSSE();
}

async function fetchBackendCollection(colName: string) {
  try {
    const res = await fetch(`/api/db/data?collection=${encodeURIComponent(colName)}`);
    if (res.ok) {
      const data = await res.json();
      const colMap = getColMap(colName);
      if (data && typeof data === "object") {
        Object.entries(data).forEach(([id, val]: [string, any]) => {
          colMap.set(id, { id, ...(val || {}) });
        });
        notifyListeners(colName);
      }
    }
  } catch (e) {}

  // Also query Appwrite if project ID is provided
  if (APPWRITE_PROJECT_ID) {
    try {
      const cleanColName = colName.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 36);
      const appwriteRes = await appwriteDatabases.listDocuments(APPWRITE_DATABASE_ID, cleanColName);
      if (appwriteRes?.documents) {
        const colMap = getColMap(colName);
        appwriteRes.documents.forEach((doc: any) => {
          const { $id, $createdAt, $updatedAt, $permissions, $databaseId, $collectionId, ...data } = doc;
          colMap.set($id, { id: $id, ...data });
        });
        notifyListeners(colName);
      }
    } catch (e) {}
  }
}

async function writeBackendDoc(colName: string, op: "set" | "update" | "delete", id: string, data?: any) {
  const colMap = getColMap(colName);
  if (op === "delete") {
    colMap.delete(id);
  } else {
    const existing = colMap.get(id) || {};
    colMap.set(id, { id, ...existing, ...(data || {}) });
  }
  notifyListeners(colName);

  // 1. Sync with server database endpoint
  try {
    await fetch(`/api/db/data?collection=${encodeURIComponent(colName)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op, id, data }),
    });
  } catch (e) {}

  // 2. Sync with Appwrite
  if (APPWRITE_PROJECT_ID) {
    try {
      const cleanColName = colName.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 36);
      if (op === "delete") {
        await appwriteDatabases.deleteDocument(APPWRITE_DATABASE_ID, cleanColName, id);
      } else if (op === "update") {
        await appwriteDatabases.updateDocument(APPWRITE_DATABASE_ID, cleanColName, id, data || {});
      } else {
        await appwriteDatabases.createDocument(APPWRITE_DATABASE_ID, cleanColName, id || ID.unique(), data || {});
      }
    } catch (e) {}
  }
}

function extractColName(queryOrCol: any): string {
  if (typeof queryOrCol === "string") return queryOrCol;
  if (queryOrCol?.path) return queryOrCol.path;
  if (queryOrCol?._query?.path?.segments) {
    return queryOrCol._query.path.segments.join("/");
  }
  if (queryOrCol?.parent?.path) return queryOrCol.parent.path;
  return "default";
}

export function collection(dbInstance: any, name: string) {
  return { path: name };
}

export function doc(dbInstanceOrCol: any, pathOrCol: string, id?: string) {
  if (typeof pathOrCol === "string" && id) {
    return { id, path: `${pathOrCol}/${id}`, parent: { path: pathOrCol } };
  }
  if (typeof dbInstanceOrCol === "object" && dbInstanceOrCol?.path) {
    return { id: pathOrCol, path: `${dbInstanceOrCol.path}/${pathOrCol}`, parent: { path: dbInstanceOrCol.path } };
  }
  if (typeof pathOrCol === "string" && pathOrCol.includes("/")) {
    const parts = pathOrCol.split("/");
    const docId = parts.pop() || "doc_" + Date.now();
    const parentPath = parts.join("/") || "default";
    return { id: docId, path: pathOrCol, parent: { path: parentPath } };
  }
  return { id: pathOrCol, path: pathOrCol, parent: { path: "default" } };
}

export function query(colRef: any, ...constraints: any[]) {
  const colName = extractColName(colRef);
  return { path: colName, constraints };
}

export function where(field: string, op: string, value: any) {
  return { type: "where", field, op, value };
}

export function orderBy(field: string, direction: "asc" | "desc" = "asc") {
  return { type: "orderBy", field, direction };
}

export function limit(limitCount: number) {
  return { type: "limit", count: limitCount };
}

function buildSyntheticSnapshot(colName: string) {
  const colMap = getColMap(colName);
  const docList = Array.from(colMap.values());

  const docs = docList.map((d) => ({
    id: d.id,
    data: () => ({ ...d }),
    exists: () => true,
    ref: doc(db, colName, d.id),
  }));

  return {
    docs,
    empty: docs.length === 0,
    size: docs.length,
    forEach: (fn: (doc: any) => void) => docs.forEach(fn),
    docChanges: () => docs.map((d) => ({ type: "added", doc: d })),
  };
}

export async function getDocs(queryObj: any) {
  const colName = extractColName(queryObj);
  await fetchBackendCollection(colName);
  return buildSyntheticSnapshot(colName);
}

export function onSnapshot(
  queryObj: any,
  callback: (snap: any) => void,
  errorCallback?: (err: any) => void
) {
  const colName = extractColName(queryObj);

  fetchBackendCollection(colName).then(() => {
    callback(buildSyntheticSnapshot(colName));
  });

  if (!listeners.has(colName)) {
    listeners.set(colName, new Set());
  }
  const colListeners = listeners.get(colName)!;

  const handleUpdate = () => {
    callback(buildSyntheticSnapshot(colName));
  };
  colListeners.add(handleUpdate);

  return () => {
    colListeners.delete(handleUpdate);
  };
}

export async function addDoc(colRefOrName: any, data: any) {
  const colName = typeof colRefOrName === "string" ? colRefOrName : extractColName(colRefOrName);
  const docId = "doc_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);
  const docData = { id: docId, ...data, timestamp: data.timestamp || Date.now() };

  await writeBackendDoc(colName, "set", docId, docData);
  return { id: docId };
}

export async function setDoc(docRef: any, data: any, options?: { merge?: boolean }) {
  const colName = docRef?.parent?.path || extractColName(docRef) || "default";
  const docId = docRef?.id || "doc_" + Date.now();

  await writeBackendDoc(colName, options?.merge ? "update" : "set", docId, data);
}

export async function updateDoc(docRef: any, data: any) {
  const colName = docRef?.parent?.path || extractColName(docRef) || "default";
  const docId = docRef?.id;

  if (docId) {
    await writeBackendDoc(colName, "update", docId, data);
  }
}

export async function deleteDoc(docRef: any) {
  const colName = docRef?.parent?.path || extractColName(docRef) || "default";
  const docId = docRef?.id;

  if (docId) {
    await writeBackendDoc(colName, "delete", docId);
  }
}

export function writeBatch() {
  const operations: Array<() => Promise<void>> = [];

  return {
    set: (docRef: any, data: any, options?: any) => {
      operations.push(() => setDoc(docRef, data, options));
    },
    update: (docRef: any, data: any) => {
      operations.push(() => updateDoc(docRef, data));
    },
    delete: (docRef: any) => {
      operations.push(() => deleteDoc(docRef));
    },
    commit: async () => {
      for (const op of operations) {
        try { await op(); } catch (e) {}
      }
    },
  };
}

export enum OperationType {
  LIST = "list",
  GET = "get",
  SET = "set",
  ADD = "add",
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  BATCH = "batch",
  REALTIME = "realtime",
  UNKNOWN = "unknown",
}

export function handleFirestoreError(err: any, op?: OperationType, context?: string) {
  console.warn(`Database log (${op} - ${context || "unknown"}):`, err);
}

export function toTimestampMs(val: any): number {
  if (!val) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  if (typeof val === "string") {
    const num = Number(val);
    if (!isNaN(num) && num > 0) return num;
    const parsedDate = Date.parse(val);
    if (!isNaN(parsedDate)) return parsedDate;
  }
  if (val && typeof val.toMillis === "function") return val.toMillis();
  if (val instanceof Date) return val.getTime();
  return 0;
}

export function compareMessagesChronological(a: any, b: any): number {
  const timeA = toTimestampMs(a?.timestamp);
  const timeB = toTimestampMs(b?.timestamp);
  if (timeA !== timeB) return timeA - timeB;
  const idA = String(a?.id || a?.uid || "");
  const idB = String(b?.id || b?.uid || "");
  return idA.localeCompare(idB);
}

// Local BroadcastChannel for zero-latency cross-tab signaling
const localBus = typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
  ? new BroadcastChannel("app_local_sync_channel")
  : null;

const signalListeners = new Set<(signal: any) => void>();

if (localBus) {
  localBus.onmessage = (e) => {
    if (e.data && e.data.type === "signal") {
      signalListeners.forEach((fn) => fn(e.data.payload));
    }
  };
}

export async function sendBroadcastSignal(signal: any) {
  const payload = {
    ...signal,
    timestamp: Date.now(),
  };
  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) {
      delete payload[key];
    }
  });

  if (localBus) {
    try {
      localBus.postMessage({ type: "signal", payload });
    } catch (e) {}
  }

  const sigId = "sig_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);
  writeBackendDoc("signals", "set", sigId, payload).catch(() => {});
}

export function subscribeBroadcastSignals(
  uid: string,
  onSignal: (signal: any) => void
) {
  const handler = (signalData: any) => {
    if (signalData && (signalData.targetUid === uid || signalData.targetUid === "all") && signalData.uid !== uid) {
      onSignal(signalData);
    }
  };

  signalListeners.add(handler);

  const unsub = onSnapshot({ path: "signals" }, (snapshot: any) => {
    snapshot.docs.forEach((docSnap: any) => {
      const signalData = docSnap.data();
      if (signalData && signalData.uid !== uid && (signalData.targetUid === uid || signalData.targetUid === "all")) {
        onSignal(signalData);
        deleteDoc(docSnap.ref).catch(() => {});
      }
    });
  });

  return () => {
    signalListeners.delete(handler);
    unsub();
  };
}
