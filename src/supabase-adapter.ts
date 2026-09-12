import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { realtimeDb } from "./lib/realtime-db";

// Initialize Supabase client
const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL;
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY;

const isSupabaseConfigured = 
  supabaseUrl && 
  supabaseAnonKey && 
  supabaseUrl !== "https://placeholder.supabase.co" &&
  supabaseAnonKey !== "placeholder";

export const supabase: SupabaseClient = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder"
);

export const db = { name: isSupabaseConfigured ? "Supabase" : "LocalDB" };

// Storage Helper
export const cassandra = {
  storage: {
    upload: async (
      file: File,
      onProgress?: (p: number) => void
    ): Promise<{ url: string; filename: string; mimetype: string; size: number }> => {
      // Use Supabase Storage if configured, otherwise fallback to local upload
      if (supabaseUrl && supabaseAnonKey && supabaseUrl !== "https://placeholder.supabase.co") {
        const fileExt = file.name.split(".").pop();
        const fileName = `${Math.random()}.${fileExt}`;
        const filePath = `uploads/${fileName}`;

        const { data, error } = await supabase.storage
          .from("chat-assets")
          .upload(filePath, file, {
            cacheControl: "3600",
            upsert: false,
          });

        if (!error && data) {
          const { data: { publicUrl } } = supabase.storage
            .from("chat-assets")
            .getPublicUrl(filePath);
          
          return {
            url: publicUrl,
            filename: file.name,
            mimetype: file.type,
            size: file.size,
          };
        }
      }

      // Fallback to local server upload (matching existing logic)
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        const json = await res.json();
        if (json.url) return json;
      } catch (e) {}

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
  console.warn(`[Supabase] Error during ${op} on ${path}:`, error);
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

// Database Operations
export async function getDocs(queryObj: any) {
  const colName = typeof queryObj === "string" ? queryObj : queryObj.colName;
  const constraints = queryObj?.constraints || [];
  
  if (!colName) {
    console.error("[Supabase] getDocs called with missing collection name", queryObj);
    return { docs: [], forEach: () => {}, empty: true, size: 0 };
  }

  if (isSupabaseConfigured) {
    try {
      let q: any = supabase.from(colName).select("*");

      for (const c of constraints) {
        if (c.type === "where") {
          if (c.op === "==") q = q.eq(c.field, c.value);
          else if (c.op === "!=") q = q.neq(c.field, c.value);
          else if (c.op === ">") q = q.gt(c.field, c.value);
          else if (c.op === "<") q = q.lt(c.field, c.value);
        } else if (c.type === "orderBy") {
          q = q.order(c.field, { ascending: c.direction === "asc" });
        } else if (c.type === "limit") {
          // User requested "NO limits", so we ignore limit constraints if they are small
          if (c.limitCount > 0 && c.limitCount < 1000) {
            q = q.limit(1000); // Set a higher default
          } else {
            q = q.limit(c.limitCount);
          }
        }
      }

      const { data, error } = await q;
      if (!error) {
        return {
          docs: (data || []).map((d: any) => ({
            id: d.uid || d.id,
            data: () => d
          })),
          forEach: (cb: any) => (data || []).forEach((d: any) => cb({ id: d.uid || d.id, data: () => d })),
          empty: !data || data.length === 0,
          size: data?.length || 0
        };
      }
      console.warn("[Supabase] getDocs error, falling back to local:", error);
    } catch (e) {
      console.warn("[Supabase] getDocs exception, falling back to local:", e);
    }
  }

  // Local Fallback
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
    console.error("[Supabase] onSnapshot called with missing collection name", queryObj);
    return () => {};
  }

  // Initial fetch
  getDocs(queryObj).then(onNext).catch(console.error);

  if (isSupabaseConfigured) {
    // Subscribe to changes with a unique channel name to avoid "after subscribe" errors
    const channelId = `snapshot_${colName}_${Math.random().toString(36).slice(2, 9)}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: colName },
        () => {
          // Re-fetch everything to maintain the expected "snapshot" behavior
          getDocs(queryObj).then(onNext).catch(console.error);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  } else {
    // Local fallback for realtime
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
}

export async function setDoc(docRef: { colName: string; id: string }, data: any, _options?: { merge?: boolean }) {
  if (isSupabaseConfigured) {
    const pk = (docRef.colName === "presence" || docRef.colName === "voice_users") ? "uid" : "id";
    const { error } = await supabase
      .from(docRef.colName)
      .upsert({ [pk]: docRef.id, ...data }, { onConflict: pk });
    if (!error) return;
    console.warn("[Supabase] setDoc failed, falling back to local:", error);
  }
  await realtimeDb.set(docRef.colName, docRef.id, data);
}

export async function updateDoc(docRef: { colName: string; id: string }, data: any) {
  if (isSupabaseConfigured) {
    const pk = (docRef.colName === "presence" || docRef.colName === "voice_users") ? "uid" : "id";
    const { error } = await supabase
      .from(docRef.colName)
      .update(data)
      .eq(pk, docRef.id);
    if (!error) return;
    console.warn("[Supabase] updateDoc failed, falling back to local:", error);
  }
  const existing = await realtimeDb.get(docRef.colName, docRef.id);
  await realtimeDb.set(docRef.colName, docRef.id, { ...existing, ...data });
}

export async function deleteDoc(docRef: { colName: string; id: string }) {
  if (isSupabaseConfigured) {
    const pk = (docRef.colName === "presence" || docRef.colName === "voice_users") ? "uid" : "id";
    const { error } = await supabase
      .from(docRef.colName)
      .delete()
      .eq(pk, docRef.id);
    if (!error) return;
    console.warn("[Supabase] deleteDoc failed, falling back to local:", error);
  }
  await realtimeDb.delete(docRef.colName, docRef.id);
}

export async function addDoc(colName: string, data: any) {
  if (isSupabaseConfigured) {
    const { data: inserted, error } = await supabase
      .from(colName)
      .insert(data)
      .select()
      .single();
    if (!error && inserted) return { colName, id: inserted.id || inserted.uid };
    console.warn("[Supabase] addDoc failed, falling back to local:", error);
  }
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

// Signaling Compatibility (used for WebRTC)
const signalChannel = supabase.channel('realtime_signals');

export function sendBroadcastSignal(payload: any) {
  signalChannel.send({
    type: 'broadcast',
    event: 'signal',
    payload: { ...payload, id: payload.id || `sig_${Date.now()}` }
  });
}

export function subscribeBroadcastSignals(myUid: string, onSignal: (signal: any) => void) {
  const sub = signalChannel
    .on('broadcast', { event: 'signal' }, ({ payload }) => {
      if (payload.uid !== myUid && (payload.targetUid === myUid || payload.targetUid === 'all')) {
        onSignal(payload);
      }
    })
    .subscribe();

  return () => {
    supabase.removeChannel(sub);
  };
}
