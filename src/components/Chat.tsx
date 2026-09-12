import React, { useState, useEffect, useRef } from "react";
import {
  MessageSquare,
  Gamepad2,
  Volume2,
  Mic,
  MicOff,
  Video,
  MonitorUp,
  ChevronDown,
  Search,
  LogOut,
  X,
  PhoneOff,
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
  onSnapshot,
  where,
  writeBatch,
  deleteDoc,
  updateDoc,
  doc,
  db,
  handleFirestoreError,
  OperationType,
  toTimestampMs,
} from "../firebase";

export default function Chat({
  isOpen,
  onClose,
  onOpenVoiceChat,
  persistent = false,
}: {
  isOpen?: boolean;
  onClose?: () => void;
  onOpenVoiceChat?: () => void;
  persistent?: boolean;
}) {
  const [profile, setProfile] = useState<ChatProfile | null>(() => {
    try {
      const saved = localStorage.getItem("frosted_chat_profile");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.username && parsed.username.trim().toLowerCase() !== "anonymous") {
          return parsed;
        }
        localStorage.removeItem("frosted_chat_profile");
      }
    } catch (e) {}
    return null;
  });

  const [activeTab, setActiveTab] = useState<"chat" | "voice" | "profile">("chat");
  const [isInVoiceSession, setIsInVoiceSession] = useState(false);
  const [activeChannel, setActiveChannel] = useState<string>("general");
  const [channelSearch, setChannelSearch] = useState<string>("");
  const [showMembersSidebar, setShowMembersSidebar] = useState<boolean>(true);
  const [notification, setNotification] = useState<ChatMessage | null>(null);
  const messageSoundRef = useRef<HTMLAudioElement | null>(null);

  const [currentTime, setCurrentTime] = useState<number>(Date.now());
  const [rawVoiceUsers, setRawVoiceUsers] = useState<
    Array<{
      uid: string;
      username: string;
      photoURL: string;
      isMuted?: boolean;
      isVideoOn?: boolean;
      isScreenSharing?: boolean;
      isScreenAudioOn?: boolean;
      timestamp?: number;
      lastSeen?: number;
    }>
  >([]);

  // 1-second tick to continuously drop dead/disconnected users within a few seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Filter out anonymous users and sort the active list
  const voiceUsers = rawVoiceUsers
    .filter((u) => {
      if (!u || !u.uid) return false;
      const uname = (u.username || "").trim();
      if (!uname || uname.toLowerCase() === "anonymous" || uname.toLowerCase() === "guest") return false;
      return true;
    })
    .sort((a, b) => {
      if (!a || !b) return 0;
      if (profile && a.uid === profile.uid) return -1;
      if (profile && b.uid === profile.uid) return 1;
      const nameCompare = (a.username || "").localeCompare(b.username || "");
      if (nameCompare !== 0) return nameCompare;
      return (a.uid || "").localeCompare(b.uid || "");
    });

  const sessionStartRef = useRef(Date.now());
  const isOpenRef = useRef(isOpen);
  const profileRef = useRef(profile);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const initialSnapshotProcessedRef = useRef<boolean>(false);
  const notificationTimeoutRef = useRef<any>(null);

  // Real-time listener for voice users combining voice_users and presence collections
  useEffect(() => {
    let latestVoiceDocs: any[] = [];
    let latestPresenceDocs: any[] = [];

    const mergeAndSetVoiceUsers = () => {
      const now = Date.now();
      const userMap = new Map<string, any>();

      // 1. Ingest from voice_users collection
      latestVoiceDocs.forEach((d) => {
        const data = d.data();
        const uname = (data?.username || "").trim();
        if (!data?.uid || !uname || uname.toLowerCase() === "anonymous" || uname.toLowerCase() === "guest") {
          return;
        }
        const ts = toTimestampMs(data.timestamp || data.lastSeen);
        if (ts > 0 && now - ts <= 7000) {
          userMap.set(data.uid, { ...data, timestamp: ts });
        }
      });

      // 2. Ingest from presence collection (users who have inVoice: true)
      latestPresenceDocs.forEach((d) => {
        const data = d.data();
        const uname = (data?.username || "").trim();
        if (!data?.uid || !uname || uname.toLowerCase() === "anonymous" || uname.toLowerCase() === "guest") {
          return;
        }
        if (data.inVoice) {
          const ts = toTimestampMs(data.lastSeen || data.timestamp);
          if (ts > 0 && now - ts <= 7000) {
            const existing = userMap.get(data.uid);
            userMap.set(data.uid, {
              uid: data.uid,
              username: uname,
              photoURL: data.photoURL || existing?.photoURL || "",
              isMuted: data.isMuted !== undefined ? data.isMuted : existing?.isMuted ?? false,
              isVideoOn: data.isVideoOn !== undefined ? data.isVideoOn : existing?.isVideoOn ?? false,
              isScreenSharing: data.isScreenSharing !== undefined ? data.isScreenSharing : existing?.isScreenSharing ?? false,
              isScreenAudioOn: data.isScreenAudioOn !== undefined ? data.isScreenAudioOn : existing?.isScreenAudioOn ?? false,
              timestamp: Math.max(ts, existing?.timestamp || 0),
            });
          }
        }
      });

      setRawVoiceUsers(Array.from(userMap.values()));
    };

    const unsubVoiceUsers = onSnapshot(
      collection(db, "voice_users"),
      (snapshot) => {
        latestVoiceDocs = snapshot.docs;
        mergeAndSetVoiceUsers();
      },
      (error) => {
        console.warn("Chat voice_users listener error:", error);
      }
    );

    const unsubPresence = onSnapshot(
      collection(db, "presence"),
      (snapshot) => {
        latestPresenceDocs = snapshot.docs;
        mergeAndSetVoiceUsers();
      },
      (error) => {
        console.warn("Chat presence listener error:", error);
      }
    );

    return () => {
      unsubVoiceUsers();
      unsubPresence();
    };
  }, [profile?.uid]);

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  // Ensure local user presence is marked as not in voice when disconnected
  useEffect(() => {
    if (!isInVoiceSession && profile?.uid) {
      deleteDoc(doc(db, "voice_users", profile.uid)).catch(() => {});
      updateDoc(doc(db, "presence", profile.uid), {
        inVoice: false,
        isMuted: false,
        isVideoOn: false,
        isScreenSharing: false,
      }).catch(() => {});
    }
  }, [isInVoiceSession, profile?.uid]);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  // Real-time message listener for instant audio & toast notifications
  useEffect(() => {
    const q = query(
      collection(db, "messages"),
      orderBy("timestamp", "desc"),
      limit(5)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (snapshot.empty) {
          initialSnapshotProcessedRef.current = true;
          return;
        }

        // On the very first snapshot, register all existing messages as seen and never play sound
        if (!initialSnapshotProcessedRef.current) {
          initialSnapshotProcessedRef.current = true;
          snapshot.docs.forEach((d) => {
            seenMessageIdsRef.current.add(d.id);
          });
          return;
        }

        const currentProfile = profileRef.current;
        const now = Date.now();

        snapshot.docs.forEach((docSnap) => {
          const msgId = docSnap.id;
          if (seenMessageIdsRef.current.has(msgId)) {
            return;
          }
          seenMessageIdsRef.current.add(msgId);

          const rawData = docSnap.data() as any;
          const msg = { id: msgId, ...rawData } as ChatMessage;
          const msgTime = toTimestampMs(msg.timestamp);

          // Strictly ignore any message created before this session/tab was loaded
          if (!msgTime || msgTime < sessionStartRef.current) {
            return;
          }

          const ageMs = now - msgTime;
          // Only trigger notification & sound if message was just sent (within 15 seconds)
          // If it was sent a long time ago, don't do notification and sound
          if (ageMs > 15000 || ageMs < -5000) {
            return;
          }

          const isMe =
            currentProfile &&
            (msg.uid === currentProfile.uid ||
              (msg.username === currentProfile.username &&
                msg.photoURL === currentProfile.photoURL));

          if (!isMe) {
            try {
              messageSoundRef.current ||= new Audio("/audio/discord_sound.mp3");
              messageSoundRef.current.currentTime = 0;
              messageSoundRef.current.volume = 0.8;
              messageSoundRef.current.play().catch(() => {});
            } catch (e) {}

            if (!isOpenRef.current) {
              if (notificationTimeoutRef.current) {
                clearTimeout(notificationTimeoutRef.current);
              }
              setNotification(msg);
              notificationTimeoutRef.current = setTimeout(() => {
                setNotification(null);
                notificationTimeoutRef.current = null;
              }, 4000);
            }
          }
        });
      },
      (error) => {
        console.warn("Chat notifications listener error:", error);
      }
    );

    return () => {
      unsubscribe();
      if (notificationTimeoutRef.current) {
        clearTimeout(notificationTimeoutRef.current);
      }
    };
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
        const batch = writeBatch();
        snapshot.docs.forEach((d) => {
          batch.update(doc(db, "messages", d.id), {
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

  return (
    <>
      {/* 1. Main Discord Chat Shell (only shown when chat is open) */}
      {isOpen && (
        <div className="flex-1 w-full flex bg-black/95 border border-neutral-900 animate-in fade-in min-h-0 overflow-hidden text-white backdrop-blur-xl">
          {!profile || activeTab === "profile" ? (
            /* If not logged in or editing profile, show Profile Setup modal */
            <div className="flex-1 w-full flex items-center justify-center bg-black">
              <ProfileSetup
                initialUsername={profile?.username}
                initialPhotoURL={profile?.photoURL}
                onComplete={handleProfileComplete}
                onCancel={profile ? () => setActiveTab("chat") : undefined}
              />
            </div>
          ) : (
            /* Discord Main App Shell */
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
                    onClick={() => {
                      setActiveTab("voice");
                      setIsInVoiceSession(true);
                    }}
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
                      {voiceUsers.map((vUser, vIdx) => (
                        <div
                          key={`${vUser.uid || "vuser"}-${vIdx}`}
                          className="flex items-center justify-between py-1 px-1.5 rounded text-xs text-neutral-300 hover:bg-neutral-900/60 transition-colors"
                        >
                          <div className="flex items-center gap-2 truncate">
                            {vUser.photoURL ? (
                              <img
                                src={vUser.photoURL}
                                alt={vUser.username || "User"}
                                className="w-4 h-4 rounded-full object-cover border border-neutral-700 flex-shrink-0"
                              />
                            ) : (
                              <div className="w-4 h-4 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-[9px] font-bold flex-shrink-0">
                                {(vUser.username || "?").charAt(0).toUpperCase()}
                              </div>
                            )}
                            <span className="truncate text-[11px] font-medium text-neutral-300">
                              {vUser.username || "User"}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {vUser.isScreenSharing && (
                              <span className="flex items-center gap-0.5 text-[9px] font-extrabold text-emerald-400 bg-emerald-950/90 border border-emerald-700/80 px-1 py-0.2 rounded shadow-sm animate-pulse">
                                <MonitorUp size={10} />
                                <span>LIVE</span>
                              </span>
                            )}
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

            {/* Discord Voice Connected Bar in Left Sidebar when viewing text chat */}
            {isInVoiceSession && activeTab === "chat" && (
              <div className="px-3 py-2 border-t border-neutral-900/90 bg-[#0d0e10] flex items-center justify-between">
                <button
                  onClick={() => setActiveTab("voice")}
                  className="flex items-center gap-2 text-left cursor-pointer group min-w-0 flex-1"
                  title="Switch to Voice Channel"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-emerald-400 group-hover:underline truncate">
                      Voice Connected
                    </p>
                    <p className="text-[10px] text-neutral-400 truncate">
                      General Voice
                    </p>
                  </div>
                </button>
                <button
                  onClick={() => {
                    if (profile?.uid) {
                      deleteDoc(doc(db, "voice_users", profile.uid)).catch(() => {});
                      updateDoc(doc(db, "presence", profile.uid), {
                        inVoice: false,
                        isMuted: false,
                      }).catch(() => {});
                      setRawVoiceUsers((prev) => prev.filter((u) => u.uid !== profile.uid));
                    }
                    setIsInVoiceSession(false);
                  }}
                  className="p-1.5 text-neutral-400 hover:text-rose-400 rounded-md hover:bg-neutral-800 transition-colors cursor-pointer flex-shrink-0 ml-1"
                  title="Disconnect from Voice"
                >
                  <PhoneOff size={14} />
                </button>
              </div>
            )}

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
                className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
                title="Edit Profile"
              >
                <UserIcon size={15} />
              </button>
            </div>
          </aside>

          {/* Column 3 & 4: Main Chat view */}
          <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden bg-black relative">
            <ChatPanel
              profile={profile}
              activeChannel={activeChannel}
              onSelectVoice={() => {
                setActiveTab("voice");
                setIsInVoiceSession(true);
              }}
              showMembersSidebar={showMembersSidebar}
              setShowMembersSidebar={setShowMembersSidebar}
            />
          </div>
        </div>
      )}
    </div>
  )}

  {/* 2. Persistent Single VoiceChannel Instance: stays alive continuously across text/voice tabs and chat open/close */}
  {profile && isInVoiceSession && (
    <VoiceChannel
      profile={profile}
      isPip={!isOpen || activeTab !== "voice"}
      onExpand={() => {
        setActiveTab("voice");
        onOpenVoiceChat?.();
      }}
      onLeave={() => {
        if (profile?.uid) {
          deleteDoc(doc(db, "voice_users", profile.uid)).catch(() => {});
          updateDoc(doc(db, "presence", profile.uid), {
            inVoice: false,
            isMuted: false,
          }).catch(() => {});
          setRawVoiceUsers((prev) => prev.filter((u) => u.uid !== profile.uid));
        }
        setIsInVoiceSession(false);
        setActiveTab("chat");
      }}
    />
  )}

  {/* 3. Toast notification when chat is closed */}
  {!isOpen && notification && (
    <div className="fixed top-6 right-6 z-50 bg-neutral-900 border border-neutral-800 rounded-2xl p-4 shadow-2xl flex items-center gap-4 animate-in slide-in-from-top fade-in hover:bg-neutral-800 transition-colors cursor-pointer">
      <div
        className="flex items-center gap-3"
        onClick={() => {
          setNotification(null);
          onOpenVoiceChat?.();
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
        className="text-neutral-500 hover:text-white p-1 rounded-full transition-colors cursor-pointer"
      >
        <X size={16} />
      </button>
    </div>
  )}
</>
);
}
