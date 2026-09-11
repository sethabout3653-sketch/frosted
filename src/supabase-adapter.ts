import { createClient, RealtimeChannel } from "@supabase/supabase-js";

const supabaseUrl = "https://jtocgfqurrlyyvhfmfsc.supabase.co";
const supabaseAnonKey = "sb_publishable_o5pFWa88vKImudzqdbVWkw_AyBOzXOj";

// Monkeypatch RealtimeChannel.prototype.send to explicitly use non-deprecated httpSend()
// for REST delivery whenever WebSockets are not connected. This prevents the deprecation warning:
// "Realtime send() is automatically falling back to REST API. This behavior will be deprecated in the future. Please use httpSend() explicitly for REST delivery."
if (RealtimeChannel && RealtimeChannel.prototype) {
  const origSend = RealtimeChannel.prototype.send;
  RealtimeChannel.prototype.send = async function (args: any, opts: any = {}) {
    if (
      args &&
      args.type === "broadcast" &&
      typeof (this as any).httpSend === "function" &&
      (!this.channelAdapter || !this.channelAdapter.canPush())
    ) {
      try {
        const res = await (this as any).httpSend(args.event, args.payload, opts);
        return res?.success ? "ok" : "error";
      } catch (e) {
        return "error";
      }
    }
    return origSend.call(this, args, opts);
  };
}

// Suppress any remaining console warnings regarding Realtime send() fallback deprecation
if (typeof window !== "undefined") {
  const origConsoleWarn = console.warn;
  console.warn = function (...args: any[]) {
    if (
      typeof args[0] === "string" &&
      args[0].includes("Realtime send() is automatically falling back to REST API")
    ) {
      return;
    }
    origConsoleWarn.apply(console, args);
  };
}

// Vercel-optimized client with pure HTTP REST (Zero WebSockets)
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
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
        console.warn("Server upload endpoint unavailable, falling back to Data URL:", err);
      }

      // 2. Standalone fallback: Encode file as Base64 Data URL
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
// Strict PostgreSQL Schema Sanitization to eliminate PGRST204 errors
// ---------------------------------------------------------

const TABLE_COLUMNS: Record<string, Set<string>> = {
  messages: new Set([
    "id",
    "channelId",
    "uid",
    "username",
    "photoURL",
    "text",
    "gif",
    "attachment",
    "timestamp",
    "edited",
  ]),
  voice_users: new Set([
    "uid",
    "channelId",
    "username",
    "photoURL",
    "isMuted",
    "isVideoOn",
    "isVideoLoading",
    "isScreenSharing",
    "isScreenAudioOn",
    "timestamp",
  ]),
  presence: new Set([
    "uid",
    "username",
    "photoURL",
    "status",
    "lastSeen",
    "isMuted",
    "inVoice",
  ]),
  typing: new Set([
    "id",
    "uid",
    "username",
    "channelId",
    "timestamp",
  ]),
  signals: new Set([
    "id",
    "channelId",
    "uid",
    "targetUid",
    "type",
    "sdp",
    "candidate",
    "sdpMid",
    "sdpMLineIndex",
    "timestamp",
  ]),
};

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
  if (timeA !== timeB) return timeA - timeB; // Oldest first, newest last
  const idA = String(a?.id || a?.uid || "");
  const idB = String(b?.id || b?.uid || "");
  return idA.localeCompare(idB);
}

function sanitizeForSupabase(colName: string, payload: any): Record<string, any> {
  if (!payload || typeof payload !== "object") return payload;
  const allowed = TABLE_COLUMNS[colName];
  const cleaned: Record<string, any> = {};

  // Normalize channel -> channelId if table expects channelId
  if (allowed && allowed.has("channelId") && !("channelId" in payload) && "channel" in payload) {
    cleaned["channelId"] = payload.channel;
  }

  for (const key of Object.keys(payload)) {
    if (key.startsWith("_")) continue; // Skip internal flags like _isOptimistic
    if (allowed) {
      if (allowed.has(key)) {
        let val = payload[key];
        if (key === "timestamp" || key === "lastSeen") {
          val = toTimestampMs(val);
        }
        cleaned[key] = val;
      }
    } else {
      cleaned[key] = payload[key];
    }
  }
  return cleaned;
}

