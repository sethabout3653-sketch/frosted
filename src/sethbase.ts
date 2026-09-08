export const db = {};

export function collection(db: any, path: string) {
  return { path };
}

export function query(col: any, ...args: any[]) {
  return { ...col, constraints: args };
}
export function orderBy(field: string, direction = 'asc') {
  return { type: 'orderBy', field, direction };
}
export function limit(n: number) {
  return { type: 'limit', n };
}
export function where(field: string, op: string, value: any) {
  return { type: 'where', field, op, value };
}
export function doc(dbOrCol: any, pathStr: string, idStr?: string) {
  if (dbOrCol?.path) {
    return { path: `${dbOrCol.path}/${pathStr}`, id: pathStr };
  }
  if (idStr) {
    return { path: `${pathStr}/${idStr}`, id: idStr };
  }
  return { path: pathStr, id: pathStr.split('/').pop() };
}

const POLLING_INTERVAL = 1500;

function applyConstraints(json: any[], constraints: any[]) {
  if (!constraints) return json;
  let hasOrderBy = false;
  let orderByField = '';
  let orderByDir = 'asc';
  let limitN = 0;

  for (const c of constraints) {
    if (c.type === 'where') {
      json = json.filter((item: any) => {
        if (c.op === '==') return item[c.field] === c.value;
        if (c.op === '!=') return item[c.field] !== c.value;
        if (c.op === 'array-contains') return item[c.field]?.includes(c.value);
        return true;
      });
    } else if (c.type === 'orderBy') {
      hasOrderBy = true;
      orderByField = c.field;
      orderByDir = c.direction;
    } else if (c.type === 'limit') {
      limitN = c.n;
    }
  }

  if (hasOrderBy) {
    json.sort((a: any, b: any) => {
      const vA = a[orderByField] || 0;
      const vB = b[orderByField] || 0;
      if (vA < vB) return orderByDir === 'asc' ? -1 : 1;
      if (vA > vB) return orderByDir === 'asc' ? 1 : -1;
      return 0;
    });
  }

  if (limitN > 0) {
    json = json.slice(0, limitN);
  }
  
  return json;
}

export function onSnapshot(q: any, onNext: (snap: any) => void, onError?: (e: any) => void) {
  let isUnsubscribed = false;
  let lastData = '';
  let lastDocsMap = new Map();

  const poll = async () => {
    if (isUnsubscribed) return;
    try {
      const res = await fetch(`/api/sethbase?path=${q.path}`, { cache: 'no-store' });
      if (res.ok) {
        const text = await res.text();
        if (text.startsWith('<')) {
           // Skip HTML responses (likely vite dev server fallback during restarts)
           throw new Error('Failed to fetch (HTML fallback)');
        }
        let json = JSON.parse(text);
        json = applyConstraints(json, q.constraints);
        
        const jsonString = JSON.stringify(json);
        if (jsonString !== lastData) {
          lastData = jsonString;
          
          const currentDocsMap = new Map();
          const docs = json.map((docData: any) => {
             const docSnap = {
                id: docData.id || docData._id,
                data: () => docData,
                ref: { path: `${q.path}/${docData.id || docData._id}` }
             };
             currentDocsMap.set(docSnap.id, docSnap);
             return docSnap;
          });

          const changes: any[] = [];
          for (const doc of docs) {
             if (!lastDocsMap.has(doc.id)) {
                 changes.push({ type: 'added', doc });
             } else {
                 const oldDocStr = JSON.stringify(lastDocsMap.get(doc.id).data());
                 const newDocStr = JSON.stringify(doc.data());
                 if (oldDocStr !== newDocStr) {
                     changes.push({ type: 'modified', doc });
                 }
             }
          }
          for (const [id, oldDoc] of lastDocsMap.entries()) {
             if (!currentDocsMap.has(id)) {
                 changes.push({ type: 'removed', doc: oldDoc });
             }
          }
          lastDocsMap = currentDocsMap;

          const snapshot = {
            docs,
            empty: docs.length === 0,
            size: docs.length,
            forEach: (cb: any) => docs.forEach(cb),
            docChanges: () => changes
          };
          onNext(snapshot);
        }
      }
    } catch (e: any) {
      if (onError && e?.message !== 'Failed to fetch' && e?.message !== 'Failed to fetch (HTML fallback)') {
         onError(e);
      }
    }
    if (!isUnsubscribed) {
      setTimeout(poll, POLLING_INTERVAL);
    }
  };
  poll();
  return () => { isUnsubscribed = true; };
}

export async function getDocs(q: any) {
  const res = await fetch(`/api/sethbase?path=${q.path}`, { cache: 'no-store' });
  const text = await res.text();
  if (text.startsWith('<')) throw new Error('Failed to fetch (HTML fallback)');
  let json = JSON.parse(text);
  json = applyConstraints(json, q.constraints);
  
  const docs = json.map((docData: any) => ({
    id: docData.id || docData._id,
    data: () => docData,
    ref: { path: `${q.path}/${docData.id || docData._id}` }
  }));
  return {
    docs,
    empty: docs.length === 0,
    size: docs.length,
    forEach: (cb: any) => docs.forEach(cb)
  };
}

export async function addDoc(col: any, data: any) {
  const res = await fetch(`/api/sethbase?path=${col.path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const text = await res.text();
  if (text.startsWith('<')) throw new Error('Failed to fetch (HTML fallback)');
  const json = JSON.parse(text);
  return { id: json.id, ref: { path: `${col.path}/${json.id}` } };
}

export async function setDoc(docRef: any, data: any, options?: any) {
  await fetch(`/api/sethbase/${docRef.path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, options })
  });
}

export async function updateDoc(docRef: any, data: any) {
  await fetch(`/api/sethbase/${docRef.path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

export async function deleteDoc(docRef: any) {
  await fetch(`/api/sethbase/${docRef.path}`, {
    method: 'DELETE'
  });
}

export function writeBatch(db: any) {
  const ops: any[] = [];
  return {
    set(docRef: any, data: any, options?: any) {
      ops.push({ type: 'set', path: docRef.path, data, options });
    },
    update(docRef: any, data: any) {
      ops.push({ type: 'update', path: docRef.path, data });
    },
    delete(docRef: any) {
      ops.push({ type: 'delete', path: docRef.path });
    },
    async commit() {
      await fetch(`/api/sethbase_batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ops })
      });
    }
  };
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}
export function handleSethbaseError(error: any, operationType: OperationType, path: string | null) {
  if (error?.message === 'Failed to fetch' || error?.message === 'Failed to fetch (HTML fallback)') return;
  if (error?.message?.includes('Unexpected token') || error?.message?.includes('is not valid JSON')) return;
  console.error("Sethbase error via API: ", error);
}
