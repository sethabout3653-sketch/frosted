import { initializeApp, getApps, getApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection as fsCollection,
  doc as fsDoc,
  query as fsQuery,
  where as fsWhere,
  orderBy as fsOrderBy,
  limit as fsLimit,
  getDocs as fsGetDocs,
  onSnapshot as fsOnSnapshot,
  addDoc as fsAddDoc,
  setDoc as fsSetDoc,
  updateDoc as fsUpdateDoc,
  deleteDoc as fsDeleteDoc,
  writeBatch as fsWriteBatch,
  getDocFromServer,
} from "firebase/firestore";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import firebaseConfig from "../firebase-applet-config.json";

// Initialize Firebase App
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Firestore with multi-tab persistent local cache & zero query limits
export const db = initializeFirestore(
  app,
  {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  },
  firebaseConfig.firestoreDatabaseId || "(default)"
);

// Connection test
async function testConnection() {
  try {
    await getDocFromServer(fsDoc(db, "test", "connection"));
    console.log("Firebase Firestore connected successfully!");
  } catch (error: any) {
    console.log("Firestore initialization check completed");
  }
}
testConnection();

export const cassandra = {
  storage: {
    upload: async (
      file: File,
      onProgress?: (p: number) => void
    ): Promise<{ url: string; filename: string; mimetype: string; size: number }> => {
      try {
        const storage = getStorage(app);
        const ext = file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(2)}.${ext}`;
        const fileRef = storageRef(storage, `uploads/${fileName}`);
        await uploadBytes(fileRef, file);
        const url = await getDownloadURL(fileRef);
        return {
          url,
          filename: file.name,
          mimetype: file.type || "application/octet-stream",
          size: file.size,
        };
      } catch (err) {
        return new Promise((resolve) => {
          const blobUrl = URL.createObjectURL(file);
          resolve({
            url: blobUrl,
            filename: file.name,
            mimetype: file.type || "application/octet-stream",
            size: file.size,
          });
        });
      }
    }
  }
};

// Firebase exports

export function collection(dbInstance: any, name: string) {
  return fsCollection(dbInstance || db, name);
}

export function doc(dbInstanceOrCol: any, pathOrCol: string, id?: string) {
  if (typeof pathOrCol === "string" && id) {
    return fsDoc(dbInstanceOrCol || db, pathOrCol, id);
  }
  if (typeof dbInstanceOrCol === "string" && typeof pathOrCol === "string") {
    return fsDoc(db, dbInstanceOrCol, pathOrCol);
  }
  return fsDoc(dbInstanceOrCol, pathOrCol);
}

export function query(colRef: any, ...constraints: any[]) {
  const validConstraints = constraints.filter(Boolean);
  return fsQuery(colRef, ...validConstraints);
}

export function where(field: string, op: any, value: any) {
  const mapOp: Record<string, any> = {
    "==": "==",
    "!=": "!=",
    ">": ">",
    "<": "<",
    ">=": ">=",
    "<=": "<=",
    "in": "in",
  };
  return fsWhere(field, mapOp[op] || "==", value);
}

export function orderBy(field: string, direction: "asc" | "desc" = "asc") {
  return fsOrderBy(field, direction);
}

export function limit(limitCount: number) {
  return fsLimit(limitCount);
}

export async function getDocs(queryObj: any) {
  try {
    const snap = await fsGetDocs(queryObj);
    return snap;
  } catch (err) {
    console.warn("getDocs error:", err);
    return { docs: [], empty: true, size: 0, forEach: () => {} };
  }
}

export function onSnapshot(
  queryObj: any,
  callback: (snap: any) => void,
  errorCallback?: (err: any) => void
) {
  return fsOnSnapshot(
    queryObj,
    (snap) => {
      callback(snap);
    },
    (err) => {
      console.warn("Firestore snapshot warning:", err);
      if (errorCallback) errorCallback(err);
    }
  );
}

export async function addDoc(colRefOrName: any, data: any) {
  const colRef = typeof colRefOrName === "string" ? fsCollection(db, colRefOrName) : colRefOrName;
  const res = await fsAddDoc(colRef, data);
  return { id: res.id };
}

export async function setDoc(docRef: any, data: any, options?: { merge?: boolean }) {
  await fsSetDoc(docRef, data, options || {});
}

export async function updateDoc(docRef: any, data: any) {
  await fsUpdateDoc(docRef, data);
}

export async function deleteDoc(docRef: any) {
  await fsDeleteDoc(docRef);
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
  UNKNOWN = "unknown"
}

export function handleFirestoreError(err: any, op?: OperationType, context?: string) {
  console.warn(`Firestore log (${op} - ${context || 'unknown'}):`, err);
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

export function writeBatch() {
  const batch = fsWriteBatch(db);
  return {
    set: (docRef: any, data: any, options?: any) => {
      batch.set(docRef, data, options || {});
    },
    update: (docRef: any, data: any) => {
      batch.update(docRef, data);
    },
    delete: (docRef: any) => {
      batch.delete(docRef);
    },
    commit: async () => {
      await batch.commit();
    }
  };
}

// Local BroadcastChannel for zero-latency, zero-quota cross-tab sync
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
  
  // 1. Instant zero-quota local tab broadcast
  if (localBus) {
    try {
      localBus.postMessage({ type: "signal", payload });
    } catch (e) {}
  }

  // 2. Persist to Firestore for remote peers
  try {
    const signalsCol = fsCollection(db, "signals");
    await fsAddDoc(signalsCol, payload);
  } catch (err) {
    console.warn("Firestore signal send notice:", err);
  }
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

  const q = fsQuery(
    fsCollection(db, "signals"),
    fsWhere("targetUid", "in", [uid, "all"])
  );
  
  const unsubscribeFs = fsOnSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") {
        const signalData = { id: change.doc.id, ...change.doc.data() } as any;
        // Clean up signal after receiving to minimize storage
        fsDeleteDoc(change.doc.ref).catch(() => {});
        if (signalData.uid !== uid) {
          onSignal(signalData);
        }
      }
    });
  }, (err) => {
    console.warn("Signal listener notice:", err);
  });

  return () => {
    signalListeners.delete(handler);
    unsubscribeFs();
  };
}
