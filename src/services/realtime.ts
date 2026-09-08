import { ChatMessage, ChatProfile } from "../types";

type MessagesListener = (messages: ChatMessage[]) => void;
type PresenceListener = (users: any[]) => void;
type VoiceUsersListener = (users: any[]) => void;
type VoiceSignalListener = (data: { senderId: string; signal: any }) => void;
type PeerLeftListener = (uid: string) => void;

class ChatSyncService {
  private currentProfile: ChatProfile | null = null;
  private inVoice = false;
  private voiceState: { isMuted?: boolean; isVideoOn?: boolean; isVideoLoading?: boolean } = {};

  private messages: ChatMessage[] = [];
  private presenceUsers: any[] = [];
  private voiceUsers: any[] = [];

  private messageListeners = new Set<MessagesListener>();
  private presenceListeners = new Set<PresenceListener>();
  private voiceUsersListeners = new Set<VoiceUsersListener>();
  private voiceSignalListeners = new Set<VoiceSignalListener>();
  private peerLeftListeners = new Set<PeerLeftListener>();

  private pollTimer: any = null;
  private signalTimer: any = null;
  private isPolling = false;

  constructor() {
    // 1. Immediately load all cached messages from localStorage, stripping any dummy or bot messages
    try {
      const cached = localStorage.getItem("lumiverse_cached_chat_messages");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          this.messages = parsed.filter(
            (m) => m && m.id && !m.id.startsWith("welcome-") && m.uid !== "system-bot" && m.uid !== "admin-mod"
          );
        }
      }
    } catch (e) {}

    // 2. Start fast HTTP REST polling (no WebSockets)
    if (typeof window !== "undefined") {
      this.initSync();
    }
  }

  private async initSync() {
    // Fetch initial messages
    await this.fetchMessages();

    // Start background sync polling every 1.5s
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      this.pollCycle();
    }, 1500);
  }

  private async pollCycle() {
    if (this.isPolling) return;
    this.isPolling = true;
    try {
      await Promise.all([
        this.fetchMessages(),
        this.fetchPresence(),
        this.fetchVoiceUsers(),
      ]);
    } catch (e) {
    } finally {
      this.isPolling = false;
    }
  }

  private async fetchMessages() {
    try {
      const res = await fetch("/api/messages");
      if (res.ok) {
        const serverMsgs: ChatMessage[] = await res.json();
        if (Array.isArray(serverMsgs)) {
          const clean = serverMsgs.filter(
            (m) => m && m.id && !m.id.startsWith("welcome-") && m.uid !== "system-bot" && m.uid !== "admin-mod"
          );
          clean.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
          this.messages = clean;
          this.saveLocalMessages();
          this.notifyMessages();
        }
      }
    } catch (e) {}
  }

  private async fetchPresence() {
    try {
      const res = await fetch("/api/presence");
      if (res.ok) {
        const users = await res.json();
        if (Array.isArray(users)) {
          this.presenceUsers = users;
          this.notifyPresence();
        }
      }
    } catch (e) {}
  }

  private async fetchVoiceUsers() {
    try {
      const res = await fetch("/api/voice/users");
      if (res.ok) {
        const users = await res.json();
        if (Array.isArray(users)) {
          this.voiceUsers = users;
          this.notifyVoiceUsers();
        }
      }
    } catch (e) {}
  }

  private mergeMessages(incoming: ChatMessage[]) {
    let changed = false;
    for (const msg of incoming) {
      if (!msg || !msg.id) continue;
      const exists = this.messages.some((m) => m.id === msg.id);
      if (!exists) {
        this.messages.push(msg);
        changed = true;
      }
    }
    if (changed || this.messages.length === 0) {
      this.messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      this.saveLocalMessages();
      this.notifyMessages();
    }
  }

  private addMessage(msg: ChatMessage) {
    const existingIndex = this.messages.findIndex((m) => m.id === msg.id);
    if (existingIndex >= 0) {
      this.messages[existingIndex] = msg;
    } else {
      this.messages.push(msg);
    }
    this.messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    this.saveLocalMessages();
    this.notifyMessages();
  }

  private removeMessage(msgId: string) {
    const prevLen = this.messages.length;
    this.messages = this.messages.filter((m) => m.id !== msgId);
    if (this.messages.length !== prevLen) {
      this.saveLocalMessages();
      this.notifyMessages();
    }
  }

  private saveLocalMessages() {
    try {
      localStorage.setItem("lumiverse_cached_chat_messages", JSON.stringify(this.messages));
    } catch (e) {}
  }

  private notifyMessages() {
    const copy = [...this.messages];
    for (const listener of this.messageListeners) {
      try {
        listener(copy);
      } catch (e) {}
    }
  }

  private notifyPresence() {
    const copy = [...this.presenceUsers];
    for (const listener of this.presenceListeners) {
      try {
        listener(copy);
      } catch (e) {}
    }
  }

  private notifyVoiceUsers() {
    const copy = [...this.voiceUsers];
    for (const listener of this.voiceUsersListeners) {
      try {
        listener(copy);
      } catch (e) {}
    }
  }

  // --- Public APIs ---

  public getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  public subscribeMessages(listener: MessagesListener): () => void {
    this.messageListeners.add(listener);
    listener([...this.messages]);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  public async sendMessage(msg: ChatMessage) {
    // 1. Optimistic instant local render (0ms response)
    this.addMessage(msg);

    // 2. Persist to server via REST
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(msg),
      });
      if (res.ok) {
        const saved = await res.json();
        this.addMessage(saved);
      }
    } catch (e) {
      console.warn("Message save error:", e);
    }
  }

  public async deleteMessage(msgId: string) {
    this.removeMessage(msgId);
    try {
      await fetch(`/api/messages/${msgId}`, { method: "DELETE" });
    } catch (e) {}
  }

  public async clearAllMessages() {
    this.messages = [];
    this.saveLocalMessages();
    this.notifyMessages();
    try {
      await fetch("/api/messages", { method: "DELETE" });
    } catch (e) {}
  }

  public subscribePresence(listener: PresenceListener): () => void {
    this.presenceListeners.add(listener);
    listener([...this.presenceUsers]);
    return () => {
      this.presenceListeners.delete(listener);
    };
  }

  public updatePresence(profile: ChatProfile) {
    this.currentProfile = profile;
    fetch("/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uid: profile.uid,
        username: profile.username,
        photoURL: profile.photoURL,
        status: profile.status || "online",
        inVoice: this.inVoice,
        isMuted: this.voiceState.isMuted,
      }),
    }).catch(() => {});
  }

  public subscribeVoiceUsers(listener: VoiceUsersListener): () => void {
    this.voiceUsersListeners.add(listener);
    listener([...this.voiceUsers]);
    return () => {
      this.voiceUsersListeners.delete(listener);
    };
  }

  public joinVoice(user: any) {
    this.inVoice = true;
    this.voiceState = {
      isMuted: user.isMuted,
      isVideoOn: user.isVideoOn,
      isVideoLoading: user.isVideoLoading,
    };

    fetch("/api/voice/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(user),
    }).catch(() => {});

    // Start fast polling for WebRTC signals (every 600ms)
    if (this.signalTimer) clearInterval(this.signalTimer);
    this.signalTimer = setInterval(() => {
      this.pollVoiceSignals();
    }, 600);
  }

  private async pollVoiceSignals() {
    if (!this.currentProfile?.uid) return;
    try {
      const res = await fetch(`/api/voice/signals/${this.currentProfile.uid}`);
      if (res.ok) {
        const signals = await res.json();
        if (Array.isArray(signals)) {
          for (const s of signals) {
            for (const listener of this.voiceSignalListeners) {
              try {
                listener({ senderId: s.senderId, signal: { type: s.type, data: s.data } });
              } catch (e) {}
            }
          }
        }
      }
    } catch (e) {}
  }

  public leaveVoice(uid?: string) {
    this.inVoice = false;
    this.voiceState = {};
    if (this.signalTimer) {
      clearInterval(this.signalTimer);
      this.signalTimer = null;
    }
    const targetUid = uid || this.currentProfile?.uid;
    if (targetUid) {
      fetch("/api/voice/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: targetUid }),
      }).catch(() => {});
    }
  }

  public updateVoiceState(state: { isMuted?: boolean; isVideoOn?: boolean; isVideoLoading?: boolean }) {
    this.voiceState = { ...this.voiceState, ...state };
    if (this.currentProfile?.uid) {
      fetch("/api/voice/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid: this.currentProfile.uid,
          state: this.voiceState,
        }),
      }).catch(() => {});
    }
  }

  public sendVoiceSignal(receiverId: string, signal: any, senderId?: string) {
    fetch("/api/voice/signal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderId: senderId || this.currentProfile?.uid,
        receiverId,
        type: signal.type,
        data: signal.data,
      }),
    }).catch(() => {});
  }

  public onVoiceSignal(listener: VoiceSignalListener): () => void {
    this.voiceSignalListeners.add(listener);
    return () => {
      this.voiceSignalListeners.delete(listener);
    };
  }

  public onPeerLeft(listener: PeerLeftListener): () => void {
    this.peerLeftListeners.add(listener);
    return () => {
      this.peerLeftListeners.delete(listener);
    };
  }
}

export const realtime = new ChatSyncService();
