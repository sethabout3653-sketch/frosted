import React, { useState, useEffect, useRef } from "react";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";
import { ChatMessage, ChatProfile } from "../types";
import {
  Send,
  Image as ImageIcon,
  X,
  Trash2,
  Users,
  Search,
  Hash,
  MicOff,
  Volume2,
  Video,
} from "lucide-react";

// Giphy imports
import { GiphyFetch } from "@giphy/js-fetch-api";
import { Grid } from "@giphy/react-components";

const gf = new GiphyFetch("sXpGFDGpz0Dv1BASECkiIylQzntcxJW6");

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Subscribe to active voice users
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "voice_users"),
      (snapshot) => {
        const map: Record<
          string,
          { isMuted?: boolean; isVideoOn?: boolean }
        > = {};
        snapshot.forEach((d) => {
          map[d.id] = d.data() as any;
        });
        setActiveVoiceUsers(map);
      },
      () => setActiveVoiceUsers({})
    );
    return () => unsubscribe();
  }, []);

  // Presence & Left Website tracking
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
        await updateDoc(presenceRef, {
          status: "left",
          lastSeen: Date.now(),
        }).catch(() => {});
      } catch (e) {}
    };

    markOnline();
    const interval = setInterval(markOnline, 20000); // 20s heartbeat

    const handleUnload = () => {
      markLeft();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        markLeft();
      } else {
        markOnline();
      }
    };

    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("pagehide", handleUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("pagehide", handleUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      markLeft();
    };
  }, [profile]);

  // Subscribe to member presence
  useEffect(() => {
    const q = query(collection(db, "presence"), limit(40));
    const unsubscribe = onSnapshot(
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
      () => {
        setMemberUsers([
          {
            uid: profile.uid,
            username: profile.username,
            photoURL: profile.photoURL,
            status: "online",
            lastSeen: Date.now(),
          },
        ]);
      }
    );

    return () => unsubscribe();
  }, [profile]);

  // Subscribe to messages
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
        setMessages(newMessages.reverse());
        setTimeout(() => scrollToBottom(), 100);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, "messages")
    );

    return () => unsubscribe();
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!text.trim() && !attachment) return;

    try {
      const msgData: Record<string, any> = {
        uid: profile.uid,
        username: profile.username,
        photoURL: profile.photoURL || "",
        timestamp: Date.now(),
      };

      if (text.trim()) {
        msgData.text = text.trim();
      }
      if (attachment) {
        msgData.attachment = attachment;
      }

      await addDoc(collection(db, "messages"), msgData);
      setText("");
      setAttachment(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, "messages");
    }
  };

  const handleSendGif = async (
    gif: any,
    e: React.SyntheticEvent<HTMLElement, Event>
  ) => {
    e.preventDefault();
    try {
      const msgData: Record<string, any> = {
        uid: profile.uid,
        username: profile.username,
        photoURL: profile.photoURL || "",
        gif: gif.images.fixed_height.url || "",
        timestamp: Date.now(),
      };

      await addDoc(collection(db, "messages"), msgData);
      setShowGiphy(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, "messages");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file.size > 2 * 1024 * 1024) {
        alert("File must be less than 2MB");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setAttachment(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDeleteMessage = async (msgId: string) => {
    try {
      await deleteDoc(doc(db, "messages", msgId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `messages/${msgId}`);
    }
  };

  const fetchGifs = (offset: number) => gf.trending({ offset, limit: 10 });

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

  const activeOnlineUsers = memberUsers.filter((u) => {
    if (u.uid === profile.uid) return true;
    const isRecent = u.lastSeen && Date.now() - u.lastSeen < 60000;
    return u.status === "online" && isRecent;
  });

  const leftUsers = memberUsers.filter((u) => {
    if (u.uid === profile.uid) return false;
    const isRecent = u.lastSeen && Date.now() - u.lastSeen < 60000;
    return u.status === "left" || !isRecent;
  });

  return (
    <div className="flex-1 flex w-full h-full min-h-0 bg-black text-white overflow-hidden">
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

                  {msg.attachment && (
                    <img
                      src={msg.attachment}
                      alt="Attachment"
                      className="rounded-xl mt-2 max-w-xs h-auto border border-neutral-800"
                    />
                  )}
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
          <div className="h-56 overflow-y-auto border-t border-neutral-800 bg-neutral-950 p-2 flex-shrink-0">
            <Grid
              width={320}
              columns={3}
              fetchGifs={fetchGifs}
              onGifClick={handleSendGif}
            />
          </div>
        )}

        {/* Attachment Preview Drawer */}
        {attachment && (
          <div className="p-3 border-t border-neutral-900 bg-neutral-950 flex items-center gap-3 flex-shrink-0">
            <div className="relative inline-block">
              <img
                src={attachment}
                alt="Preview"
                className="h-16 w-16 object-cover rounded-lg border border-neutral-800"
              />
              <button
                onClick={() => setAttachment(null)}
                className="absolute -top-2 -right-2 bg-neutral-900 text-white rounded-full p-1 border border-neutral-700 hover:bg-neutral-800 transition-colors"
              >
                <X size={12} />
              </button>
            </div>
            <span className="text-xs text-neutral-400">
              Image ready to send
            </span>
          </div>
        )}

        {/* Bottom Message Input Bar matching Image 2 */}
        <div className="p-4 bg-black border-t border-neutral-900 flex-shrink-0">
          <form
            onSubmit={handleSendMessage}
            className="bg-neutral-900/90 border border-neutral-800 rounded-xl px-4 py-2.5 flex items-center gap-3 focus-within:border-neutral-700 transition-colors"
          >
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`Message #${activeChannel}...`}
              className="flex-1 bg-transparent text-sm text-white placeholder-neutral-500 focus:outline-none"
            />

            {/* Action Tools: Image, GIF, Send */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-neutral-400 hover:text-white p-1.5 rounded-lg hover:bg-neutral-800 transition-colors"
                title="Attach Image"
              >
                <ImageIcon size={18} />
              </button>
              <input
                type="file"
                accept="image/*"
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
                disabled={!text.trim() && !attachment}
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
        <aside className="w-56 bg-[#080808] border-l border-neutral-900 flex flex-col h-full flex-shrink-0 hidden md:flex">
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
