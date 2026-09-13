import React, { useState } from "react";
import { Phone, Video, MessageSquare } from "lucide-react";
import { initiatePrivateCallGlobal } from "./PrivateCallManager";

interface UserCallPopoverProps {
  user: {
    uid: string;
    username: string;
    photoURL: string;
    status?: string;
  };
  isCurrentUser: boolean;
  isInVoice?: boolean;
  children: React.ReactNode;
  align?: "left" | "right";
}

export default function UserCallPopover({
  user,
  isCurrentUser,
  isInVoice = false,
  children,
  align = "right",
}: UserCallPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  let hoverTimeout: any = null;

  const handleMouseEnter = () => {
    if (hoverTimeout) clearTimeout(hoverTimeout);
    setIsOpen(true);
  };

  const handleMouseLeave = () => {
    hoverTimeout = setTimeout(() => {
      setIsOpen(false);
    }, 250);
  };

  const handleStartCall = (callType: "voice" | "video") => {
    setIsOpen(false);
    initiatePrivateCallGlobal(user, callType);
  };

  if (isCurrentUser) {
    return <>{children}</>;
  }

  return (
    <div
      className="relative inline-flex items-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}

      {isOpen && (
        <div
          className={`absolute z-[9000] bottom-full mb-2 ${
            align === "right" ? "right-0" : "left-0"
          } w-64 bg-[#0d0e10] border border-neutral-800 rounded-2xl p-3.5 shadow-2xl backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150 text-left cursor-default`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* User Banner Header */}
          <div className="flex items-center gap-3 mb-3">
            <div className="relative flex-shrink-0">
              <div className="w-11 h-11 rounded-full overflow-hidden bg-neutral-800 border-2 border-neutral-700 shadow-md">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.username}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center font-bold text-white text-sm">
                    {(user.username || "?").charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[#0d0e10]" />
            </div>

            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-bold text-white truncate">
                {user.username}
              </h4>
              <p className="text-[11px] text-emerald-400 font-medium flex items-center gap-1 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>{isInVoice ? "In Voice Channel" : "Online"}</span>
              </p>
            </div>
          </div>

          <div className="h-[1px] bg-neutral-800/80 my-2.5" />

          {/* Call Actions */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider px-1">
              Private Talk &amp; Video
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleStartCall("video")}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-neutral-900 hover:bg-emerald-600/90 text-neutral-200 hover:text-white text-xs font-bold transition-all border border-neutral-800/80 hover:border-emerald-500 cursor-pointer shadow-sm group"
                title="Start Video Call"
              >
                <Video size={14} className="group-hover:scale-110 transition-transform" />
                <span>Video Call</span>
              </button>

              <button
                onClick={() => handleStartCall("voice")}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-neutral-900 hover:bg-cyan-600/90 text-neutral-200 hover:text-white text-xs font-bold transition-all border border-neutral-800/80 hover:border-cyan-500 cursor-pointer shadow-sm group"
                title="Start Voice Call"
              >
                <Phone size={13} className="group-hover:scale-110 transition-transform" />
                <span>Call</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
