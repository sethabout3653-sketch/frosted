// Custom Real-Time Database Client Adapter
// 100% Self-Contained, Zero External Database Dependencies (No Supabase, No Firebase)
// Powered by Server-Sent Events (SSE), Local Multi-Tab Broadcast, and Disk-Backed In-Memory Store

export const cassandra = {
  storage: {
    upload: async (
      file: File,
      onProgress?: (p: number) => void
    ): Promise<{ url: string; filename: string; mimetype: string; size: number }> => {
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
            url: finalUrl,
            filename: origName,
            mimetype: origType,
            size: origSize,
          };
        }
      } catch (err) {
        console.warn("Server upload failed, falling back to local object URL:", err);
      }

      // Safe local blob fallback
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          resolve({
            url: reader.result as string,
            filename: file.name,
            mimetype: file.type || "application/octet-stream",
            size: file.size,
          });
        };
        reader.onerror = () => {
          const blobUrl = URL.createObjectURL(file);
          resolve({
            url: blobUrl,
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

// ---------------------------------------------------------
// Custom Real-Time In-Memory & Local Cache Store
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
// Native Cross-Tab Web BroadcastChannel & Server SSE Bridge
// ---------------------------------------------------------
const broadcastBus: BroadcastChannel | null =
  typeof window !== "undefined" && typeof window.BroadcastChannel !== "undefined"
    ? new BroadcastChannel("frosted_realtime_db_bus")
    : null;

const signalListeners = new Set<(signal: any) => void>();
const seenSignalIds = new Set<string>();

function handleIncomingDbMutation(colName: string, action: string, data: any, id?: string, pk?: string) {
  if (!colName) return;
  const colMap = getColMap(colName);
  const actualPk = pk || getPk(colName);

  if (action === "delete_all") {
    colMap.clear();
    notifyListeners(colName);
  } else if (action === "insert" || action === "upsert" || action === "set") {
    const docId = data?.[actualPk] || data?.id || data?.uid || id;
    if (docId) {
      if (colName === "voice_users") {
        const isSharing =
          data.isScreenSharing === true ||
          data.channelId === "screenshare" ||
          data.channelId === "screenshare:audio";
        data.isScreenSharing = isSharing;
        data.isScreenAudioOn =
          data.isScreenAudioOn === true || data.channelId === "screenshare:audio";
      }
      colMap.set(docId, data);
      notifyListeners(colName);
    }
  } else if (action === "update") {
    const docId = id || data?.[actualPk] || data?.uid;
    if (docId) {
      const existing = colMap.get(docId) || {};
      const merged = { ...existing, ...data };
      if (colName === "voice_users") {
        const isSharing =
          merged.isScreenSharing === true ||
          merged.channelId === "screenshare" ||
          merged.channelId === "screenshare:audio";
        merged.isScreenSharing = isSharing;
        merged.isScreenAudioOn =
          merged.isScreenAudioOn === true || merged.channelId === "screenshare:audio";
      }
      colMap.set(docId, merged);
      notifyListeners(colName);
    }
  } else if (action === "delete") {
    const docId = id || data?.[actualPk] || data?.uid;
    if (docId) {
      colMap.delete(docId);
      notifyListeners(colName);
    }
  }
}

function handleIncomingWebRTCSignal(payload: any) {
  if (!payload || !payload.id) return;
  if (seenSignalIds.has(payload.id)) return;
  seenSignalIds.add(payload.id);
  if (seenSignalIds.size > 1000) {
    const first = seenSignalIds.values().next().value;
    if (first) seenSignalIds.delete(first);
  }

  signalListeners.forEach((fn) => {
    try {
      fn(payload);
    } catch (e) {}
  });
}

if (broadcastBus) {
  broadcastBus.onmessage = (event) => {
    const msg = event.data;
    if (!msg) return;

    if (msg.type === "db_mutation") {
      const { colName, action, data, id, pk } = msg.payload || {};
      handleIncomingDbMutation(colName, action, data, id, pk);
    } else if (msg.type === "webrtc_signal") {
      handleIncomingWebRTCSignal(msg.payload);
    }
  };
}

// ---------------------------------------------------------
// WebTransport Protocol Engine & Client Integration
// ---------------------------------------------------------
let activeWebTransport: any = null;
let webTransportWriter: any = null;

async function initWebTransport() {
  if (typeof window === "undefined" || !("WebTransport" in window)) {
    console.log("[WebTransport] WebTransport constructor not found in browser. Utilizing SSE/HTTPS.");
    return;
  }

  try {
    const protocol = window.location.protocol === "https:" ? "https:" : "https:";
    const host = window.location.host;
    const url = `${protocol}//${host}/api/webtransport`;

    console.log("[WebTransport] Initiating handshake at endpoint:", url);
    const transport = new (window as any).WebTransport(url);
    await transport.ready;
    console.log("[WebTransport] QUIC Connection Handshake Successful!");
    activeWebTransport = transport;

    // Stream listener for incoming events
    (async () => {
      try {
        const reader = transport.datagrams.readable.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const text = new TextDecoder().decode(value);
          handleWebTransportIncomingPayload(text);
        }
      } catch (e) {}
    })();

    (async () => {
      try {
        const reader = transport.incomingUnidirectionalStreams.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          readWebTransportStream(value);
        }
      } catch (e) {}
    })();

    const stream = await transport.createUnidirectionalStream();
    webTransportWriter = stream.writable.getWriter();
  } catch (err) {
    console.log("[WebTransport] Active QUIC tunnel blocked or unsupported on route. Reverting to Optimized SSE pipeline.", err);
  }
}

async function readWebTransportStream(stream: any) {
  try {
    const reader = stream.readable.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      handleWebTransportIncomingPayload(text);
    }
  } catch (e) {}
}

