import React from "react";
import { Phone, PhoneOff, Video, Volume2 } from "lucide-react";
import { useCall } from "../../context/CallContext";

export default function IncomingCallModal() {
  const { activeCall, callState, callRole, acceptCall, declineCall } = useCall();

  if (callState !== "ringing" || callRole !== "receiver" || !activeCall) {
    return null;
  }

  return (
    <div
      id="incoming-call-overlay"
      className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center p-4 pt-12 sm:pt-4 bg-black/70 backdrop-blur-md animate-in fade-in zoom-in-95 duration-200"
    >
      <div
        id="incoming-call-card"
        className="w-full max-w-sm rounded-3xl bg-[#0e0e11] border border-neutral-800 p-6 shadow-2xl flex flex-col items-center text-center text-white relative overflow-hidden"
      >
        {/* Ambient background pulsing glow */}
        <div className="absolute -top-24 -left-24 w-52 h-52 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none animate-pulse" />
        <div className="absolute -bottom-24 -right-24 w-52 h-52 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none animate-pulse" />

        {/* Ringtone badge */}
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-neutral-900 border border-neutral-800 text-[11px] font-semibold text-emerald-400 mb-4 shadow-sm">
          <Volume2 size={13} className="animate-bounce" />
          <span>Ringtone Playing</span>
        </div>

        {/* Avatar with pulsing wave rings */}
        <div className="relative my-3">
          <span className="absolute inset-0 rounded-full bg-emerald-500/30 animate-ping duration-1000" />
          <span className="absolute -inset-2 rounded-full bg-emerald-500/15 animate-pulse" />
          <div className="relative w-24 h-24 rounded-full overflow-hidden border-2 border-emerald-500/80 bg-neutral-800 shadow-xl flex items-center justify-center text-2xl font-bold text-white">
            {activeCall.callerPhoto ? (
              <img
                src={activeCall.callerPhoto}
                alt={activeCall.callerName}
                className="w-full h-full object-cover"
              />
            ) : (
              <span>{activeCall.callerName?.charAt(0).toUpperCase() || "?"}</span>
            )}
          </div>
        </div>

        {/* Caller Name & Type */}
        <h3 className="text-xl font-bold text-white tracking-tight mt-3">
          {activeCall.callerName}
        </h3>
        <p className="text-xs text-neutral-400 mt-1 flex items-center gap-1.5">
          {activeCall.isVideoCall ? (
            <>
              <Video size={13} className="text-indigo-400" />
              <span>Incoming Video Call...</span>
            </>
          ) : (
            <>
              <Phone size={13} className="text-emerald-400" />
              <span>Incoming Voice Call...</span>
            </>
          )}
        </p>

        {/* Action Buttons: Accept / Decline */}
        <div className="flex items-center justify-center gap-6 mt-8 w-full">
          {/* Decline Button */}
          <div className="flex flex-col items-center gap-2">
            <button
              id="decline-call-btn"
              onClick={declineCall}
              className="w-14 h-14 rounded-full bg-rose-600 hover:bg-rose-500 active:scale-95 text-white flex items-center justify-center shadow-lg shadow-rose-600/30 transition-all cursor-pointer"
              title="Decline Call"
            >
              <PhoneOff size={22} />
            </button>
            <span className="text-[11px] font-medium text-neutral-400">Decline</span>
          </div>

          {/* Accept Button */}
          <div className="flex flex-col items-center gap-2">
            <button
              id="accept-call-btn"
              onClick={acceptCall}
              className="w-14 h-14 rounded-full bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white flex items-center justify-center shadow-lg shadow-emerald-600/40 transition-all animate-bounce cursor-pointer"
              title="Accept Call"
            >
              <Phone size={22} />
            </button>
            <span className="text-[11px] font-medium text-neutral-400">Accept</span>
          </div>
        </div>
      </div>
    </div>
  );
}
