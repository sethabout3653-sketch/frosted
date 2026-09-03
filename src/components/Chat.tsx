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
  User as UserIcon,
} from "lucide-react";
import ProfileSetup from "./ProfileSetup";
import ChatPanel from "./ChatPanel";
import VoiceChannel from "./VoiceChannel";
import { ChatProfile, ChatMessage } from "../types";
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  where,
  writeBatch,
  deleteDoc,
  doc,
} from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";

export default function Chat({
  isOpen,
  onClose,
}: {
  isOpen?: boolean;
  onClose?: () => void;
}) {
  const [profile, setProfile] = useState<ChatProfile | null>(() => {
    try {
      const saved = localStorage.getItem("frosted_chat_profile");
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return null;
  });

  const [activeTab, setActiveTab] = useState<"chat" | "voice" | "profile">(
    "chat"
  );
  const [activeChannel, setActiveChannel] = useState<string>("general");
  const [channelSearch, setChannelSearch] = useState<string>("");
  const [showMembersSidebar, setShowMembersSidebar] = useState<boolean>(true);
  const [notification, setNotification] = useState<ChatMessage | null>(null);
  const [voiceUsers, setVoiceUsers] = useState<
    Array<{
      uid: string;
      username: string;
      photoURL: string;
      isMuted?: boolean;
      isVideoOn?: boolean;
    }>
  >([]);

  const sessionStartRef = useRef(Date.now());
  const isOpenRef = useRef(isOpen);
  const profileRef = useRef(profile);

  // Poll voice presence over normal HTTPS instead of opening a realtime socket.
  useEffect(() => {
    let cancelled = false;
    const loadVoiceUsers = async () => {
      try {
        const snapshot = await getDocs(collection(db, "voice_users"));
        if (!cancelled) setVoiceUsers(snapshot.docs.map((d) => d.data() as any));
      } catch {
        if (!cancelled) setVoiceUsers([]);
      }
    };
    loadVoiceUsers();
    const interval = window.setInterval(loadVoiceUsers, 10000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  // Global message listener for notifications
  useEffect(() => {
    const q = query(
      collection(db, "messages"),
      orderBy("timestamp", "desc"),
      limit(1)
    );
    let cancelled = false;
    let lastMessageId: string | null = null;
    const checkForMessage = async () => {
      try {
        const snapshot = await getDocs(q);
        const newest = snapshot.docs[0];
        if (!newest || cancelled || newest.id === lastMessageId) return;
        lastMessageId = newest.id;
        const msg = { id: newest.id, ...newest.data() } as ChatMessage;
        if (msg.timestamp < sessionStartRef.current) return;
        const currentProfile = profileRef.current;
        const isMe = currentProfile && (msg.uid === currentProfile.uid || (msg.username === currentProfile.username && msg.photoURL === currentProfile.photoURL));
        if (!isOpenRef.current && !isMe) {
          setNotification(msg);
          setTimeout(() => setNotification(null), 4000);
        }
      } catch {}
    };
    checkForMessage();
    const interval = window.setInterval(checkForMessage, 5000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

  const handleProfileComplete = async (p: {
    username: string;
    photoURL: string;
  }) => {
    const newProfile: ChatProfile = {
      uid:
        profile?.uid || "user_" + Math.random().toString(36).substring(2, 11),
      username: p.username,
      photoURL: p.photoURL,
    };
    setProfile(newProfile);
    try {
      localStorage.setItem("frosted_chat_profile", JSON.stringify(newProfile));
    } catch (e) {}
    setActiveTab("chat");

    // Update previous messages
    try {
      const q = query(
        collection(db, "messages"),
        where("uid", "==", newProfile.uid)
      );
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const batch = writeBatch(db);
        snapshot.docs.forEach((doc) => {
          batch.update(doc.ref, {
            username: newProfile.username,
            photoURL: newProfile.photoURL,
          });
        });
        await batch.commit();
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, "messages");
    }
  };

  const handleLogoutProfile = () => {
    try {
      localStorage.removeItem("frosted_chat_profile");
    } catch (e) {}
    setProfile(null);
    setActiveTab("profile");
  };

  if (!isOpen) {
    return (
      <>
        {/* Toast notification when chat is closed */}
        {notification && (
          <div className="fixed top-6 right-6 z-50 bg-neutral-900 border border-neutral-800 rounded-2xl p-4 shadow-2xl flex items-center gap-4 animate-in slide-in-from-top fade-in hover:bg-neutral-800 transition-colors cursor-pointer">
            <div
              className="flex items-center gap-3"
              onClick={() => {
                setNotification(null);
              }}
            >
              <img
                src={notification.photoURL}
                alt=""
                className="w-10 h-10 rounded-full object-cover"
              />
              <div className="flex flex-col">
                <span className="text-xs font-bold text-white">
                  {notification.username} sent a message
                </span>
                <span className="text-sm text-neutral-400 line-clamp-1">
                  {notification.text ||
                    (notification.gif ? "Sent a GIF" : "Sent an attachment")}
                </span>
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setNotification(null);
              }}
              className="text-neutral-500 hover:text-white p-1 rounded-full transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex-1 w-full flex bg-black border-t border-neutral-900 animate-in fade-in h-full min-h-0 overflow-hidden text-white">
      {!profile || activeTab === "profile" ? (
        /* If not logged in or editing profile, show Profile Setup modal (Image 3 style) */
        <div className="flex-1 w-full flex items-center justify-center bg-black">
          <ProfileSetup
            initialUsername={profile?.username}
            initialPhotoURL={profile?.photoURL}
            onComplete={handleProfileComplete}
            onCancel={profile ? () => setActiveTab("chat") : undefined}
          />
        </div>
      ) : (
        /* Discord Main App Shell matching Image 2 */
        <div className="flex-1 flex w-full h-full overflow-hidden">
          {/* Column 1: Leftmost Narrow Server Rail (~60px) matching Image 2 */}
          <aside className="w-16 bg-[#050505] border-r border-neutral-900 flex flex-col items-center justify-between py-4 flex-shrink-0 z-20">
            {/* Top Gamepad Button (Go back to games list) */}
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={onClose}
                className="w-11 h-11 rounded-2xl bg-neutral-900 border border-neutral-800/80 text-neutral-400 hover:text-white hover:bg-neutral-800 flex items-center justify-center transition-all cursor-pointer shadow-sm group"
                title="Return to Games Catalog"
              >
                <Gamepad2 size={20} className="group-hover:scale-110 transition-transform" />
              </button>

              <div className="w-8 h-[1px] bg-neutral-900/90 my-1" />

              {/* Active Chat Button (White Squircle with MessageSquare icon) */}
              <button
                onClick={() => setActiveTab("chat")}
                className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-all cursor-pointer shadow-lg ${
                  activeTab === "chat"
                    ? "bg-white text-black scale-105"
                    : "bg-neutral-900 text-neutral-400 hover:text-white hover:bg-neutral-800"
                }`}
                title="Community Chat"
              >
                <MessageSquare size={20} strokeWidth={2.2} />
              </button>
            </div>

            {/* Bottom User Avatar & Logout */}
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={() => setActiveTab("profile")}
                className="relative group cursor-pointer"
                title="Edit Profile"
              >
                <div className="w-10 h-10 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 group-hover:border-white transition-colors">
                  <img
                    src={profile.photoURL}
                    alt={profile.username}
                    className="w-full h-full object-cover"
                  />
                </div>
                {/* Green online dot badge */}
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[#050505]" />
              </button>

              <button
                onClick={handleLogoutProfile}
                className="p-2 text-neutral-500 hover:text-red-400 transition-colors rounded-lg hover:bg-neutral-900"
                title="Switch Profile / Logout"
              >
                <LogOut size={16} />
              </button>
            </div>
          </aside>

          {/* Column 2: Channels Sidebar (~220px) matching Image 2 */}
          <aside className="w-56 bg-[#0a0a0a] border-r border-neutral-900/90 flex flex-col h-full flex-shrink-0 hidden sm:flex">
            {/* Top Channel Search */}
            <div className="p-3 border-b border-neutral-900/90">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-500" />
                <input
                  type="text"
                  value={channelSearch}
                  onChange={(e) => setChannelSearch(e.target.value)}
                  placeholder="Find a channel"
                  className="w-full bg-neutral-900/90 border border-neutral-800/80 text-xs text-white placeholder-neutral-500 rounded-md pl-8 pr-2.5 py-1.5 focus:outline-none focus:border-neutral-700 transition-colors"
                />
              </div>
            </div>

            {/* Channels & Voice Navigation */}
            <div className="flex-1 overflow-y-auto p-2 space-y-4">
              {/* CHANNELS Section */}
              <div>
                <div className="flex items-center gap-1 text-[10px] font-bold text-neutral-500 tracking-wider uppercase px-2.5 py-1.5">
                  <ChevronDown size={12} />
                  <span>CHANNELS</span>
                </div>
                <div className="space-y-0.5 mt-0.5">
                  <button
                    onClick={() => {
                      setActiveTab("chat");
                      setActiveChannel("general");
                    }}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                      activeTab === "chat" && activeChannel === "general"
                        ? "bg-neutral-800/90 text-white"
                        : "text-neutral-400 hover:bg-neutral-900 hover:text-white"
                    }`}
                  >
                    <span className="text-base text-neutral-500 font-bold">#</span>
                    <span>general</span>
                  </button>
                </div>
              </div>

              {/* VOICE Section */}
              <div>
                <div className="flex items-center gap-1 text-[10px] font-bold text-neutral-500 tracking-wider uppercase px-2.5 py-1.5">
                  <ChevronDown size={12} />
                  <span>VOICE</span>
                </div>
                <div className="space-y-0.5 mt-0.5">
                  <button
                    onClick={() => setActiveTab("voice")}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                      activeTab === "voice"
                        ? "bg-neutral-800/90 text-white"
                        : "text-neutral-400 hover:bg-neutral-900 hover:text-white"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Volume2
                        size={15}
                        className={
                          activeTab === "voice"
                            ? "text-emerald-400"
                            : "text-neutral-400"
                        }
                      />
                      <span>General Voice</span>
                    </div>
                    {voiceUsers.length > 0 && (
                      <span className="text-[10px] font-bold bg-neutral-800 text-neutral-300 px-1.5 py-0.2 rounded-full border border-neutral-700">
                        {voiceUsers.length}
                      </span>
                    )}
                  </button>

                  {/* Users currently in General Voice */}
                  {voiceUsers.length > 0 && (
                    <div className="ml-4 pl-2 border-l border-neutral-800/80 my-1 space-y-1">
                      {voiceUsers.map((vUser) => (
                        <div
                          key={vUser.uid}
                          className="flex items-center justify-between py-1 px-1.5 rounded text-xs text-neutral-300 hover:bg-neutral-900/60 transition-colors"
                        >
                          <div className="flex items-center gap-2 truncate">
                            {vUser.photoURL ? (
                              <img
                                src={vUser.photoURL}
                                alt={vUser.username}
                                className="w-4 h-4 rounded-full object-cover border border-neutral-700 flex-shrink-0"
                              />
                            ) : (
                              <div className="w-4 h-4 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-[9px] font-bold flex-shrink-0">
                                {vUser.username.charAt(0).toUpperCase()}
                              </div>
                            )}
                            <span className="truncate text-[11px] font-medium text-neutral-300">
                              {vUser.username}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {vUser.isVideoOn && (
                              <Video size={11} className="text-emerald-400" />
                            )}
                            {vUser.isMuted ? (
                              <MicOff size={11} className="text-red-400" />
                            ) : (
                              <Mic size={11} className="text-emerald-400" />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Bottom User Bar matching Image 2 */}
            <div className="p-3 border-t border-neutral-900/90 bg-[#080808] flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="relative">
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700">
                    <img
                      src={profile.photoURL}
                      alt={profile.username}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#080808]" />
                </div>
                <span className="text-xs font-bold text-white truncate max-w-[100px]">
                  {profile.username}
                </span>
              </div>

              <button
                onClick={() => setActiveTab("profile")}
                className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
                title="Edit Profile"
              >
                <UserIcon size={15} />
              </button>
            </div>
          </aside>

          {/* Column 3 & 4: Main Chat view or Voice view */}
          <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden bg-black">
            {activeTab === "chat" ? (
              <ChatPanel
                profile={profile}
                activeChannel={activeChannel}
                onSelectVoice={() => setActiveTab("voice")}
                showMembersSidebar={showMembersSidebar}
                setShowMembersSidebar={setShowMembersSidebar}
              />
            ) : (
              <VoiceChannel
                profile={profile}
                onLeave={() => setActiveTab("chat")}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
