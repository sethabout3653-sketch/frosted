import React, { useState, useEffect, useRef } from "react";
import {
  MessageSquare,
  Gamepad2,
  Volume2,
  Mic,
  MicOff,
  Video,
  ChevronDown,
  Search,
  LogOut,
  X,
  PhoneOff,
  User as UserIcon,
  Hash,
} from "lucide-react";
import ProfileSetup from "./ProfileSetup";
import ChatPanel from "./ChatPanel";
import VoiceChannel from "./VoiceChannel";
import { ChatProfile, ChatMessage } from "../types";
import { socket } from "../socket";

export default function Chat({
  isOpen,
  onClose,
  onOpenVoiceChat,
  persistent = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  onOpenVoiceChat?: () => void;
  persistent?: boolean;
}) {
  const [profile, setProfile] = useState<ChatProfile | null>(null);
  const [activeChannel, setActiveChannel] = useState("general");
  const [inVoice, setInVoice] = useState(false);
  const [activeVoiceUsers, setActiveVoiceUsers] = useState<Record<string, any>>({});
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);

  useEffect(() => {
    const savedProfile = localStorage.getItem("lumin_chat_profile");
    if (savedProfile) {
      setProfile(JSON.parse(savedProfile));
    }
  }, []);

  useEffect(() => {
    const onVoiceUsers = (users: any[]) => {
      const vMap: Record<string, any> = {};
      users.forEach(u => vMap[u.uid] = u);
      setActiveVoiceUsers(vMap);
    };
    
    socket.on("voice_users", onVoiceUsers);

    return () => {
      socket.off("voice_users", onVoiceUsers);
    };
  }, []);

  const handleProfileComplete = (newProfile: ChatProfile) => {
    setProfile(newProfile);
    localStorage.setItem("lumin_chat_profile", JSON.stringify(newProfile));
  };

  const handleLogout = () => {
    localStorage.removeItem("lumin_chat_profile");
    setProfile(null);
  };

  const joinVoiceChannel = () => {
    setInVoice(true);
    if (onOpenVoiceChat) onOpenVoiceChat();
  };
  
  const leaveVoiceChannel = () => {
    setInVoice(false);
  };

  const toggleMute = () => setIsMuted(!isMuted);
  const toggleDeafen = () => setIsDeafened(!isDeafened);

  if (!isOpen && !persistent) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity ${
        isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !persistent) onClose();
      }}
    >
      <div className="w-full h-full md:w-[90vw] md:h-[90vh] md:max-w-7xl bg-[#080808] md:rounded-2xl border border-neutral-900 shadow-2xl overflow-hidden flex flex-col md:flex-row shadow-black/80">
        
        {/* Mobile Header */}
        <div className="md:hidden flex items-center justify-between p-4 bg-black border-b border-neutral-900">
          <div className="flex items-center gap-2 text-white font-bold">
            <Gamepad2 size={20} className="text-blue-500" />
            LUMIN CHAT
          </div>
          <button onClick={onClose} className="p-2 bg-neutral-900 rounded-full text-white">
            <X size={16} />
          </button>
        </div>

        {!profile ? (
          <div className="flex-1 flex items-center justify-center bg-[#0a0a0a]">
            <ProfileSetup onComplete={handleProfileComplete} />
          </div>
        ) : (
          <>
            {/* Left Sidebar - Channels & Voice */}
            <div className="w-full md:w-64 bg-[#050505] border-r border-neutral-900 flex flex-col flex-shrink-0">
              {/* Server Header */}
              <div className="h-12 border-b border-neutral-900 flex items-center px-4 hover:bg-neutral-900/50 cursor-pointer transition-colors group relative">
                <h1 className="text-[15px] font-extrabold text-white flex-1 tracking-tight truncate">
                  Lumin Game Network
                </h1>
                <ChevronDown size={16} className="text-neutral-500 group-hover:text-white transition-colors" />
              </div>

              {/* Channels List */}
              <div className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
                {/* Text Channels */}
                <div>
                  <h2 className="text-[10px] font-bold text-neutral-500 tracking-wider uppercase mb-1 px-2 flex items-center gap-1 group cursor-pointer hover:text-neutral-300 transition-colors">
                    <ChevronDown size={10} className="transition-transform group-hover:text-neutral-300" />
                    Text Channels
                  </h2>
                  <div className="space-y-[2px]">
                    {["general", "lfg", "memes"].map((channel) => (
                      <button
                        key={channel}
                        onClick={() => setActiveChannel(channel)}
                        className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left transition-colors ${
                          activeChannel === channel
                            ? "bg-neutral-800/80 text-white font-medium"
                            : "text-neutral-400 hover:bg-neutral-900/60 hover:text-neutral-300 font-medium"
                        }`}
                      >
                        <Hash size={18} className={activeChannel === channel ? "text-neutral-400" : "text-neutral-500"} />
                        <span className="text-[15px]">{channel}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Voice Channels */}
                <div>
                  <h2 className="text-[10px] font-bold text-neutral-500 tracking-wider uppercase mb-1 px-2 flex items-center gap-1 group cursor-pointer hover:text-neutral-300 transition-colors">
                    <ChevronDown size={10} className="transition-transform group-hover:text-neutral-300" />
                    Voice Channels
                  </h2>
                  <div className="space-y-[2px]">
                    <div className="space-y-1">
                      <button
                        onClick={joinVoiceChannel}
                        className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left transition-colors ${
                          inVoice
                            ? "bg-emerald-950/30 text-emerald-400 font-medium"
                            : "text-neutral-400 hover:bg-neutral-900/60 hover:text-neutral-300 font-medium"
                        }`}
                      >
                        <Volume2 size={18} className={inVoice ? "text-emerald-500" : "text-neutral-500"} />
                        <span className="text-[15px]">General Voice</span>
                      </button>
                      
                      {/* Active Voice Users list under the channel */}
                      {Object.keys(activeVoiceUsers).length > 0 && (
                        <div className="pl-8 space-y-1">
                          {Object.values(activeVoiceUsers).map((u: any) => (
                            <div key={u.uid} className="flex items-center gap-2 py-0.5 group">
                              <div className="w-5 h-5 rounded-full bg-neutral-800 overflow-hidden border border-neutral-700">
                                {u.photoURL ? (
                                  <img src={u.photoURL} alt={u.username} className="w-full h-full object-cover" />
                                ) : (
                                  <span className="w-full h-full flex items-center justify-center text-[9px] font-bold text-white">
                                    {u.username.charAt(0)}
                                  </span>
                                )}
                              </div>
                              <span className="text-[13px] font-medium text-neutral-400 group-hover:text-neutral-300">
                                {u.username}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Voice Connection Status Bar (if in voice) */}
              {inVoice && (
                <div className="px-2 py-2 border-t border-neutral-900 bg-emerald-950/20">
                  <div className="flex items-center justify-between text-emerald-500 px-2 text-xs font-bold mb-1">
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Voice Connected
                    </span>
                    <button onClick={leaveVoiceChannel} className="text-neutral-400 hover:text-red-400 transition-colors">
                      <PhoneOff size={14} />
                    </button>
                  </div>
                  <div className="text-[10px] text-neutral-500 px-2 uppercase tracking-wider">
                    General Voice
                  </div>
                </div>
              )}

              {/* Bottom User Profile Panel */}
              <div className="h-14 bg-[#050505] border-t border-neutral-900 flex items-center px-2 flex-shrink-0">
                <div className="flex items-center gap-2 px-2 py-1 rounded hover:bg-neutral-800/50 cursor-pointer transition-colors flex-1 min-w-0">
                  <div className="relative">
                    <div className="w-8 h-8 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700">
                      {profile.photoURL ? (
                        <img src={profile.photoURL} alt={profile.username} className="w-full h-full object-cover" />
                      ) : (
                        <span className="w-full h-full flex items-center justify-center text-xs font-bold text-white">
                          {profile.username.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#050505]" />
                  </div>
                  
                  <div className="flex flex-col min-w-0">
                    <span className="text-[13px] font-bold text-white truncate leading-tight">
                      {profile.username}
                    </span>
                    <span className="text-[10px] text-neutral-400 truncate">
                      #LUMIN
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-0.5">
                  <button 
                    onClick={toggleMute}
                    className="p-1.5 rounded text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors group"
                    title={isMuted ? "Unmute" : "Mute"}
                  >
                    {isMuted ? <MicOff size={18} className="text-red-400" /> : <Mic size={18} />}
                  </button>
                  <button 
                    onClick={toggleDeafen}
                    className="p-1.5 rounded text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors"
                    title={isDeafened ? "Undeafen" : "Deafen"}
                  >
                    <Volume2 size={18} />
                  </button>
                  <button onClick={handleLogout} className="p-1.5 rounded text-neutral-400 hover:bg-red-900/40 hover:text-red-400 transition-colors ml-1" title="Log out">
                    <LogOut size={16} />
                  </button>
                </div>
              </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0 relative bg-[#0a0a0a]">
              {/* If in voice chat, overlay the voice UI. Otherwise show text chat */}
              {inVoice ? (
                <VoiceChannel profile={profile} onLeave={leaveVoiceChannel} />
              ) : (
                <ChatPanel activeChannel={activeChannel} profile={profile} />
              )}
            </div>
            
            {/* Desktop Close Button for Modal Mode */}
            {!persistent && (
              <button
                onClick={onClose}
                className="absolute top-4 right-4 z-50 p-2 bg-neutral-900 hover:bg-neutral-800 rounded-full text-white border border-neutral-700 hidden md:block transition-colors"
                title="Close Chat"
              >
                <X size={20} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