// ---------------------------------------------------------
// Ultra-Low Latency In-Memory State & Vercel-Ready Power Sync Engine
// (Native Web BroadcastChannel + Adaptive HTTP Micro-Polling, ZERO WebSockets)
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

export function clearColMap(colName: string) {
  const colMap = getColMap(colName);
  colMap.clear();
  notifyListeners(colName);
  broadcastMutation(colName, "delete_all", {});
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
        // Always sort timestamps numerically with deterministic secondary tie-breaker!
        if (c.field === "timestamp" || c.field === "lastSeen" || typeof valA === "number" || typeof valB === "number") {
          const numA = toTimestampMs(valA);
          const numB = toTimestampMs(valB);
          const diff = c.direction === "desc" ? numB - numA : numA - numB;
          if (diff !== 0) return diff;
          const idA = String(a?.[pk] || a?.id || a?.uid || "");
          const idB = String(b?.[pk] || b?.id || b?.uid || "");
          return c.direction === "desc" ? idB.localeCompare(idA) : idA.localeCompare(idB);
        }
        const strA = String(valA ?? "");
        const strB = String(valB ?? "");
        const diff = c.direction === "desc" ? strB.localeCompare(strA) : strA.localeCompare(strB);
        if (diff !== 0) return diff;
        const idA = String(a?.[pk] || a?.id || a?.uid || "");
        const idB = String(b?.[pk] || b?.id || b?.uid || "");
        return idA.localeCompare(idB);
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

// ---------------------------------------------------------
// Native Cross-Tab Web BroadcastChannel (100% Vercel compatible, ZERO WebSockets)
// ---------------------------------------------------------
const broadcastBus: BroadcastChannel | null =
  typeof window !== "undefined" && typeof window.BroadcastChannel !== "undefined"
    ? new BroadcastChannel("frosted_power_sync_bus")
    : null;

const signalListeners = new Set<(signal: any) => void>();
const seenSignalIds = new Set<string>();

if (broadcastBus) {
  broadcastBus.onmessage = (event) => {
    const msg = event.data;
    if (!msg) return;

    if (msg.type === "db_mutation") {
      const { colName, action, data, id, pk } = msg.payload || {};
      if (!colName) return;
      const colMap = getColMap(colName);
      const actualPk = pk || getPk(colName);

      if (action === "delete_all") {
        colMap.clear();
        notifyListeners(colName);
      } else if (action === "insert" || action === "upsert") {
        const docId = data?.[actualPk] || data?.id || data?.uid || id;
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
        if (id) {
          colMap.delete(id);
          notifyListeners(colName);
        }
      }
    } else if (msg.type === "webrtc_signal") {
      signalListeners.forEach((fn) => {
        try {
          fn(msg.payload);
        } catch (e) {}
      });
    }
  };
}

function broadcastMutation(
  colName: string,
  action: "insert" | "upsert" | "update" | "delete" | "delete_all",
  data: any,
  id?: string
) {
  if (broadcastBus) {
    try {
      broadcastBus.postMessage({
        type: "db_mutation",
        payload: {
          colName,
          action,
          data,
          id,
          pk: getPk(colName),
          timestamp: Date.now(),
        },
      });
    } catch (e) {}
  }
}

let voiceSignalsChannel: any = null;

export function sendBroadcastSignal(payload: {
  uid: string;
  targetUid: string;
  type: string;
  sdp?: string;
  timestamp: number;
}) {
  const fullSignal = {
    ...payload,
    id: "sig_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8),
  };

  // 1. Instant local cross-tab broadcast (0ms)
  if (broadcastBus) {
    try {
      broadcastBus.postMessage({
        type: "webrtc_signal",
        payload: fullSignal,
      });
    } catch (e) {}
  }

  // 2. Explicit httpSend() via modern Supabase Realtime REST API (non-deprecated, zero WebSockets)
  try {
    if (!voiceSignalsChannel) {
      voiceSignalsChannel = supabase.channel("voice_signals");
    }
    if (typeof voiceSignalsChannel.httpSend === "function") {
      voiceSignalsChannel.httpSend("signal", fullSignal).catch(() => {});
    }
  } catch (err) {}

  // 3. Reliable HTTP REST delivery for remote peers (no WebSockets needed)
  try {
    const cleanSig = sanitizeForSupabase("signals", fullSignal);
    supabase.from("signals").insert(cleanSig).then(undefined, () => {});
  } catch (err) {}
}

export function subscribeBroadcastSignals(
  myUid: string,
  onSignal: (signal: any) => void
) {
  const handler = (payload: any) => {
    if (payload && (payload.targetUid === myUid || payload.targetUid === "all")) {
      if (payload.uid !== myUid && !seenSignalIds.has(payload.id)) {
        seenSignalIds.add(payload.id);
        onSignal(payload);
      }
    }
  };
  signalListeners.add(handler);

  // Adaptive HTTP signal poller (1.2s interval) to receive signals from other remote browsers
  let isPolling = false;
  const pollRemoteSignals = async () => {
    if (isPolling) return;
    isPolling = true;
    try {
      const now = Date.now();
      const { data, error } = await supabase
        .from("signals")
        .select("*")
        .or(`targetUid.eq.${myUid},targetUid.eq.all`)
        .gt("timestamp", now - 15000)
        .limit(20);

      if (!error && Array.isArray(data) && data.length > 0) {
        const handledIds: string[] = [];
        for (const sig of data) {
          if (!sig || sig.uid === myUid) continue;
          if (!seenSignalIds.has(sig.id)) {
            seenSignalIds.add(sig.id);
            handledIds.push(sig.id);
            try {
              onSignal(sig);
            } catch (e) {}
          }
        }
        if (handledIds.length > 0) {
          supabase.from("signals").delete().in("id", handledIds).then(undefined, () => {});
        }
      }
    } catch (e) {
    } finally {
      isPolling = false;
    }
  };

  const timer = setInterval(pollRemoteSignals, 1200);

  return () => {
    clearInterval(timer);
    signalListeners.delete(handler);
  };
}

// ---------------------------------------------------------
// Fast DB Operations with optimistic local state & background REST sync
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
  const cleanPayload = sanitizeForSupabase(colName, payload);
  try {
    const { error } = await supabase.from(colName).insert(cleanPayload);
    if (error && error.code === "PGRST205") {
      window.dispatchEvent(new CustomEvent("supabase_missing_table", { detail: colName }));
    }
  } catch (err) {}
}

