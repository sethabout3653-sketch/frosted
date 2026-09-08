// Real-Time Firebase Drop-in Replacement with Zero Quota Limits & 0ms Latency
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): FirestoreErrorInfo {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: null,
      email: null,
    },
    operationType,
    path
  };
  console.warn(`Realtime [${operationType}] at '${path || 'unknown'}':`, errInfo.error);
  return errInfo;
}

export interface DocumentSnapshot<T = any> {
  id: string;
  ref: DocumentReference;
  data: () => T;
  exists: () => boolean;
}

export interface DocumentChange<T = any> {
  type: 'added' | 'modified' | 'removed';
  doc: DocumentSnapshot<T>;
}

export interface QuerySnapshot<T = any> {
  docs: DocumentSnapshot<T>[];
  empty: boolean;
  size: number;
  forEach: (callback: (doc: DocumentSnapshot<T>) => void) => void;
  docChanges: () => DocumentChange<T>[];
}

export interface CollectionReference {
  type: 'collection';
  path: string;
}

export interface DocumentReference {
  type: 'document';
  collectionPath: string;
  id: string;
}

export interface QueryConstraint {
  type: 'where' | 'orderBy' | 'limit';
  field?: string;
  op?: string;
  val?: any;
  direction?: 'asc' | 'desc';
  limitCount?: number;
}

export interface Query {
  type: 'query';
  collectionPath: string;
  constraints: QueryConstraint[];
}

type SnapshotCallback = (snapshot: QuerySnapshot) => void;
type ErrorCallback = (error: Error) => void;

class RealtimeClient {
  private ws: WebSocket | null = null;
  private isConnected = false;
  private reconnectTimeout: any = null;
  private listeners = new Map<string, Set<{ query: Query | CollectionReference; callback: SnapshotCallback; error?: ErrorCallback }>>();
  private dataStore = new Map<string, Map<string, any>>();
  private previousSnapshots = new Map<string, Map<string, any>>();
  private myUid: string | null = null;

  constructor() {
    this.initStore();
    this.connect();
  }

  private initStore() {
    this.dataStore.set('messages', new Map());
    this.dataStore.set('voice_users', new Map());
    this.dataStore.set('presence', new Map());
    this.dataStore.set('signals', new Map());

    // Hydrate from localStorage cache if available for instant UI rendering
    try {
      const cached = localStorage.getItem('lumiverse_cached_chat_messages');
      if (cached) {
        const msgs = JSON.parse(cached);
        const filtered = Array.isArray(msgs) ? msgs.filter((m: any) => m?.id !== 'welcome_msg_001' && m?.uid !== 'system') : [];
        const map = this.dataStore.get('messages')!;
        filtered.forEach((m: any) => map.set(m.id, m));
        localStorage.setItem('lumiverse_cached_chat_messages', JSON.stringify(filtered));
      }
    } catch (e) {}

    // Fetch initial REST snapshot as fast hydration fallback
    this.fetchInitialData('messages');
    this.fetchInitialData('voice_users');
    this.fetchInitialData('presence');
  }

