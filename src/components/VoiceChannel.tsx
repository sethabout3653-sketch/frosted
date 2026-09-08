import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
import { supabase } from "../lib/supabase";
import { ChatProfile, VoiceSignal } from "../types";

interface VoiceChannelProps {
  profile: ChatProfile;
  onLeave: () => void;
  isPip?: boolean;
  onExpand?: () => void;
}

interface Participant extends ChatProfile {
  isMuted?: boolean;
  isVideoOn?: boolean;
  isVideoLoading?: boolean;
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

// Studio quality uncapped audio SDP optimizer:
// - 510000 bps maximum Opus bitrate (no artificial compression)
// - Stereo enabled (stereo=1, sprop-stereo=1) for music, soundboards, and rich audio
// - usedtx=0 completely disables discontinuous transmission / voice-activity gating (never cuts off quiet/sustained sounds)
// - maxplaybackrate=48000 for full 48kHz frequency spectrum
// - cbr=1 (constant bitrate transmission, no ducking or compression drops)
function optimizeAudioSdp(sdp: string): string {
  const lines = sdp.split("\r\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("a=fmtp:") && lines[i].includes("opus")) {
      const base = lines[i].split(";")[0];
      lines[i] = `${base};maxaveragebitrate=510000;stereo=1;sprop-stereo=1;cbr=1;usedtx=0;maxplaybackrate=48000;minptime=10;useinbandfec=1`;
    }
  }
  return lines.join("\r\n");
}

