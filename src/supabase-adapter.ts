import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://jtocgfqurrlyyvhfmfsc.supabase.co";
const supabaseAnonKey = "sb_publishable_o5pFWa88vKImudzqdbVWkw_AyBOzXOj";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 40,
    },
  },
});
export const db = supabase;

export const cassandra = {
  storage: {
    upload: async (
      file: File,
      onProgress?: (p: number) => void
    ): Promise<{ url: string; filename: string; mimetype: string; size: number }> => {
      // 1. First attempt uploading to server Express endpoint (/api/upload)
      try {
        const formData = new FormData();
        formData.append("file", file);

        const serverRes = await new Promise<any>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/upload", true);

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && onProgress) {
              onProgress((e.loaded / e.total) * 100);
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              const text = xhr.responseText.trim();
              if (text.startsWith("{") && !text.includes("<!DOCTYPE") && !text.includes("<html")) {
                try {
                  const data = JSON.parse(text);
                  if (data && data.url) {
                    resolve(data);
                    return;
                  }
                } catch (e) {}
              }
            }
            reject(new Error("Server upload endpoint returned non-JSON or HTML fallback"));
          };

          xhr.onerror = () => reject(new Error("Network error uploading to server"));
          xhr.send(formData);
        });

        if (serverRes && serverRes.url) {
          let finalUrl = serverRes.url;
          const origName = serverRes.filename || file.name;
          const origType = serverRes.mimetype || file.type || "application/octet-stream";
          const origSize = serverRes.size || file.size;
          if (finalUrl && !finalUrl.startsWith("data:") && !finalUrl.includes("?name=") && !finalUrl.includes("&name=")) {
            const sep = finalUrl.includes("?") ? "&" : "?";
            finalUrl = `${finalUrl}${sep}name=${encodeURIComponent(origName)}&type=${encodeURIComponent(origType)}&size=${origSize}`;
          }
          return {
            ...serverRes,
            url: finalUrl,
            filename: origName,
            mimetype: origType,
            size: origSize,
          };
        }
      } catch (err) {
        console.warn("Server upload endpoint unavailable (e.g. Vercel static deployment). Using embedded Data URL storage:", err);
      }

      // 2. Standalone / Vercel fallback: Encode file as Base64 Data URL so binary content and MIME type are 100% preserved
      return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onprogress = (e) => {
          if (e.lengthComputable && onProgress) {
            onProgress((e.loaded / e.total) * 100);
          }
        };

        reader.onload = () => {
          const dataUrl = reader.result as string;
          resolve({
            url: dataUrl,
            filename: file.name,
            mimetype: file.type || "application/octet-stream",
            size: file.size,
          });
        };

        reader.onerror = () => reject(new Error("Failed to read file as Data URL"));
        reader.readAsDataURL(file);
      });
    }
  }
};

export function collection(dbInstance: any, name: string) {
  return name;
}

export function doc(dbInstance: any, colName: string, id: string) {
  return { colName, id };
}

export function query(colName: string, ...constraints: any[]) {
  return { colName, constraints };
}

export function where(field: string, op: string, value: any) {
  return { type: "where", field, op, value };
}

export function orderBy(field: string, direction: "asc" | "desc" = "asc") {
  return { type: "orderBy", field, direction };
}

export function limit(limitCount: number) {
  return { type: "limit", limitCount };
}

function getPk(colName: string) {
  return (colName === "presence" || colName === "voice_users") ? "uid" : "id";
}

// ---------------------------------------------------------
// Ultra-Low Latency In-Memory State & Realtime Broadcast Bus
// ---------------------------------------------------------

const inMemoryStore = new Map<string, Map<string, any>>();
const initialFetchDone = new Set<string>();
const activeListeners = new Set<{
  id: string;
  queryObj: any;
  onNext: (snap: any) => void;
  onError?: (err: any) => void;
}>();

