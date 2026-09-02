import React, { useState, useEffect, useRef } from "react";
import { MessageSquare, Users, X, Mic } from "lucide-react";
import ProfileSetup from "./ProfileSetup";
import ChatPanel from "./ChatPanel";
import { ChatProfile, ChatMessage } from "../types";
import { collection, query, orderBy, limit, onSnapshot, getDocs, where, writeBatch } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";

import VoiceChannel from "./VoiceChannel";

export default function Chat({ isOpen, onClose }: { isOpen?: boolean, onClose?: () => void }) {
  const [profile, setProfile] = useState<ChatProfile | null>(() => {
    try {
      const saved = localStorage.getItem("frosted_chat_profile");
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return null;
  });
  const [activeTab, setActiveTab] = useState<"chat" | "voice" | "profile">("chat");
  const [notification, setNotification] = useState<ChatMessage | null>(null);
  const [inVoice, setInVoice] = useState(false);

  const sessionStartRef = useRef(Date.now());
  const isOpenRef = useRef(isOpen);
  const profileRef = useRef(profile);

  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);
  useEffect(() => { profileRef.current = profile; }, [profile]);

  // Global message listener for notifications
  useEffect(() => {
    const q = query(collection(db, "messages"), orderBy("timestamp", "desc"), limit(1));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const msg = { id: change.doc.id, ...change.doc.data() } as ChatMessage;
          
          // Only notify for messages sent AFTER the session started (ignore initial load/refresh)
          if (msg.timestamp < sessionStartRef.current) return;

          const currentProfile = profileRef.current;
          const isMe = currentProfile && (
            msg.uid === currentProfile.uid || 
            (msg.username === currentProfile.username && msg.photoURL === currentProfile.photoURL)
          );

          // Don't notify if panel is open or if it's our own message
          if (!isOpenRef.current && !isMe) {
            setNotification(msg);
            setTimeout(() => setNotification(null), 4000);
          }
        }
      });
    });
    return () => unsubscribe();
  }, []);

  const handleProfileComplete = async (p: { username: string; photoURL: string }) => {
    const newProfile: ChatProfile = {
      uid: profile?.uid || "user_" + Math.random().toString(36).substring(2, 11),
      username: p.username,
      photoURL: p.photoURL
    };
    setProfile(newProfile);
    try {
      localStorage.setItem("frosted_chat_profile", JSON.stringify(newProfile));
    } catch (e) {}
    setActiveTab("chat");

    // Update all previous messages sent by this user globally
    try {
      const q = query(collection(db, "messages"), where("uid", "==", newProfile.uid));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const batch = writeBatch(db);
        snapshot.docs.forEach((doc) => {
          batch.update(doc.ref, { 
            username: newProfile.username, 
            photoURL: newProfile.photoURL 
          });
        });
        await batch.commit();
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, "messages");
    }
  };

  return (
    <>
      {/* Global Notification Toast */}
      {notification && !isOpen && (
        <div 
          className="fixed top-6 right-6 z-50 bg-neutral-900 border border-neutral-800 rounded-xl p-4 shadow-2xl flex items-center gap-4 animate-in slide-in-from-top fade-in hover:bg-neutral-800 transition-colors"
        >
          <div 
            className="flex items-center gap-4 cursor-pointer"
            onClick={() => {
              if (onClose) onClose(); // Just let it close or trigger open in parent? 
              // Wait, the notification should ideally tell the parent to open the chat. 
              // Wait, since we don't have an onOpen prop, let's just clear the notification for now.
              setNotification(null);
            }}
          >
            <img src={notification.photoURL} alt="" className="w-10 h-10 rounded-full object-cover" />
            <div className="flex flex-col">
              <span className="text-xs font-bold text-white">{notification.username} sent a message</span>
              <span className="text-sm text-neutral-400 line-clamp-1">{notification.text || (notification.gif ? 'Sent a GIF' : 'Sent an attachment')}</span>
            </div>
          </div>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setNotification(null);
            }}
            className="ml-2 text-neutral-500 hover:text-white p-1 rounded-full transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Main Chat Page (instead of overlay drawer) */}
      {isOpen && (
        <div className="flex-1 w-full max-w-7xl mx-auto flex flex-col bg-black border-x border-neutral-900 animate-in fade-in h-full min-h-0">
          {/* Header Tabs */}
          <div className="flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-900/20">
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab("chat")}
                className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 ${activeTab === "chat" ? "bg-white text-black" : "text-neutral-400 hover:text-white"}`}
              >
                <MessageSquare size={16} /> Chat
              </button>
              <button
                onClick={() => setActiveTab("voice")}
                className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 ${activeTab === "voice" ? "bg-white text-black" : "text-neutral-400 hover:text-white"}`}
              >
                <Mic size={16} /> Voice
              </button>
            </div>
            <div className="flex gap-2 items-center">
              {profile && (
                <button onClick={() => setActiveTab("profile")} className="rounded-full overflow-hidden border border-neutral-700 hover:border-white w-8 h-8">
                  <img src={profile.photoURL} alt="Profile" className="w-full h-full object-cover" />
                </button>
              )}
              {onClose && (
                <button onClick={onClose} className="text-neutral-400 hover:text-white p-2 bg-neutral-900 rounded-lg ml-2">
                  <X size={20} />
                </button>
              )}
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
            {!profile || activeTab === "profile" ? (
              <ProfileSetup
                initialUsername={profile?.username}
                initialPhotoURL={profile?.photoURL}
                onComplete={handleProfileComplete}
                onCancel={profile ? () => setActiveTab("chat") : undefined}
              />
            ) : activeTab === "chat" ? (
              <ChatPanel profile={profile} />
            ) : inVoice ? (
              <VoiceChannel profile={profile} onLeave={() => setInVoice(false)} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <div className="w-24 h-24 rounded-full bg-neutral-900 flex items-center justify-center mb-4 border border-neutral-800">
                  <Mic size={32} className="text-neutral-500" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Voice Channel</h3>
                <p className="text-sm text-neutral-400 mb-8">Join the general voice channel to talk with other players seamlessly via WebRTC.</p>
                <button onClick={() => setInVoice(true)} className="px-6 py-3 rounded-full bg-white text-black font-bold hover:scale-105 transition-transform flex items-center gap-2">
                  <Mic size={18} /> Join Voice
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
