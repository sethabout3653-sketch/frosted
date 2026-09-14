import React, { useEffect, useRef } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  Minimize2,
  ScreenShare,
  ScreenShareOff,
  MonitorUp,
} from "lucide-react";
import { useCall } from "../../context/CallContext";

export default function DirectCallModal() {
  const {
    activeCall,
    callState,
    callRole,
    callDuration,
    isMuted,
    isVideoOn,
    peerVideoOn,
    peerMuted,
    isScreenSharing,
    isPip,
    localStream,
    remoteStream,
    endCall,
    toggleMute,
    toggleVideo,
    toggleScreenShare,
    setIsPip,
  } = useCall();

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  // Sync streams whenever localStream, remoteStream or video states change
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      if (localVideoRef.current.srcObject !== localStream) {
        localVideoRef.current.srcObject = localStream;
      }
    }
  }, [localStream, isVideoOn]);

  useEffect(() => {
    if (remoteStream) {
      if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream;
        remoteVideoRef.current.play().catch(() => {});
      }
      if (remoteAudioRef.current && remoteAudioRef.current.srcObject !== remoteStream) {
        remoteAudioRef.current.srcObject = remoteStream;
        remoteAudioRef.current.volume = 1.0;
        remoteAudioRef.current.muted = false;
        remoteAudioRef.current.play().catch(() => {});
      }
    }
  }, [remoteStream, peerVideoOn]);

  // Format call duration (e.g. 02:45)
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // If not in a call or minimized to PiP or receiver during ringing (handled by IncomingCallModal)
  if (
    callState === "idle" ||
    isPip ||
    (callState === "ringing" && callRole === "receiver") ||
    !activeCall
  ) {
    return null;
  }

  const isCaller = callRole === "caller";
  const peerName = isCaller ? activeCall.targetName : activeCall.callerName;
  const peerPhoto = isCaller ? activeCall.targetPhoto : activeCall.callerPhoto;

  const hasRemoteVideo =
    peerVideoOn ||
    (remoteStream &&
      remoteStream.getVideoTracks().some(
        (t) => t.readyState === "live" && t.enabled
      ));

  return (
    <div
      id="direct-call-overlay"
      className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-xl animate-in fade-in duration-200"
    >
      {/* Hidden audio element for remote WebRTC audio */}
      <audio
        ref={(el) => {
          remoteAudioRef.current = el;
          if (el && remoteStream && el.srcObject !== remoteStream) {
            el.srcObject = remoteStream;
            el.volume = 1.0;
            el.muted = false;
            el.play().catch(() => {});
          }
        }}
        autoPlay
        playsInline
      />

      <div
        id="direct-call-card"
        className="relative w-full max-w-2xl h-[560px] max-h-[90vh] rounded-3xl bg-[#0a0a0d] border border-neutral-800 shadow-2xl flex flex-col overflow-hidden text-white"
      >
        {/* Top Header Bar */}
        <div className="h-14 px-5 border-b border-neutral-900 bg-[#0e0e12]/60 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-8 h-8 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700">
                {peerPhoto ? (
                  <img src={peerPhoto} alt={peerName} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs font-bold">
                    {peerName?.charAt(0).toUpperCase() || "?"}
                  </div>
                )}
              </div>
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0a0a0d] ${
                  callState === "connected" ? "bg-emerald-500" : "bg-amber-400 animate-pulse"
                }`}
              />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
                <span>{peerName}</span>
                {activeCall.isEchoTest && (
                  <span className="text-[10px] bg-indigo-950 text-indigo-300 border border-indigo-800 px-1.5 py-0.2 rounded font-semibold">
                    ECHO TEST
                  </span>
                )}
              </h4>
              <p className="text-[11px] text-neutral-400">
                {callState === "calling" && "Calling with ringtone..."}
                {callState === "connected" && `Connected • ${formatTime(callDuration)}`}
                {callState === "declined" && "Call declined"}
                {callState === "cancelled" && "Call cancelled"}
                {callState === "ended" && "Call ended"}
                {callState === "missed" && "No answer"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {callState === "connected" && (
              <button
                onClick={() => setIsPip(true)}
                className="p-2 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
                title="Minimize (Picture-in-Picture)"
              >
                <Minimize2 size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Center Call Stage */}
        <div className="flex-1 relative flex items-center justify-center bg-black/60 overflow-hidden">
          {/* State 1: Outgoing Calling / Ringing */}
          {callState === "calling" && (
            <div className="flex flex-col items-center justify-center text-center p-6 animate-in zoom-in-95 duration-200">
              <div className="relative mb-6">
                <span className="absolute inset-0 rounded-full bg-indigo-500/30 animate-ping duration-1000" />
                <span className="absolute -inset-3 rounded-full bg-indigo-500/15 animate-pulse duration-700" />
                <div className="relative w-28 h-28 rounded-full overflow-hidden border-2 border-indigo-400/80 bg-neutral-800 shadow-2xl flex items-center justify-center text-3xl font-bold text-white">
                  {peerPhoto ? (
                    <img src={peerPhoto} alt={peerName} className="w-full h-full object-cover" />
                  ) : (
                    <span>{peerName?.charAt(0).toUpperCase() || "?"}</span>
                  )}
                </div>
              </div>

              <h3 className="text-2xl font-bold text-white tracking-tight">{peerName}</h3>
              <div className="flex items-center gap-2 mt-2 text-indigo-400 text-xs font-medium px-3 py-1 rounded-full bg-indigo-950/40 border border-indigo-800/40">
                <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
                <span>Calling...</span>
              </div>
              <p className="text-xs text-neutral-400 mt-2">Waiting for answer...</p>
            </div>
          )}

          {/* State 2: Connected Active Call */}
          {callState === "connected" && (
            <div className="w-full h-full relative flex items-center justify-center">
              {/* Remote Video Stream Container */}
              <div className={`w-full h-full relative ${hasRemoteVideo ? "flex" : "hidden"} items-center justify-center bg-black overflow-hidden`}>
                <video
                  ref={(el) => {
                    remoteVideoRef.current = el;
                    if (el && remoteStream && el.srcObject !== remoteStream) {
                      el.srcObject = remoteStream;
                      el.play().catch(() => {});
                    }
                  }}
                  autoPlay
                  playsInline
                  className="w-full h-full object-contain max-w-full max-h-full"
                />
                {peerMuted && (
                  <div className="absolute top-4 left-4 bg-rose-600/90 text-white text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow backdrop-blur-md z-10">
                    <MicOff size={12} />
                    <span>{peerName} is muted</span>
                  </div>
                )}
              </div>

              {/* Avatar Card when video is off */}
              <div className={`flex flex-col items-center justify-center text-center p-6 ${hasRemoteVideo ? "hidden" : "flex"}`}>
                <div className="relative mb-4">
                  <div className="w-28 h-28 rounded-full overflow-hidden border-2 border-emerald-500/80 bg-neutral-800 shadow-2xl flex items-center justify-center text-3xl font-bold text-white">
                    {peerPhoto ? (
                      <img src={peerPhoto} alt={peerName} className="w-full h-full object-cover" />
                    ) : (
                      <span>{peerName?.charAt(0).toUpperCase() || "?"}</span>
                    )}
                  </div>
                  <span className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-[#0a0a0d]" />
                </div>

                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <span>{peerName}</span>
                  {peerMuted && (
                    <span title="Muted" className="inline-flex text-rose-400">
                      <MicOff size={15} />
                    </span>
                  )}
                </h3>
                <p className="text-xs text-emerald-400 font-semibold mt-1">
                  Connected • {formatTime(callDuration)}
                </p>
              </div>

              {/* Picture-in-Picture Local Video Preview (when camera or screen sharing is on) */}
              {(isVideoOn || isScreenSharing) && (
                <div className="absolute top-4 right-4 w-32 sm:w-44 aspect-video rounded-xl overflow-hidden border border-neutral-700/80 bg-black/90 shadow-2xl z-20">
                  <video
                    ref={(el) => {
                      localVideoRef.current = el;
                      const activeLocalStream = localStream;
                      if (el && activeLocalStream && el.srcObject !== activeLocalStream) {
                        el.srcObject = activeLocalStream;
                        el.play().catch(() => {});
                      }
                    }}
                    autoPlay
                    muted
                    playsInline
                    className={`w-full h-full object-contain ${isScreenSharing ? "" : "scale-x-[-1] object-cover"}`}
                  />
                  <span className="absolute bottom-1 left-2 text-[9px] font-bold text-white bg-black/70 px-1.5 py-0.5 rounded flex items-center gap-1">
                    {isScreenSharing ? (
                      <>
                        <MonitorUp size={9} className="text-emerald-400" />
                        <span>Screen</span>
                      </>
                    ) : (
                      <span>You</span>
                    )}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* State 3: Terminal States (Declined / Ended / Missed) */}
          {(callState === "declined" ||
            callState === "cancelled" ||
            callState === "ended" ||
            callState === "missed") && (
            <div className="flex flex-col items-center justify-center text-center p-6 animate-in fade-in duration-200">
              <div className="w-20 h-20 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-400 mb-4">
                <PhoneOff size={32} className="text-rose-400" />
              </div>
              <h3 className="text-lg font-bold text-white">
                {callState === "declined" && "Call was declined"}
                {callState === "cancelled" && "Call cancelled"}
                {callState === "ended" && "Call ended"}
                {callState === "missed" && "No answer"}
              </h3>
              <p className="text-xs text-neutral-400 mt-1">Disconnecting...</p>
            </div>
          )}
        </div>

        {/* Bottom Floating Control Bar */}
        <div className="h-20 px-6 border-t border-neutral-900 bg-[#0a0a0d] flex items-center justify-center gap-4 flex-shrink-0 z-10">
          {callState === "connected" && (
            <>
              {/* Mic Mute Toggle */}
              <button
                id="call-toggle-mic"
                onClick={toggleMute}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  isMuted
                    ? "bg-rose-600/90 text-white hover:bg-rose-500"
                    : "bg-neutral-800 text-neutral-200 hover:bg-neutral-700 hover:text-white"
                }`}
                title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
              >
                {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
              </button>

              {/* Video Camera Toggle */}
              <button
                id="call-toggle-video"
                onClick={toggleVideo}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  isVideoOn
                    ? "bg-indigo-600 text-white hover:bg-indigo-500"
                    : "bg-neutral-800 text-neutral-200 hover:bg-neutral-700 hover:text-white"
                }`}
                title={isVideoOn ? "Turn Camera Off" : "Turn Camera On"}
              >
                {isVideoOn ? <Video size={18} /> : <VideoOff size={18} />}
              </button>

              {/* Screen Share Toggle */}
              <button
                id="call-toggle-screen"
                onClick={toggleScreenShare}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  isScreenSharing
                    ? "bg-emerald-600 text-white hover:bg-emerald-500"
                    : "bg-neutral-800 text-neutral-200 hover:bg-neutral-700 hover:text-white"
                }`}
                title={isScreenSharing ? "Stop Sharing Screen" : "Share Screen"}
              >
                {isScreenSharing ? <ScreenShareOff size={18} /> : <ScreenShare size={18} />}
              </button>
            </>
          )}

          {/* End Call / Cancel Button */}
          <button
            id="call-end-button"
            onClick={endCall}
            className="h-12 px-6 rounded-full bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-bold text-xs tracking-wider flex items-center gap-2 shadow-lg shadow-rose-600/30 transition-all cursor-pointer uppercase"
            title={callState === "calling" ? "Cancel Call" : "End Call"}
          >
            <PhoneOff size={18} />
            <span>{callState === "calling" ? "Cancel" : "End Call"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
