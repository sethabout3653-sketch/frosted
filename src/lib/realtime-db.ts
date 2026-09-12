// Real-time Database Client SDK for Vercel Serverless SSE
// Lightweight, zero-dependency, and 100% resilient

import { useEffect, useState, useRef, useCallback } from "react";

export interface RealtimeChangeEvent<T = any> {
  op: "upsert" | "delete";
  path: string;
  id: string;
  data?: T;
  timestamp: number;
}

export interface SubscriptionCallbacks<T = any> {
  onSnapshot?: (data: Record<string, T>) => void;
  onChange?: (change: RealtimeChangeEvent<T>) => void;
  onError?: (error: any) => void;
}

export class RealtimeDB {
  private baseUrl: string;

  constructor(baseUrl: string = "") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  /**
   * Subscribe to live updates for a collection/path via Server-Sent Events (SSE).
   * Works reliably on Vercel without WebSockets.
   */
  subscribe<T = any>(path: string, callbacks: SubscriptionCallbacks<T>): () => void {
    const cleanPath = path.replace(/^\//, "");
    const url = `${this.baseUrl}/api/db/stream?path=${encodeURIComponent(cleanPath)}`;

    let eventSource: EventSource | null = null;
    let isSubscribed = true;

    const connect = () => {
      if (!isSubscribed) return;

      eventSource = new EventSource(url);

      eventSource.addEventListener("snapshot", (event) => {
        try {
          const snapshotData = JSON.parse(event.data);
          callbacks.onSnapshot?.(snapshotData);
        } catch (e) {
          callbacks.onError?.(e);
        }
      });

      eventSource.addEventListener("change", (event) => {
        try {
          const changeData: RealtimeChangeEvent<T> = JSON.parse(event.data);
          callbacks.onChange?.(changeData);
        } catch (e) {
          callbacks.onError?.(e);
        }
      });

      eventSource.onerror = (err) => {
        callbacks.onError?.(err);
        // Browser EventSource automatically reconnects with backoff
      };
    };

    connect();

    return () => {
      isSubscribed = false;
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };
  }

  /**
   * Write or update an arbitrary raw JSON document.
   */
  async set<T = any>(path: string, id: string, data: T): Promise<{ success: boolean; id: string; data: T }> {
    const cleanPath = path.replace(/^\//, "");
    const res = await fetch(`${this.baseUrl}/api/db/data`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: cleanPath, id, data }),
    });

    if (!res.ok) {
      throw new Error(`Failed to write to database: ${res.statusText}`);
    }

    return res.json();
  }

  /**
   * Query a single document or the entire collection.
   */
  async get<T = any>(path: string, id?: string): Promise<T> {
    const cleanPath = path.replace(/^\//, "");
    const query = new URLSearchParams({ path: cleanPath });
    if (id) query.set("id", id);

    const res = await fetch(`${this.baseUrl}/api/db/data?${query.toString()}`);
    if (!res.ok) {
      throw new Error(`Failed to query database: ${res.statusText}`);
    }

    const json = await res.json();
    return json.data;
  }

  /**
   * Delete a document.
   */
  async delete(path: string, id: string): Promise<{ success: boolean; id: string }> {
    const cleanPath = path.replace(/^\//, "");
    const query = new URLSearchParams({ path: cleanPath, id });

    const res = await fetch(`${this.baseUrl}/api/db/data?${query.toString()}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      throw new Error(`Failed to delete document: ${res.statusText}`);
    }

    return res.json();
  }
}

// Global default instance
export const realtimeDb = new RealtimeDB();

/**
 * React Hook: Bind any component state to a real-time path.
 */
export function useRealtimeCollection<T = any>(path: string) {
  const [data, setData] = useState<Record<string, T>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<any>(null);

  useEffect(() => {
    setIsLoading(true);
    setError(null);

    const unsubscribe = realtimeDb.subscribe<T>(path, {
      onSnapshot: (snapshot) => {
        setData(snapshot || {});
        setIsLoading(false);
      },
      onChange: (change) => {
        setData((prev) => {
          const next = { ...prev };
          if (change.op === "delete") {
            delete next[change.id];
          } else if (change.data !== undefined) {
            next[change.id] = change.data;
          }
          return next;
        });
      },
      onError: (err) => {
        setError(err);
      },
    });

    return () => {
      unsubscribe();
    };
  }, [path]);

  const setDoc = useCallback(
    (id: string, docData: T) => {
      return realtimeDb.set<T>(path, id, docData);
    },
    [path]
  );

  const deleteDoc = useCallback(
    (id: string) => {
      return realtimeDb.delete(path, id);
    },
    [path]
  );

  return { data, isLoading, error, setDoc, deleteDoc };
}
