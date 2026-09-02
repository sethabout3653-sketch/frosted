import React, { useState, useEffect, useRef } from "react";
import { Mic, MicOff, PhoneOff, User } from "lucide-react";
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, where, addDoc } from "firebase/firestore";
import { db } from "../firebase";
import { ChatProfile, VoiceSignal } from "../types";

interface VoiceChannelProps {
  profile: ChatProfile;
  onLeave: () => void;
}

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

// Modifies SDP to force Opus to run at maximum bitrate (510kbps), stereo, CBR, without compression/suppression loss
function optimizeAudioSdp(sdp: string): string {
  const lines = sdp.split("\r\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("a=fmtp:") && lines[i].includes("opus")) {
      if (!lines[i].includes("maxaveragebitrate")) {
        lines[i] += ";maxaveragebitrate=510000;stereo=1;sprop-stereo=1;cbr=1;usedtx=0";
      }
    }
  }
  return lines.join("\r\n");
}

export default function VoiceChannel({ profile, onLeave }: VoiceChannelProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [participants, setParticipants] = useState<ChatProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<{ [uid: string]: RTCPeerConnection }>({});
  const iceCandidateQueuesRef = useRef<{ [uid: string]: RTCIceCandidateInit[] }>({});
  const audioElementsRef = useRef<{ [uid: string]: HTMLAudioElement }>({});

  useEffect(() => {
    let unsubscribeSignals: () => void;
    let unsubscribeUsers: () => void;

    async function initVoice() {
      try {
        // High quality uncompressed mic settings: disable aggressive noise suppression and dynamic gain compression
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: false, // Turn off heavy compression/noise gate
            autoGainControl: false,  // Turn off dynamic amplitude compression
            channelCount: { ideal: 2 },
            sampleRate: { ideal: 48000, min: 44100 },
            sampleSize: { ideal: 16 },
          },
          video: false,
        });
        localStreamRef.current = stream;

        // Register self as online
        await setDoc(doc(db, "voice_users", profile.uid), {
          uid: profile.uid,
          username: profile.username,
          photoURL: profile.photoURL || "",
          timestamp: Date.now(),
        });

        // Listen for other users
        unsubscribeUsers = onSnapshot(collection(db, "voice_users"), (snapshot) => {
          const users: ChatProfile[] = [];
          snapshot.forEach((d) => {
            const u = d.data() as ChatProfile;
            if (u.uid !== profile.uid) {
              users.push(u);
              // If their UID is greater, we initiate the call to avoid race conditions
              if (u.uid > profile.uid && !peersRef.current[u.uid]) {
                initiateCall(u.uid, stream);
              }
            }
          });
          setParticipants(users);
        });

        // Listen for WebRTC signals (Offers, Answers, Candidates)
        const q = query(collection(db, "signals"), where("receiverId", "==", profile.uid));
        unsubscribeSignals = onSnapshot(q, (snapshot) => {
          snapshot.docChanges().forEach(async (change) => {
            if (change.type === "added") {
              const signal = { id: change.doc.id, ...change.doc.data() } as VoiceSignal;
              await handleSignal(signal, stream);
              // Clean up signal after processing
              deleteDoc(doc(db, "signals", signal.id)).catch(() => {});
            }
          });
        });

      } catch (err: any) {
        console.error("Failed to access microphone", err);
        if (err.name === 'NotAllowedError' || err.name === 'SecurityError' || err.message?.includes('Permission denied')) {
          setError("Microphone permission was denied. Please allow microphone access in your browser settings to use voice chat.");
        } else {
          setError("Failed to access microphone. Please make sure you have a microphone connected.");
        }
      }
    }

    initVoice();

    return () => {
      // Cleanup
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
      }
      Object.values(peersRef.current).forEach((pc: RTCPeerConnection) => pc.close());
      Object.values(audioElementsRef.current).forEach((audio: HTMLAudioElement) => {
        audio.pause();
        audio.srcObject = null;
      });
      deleteDoc(doc(db, "voice_users", profile.uid)).catch(() => {});
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

    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    // Set maximum audio bitrate on senders
    pc.getSenders().forEach((sender) => {
      if (sender.track && sender.track.kind === "audio") {
        try {
          const params = sender.getParameters();
          if (!params.encodings) params.encodings = [{}];
          params.encodings[0].maxBitrate = 510000; // 510 kbps maximum Opus audio quality
          sender.setParameters(params).catch(() => {});
        } catch (e) {
          // Ignore if setParameters is unsupported
        }
      }
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(partnerUid, "candidate", JSON.stringify(event.candidate));
      }
    };

    pc.ontrack = (event) => {
      if (!audioElementsRef.current[partnerUid]) {
        const audio = new Audio();
        audio.autoplay = true;
        audioElementsRef.current[partnerUid] = audio;
      }
      audioElementsRef.current[partnerUid].srcObject = event.streams[0];
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed" || pc.iceConnectionState === "closed") {
        pc.close();
        delete peersRef.current[partnerUid];
        delete iceCandidateQueuesRef.current[partnerUid];
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
      console.error("Error initiating voice call:", err);
    }
  };

  const processCandidateQueue = async (partnerUid: string, pc: RTCPeerConnection) => {
    const queue = iceCandidateQueuesRef.current[partnerUid] || [];
    while (queue.length > 0) {
      const candidateData = queue.shift();
      if (candidateData) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidateData));
        } catch (e) {
          console.warn("Error processing queued ICE candidate:", e);
        }
      }
    }
  };

  const handleSignal = async (signal: VoiceSignal, stream: MediaStream) => {
    const partnerUid = signal.senderId;

    try {
      if (signal.type === "offer") {
        const offerDescription = new RTCSessionDescription(JSON.parse(signal.data));
        const pc = createPeerConnection(partnerUid, stream);
        await pc.setRemoteDescription(offerDescription);
        
        await processCandidateQueue(partnerUid, pc);

        const answer = await pc.createAnswer();
        const highQualityAnswer = new RTCSessionDescription({
          type: answer.type,
          sdp: optimizeAudioSdp(answer.sdp || ""),
        });
        await pc.setLocalDescription(highQualityAnswer);
        sendSignal(partnerUid, "answer", JSON.stringify(highQualityAnswer));
      } 
      else if (signal.type === "answer") {
        const pc = peersRef.current[partnerUid];
        if (pc) {
          // CRITICAL FIX: Only set remote answer SDP if RTCPeerConnection is expecting an answer (have-local-offer state)
          if (pc.signalingState === "have-local-offer") {
            const answerDescription = new RTCSessionDescription(JSON.parse(signal.data));
            await pc.setRemoteDescription(answerDescription);
            await processCandidateQueue(partnerUid, pc);
          } else {
            console.warn(`Skipped setting remote answer for ${partnerUid} as connection state is '${pc.signalingState}' (expected 'have-local-offer')`);
          }
        }
      } 
      else if (signal.type === "candidate") {
        const candidateData = JSON.parse(signal.data);
        const pc = peersRef.current[partnerUid];
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new RTCIceCandidate(candidateData)).catch((e) => {
            console.warn("Error adding ICE candidate:", e);
          });
        } else {
          // Queue candidate until remote description is ready
          if (!iceCandidateQueuesRef.current[partnerUid]) {
            iceCandidateQueuesRef.current[partnerUid] = [];
          }
          iceCandidateQueuesRef.current[partnerUid].push(candidateData);
        }
      }
    } catch (err) {
      console.error(`Error handling WebRTC signal (${signal.type}):`, err);
    }
  };

  const sendSignal = async (receiverId: string, type: "offer" | "answer" | "candidate", data: string) => {
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

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = isMuted;
      });
      setIsMuted(!isMuted);
    }
  };

  if (error) {
    return (
      <div className="flex flex-col h-full bg-black/95 backdrop-blur-xl border-l border-neutral-800 items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-red-500/20 text-red-500 flex items-center justify-center mb-4">
          <MicOff size={32} />
        </div>
        <h3 className="text-xl font-bold text-white mb-2">Microphone Blocked</h3>
        <p className="text-sm text-neutral-400 mb-6">{error}</p>
        <button onClick={onLeave} className="px-6 py-2 rounded-full bg-white text-black font-bold hover:scale-105 transition-transform">
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-black/95 backdrop-blur-xl border-l border-neutral-800">
      <div className="p-4 border-b border-neutral-800 flex flex-col items-center justify-center pt-8">
        <div className="relative mb-4">
          <img src={profile.photoURL} alt="Me" className="w-24 h-24 rounded-full border-2 border-green-500 object-cover" />
          {isMuted && (
            <div className="absolute bottom-0 right-0 bg-red-500 p-1.5 rounded-full border-2 border-black text-white">
              <MicOff size={14} />
            </div>
          )}
        </div>
        <h2 className="text-lg font-bold text-white">General Voice</h2>
        <div className="flex items-center gap-2 mt-1">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          <p className="text-xs text-green-400 font-semibold uppercase tracking-wider">Connected • Studio Quality Audio</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-4">Other Participants ({participants.length})</h3>
        <div className="grid grid-cols-3 gap-4">
          {participants.map((p) => (
            <div key={p.uid} className="flex flex-col items-center gap-2">
              <img src={p.photoURL} alt={p.username} className="w-14 h-14 rounded-full object-cover border border-neutral-700" />
              <span className="text-xs text-neutral-300 font-medium truncate w-full text-center">{p.username}</span>
            </div>
          ))}
          {participants.length === 0 && (
            <div className="col-span-3 text-center py-8 text-neutral-600 text-sm">
              It's quiet here. Wait for others to join.
            </div>
          )}
        </div>
      </div>

      <div className="p-6 border-t border-neutral-800 flex justify-center gap-6">
        <button
          onClick={toggleMute}
          className={`p-4 rounded-full transition-colors shadow-lg ${isMuted ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30' : 'bg-neutral-800 text-white hover:bg-neutral-700'}`}
        >
          {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
        </button>
        
        <button
          onClick={onLeave}
          className="p-4 rounded-full bg-red-500 text-white hover:bg-red-600 shadow-lg transition-colors"
        >
          <PhoneOff size={24} />
        </button>
      </div>
    </div>
  );
}