function getColMap(colName: string): Map<string, any> {
  let map = inMemoryStore.get(colName);
  if (!map) {
    map = new Map();
    inMemoryStore.set(colName, map);
  }
  return map;
}

function applyQuery(colName: string, constraints: any[] = []): { docs: any[]; empty: boolean; size: number; forEach: (cb: any) => void } {
  const colMap = getColMap(colName);
  const pk = getPk(colName);
  let items = Array.from(colMap.values());

  for (const c of constraints) {
    if (c.type === "where") {
      if (c.op === "==") {
        items = items.filter((d) => d[c.field] === c.value);
      } else if (c.op === "!=") {
        items = items.filter((d) => d[c.field] !== c.value);
      } else if (c.op === ">") {
        items = items.filter((d) => d[c.field] > c.value);
      } else if (c.op === "<") {
        items = items.filter((d) => d[c.field] < c.value);
      }
    } else if (c.type === "orderBy") {
      items.sort((a, b) => {
        const valA = a?.[c.field];
        const valB = b?.[c.field];
        if (typeof valA === "string" || typeof valB === "string") {
          const strA = String(valA ?? "");
          const strB = String(valB ?? "");
          return c.direction === "desc" ? strB.localeCompare(strA) : strA.localeCompare(strB);
        }
        const numA = Number(valA ?? 0);
        const numB = Number(valB ?? 0);
        return c.direction === "desc" ? numB - numA : numA - numB;
      });
    } else if (c.type === "limit") {
      items = items.slice(0, c.limitCount);
    }
  }

  const docs = items.map((d: any) => ({
    id: d[pk] || d.id || d.uid,
    data: () => d,
  }));

  return {
    docs,
    empty: docs.length === 0,
    size: docs.length,
    forEach: (cb: any) => docs.forEach((d: any) => cb(d)),
  };
}

function notifyListeners(colName: string) {
  activeListeners.forEach((listener) => {
    const lCol = typeof listener.queryObj === "string" ? listener.queryObj : listener.queryObj.colName;
    if (lCol === colName) {
      try {
        const constraints = listener.queryObj?.constraints || [];
        const snap = applyQuery(colName, constraints);
        listener.onNext(snap);
      } catch (err) {
        console.warn("Error notifying listener:", err);
      }
    }
  });
}

// Global multiplexed Supabase Realtime Channel
let globalRealtimeChannel: any = null;
const broadcastListeners = new Set<(signal: any) => void>();

export function getOrCreateGlobalChannel() {
  if (!globalRealtimeChannel) {
    globalRealtimeChannel = supabase.channel("app-global-realtime-bus", {
      config: { broadcast: { self: false } },
    });

    globalRealtimeChannel
      // 1. Zero-latency Broadcast Signals for WebRTC & Voice
      .on("broadcast", { event: "webrtc_signal" }, ({ payload }: { payload: any }) => {
        broadcastListeners.forEach((listener) => {
          try {
            listener(payload);
          } catch (e) {}
        });
      })
      // 2. Zero-latency Mutation Broadcast (instant state across all clients without waiting for SQL)
      .on("broadcast", { event: "db_mutation" }, ({ payload }: { payload: any }) => {
        if (!payload || !payload.colName) return;
        const { colName, action, data, id, pk } = payload;
        const colMap = getColMap(colName);
        const actualPk = pk || getPk(colName);

        if (action === "insert" || action === "upsert") {
          const docId = data[actualPk] || data.id || data.uid;
          if (docId) {
            colMap.set(docId, data);
            notifyListeners(colName);
          }
        } else if (action === "update") {
          const docId = id || data?.[actualPk];
          if (docId) {
            const existing = colMap.get(docId) || {};
            colMap.set(docId, { ...existing, ...data });
            notifyListeners(colName);
          }
        } else if (action === "delete") {
          const docId = id;
          if (docId) {
            colMap.delete(docId);
            notifyListeners(colName);
          }
        }
      })
      // 3. Postgres Database Changes Subscription (instant merge from SQL replication)
      .on("postgres_changes", { event: "*", schema: "public" }, (payload: any) => {
        const colName = payload.table;
        if (!colName) return;
        const colMap = getColMap(colName);
        const pk = getPk(colName);

        if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
          const row = payload.new;
          const rowId = row[pk] || row.id || row.uid;
          if (rowId) {
            colMap.set(rowId, row);
            notifyListeners(colName);
          }
        } else if (payload.eventType === "DELETE") {
          const oldRow = payload.old;
          const rowId = oldRow?.[pk] || oldRow?.id || oldRow?.uid;
          if (rowId) {
            colMap.delete(rowId);
            notifyListeners(colName);
          }
        }
      })
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          // Connected cleanly
        }
      });
  }
  return globalRealtimeChannel;
}