function handleWebTransportIncomingPayload(text: string) {
  try {
    const msg = JSON.parse(text);
    if (msg.type === "change") {
      handleIncomingDbMutation(msg.collection, msg.op, msg.data, msg.id);
    } else if (msg.type === "webrtc_signal") {
      handleIncomingWebRTCSignal(msg.payload);
    }
  } catch (e) {}
}

initWebTransport();

// ---------------------------------------------------------
// Server-Sent Events (SSE) Real-Time Subscription
// ---------------------------------------------------------

let serverSSE: EventSource | null = null;
function initServerSSE() {
  if (typeof window === "undefined" || !("EventSource" in window)) return;
  if (serverSSE && serverSSE.readyState !== EventSource.CLOSED) return;

  try {
    serverSSE = new EventSource("/api/cassandra/stream");

    serverSSE.onmessage = (event) => {
      if (!event.data || event.data.startsWith(":")) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "change") {
          const { collection, op, id, data } = msg;
          handleIncomingDbMutation(collection, op, data, id);
        } else if (msg.type === "webrtc_signal") {
          handleIncomingWebRTCSignal(msg.payload);
        } else if (msg.type === "init") {
          if (msg.data && typeof msg.data === "object") {
            Object.entries(msg.data).forEach(([col, docs]: [string, any]) => {
              if (docs && typeof docs === "object") {
                const map = getColMap(col);
                Object.entries(docs).forEach(([dId, dVal]) => {
                  if (dVal && typeof dVal === "object") {
                    const existing = map.get(dId);
                    map.set(dId, { ...existing, ...dVal });
                  }
                });
                notifyListeners(col);
              }
            });
          }
        }
      } catch (e) {}
    };

    serverSSE.onerror = () => {
      // EventSource auto-reconnects natively
    };
  } catch (e) {}
}

initServerSSE();

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

async function serverWrite(op: string, colName: string, id: string, data: any) {
  if (webTransportWriter) {
    try {
      const payload = JSON.stringify({ type: "change", collection: colName, op, id, data });
      await webTransportWriter.write(new TextEncoder().encode(payload));
      return;
    } catch (e) {
      console.warn("[WebTransport] Write stream failed, falling back to HTTPS POST");
    }
  }

  try {
    await fetch("/api/cassandra/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op, collection: colName, id, data }),
    });
  } catch (e) {}
}

