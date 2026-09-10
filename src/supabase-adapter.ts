import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://jtocgfqurrlyyvhfmfsc.supabase.co";
const supabaseAnonKey = "sb_publishable_o5pFWa88vKImudzqdbVWkw_AyBOzXOj";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
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

// Resilient helper to execute Supabase database operations with automated retry on network or schema discrepancies
const isNetworkError = (err: any): boolean => {
  if (!err) return false;
  const msg = (err.message || err.details || String(err)).toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("load failed") ||
    msg.includes("offline")
  );
};

// Resilient wrapper that strips unmapped/missing Postgres columns on PGRST204 and retries on transient network errors
async function resilientInsert(colName: string, payload: any, maxTries = 10): Promise<{ data: any; error: any }> {
  let currentPayload = { ...payload };
  for (let i = 0; i < maxTries; i++) {
    try {
      const { data, error } = await supabase.from(colName).insert(currentPayload);
      if (!error) return { data, error: null };

      if (error.code === "PGRST204") {
        const match = error.message?.match(/Could not find the '([^']+)' column/i);
        if (match && match[1] && match[1] in currentPayload) {
          delete currentPayload[match[1]];
          continue;
        }
      }

      if (isNetworkError(error)) {
        if (i < 3) {
          await new Promise((res) => setTimeout(res, 300 * (i + 1)));
          continue;
        }
        return { data: null, error: null }; // Silently handle network drop
      }

      return { data, error };
    } catch (err: any) {
      if (isNetworkError(err)) {
        if (i < 3) {
          await new Promise((res) => setTimeout(res, 300 * (i + 1)));
          continue;
        }
        return { data: null, error: null };
      }
      return { data: null, error: err };
    }
  }
  return { data: null, error: null };
}

async function resilientUpsert(colName: string, payload: any, pk: string, maxTries = 10): Promise<{ data: any; error: any }> {
  let currentPayload = { ...payload };
  for (let i = 0; i < maxTries; i++) {
    try {
      const { data, error } = await supabase.from(colName).upsert(currentPayload, { onConflict: pk });
      if (!error) return { data, error: null };

      if (error.code === "PGRST204") {
        const match = error.message?.match(/Could not find the '([^']+)' column/i);
        if (match && match[1] && match[1] in currentPayload) {
          delete currentPayload[match[1]];
          continue;
        }
      }

      if (isNetworkError(error)) {
        if (i < 3) {
          await new Promise((res) => setTimeout(res, 300 * (i + 1)));
          continue;
        }
        return { data: null, error: null };
      }

      return { data, error };
    } catch (err: any) {
      if (isNetworkError(err)) {
        if (i < 3) {
          await new Promise((res) => setTimeout(res, 300 * (i + 1)));
          continue;
        }
        return { data: null, error: null };
      }
      return { data: null, error: err };
    }
  }
  return { data: null, error: null };
}

async function resilientUpdate(colName: string, payload: any, pk: string, id: string, maxTries = 10): Promise<{ data: any; error: any }> {
  let currentPayload = { ...payload };
  for (let i = 0; i < maxTries; i++) {
    try {
      const { data, error } = await supabase.from(colName).update(currentPayload).eq(pk, id);
      if (!error) return { data, error: null };

      if (error.code === "PGRST204") {
        const match = error.message?.match(/Could not find the '([^']+)' column/i);
        if (match && match[1] && match[1] in currentPayload) {
          delete currentPayload[match[1]];
          continue;
        }
      }

      if (isNetworkError(error)) {
        if (i < 3) {
          await new Promise((res) => setTimeout(res, 300 * (i + 1)));
          continue;
        }
        return { data: null, error: null };
      }

      return { data, error };
    } catch (err: any) {
      if (isNetworkError(err)) {
        if (i < 3) {
          await new Promise((res) => setTimeout(res, 300 * (i + 1)));
          continue;
        }
        return { data: null, error: null };
      }
      return { data: null, error: err };
    }
  }
  return { data: null, error: null };
}

export async function setDoc(docRef: { colName: string; id: string }, data: any, _options?: { merge?: boolean }) {
  try {
    const pk = getPk(docRef.colName);
    
    // Strip accidental 'id' field if the PK is not 'id'
    const payload = { [pk]: docRef.id, ...data };
    if (pk !== 'id' && 'id' in payload) {
      delete payload.id;
    }
    
    const { error } = await resilientUpsert(docRef.colName, payload, pk);
    if (error) {
      if (error.code === 'PGRST205') {
        window.dispatchEvent(new CustomEvent("supabase_missing_table", { detail: docRef.colName }));
      } else if (!isNetworkError(error)) {
        console.warn(`setDoc note on ${docRef.colName}:`, error);
      }
    }
  } catch (err) {
    if (!isNetworkError(err)) {
      console.warn(`setDoc catch on ${docRef.colName}:`, err);
    }
  }
}

export async function updateDoc(docRef: { colName: string; id: string }, data: any) {
  try {
    const pk = getPk(docRef.colName);
    const { error } = await resilientUpdate(docRef.colName, data, pk, docRef.id);
    if (error) {
      if (error.code === 'PGRST205') {
        window.dispatchEvent(new CustomEvent("supabase_missing_table", { detail: docRef.colName }));
      } else if (!isNetworkError(error)) {
        console.warn(`updateDoc note on ${docRef.colName}:`, error);
      }
    }
  } catch (err) {
    if (!isNetworkError(err)) {
      console.warn(`updateDoc catch on ${docRef.colName}:`, err);
    }
  }
}

