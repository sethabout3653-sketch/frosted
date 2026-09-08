import React, { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
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
  const [currentTime, setCurrentTime] = useState<number>(Date.now());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 1-second tick to continuously evaluate active vs dead/lagging peers in real-time
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Real-time listener for voice users via Supabase
  useEffect(() => {
    let mounted = true;
    const fetchVoiceUsers = async () => {
      const { data } = await supabase.from("voice_users").select("*");
      if (!mounted || !data) return;
      setActiveVoiceUsers(
        Object.fromEntries(
          data.map((d: any) => [d.uid, d])
        )
      );
    };
    fetchVoiceUsers();

    const channel = supabase
      .channel("panel_voice_users")
      .on("postgres_changes", { event: "*", schema: "public", table: "voice_users" }, () => {
        fetchVoiceUsers();
      })
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  // Presence & Left Website tracking with fast 2.5s heartbeat via Supabase
  useEffect(() => {
    if (!profile) return;

    const markOnline = async () => {
      try {
        await supabase.from("presence").upsert({
          uid: profile.uid,
          username: profile.username,
          photo_url: profile.photoURL || "",
          status: "online",
          last_seen: Date.now(),
        }, { onConflict: "uid" });
      } catch (e) {}
    };

    const markLeft = async () => {
      try {
        await supabase.from("presence").upsert({
          uid: profile.uid,
          username: profile.username,
          photo_url: profile.photoURL || "",
          status: "left",
          last_seen: Date.now(),
          in_voice: false,
        }, { onConflict: "uid" });
      } catch (e) {}
    };

    markOnline();
    const interval = setInterval(markOnline, 2500); // 2.5s rapid heartbeat for real-time accuracy

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

  // Real-time member presence listener via Supabase
  useEffect(() => {
    let mounted = true;
    const fetchPresence = async () => {
      const { data } = await supabase.from("presence").select("*").limit(40);
      if (!mounted || !data) return;
      const users: MemberUser[] = data.map((d: any) => ({
        uid: d.uid,
        username: d.username || "Anonymous",
        photoURL: d.photo_url || d.photoURL || "",
        status: d.status || "online",
        lastSeen: d.last_seen || d.lastSeen,
        isMuted: d.is_muted || d.isMuted || false,
        inVoice: d.in_voice || d.inVoice || false,
      }));

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
    };

    fetchPresence();

    const channel = supabase
      .channel("panel_presence")
      .on("postgres_changes", { event: "*", schema: "public", table: "presence" }, () => {
        fetchPresence();
      })
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [profile]);

  // Real-time message subscription with instant local rendering via Supabase
  useEffect(() => {
    let mounted = true;
    const fetchMessages = async () => {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .order("timestamp", { ascending: false })
        .limit(50);

      if (!mounted || !data) return;
      const reversed = [...data].reverse();

      setMessages((prev) => {
        // Keep any local optimistic messages that haven't arrived in the query yet
        const pending = prev.filter(
          (m) =>
            m.id.startsWith("temp_") &&
            !reversed.some(
              (sm: any) =>
                sm.uid === m.uid &&
                Math.abs(sm.timestamp - m.timestamp) < 6000 &&
                (sm.text === m.text || sm.gif === m.gif || sm.attachment === m.attachment)
            )
        );
        return [...reversed, ...pending];
      });
      window.setTimeout(() => scrollToBottom(), 50);
    };

    fetchMessages();

    const channel = supabase
      .channel("panel_messages")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        fetchMessages();
      })
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const currentText = text.trim();
    const currentAttachment = attachment;
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
      ...(currentAttachment ? { attachment: currentAttachment } : {}),
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setText("");
    setAttachment(null);
    inputRef.current?.focus();
    window.setTimeout(() => scrollToBottom(), 10);

    try {
      const msgData: Record<string, any> = {
        id: "msg_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8),
        uid: profile.uid,
        username: profile.username,
        photo_url: profile.photoURL || "",
        timestamp: now,
      };

      if (currentText) {
        msgData.text = currentText;
      }
      if (currentAttachment) {
        msgData.attachment = currentAttachment;
      }

      await supabase.from("messages").insert(msgData);
    } catch (error) {
      // Revert optimistic message if writing failed
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      console.warn("Error inserting message:", error);
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
        id: "msg_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8),
        uid: profile.uid,
        username: profile.username,
        photo_url: profile.photoURL || "",
        gif: gifUrl,
        timestamp: now,
      };

      await supabase.from("messages").insert(msgData);
    } catch (error) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      console.warn("Error inserting gif message:", error);
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
    // Optimistically remove from view immediately
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
    try {
      await supabase.from("messages").delete().eq("id", msgId);
    } catch (error) {
      console.warn("Error deleting message:", error);
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
  // within a few seconds (7s) they will not be shown as online.
  const activeOnlineUsers = memberUsers.filter((u) => {
    if (u.uid === profile.uid) return true;
    const isRecent = typeof u.lastSeen === "number" && currentTime - u.lastSeen < 7000;
    return u.status === "online" && isRecent;
  });

  const leftUsers = memberUsers.filter((u) => {
    if (u.uid === profile.uid) return false;
    const isRecent = typeof u.lastSeen === "number" && currentTime - u.lastSeen < 7000;
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
          <GiphyPicker
            onSelectGif={handleSendGif}
            onClose={() => setShowGiphy(false)}
          />
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
        <div className="px-4 pt-3 pb-2 sm:pb-2.5 bg-black border-t border-neutral-900 flex-shrink-0">
          <form
            onSubmit={handleSendMessage}
            className="bg-neutral-900/90 border border-neutral-800 rounded-xl px-4 py-2.5 flex items-center gap-3 focus-within:border-neutral-700 transition-colors"
          >
            <input
              ref={inputRef}
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