// Broadcast mutation over zero-latency WebSocket
function broadcastMutation(colName: string, action: "insert" | "upsert" | "update" | "delete", data: any, id?: string) {
  try {
    const ch = getOrCreateGlobalChannel();
    ch.send({
      type: "broadcast",
      event: "db_mutation",
      payload: {
        colName,
        action,
        data,
        id,
        pk: getPk(colName),
        timestamp: Date.now(),
      },
    }).catch(() => {});
  } catch (err) {}
}

export function sendBroadcastSignal(payload: { uid: string; targetUid: string; type: string; sdp?: string; timestamp: number }) {
  try {
    const ch = getOrCreateGlobalChannel();
    ch.send({
      type: "broadcast",
      event: "webrtc_signal",
      payload,
    }).catch(() => {});
  } catch (err) {}
}

export function subscribeBroadcastSignals(myUid: string, onSignal: (signal: any) => void) {
  getOrCreateGlobalChannel();
  const handler = (payload: any) => {
    if (payload && (payload.targetUid === myUid || payload.targetUid === "all")) {
      onSignal(payload);
    }
  };
  broadcastListeners.add(handler);
  return () => {
    broadcastListeners.delete(handler);
  };
}

// ---------------------------------------------------------
// Fast DB Helpers with optimistic local state & background sync
// ---------------------------------------------------------

const isNetworkOrTimeoutError = (err: any): boolean => {
  if (!err) return false;
  const msg = (err.message || err.details || String(err)).toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("upstream request timeout") ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("load failed") ||
    msg.includes("offline")
  );
};

// Asynchronous background insert without blocking UI
async function backgroundInsert(colName: string, payload: any) {
  let currentPayload = { ...payload };
  try {
    const { error } = await supabase.from(colName).insert(currentPayload);
    if (!error) return;

    if (error.code === "PGRST204") {
      const match = error.message?.match(/Could not find the '([^']+)' column/i);
      if (match && match[1] && match[1] in currentPayload) {
        delete currentPayload[match[1]];
        await supabase.from(colName).insert(currentPayload);
      }
    } else if (error.code === "PGRST205") {
      window.dispatchEvent(new CustomEvent("supabase_missing_table", { detail: colName }));
    }
  } catch (err) {}
}

// Asynchronous background upsert without blocking UI
async function backgroundUpsert(colName: string, payload: any, pk: string) {
  let currentPayload = { ...payload };
  try {
    const { error } = await supabase.from(colName).upsert(currentPayload, { onConflict: pk });
    if (!error) return;

    if (error.code === "PGRST204") {
      const match = error.message?.match(/Could not find the '([^']+)' column/i);
      if (match && match[1] && match[1] in currentPayload) {
        delete currentPayload[match[1]];
        await supabase.from(colName).upsert(currentPayload, { onConflict: pk });
      }
    } else if (error.code === "PGRST205") {
      window.dispatchEvent(new CustomEvent("supabase_missing_table", { detail: colName }));
    }
  } catch (err) {}
}

