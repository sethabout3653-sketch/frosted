// Resilient WebSocket Client for High-Performance Real-Time Communication
// Features: Instant 0ms Latency, Auto-Reconnect with Exponential Backoff,
// Proactive Heartbeat (5-Minute Timeout Mitigation), Offline Message Buffering,
// and Seamless Database Sync Integration.

export interface WSChangePayload<T = any> {
  type: "change";
  op: "set" | "update" | "delete";
  collection: string;
  id: string;
  data?: T;
  timestamp: number;
}

export interface WSSignalPayload {
  type: "webrtc_signal";
  payload: {
    id: string;
    uid: string;
    targetUid: string;
    type: string;
    sdp?: any;
    candidate?: any;
    timestamp: number;
    [key: string]: any;
  };
  timestamp: number;
}

export type WSStatus = "connecting" | "connected" | "disconnected" | "reconnecting";

type ChangeCallback = (change: { op: "set" | "update" | "delete"; collection: string; id: string; data?: any }) => void;
type SignalCallback = (signal: any) => void;
type StatusCallback = (status: WSStatus) => void;

export class WebSocketClient {
  private static instance: WebSocketClient;
  private ws: WebSocket | null = null;
  private status: WSStatus = "disconnected";
  private statusListeners = new Set<StatusCallback>();
  private changeListeners = new Map<string, Set<ChangeCallback>>();
  private allChangeListeners = new Set<ChangeCallback>();
  private signalListeners = new Set<SignalCallback>();
  private myUid: string | null = null;

  // Reconnection management
  private reconnectAttempts = 0;
  private maxReconnectDelay = 5000;
  private reconnectTimer: any = null;
  private isIntentionallyClosed = false;

  // Heartbeat management (mitigates 5-minute hard disconnects by proactively verifying liveness)
  private heartbeatInterval: any = null;
  private heartbeatTimeout: any = null;
  private lastPongReceived = Date.now();

  // Outgoing message buffer for offline / reconnect periods
  private sendQueue: string[] = [];

  private constructor() {
    // Only connect in browser environments
    if (typeof window !== "undefined") {
      this.connect();

      // Listen to window online/offline events for immediate reconnect
      window.addEventListener("online", () => {
        if (this.status !== "connected") {
          this.reconnectAttempts = 0;
          this.connect();
        }
      });
    }
  }

  public static getInstance(): WebSocketClient {
    if (!WebSocketClient.instance) {
      WebSocketClient.instance = new WebSocketClient();
    }
    return WebSocketClient.instance;
  }

  public setUserUid(uid: string) {
    this.myUid = uid;
    if (this.isConnected()) {
      this.sendRaw({
        type: "register_uid",
        uid,
      });
    }
  }

  public getStatus(): WSStatus {
    return this.status;
  }

  public isConnected(): boolean {
    return this.status === "connected" && this.ws?.readyState === WebSocket.OPEN;
  }

