import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export interface SupabaseQueryFilter {
  [key: string]: string;
}

export interface RealtimePayload<T = any> {
  eventType: "INSERT" | "UPDATE" | "DELETE" | "*";
  table: string;
  schema: string;
  new: T | null;
  old: T | null;
  record?: T | null;
}

export type RealtimeCallback<T = any> = (payload: RealtimePayload<T>) => void;

class RealtimeChannel {
  public name: string;
  private listeners: Array<{
    event: string;
    table?: string;
    filter?: string;
    callback: RealtimeCallback;
  }> = [];
  private eventSource: EventSource | null = null;
  private isSubscribed = false;

  constructor(name: string) {
    this.name = name;
  }

  public on(
    type: string,
    filterConfig: { event: string; schema?: string; table?: string; filter?: string },
    callback: RealtimeCallback
  ) {
    this.listeners.push({
      event: filterConfig.event || "*",
      table: filterConfig.table,
      filter: filterConfig.filter,
      callback,
    });
    return this;
  }

  public subscribe(callback?: (status: string) => void) {
    if (this.isSubscribed) {
      if (callback) callback("SUBSCRIBED");
      return this;
    }
    this.isSubscribed = true;

    try {
      this.eventSource = new EventSource("/api/db-realtime");

      this.eventSource.onopen = () => {
        if (callback) callback("SUBSCRIBED");
      };

      this.eventSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (!data || !data.table) return;

          for (const listener of this.listeners) {
            if (listener.table && listener.table !== data.table) continue;
            if (listener.event !== "*" && listener.event !== data.eventType) continue;

            // Check optional filter if provided (e.g. "receiver_id=eq.uid")
            if (listener.filter) {
              const [fKey, fValWithOp] = listener.filter.split("=");
              if (fKey && fValWithOp && fValWithOp.startsWith("eq.")) {
                const targetVal = fValWithOp.substring(3);
                const rec = data.new || data.record || data.old;
                if (!rec || String(rec[fKey]) !== targetVal) {
                  continue;
                }
              }
            }

            listener.callback(data);
          }
        } catch {
          // ignore keepalive or parse error
        }
      };

      this.eventSource.onerror = () => {
        // Will auto-reconnect via EventSource
      };
    } catch (err) {
      console.warn("Realtime EventSource error:", err);
    }

    return this;
  }

  public unsubscribe() {
    this.isSubscribed = false;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.listeners = [];
  }
}

class QueryBuilder<T = any> {
  private tableName: string;
  private queryParams: Record<string, string> = {};
  private operation: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private bodyData: any = null;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  public select(columns: string = "*") {
    this.operation = "select";
    this.queryParams["select"] = columns;
    return this;
  }

  public insert(values: any) {
    this.operation = "insert";
    this.bodyData = values;
    return this;
  }

  public upsert(values: any, options?: { onConflict?: string }) {
    this.operation = "upsert";
    this.bodyData = values;
    if (options?.onConflict) {
      this.queryParams["on_conflict"] = options.onConflict;
    }
    return this;
  }

  public update(values: any) {
    this.operation = "update";
    this.bodyData = values;
    return this;
  }

  public delete() {
    this.operation = "delete";
    return this;
  }

  public eq(column: string, value: any) {
    this.queryParams[column] = `eq.${value}`;
    return this;
  }

  public neq(column: string, value: any) {
    this.queryParams[column] = `neq.${value}`;
    return this;
  }

  public order(column: string, options?: { ascending?: boolean }) {
    this.queryParams["order"] = column;
    this.queryParams["ascending"] = String(options?.ascending ?? true);
    return this;
  }

  public limit(count: number) {
    this.queryParams["limit"] = String(count);
    return this;
  }

  private buildUrl(): string {
    const params = new URLSearchParams(this.queryParams);
    const queryString = params.toString();
    return `/api/db/${this.tableName}${queryString ? `?${queryString}` : ""}`;
  }

  // Thenable implementation so queries can be awaited directly: await supabase.from(...)...
  public async then<TResult1 = { data: T[] | null; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: T[] | null; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    try {
      const url = this.buildUrl();
      let res: Response;

      if (this.operation === "select") {
        res = await fetch(url, { method: "GET" });
      } else if (this.operation === "insert" || this.operation === "upsert") {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(this.bodyData),
        });
      } else if (this.operation === "update") {
        res = await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(this.bodyData),
        });
      } else if (this.operation === "delete") {
        res = await fetch(url, { method: "DELETE" });
      } else {
        res = await fetch(url);
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ error: res.statusText }));
        const result = { data: null, error: errJson.error || res.statusText };
        return onfulfilled ? onfulfilled(result) : (result as any);
      }

      const json = await res.json();
      const result = { data: json.data as T[], error: json.error || null };
      return onfulfilled ? onfulfilled(result) : (result as any);
    } catch (err: any) {
      if (onrejected) {
        return onrejected(err);
      }
      const errResult = { data: null, error: err.message || err };
      return onfulfilled ? onfulfilled(errResult) : (errResult as any);
    }
  }
}

class InternalSupabaseClient {
  private channels: Map<string, RealtimeChannel> = new Map();

  public from<T = any>(table: string) {
    return new QueryBuilder<T>(table);
  }

  public channel(name: string): RealtimeChannel {
    let chan = this.channels.get(name);
    if (!chan) {
      chan = new RealtimeChannel(name);
      this.channels.set(name, chan);
    }
    return chan;
  }

  public removeChannel(channel: RealtimeChannel) {
    channel.unsubscribe();
    this.channels.delete(channel.name);
  }
}

// Check for external Supabase configuration
const metaEnv = (import.meta as any).env || {};
const envSupabaseUrl = metaEnv.VITE_SUPABASE_URL;
const envSupabaseKey = metaEnv.VITE_SUPABASE_ANON_KEY;

const isExternalSupabaseConfigured =
  typeof envSupabaseUrl === "string" &&
  envSupabaseUrl.trim().startsWith("https://") &&
  typeof envSupabaseKey === "string" &&
  envSupabaseKey.trim().length > 10;

export const supabase: any = isExternalSupabaseConfigured
  ? createSupabaseClient(envSupabaseUrl.trim(), envSupabaseKey.trim())
  : new InternalSupabaseClient();

export default supabase;
