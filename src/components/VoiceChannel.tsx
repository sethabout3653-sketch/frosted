import React, { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff, Video, VideoOff, PhoneOff, AlertCircle } from "lucide-react";
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

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" },
  ],
};

function optimizeAudioSdp(sdp: string): string {
  const lines = sdp.split("\r\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("a=fmtp:") && lines[i].includes("opus")) {
      if (!lines[i].includes("maxaveragebitrate")) {
        lines[i] += ";maxaveragebitrate=128000;stereo=1;sprop-stereo=1;cbr=1;usedtx=0";
      }
    }
  }
  return lines.join("\r\n");
}

export default function VoiceChannel({ profile, onLeave }: VoiceChannelProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [trackTrigger, setTrackTrigger] = useState(0);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cameraNotice, setCameraNotice] = useState<string | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const sessionStartTimeRef = useRef<number>(Date.now());
  const isMountedRef = useRef<boolean>(true);
  const isVideoOnRef = useRef<boolean>(false);

  // Reusable dummy video track generator for initial WebRTC video m-line negotiation
  const dummyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dummyTrackRef = useRef<MediaStreamTrack | null>(null);

  const peersRef = useRef<{ [uid: string]: RTCPeerConnection }>({});
  const iceCandidateQueuesRef = useRef<{ [uid: string]: RTCIceCandidateInit[] }>({});
  const remoteStreamsRef = useRef<{ [uid: string]: MediaStream }>({});
  const remoteAudioRefs = useRef<{ [uid: string]: HTMLAudioElement | null }>({});
  const remoteVideoRefs = useRef<{ [uid: string]: HTMLVideoElement | null }>({});

  const getOrCreateDummyVideoTrack = useCallback((): MediaStreamTrack => {
    if (dummyTrackRef.current && dummyTrackRef.current.readyState === "live") {
      return dummyTrackRef.current;
    }
    let canvas = dummyCanvasRef.current;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#0a0a0a";
        ctx.fillRect(0, 0, 16, 16);
      }
      dummyCanvasRef.current = canvas;
    }
    const canvasStream = canvas.captureStream(5);
    const track = canvasStream.getVideoTracks()[0];
    track.enabled = true;
    dummyTrackRef.current = track;
    return track;
  }, []);

  const stopAllMediaTracks = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
          t.enabled = false;
        } catch (e) {}
      });
      localStreamRef.current = null;
    }

    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
          t.enabled = false;
        } catch (e) {}
      });
      videoStreamRef.current = null;
    }

    if (dummyTrackRef.current) {
      try {
        dummyTrackRef.current.stop();
      } catch (e) {}
      dummyTrackRef.current = null;
    }

    Object.values(peersRef.current).forEach((pc: RTCPeerConnection) => {
      try {
        pc.getSenders().forEach((s) => {
          if (s.track) {
            try {
              s.track.stop();
            } catch (e) {}
          }
        });
        pc.close();
      } catch (e) {}
    });
    peersRef.current = {};
    iceCandidateQueuesRef.current = {};

    Object.values(remoteStreamsRef.current).forEach((stream: MediaStream) => {
      stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch (e) {}
      });
    });
    remoteStreamsRef.current = {};
  }, []);

  // Ensure local video element displays camera stream when enabled
  useEffect(() => {
    isVideoOnRef.current = isVideoOn;
    if (isVideoOn && localVideoRef.current && videoStreamRef.current) {
      localVideoRef.current.srcObject = videoStreamRef.current;
      localVideoRef.current.play().catch(() => {});
    }
  }, [isVideoOn]);

  // Synchronize remote media streams with DOM elements
  useEffect(() => {
    participants.forEach((p) => {
      const stream = remoteStreamsRef.current[p.uid];
      if (stream) {
        const audioEl = remoteAudioRefs.current[p.uid];
        if (audioEl && audioEl.srcObject !== stream) {
          audioEl.srcObject = stream;
          audioEl.play().catch(() => {});
        }

        if (p.isVideoOn) {
          const videoEl = remoteVideoRefs.current[p.uid];
          if (videoEl && videoEl.srcObject !== stream) {
            videoEl.srcObject = stream;
            videoEl.play().catch(() => {});
          }
        }
      }
    });
  }, [participants, trackTrigger]);

  // Global user-gesture audio resume listener to handle strict browser autoplay policies
  useEffect(() => {
    const resumeAudio = () => {
      (Object.values(remoteAudioRefs.current) as (HTMLAudioElement | null)[]).forEach((el) => {
        if (el && el.paused && el.srcObject) {
          el.play().catch(() => {});
        }
      });
    };

    window.addEventListener("click", resumeAudio);
    window.addEventListener("keydown", resumeAudio);
    window.addEventListener("touchstart", resumeAudio);
    return () => {
      window.removeEventListener("click", resumeAudio);
      window.removeEventListener("keydown", resumeAudio);
      window.removeEventListener("touchstart", resumeAudio);
    };
  }, []);

  const sendSignal = useCallback(
    async (
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
        console.warn("Error sending WebRTC signal:", err);
      }
    },
    [profile.uid]
  );

  const processCandidateQueue = useCallback(
    async (partnerUid: string, pc: RTCPeerConnection) => {
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
    },
    []
  );

  const createPeerConnection = useCallback(
    (partnerUid: string, micStream: MediaStream): RTCPeerConnection => {
      if (peersRef.current[partnerUid]) {
        try {
          peersRef.current[partnerUid].close();
        } catch (e) {}
        delete peersRef.current[partnerUid];
      }

      const pc = new RTCPeerConnection(ICE_SERVERS);
      peersRef.current[partnerUid] = pc;
      iceCandidateQueuesRef.current[partnerUid] = [];

      // 1. Add microphone audio track
      micStream.getAudioTracks().forEach((track) => {
        pc.addTrack(track, micStream);
      });

      // 2. Add video track (webcam if active, otherwise dummy video canvas track)
      const realVideoTrack = videoStreamRef.current?.getVideoTracks()[0];
      const videoTrackToSend =
        realVideoTrack && realVideoTrack.readyState === "live"
          ? realVideoTrack
          : getOrCreateDummyVideoTrack();

      pc.addTrack(videoTrackToSend, micStream);

      // Handle local ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal(partnerUid, "candidate", JSON.stringify(event.candidate));
        }
      };

      // Handle remote incoming tracks (both audio and video)
      pc.ontrack = (event) => {
        if (!remoteStreamsRef.current[partnerUid]) {
          remoteStreamsRef.current[partnerUid] = new MediaStream();
        }
        const rStream = remoteStreamsRef.current[partnerUid];

        if (event.track) {
          const currentTracks = rStream.getTracks();
          const existingSameKind = currentTracks.find((t) => t.kind === event.track.kind);
          if (existingSameKind) {
            if (existingSameKind.id !== event.track.id) {
              rStream.removeTrack(existingSameKind);
              rStream.addTrack(event.track);
            }
          } else {
            rStream.addTrack(event.track);
          }
        }

        // Attach to remote audio player
        const audioEl = remoteAudioRefs.current[partnerUid];
        if (audioEl) {
          if (audioEl.srcObject !== rStream) {
            audioEl.srcObject = rStream;
          }
          audioEl.play().catch(() => {});
        }

        // Attach to remote video player
        const videoEl = remoteVideoRefs.current[partnerUid];
        if (videoEl) {
          if (videoEl.srcObject !== rStream) {
            videoEl.srcObject = rStream;
          }
          videoEl.play().catch(() => {});
        }

        setTrackTrigger((v) => v + 1);
      };

      pc.oniceconnectionstatechange = () => {
        if (
          pc.iceConnectionState === "disconnected" ||
          pc.iceConnectionState === "failed" ||
          pc.iceConnectionState === "closed"
        ) {
          try {
            pc.close();
          } catch (e) {}
          delete peersRef.current[partnerUid];
          delete iceCandidateQueuesRef.current[partnerUid];
        }
      };

      return pc;
    },
    [getOrCreateDummyVideoTrack, sendSignal]
  );

  const initiateCall = useCallback(
    async (partnerUid: string, micStream: MediaStream) => {
      try {
        const pc = createPeerConnection(partnerUid, micStream);
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        const highQualityOffer = new RTCSessionDescription({
          type: offer.type,
          sdp: optimizeAudioSdp(offer.sdp || ""),
        });
        await pc.setLocalDescription(highQualityOffer);
        sendSignal(partnerUid, "offer", JSON.stringify(highQualityOffer));
      } catch (err) {
        console.warn("Error initiating call to", partnerUid, err);
      }
    },
    [createPeerConnection, sendSignal]
  );

  const handleSignal = useCallback(
    async (signal: VoiceSignal, micStream: MediaStream) => {
      if (signal.timestamp && signal.timestamp < sessionStartTimeRef.current - 10000) {
        return;
      }
      const partnerUid = signal.senderId;

      try {
        if (signal.type === "offer") {
          let pc = peersRef.current[partnerUid];
          const isDead =
            !pc || pc.connectionState === "closed" || pc.signalingState === "closed";

          if (isDead) {
            pc = createPeerConnection(partnerUid, micStream);
          } else if (pc.signalingState !== "stable") {
            if (profile.uid > partnerUid) {
              return;
            }
            await pc.setLocalDescription({ type: "rollback" }).catch(() => {});
          }

          const offerDescription = new RTCSessionDescription(JSON.parse(signal.data));
          if (pc.signalingState === "stable" || pc.signalingState === "have-local-offer") {
            await pc.setRemoteDescription(offerDescription);
            await processCandidateQueue(partnerUid, pc);

            if (pc.signalingState === "have-remote-offer") {
              const answer = await pc.createAnswer();
              const highQualityAnswer = new RTCSessionDescription({
                type: answer.type,
                sdp: optimizeAudioSdp(answer.sdp || ""),
              });
              await pc.setLocalDescription(highQualityAnswer);
              sendSignal(partnerUid, "answer", JSON.stringify(highQualityAnswer));
            }
          }
        } else if (signal.type === "answer") {
          const pc = peersRef.current[partnerUid];
          if (pc && pc.signalingState === "have-local-offer") {
            const answerDescription = new RTCSessionDescription(JSON.parse(signal.data));
            await pc.setRemoteDescription(answerDescription);
            await processCandidateQueue(partnerUid, pc);
          }
        } else if (signal.type === "candidate") {
          const candidateData = JSON.parse(signal.data);
          const pc = peersRef.current[partnerUid];
          if (pc && pc.remoteDescription && pc.remoteDescription.type) {
            await pc.addIceCandidate(new RTCIceCandidate(candidateData)).catch(() => {});
          } else {
            if (!iceCandidateQueuesRef.current[partnerUid]) {
              iceCandidateQueuesRef.current[partnerUid] = [];
            }
            iceCandidateQueuesRef.current[partnerUid].push(candidateData);
          }
        }
      } catch (err) {
        console.warn("Signal handling error:", err);
      }
    },
    [createPeerConnection, processCandidateQueue, profile.uid, sendSignal]
  );

  // Main lifecycle: acquire microphone and register in voice_users
  useEffect(() => {
    isMountedRef.current = true;
    let unsubscribeSignals: () => void;
    let unsubscribeUsers: () => void;
    sessionStartTimeRef.current = Date.now();

    const handleUnload = () => {
      stopAllMediaTracks();
      deleteDoc(doc(db, "voice_users", profile.uid)).catch(() => {});
      updateDoc(doc(db, "presence", profile.uid), {
        inVoice: false,
        isMuted: false,
      }).catch(() => {});
    };

    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("pagehide", handleUnload);

    async function initVoice() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });

        if (!isMountedRef.current) {
          stream.getTracks().forEach((t) => {
            t.stop();
            t.enabled = false;
          });
          return;
        }

        localStreamRef.current = stream;

        // Register self as active participant
        await setDoc(doc(db, "voice_users", profile.uid), {
          uid: profile.uid,
          username: profile.username,
          photoURL: profile.photoURL || "",
          isMuted: false,
          isVideoOn: false,
          timestamp: Date.now(),
        });

        if (!isMountedRef.current) {
          stopAllMediaTracks();
          return;
        }

        await updateDoc(doc(db, "presence", profile.uid), {
          isMuted: false,
          inVoice: true,
        }).catch(() => {});

        // Listen for participants
        unsubscribeUsers = onSnapshot(collection(db, "voice_users"), (snapshot) => {
          if (!isMountedRef.current) return;
          const users: Participant[] = [];
          snapshot.forEach((d) => {
            const u = d.data() as Participant;
            if (u.uid !== profile.uid) {
              users.push(u);
              const pc = peersRef.current[u.uid];
              const isDead =
                !pc || pc.connectionState === "closed" || pc.connectionState === "failed";
              // Deterministic offerer: peer with smaller UID initiates call
              if (profile.uid < u.uid && isDead && localStreamRef.current) {
                initiateCall(u.uid, localStreamRef.current);
              }
            }
          });
          setParticipants(users);
        });

        // Listen for signals directed to current user
        const q = query(
          collection(db, "signals"),
          where("receiverId", "==", profile.uid)
        );

        unsubscribeSignals = onSnapshot(q, (snapshot) => {
          if (!isMountedRef.current) return;
          snapshot.docChanges().forEach(async (change) => {
            if (change.type === "added") {
              const signal = {
                id: change.doc.id,
                ...change.doc.data(),
              } as VoiceSignal;

              // Immediately clean up processed signal from Firestore
              deleteDoc(doc(db, "signals", signal.id)).catch(() => {});

              if (localStreamRef.current && isMountedRef.current) {
                await handleSignal(signal, localStreamRef.current);
              }
            }
          });
        });
      } catch (err: any) {
        if (isMountedRef.current) {
          console.error("Failed to access microphone", err);
          setError("Failed to access microphone. Please allow microphone permissions in your browser.");
        }
      }
    }

    initVoice();

    return () => {
      isMountedRef.current = false;
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("pagehide", handleUnload);

      stopAllMediaTracks();

      deleteDoc(doc(db, "voice_users", profile.uid)).catch(() => {});
      updateDoc(doc(db, "presence", profile.uid), {
        inVoice: false,
        isMuted: false,
      }).catch(() => {});

      if (unsubscribeSignals) unsubscribeSignals();
      if (unsubscribeUsers) unsubscribeUsers();
    };
  }, [handleSignal, initiateCall, profile, stopAllMediaTracks]);

  // Toggle Microphone Mute
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

  // Toggle Video Camera
  const toggleVideo = async () => {
    const nextVideoState = !isVideoOn;
    setIsVideoOn(nextVideoState);
    isVideoOnRef.current = nextVideoState;
    setCameraNotice(null);

    try {
      if (nextVideoState) {
        // 1. Request camera stream
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: false,
        });

        if (!isMountedRef.current || !isVideoOnRef.current) {
          videoStream.getTracks().forEach((track) => {
            track.stop();
            track.enabled = false;
          });
          return;
        }

        const realVideoTrack = videoStream.getVideoTracks()[0];
        videoStreamRef.current = videoStream;

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = videoStream;
          localVideoRef.current.play().catch(() => {});
        }

        // 2. Seamlessly swap dummy track with real webcam track across all active peers
        await Promise.all(
          Object.keys(peersRef.current).map(async (pUid) => {
            const pc = peersRef.current[pUid];
            if (pc && pc.connectionState !== "closed") {
              const videoSender = pc.getSenders().find(
                (s) => s.track?.kind === "video"
              );
              if (videoSender) {
                await videoSender.replaceTrack(realVideoTrack);
              } else if (localStreamRef.current) {
                pc.addTrack(realVideoTrack, localStreamRef.current);
              }
            }
          })
        );
      } else {
        // 1. Swap back to dummy video track across peers
        const dummyTrack = getOrCreateDummyVideoTrack();

        await Promise.all(
          Object.keys(peersRef.current).map(async (pUid) => {
            const pc = peersRef.current[pUid];
            if (pc && pc.connectionState !== "closed") {
              const videoSender = pc.getSenders().find(
                (s) => s.track?.kind === "video"
              );
              if (videoSender) {
                await videoSender.replaceTrack(dummyTrack);
              }
            }
          })
        );

        // 2. Stop camera hardware so camera indicator light turns off
        if (videoStreamRef.current) {
          videoStreamRef.current.getTracks().forEach((track) => {
            track.stop();
            track.enabled = false;
          });
          videoStreamRef.current = null;
        }
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = null;
        }
      }

      await updateDoc(doc(db, "voice_users", profile.uid), {
        isVideoOn: nextVideoState,
      });
    } catch (e: any) {
      console.error("Failed to toggle camera:", e);
      setIsVideoOn(false);
      isVideoOnRef.current = false;
      setCameraNotice("Could not access camera. Please allow camera permissions in your browser.");
      setTimeout(() => setCameraNotice(null), 5000);
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach((t) => t.stop());
        videoStreamRef.current = null;
      }
    }
  };

  const handleLeave = () => {
    stopAllMediaTracks();
    onLeave();
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
          onClick={handleLeave}
          className="px-6 py-2.5 rounded-xl bg-white text-black font-bold hover:bg-neutral-200 transition-colors cursor-pointer"
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
          General Voice ({participants.length + 1})
        </span>
      </div>

      {/* Optional Notification Toast */}
      {cameraNotice && (
        <div className="mx-6 mt-3 px-4 py-2.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-medium flex items-center gap-2.5 animate-in fade-in duration-200">
          <AlertCircle size={16} className="text-amber-400 flex-shrink-0" />
          <span>{cameraNotice}</span>
        </div>
      )}

      {/* Main Grid: Local User & Remote Participants */}
      <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 items-center align-middle">
        {/* Local User Tile */}
        <div className="relative aspect-video rounded-2xl bg-[#0f0f0f] border border-neutral-800/90 overflow-hidden flex flex-col items-center justify-center shadow-lg group">
          {isVideoOn ? (
            <video
              ref={(el) => {
                localVideoRef.current = el;
                if (el && videoStreamRef.current && el.srcObject !== videoStreamRef.current) {
                  el.srcObject = videoStreamRef.current;
                  el.play().catch(() => {});
                }
              }}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover transform -scale-x-100"
            />
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="relative">
                {profile.photoURL ? (
                  <img
                    src={profile.photoURL}
                    alt={profile.username}
                    className="w-20 h-20 rounded-full object-cover border-2 border-neutral-700 shadow-md"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-neutral-800 border-2 border-neutral-700 flex items-center justify-center text-2xl font-bold text-white">
                    {profile.username.charAt(0).toUpperCase()}
                  </div>
                )}
                {isMuted && (
                  <div className="absolute -bottom-1 -right-1 bg-red-600 p-1.5 rounded-full text-white shadow-lg border-2 border-[#0f0f0f]">
                    <MicOff size={14} />
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="absolute bottom-3 left-3 bg-black/75 backdrop-blur-md px-3 py-1 rounded-lg border border-neutral-800 flex items-center gap-2 z-20">
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
        {participants.map((p) => {
          const stream = remoteStreamsRef.current[p.uid];

          return (
            <div
              key={p.uid}
              className="relative aspect-video rounded-2xl bg-[#0f0f0f] border border-neutral-800/90 overflow-hidden flex flex-col items-center justify-center shadow-lg"
            >
              {/* Dedicated persistent Audio element for voice playback */}
              <audio
                ref={(el) => {
                  remoteAudioRefs.current[p.uid] = el;
                  if (el && stream && el.srcObject !== stream) {
                    el.srcObject = stream;
                    el.play().catch(() => {});
                  }
                }}
                autoPlay
                playsInline
              />

              {/* Video Element rendered when remote user enabled their camera */}
              {p.isVideoOn ? (
                <video
                  ref={(el) => {
                    remoteVideoRefs.current[p.uid] = el;
                    if (el && stream && el.srcObject !== stream) {
                      el.srcObject = stream;
                      el.play().catch(() => {});
                    }
                  }}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="relative">
                    {p.photoURL ? (
                      <img
                        src={p.photoURL}
                        alt={p.username}
                        className="w-20 h-20 rounded-full object-cover border-2 border-neutral-700 shadow-md"
                      />
                    ) : (
                      <div className="w-20 h-20 rounded-full bg-neutral-800 border-2 border-neutral-700 flex items-center justify-center text-2xl font-bold text-white">
                        {p.username.charAt(0).toUpperCase()}
                      </div>
                    )}
                    {p.isMuted && (
                      <div className="absolute -bottom-1 -right-1 bg-red-600 p-1.5 rounded-full text-white shadow-lg border-2 border-[#0f0f0f]">
                        <MicOff size={14} />
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="absolute bottom-3 left-3 bg-black/75 backdrop-blur-md px-3 py-1 rounded-lg border border-neutral-800 flex items-center gap-2 z-20">
                <span className="text-xs font-bold text-white">{p.username}</span>
                {p.isMuted && (
                  <span className="text-[10px] text-red-400 font-bold uppercase tracking-wider bg-red-950/80 px-1.5 py-0.5 rounded border border-red-800/60">
                    Muted
                  </span>
                )}
              </div>
            </div>
          );
        })}
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
          onClick={handleLeave}
          className="p-3.5 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white shadow-xl transition-all cursor-pointer active:scale-95"
          title="Disconnect from Voice"
        >
          <PhoneOff size={20} className="text-white stroke-[2.5]" />
        </button>
      </div>
    </div>
  );
}