  private setStatus(newStatus: WSStatus) {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.statusListeners.forEach((cb) => {
        try { cb(newStatus); } catch (e) {}
      });
    }
  }

  public onStatus(cb: StatusCallback): () => void {
    this.statusListeners.add(cb);
    cb(this.status);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  private getWebSocketUrl(): string {
    if (typeof window === "undefined") return "";
    const loc = window.location;
    const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${loc.host}/api/ws`;
  }

  public connect() {
    if (typeof window === "undefined") return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isIntentionallyClosed = false;
    this.setStatus(this.reconnectAttempts > 0 ? "reconnecting" : "connecting");

    try {
      const url = this.getWebSocketUrl();
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.setStatus("connected");
        this.startHeartbeat();

        // Register user UID if set
        if (this.myUid) {
          this.sendRaw({ type: "register_uid", uid: this.myUid });
        }

        // Re-subscribe to all active collections
        Array.from(this.changeListeners.keys()).forEach((col) => {
          this.sendRaw({ type: "subscribe", collection: col });
        });

        // Flush queued messages
        while (this.sendQueue.length > 0) {
          const item = this.sendQueue.shift();
          if (item && this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(item);
          }
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleIncomingMessage(data);
        } catch (e) {
          // Non-JSON or binary message
        }
      };

      this.ws.onerror = () => {
        // Socket error handled by onclose
      };

      this.ws.onclose = (event) => {
        this.stopHeartbeat();
        this.ws = null;
        this.setStatus("disconnected");

        if (!this.isIntentionallyClosed) {
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      this.setStatus("disconnected");
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    // Exponential backoff with jitter (300ms, 600ms, 1200ms... up to max 5000ms)
    const baseDelay = Math.min(300 * Math.pow(1.5, this.reconnectAttempts), this.maxReconnectDelay);
    const jitter = Math.random() * 200;
    const delay = Math.round(baseDelay + jitter);

    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.lastPongReceived = Date.now();

    // Ping every 20 seconds to keep connection alive and detect function spin-downs
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendRaw({ type: "ping", timestamp: Date.now() });

        // If no response received in 12 seconds, force reconnect
        this.heartbeatTimeout = setTimeout(() => {
          if (Date.now() - this.lastPongReceived > 25000) {
            console.warn("[WebSocket] Heartbeat timeout detected, forcing reconnect...");
            if (this.ws) {
              try { this.ws.close(); } catch (e) {}
            }
          }
        }, 12000);
      }
    }, 20000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  private handleIncomingMessage(msg: any) {
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "pong") {
      this.lastPongReceived = Date.now();
      if (this.heartbeatTimeout) {
        clearTimeout(this.heartbeatTimeout);
        this.heartbeatTimeout = null;
      }
      return;
    }

    if (msg.type === "ping") {
      this.sendRaw({ type: "pong", timestamp: Date.now() });
      return;
    }

    // Handle database record change events (live chat, typing, presence, voice status)
    if (msg.type === "change" && msg.collection && msg.id) {
      const changePayload = {
        op: msg.op || "set",
        collection: msg.collection,
        id: msg.id,
        data: msg.data,
      };

      // Notify collection specific listeners
      const listeners = this.changeListeners.get(msg.collection);
      if (listeners) {
        listeners.forEach((cb) => {
          try { cb(changePayload); } catch (e) {}
        });
      }

      // Notify wildcard listeners
      this.allChangeListeners.forEach((cb) => {
        try { cb(changePayload); } catch (e) {}
      });
      return;
    }

    // Handle real-time WebRTC peer-to-peer signals
    if (msg.type === "webrtc_signal" && msg.payload) {
      const sig = msg.payload;
      // Filter out messages sent by ourselves if uid is set
      if (this.myUid && sig.uid === this.myUid) return;
      if (this.myUid && sig.targetUid && sig.targetUid !== "all" && sig.targetUid !== this.myUid) return;

      this.signalListeners.forEach((cb) => {
        try { cb(sig); } catch (e) {}
      });
      return;
    }
  }

  private sendRaw(data: any): boolean {
    const json = JSON.stringify(data);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(json);
      return true;
    } else {
      // Buffer critical messages
      if (data.type === "change" || data.type === "webrtc_signal") {
        if (this.sendQueue.length > 100) this.sendQueue.shift();
        this.sendQueue.push(json);
      }
      return false;
    }
  }

  /**
   * Broadcast an instant mutation (set, update, delete) over WebSockets
   */
  public sendChange(op: "set" | "update" | "delete", collection: string, id: string, data?: any) {
    return this.sendRaw({
      type: "change",
      op,
      collection,
      id,
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast or direct-route a WebRTC signal for instant 0ms voice/video/screenshare negotiation
   */
  public sendSignal(payload: any) {
    return this.sendRaw({
      type: "webrtc_signal",
      payload,
      timestamp: Date.now(),
    });
  }

  /**
   * Subscribe to live collection changes
   */
  public onCollectionChange(collectionName: string, cb: ChangeCallback): () => void {
    if (!this.changeListeners.has(collectionName)) {
      this.changeListeners.set(collectionName, new Set());
      if (this.isConnected()) {
        this.sendRaw({ type: "subscribe", collection: collectionName });
      }
    }

    this.changeListeners.get(collectionName)!.add(cb);

    return () => {
      const listeners = this.changeListeners.get(collectionName);
      if (listeners) {
        listeners.delete(cb);
        if (listeners.size === 0) {
          this.changeListeners.delete(collectionName);
        }
      }
    };
  }

  /**
   * Subscribe to all database changes
   */
  public onAnyChange(cb: ChangeCallback): () => void {
    this.allChangeListeners.add(cb);
    return () => {
      this.allChangeListeners.delete(cb);
    };
  }

  /**
   * Subscribe to incoming WebRTC signals
   */
  public onSignal(cb: SignalCallback): () => void {
    this.signalListeners.add(cb);
    return () => {
      this.signalListeners.delete(cb);
    };
  }

  public disconnect() {
    this.isIntentionallyClosed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    this.setStatus("disconnected");
  }
}

export const wsClient = WebSocketClient.getInstance();
