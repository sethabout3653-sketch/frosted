import React, { useState, useEffect } from "react";
import { Phone, Video, X } from "lucide-react";
import { useCall } from "../../context/CallContext";
import { db, collection, onSnapshot, toTimestampMs } from "../../supabase-adapter";

interface OnlineUser {
  uid: string;
  username: string;
  photoURL: string;
  activity?: string;
  currentGame?: string | null;
}

interface StartCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onlineUsers?: OnlineUser[];
  currentUid?: string;
}

export default function StartCallModal({
  isOpen,
  onClose,
  onlineUsers = [],
  currentUid,
}: StartCallModalProps) {
  const { startCall } = useCall();
  const [presenceUsers, setPresenceUsers] = useState<OnlineUser[]>([]);

  useEffect(() => {
    if (!isOpen) return;

    const unsub = onSnapshot(collection(db, "presence"), (snapshot) => {
      const now = Date.now();
      const users: OnlineUser[] = [];
      snapshot.docs.forEach((doc: any) => {
        const data = doc.data();
        const ts = toTimestampMs(data.lastSeen);
        if (ts > 0 && now - ts <= 60000 && data.username) {
          users.push({
            uid: data.uid || doc.id,
            username: data.username,
            photoURL: data.photoURL || "",
            activity: data.activity || (data.currentGame ? `Playing ${data.currentGame}` : "Online"),
            currentGame: data.currentGame,
          });
        }
      });
      setPresenceUsers(users);
    });

    return () => unsub();
  }, [isOpen]);

  if (!isOpen) return null;

  const usersList = onlineUsers && onlineUsers.length > 0 ? onlineUsers : presenceUsers;
  const filteredUsers = usersList.filter((u) => u.uid && u.uid !== currentUid);

  return (
    <div
      id="start-call-modal-overlay"
      onClick={onClose}
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div
        id="start-call-card"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl bg-[#0e0e12] border border-neutral-800 p-5 shadow-2xl text-white flex flex-col max-h-[85vh] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-neutral-800/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center">
              <Phone size={16} />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">Start a Call</h3>
              <p className="text-[11px] text-neutral-400">Direct voice & video with ringtone</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Online Members Section */}
        <div className="mt-4 flex-1 overflow-y-auto">
          <h4 className="text-[10px] font-bold text-neutral-400 tracking-wider uppercase mb-2 px-1">
            ONLINE USERS ({filteredUsers.length})
          </h4>

          {filteredUsers.length === 0 ? (
            <div className="text-center py-8 text-neutral-500 text-xs">
              <p>No other users online right now.</p>
              <p className="text-[11px] text-neutral-600 mt-1">
                Open another tab or share the app to place and receive direct calls!
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredUsers.map((user) => (
                <div
                  key={user.uid}
                  className="flex items-center justify-between p-2 rounded-xl bg-neutral-900/60 hover:bg-neutral-900 border border-neutral-800/60 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative">
                      <div className="w-8 h-8 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 flex items-center justify-center font-bold text-xs text-white">
                        {user.photoURL ? (
                          <img src={user.photoURL} alt={user.username} className="w-full h-full object-cover" />
                        ) : (
                          <span>{user.username?.charAt(0).toUpperCase() || "?"}</span>
                        )}
                      </div>
                      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#0e0e12]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-neutral-200 truncate">{user.username}</p>
                      <p className="text-[10px] text-emerald-400/90 font-medium truncate">
                        {user.activity || "Online"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        onClose();
                        startCall(user, false);
                      }}
                      className="p-1.5 rounded-lg bg-emerald-950 text-emerald-400 hover:bg-emerald-600 hover:text-white border border-emerald-800/80 transition-all cursor-pointer"
                      title="Voice Call"
                    >
                      <Phone size={14} />
                    </button>
                    <button
                      onClick={() => {
                        onClose();
                        startCall(user, true);
                      }}
                      className="p-1.5 rounded-lg bg-indigo-950 text-indigo-400 hover:bg-indigo-600 hover:text-white border border-indigo-800/80 transition-all cursor-pointer"
                      title="Video Call"
                    >
                      <Video size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
