import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  AlertCircle,
  Zap,
  Sliders,
  Volume2,
  VolumeX,
  Radio,
  Check,
  X,
  Sparkles,
  Loader2,
  Maximize2,
} from "lucide-react";
import { socket } from "../socket";
import { ChatProfile } from "../types";
import { IceServerConfig } from "../types";

const STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
];

interface VoiceChannelProps {
  profile: ChatProfile;
  onLeave: () => void;
  iceConfig?: IceServerConfig;
}

interface PeerConnection {
  pc: RTCPeerConnection;
  stream: MediaStream;
}

export default function VoiceChannel({
  profile,
  onLeave,
  iceConfig,
}: VoiceChannelProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remoteUsers, setRemoteUsers] = useState<Record<string, { profile: any, stream?: MediaStream }>>({});
  
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const peersRef = useRef<Map<string, PeerConnection>>(new Map());
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  const getMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: isVideoOn,
      });
      
      if (isMuted) {
        stream.getAudioTracks().forEach((track) => {
          track.enabled = false;
        });
      }

      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      return stream;
    } catch (err: any) {
      setError(err.message || "Could not access microphone/camera");
      return null;
    }
  }, [isMuted, isVideoOn]);

  const createPeerConnection = useCallback(
    (targetSocketId: string, profileData: any, isInitiator: boolean) => {
      const configuration: RTCConfiguration = {
        iceServers: iceConfig?.servers || STUN_SERVERS,
      };

      const pc = new RTCPeerConnection(configuration);

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          if (localStreamRef.current) {
            pc.addTrack(track, localStreamRef.current);
          }
        });
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("signal", {
            to: targetSocketId,
            signal: {
              type: "candidate",
              candidate: event.candidate,
            },
          });
        }
      };

      pc.ontrack = (event) => {
        setRemoteUsers((prev) => ({
          ...prev,
          [profileData.uid]: {
            profile: profileData,
            stream: event.streams[0],
          },
        }));

        setTimeout(() => {
          const videoEl = videoRefs.current.get(profileData.uid);
          if (videoEl && event.streams[0]) {
            videoEl.srcObject = event.streams[0];
          }
        }, 100);
      };

      if (isInitiator) {
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            socket.emit("signal", {
              to: targetSocketId,
              signal: pc.localDescription,
            });
          });
      }

      peersRef.current.set(targetSocketId, { pc, stream: new MediaStream() });
      return pc;
    },
    [iceConfig]
  );

  useEffect(() => {
    let mounted = true;
    
    const init = async () => {
      const stream = await getMedia();
      if (!stream || !mounted) return;

      socket.emit("join_voice", profile);

      const handleSignal = async (payload: any) => {
        const { from, signal } = payload;
        
        let pcData = peersRef.current.get(from);
        if (!pcData) {
          // If we receive an offer, the from is the remote socketId. But we don't have their profile right here.
          // To be perfectly robust we'd need their profile. Let's just create a generic profile to display them.
          pcData = { pc: createPeerConnection(from, { uid: from, username: "Peer" }, false), stream: new MediaStream() };
        }

        const pc = pcData.pc;

        try {
          if (signal.type === "offer") {
            await pc.setRemoteDescription(new RTCSessionDescription(signal));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit("signal", {
              to: from,
              signal: pc.localDescription,
            });
          } else if (signal.type === "answer") {
            await pc.setRemoteDescription(new RTCSessionDescription(signal));
          } else if (signal.type === "candidate" && signal.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          }
        } catch (e) {
          console.error("WebRTC Error:", e);
        }
      };

      // In a real robust system, we would ask the server for all other voice users
      // and send them an offer.
      socket.on("signal", handleSignal);
    };

    init();

    return () => {
      mounted = false;
      socket.emit("leave_voice");
      socket.off("signal");
      peersRef.current.forEach(({ pc }) => pc.close());
      peersRef.current.clear();
      
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [getMedia, profile, createPeerConnection]);

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => {
        t.enabled = !t.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    setIsVideoOn(!isVideoOn);
  };

  const setVideoRef = (uid: string, el: HTMLVideoElement | null) => {
    if (el) {
      videoRefs.current.set(uid, el);
    } else {
      videoRefs.current.delete(uid);
    }
  };

  return (
    <div className="flex-1 bg-black flex flex-col items-center justify-center relative p-8">
      {error ? (
        <div className="bg-red-950/50 border border-red-900 text-red-400 p-6 rounded-xl flex items-center gap-3">
          <AlertCircle size={24} />
          <p>{error}</p>
        </div>
      ) : (
        <div className="w-full h-full flex flex-col">
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
            
            {/* Local Video */}
            <div className="relative bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800 flex items-center justify-center">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${!isVideoOn ? 'hidden' : ''}`}
              />
              {!isVideoOn && (
                <div className="absolute inset-0 flex items-center justify-center bg-neutral-900">
                  <div className="w-20 h-20 bg-neutral-800 rounded-full flex items-center justify-center text-3xl font-bold text-neutral-500 shadow-xl border border-neutral-700">
                    {profile.username.charAt(0).toUpperCase()}
                  </div>
                </div>
              )}
              <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 flex items-center gap-2">
                <span className="text-white text-sm font-medium">{profile.username} (You)</span>
                {isMuted && <MicOff size={14} className="text-red-400" />}
              </div>
            </div>

            {/* Remote Videos */}
            {Object.values(remoteUsers).map(({ profile: p, stream }) => (
              <div key={p.uid} className="relative bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800 flex items-center justify-center">
                <video
                  ref={(el) => setVideoRef(p.uid, el)}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
                {!stream?.getVideoTracks()[0]?.enabled && (
                  <div className="absolute inset-0 flex items-center justify-center bg-neutral-900">
                    <div className="w-20 h-20 bg-neutral-800 rounded-full flex items-center justify-center text-3xl font-bold text-neutral-500 shadow-xl border border-neutral-700">
                      {p.username?.charAt(0).toUpperCase()}
                    </div>
                  </div>
                )}
                <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 flex items-center gap-2">
                  <span className="text-white text-sm font-medium">{p.username}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex justify-center items-center gap-6">
            <button
              onClick={toggleMute}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-xl ${
                isMuted ? "bg-red-500/20 text-red-500 hover:bg-red-500/30 border border-red-500/30" : "bg-neutral-800 text-white hover:bg-neutral-700 border border-neutral-700"
              }`}
            >
              {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
            </button>
            <button
              onClick={toggleVideo}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-xl ${
                !isVideoOn ? "bg-neutral-800 text-neutral-400 hover:bg-neutral-700 border border-neutral-700" : "bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/30 border border-emerald-500/30"
              }`}
            >
              {!isVideoOn ? <VideoOff size={24} /> : <Video size={24} />}
            </button>
            <button
              onClick={onLeave}
              className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center transition-colors shadow-xl shadow-red-900/20"
            >
              <PhoneOff size={28} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
