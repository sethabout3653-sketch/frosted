import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Initialize Supabase client
const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL;
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder"
);

export const db = { name: "Supabase" };

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
      q = q.limit(c.limitCount);
    }
  }

  const { data, error } = await q;
  if (error) throw error;

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
}

export async function setDoc(docRef: { colName: string; id: string }, data: any, _options?: { merge?: boolean }) {
  const pk = (docRef.colName === "presence" || docRef.colName === "voice_users") ? "uid" : "id";
  const { error } = await supabase
    .from(docRef.colName)
    .upsert({ [pk]: docRef.id, ...data }, { onConflict: pk });
  if (error) throw error;
}

export async function updateDoc(docRef: { colName: string; id: string }, data: any) {
  const pk = (docRef.colName === "presence" || docRef.colName === "voice_users") ? "uid" : "id";
  const { error } = await supabase
    .from(docRef.colName)
    .update(data)
    .eq(pk, docRef.id);
  if (error) throw error;
}

export async function deleteDoc(docRef: { colName: string; id: string }) {
  const pk = (docRef.colName === "presence" || docRef.colName === "voice_users") ? "uid" : "id";
  const { error } = await supabase
    .from(docRef.colName)
    .delete()
    .eq(pk, docRef.id);
  if (error) throw error;
}

export async function addDoc(colName: string, data: any) {
  const { data: inserted, error } = await supabase
    .from(colName)
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return { colName, id: inserted.id || inserted.uid };
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