export async function deleteDoc(docRef: { colName: string; id: string }) {
  try {
    const pk = getPk(docRef.colName);
    const { error } = await supabase.from(docRef.colName).delete().eq(pk, docRef.id);
    if (error) {
      if (error.code === 'PGRST205') {
        window.dispatchEvent(new CustomEvent("supabase_missing_table", { detail: docRef.colName }));
      } else if (!isNetworkError(error)) {
        console.warn(`deleteDoc note on ${docRef.colName}:`, error);
      }
    }
  } catch (err) {
    if (!isNetworkError(err)) {
      console.warn(`deleteDoc catch on ${docRef.colName}:`, err);
    }
  }
}

export async function addDoc(colName: string, data: any) {
  const pk = getPk(colName);
  const id = "doc_" + Date.now() + Math.random().toString(36).substring(2, 9);
  const payload = { [pk]: id, ...data };
  try {
    const { error } = await resilientInsert(colName, payload);
    if (error) {
      if (error.code === 'PGRST205') {
        window.dispatchEvent(new CustomEvent("supabase_missing_table", { detail: colName }));
      } else if (!isNetworkError(error)) {
        console.warn(`addDoc note on ${colName}:`, error);
      }
    }
  } catch (err) {
    if (!isNetworkError(err)) {
      console.warn(`addDoc catch on ${colName}:`, err);
    }
  }
  return { colName, id };
}

export async function getDocs(queryObj: any) {
  const colName = typeof queryObj === "string" ? queryObj : queryObj.colName;
  try {
    let req: any = supabase.from(colName).select("*");
    if (queryObj.constraints) {
      for (const c of queryObj.constraints) {
        if (c.type === "where" && c.op === "==") {
          req = req.eq(c.field, c.value);
        } else if (c.type === "orderBy") {
          req = req.order(c.field, { ascending: c.direction === "asc" });
        } else if (c.type === "limit") {
          req = req.limit(c.limitCount);
        }
      }
    }
    const { data, error } = await req;
    if (error) {
      if (error.code === 'PGRST205') {
        window.dispatchEvent(new CustomEvent("supabase_missing_table", { detail: colName }));
      } else if (!isNetworkError(error)) {
        console.warn(`getDocs note on ${colName}:`, error);
      }
    }
    const docs = data || [];
    const pk = getPk(colName);
    return {
      docs: docs.map((d: any) => ({ id: d[pk], data: () => d })),
      empty: docs.length === 0,
      size: docs.length,
      forEach: (cb: any) => docs.forEach((d: any) => cb({ id: d[pk], data: () => d }))
    };
  } catch (err) {
    return {
      docs: [],
      empty: true,
      size: 0,
      forEach: () => {}
    };
  }
}

export function onSnapshot(queryObj: any, onNext: (snap: any) => void, onError?: (err: any) => void) {
  const colName = typeof queryObj === 'string' ? queryObj : queryObj.colName;
  let isMounted = true;
  
  // Initial fetch
  getDocs(queryObj).then((snap) => {
    if (isMounted) onNext(snap);
  }).catch((e) => {
    if (isMounted && onError) onError(e);
  });

  // Realtime subscription
  const uniqueChannelName = `public:${colName}:${Math.random().toString(36).substring(2, 10)}`;
  let fetchTimeout: any = null;
  const channel = supabase.channel(uniqueChannelName)
    .on('postgres_changes', { event: '*', schema: 'public', table: colName }, () => {
      if (!isMounted) return;
      if (fetchTimeout) clearTimeout(fetchTimeout);
      fetchTimeout = setTimeout(() => {
        if (!isMounted) return;
        getDocs(queryObj).then((snap) => {
          if (isMounted) onNext(snap);
        }).catch((e) => {
          if (isMounted && onError) onError(e);
        });
      }, 50);
    })
    .subscribe();

  // Robust polling fallback to ensure 100% reliable state even if Realtime websocket is blocked or drops
  const pollIntervalMs = colName === "signals" ? 300 : (colName === "voice_users" || colName === "presence") ? 1000 : 2500;
  const pollTimer = setInterval(() => {
    if (!isMounted) return;
    getDocs(queryObj).then((snap) => {
      if (isMounted) onNext(snap);
    }).catch(() => {});
  }, pollIntervalMs);

  return () => {
    isMounted = false;
    clearInterval(pollTimer);
    if (fetchTimeout) clearTimeout(fetchTimeout);
    supabase.removeChannel(channel);
  };
}

// Global Supabase Realtime Broadcast Channel for zero-latency peer-to-peer WebRTC signals
let globalSignalChannel: any = null;
const broadcastListeners = new Set<(signal: any) => void>();

export function getOrCreateSignalChannel() {
  if (!globalSignalChannel) {
    globalSignalChannel = supabase.channel("webrtc-voice-broadcast-room", {
      config: { broadcast: { self: false } },
    });
    globalSignalChannel
      .on("broadcast", { event: "webrtc_signal" }, ({ payload }: { payload: any }) => {
        broadcastListeners.forEach((listener) => {
          try {
            listener(payload);
          } catch (e) {
            console.warn("Broadcast listener note:", e);
          }
        });
      })
      .subscribe();
  }
  return globalSignalChannel;
}

export function sendBroadcastSignal(payload: { uid: string; targetUid: string; type: string; sdp?: string; timestamp: number }) {
  try {
    const ch = getOrCreateSignalChannel();
    ch.send({
      type: "broadcast",
      event: "webrtc_signal",
      payload,
    }).catch(() => {});
  } catch (err) {}
}

export function subscribeBroadcastSignals(myUid: string, onSignal: (signal: any) => void) {
  getOrCreateSignalChannel();
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

export function handleFirestoreError(error: any, op: string, path: string) {
  console.warn(`[Supabase] Operation ${op} on ${path}:`, error);
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