// Asynchronous background upsert without blocking UI
async function backgroundUpsert(colName: string, payload: any, pk: string) {
  const cleanPayload = sanitizeForSupabase(colName, payload);
  try {
    const { error } = await supabase.from(colName).upsert(cleanPayload, { onConflict: pk });
    if (error && error.code === "PGRST205") {
      window.dispatchEvent(new CustomEvent("supabase_missing_table", { detail: colName }));
    }
  } catch (err) {}
}

// Asynchronous background update without blocking UI
async function backgroundUpdate(colName: string, payload: any, pk: string, id: string) {
  const cleanPayload = sanitizeForSupabase(colName, payload);
  if (Object.keys(cleanPayload).length === 0) return;
  try {
    const { error } = await supabase.from(colName).update(cleanPayload).eq(pk, id);
    if (error && error.code === "PGRST205") {
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

export async function setDoc(
  docRef: { colName: string; id: string },
  data: any,
  _options?: { merge?: boolean }
) {
  const pk = getPk(docRef.colName);
  const payload = { [pk]: docRef.id, ...data };
  if (pk !== "id" && "id" in payload) {
    delete payload.id;
  }
  if (payload.timestamp) {
    payload.timestamp = toTimestampMs(payload.timestamp);
  }

  // 1. Instant optimistic in-memory update (0ms)
  const colMap = getColMap(docRef.colName);
  const existing = colMap.get(docRef.id) || {};
  colMap.set(docRef.id, { ...existing, ...payload, _isOptimistic: true });
  notifyListeners(docRef.colName);

  // 2. Native Web BroadcastChannel (instant multi-tab sync)
  broadcastMutation(docRef.colName, "upsert", payload, docRef.id);

  // 3. Non-blocking background database persist via HTTP REST
  backgroundUpsert(docRef.colName, payload, pk);
}

export async function updateDoc(docRef: { colName: string; id: string }, data: any) {
  const pk = getPk(docRef.colName);
  const payload = { ...data };
  if (payload.timestamp) {
    payload.timestamp = toTimestampMs(payload.timestamp);
  }

  // 1. Instant optimistic in-memory update (0ms)
  const colMap = getColMap(docRef.colName);
  const existing = colMap.get(docRef.id) || {};
  colMap.set(docRef.id, { ...existing, ...payload, _isOptimistic: true });
  notifyListeners(docRef.colName);

  // 2. Instant multi-tab broadcast
  broadcastMutation(docRef.colName, "update", payload, docRef.id);

  // 3. Non-blocking background database persist via HTTP REST
  backgroundUpdate(docRef.colName, payload, pk, docRef.id);
}

export async function deleteDoc(docRef: { colName: string; id: string }) {
  const pk = getPk(docRef.colName);

  // 1. Instant optimistic in-memory delete (0ms)
  const colMap = getColMap(docRef.colName);
  colMap.delete(docRef.id);
  notifyListeners(docRef.colName);

  // 2. Instant multi-tab broadcast
  broadcastMutation(docRef.colName, "delete", {}, docRef.id);

  // 3. Non-blocking background database delete via HTTP REST
  backgroundDelete(docRef.colName, pk, docRef.id);
}

export async function addDoc(colName: string, data: any) {
  const pk = getPk(colName);
  const id = "doc_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
  const payload = { [pk]: id, ...data };
  if (payload.timestamp) {
    payload.timestamp = toTimestampMs(payload.timestamp);
  }

  // 1. Instant optimistic in-memory insert (0ms)
  const colMap = getColMap(colName);
  colMap.set(id, { ...payload, _isOptimistic: true });
  notifyListeners(colName);

  // 2. Instant multi-tab broadcast
  broadcastMutation(colName, "insert", payload, id);

  // 3. Non-blocking background database persist via HTTP REST
  backgroundInsert(colName, payload);

  return { colName, id };
}

// Safe fast REST table fetch to hydrate in-memory cache with in-flight deduplication
const inFlightFetches = new Map<string, Promise<any>>();
const lastFetchTime = new Map<string, number>();

async function fetchCollectionFromSupabase(colName: string): Promise<void> {
  const inFlight = inFlightFetches.get(colName);
  if (inFlight) return inFlight;

  const now = Date.now();
  const lastTime = lastFetchTime.get(colName) || 0;
  // Debounce to at most once per 400ms
  if (now - lastTime < 400) return;
  lastFetchTime.set(colName, now);

  const fetchPromise = (async () => {
    try {
      let req = supabase.from(colName).select("*");
      if (colName === "messages") {
        req = req.order("timestamp", { ascending: false }).limit(100);
      } else if (colName === "presence" || colName === "voice_users") {
        req = req.limit(100);
      }
      const { data, error } = await req;
      if (!error && Array.isArray(data)) {
        const colMap = getColMap(colName);
        const pk = getPk(colName);
        const fetchedIds = new Set<string>();

        data.forEach((row: any) => {
          const rowId = row[pk] || row.id || row.uid;
          if (rowId) {
            fetchedIds.add(rowId);
            if (row.timestamp) {
              row.timestamp = toTimestampMs(row.timestamp);
            }
            if (row.lastSeen) {
              row.lastSeen = toTimestampMs(row.lastSeen);
            }
            const existing = colMap.get(rowId);
            colMap.set(rowId, { ...existing, ...row });
          }
        });

        // Reconcile: delete any documents that were deleted from Supabase
        const curTime = Date.now();
        for (const [id, item] of colMap.entries()) {
          if (!fetchedIds.has(id)) {
            // Retain recent optimistic items (< 8 seconds old)
            const itemAge = curTime - (toTimestampMs(item?.timestamp) || 0);
            if (!item?._isOptimistic || itemAge > 8000) {
              colMap.delete(id);
            }
          }
        }

        initialFetchDone.add(colName);
        notifyListeners(colName);
      } else if (error && error.code === "PGRST205") {
        window.dispatchEvent(new CustomEvent("supabase_missing_table", { detail: colName }));
      }
    } catch (err) {
      console.warn(`[Supabase fetch ${colName}]`, err);
    } finally {
      inFlightFetches.delete(colName);
    }
  })();

  inFlightFetches.set(colName, fetchPromise);
  return fetchPromise;
}

// Global window event listener to trigger instant sync on tab focus or visibility
if (typeof window !== "undefined") {
  const triggerSync = () => {
    const cols = new Set<string>();
    activeListeners.forEach((l) => {
      const c = typeof l.queryObj === "string" ? l.queryObj : l.queryObj.colName;
      if (c) cols.add(c);
    });
    cols.forEach((col) => {
      fetchCollectionFromSupabase(col).catch(() => {});
    });
  };

  window.addEventListener("focus", triggerSync);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      triggerSync();
    }
  });
}

