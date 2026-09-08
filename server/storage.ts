import fs from "fs";
import path from "path";

export interface ChatMessage {
  id: string;
  uid: string;
  username: string;
  photoURL: string;
  text?: string;
  gif?: string;
  attachment?: string;
  timestamp: number;
}

export interface PresenceUser {
  uid: string;
  username: string;
  photoURL: string;
  status: "online" | "left" | "offline";
  lastSeen: number;
  inVoice?: boolean;
  isMuted?: boolean;
  isVideoOn?: boolean;
  isVideoLoading?: boolean;
}

export interface VoiceParticipant {
  uid: string;
  username: string;
  photoURL: string;
  isMuted?: boolean;
  isVideoOn?: boolean;
  isVideoLoading?: boolean;
  timestamp: number;
}

export interface WebRTCSignal {
  id: string;
  senderId: string;
  receiverId: string;
  type: string;
  data: any;
  timestamp: number;
}

const DATA_DIR = path.join(process.cwd(), "data");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error("Failed to create data directory:", err);
  }
}

class StorageManager {
  private messages: ChatMessage[] = [];
  private isLoaded = false;
  private presence = new Map<string, PresenceUser>();
  private voiceUsers = new Map<string, VoiceParticipant>();
  private signals: WebRTCSignal[] = [];

  constructor() {
    this.load();
    // Periodically prune stale presence and signals
    setInterval(() => this.pruneStale(), 15000);
  }

  private load() {
    try {
      if (fs.existsSync(MESSAGES_FILE)) {
        const data = fs.readFileSync(MESSAGES_FILE, "utf-8");
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          this.messages = parsed;
          this.isLoaded = true;
          return;
        }
      }
    } catch (err) {
      console.error("Error reading messages.json:", err);
    }
    this.messages = [];
    this.save();
    this.isLoaded = true;
  }

  private save() {
    try {
      fs.writeFileSync(MESSAGES_FILE, JSON.stringify(this.messages, null, 2), "utf-8");
    } catch (err) {
      console.error("Error saving messages.json:", err);
    }
  }

  public clearAllMessages(): void {
    this.messages = [];
    this.save();
  }

  public getMessages(): ChatMessage[] {
    if (!this.isLoaded) this.load();
    return [...this.messages];
  }

  public addMessage(msg: ChatMessage): ChatMessage {
    if (!msg || !msg.id) return msg;
    // Discard any dummy/bot messages
    if (msg.id.startsWith("welcome-") || msg.uid === "system-bot" || msg.uid === "admin-mod") {
      return msg;
    }
    const existingIndex = this.messages.findIndex((m) => m.id === msg.id);
    if (existingIndex >= 0) {
      this.messages[existingIndex] = msg;
    } else {
      this.messages.push(msg);
    }
    if (this.messages.length > 10000) {
      this.messages = this.messages.slice(-10000);
    }
    this.save();
    return msg;
  }

  public deleteMessage(id: string): boolean {
    const initialLen = this.messages.length;
    this.messages = this.messages.filter((m) => m.id !== id);
    if (this.messages.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  public bulkMerge(incoming: ChatMessage[]): ChatMessage[] {
    let changed = false;
    for (const msg of incoming) {
      if (!msg || !msg.id || !msg.timestamp) continue;
      if (msg.id.startsWith("welcome-") || msg.uid === "system-bot" || msg.uid === "admin-mod") continue;
      const exists = this.messages.some(
        (m) => m.id === msg.id || (m.uid === msg.uid && m.timestamp === msg.timestamp && m.text === msg.text)
      );
      if (!exists) {
        this.messages.push(msg);
        changed = true;
      }
    }
    if (changed) {
      this.messages.sort((a, b) => a.timestamp - b.timestamp);
      if (this.messages.length > 10000) {
        this.messages = this.messages.slice(-10000);
      }
      this.save();
    }
    return [...this.messages];
  }

  // Presence & Voice Management
  public updatePresence(user: Partial<PresenceUser> & { uid: string }) {
    const existing = this.presence.get(user.uid) || {
      uid: user.uid,
      username: user.username || "Anonymous",
      photoURL: user.photoURL || "",
      status: "online",
      lastSeen: Date.now(),
    };
    this.presence.set(user.uid, {
      ...existing,
      ...user,
      lastSeen: Date.now(),
    });
  }

  public getPresenceList(): PresenceUser[] {
    return Array.from(this.presence.values());
  }

  public joinVoice(user: VoiceParticipant) {
    this.voiceUsers.set(user.uid, {
      ...user,
      timestamp: Date.now(),
    });
    this.updatePresence({
      uid: user.uid,
      username: user.username,
      photoURL: user.photoURL,
      inVoice: true,
      isMuted: user.isMuted,
      isVideoOn: user.isVideoOn,
      isVideoLoading: user.isVideoLoading,
    });
  }

  public updateVoiceState(uid: string, state: Partial<VoiceParticipant>) {
    const existing = this.voiceUsers.get(uid);
    if (existing) {
      this.voiceUsers.set(uid, {
        ...existing,
        ...state,
        timestamp: Date.now(),
      });
      this.updatePresence({
        uid,
        ...state,
      });
    }
  }

  public leaveVoice(uid: string) {
    this.voiceUsers.delete(uid);
    this.updatePresence({
      uid,
      inVoice: false,
      isVideoOn: false,
      isVideoLoading: false,
    });
  }

  public getVoiceUsers(): VoiceParticipant[] {
    return Array.from(this.voiceUsers.values());
  }

  // WebRTC Signals
  public addSignal(signal: Omit<WebRTCSignal, "id" | "timestamp">) {
    const newSignal: WebRTCSignal = {
      ...signal,
      id: "sig_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
      timestamp: Date.now(),
    };
    this.signals.push(newSignal);
    if (this.signals.length > 500) {
      this.signals = this.signals.slice(-500);
    }
    return newSignal;
  }

  public getAndClearSignals(receiverId: string): WebRTCSignal[] {
    const target = this.signals.filter((s) => s.receiverId === receiverId);
    this.signals = this.signals.filter((s) => s.receiverId !== receiverId);
    return target;
  }

  private pruneStale() {
    const now = Date.now();
    // Prune stale voice users (no heartbeat for 60s)
    for (const [uid, u] of this.voiceUsers.entries()) {
      if (now - u.timestamp > 60000) {
        this.voiceUsers.delete(uid);
        this.updatePresence({ uid, inVoice: false });
      }
    }
    // Prune stale signals older than 30s
    this.signals = this.signals.filter((s) => now - s.timestamp < 30000);
  }
}

export const storage = new StorageManager();