export default function VoiceChannel({
  profile,
  onLeave,
  isPip = false,
  onExpand,
}: VoiceChannelProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [remoteVideoLoaded, setRemoteVideoLoaded] = useState<Record<string, boolean>>({});
  const previousParticipantIdsRef = useRef<Set<string> | null>(null);
  const joinSoundRef = useRef<HTMLAudioElement | null>(null);
  const leaveSoundRef = useRef<HTMLAudioElement | null>(null);
  const [trackTrigger, setTrackTrigger] = useState(0);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [currentTime, setCurrentTime] = useState<number>(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [cameraNotice, setCameraNotice] = useState<string | null>(null);

  // Keep refs in sync for heartbeat timer
  const isMutedRef = useRef(isMuted);
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const isCameraLoadingRef = useRef(isCameraLoading);
  useEffect(() => {
    isCameraLoadingRef.current = isCameraLoading;
  }, [isCameraLoading]);

  // 1-second interval to continuously re-evaluate presence and prune disconnected/lagging participants
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Filter out any participant who lost connection or battery and stopped sending heartbeats (> 6s)
  const activeParticipants = useMemo(() => {
    return participants.filter((p) => {
      const ts = p.timestamp || (p as any).lastSeen;
      return typeof ts === "number" ? currentTime - ts < 6000 : true;
    });
  }, [participants, currentTime]);

  // Audio level and remote volume states
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [participantVolumes, setParticipantVolumes] = useState<{ [uid: string]: number }>({});

  const localStreamRef = useRef<MediaStream | null>(null);
  const rawStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

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

  // Automatically acquire studio microphone stream with automatic echo cancellation by default
  const acquireMicrophoneStream = useCallback(async (): Promise<MediaStream> => {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: { ideal: 2 },
          sampleRate: { ideal: 48000 },
        },
        video: false,
      });
    } catch (err) {
      console.warn("High fidelity mic constraints failed, using fallback:", err);
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: false,
            autoGainControl: false,
          },
          video: false,
         });
      } catch (err2) {
        return await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      }
    }
  }, []);

  // Connect microphone to live Web Audio pipeline for real-time level metering
  const setupAudioPipeline = useCallback(
    async (sourceStream: MediaStream): Promise<MediaStream> => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }

      rawStreamRef.current = sourceStream;

      try {
        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

        if (!AudioContextClass) {
          localStreamRef.current = sourceStream;
          return sourceStream;
        }

        if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
          audioCtxRef.current = new AudioContextClass();
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === "suspended") {
          await ctx.resume().catch(() => {});
        }

        const source = ctx.createMediaStreamSource(sourceStream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.3;
        source.connect(analyser);
        analyserRef.current = analyser;

        // Monitor real-time volume levels for live UI feedback
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const updateLevel = () => {
          if (!isMountedRef.current) return;
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          const normalized = Math.min(100, Math.round((avg / 128) * 100));
          setAudioLevel(normalized);
          animFrameRef.current = requestAnimationFrame(updateLevel);
        };
        animFrameRef.current = requestAnimationFrame(updateLevel);

        localStreamRef.current = sourceStream;
        return sourceStream;
      } catch (err) {
        console.warn("AudioContext setup fallback to raw stream:", err);
        localStreamRef.current = sourceStream;
        return sourceStream;
      }
    },
    []
  );

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
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close().catch(() => {});
      } catch {}
      audioCtxRef.current = null;
    }

    if (rawStreamRef.current) {
      rawStreamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
          t.enabled = false;
        } catch {}
      });
      rawStreamRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
          t.enabled = false;
        } catch {}
      });
      localStreamRef.current = null;
    }

    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
          t.enabled = false;
        } catch {}
      });
      videoStreamRef.current = null;
    }

    if (dummyTrackRef.current) {
      try {
        dummyTrackRef.current.stop();
      } catch {}
      dummyTrackRef.current = null;
    }

    Object.values(peersRef.current).forEach((pc: RTCPeerConnection) => {
      try {
        pc.getSenders().forEach((s) => {
          if (s.track) {
            try {
              s.track.stop();
            } catch {}
          }
        });
        pc.close();
      } catch {}
    });
    peersRef.current = {};
    iceCandidateQueuesRef.current = {};

    Object.values(remoteStreamsRef.current).forEach((stream: MediaStream) => {
      stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
    });
    remoteStreamsRef.current = {};
  }, []);

  // Play globally when a remote participant joins or leaves the channel.
  // The first participant snapshot only establishes a baseline and stays silent.
  useEffect(() => {
    const remoteIds = new Set(participants.filter((participant) => participant.uid !== profile.uid).map((participant) => participant.uid));
    const previousIds = previousParticipantIdsRef.current;
    if (previousIds) {
      const joined = [...remoteIds].some((uid) => !previousIds.has(uid));
      const left = [...previousIds].some((uid) => !remoteIds.has(uid));
      if (joined) {
        joinSoundRef.current ||= new Audio("/audio/discord-join.mp3");
        joinSoundRef.current.currentTime = 0;
        joinSoundRef.current.volume = 0.82;
        joinSoundRef.current.play().catch(() => {});
      }
      if (left) {
        leaveSoundRef.current ||= new Audio("/audio/LockChime.wav");
        leaveSoundRef.current.currentTime = 0;
        leaveSoundRef.current.volume = 1;
        leaveSoundRef.current.play().catch(() => {});
      }
    }
    previousParticipantIdsRef.current = remoteIds;
  }, [participants, profile.uid]);

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

  // Clean up remote video loaded state when participants leave or turn off camera
  useEffect(() => {
    const activeVideoUids = new Set(
      participants.filter((p) => p.isVideoOn).map((p) => p.uid)
    );
    setRemoteVideoLoaded((prev) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [uid, loaded] of Object.entries(prev) as [string, boolean][]) {
        if (activeVideoUids.has(uid)) {
          next[uid] = loaded;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [participants]);

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
        await supabase.from("signals").insert({
          id: "sig_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8),
          sender_id: profile.uid,
          receiver_id: receiverId,
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

      // Maximize audio sender encoding bitrate to 510kbps uncapped
      const audioSender = pc.getSenders().find((s) => s.track?.kind === "audio");
      if (audioSender && audioSender.setParameters) {
        try {
          const params = audioSender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = 510000;
          params.encodings[0].priority = "high";
          params.encodings[0].networkPriority = "high";
          audioSender.setParameters(params).catch(() => {});
        } catch (e) {}
      }

      // 2. Add the camera track only when enabled, otherwise use a stable placeholder
      const realVideoTrack = videoStreamRef.current?.getVideoTracks()[0];
      const cameraTrack = realVideoTrack && realVideoTrack.readyState === "live"
        ? realVideoTrack
        : getOrCreateDummyVideoTrack();
      pc.addTrack(cameraTrack, micStream);

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
        if (event.track && !rStream.getTracks().some((track) => track.id === event.track.id)) {
          if (event.track.kind === "audio") {
            rStream.getAudioTracks().forEach((track) => rStream.removeTrack(track));
          }
          rStream.addTrack(event.track);
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
          if (videoEl.srcObject !== rStream) videoEl.srcObject = rStream;
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

  // Main lifecycle: acquire microphone and register in voice_users via Supabase
  useEffect(() => {
    isMountedRef.current = true;
    let channelSignals: any;
    let channelUsers: any;
    sessionStartTimeRef.current = Date.now();

    const handleUnload = () => {
      stopAllMediaTracks();
      supabase.from("voice_users").delete().eq("uid", profile.uid).catch(() => {});
      supabase.from("presence").update({
        in_voice: false,
        is_muted: false,
      }).eq("uid", profile.uid).catch(() => {});
    };

    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("pagehide", handleUnload);

    async function initVoice() {
      try {
        const rawStream = await acquireMicrophoneStream();

        if (!isMountedRef.current) {
          rawStream.getTracks().forEach((t) => {
            t.stop();
            t.enabled = false;
          });
          return;
        }

        const stream = await setupAudioPipeline(rawStream);

        if (!isMountedRef.current) {
          stopAllMediaTracks();
          return;
        }

        localStreamRef.current = stream;

        // Register self as active participant
        await supabase.from("voice_users").upsert({
          uid: profile.uid,
          username: profile.username,
          photo_url: profile.photoURL || "",
          is_muted: false,
          is_video_on: false,
          is_video_loading: false,
          timestamp: Date.now(),
        }, { onConflict: "uid" });

        if (!isMountedRef.current) {
          stopAllMediaTracks();
          return;
        }

        await supabase.from("presence").upsert({
          uid: profile.uid,
          username: profile.username,
          photo_url: profile.photoURL || "",
          status: "online",
          last_seen: Date.now(),
          is_muted: false,
          in_voice: true,
        }, { onConflict: "uid" }).catch(() => {});

        // Real-time listener for voice participants
        const fetchUsers = async () => {
          if (!isMountedRef.current) return;
          const { data } = await supabase.from("voice_users").select("*");
          if (!isMountedRef.current || !data) return;
          const users: Participant[] = [];
          const activeUids = new Set<string>();
          data.forEach((u: any) => {
            const mappedUser: Participant = {
              uid: u.uid,
              username: u.username,
              photoURL: u.photo_url || u.photoURL || "",
              isMuted: u.is_muted ?? u.isMuted ?? false,
              isVideoOn: u.is_video_on ?? u.isVideoOn ?? false,
              isVideoLoading: u.is_video_loading ?? u.isVideoLoading ?? false,
              timestamp: u.timestamp || u.last_seen || u.lastSeen,
            };
            activeUids.add(mappedUser.uid);
            if (mappedUser.uid !== profile.uid) {
              users.push(mappedUser);
              const pc = peersRef.current[mappedUser.uid];
              const isDead =
                !pc ||
                pc.connectionState === "closed" ||
                pc.connectionState === "failed";
              if (
                profile.uid < mappedUser.uid &&
                isDead &&
                localStreamRef.current
              ) {
                initiateCall(mappedUser.uid, localStreamRef.current);
              }
            }
          });

          // Instantly clean up peer connection and audio/video for anyone who left
          Object.keys(peersRef.current).forEach((peerUid) => {
            if (!activeUids.has(peerUid)) {
              try {
                peersRef.current[peerUid].close();
              } catch (e) {}
              delete peersRef.current[peerUid];
              delete iceCandidateQueuesRef.current[peerUid];
              if (remoteStreamsRef.current[peerUid]) {
                remoteStreamsRef.current[peerUid].getTracks().forEach((t) => t.stop());
                delete remoteStreamsRef.current[peerUid];
              }
            }
          });

          setParticipants(users);
        };

        fetchUsers();

        channelUsers = supabase
          .channel("voice_users_listener")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "voice_users" },
            () => {
              fetchUsers();
            }
          )
          .subscribe();

        // WebRTC signals handling for this user
        const processedSignals = new Set<string>();
        const handleIncomingSignal = async (rawSig: any) => {
          if (!rawSig) return;
          const sigId = rawSig.id;
          if (sigId && processedSignals.has(sigId)) return;
          if (sigId) processedSignals.add(sigId);

          const signal: VoiceSignal = {
            id: rawSig.id,
            senderId: rawSig.sender_id || rawSig.senderId,
            receiverId: rawSig.receiver_id || rawSig.receiverId,
            type: rawSig.type,
            data: rawSig.data,
            timestamp: rawSig.timestamp,
          };

          if (sigId) {
            supabase.from("signals").delete().eq("id", sigId).catch(() => {});
          }

          if (localStreamRef.current && isMountedRef.current) {
            await handleSignal(signal, localStreamRef.current);
          }
        };

        // Check any pending signals in DB
        const fetchPendingSignals = async () => {
          const { data } = await supabase
            .from("signals")
            .select("*")
            .eq("receiver_id", profile.uid);
          if (data && data.length > 0) {
            for (const s of data) {
              await handleIncomingSignal(s);
            }
          }
        };
        fetchPendingSignals();

        channelSignals = supabase
          .channel(`signals_${profile.uid}`)
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "signals",
              filter: `receiver_id=eq.${profile.uid}`,
            },
            async (payload: any) => {
              if (!isMountedRef.current) return;
              const rawSig = payload.new || payload.record;
              if (rawSig) {
                await handleIncomingSignal(rawSig);
              }
            }
          )
          .subscribe();
      } catch (err: any) {
        if (isMountedRef.current) {
          console.error("Failed to access microphone", err);
          setError("Failed to access microphone. Please allow microphone permissions in your browser.");
        }
      }
    }

    initVoice();

    // Fast 2-second heartbeat to ensure other peers know this client is alive
    const heartbeatInterval = setInterval(async () => {
      if (!isMountedRef.current) return;
      try {
        await supabase.from("voice_users").update({
          timestamp: Date.now(),
          last_seen: Date.now(),
          is_muted: isMutedRef.current,
          is_video_on: isVideoOnRef.current,
          is_video_loading: isCameraLoadingRef.current,
        }).eq("uid", profile.uid).catch(() => {});
        await supabase.from("presence").update({
          last_seen: Date.now(),
          status: "online",
          in_voice: true,
          is_muted: isMutedRef.current,
        }).eq("uid", profile.uid).catch(() => {});
      } catch (e) {}
    }, 2000);

    return () => {
      isMountedRef.current = false;
      clearInterval(heartbeatInterval);
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("pagehide", handleUnload);

      stopAllMediaTracks();

      supabase.from("voice_users").delete().eq("uid", profile.uid).catch(() => {});
      supabase.from("presence").update({
        in_voice: false,
        is_muted: false,
      }).eq("uid", profile.uid).catch(() => {});

      if (channelSignals) supabase.removeChannel(channelSignals);
      if (channelUsers) supabase.removeChannel(channelUsers);
    };
  }, [handleSignal, initiateCall, profile, stopAllMediaTracks]);

  // Continuously prune and close dead/lagging peer connections when a peer loses connection or battery
  useEffect(() => {
    const now = Date.now();
    participants.forEach((p) => {
      const ts = p.timestamp || (p as any).lastSeen;
      if (typeof ts === "number" && now - ts > 6000) {
        if (peersRef.current[p.uid]) {
          try {
            peersRef.current[p.uid].close();
          } catch (e) {}
          delete peersRef.current[p.uid];
          delete iceCandidateQueuesRef.current[p.uid];
          if (remoteStreamsRef.current[p.uid]) {
            remoteStreamsRef.current[p.uid].getTracks().forEach((t) => t.stop());
            delete remoteStreamsRef.current[p.uid];
          }
        }
        // If dead for over 12 seconds, clean up from database
        if (now - ts > 12000) {
          supabase.from("voice_users").delete().eq("uid", p.uid).catch(() => {});
        }
      }
    });
  }, [currentTime, participants]);

  // Toggle Microphone Mute
  const toggleMute = async () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);

    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !nextMuted;
      });
    }
    if (rawStreamRef.current) {
      rawStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !nextMuted;
      });
    }

    try {
      await supabase.from("voice_users").update({
        is_muted: nextMuted,
      }).eq("uid", profile.uid);
      await supabase.from("presence").update({
        is_muted: nextMuted,
      }).eq("uid", profile.uid);
    } catch (e) {}
  };

  // Toggle Video Camera
  const toggleVideo = async () => {
    if (isCameraLoading) return;
    const nextVideoState = !isVideoOn;
    setCameraNotice(null);

    try {
      if (nextVideoState) {
        setIsCameraLoading(true);
        setIsVideoOn(true);
        isVideoOnRef.current = true;

        // Broadcast to all other participants immediately that camera is loading
        await supabase.from("voice_users").update({
          is_video_loading: true,
          is_video_on: false,
        }).eq("uid", profile.uid).catch((err) => console.warn("Error setting isVideoLoading:", err));

        // 1. Request camera stream from user's hardware
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
          setIsCameraLoading(false);
          setIsVideoOn(false);
          isVideoOnRef.current = false;
          await supabase.from("voice_users").update({
            is_video_on: false,
            is_video_loading: false,
          }).eq("uid", profile.uid).catch(() => {});
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

        // 3. Mark camera as active and ready in database
        setIsCameraLoading(false);
        await supabase.from("voice_users").update({
          is_video_on: true,
          is_video_loading: false,
        }).eq("uid", profile.uid);
      } else {
        setIsVideoOn(false);
        isVideoOnRef.current = false;
        setIsCameraLoading(false);

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

        await supabase.from("voice_users").update({
          is_video_on: false,
          is_video_loading: false,
        }).eq("uid", profile.uid);
      }
    } catch (e: any) {
      console.error("Failed to toggle camera:", e);
      setIsVideoOn(false);
      setIsCameraLoading(false);
      isVideoOnRef.current = false;
      setCameraNotice("Could not access camera. Please allow camera permissions in your browser.");
      setTimeout(() => setCameraNotice(null), 5000);
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach((t) => t.stop());
        videoStreamRef.current = null;
      }
      await supabase.from("voice_users").update({
        is_video_on: false,
        is_video_loading: false,
      }).eq("uid", profile.uid).catch(() => {});
    }
  };

  const handleLeave = () => {
    // 1. Immediately delete voice_users document and mark presence as left voice
    supabase.from("voice_users").delete().eq("uid", profile.uid).catch(() => {});
    supabase.from("presence").update({
      in_voice: false,
      is_muted: false,
    }).eq("uid", profile.uid).catch(() => {});

    // 2. Play leave sound for user instantly
    try {
      leaveSoundRef.current ||= new Audio("/audio/LockChime.wav");
      leaveSoundRef.current.currentTime = 0;
      leaveSoundRef.current.volume = 1;
      leaveSoundRef.current.play().catch(() => {});
    } catch {}

    // 3. Immediately stop local media tracks and release hardware
    stopAllMediaTracks();

    // 4. Close all active WebRTC peer connections
    for (const peerId in peersRef.current) {
      try {
        peersRef.current[peerId]?.close();
      } catch {}
    }
    peersRef.current = {};

    // 5. Notify parent to update view immediately
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

  const activeRemoteWithVideo = activeParticipants.find((p) => p.isVideoOn);
  const anyVideoOn = !!activeRemoteWithVideo || isVideoOn;

  return (
    <>
      {/* Hidden persistent audio playback elements for all remote peers (never unmounted on view mode toggle) */}
      <div className="hidden" aria-hidden="true">
        {activeParticipants.map((p) => (
          <audio
            key={`audio-playback-${p.uid}`}
            ref={(el) => {
              remoteAudioRefs.current[p.uid] = el;
              const remoteStream = remoteStreamsRef.current[p.uid];
              if (el && remoteStream && el.srcObject !== remoteStream) {
                el.srcObject = remoteStream;
                el.play().catch(() => {});
              }
            }}
            autoPlay
            playsInline
          />
        ))}
      </div>

      {isPip ? (
        <div
          id="discord-voice-pip"
          className="fixed bottom-4 right-4 z-50 flex flex-col bg-[#111214] border border-[#2b2d31] rounded-2xl shadow-2xl overflow-hidden backdrop-blur-xl animate-in fade-in slide-in-from-bottom-3 duration-200"
          style={{ width: anyVideoOn ? "320px" : "280px" }}
        >
          {/* Top Header Bar */}
          <div className="h-9 px-3 bg-[#1e1f22] border-b border-[#2b2d31] flex items-center justify-between">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
              <span className="text-[11px] font-bold text-emerald-400 tracking-wide truncate">
                Voice Connected
              </span>
              <span className="text-[10px] text-neutral-400 truncate">
                • General
              </span>
            </div>
            {onExpand && (
              <button
                onClick={onExpand}
                className="p-1 text-neutral-400 hover:text-white rounded hover:bg-[#313338] transition-colors cursor-pointer"
                title="Return to Voice Channel"
              >
                <Maximize2 size={13} />
              </button>
            )}
          </div>

        {/* Video or Avatar Display */}
        {anyVideoOn ? (
          <div className="relative aspect-video w-full bg-black overflow-hidden flex items-center justify-center">
            {activeRemoteWithVideo ? (
              <>
                <video
                  ref={(el) => {
                    remoteVideoRefs.current[activeRemoteWithVideo.uid] = el;
                    const stream = remoteStreamsRef.current[activeRemoteWithVideo.uid];
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
                <div className="absolute bottom-2 left-2 bg-black/75 px-2 py-0.5 rounded text-[10px] font-semibold text-white truncate max-w-[140px]">
                  {activeRemoteWithVideo.username}
                </div>
                {isVideoOn && (
                  <div className="absolute top-2 right-2 w-20 aspect-video rounded-md overflow-hidden border border-neutral-700 shadow-md bg-black">
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
                  </div>
                )}
              </>
            ) : (
              <>
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
                <div className="absolute bottom-2 left-2 bg-black/75 px-2 py-0.5 rounded text-[10px] font-semibold text-white">
                  You
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="p-3 bg-[#111214] flex items-center justify-center gap-2.5">
            <div className="flex flex-col items-center gap-1">
              <div className="relative">
                <img
                  src={profile.photoURL}
                  alt={profile.username}
                  className={`w-10 h-10 rounded-full object-cover border-2 transition-all ${
                    audioLevel > 5 && !isMuted
                      ? "border-emerald-400 ring-2 ring-emerald-500/30 scale-105"
                      : "border-[#2b2d31]"
                  }`}
                />
                {isMuted && (
                  <div className="absolute -bottom-1 -right-1 bg-red-600 p-0.5 rounded-full text-white">
                    <MicOff size={10} />
                  </div>
                )}
              </div>
              <span className="text-[10px] font-medium text-neutral-300 truncate max-w-[60px]">
                You
              </span>
            </div>

            {activeParticipants.slice(0, 3).map((p) => (
              <div key={p.uid} className="flex flex-col items-center gap-1">
                <div className="relative">
                  <img
                    src={p.photoURL}
                    alt={p.username}
                    className="w-10 h-10 rounded-full object-cover border-2 border-[#2b2d31]"
                  />
                  {p.isMuted && (
                    <div className="absolute -bottom-1 -right-1 bg-red-600 p-0.5 rounded-full text-white">
                      <MicOff size={10} />
                    </div>
                  )}
                </div>
                <span className="text-[10px] font-medium text-neutral-300 truncate max-w-[60px]">
                  {p.username}
                </span>
              </div>
            ))}
            {activeParticipants.length > 3 && (
              <span className="text-[10px] text-neutral-400 font-bold self-center">
                +{activeParticipants.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Discord Controls Bar */}
        <div className="px-3 py-2 bg-[#1e1f22] border-t border-[#2b2d31] flex items-center justify-center gap-2">
          <button
            onClick={toggleMute}
            className={`p-2 rounded-xl transition-all cursor-pointer ${
              isMuted
                ? "bg-red-600/20 text-red-500 border border-red-800/80 hover:bg-red-600/30"
                : "bg-[#2b2d31] text-white hover:bg-[#35373c]"
            }`}
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
          </button>

          <button
            onClick={toggleVideo}
            disabled={isCameraLoading}
            className={`p-2 rounded-xl transition-all cursor-pointer ${
              isCameraLoading
                ? "bg-[#2b2d31] text-cyan-400 animate-pulse cursor-wait"
                : isVideoOn
                ? "bg-white text-black font-bold"
                : "bg-[#2b2d31] text-white hover:bg-[#35373c]"
            }`}
            title={isVideoOn ? "Turn off camera" : "Turn on camera"}
          >
            {isCameraLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : isVideoOn ? (
              <Video size={14} />
            ) : (
              <VideoOff size={14} />
            )}
          </button>

          <button
            onClick={handleLeave}
            className="p-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white transition-all cursor-pointer active:scale-95"
            title="Disconnect"
          >
            <PhoneOff size={14} />
          </button>
        </div>
      </div>
    ) : (
      <div className="fixed inset-y-0 right-0 left-16 sm:left-72 z-30 flex flex-col bg-black text-white min-h-0 overflow-hidden">
        {/* Top Header Bar */}
        <div className="h-12 px-6 border-b border-neutral-900 bg-black flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-sm font-extrabold text-emerald-400 tracking-wide">
              Voice Connected
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-neutral-400 hidden sm:inline">
              General Voice ({activeParticipants.length + 1})
            </span>
            <button
              onClick={handleLeave}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600/90 hover:bg-rose-500 text-white text-xs font-bold transition-all cursor-pointer shadow active:scale-95"
              title="Disconnect from Voice"
            >
              <PhoneOff size={14} />
              <span>Disconnect</span>
            </button>
          </div>
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
        <div
          className={`relative aspect-video rounded-2xl bg-[#0f0f0f] border overflow-hidden flex flex-col items-center justify-center shadow-lg group transition-all duration-150 ${
            audioLevel > 5 && !isMuted
              ? "border-emerald-500/80 shadow-[0_0_20px_rgba(16,185,129,0.3)]"
              : "border-neutral-800/90"
          }`}
        >
          {/* Audio Status Badge */}
          <div className="absolute top-3 left-3 bg-black/80 backdrop-blur-md px-2.5 py-1 rounded-lg border border-neutral-800 flex items-center gap-1.5 z-20">
            <div
              className={`w-2 h-2 rounded-full transition-colors ${
                isMuted
                  ? "bg-red-500"
                  : audioLevel > 5
                  ? "bg-emerald-400 animate-pulse"
                  : "bg-cyan-400"
              }`}
            />
            <span className="text-[10px] font-bold text-white tracking-wider flex items-center gap-1">
              {isMuted ? (
                "MUTED"
              ) : audioLevel > 5 ? (
                "SPEAKING"
              ) : (
                <>
                  <Zap size={10} className="text-cyan-400 fill-cyan-400/40" />
                  STUDIO
                </>
              )}
            </span>
          </div>

          {isVideoOn ? (
            <div className="relative w-full h-full">
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
                onLoadedData={() => setIsCameraLoading(false)}
                className={`w-full h-full object-cover transform -scale-x-100 transition-opacity duration-300 ${
                  isCameraLoading ? "opacity-0" : "opacity-100"
                }`}
              />

              {isCameraLoading && (
                <div className="absolute inset-0 bg-[#30343b] flex items-center justify-center z-10 animate-in fade-in duration-200">
                  <img
                    src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/loading-discord-4cdhz1tE0SAtxrt5ioRt7yzc8DpALU.gif"
                    alt="Loading camera"
                    className="w-12 h-12 object-contain"
                  />
                </div>
              )}
            </div>
          ) : isCameraLoading ? (
<div className="relative w-full h-full bg-[#30343b] flex items-center justify-center animate-in fade-in duration-200">
              <img
                src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/loading-discord-4cdhz1tE0SAtxrt5ioRt7yzc8DpALU.gif"
                alt="Loading camera"
                className="w-12 h-12 object-contain"
              />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="relative">
                {profile.photoURL ? (
                  <img
                    src={profile.photoURL}
                    alt={profile.username}
                    className={`w-20 h-20 rounded-full object-cover border-2 shadow-md transition-all duration-150 ${
                      audioLevel > 5 && !isMuted
                        ? "border-emerald-400 ring-4 ring-emerald-500/25 scale-105"
                        : "border-neutral-700"
                    }`}
                  />
                ) : (
                  <div
                    className={`w-20 h-20 rounded-full bg-neutral-800 border-2 flex items-center justify-center text-2xl font-bold text-white transition-all duration-150 ${
                      audioLevel > 5 && !isMuted
                        ? "border-emerald-400 ring-4 ring-emerald-500/25 scale-105"
                        : "border-neutral-700"
                    }`}
                  >
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
        {activeParticipants.map((p) => {
          const stream = remoteStreamsRef.current[p.uid];

          return (
            <div
              key={p.uid}
              className="relative aspect-video rounded-2xl bg-[#0f0f0f] border border-neutral-800/90 overflow-hidden flex flex-col items-center justify-center shadow-lg"
            >
              {/* Volume Slider for Remote User */}
              <div className="absolute top-3 right-3 bg-black/80 backdrop-blur-md px-2 py-1 rounded-lg border border-neutral-800 flex items-center gap-1.5 z-20">
                <Volume2 size={12} className="text-neutral-400" />
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round((participantVolumes[p.uid] ?? 1.0) * 100)}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10) / 100;
                    setParticipantVolumes((prev) => ({ ...prev, [p.uid]: val }));
                    const audioEl = remoteAudioRefs.current[p.uid];
                    if (audioEl) audioEl.volume = Math.max(0, Math.min(1.0, val));
                  }}
                  className="w-14 h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  title={`Volume: ${Math.round((participantVolumes[p.uid] ?? 1.0) * 100)}%`}
                />
                <span className="text-[9px] text-neutral-300 font-mono w-6 text-right">
                  {Math.round((participantVolumes[p.uid] ?? 1.0) * 100)}%
                </span>
              </div>

              {/* Video Element rendered when remote user enabled their camera */}
              {p.isVideoOn ? (
                <div className="relative w-full h-full">
                  <video
                    ref={(el) => {
                      remoteVideoRefs.current[p.uid] = el;
                      const remoteStream = remoteStreamsRef.current[p.uid];
                      if (el && remoteStream && el.srcObject !== remoteStream) {
                        el.srcObject = remoteStream;
                        el.play().catch(() => {});
                      }
                    }}
                    autoPlay
                    playsInline
                    muted
                    onLoadedData={() => {
                      setRemoteVideoLoaded((prev) => ({ ...prev, [p.uid]: true }));
                    }}
                    onPlaying={() => {
                      setRemoteVideoLoaded((prev) => ({ ...prev, [p.uid]: true }));
                    }}
                    className={`w-full h-full object-cover transition-opacity duration-300 ${
                      remoteVideoLoaded[p.uid] && !p.isVideoLoading ? "opacity-100" : "opacity-0"
                    }`}
                  />

                  {/* Loading screen while remote video is connecting or buffering */}
                  {(!remoteVideoLoaded[p.uid] || p.isVideoLoading) && (
                    <div className="absolute inset-0 bg-[#30343b] flex items-center justify-center z-10 animate-in fade-in duration-200">
                      <img
                        src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/loading-discord-4cdhz1tE0SAtxrt5ioRt7yzc8DpALU.gif"
                        alt="Loading camera"
                        className="w-12 h-12 object-contain"
                      />
                    </div>
                  )}
                </div>
              ) : p.isVideoLoading ? (
                /* Loading screen when remote user is starting camera (before isVideoOn is set) */
                <div className="relative w-full h-full bg-[#30343b] flex items-center justify-center animate-in fade-in duration-200">
                  <img
                    src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/loading-discord-4cdhz1tE0SAtxrt5ioRt7yzc8DpALU.gif"
                    alt="Loading camera"
                    className="w-12 h-12 object-contain"
                  />
                </div>
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
      <div className="p-6 bg-black border-t border-neutral-900 flex justify-center items-center gap-4 flex-shrink-0 relative">
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
          disabled={isCameraLoading}
          className={`p-3.5 rounded-2xl transition-all cursor-pointer ${
            isCameraLoading
              ? "bg-neutral-800 text-cyan-400 border border-cyan-500/40 animate-pulse cursor-wait"
              : isVideoOn
              ? "bg-white text-black font-bold shadow-lg"
              : "bg-neutral-900 text-white border border-neutral-800 hover:bg-neutral-800"
          }`}
          title={
            isCameraLoading
              ? "Starting camera..."
              : isVideoOn
              ? "Turn Off Camera"
              : "Turn On Camera (Video Chat)"
          }
        >
          {isCameraLoading ? (
            <Loader2 size={20} className="animate-spin" />
          ) : isVideoOn ? (
            <Video size={20} />
          ) : (
            <VideoOff size={20} />
          )}
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
    )}
  </>
  );
}