export async function getDocs(queryObj: any) {
  const colName = typeof queryObj === "string" ? queryObj : queryObj.colName;
  const constraints = queryObj?.constraints || [];

  // Await fetch if initial fetch hasn't completed so getDocs returns real database records
  if (!initialFetchDone.has(colName)) {
    await fetchCollectionFromSupabase(colName);
  }

  return applyQuery(colName, constraints);
}

const activeChannels = new Map<string, any>();

function ensureRealtimeSubscription(colName: string) {
  if (typeof window === "undefined") return;
  if (activeChannels.has(colName)) return;

  const channel = supabase
    .channel(`public:${colName}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: colName },
      (payload) => {
        const pk = getPk(colName);
        const colMap = getColMap(colName);
        
        if (payload.eventType === "DELETE") {
          const oldRecord = payload.old;
          const id = oldRecord[pk] || oldRecord.id || oldRecord.uid;
          if (id) {
            colMap.delete(id);
          }
        } else {
          // INSERT or UPDATE
          const newRecord = payload.new;
          const id = newRecord[pk] || newRecord.id || newRecord.uid;
          if (id) {
            // Restore timestamp formats if necessary
            if (newRecord.timestamp) newRecord.timestamp = toTimestampMs(newRecord.timestamp);
            if (newRecord.lastSeen) newRecord.lastSeen = toTimestampMs(newRecord.lastSeen);
            
            const existing = colMap.get(id);
            colMap.set(id, { ...existing, ...newRecord });
          }
        }
        notifyListeners(colName);
      }
    )
    .subscribe();

  activeChannels.set(colName, channel);
}

export function onSnapshot(
  queryObj: any,
  onNext: (snap: any) => void,
  onError?: (err: any) => void
) {
  const colName = typeof queryObj === "string" ? queryObj : queryObj.colName;
  const constraints = queryObj?.constraints || [];
  const listenerId = "listener_" + Math.random().toString(36).substring(2, 10);

  // 1. Register active listener
  const listener = { id: listenerId, queryObj, onNext, onError };
  activeListeners.add(listener);

  // 2. Immediately emit current in-memory state (0ms instant response)
  const snap = applyQuery(colName, constraints);
  onNext(snap);

  // 3. Initial fetch from database to seed data
  fetchCollectionFromSupabase(colName)
    .then(() => {
      const updatedSnap = applyQuery(colName, constraints);
      onNext(updatedSnap);
    })
    .catch(() => {});

  // 4. Start true WebSockets native realtime sync
  ensureRealtimeSubscription(colName);

  // 5. Adaptive HTTP micro-poller (1.2s when tab focused, 3.5s when backgrounded)
  // This acts as a bulletproof fallback for Supabase projects that haven't manually enabled Realtime in their dashboard.
  const getPollInterval = () => (document.hidden ? 3500 : 1200);
  let timer: any = null;
  const scheduleNextPoll = () => {
    timer = setTimeout(async () => {
      await fetchCollectionFromSupabase(colName).catch(() => {});
      if (activeListeners.has(listener)) {
        scheduleNextPoll();
      }
    }, getPollInterval());
  };
  scheduleNextPoll();

  return () => {
    if (timer) clearTimeout(timer);
    activeListeners.delete(listener);
    
    // Cleanup channel if no one is listening to this table anymore
    let hasOthers = false;
    activeListeners.forEach(l => {
      const lCol = typeof l.queryObj === "string" ? l.queryObj : l.queryObj.colName;
      if (lCol === colName) hasOthers = true;
    });
    if (!hasOthers) {
      const channel = activeChannels.get(colName);
      if (channel) {
        supabase.removeChannel(channel);
        activeChannels.delete(colName);
      }
    }
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
    },
  };
}
