import React, { useEffect, useRef } from "react";
import { Mic, MicOff, PhoneOff, Maximize2 } from "lucide-react";
import { useCall } from "../../context/CallContext";

export default function CallPipWidget() {
  const {
    activeCall,
    callState,
    callRole,
    callDuration,
    isMuted,
    isPip,
    remoteStream,
    endCall,
    toggleMute,
    setIsPip,
  } = useCall();

  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  // Keep audio playing even in PiP mode
  useEffect(() => {
    if (remoteStream && remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(() => {});
    }
  }, [remoteStream]);

  if (!isPip || callState !== "connected" || !activeCall) {
    return null;
  }

  const isCaller = callRole === "caller";
  const peerName = isCaller ? activeCall.targetName : activeCall.callerName;
  const peerPhoto = isCaller ? activeCall.targetPhoto : activeCall.callerPhoto;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <aside
      id="call-pip-widget"
      aria-label="Active Call Preview"
      className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-[#0d0d11]/95 border border-neutral-800 p-2.5 pr-4 rounded-2xl shadow-2xl backdrop-blur-xl animate-in slide-in-from-bottom-5 duration-200"
    >
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ position: "absolute", width: "1px", height: "1px", opacity: 0.01, pointerEvents: "none" }} />

      {/* Avatar & Pulse Indicator */}
      <div className="relative flex-shrink-0">
        <div className="w-10 h-10 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 flex items-center justify-center font-bold text-white text-xs">
          {peerPhoto ? (
            <img src={peerPhoto} alt={peerName} className="w-full h-full object-cover" />
          ) : (
            <span>{peerName?.charAt(0).toUpperCase() || "?"}</span>
          )}
        </div>
        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[#0d0d11] animate-pulse" />
      </div>

      {/* Call details */}
      <div className="flex flex-col min-w-0 pr-2">
        <span className="text-xs font-bold text-white truncate max-w-[120px]">{peerName}</span>
        <span className="text-[10px] text-emerald-400 font-semibold">{formatTime(callDuration)}</span>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1.5 border-l border-neutral-800 pl-2">
        <button
          onClick={toggleMute}
          className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
            isMuted ? "bg-rose-950 text-rose-400" : "text-neutral-400 hover:text-white hover:bg-neutral-800"
          }`}
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <MicOff size={15} /> : <Mic size={15} />}
        </button>

        <button
          onClick={() => setIsPip(false)}
          className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
          title="Maximize Call"
        >
          <Maximize2 size={15} />
        </button>

        <button
          onClick={endCall}
          className="p-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg transition-colors cursor-pointer ml-1"
          title="End Call"
        >
          <PhoneOff size={15} />
        </button>
      </div>
    </aside>
  );
}
