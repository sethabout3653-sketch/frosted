import React, { useState, useEffect, useRef } from "react";
import {
  db,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  setDoc,
  updateDoc,
  sethbase,
  handleFirestoreError,
  OperationType,
} from "../sethbase";
import { ChatMessage, ChatProfile } from "../types";
import {
  Send,
  Image as ImageIcon,
  Plus,
  X,
  Trash2,
  Users,
  Search,
  Hash,
  MicOff,
  Volume2,
  Video,
} from "lucide-react";

import GiphyPicker from "./GiphyPicker";

interface ChatPanelProps {
  profile: ChatProfile;
  activeChannel?: string;
  onSelectVoice?: () => void;
  showMembersSidebar?: boolean;
  setShowMembersSidebar?: (show: boolean | ((prev: boolean) => boolean)) => void;
}

interface MemberUser {
  uid: string;
  username: string;
  photoURL: string;
  lastSeen?: number;
  status?: "online" | "left" | "offline";
  isMuted?: boolean;
  inVoice?: boolean;
}

export default function ChatPanel({
  profile,
  activeChannel = "general",
  showMembersSidebar = true,
  setShowMembersSidebar,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [memberUsers, setMemberUsers] = useState<MemberUser[]>([]);
  const [activeVoiceUsers, setActiveVoiceUsers] = useState<
    Record<string, { isMuted?: boolean; isVideoOn?: boolean }>
  >({});
  const [text, setText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showGiphy, setShowGiphy] = useState(false);
  const [attachment, setAttachment] = useState<string | null>(null);
  const [attachmentType, setAttachmentType] = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [attachmentSize, setAttachmentSize] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [currentTime, setCurrentTime] = useState<number>(Date.now());
  const [typingUsers, setTypingUsers] = useState<any[]>([]);
  const [isLocalTyping, setIsLocalTyping] = useState(false);
  const typingTimeoutRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateTypingStatus = async (typing: boolean) => {
    if (!profile) return;
    const typingRef = doc(db, "typing", `${activeChannel}_${profile.uid}`);
    if (typing) {
      setIsLocalTyping(true);
      await setDoc(typingRef, {
        uid: profile.uid,
        username: profile.username,
        channelId: activeChannel,
        isTyping: true,
        lastActive: Date.now(),
      }).catch((err) => console.warn("Error setting typing status:", err));
    } else {
      setIsLocalTyping(false);
      await deleteDoc(typingRef).catch((err) => console.warn("Error deleting typing status:", err));
    }
  };

  // Listen for active typing users in the current channel
  useEffect(() => {
    if (!profile?.uid) return;
    const q = query(collection(db, "typing"));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: any[] = [];
        const now = Date.now();
        snapshot.docs.forEach((d) => {
          const data = d.data();
          if (
            data.uid !== profile.uid &&
            data.channelId === activeChannel &&
            data.isTyping === true &&
            data.lastActive > now - 10000
          ) {
            list.push(data);
          }
        });
        setTypingUsers(list);
      },
      (error) => {
        console.warn("Typing listener error:", error);
      }
    );

    return () => unsub();
  }, [activeChannel, profile?.uid]);

  // Periodic pruning of dead typing heartbeats
  useEffect(() => {
    const checkStale = setInterval(() => {
      const now = Date.now();
      setTypingUsers((prev) =>
        prev.filter((user) => user.lastActive > now - 10000)
      );
    }, 1500);
    return () => clearInterval(checkStale);
  }, []);

  // Cleanup local typing state on active channel change
  useEffect(() => {
    if (isLocalTyping) {
      updateTypingStatus(false);
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  }, [activeChannel]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (profile) {
        const typingRef = doc(db, "typing", `${activeChannel}_${profile.uid}`);
        deleteDoc(typingRef).catch(() => {});
      }
    };
  }, []);

  // 1-second tick to continuously evaluate active vs dead/lagging peers in real-time
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Real-time listener for voice users
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "voice_users"),
      (snapshot) => {
        setActiveVoiceUsers(
          Object.fromEntries(
            snapshot.docs.map((d) => [d.id, d.data() as any])
          )
        );
      },
      (error) => {
        console.warn("ChatPanel voice_users listener error:", error);
      }
    );
    return () => unsub();
  }, []);

  // Presence & Left Website tracking with fast 2.5s heartbeat
  useEffect(() => {
    if (!profile) return;
    const presenceRef = doc(db, "presence", profile.uid);

    const markOnline = async () => {
      try {
        await setDoc(presenceRef, {
          uid: profile.uid,
          username: profile.username,
          photoURL: profile.photoURL || "",
          status: "online",
          lastSeen: Date.now(),
        }, { merge: true });
      } catch (e) {}
    };

    const markLeft = async () => {
      try {
        await setDoc(presenceRef, {
          uid: profile.uid,
          username: profile.username,
          photoURL: profile.photoURL || "",
          status: "left",
          lastSeen: Date.now(),
          inVoice: false,
        }, { merge: true }).catch(() => {});
      } catch (e) {}
    };

    markOnline();
    const interval = setInterval(markOnline, 2500); // 2.5s rapid heartbeat for real-time accuracy

    const handleUnload = () => {
      markLeft();
    };

    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("pagehide", handleUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("pagehide", handleUnload);
      // Do not mark as left on component unmount; heartbeat timeout and beforeunload handle real disconnects
    };
  }, [profile]);

  // Real-time member presence listener
  useEffect(() => {
    const q = query(collection(db, "presence"), limit(40));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const users: MemberUser[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as MemberUser;
          users.push({
            uid: docSnap.id,
            username: data.username || "Anonymous",
            photoURL: data.photoURL || "",
            status: data.status || "online",
            lastSeen: data.lastSeen,
            isMuted: data.isMuted || false,
            inVoice: data.inVoice || false,
          });
        });

        // Ensure current profile is present
        if (!users.some((u) => u.uid === profile.uid)) {
          users.unshift({
            uid: profile.uid,
            username: profile.username,
            photoURL: profile.photoURL,
            status: "online",
            lastSeen: Date.now(),
          });
        }

        setMemberUsers(users);
      },
      (error) => {
        console.warn("ChatPanel presence listener error:", error);
      }
    );
    return () => unsub();
  }, [profile]);

  // Real-time message subscription with instant local rendering
  useEffect(() => {
    const q = query(
      collection(db, "messages"),
      orderBy("timestamp", "desc"),
      limit(50)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const newMessages: ChatMessage[] = [];
        snapshot.forEach((docSnap) => {
          newMessages.push({ id: docSnap.id, ...docSnap.data() } as ChatMessage);
        });
        const reversed = newMessages.reverse();

        setMessages((prev) => {
          // Keep any local optimistic messages that haven't arrived in the snapshot yet
          const pending = prev.filter(
            (m) =>
              m.id.startsWith("temp_") &&
              !reversed.some(
                (sm) =>
                  sm.uid === m.uid &&
                  Math.abs(sm.timestamp - m.timestamp) < 6000 &&
                  (sm.text === m.text || sm.gif === m.gif || sm.attachment === m.attachment)
              )
          );
          return [...reversed, ...pending];
        });
        window.setTimeout(() => scrollToBottom(), 50);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, "messages");
      }
    );

    return () => unsubscribe();
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const currentText = text.trim();
    const currentAttachment = attachment;
    const currentType = attachmentType;
    const currentName = attachmentName;
    const currentSize = attachmentSize;
    if (!currentText && !currentAttachment) return;

    const tempId = "temp_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
    const now = Date.now();

    // Optimistically show message immediately on sender's screen (0ms latency)
    const optimisticMsg: ChatMessage = {
      id: tempId,
      uid: profile.uid,
      username: profile.username,
      photoURL: profile.photoURL || "",
      timestamp: now,
      ...(currentText ? { text: currentText } : {}),
      ...(currentAttachment ? { 
        attachment: currentAttachment,
        attachmentType: currentType || undefined,
        attachmentName: currentName || undefined,
        attachmentSize: currentSize || undefined,
      } : {}),
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setText("");
    if (isLocalTyping) {
      updateTypingStatus(false);
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    setAttachment(null);
    setAttachmentType(null);
    setAttachmentName(null);
    setAttachmentSize(null);
    inputRef.current?.focus();
    window.setTimeout(() => scrollToBottom(), 10);

    try {
      const msgData: Record<string, any> = {
        uid: profile.uid,
        username: profile.username,
        photoURL: profile.photoURL || "",
        timestamp: now,
      };

      if (currentText) {
        msgData.text = currentText;
      }
      if (currentAttachment) {
        msgData.attachment = currentAttachment;
        if (currentType) msgData.attachmentType = currentType;
        if (currentName) msgData.attachmentName = currentName;
        if (currentSize) msgData.attachmentSize = currentSize;
      }

      await addDoc(collection(db, "messages"), msgData);
    } catch (error) {
      // Revert optimistic message if writing failed
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      handleFirestoreError(error, OperationType.CREATE, "messages");
    }
  };

  const handleSendGif = async (gifUrl: string) => {
    if (!gifUrl) return;
    const tempId = "temp_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
    const now = Date.now();

    // Optimistically show GIF immediately (0ms latency)
    const optimisticMsg: ChatMessage = {
      id: tempId,
      uid: profile.uid,
      username: profile.username,
      photoURL: profile.photoURL || "",
      gif: gifUrl,
      timestamp: now,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setShowGiphy(false);
    window.setTimeout(() => scrollToBottom(), 10);

    try {
      const msgData: Record<string, any> = {
        uid: profile.uid,
        username: profile.username,
        photoURL: profile.photoURL || "",
        gif: gifUrl,
        timestamp: now,
      };

      await addDoc(collection(db, "messages"), msgData);
    } catch (error) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      handleFirestoreError(error, OperationType.CREATE, "messages");
    }
  };

  const uploadFile = async (file: File) => {
    setIsUploading(true);
    setUploadProgress(10);
    try {
      const result = await sethbase.storage.upload(file, (percent) => {
        setUploadProgress(percent);
      });
      setAttachment(result.url);
      setAttachmentType(result.mimetype);
      setAttachmentName(result.filename);
      setAttachmentSize(result.size);
    } catch (error: any) {
      console.warn("Storage upload fallback invoked:", error);
      try {
        const objectUrl = URL.createObjectURL(file);
        setAttachment(objectUrl);
        setAttachmentType(file.type || "application/octet-stream");
        setAttachmentName(file.name);
        setAttachmentSize(file.size);
      } catch (err) {
        console.error("Local file attachment fallback error:", err);
      }
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      uploadFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      uploadFile(file);
    }
  };

  const handleDeleteMessage = async (msgId: string) => {
    // Optimistically remove from view immediately
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
    try {
      await deleteDoc(doc(db, "messages", msgId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `messages/${msgId}`);
    }
  };

  const formatTimestamp = (ts: number) => {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const filteredMessages = searchQuery.trim()
    ? messages.filter(
        (m) =>
          m.text?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          m.username.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : messages;

  // Instant filtering: if a player lost connection or battery and stopped sending heartbeats,
  // within 60 seconds they will not be shown as online.
  const activeOnlineUsers = memberUsers.filter((u) => {
    if (u.uid === profile.uid) return true;
    const isRecent = typeof u.lastSeen === "number" && currentTime - u.lastSeen < 60000;
    return isRecent && u.status !== "left";
  });

  const leftUsers = memberUsers.filter((u) => {
    if (u.uid === profile.uid) return false;
    const isRecent = typeof u.lastSeen === "number" && currentTime - u.lastSeen < 60000;
    return u.status === "left" || !isRecent;
  });

  const renderAttachment = (msg: ChatMessage) => {
    if (!msg.attachment) return null;

    const mimeType = msg.attachmentType?.toLowerCase() || "";
    const url = msg.attachment.toLowerCase();
    
    const isImage = mimeType.startsWith("image/") || 
                    url.endsWith(".png") || 
                    url.endsWith(".jpg") || 
                    url.endsWith(".jpeg") || 
                    url.endsWith(".gif") || 
                    url.endsWith(".webp") ||
                    msg.attachment.startsWith("data:image/");

    const isVideo = mimeType.startsWith("video/") || 
                    url.endsWith(".mp4") || 
                    url.endsWith(".mov") || 
                    url.endsWith(".webm") || 
                    url.endsWith(".m4v") ||
                    url.endsWith(".ogg");

    const isAudio = mimeType.startsWith("audio/") || 
                    url.endsWith(".mp3") || 
                    url.endsWith(".wav") || 
                    url.endsWith(".m4a") ||
                    url.endsWith(".flac");

    if (isImage) {
      return (
        <a href={msg.attachment} target="_blank" rel="noopener noreferrer" className="block max-w-xs mt-2 group relative overflow-hidden rounded-xl border border-neutral-800 shadow-sm cursor-zoom-in">
          <img
            src={msg.attachment}
            alt={msg.attachmentName || "Attached Image"}
            className="w-full h-auto max-h-72 object-contain group-hover:scale-[1.02] transition-transform duration-200"
          />
        </a>
      );
    }

    if (isVideo) {
      return (
        <div className="max-w-md w-full mt-2">
          <video
            src={msg.attachment}
            controls
            preload="metadata"
            className="rounded-xl w-full border border-neutral-800 shadow-md bg-black"
          />
          {msg.attachmentName && (
            <span className="text-[10px] text-neutral-500 mt-1 block truncate">
              {msg.attachmentName}
            </span>
          )}
        </div>
      );
    }

    if (isAudio) {
      return (
        <div className="max-w-sm w-full mt-2 bg-neutral-900/60 p-3 rounded-xl border border-neutral-800 flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-neutral-300 truncate">
            {msg.attachmentName || "Audio file"}
          </span>
          <audio
            src={msg.attachment}
            controls
            className="w-full h-8"
          />
        </div>
      );
    }

    const formatFileSize = (bytes?: number) => {
      if (!bytes) return "";
      if (bytes < 1024) return `${bytes} B`;
      const kb = bytes / 1024;
      if (kb < 1024) return `${kb.toFixed(1)} KB`;
      const mb = kb / 1024;
      if (mb < 1024) return `${mb.toFixed(1)} MB`;
      const gb = mb / 1024;
      return `${gb.toFixed(1)} GB`;
    };

    const displayName = msg.attachmentName || msg.attachment.split("/").pop() || "Attached File";

    return (
      <div className="max-w-sm mt-2 p-3 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-xl flex items-center justify-between gap-3 shadow-md group">
        <div className="flex items-center gap-3 truncate">
          <div className="w-10 h-10 rounded-lg bg-neutral-800 border border-neutral-700 flex items-center justify-center text-neutral-400 group-hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-bold text-white truncate hover:underline cursor-pointer">
              <a href={msg.attachment} target="_blank" rel="noopener noreferrer">
                {displayName}
              </a>
            </span>
            <span className="text-[10px] text-neutral-500 font-medium">
              {formatFileSize(msg.attachmentSize)}
            </span>
          </div>
        </div>
        <a
          href={msg.attachment}
          download={displayName}
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white rounded-lg transition-colors border border-neutral-700 shadow-sm"
          title="Download File"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
        </a>
      </div>
    );
  };

  return (
    <div 
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex-1 flex w-full h-full min-h-0 bg-black text-white overflow-hidden relative ${
        isDragging ? "ring-2 ring-indigo-500 ring-inset bg-neutral-950/90" : ""
      }`}
    >
      {isDragging && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center border-4 border-dashed border-indigo-500 m-4 rounded-2xl pointer-events-none animate-in fade-in">
          <div className="p-4 bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-400">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-bounce"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
            </div>
            <p className="text-sm font-bold text-white">Drop to upload file</p>
            <p className="text-xs text-neutral-500">Upload video, audio, image, document, or ZIP of any size</p>
          </div>
        </div>
      )}
      {/* Center Chat View matching Image 2 */}
      <div className="flex-1 flex flex-col min-w-0 h-full bg-black">
        {/* Chat Header Bar */}
        <div className="h-12 px-4 border-b border-neutral-900 bg-black flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-neutral-400">#</span>
            <span className="text-sm font-bold text-white tracking-wide">
              {activeChannel}
            </span>
            <span className="text-xs text-neutral-500 font-normal hidden sm:inline ml-1">
              main room
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search messages"
                className="h-8 w-32 sm:w-44 bg-neutral-900 border border-neutral-800 rounded-md pl-8 pr-3 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-700 transition-colors"
              />
            </div>

            {/* Toggle Member Sidebar Button */}
            {setShowMembersSidebar && (
              <button
                onClick={() => setShowMembersSidebar((prev) => !prev)}
                className={`p-1.5 rounded-md transition-colors ${
                  showMembersSidebar
                    ? "bg-neutral-800 text-white"
                    : "text-neutral-400 hover:bg-neutral-900 hover:text-white"
                }`}
                title="Toggle Member List"
              >
                <Users size={18} />
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Chat Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* Welcome Channel Banner matching Image 2 */}
          <div className="mb-8 pt-2">
            <div className="w-16 h-16 rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center justify-center text-3xl font-extrabold text-white mb-3 shadow-md">
              <Hash size={36} className="text-neutral-300" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mb-1">
              Welcome to #{activeChannel}!
            </h1>
            <p className="text-neutral-400 text-xs sm:text-sm">
              This is the start of the #{activeChannel} channel.
            </p>
            <div className="border-b border-neutral-900 mt-6" />
          </div>

          {/* Messages Stream */}
          {filteredMessages.map((msg) => {
            const isMe =
              msg.uid === profile.uid ||
              (msg.username === profile.username &&
                msg.photoURL === profile.photoURL);

            return (
              <div
                key={msg.id}
                className="flex gap-3.5 group hover:bg-neutral-950/60 p-1.5 -mx-1.5 rounded-lg transition-colors relative"
              >
                {/* Avatar Circle */}
                <div className="w-10 h-10 rounded-full overflow-hidden bg-neutral-800 border border-neutral-800 flex-shrink-0 flex items-center justify-center font-bold text-white text-sm">
                  {msg.photoURL ? (
                    <img
                      src={msg.photoURL}
                      alt={msg.username}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span>{msg.username.charAt(0).toUpperCase()}</span>
                  )}
                </div>

                {/* Message Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-bold text-white hover:underline cursor-pointer">
                      {msg.username}
                    </span>
                    <span className="text-[11px] text-neutral-500 font-normal">
                      {formatTimestamp(msg.timestamp)}
                    </span>
                  </div>

                  {msg.text && (
                    <p className="text-sm text-neutral-200 mt-1 whitespace-pre-wrap break-words leading-relaxed font-normal">
                      {msg.text}
                    </p>
                  )}

                  {msg.gif && (
                    <img
                      src={msg.gif}
                      alt="GIF"
                      className="rounded-xl mt-2 max-w-xs h-auto border border-neutral-800"
                    />
                  )}

                  {msg.attachment && renderAttachment(msg)}
                </div>

                {/* Delete button on hover for user's own message */}
                {isMe && (
                  <button
                    onClick={() => handleDeleteMessage(msg.id)}
                    className="absolute right-2 top-2 p-1.5 text-neutral-500 hover:text-red-400 bg-neutral-900 border border-neutral-800 rounded-lg opacity-0 group-hover:opacity-100 transition-all shadow-sm"
                    title="Delete Message"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Giphy Picker Drawer */}
        {showGiphy && (
          <GiphyPicker
            onSelectGif={handleSendGif}
            onClose={() => setShowGiphy(false)}
          />
        )}

        {/* Attachment Preview Drawer */}
        {(attachment || isUploading) && (
          <div className="p-3 border-t border-neutral-900 bg-[#070707] flex items-center gap-4 flex-shrink-0 animate-in slide-in-from-bottom duration-200">
            {isUploading ? (
              <div className="flex items-center gap-3 w-full">
                <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 relative">
                  <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-white">Uploading file...</span>
                    <span className="text-xs text-neutral-400 font-bold">{uploadProgress !== null ? `${uploadProgress}%` : ""}</span>
                  </div>
                  <div className="w-full bg-neutral-900 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress ?? 0}%` }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="relative flex items-center gap-3 w-full max-w-md">
                <div className="relative">
                  {attachmentType?.startsWith("image/") ? (
                    <img
                      src={attachment!}
                      alt="Preview"
                      className="h-12 w-12 object-cover rounded-lg border border-neutral-800 bg-neutral-950"
                    />
                  ) : attachmentType?.startsWith("video/") ? (
                    <div className="h-12 w-12 rounded-lg bg-neutral-900 border border-neutral-800 flex items-center justify-center text-indigo-400">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>
                    </div>
                  ) : attachmentType?.startsWith("audio/") ? (
                    <div className="h-12 w-12 rounded-lg bg-neutral-900 border border-neutral-800 flex items-center justify-center text-emerald-400">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                    </div>
                  ) : (
                    <div className="h-12 w-12 rounded-lg bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-400">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setAttachment(null);
                      setAttachmentType(null);
                      setAttachmentName(null);
                      setAttachmentSize(null);
                    }}
                    className="absolute -top-1.5 -right-1.5 bg-neutral-900 text-neutral-400 hover:text-white rounded-full p-0.5 border border-neutral-700 transition-colors shadow-md"
                  >
                    <X size={10} />
                  </button>
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-bold text-white truncate">
                    {attachmentName || "Attached file"}
                  </span>
                  <span className="text-[10px] text-neutral-500 font-medium">
                    Ready to send
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Bottom Message Input Bar matching Image 2 */}
        <div className="px-4 pt-3 pb-2 sm:pb-2.5 bg-black border-t border-neutral-900 flex-shrink-0">
          {typingUsers.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-neutral-400 mb-2 pl-2 animate-in fade-in duration-200">
              <div className="flex items-center gap-1">
                <span className="relative flex h-1.5 w-1.5 mr-1">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-indigo-500"></span>
                </span>
                <span className="font-bold text-neutral-300">
                  {typingUsers.length <= 3 
                    ? typingUsers.map((u) => u.username).join(", ") 
                    : "Several people"}
                </span>
                <span>{typingUsers.length === 1 ? " is typing..." : " are typing..."}</span>
              </div>
            </div>
          )}
          <form
            onSubmit={handleSendMessage}
            className="bg-neutral-900/90 border border-neutral-800 rounded-xl px-4 py-2.5 flex items-center gap-3 focus-within:border-neutral-700 transition-colors"
          >
            <input
              ref={inputRef}
              type="text"
              value={text}
              onChange={(e) => {
                const val = e.target.value;
                setText(val);
                if (val.trim()) {
                  if (!isLocalTyping) {
                    updateTypingStatus(true);
                  }
                  if (typingTimeoutRef.current) {
                    clearTimeout(typingTimeoutRef.current);
                  }
                  typingTimeoutRef.current = setTimeout(() => {
                    updateTypingStatus(false);
                  }, 4000);
                } else {
                  if (isLocalTyping) {
                    updateTypingStatus(false);
                  }
                  if (typingTimeoutRef.current) {
                    clearTimeout(typingTimeoutRef.current);
                    typingTimeoutRef.current = null;
                  }
                }
              }}
              placeholder={`Message #${activeChannel}...`}
              className="flex-1 bg-transparent text-sm text-white placeholder-neutral-500 focus:outline-none"
            />

            {/* Action Tools: File, GIF, Send */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-neutral-400 hover:text-white p-1.5 rounded-lg hover:bg-neutral-800 transition-colors"
                title="Attach Any File"
              >
                <Plus size={18} />
              </button>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                onChange={handleFileChange}
              />

              <button
                type="button"
                onClick={() => setShowGiphy(!showGiphy)}
                className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white rounded text-[11px] font-bold tracking-wider transition-colors"
                title="Choose GIF"
              >
                GIF
              </button>

              <button
                type="submit"
                disabled={(!text.trim() && !attachment) || isUploading}
                className="p-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white disabled:opacity-40 disabled:hover:bg-neutral-800 transition-all ml-1 cursor-pointer"
                title="Send Message"
              >
                <Send size={15} />
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Right Members Sidebar ("ONLINE — N" & "OFFLINE / LEFT — N") matching Image 2 */}
      {showMembersSidebar && (
        <aside className="w-56 bg-[#080808] border-l border-neutral-900 flex flex-col h-full flex-shrink-0">
          <div className="flex-1 overflow-y-auto p-3 space-y-5">
            {/* ONLINE SECTION */}
            <div>
              <h3 className="text-[10px] font-bold text-neutral-400 tracking-wider uppercase mb-2 px-1">
                ONLINE — {activeOnlineUsers.length}
              </h3>
              <div className="space-y-1">
                {activeOnlineUsers.map((user) => {
                  const isCurrentUser = user.uid === profile.uid;
                  const voiceInfo = activeVoiceUsers[user.uid];
                  const isInVoice = !!voiceInfo;

                  return (
                    <div
                      key={user.uid}
                      className="flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-neutral-900/60 transition-colors"
                    >
                      {/* Avatar with Green Online Dot Badge */}
                      <div className="relative">
                        <div className="w-8 h-8 rounded-full overflow-hidden bg-neutral-800 border border-neutral-800 flex items-center justify-center text-xs font-bold text-white">
                          {user.photoURL ? (
                            <img
                              src={user.photoURL}
                              alt={user.username}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span>{user.username.charAt(0).toUpperCase()}</span>
                          )}
                        </div>
                        <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#080808]" />
                      </div>

                      {/* Username & Status Label */}
                      <div className="flex-1 min-w-0 flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-neutral-200 truncate">
                            {user.username}
                          </span>
                          {isCurrentUser && (
                            <span className="bg-emerald-950 text-emerald-400 border border-emerald-800/80 text-[9px] font-bold px-1 py-0.2 rounded uppercase tracking-wider">
                              YOU
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-neutral-500 font-medium">
                            Online
                          </span>
                          {isInVoice && (
                            <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-800/60 px-1 py-0.2 rounded">
                              <Volume2 size={9} /> In Voice
                            </span>
                          )}
                          {isInVoice && voiceInfo?.isMuted && (
                            <span className="flex items-center gap-0.5 text-[9px] font-bold text-red-400 bg-red-950/80 border border-red-800/60 px-1 rounded">
                              <MicOff size={9} /> Muted
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
