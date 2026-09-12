import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL || "";
const supabaseKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseKey);

export const cassandra = {
  storage: {
    upload: async (
      file: File,
      onProgress?: (p: number) => void
    ): Promise<{ url: string; filename: string; mimetype: string; size: number }> => {
      try {
        const ext = file.name.split('.').pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${ext}`;
        const { data, error } = await supabase.storage.from("uploads").upload(fileName, file);
        if (error) {
          console.warn("Storage upload failed (did you create the 'uploads' bucket?), falling back to local object URL", error);
          throw error;
        }
        const { data: publicUrlData } = supabase.storage.from("uploads").getPublicUrl(fileName);
        return {
          url: publicUrlData.publicUrl,
          filename: file.name,
          mimetype: file.type || "application/octet-stream",
          size: file.size,
        };
      } catch (err) {
        // Fallback to Blob URL if they didn't create the bucket
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

export const db = supabase;

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

export async function getDocs(queryObj: any) {
  const colName = typeof queryObj === "string" ? queryObj : queryObj.colName;
  const constraints = queryObj.constraints || [];
  
  let q: any = supabase.from(colName).select('*');
  
  for (const c of constraints) {
    if (c.type === 'where') {
      if (c.op === '==') q = q.eq(c.field, c.value);
      else if (c.op === '!=') q = q.neq(c.field, c.value);
      else if (c.op === '>') q = q.gt(c.field, c.value);
      else if (c.op === '<') q = q.lt(c.field, c.value);
      else if (c.op === 'in') q = q.in(c.field, c.value);
    } else if (c.type === 'orderBy') {
      q = q.order(c.field, { ascending: c.direction === 'asc' });
    } else if (c.type === 'limit') {
      q = q.limit(c.limitCount);
    }
  }
  
  const { data, error } = await q;
  if (error) {
    console.error("getDocs error:", error);
    return { docs: [], empty: true, size: 0, forEach: () => {} };
  }
  
  const pk = colName === "presence" || colName === "voice_users" ? "uid" : "id";
  const docs = (data || []).map((d: any) => ({
    id: d[pk] || d.id,
    data: () => d
  }));
  
  return {
    docs,
    empty: docs.length === 0,
    size: docs.length,
    forEach: (cb: any) => docs.forEach((d: any) => cb(d))
  };
}

export function onSnapshot(queryObj: any, callback: (snap: any) => void, errorCallback?: (err: any) => void) {
  const colName = typeof queryObj === "string" ? queryObj : queryObj.colName;
  
  let isActive = true;
  
  // Initial fetch
  getDocs(queryObj).then(snap => {
    if (isActive) callback(snap);
  });
  
  // Realtime subscription
  const channel = supabase.channel(`public:${colName}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: colName },
      () => {
        // Refetch on any change to this table
        if (isActive) {
          getDocs(queryObj).then(snap => {
            if (isActive) callback(snap);
          });
        }
      }
    )
    .subscribe();
    
  return () => {
    isActive = false;
    supabase.removeChannel(channel);
  };
}

export async function addDoc(colName: string, data: any) {
  const pk = colName === "presence" || colName === "voice_users" ? "uid" : "id";
  const id = data[pk] || `doc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  
  const finalData = { ...data };
  if (!finalData[pk]) finalData[pk] = id;
  
  const { error } = await supabase.from(colName).insert(finalData);
  if (error) throw error;
  
  return { id };
}

export async function setDoc(docRef: any, data: any, options?: { merge?: boolean }) {
  const pk = docRef.colName === "presence" || docRef.colName === "voice_users" ? "uid" : "id";
  const finalData = { ...data };
  finalData[pk] = docRef.id;
  
  // upsert
  const { error } = await supabase.from(docRef.colName).upsert(finalData);
  if (error) throw error;
}

export async function updateDoc(docRef: any, data: any) {
  const pk = docRef.colName === "presence" || docRef.colName === "voice_users" ? "uid" : "id";
  const { error } = await supabase.from(docRef.colName).update(data).eq(pk, docRef.id);
  if (error) throw error;
}

export async function deleteDoc(docRef: any) {
  const pk = docRef.colName === "presence" || docRef.colName === "voice_users" ? "uid" : "id";
  const { error } = await supabase.from(docRef.colName).delete().eq(pk, docRef.id);
  if (error) throw error;
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
  console.error(`Supabase Error (${op} - ${context || 'unknown'}):`, err);
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
  const operations: any[] = [];
  return {
    set: (ref: any, data: any, options: any) => {
      operations.push(() => setDoc(ref, data, options));
    },
    update: (ref: any, data: any) => {
      operations.push(() => updateDoc(ref, data));
    },
    delete: (ref: any) => {
      operations.push(() => deleteDoc(ref));
    },
    commit: async () => {
      for (const op of operations) {
        await op();
      }
    }
  };
}

export async function sendBroadcastSignal(signal: any) {
  await supabase.channel('webrtc_signals').send({
    type: 'broadcast',
    event: 'signal',
    payload: signal
  });
}

export function subscribeBroadcastSignals(
  uid: string,
  onSignal: (signal: any) => void
) {
  const channel = supabase.channel('webrtc_signals')
    .on(
      'broadcast',
      { event: 'signal' },
      (payload) => {
        const signal = payload.payload;
        if (signal && (signal.targetUid === uid || signal.targetUid === 'all') && signal.uid !== uid) {
          onSignal(signal);
        }
      }
    )
    .subscribe();
    
  return () => {
    supabase.removeChannel(channel);
  };
}
