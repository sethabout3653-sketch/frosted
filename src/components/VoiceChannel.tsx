import React, { useState, useEffect, useRef } from "react";
import { Mic, MicOff, Video, VideoOff, PhoneOff } from "lucide-react";
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  addDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { ChatProfile, VoiceSignal } from "../types";

interface VoiceChannelProps {
  profile: ChatProfile;
  onLeave: () => void;
}

interface Participant extends ChatProfile {
  isMuted?: boolean;
  isVideoOn?: boolean;
}

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

function optimizeAudioSdp(sdp: string): string {
  const lines = sdp.split("\r\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("a=fmtp:") && lines[i].includes("opus")) {
      if (!lines[i].includes("maxaveragebitrate")) {
        lines[i] +=
          ";maxaveragebitrate=510000;stereo=1;sprop-stereo=1;cbr=1;usedtx=0";
      }
    }
  }
  return lines.join("\r\n");
}

export default function VoiceChannel({ profile, onLeave }: VoiceChannelProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [error, setError] = useState<string | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const sessionStartTimeRef = useRef<number>(Date.now());

  const peersRef = useRef<{ [uid: string]: RTCPeerConnection }>({});
  const iceCandidateQueuesRef = useRef<{ [uid: string]: RTCIceCandidateInit[] }>(
    {}
  );
  const remoteStreamsRef = useRef<{ [uid: string]: MediaStream }>({});
  const remoteVideoRefs = useRef<{ [uid: string]: HTMLVideoElement | null }>({});

  // Ensure local video element gets stream if camera is on
  useEffect(() => {
    if (isVideoOn && localVideoRef.current && videoStreamRef.current) {
      localVideoRef.current.srcObject = videoStreamRef.current;
    }
  }, [isVideoOn]);

  // Clean up and register voice user state
  useEffect(() => {
    let unsubscribeSignals: () => void;
    let unsubscribeUsers: () => void;
    sessionStartTimeRef.current = Date.now();

    async function initVoice() {
      try {
        // Initial audio stream
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: false,
            autoGainControl: false,
          },
          video: false,
        });
        localStreamRef.current = stream;

        // Register self as online in voice_users
        await setDoc(doc(db, "voice_users", profile.uid), {
          uid: profile.uid,
          username: profile.username,
          photoURL: profile.photoURL || "",
          isMuted: false,
          isVideoOn: false,
          timestamp: Date.now(),
        });

        // Update presence
        await updateDoc(doc(db, "presence", profile.uid), {
          isMuted: false,
          inVoice: true,
        }).catch(() => {});

        // Listen for other users in voice_users
        unsubscribeUsers = onSnapshot(collection(db, "voice_users"), (snapshot) => {
          const users: Participant[] = [];
          snapshot.forEach((d) => {
            const u = d.data() as Participant;
            if (u.uid !== profile.uid) {
              users.push(u);
              // Deterministic offerer: peer with smaller UID initiates call
              if (profile.uid < u.uid && !peersRef.current[u.uid]) {
                initiateCall(u.uid, localStreamRef.current!);
              }
            }
          });
          setParticipants(users);
        });

        // Listen for WebRTC signals
        const q = query(
          collection(db, "signals"),
          where("receiverId", "==", profile.uid)
        );

        unsubscribeSignals = onSnapshot(q, (snapshot) => {
          snapshot.docChanges().forEach(async (change) => {
            if (change.type === "added") {
              const signal = {
                id: change.doc.id,
                ...change.doc.data(),
              } as VoiceSignal;

              // Immediately delete received signal document from Firestore
              deleteDoc(doc(db, "signals", signal.id)).catch(() => {});

              if (localStreamRef.current) {
                await handleSignal(signal, localStreamRef.current);
              }
            }
          });
        });
      } catch (err: any) {
        console.error("Failed to access media devices", err);
        setError("Failed to access microphone. Please allow access in browser settings.");
      }
    }

    initVoice();

    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      Object.values(peersRef.current).forEach((pc: RTCPeerConnection) => pc.close());

      deleteDoc(doc(db, "voice_users", profile.uid)).catch(() => {});
      updateDoc(doc(db, "presence", profile.uid), {
        inVoice: false,
        isMuted: false,
      }).catch(() => {});

      if (unsubscribeSignals) unsubscribeSignals();
      if (unsubscribeUsers) unsubscribeUsers();
    };
  }, [profile]);

  const createPeerConnection = (partnerUid: string, stream: MediaStream) => {
    if (peersRef.current[partnerUid]) {
      peersRef.current[partnerUid].close();
      delete peersRef.current[partnerUid];
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peersRef.current[partnerUid] = pc;
    iceCandidateQueuesRef.current[partnerUid] = [];

    // 1. Add audio tracks
    stream.getAudioTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    // 2. Add video transceiver so SDP m-lines are fixed (m=audio index 0, m=video index 1)
    pc.addTransceiver("video", { direction: "sendrecv" });

    // If video is active locally, set track on transceiver
    if (videoStreamRef.current) {
      const videoTrack = videoStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        const videoSender = pc.getSenders().find(
          (s) => s.track?.kind === "video" || pc.getTransceivers().some((t) => t.sender === s)
        );
        if (videoSender) {
          videoSender.replaceTrack(videoTrack).catch(() => {});
        }
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(partnerUid, "candidate", JSON.stringify(event.candidate));
      }
    };

    pc.ontrack = (event) => {
      if (!remoteStreamsRef.current[partnerUid]) {
        remoteStreamsRef.current[partnerUid] = new MediaStream();
      }

      if (event.track) {
        if (!remoteStreamsRef.current[partnerUid].getTracks().some((t) => t.id === event.track.id)) {
          remoteStreamsRef.current[partnerUid].addTrack(event.track);
        }
      }

      const videoEl = remoteVideoRefs.current[partnerUid];
      if (videoEl) {
        videoEl.srcObject = remoteStreamsRef.current[partnerUid];
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (
        pc.iceConnectionState === "disconnected" ||
        pc.iceConnectionState === "failed" ||
        pc.iceConnectionState === "closed"
      ) {
        pc.close();
        delete peersRef.current[partnerUid];
        delete iceCandidateQueuesRef.current[partnerUid];
        delete remoteStreamsRef.current[partnerUid];
      }
    };

    return pc;
  };

  const initiateCall = async (partnerUid: string, stream: MediaStream) => {
    try {
      const pc = createPeerConnection(partnerUid, stream);
      const offer = await pc.createOffer();
      const highQualityOffer = new RTCSessionDescription({
        type: offer.type,
        sdp: optimizeAudioSdp(offer.sdp || ""),
      });
      await pc.setLocalDescription(highQualityOffer);
      sendSignal(partnerUid, "offer", JSON.stringify(highQualityOffer));
    } catch (err) {
      console.warn("Error initiating call:", err);
    }
  };

  const processCandidateQueue = async (
    partnerUid: string,
    pc: RTCPeerConnection
  ) => {
    const queue = iceCandidateQueuesRef.current[partnerUid] || [];
    while (queue.length > 0) {
      const candidateData = queue.shift();
      if (candidateData) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidateData));
        } catch (e) {
          console.warn("Error processing candidate:", e);
        }
      }
    }
  };

  const handleSignal = async (signal: VoiceSignal, stream: MediaStream) => {
    // Ignore signals from previous sessions or older than 10s
    if (signal.timestamp && signal.timestamp < sessionStartTimeRef.current - 5000) {
      return;
    }

    const partnerUid = signal.senderId;

    try {
      if (signal.type === "offer") {
        let pc = peersRef.current[partnerUid];

        if (!pc || pc.connectionState === "closed" || pc.signalingState === "closed") {
          pc = createPeerConnection(partnerUid, stream);
        } else if (pc.signalingState !== "stable") {
          // Glare collision handling: impolite peer ignores duplicate offer
          if (profile.uid > partnerUid) {
            return;
          }
          await pc.setLocalDescription({ type: "rollback" }).catch(() => {});
        }

        const offerDescription = new RTCSessionDescription(JSON.parse(signal.data));
        await pc.setRemoteDescription(offerDescription);
        await processCandidateQueue(partnerUid, pc);

        const answer = await pc.createAnswer();
        const highQualityAnswer = new RTCSessionDescription({
          type: answer.type,
          sdp: optimizeAudioSdp(answer.sdp || ""),
        });
        await pc.setLocalDescription(highQualityAnswer);
        sendSignal(partnerUid, "answer", JSON.stringify(highQualityAnswer));
      } else if (signal.type === "answer") {
        const pc = peersRef.current[partnerUid];
        // Strictly check signalingState to prevent 'Called in wrong state: stable'
        if (pc && pc.signalingState === "have-local-offer") {
          const answerDescription = new RTCSessionDescription(
            JSON.parse(signal.data)
          );
          await pc.setRemoteDescription(answerDescription);
          await processCandidateQueue(partnerUid, pc);
        }
      } else if (signal.type === "candidate") {
        const candidateData = JSON.parse(signal.data);
        const pc = peersRef.current[partnerUid];
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new RTCIceCandidate(candidateData)).catch(
            () => {}
          );
        } else {
          if (!iceCandidateQueuesRef.current[partnerUid]) {
            iceCandidateQueuesRef.current[partnerUid] = [];
          }
          iceCandidateQueuesRef.current[partnerUid].push(candidateData);
        }
      }
    } catch (err) {
      console.warn(`Handled WebRTC signal (${signal.type}) safely:`, err);
    }
  };

  const sendSignal = async (
    receiverId: string,
    type: "offer" | "answer" | "candidate",
    data: string
  ) => {
    try {
      await addDoc(collection(db, "signals"), {
        senderId: profile.uid,
        receiverId,
        type,
        data,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error("Error sending WebRTC signal:", err);
    }
  };

  // Toggle Mute
  const toggleMute = async () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);

    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !nextMuted;
      });
    }

    try {
      await updateDoc(doc(db, "voice_users", profile.uid), {
        isMuted: nextMuted,
      });
      await updateDoc(doc(db, "presence", profile.uid), {
        isMuted: nextMuted,
      });
    } catch (e) {}
  };

  // Toggle Video Chat
  const toggleVideo = async () => {
    const nextVideoState = !isVideoOn;
    setIsVideoOn(nextVideoState);

    try {
      if (nextVideoState) {
        // Enable camera video track
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
        });
        const videoTrack = videoStream.getVideoTracks()[0];
        videoStreamRef.current = videoStream;

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = videoStream;
        }

        // Replace track across peer connections seamlessly
        Object.keys(peersRef.current).forEach((pUid) => {
          const pc = peersRef.current[pUid];
          if (pc && pc.connectionState !== "closed") {
            const videoSender = pc.getSenders().find(
              (s) => s.track?.kind === "video" || pc.getTransceivers().some((t) => t.sender === s)
            );
            if (videoSender) {
              videoSender.replaceTrack(videoTrack).catch(() => {});
            }
          }
        });
      } else {
        // Disable camera video track
        if (videoStreamRef.current) {
          videoStreamRef.current.getTracks().forEach((track) => track.stop());
          videoStreamRef.current = null;
        }
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = null;
        }

        Object.keys(peersRef.current).forEach((pUid) => {
          const pc = peersRef.current[pUid];
          if (pc && pc.connectionState !== "closed") {
            const videoSender = pc.getSenders().find(
              (s) => s.track?.kind === "video" || pc.getTransceivers().some((t) => t.sender === s)
            );
            if (videoSender) {
              videoSender.replaceTrack(null).catch(() => {});
            }
          }
        });
      }

      await updateDoc(doc(db, "voice_users", profile.uid), {
        isVideoOn: nextVideoState,
      });
    } catch (e) {
      console.error("Failed to toggle camera:", e);
      setIsVideoOn(false);
    }
  };

  if (error) {
    return (
      <div className="flex flex-col h-full bg-black items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-500/20 text-red-500 flex items-center justify-center mb-4">
          <MicOff size={32} />
        </div>
        <h3 className="text-xl font-bold text-white mb-2">
          Microphone Permission Required
        </h3>
        <p className="text-sm text-neutral-400 mb-6">{error}</p>
        <button
          onClick={onLeave}
          className="px-6 py-2.5 rounded-xl bg-white text-black font-bold hover:bg-neutral-200 transition-colors"
        >
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full w-full bg-black text-white min-h-0 overflow-hidden">
      {/* Top Header Bar */}
      <div className="h-12 px-6 border-b border-neutral-900 bg-black flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-sm font-extrabold text-emerald-400 tracking-wide">
            Voice Connected
          </span>
        </div>
        <span className="text-sm font-semibold text-neutral-400">
          General Voice
        </span>
      </div>

      {/* Main Grid: Local User & Remote Participants */}
      <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 items-center align-middle">
        {/* Local User Tile */}
        <div className="relative aspect-video rounded-2xl bg-[#0f0f0f] border border-neutral-800/90 overflow-hidden flex flex-col items-center justify-center shadow-lg group">
          {isVideoOn ? (
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover transform -scale-x-100"
            />
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="relative">
                <img
                  src={profile.photoURL}
                  alt={profile.username}
                  className="w-20 h-20 rounded-full object-cover border-2 border-neutral-700 shadow-md"
                />
                {isMuted && (
                  <div className="absolute -bottom-1 -right-1 bg-red-600 p-1.5 rounded-full text-white shadow-lg border-2 border-[#0f0f0f]">
                    <MicOff size={14} />
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="absolute bottom-3 left-3 bg-black/75 backdrop-blur-md px-3 py-1 rounded-lg border border-neutral-800 flex items-center gap-2">
            <span className="text-xs font-bold text-white">
              {profile.username} (You)
            </span>
            {isMuted && (
              <span className="text-[10px] text-red-400 font-bold uppercase tracking-wider bg-red-950/80 px-1.5 py-0.5 rounded border border-red-800/60">
                Muted
              </span>
            )}
          </div>
        </div>

        {/* Remote Participants Tiles */}
        {participants.map((p) => (
          <div
            key={p.uid}
            className="relative aspect-video rounded-2xl bg-[#0f0f0f] border border-neutral-800/90 overflow-hidden flex flex-col items-center justify-center shadow-lg"
          >
            {p.isVideoOn ? (
              <video
                ref={(el) => {
                  remoteVideoRefs.current[p.uid] = el;
                  if (el && remoteStreamsRef.current[p.uid]) {
                    el.srcObject = remoteStreamsRef.current[p.uid];
                  }
                }}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="relative">
                  <img
                    src={p.photoURL}
                    alt={p.username}
                    className="w-20 h-20 rounded-full object-cover border-2 border-neutral-700 shadow-md"
                  />
                  {p.isMuted && (
                    <div className="absolute -bottom-1 -right-1 bg-red-600 p-1.5 rounded-full text-white shadow-lg border-2 border-[#0f0f0f]">
                      <MicOff size={14} />
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="absolute bottom-3 left-3 bg-black/75 backdrop-blur-md px-3 py-1 rounded-lg border border-neutral-800 flex items-center gap-2">
              <span className="text-xs font-bold text-white">{p.username}</span>
              {p.isMuted && (
                <span className="text-[10px] text-red-400 font-bold uppercase tracking-wider bg-red-950/80 px-1.5 py-0.5 rounded border border-red-800/60">
                  Muted
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom Controls Bar */}
      <div className="p-6 bg-black border-t border-neutral-900 flex justify-center items-center gap-5 flex-shrink-0">
        <button
          onClick={toggleMute}
          className={`p-3.5 rounded-2xl transition-all cursor-pointer ${
            isMuted
              ? "bg-red-600/20 text-red-500 border border-red-800/80 hover:bg-red-600/30"
              : "bg-neutral-900 text-white border border-neutral-800 hover:bg-neutral-800"
          }`}
          title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
        >
          {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
        </button>

        <button
          onClick={toggleVideo}
          className={`p-3.5 rounded-2xl transition-all cursor-pointer ${
            isVideoOn
              ? "bg-white text-black font-bold shadow-lg"
              : "bg-neutral-900 text-white border border-neutral-800 hover:bg-neutral-800"
          }`}
          title={isVideoOn ? "Turn Off Camera" : "Turn On Camera (Video Chat)"}
        >
          {isVideoOn ? <Video size={20} /> : <VideoOff size={20} />}
        </button>

        <button
          onClick={onLeave}
          className="p-3.5 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white shadow-xl transition-all cursor-pointer active:scale-95"
          title="Disconnect from Voice"
        >
          <PhoneOff size={20} className="text-white stroke-[2.5]" />
        </button>
      </div>
    </div>
  );
}
