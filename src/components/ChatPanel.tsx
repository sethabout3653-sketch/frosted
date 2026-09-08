import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  Users,
  Send,
  Image as ImageIcon,
  MoreVertical,
  Hash,
  X,
  Smile,
  Trash2,
  MicOff,
  Volume2
} from "lucide-react";
import { ChatProfile, ChatMessage } from "../types";
import { format } from "date-fns";
import GiphyPicker from "./GiphyPicker";
import { socket } from "../socket";

interface ChatPanelProps {
  activeChannel?: string;
  profile: ChatProfile;
  onSelectVoice?: () => void;
  showMembersSidebar?: boolean;
  setShowMembersSidebar?: (show: boolean | ((prev: boolean) => boolean)) => void;
}

export default function ChatPanel({
  activeChannel = "general",
  profile,
  onSelectVoice,
  showMembersSidebar = true,
  setShowMembersSidebar,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [activeOnlineUsers, setActiveOnlineUsers] = useState<any[]>([]);
  const [activeVoiceUsers, setActiveVoiceUsers] = useState<Record<string, any>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachment, setAttachment] = useState<string | null>(null);
  const [showGiphy, setShowGiphy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input automatically
  useEffect(() => {
    inputRef.current?.focus();
  }, [activeChannel]);

  // Socket.io Subscriptions
  useEffect(() => {
    socket.emit("join", profile);

    const onInitMessages = (msgs: ChatMessage[]) => {
      setMessages(msgs);
    };

    const onNewMessage = (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg]);
    };
    
    const onDeleteMessage = (msgId: string) => {
      setMessages(prev => prev.filter(m => m.id !== msgId));
    };

    const onVoiceUsers = (users: any[]) => {
      const map: Record<string, any> = {};
      users.forEach(u => map[u.uid] = u);
      setActiveVoiceUsers(map);
    };

    const onPresence = (users: any[]) => {
      // Deduplicate by uid (in case of multiple tabs)
      const uniqueUsers = Array.from(new Map(users.map(u => [u.uid, u])).values());
      setActiveOnlineUsers(uniqueUsers);
    };

    socket.on("init_messages", onInitMessages);
    socket.on("new_message", onNewMessage);
    socket.on("delete_message", onDeleteMessage);
    socket.on("voice_users", onVoiceUsers);
    socket.on("presence", onPresence);

    return () => {
      socket.off("init_messages", onInitMessages);
      socket.off("new_message", onNewMessage);
      socket.off("delete_message", onDeleteMessage);
      socket.off("voice_users", onVoiceUsers);
      socket.off("presence", onPresence);
    };
  }, [profile]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, showGiphy, attachment]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() && !attachment) return;

    const newMsg: ChatMessage = {
      id: Date.now().toString() + Math.random().toString(36).substring(7),
      uid: profile.uid,
      username: profile.username,
      photoURL: profile.photoURL || undefined,
      text: text.trim(),
      timestamp: Date.now(),
      attachment: attachment || undefined,
    };

    socket.emit("send_message", newMsg);
    setText("");
    setAttachment(null);
    inputRef.current?.focus();
  };

  const handleSendGif = async (gifUrl: string) => {
    const newMsg: ChatMessage = {
      id: Date.now().toString() + Math.random().toString(36).substring(7),
      uid: profile.uid,
      username: profile.username,
      photoURL: profile.photoURL || undefined,
      text: "",
      gif: gifUrl,
      timestamp: Date.now(),
    };
    socket.emit("send_message", newMsg);
    setShowGiphy(false);
  };

  const handleDeleteMessage = async (msgId: string) => {
    socket.emit("delete_message", msgId);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        alert("File size must be under 2MB for this demo.");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setAttachment(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden bg-[#0a0a0a]">
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#0a0a0a]">
        {/* Top Header */}
        <header className="h-12 border-b border-neutral-900 flex items-center justify-between px-4 bg-[#0a0a0a] flex-shrink-0 shadow-sm z-10">
          <div className="flex items-center gap-2">
            <Hash size={20} className="text-neutral-500" />
            <h2 className="text-sm font-bold text-neutral-200">{activeChannel}</h2>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center bg-neutral-900 border border-neutral-800 rounded px-2 py-1">
              <input
                type="text"
                placeholder="Search"
                className="bg-transparent text-xs text-neutral-300 placeholder-neutral-500 focus:outline-none w-32"
              />
              <Search size={14} className="text-neutral-500" />
            </div>
            
            <button
              onClick={() => setShowMembersSidebar?.(!showMembersSidebar)}
              className={`p-1.5 rounded transition-colors ${showMembersSidebar ? 'text-neutral-200 bg-neutral-800' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'}`}
              title="Toggle Members"
            >
              <Users size={18} />
            </button>
          </div>
        </header>

        {/* Messages List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Welcome Message */}
          <div className="mt-8 mb-12 flex flex-col justify-end min-h-[160px]">
            <div className="w-16 h-16 bg-neutral-800 rounded-full flex items-center justify-center mb-4 border border-neutral-700">
              <Hash size={32} className="text-white" />
            </div>
            <h1 className="text-3xl font-extrabold text-white mb-2">Welcome to #{activeChannel}!</h1>
            <p className="text-neutral-400 text-sm">
              This is the start of the #{activeChannel} channel.
            </p>
            <div className="w-full h-px bg-neutral-900 mt-6" />
          </div>

          {messages.map((msg) => {
            const isMe = msg.uid === profile.uid;
            
            return (
              <div key={msg.id} className="group flex gap-4 hover:bg-neutral-900/40 p-2 -mx-2 rounded-lg transition-colors relative">
                {/* Avatar */}
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 mt-0.5">
                    {msg.photoURL ? (
                      <img src={msg.photoURL} alt={msg.username} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-neutral-400 font-bold text-sm">
                        {msg.username.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <span className="font-semibold text-neutral-200 text-sm">
                      {msg.username}
                    </span>
                    <span className="text-[11px] text-neutral-500 font-medium">
                      {format(new Date(msg.timestamp), 'MM/dd/yyyy h:mm a')}
                    </span>
                  </div>
                  
                  {msg.text && (
                    <p className="text-neutral-300 text-[15px] leading-relaxed whitespace-pre-wrap break-words">
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

        {/* Bottom Message Input Bar */}
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

      {/* Right Members Sidebar ("ONLINE — N" & "OFFLINE / LEFT — N") */}
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
