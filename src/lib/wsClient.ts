// Real-time WebSocket Client with automatic reconnection and multi-channel support
// Connects to /api/ws (Vercel Native WebSocket Beta & Local Node Server)

export type WSMessageCallback = (msg: any) => void;

class ManagedWebSocketClient {
  private ws: WebSocket | null = null;
  private subscribers = new Set<WSMessageCallback>();
  private reconnectTimeout: any = null;
  private pingInterval: any = null;
  private myUid: string | null = null;
  private isConnecting = false;

  constructor() {
    if (typeof window !== "undefined") {
      this.init();
    }
  }

  public registerUid(uid: string) {
    this.myUid = uid;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "register", uid }));
    }
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
        if (this.myUid) {
          this.ws?.send(JSON.stringify({ type: "register", uid: this.myUid }));
        }

        // Keep-alive heartbeat
        clearInterval(this.pingInterval);
        this.pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 20000);
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
          // Plain text message
          this.subscribers.forEach((cb) => {
            try {
              cb({ type: "raw", data: event.data });
            } catch {}
          });
        }
      };

      this.ws.onclose = () => {
        this.isConnecting = false;
        clearInterval(this.pingInterval);
        // Exponential/Fixed automatic reconnect
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = setTimeout(() => {
          this.init();
        }, 3000);
      };

      this.ws.onerror = () => {
        this.isConnecting = false;
        this.ws?.close();
      };
    } catch (e) {
      this.isConnecting = false;
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = setTimeout(() => {
        this.init();
      }, 5000);
    }
  }

  public send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(typeof data === "string" ? data : JSON.stringify(data));
      return true;
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