async function serverSendSignal(signal: any) {
  if (webTransportWriter) {
    try {
      const payload = JSON.stringify({ type: "webrtc_signal", payload: signal });
      await webTransportWriter.write(new TextEncoder().encode(payload));
      return;
    } catch (e) {
      console.warn("[WebTransport] Signal stream failed, falling back to HTTPS POST");
    }
  }

  try {
    await fetch("/api/webrtc/signal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signal),
    });
  } catch (e) {}
}

export function sendBroadcastSignal(payload: {
  id?: string;
  uid: string;
  targetUid: string;
  type: string;
  sdp?: string;
  candidate?: string;
  timestamp: number;
}) {
  const fullSignal = {
    ...payload,
    id: payload.id || ("sig_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8)),
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

  // 2. HTTP REST server push to our own backend
  serverSendSignal(fullSignal);
}

export function subscribeBroadcastSignals(
  myUid: string,
  onSignal: (signal: any) => void
) {
  const handledForThisListener = new Set<string>();

  const getSigKey = (p: any): string => {
    if (!p) return "";
    if (p.type === "candidate") {
      return `${p.uid}_cand_${p.candidate || p.sdp || ""}_${p.id || ""}`;
    }
    return p.id || `${p.uid}_${p.type}_${p.timestamp || ""}`;
  };

  const handler = (payload: any) => {
    if (payload && (payload.targetUid === myUid || payload.targetUid === "all")) {
      const key = getSigKey(payload);
      if (payload.uid !== myUid && key && !handledForThisListener.has(key)) {
        handledForThisListener.add(key);
        if (handledForThisListener.size > 1000) {
          const first = handledForThisListener.values().next().value;
          if (first) handledForThisListener.delete(first);
        }
        try {
          onSignal(payload);
        } catch (e) {}
      }
    }
  };
  signalListeners.add(handler);

  // Fast HTTP signal poller to receive signals across isolated devices
  let isPolling = false;
  let lastPollTs = Date.now() - 10000;

  const pollRemoteSignals = async () => {
    if (isPolling) return;
    isPolling = true;
    try {
      const sinceParam = Math.max(0, lastPollTs - 5000);
      const res = await fetch(`/api/webrtc/signals?uid=${encodeURIComponent(myUid)}&since=${sinceParam}`).catch(() => null);
      if (res && res.ok) {
        const json = await res.json().catch(() => null);
        if (json && Array.isArray(json.signals)) {
          lastPollTs = json.timestamp || Date.now();
          json.signals.forEach((sig: any) => {
            const key = getSigKey(sig);
            if (sig && sig.uid !== myUid && key && !handledForThisListener.has(key)) {
              handledForThisListener.add(key);
              if (handledForThisListener.size > 1000) {
                const first = handledForThisListener.values().next().value;
                if (first) handledForThisListener.delete(first);
              }
              try {
                onSignal(sig);
              } catch (e) {}
            }
          });
        }
      }
    } catch (e) {
    } finally {
      isPolling = false;
    }
  };

  const timer = setInterval(pollRemoteSignals, 300);
  pollRemoteSignals();

  return () => {
    clearInterval(timer);
    signalListeners.delete(handler);
  };
}

// ---------------------------------------------------------
// Fast DB Operations on Custom In-Memory + Disk Engine
// ---------------------------------------------------------

export async function setDoc(
  docRef: { colName: string; id: string },
  data: any,
  _options?: { merge?: boolean }
) {
  const pk = getPk(docRef.colName);
  const payload = { [pk]: docRef.id, ...data };
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

  // 3. Server write and SSE broadcast to all users
  serverWrite("set", docRef.colName, docRef.id, payload);
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

  // 3. Server write and SSE broadcast to all users
  serverWrite("update", docRef.colName, docRef.id, payload);
}

export async function deleteDoc(docRef: { colName: string; id: string }) {
  // 1. Instant optimistic in-memory delete (0ms)
  const colMap = getColMap(docRef.colName);
  colMap.delete(docRef.id);
  notifyListeners(docRef.colName);

  // 2. Instant multi-tab broadcast
  broadcastMutation(docRef.colName, "delete", {}, docRef.id);

  // 3. Server delete and SSE broadcast
  serverWrite("delete", docRef.colName, docRef.id, {});
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

  // 3. Server write and SSE broadcast
  serverWrite("set", colName, id, payload);

  return { colName, id };
}

// REST collection fetch to hydrate in-memory cache
const inFlightFetches = new Map<string, Promise<any>>();
const lastFetchTime = new Map<string, number>();

async function fetchCollectionFromDatabase(colName: string): Promise<void> {
  const inFlight = inFlightFetches.get(colName);
  if (inFlight) return inFlight;

  const now = Date.now();
  const lastTime = lastFetchTime.get(colName) || 0;
  if (now - lastTime < 300) return;
  lastFetchTime.set(colName, now);

  const fetchPromise = (async () => {
    try {
      const colMap = getColMap(colName);
      const pk = getPk(colName);
      const fetchedIds = new Set<string>();

      const serverRes = await fetch(`/api/cassandra/data?collection=${encodeURIComponent(colName)}`).catch(() => null);
      if (serverRes && serverRes.ok) {
        const serverDocs = await serverRes.json().catch(() => null);
        if (serverDocs && typeof serverDocs === "object") {
          Object.entries(serverDocs).forEach(([rowId, row]: [string, any]) => {
            if (row && typeof row === "object") {
              const actualId = row[pk] || row.id || row.uid || rowId;
              fetchedIds.add(actualId);
              if (row.timestamp) row.timestamp = toTimestampMs(row.timestamp);
              if (row.lastSeen) row.lastSeen = toTimestampMs(row.lastSeen);
              if (colName === "voice_users") {
                const isSharing =
                  row.isScreenSharing === true ||
                  row.channelId === "screenshare" ||
                  row.channelId === "screenshare:audio";
                row.isScreenSharing = isSharing;
                row.isScreenAudioOn =
                  row.isScreenAudioOn === true || row.channelId === "screenshare:audio";
              }
              const existing = colMap.get(actualId);
              colMap.set(actualId, { ...existing, ...row });
            }
          });
        }
      }

      // Reconcile expired transient records
      if (fetchedIds.size > 0) {
        const curTime = Date.now();
        for (const [id, item] of colMap.entries()) {
          if (!fetchedIds.has(id)) {
            const itemTs = toTimestampMs(item?.timestamp || item?.lastSeen) || 0;
            const itemAge = curTime - itemTs;
            const maxAge = (colName === "voice_users" || colName === "presence") ? 60000 : 8000;
            if (!item?._isOptimistic && itemAge > maxAge) {
              colMap.delete(id);
            }
          }
        }
      }

      initialFetchDone.add(colName);
      notifyListeners(colName);
    } catch (err) {
      console.warn(`[CustomDB fetch ${colName}]`, err);
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
      fetchCollectionFromDatabase(col).catch(() => {});
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

  if (!initialFetchDone.has(colName)) {
    await fetchCollectionFromDatabase(colName);
  }

  return applyQuery(colName, constraints);
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

  // 3. Initial fetch from custom database to seed data
  fetchCollectionFromDatabase(colName)
    .then(() => {
      const updatedSnap = applyQuery(colName, constraints);
      onNext(updatedSnap);
    })
    .catch(() => {});

  // 4. Background heartbeat poll (1.5s focused, 4s hidden) as backup for SSE
  const getPollInterval = () => (document.hidden ? 4000 : 1500);
  let timer: any = null;
  const scheduleNextPoll = () => {
    timer = setTimeout(async () => {
      await fetchCollectionFromDatabase(colName).catch(() => {});
      if (activeListeners.has(listener)) {
        scheduleNextPoll();
      }
    }, getPollInterval());
  };
  scheduleNextPoll();

  return () => {
    if (timer) clearTimeout(timer);
    activeListeners.delete(listener);
  };
}

export function handleFirestoreError(error: any, op: string, path: string) {
  console.warn(`[CustomDB] Operation ${op} on ${path}:`, error);
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

// Compatibility layer for any components expecting db or supabase
export const db: any = {
  name: "CustomRealtimeDB",
};

export const supabase: any = {
  from: (colName: string) => ({
    select: () => ({
      data: Array.from(getColMap(colName).values()),
      error: null,
    }),
    delete: () => ({
      eq: (key: string, val: any) => {
        getColMap(colName).delete(val);
        serverWrite("delete", colName, val, {});
        return { error: null };
      },
    }),
  }),
};
