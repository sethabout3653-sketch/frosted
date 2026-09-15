// Real-time WebSocket Client with Vercel Serverless Lifecycle Handling
// Features:
// 1. Proactive 4m30s rolling reconnect (beats Vercel 5-minute hard disconnect)
// 2. Exponential backoff with jitter on dropped connections
// 3. Offline message queuing & retransmission
// 4. Online/offline window visibility event hooks
// 5. Automatic state re-registration upon reconnection

export type WSMessageCallback = (msg: any) => void;

class ManagedWebSocketClient {
  private ws: WebSocket | null = null;
  private subscribers = new Set<WSMessageCallback>();
  private reconnectTimeout: any = null;
  private pingInterval: any = null;
  private lifetimeRefreshTimer: any = null;
  private myUid: string | null = null;
  private isConnecting = false;
  private retryAttempts = 0;
  private outgoingQueue: any[] = [];
  
  // Vercel hard limit is 5m (300s). We refresh cleanly at 4m30s (270s) before any hard abort.
  private readonly MAX_CONNECTION_LIFETIME_MS = 270 * 1000;

  constructor() {
    if (typeof window !== "undefined") {
      this.init();
      this.setupWindowListeners();
    }
  }

  private setupWindowListeners() {
    window.addEventListener("online", () => {
      this.reconnectImmediate();
    });

    // Re-verify connection when tab becomes visible
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
        this.reconnectImmediate();
      }
    });
  }

  public registerUid(uid: string) {
    this.myUid = uid;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "register", uid }));
    }
  }

  private reconnectImmediate() {
    clearTimeout(this.reconnectTimeout);
    clearTimeout(this.lifetimeRefreshTimer);
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.retryAttempts = 0;
    this.init();
  }

  private init() {
    if (typeof window === "undefined" || this.isConnecting) return;
    this.isConnecting = true;

    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/api/ws`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnecting = false;
        this.retryAttempts = 0;

        // Re-register client UID
        if (this.myUid) {
          this.ws?.send(JSON.stringify({ type: "register", uid: this.myUid }));
        }

        // Flush any queued messages that occurred during reconnect
        while (this.outgoingQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
          const queued = this.outgoingQueue.shift();
          this.ws.send(typeof queued === "string" ? queued : JSON.stringify(queued));
        }

        // Keep-alive heartbeat (15s interval)
        clearInterval(this.pingInterval);
        this.pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 15000);

        // Proactive lifetime cycling: prevent 5-minute serverless hard disconnect
        clearTimeout(this.lifetimeRefreshTimer);
        this.lifetimeRefreshTimer = setTimeout(() => {
          // Gracefully cycle connection
          this.cycleConnection();
        }, this.MAX_CONNECTION_LIFETIME_MS);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.subscribers.forEach((cb) => {
            try {
              cb(data);
            } catch (err) {
              console.warn("[ManagedWS] Subscriber error:", err);
            }
          });
        } catch {
          this.subscribers.forEach((cb) => {
            try {
              cb({ type: "raw", data: event.data });
            } catch {}
          });
        }
      };

      this.ws.onclose = () => {
        this.cleanupAndScheduleReconnect();
      };

      this.ws.onerror = () => {
        this.cleanupAndScheduleReconnect();
      };
    } catch {
      this.cleanupAndScheduleReconnect();
    }
  }

  private cycleConnection() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.init();
  }

  private cleanupAndScheduleReconnect() {
    this.isConnecting = false;
    clearInterval(this.pingInterval);
    clearTimeout(this.lifetimeRefreshTimer);

    // Exponential backoff with jitter: 1s, 2s, 4s, up to 10s
    this.retryAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, this.retryAttempts) + Math.random() * 500, 10000);

    clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = setTimeout(() => {
      this.init();
    }, delay);
  }

  public send(data: any): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(typeof data === "string" ? data : JSON.stringify(data));
      return true;
    }
    // Queue non-ping messages for delivery when reconnected
    if (data?.type !== "ping") {
      this.outgoingQueue.push(data);
      if (this.outgoingQueue.length > 50) {
        this.outgoingQueue.shift(); // Bound memory
      }
    }
    return false;
  }

  public subscribe(callback: WSMessageCallback): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  public isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const wsClient = new ManagedWebSocketClient();