  public setUid(uid: string) {
    this.myUid = uid;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'identify', uid }));
    }
  }

  private async fetchInitialData(collectionName: string) {
    try {
      const res = await fetch(`/api/realtime/${collectionName}`);
      if (res.ok) {
        const list = await res.json();
        const map = this.dataStore.get(collectionName) || new Map();
        list.forEach((item: any) => {
          if (item && item.id) {
            map.set(item.id, item);
          } else if (item && item.uid) {
            map.set(item.uid, item);
          }
        });
        this.dataStore.set(collectionName, map);
        this.notifyListeners(collectionName);
      }
    } catch (e) {}
  }

  private connect() {
    if (typeof window === 'undefined') return;

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        if (this.myUid) {
          this.ws?.send(JSON.stringify({ action: 'identify', uid: this.myUid }));
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          this.handleServerMessage(payload);
        } catch (err) {
          console.warn('WS message parse error:', err);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.isConnected = false;
      };
    } catch (err) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, 2000);
  }

  private handleServerMessage(msg: any) {
    const { type, collection: colName, data, doc, id } = msg;

    if (type === 'sync_collection') {
      const map = this.dataStore.get(colName) || new Map();
      map.clear();
      if (Array.isArray(data)) {
        data.forEach((item) => {
          const key = item.id || item.uid;
          if (key) map.set(key, item);
        });
      }
      this.dataStore.set(colName, map);
      this.notifyListeners(colName);
    } else if (type === 'add_doc' || type === 'set_doc' || type === 'update_doc') {
      const targetCol = colName;
      const map = this.dataStore.get(targetCol) || new Map();
      const key = doc.id || doc.uid;
      if (key) {
        map.set(key, doc);
      }
      this.dataStore.set(targetCol, map);
      this.notifyListeners(targetCol);
    } else if (type === 'delete_doc') {
      const map = this.dataStore.get(colName);
      if (map && id) {
        map.delete(id);
        this.notifyListeners(colName);
      }
    } else if (type === 'signal') {
      // Direct WebRTC signal for current user
      const signalsMap = this.dataStore.get('signals') || new Map();
      if (doc && doc.id) {
        signalsMap.set(doc.id, doc);
      }
      this.dataStore.set('signals', signalsMap);
      this.notifyListeners('signals');
    }
  }

  private notifyListeners(colName: string) {
    const set = this.listeners.get(colName);
    if (!set || set.size === 0) return;

    const rawMap = this.dataStore.get(colName) || new Map();
    const allDocs = Array.from(rawMap.values());

    for (const entry of set) {
      let filtered = [...allDocs];

      if (entry.query.type === 'query') {
        for (const constraint of entry.query.constraints) {
          if (constraint.type === 'where') {
            filtered = filtered.filter((d) => {
              if (constraint.op === '==') {
                return d[constraint.field!] === constraint.val;
              }
              return true;
            });
          } else if (constraint.type === 'orderBy') {
            const field = constraint.field!;
            const dir = constraint.direction === 'desc' ? -1 : 1;
            filtered.sort((a, b) => {
              const va = a[field] ?? 0;
              const vb = b[field] ?? 0;
              if (va < vb) return -1 * dir;
              if (va > vb) return 1 * dir;
              return 0;
            });
          } else if (constraint.type === 'limit') {
            if (constraint.limitCount && constraint.limitCount > 0) {
              filtered = filtered.slice(0, constraint.limitCount);
            }
          }
        }
      }

      const docSnapshots: DocumentSnapshot[] = filtered.map((d) => ({
        id: d.id || d.uid,
        ref: { type: 'document', collectionPath: colName, id: d.id || d.uid },
        data: () => ({ ...d }),
        exists: () => true,
      }));

      // Calculate doc changes (added, modified, removed)
      const prevMap = this.previousSnapshots.get(colName) || new Map();
      const currentDocMap = new Map<string, any>();
      filtered.forEach((d) => currentDocMap.set(d.id || d.uid, d));

      const changes: DocumentChange[] = [];
      currentDocMap.forEach((docData, docId) => {
        const snap: DocumentSnapshot = {
          id: docId,
          ref: { type: 'document', collectionPath: colName, id: docId },
          data: () => ({ ...docData }),
          exists: () => true,
        };
        if (!prevMap.has(docId)) {
          changes.push({ type: 'added', doc: snap });
        } else if (JSON.stringify(prevMap.get(docId)) !== JSON.stringify(docData)) {
          changes.push({ type: 'modified', doc: snap });
        }
      });

      prevMap.forEach((oldData, oldId) => {
        if (!currentDocMap.has(oldId)) {
          changes.push({
            type: 'removed',
            doc: {
              id: oldId,
              ref: { type: 'document', collectionPath: colName, id: oldId },
              data: () => ({ ...oldData }),
              exists: () => false,
            },
          });
        }
      });

      this.previousSnapshots.set(colName, currentDocMap);

      const snapshot: QuerySnapshot = {
        docs: docSnapshots,
        empty: docSnapshots.length === 0,
        size: docSnapshots.length,
        forEach: (cb) => docSnapshots.forEach(cb),
        docChanges: () => changes,
      };

      try {
        entry.callback(snapshot);
      } catch (err) {
        if (entry.error) entry.error(err as Error);
      }
    }
  }

  public subscribe(
    queryOrCol: Query | CollectionReference,
    callback: SnapshotCallback,
    error?: ErrorCallback
  ): () => void {
    const colName = queryOrCol.type === 'query' ? queryOrCol.collectionPath : queryOrCol.path;
    if (!this.listeners.has(colName)) {
      this.listeners.set(colName, new Set());
    }
    const entry = { query: queryOrCol, callback, error };
    this.listeners.get(colName)!.add(entry);

    // Immediately trigger with current cached state
    setTimeout(() => {
      this.notifyListeners(colName);
    }, 0);

    return () => {
      const set = this.listeners.get(colName);
      if (set) {
        set.delete(entry);
        if (set.size === 0) {
          this.listeners.delete(colName);
        }
      }
    };
  }

  public async addDocument(colPath: string, data: any): Promise<DocumentReference> {
    const docId = 'doc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    const fullDoc = { ...data, id: docId, timestamp: data.timestamp || Date.now() };

    // Optimistic local store
    const map = this.dataStore.get(colPath) || new Map();
    map.set(docId, fullDoc);
    this.dataStore.set(colPath, map);
    this.notifyListeners(colPath);

    // Send over WebSocket or REST fallback
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          action: 'add_doc',
          collection: colPath,
          id: docId,
          data: fullDoc,
        })
      );
    } else {
      fetch(`/api/realtime/${colPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullDoc),
      }).catch(() => {});
    }

    return { type: 'document', collectionPath: colPath, id: docId };
  }

  public async setDocument(
    docRef: DocumentReference,
    data: any,
    options?: { merge?: boolean }
  ): Promise<void> {
    const colPath = docRef.collectionPath;
    const docId = docRef.id;

    // Optimistic local update
    const map = this.dataStore.get(colPath) || new Map();
    const existing = options?.merge ? map.get(docId) || {} : {};
    const merged = { ...existing, ...data, id: docId, uid: docId };
    map.set(docId, merged);
    this.dataStore.set(colPath, map);
    this.notifyListeners(colPath);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          action: 'set_doc',
          collection: colPath,
          id: docId,
          data: merged,
          merge: options?.merge ?? false,
        })
      );
    } else {
      fetch(`/api/realtime/${colPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      }).catch(() => {});
    }
  }

  public async updateDocument(docRef: DocumentReference, data: any): Promise<void> {
    const colPath = docRef.collectionPath;
    const docId = docRef.id;

    // Optimistic local update
    const map = this.dataStore.get(colPath) || new Map();
    const existing = map.get(docId) || {};
    const updated = { ...existing, ...data, id: docId, uid: docId };
    map.set(docId, updated);
    this.dataStore.set(colPath, map);
    this.notifyListeners(colPath);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          action: 'update_doc',
          collection: colPath,
          id: docId,
          data,
        })
      );
    } else {
      fetch(`/api/realtime/${colPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      }).catch(() => {});
    }
  }

  public async deleteDocument(docRef: DocumentReference): Promise<void> {
    const colPath = docRef.collectionPath;
    const docId = docRef.id;

    // Optimistic local delete
    const map = this.dataStore.get(colPath);
    if (map) {
      map.delete(docId);
      this.notifyListeners(colPath);
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          action: 'delete_doc',
          collection: colPath,
          id: docId,
        })
      );
    } else {
      fetch(`/api/realtime/${colPath}/${docId}`, {
        method: 'DELETE',
      }).catch(() => {});
    }
  }

  public async getDocuments(queryOrCol: Query | CollectionReference): Promise<QuerySnapshot> {
    const colName = queryOrCol.type === 'query' ? queryOrCol.collectionPath : queryOrCol.path;
    const rawMap = this.dataStore.get(colName) || new Map();
    let filtered = Array.from(rawMap.values());

    if (queryOrCol.type === 'query') {
      for (const constraint of queryOrCol.constraints) {
        if (constraint.type === 'where') {
          filtered = filtered.filter((d) => {
            if (constraint.op === '==') {
              return d[constraint.field!] === constraint.val;
            }
            return true;
          });
        } else if (constraint.type === 'orderBy') {
          const field = constraint.field!;
          const dir = constraint.direction === 'desc' ? -1 : 1;
          filtered.sort((a, b) => {
            const va = a[field] ?? 0;
            const vb = b[field] ?? 0;
            if (va < vb) return -1 * dir;
            if (va > vb) return 1 * dir;
            return 0;
          });
        } else if (constraint.type === 'limit') {
          if (constraint.limitCount && constraint.limitCount > 0) {
            filtered = filtered.slice(0, constraint.limitCount);
          }
        }
      }
    }

    const docSnapshots: DocumentSnapshot[] = filtered.map((d) => ({
      id: d.id || d.uid,
      ref: { type: 'document', collectionPath: colName, id: d.id || d.uid },
      data: () => ({ ...d }),
      exists: () => true,
    }));

    return {
      docs: docSnapshots,
      empty: docSnapshots.length === 0,
      size: docSnapshots.length,
      forEach: (cb) => docSnapshots.forEach(cb),
      docChanges: () => [],
    };
  }
}

// Global client singleton
export const db = new RealtimeClient();

// Firebase Firestore-compatible Helper Functions
export function collection(_db: any, path: string): CollectionReference {
  return { type: 'collection', path };
}

export function doc(_db: any, pathOrCol: string | CollectionReference, ...segments: string[]): DocumentReference {
  if (typeof pathOrCol === 'string') {
    const parts = [pathOrCol, ...segments].filter(Boolean);
    const collectionPath = parts.slice(0, -1).join('/');
    const id = parts[parts.length - 1];
    return { type: 'document', collectionPath, id };
  } else {
    const id = segments[0];
    return { type: 'document', collectionPath: pathOrCol.path, id };
  }
}

export function query(colRef: CollectionReference, ...constraints: QueryConstraint[]): Query {
  return {
    type: 'query',
    collectionPath: colRef.path,
    constraints,
  };
}

export function where(field: string, op: string, val: any): QueryConstraint {
  return { type: 'where', field, op, val };
}

export function orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): QueryConstraint {
  return { type: 'orderBy', field, direction };
}

export function limit(count: number): QueryConstraint {
  return { type: 'limit', limitCount: count };
}

export function onSnapshot(
  queryOrCol: Query | CollectionReference,
  callback: (snapshot: QuerySnapshot) => void,
  error?: (error: Error) => void
): () => void {
  return db.subscribe(queryOrCol, callback, error);
}

export async function addDoc(colRef: CollectionReference, data: any): Promise<DocumentReference> {
  return db.addDocument(colRef.path, data);
}

export async function setDoc(
  docRef: DocumentReference,
  data: any,
  options?: { merge?: boolean }
): Promise<void> {
  return db.setDocument(docRef, data, options);
}

export async function updateDoc(docRef: DocumentReference, data: any): Promise<void> {
  return db.updateDocument(docRef, data);
}

export async function deleteDoc(docRef: DocumentReference): Promise<void> {
  return db.deleteDocument(docRef);
}

export async function getDocs(queryOrCol: Query | CollectionReference): Promise<QuerySnapshot> {
  return db.getDocuments(queryOrCol);
}

export function writeBatch(_db: any) {
  const operations: Array<() => Promise<void>> = [];
  return {
    update(docRef: DocumentReference, data: any) {
      operations.push(() => updateDoc(docRef, data));
      return this;
    },
    set(docRef: DocumentReference, data: any, options?: { merge?: boolean }) {
      operations.push(() => setDoc(docRef, data, options));
      return this;
    },
    delete(docRef: DocumentReference) {
      operations.push(() => deleteDoc(docRef));
      return this;
    },
    async commit(): Promise<void> {
      await Promise.all(operations.map((op) => op()));
    },
  };
}
