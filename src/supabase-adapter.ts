import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://jtocgfqurrlyyvhfmfsc.supabase.co";
const supabaseAnonKey = "sb_publishable_o5pFWa88vKImudzqdbVWkw_AyBOzXOj";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export const db = supabase;

export const cassandra = {
  storage: {
    upload: async (file: File, onProgress?: (p: number) => void): Promise<string> => {
      // Use local Express /api/upload as the storage backend for now
      // so we don't need a Supabase Storage bucket configured
      return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append("file", file);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/upload", true);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress) {
            onProgress((e.loaded / e.total) * 100);
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText).url);
            } catch {
              resolve(`/uploads/${file.name}`);
            }
          } else {
            reject(new Error("Upload failed"));
          }
        };
        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.send(formData);
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

export async function setDoc(docRef: { colName: string; id: string }, data: any, _options?: { merge?: boolean }) {
  const pk = getPk(docRef.colName);
  
  // Make sure we strip any accidental 'id' field if the PK is not 'id'
  const payload = { [pk]: docRef.id, ...data };
  if (pk !== 'id' && 'id' in payload) {
    delete payload.id;
  }
  
  const { error } = await supabase.from(docRef.colName).upsert(payload, { onConflict: pk });
  if (error) {
    console.error(`setDoc error on ${docRef.colName}:`, error);
    if (error.code === 'PGRST205' || error.code === 'PGRST204') window.dispatchEvent(new CustomEvent("supabase_missing_table", { detail: docRef.colName }));
  }
}

export async function updateDoc(docRef: { colName: string; id: string }, data: any) {
  const pk = getPk(docRef.colName);
  const { error } = await supabase.from(docRef.colName).update(data).eq(pk, docRef.id);
  if (error) {
    console.error(`updateDoc error on ${docRef.colName}:`, error);
    if (error.code === 'PGRST205' || error.code === 'PGRST204') window.dispatchEvent(new CustomEvent("supabase_missing_table", { detail: docRef.colName }));
  }
}

export async function deleteDoc(docRef: { colName: string; id: string }) {
  const pk = getPk(docRef.colName);
  const { error } = await supabase.from(docRef.colName).delete().eq(pk, docRef.id);
  if (error) {
    console.error(`deleteDoc error on ${docRef.colName}:`, error);
    if (error.code === 'PGRST205' || error.code === 'PGRST204') window.dispatchEvent(new CustomEvent("supabase_missing_table", { detail: docRef.colName }));
  }
}

export async function addDoc(colName: string, data: any) {
  const pk = getPk(colName);
  const id = "doc_" + Date.now() + Math.random().toString(36).substring(2, 9);
  const { error } = await supabase.from(colName).insert({ [pk]: id, ...data });
  if (error) {
    console.error(`addDoc error on ${colName}:`, error);
    if (error.code === 'PGRST205' || error.code === 'PGRST204') window.dispatchEvent(new CustomEvent("supabase_missing_table", { detail: colName }));
  }
  return { colName, id };
}

export async function getDocs(queryObj: any) {
  const colName = typeof queryObj === "string" ? queryObj : queryObj.colName;
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
    console.error(`getDocs error on ${colName}:`, error);
    if (error.code === 'PGRST205' || error.code === 'PGRST204') {
      window.dispatchEvent(new CustomEvent("supabase_missing_table", { detail: colName }));
    }
  }
  const docs = data || [];
  return {
    docs: docs.map((d: any) => ({ id: d.uid || d.id, data: () => d })),
    empty: docs.length === 0,
    size: docs.length,
    forEach: (cb: any) => docs.forEach((d: any) => cb({ id: d.uid || d.id, data: () => d }))
  };
}

export function onSnapshot(queryObj: any, onNext: (snap: any) => void, onError?: (err: any) => void) {
  const colName = typeof queryObj === 'string' ? queryObj : queryObj.colName;
  
  // Initial fetch
  getDocs(queryObj).then(onNext).catch((e) => {
    if (onError) onError(e);
  });

  // Realtime subscription - make channel name unique to avoid reusing the same channel object
  const uniqueChannelName = `public:${colName}:${Math.random().toString(36).substring(2, 10)}`;
  const channel = supabase.channel(uniqueChannelName)
    .on('postgres_changes', { event: '*', schema: 'public', table: colName }, () => {
      // Re-fetch to satisfy constraints (order, limit, where)
      getDocs(queryObj).then(onNext).catch((e) => {
        if (onError) onError(e);
      });
    })
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
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