// Asynchronous background update without blocking UI
async function backgroundUpdate(colName: string, payload: any, pk: string, id: string) {
  let currentPayload = { ...payload };
  try {
    const { error } = await supabase.from(colName).update(currentPayload).eq(pk, id);
    if (!error) return;

    if (error.code === "PGRST204") {
      const match = error.message?.match(/Could not find the '([^']+)' column/i);
      if (match && match[1] && match[1] in currentPayload) {
        delete currentPayload[match[1]];
        await supabase.from(colName).update(currentPayload).eq(pk, id);
      }
    } else if (error.code === "PGRST205") {
      window.dispatchEvent(new CustomEvent("supabase_missing_table", { detail: colName }));
    }
  } catch (err) {}
}

// Asynchronous background delete without blocking UI
async function backgroundDelete(colName: string, pk: string, id: string) {
  try {
    const { error } = await supabase.from(colName).delete().eq(pk, id);
    if (error && error.code === "PGRST205") {
      window.dispatchEvent(new CustomEvent("supabase_missing_table", { detail: colName }));
    }
  } catch (err) {}
}

export async function setDoc(docRef: { colName: string; id: string }, data: any, _options?: { merge?: boolean }) {
  const pk = getPk(docRef.colName);
  const payload = { [pk]: docRef.id, ...data };
  if (pk !== "id" && "id" in payload) {
    delete payload.id;
  }

  // 1. Instant optimistic in-memory update (0ms)
  const colMap = getColMap(docRef.colName);
  const existing = colMap.get(docRef.id) || {};
  colMap.set(docRef.id, { ...existing, ...payload });
  notifyListeners(docRef.colName);

  // 2. Instant Realtime WebSocket broadcast (<20ms)
  broadcastMutation(docRef.colName, "upsert", payload, docRef.id);

  // 3. Non-blocking background database persist
  backgroundUpsert(docRef.colName, payload, pk);
}

export async function updateDoc(docRef: { colName: string; id: string }, data: any) {
  const pk = getPk(docRef.colName);

  // 1. Instant optimistic in-memory update (0ms)
  const colMap = getColMap(docRef.colName);
  const existing = colMap.get(docRef.id) || {};
  const updated = { ...existing, ...data };
  colMap.set(docRef.id, updated);
  notifyListeners(docRef.colName);

  // 2. Instant Realtime WebSocket broadcast (<20ms)
  broadcastMutation(docRef.colName, "update", data, docRef.id);

  // 3. Non-blocking background database persist
  backgroundUpdate(docRef.colName, data, pk, docRef.id);
}

export async function deleteDoc(docRef: { colName: string; id: string }) {
  const pk = getPk(docRef.colName);

  // 1. Instant optimistic in-memory update (0ms)
  const colMap = getColMap(docRef.colName);
  colMap.delete(docRef.id);
  notifyListeners(docRef.colName);

  // 2. Instant Realtime WebSocket broadcast (<20ms)
  broadcastMutation(docRef.colName, "delete", null, docRef.id);

  // 3. Non-blocking background database persist
  backgroundDelete(docRef.colName, pk, docRef.id);
}

export async function addDoc(colName: string, data: any) {
  const pk = getPk(colName);
  const id = "doc_" + Date.now() + Math.random().toString(36).substring(2, 9);
  const payload = { [pk]: id, ...data };

  // 1. Instant optimistic in-memory update (0ms)
  const colMap = getColMap(colName);
  colMap.set(id, payload);
  notifyListeners(colName);

  // 2. Instant Realtime WebSocket broadcast (<20ms)
  broadcastMutation(colName, "insert", payload, id);

  // 3. Non-blocking background database persist
  backgroundInsert(colName, payload);

  return { colName, id };
}

// Safe throttled REST table fetch to hydrate in-memory cache
const lastFetchTime = new Map<string, number>();

async function fetchCollectionFromSupabase(colName: string) {
  const now = Date.now();
  const lastTime = lastFetchTime.get(colName) || 0;
  // Throttle queries to at most once every 6 seconds per collection to prevent upstream timeout
  if (now - lastTime < 6000) return;
  lastFetchTime.set(colName, now);

  try {
    let req = supabase.from(colName).select("*");
    if (colName === "messages") {
      req = req.order("timestamp", { ascending: false }).limit(80);
    } else if (colName === "presence" || colName === "voice_users") {
      req = req.limit(100);
    }
    const { data, error } = await req;
    if (!error && Array.isArray(data)) {
      const colMap = getColMap(colName);
      const pk = getPk(colName);
      data.forEach((row: any) => {
        const rowId = row[pk] || row.id || row.uid;
        if (rowId && !colMap.has(rowId)) {
          colMap.set(rowId, row);
        } else if (rowId && colMap.has(rowId)) {
          // Merge newer timestamp if available
          const existing = colMap.get(rowId);
          if ((row.timestamp || 0) >= (existing.timestamp || 0)) {
            colMap.set(rowId, { ...existing, ...row });
          }
        }
      });
      initialFetchDone.add(colName);
      notifyListeners(colName);
    } else if (error && error.code === "PGRST205") {
      window.dispatchEvent(new CustomEvent("supabase_missing_table", { detail: colName }));
    }
  } catch (err) {}
}

export async function getDocs(queryObj: any) {
  const colName = typeof queryObj === "string" ? queryObj : queryObj.colName;
  const constraints = queryObj?.constraints || [];

  // 1. Background non-blocking hydration if not yet done
  if (!initialFetchDone.has(colName)) {
    fetchCollectionFromSupabase(colName).catch(() => {});
  }

  // 2. Return current in-memory results instantly
  return applyQuery(colName, constraints);
}

export function onSnapshot(queryObj: any, onNext: (snap: any) => void, onError?: (err: any) => void) {
  const colName = typeof queryObj === "string" ? queryObj : queryObj.colName;
  const constraints = queryObj?.constraints || [];
  const listenerId = "listener_" + Math.random().toString(36).substring(2, 10);

  // 1. Ensure global Realtime WebSocket is connected
  getOrCreateGlobalChannel();

  // 2. Register active listener
  const listener = { id: listenerId, queryObj, onNext, onError };
  activeListeners.add(listener);

  // 3. Immediately emit current in-memory state (0ms instant response)
  const snap = applyQuery(colName, constraints);
  onNext(snap);

  // 4. Initial fetch from database to seed data
  fetchCollectionFromSupabase(colName).then(() => {
    const updatedSnap = applyQuery(colName, constraints);
    onNext(updatedSnap);
  }).catch(() => {});

  // 5. Periodic gentle background sync (every 12 seconds, not every 300ms) to avoid timeouts
  const syncInterval = setInterval(() => {
    fetchCollectionFromSupabase(colName).catch(() => {});
  }, 12000);

  return () => {
    clearInterval(syncInterval);
    activeListeners.delete(listener);
  };
}

export function handleFirestoreError(error: any, op: string, path: string) {
  if (!isNetworkOrTimeoutError(error)) {
    console.warn(`[Supabase] Operation ${op} on ${path}:`, error);
  }
}

export enum OperationType {
  GET = "get",
  LIST = "list",
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  WRITE = "write",
}

export function writeBatch() {
  const operations: Array<() => Promise<void>> = [];
  return {
    set: (ref: { colName: string; id: string }, data: any) => {
      operations.push(() => setDoc(ref, data));
    },
    update: (ref: { colName: string; id: string }, data: any) => {
      operations.push(() => updateDoc(ref, data));
    },
    delete: (ref: { colName: string; id: string }) => {
      operations.push(() => deleteDoc(ref));
    },
    commit: async () => {
      for (const op of operations) {
        await op();
      }
    }
  };
}
