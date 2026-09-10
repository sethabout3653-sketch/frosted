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
  Minimize2,
  ScreenShare,
  ScreenShareOff,
  MonitorUp,
  Layout,
  Columns,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from "lucide-react";
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  addDoc,
  updateDoc,
  db,
  sendBroadcastSignal,
  subscribeBroadcastSignals,
} from "../supabase-adapter";
import { ChatProfile, VoiceSignal } from "../types";
import { SmartVoiceDetector } from "../utils/audioVAD";
import { extractDominantColor } from "../utils/colorExtractor";

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
  isScreenSharing?: boolean;
  isScreenAudioOn?: boolean;
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" },
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:stun.nextcloud.com:443" },
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
};

// Studio quality uncapped raw audio SDP optimizer:
// - 510000 bps uncapped Opus bitrate
// - Stereo enabled (stereo=1, sprop-stereo=1) for pure uncompressed full spectrum audio
// - maxplaybackrate=48000 for full 48kHz frequency spectrum
// - cbr=1 (constant bitrate transmission, no ducking, gating or compression drops)
// - usedtx=0 (no voice gating or silence cutoffs)
// - useinbandfec=1 for forward error correction
function optimizeAudioSdp(sdp: string): string {
  const lines = sdp.split("\r\n");
  let opusPayloadType: string | null = null;
  for (const line of lines) {
    const match = line.match(/^a=rtpmap:(\d+)\s+opus\/48000\/2/i);
    if (match) {
      opusPayloadType = match[1];
      break;
    }
  }

  return lines
    .map((line) => {
      if (
        (opusPayloadType && line.startsWith(`a=fmtp:${opusPayloadType}`)) ||
        (line.startsWith("a=fmtp:") && line.toLowerCase().includes("opus"))
      ) {
        const base = line.split(";")[0];
        return `${base};maxaveragebitrate=510000;stereo=1;sprop-stereo=1;cbr=1;maxplaybackrate=48000;minptime=10;useinbandfec=1;usedtx=0`;
      }
      return line;
    })
    .join("\r\n");
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
  const hasJoinedVoiceRef = useRef<boolean>(false);
  const processedSignalsRef = useRef<Set<string>>(new Set());
  const [trackTrigger, setTrackTrigger] = useState(0);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [currentTime, setCurrentTime] = useState<number>(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [cameraNotice, setCameraNotice] = useState<string | null>(null);

  // Audio level and smart speech detection states with AI VAD (whisper / normal talk / loud)
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [isLocalSpeaking, setIsLocalSpeaking] = useState<boolean>(false);
  const [remoteSpeaking, setRemoteSpeaking] = useState<{ [uid: string]: boolean }>({});
  const localVadRef = useRef<SmartVoiceDetector>(new SmartVoiceDetector());
  const remoteVadMapRef = useRef<{ [uid: string]: SmartVoiceDetector }>({});

  // Dynamic AI Profile Picture Color state
  const [userColors, setUserColors] = useState<{
    [uid: string]: { hex: string; rgb: [number, number, number]; glow: string; border: string; ring: string };
  }>({});

  // Asynchronously extract and cache dominant base colors from profile pictures
  useEffect(() => {
    let isCancelled = false;
    extractDominantColor(profile.photoURL, profile.username).then((col) => {
      if (!isCancelled) {
        setUserColors((prev) => ({ ...prev, [profile.uid]: col }));
      }
    });

    participants.forEach((p) => {
      extractDominantColor(p.photoURL, p.username).then((col) => {
        if (!isCancelled) {
          setUserColors((prev) => ({ ...prev, [p.uid]: col }));
        }
      });
    });

    return () => {
      isCancelled = true;
    };
  }, [profile.photoURL, profile.username, profile.uid, participants]);

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

  // Screen Sharing states and refs
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isScreenShareLoading, setIsScreenShareLoading] = useState(false);
  const [isScreenAudioOn, setIsScreenAudioOn] = useState(false);
  const [screenAudioVolume, setScreenAudioVolume] = useState<number>(1.0);
  const [fullscreenType, setFullscreenType] = useState<"camera" | "screen">("camera");
  const [zoomLayoutMode, setZoomLayoutMode] = useState<"side-by-side" | "gallery-strip">("side-by-side");
  const [screenZoom, setScreenZoom] = useState<number>(1.0);
  const [screenFitMode, setScreenFitMode] = useState<"contain" | "cover">("contain");

  const screenStreamRef = useRef<MediaStream | null>(null);
  const localScreenVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteScreenVideoRefs = useRef<{ [uid: string]: HTMLVideoElement | null }>({});
  const remoteScreenStreamsRef = useRef<{ [uid: string]: MediaStream }>({});
  const dummyScreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dummyScreenTrackRef = useRef<MediaStreamTrack | null>(null);
  const isScreenSharingRef = useRef<boolean>(false);
  const isScreenAudioOnRef = useRef<boolean>(false);

  // Senders for dynamic track replacement
  const cameraSendersRef = useRef<{ [uid: string]: RTCRtpSender }>({});
  const screenSendersRef = useRef<{ [uid: string]: RTCRtpSender }>({});
  const audioSendersRef = useRef<{ [uid: string]: RTCRtpSender }>({});

  // Web Audio nodes for mixed microphone + screen audio
  const screenAudioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const screenGainNodeRef = useRef<GainNode | null>(null);
  const mixedDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  // Reusable dummy video track generator for initial WebRTC video m-line negotiation
  const dummyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dummyTrackRef = useRef<MediaStreamTrack | null>(null);

  const peersRef = useRef<{ [uid: string]: RTCPeerConnection }>({});
  const iceCandidateQueuesRef = useRef<{ [uid: string]: RTCIceCandidateInit[] }>({});
  const remoteStreamsRef = useRef<{ [uid: string]: MediaStream }>({});
  const remoteAudioRefs = useRef<{ [uid: string]: HTMLAudioElement | null }>({});
  const remoteVideoRefs = useRef<{ [uid: string]: HTMLVideoElement | null }>({});
  const remoteAnalysersRef = useRef<{ [uid: string]: { analyser: AnalyserNode; source: MediaStreamAudioSourceNode } }>({});

  // Keep refs in sync for heartbeat timer
  const isMutedRef = useRef(isMuted);
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const isCameraLoadingRef = useRef(isCameraLoading);
  useEffect(() => {
    isCameraLoadingRef.current = isCameraLoading;
  }, [isCameraLoading]);

  useEffect(() => {
    isScreenSharingRef.current = isScreenSharing;
  }, [isScreenSharing]);

  useEffect(() => {
    isScreenAudioOnRef.current = isScreenAudioOn;
  }, [isScreenAudioOn]);

  useEffect(() => {
    if (screenGainNodeRef.current) {
      screenGainNodeRef.current.gain.value = screenAudioVolume;
    }
  }, [screenAudioVolume]);

  // 1-second interval to continuously re-evaluate presence and prune disconnected/lagging participants
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Filter out any participant who lost connection or battery and stopped sending heartbeats (> 45s), sorted deterministically
  const activeParticipants = useMemo(() => {
    return participants
      .filter((p) => {
        // If we have an active, healthy WebRTC peer connection, they are 100% active and connected!
        const pc = peersRef.current[p.uid];
        if (pc && (pc.connectionState === "connected" || pc.iceConnectionState === "connected")) {
          return true;
        }
        const ts = p.timestamp || (p as any).lastSeen;
        return typeof ts === "number" ? currentTime - ts < 45000 : true;
      })
      .sort((a, b) => {
        if (!a || !b) return 0;
        const nameCompare = (a.username || "").localeCompare(b.username || "");
        if (nameCompare !== 0) return nameCompare;
        return (a.uid || "").localeCompare(b.uid || "");
      });
  }, [participants, currentTime]);

  // Active Screen Share descriptor (local or remote)
  const activeScreenShare = useMemo(() => {
    if (isScreenSharing && screenStreamRef.current && screenStreamRef.current.getVideoTracks().some((t) => t.readyState === "live")) {
      return {
        uid: profile.uid,
        username: profile.username,
        isLocal: true,
        hasAudio: isScreenAudioOn,
      };
    }
    const remoteSharer = activeParticipants.find(
      (p) => p.isScreenSharing === true
    );
    if (remoteSharer) {
      return {
        uid: remoteSharer.uid,
        username: remoteSharer.username,
        isLocal: false,
        hasAudio: !!remoteSharer.isScreenAudioOn,
      };
    }
    return null;
  }, [isScreenSharing, profile.uid, profile.username, isScreenAudioOn, activeParticipants, trackTrigger]);

  // Fullscreen user video state and controls
  const [fullscreenUid, setFullscreenUid] = useState<string | null>(null);
  const [fullscreenFit, setFullscreenFit] = useState<"contain" | "cover">("contain");
  const [isNativeFullscreen, setIsNativeFullscreen] = useState<boolean>(false);
  const [showFullscreenControls, setShowFullscreenControls] = useState<boolean>(true);
  const fullscreenControlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fullscreenContainerRef = useRef<HTMLDivElement | null>(null);
  const fullscreenVideoRef = useRef<HTMLVideoElement | null>(null);

  const exitFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    setFullscreenUid(null);
    setFullscreenType("camera");
    setIsNativeFullscreen(false);
  }, []);

  const toggleNativeFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        if (fullscreenContainerRef.current?.requestFullscreen) {
          await fullscreenContainerRef.current.requestFullscreen();
          setIsNativeFullscreen(true);
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
          setIsNativeFullscreen(false);
        }
      }
    } catch (err) {
      console.warn("Fullscreen toggle error:", err);
    }
  }, []);

  // Keyboard shortcut (Escape to exit) and native fullscreenchange listener
  useEffect(() => {
    if (!fullscreenUid) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        exitFullscreen();
      }
    };

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsNativeFullscreen(false);
      } else {
        setIsNativeFullscreen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [fullscreenUid, exitFullscreen]);

  // Handle controls auto-hiding when idle in fullscreen
  const handleFullscreenMouseMove = useCallback(() => {
    setShowFullscreenControls(true);
    if (fullscreenControlsTimeoutRef.current) {
      clearTimeout(fullscreenControlsTimeoutRef.current);
    }
    fullscreenControlsTimeoutRef.current = setTimeout(() => {
      setShowFullscreenControls(false);
    }, 3500);
  }, []);

  // Auto exit fullscreen screen share if presenter stops sharing
  useEffect(() => {
    if (fullscreenUid && fullscreenType === "screen") {
      const isLocal = fullscreenUid === profile.uid;
      const isStillSharing = isLocal
        ? isScreenSharing
        : activeParticipants.some((p) => p.uid === fullscreenUid && p.isScreenSharing);
      if (!isStillSharing) {
        exitFullscreen();
      }
    }
  }, [fullscreenUid, fullscreenType, isScreenSharing, activeParticipants, profile.uid, exitFullscreen]);

  // Re-bind video stream in fullscreen when track or fullscreen target updates
  useEffect(() => {
    if (!fullscreenUid) return;
    if (fullscreenType === "screen") {
      const isLocal = fullscreenUid === profile.uid;
      const stream = isLocal ? screenStreamRef.current : remoteScreenStreamsRef.current[fullscreenUid];
      if (fullscreenVideoRef.current && stream) {
        if (fullscreenVideoRef.current.srcObject !== stream) {
          fullscreenVideoRef.current.srcObject = stream;
        }
        fullscreenVideoRef.current.play().catch(() => {});
      }
    } else {
      const isLocal = fullscreenUid === profile.uid;
      const stream = isLocal ? videoStreamRef.current : remoteStreamsRef.current[fullscreenUid];
      if (fullscreenVideoRef.current && stream) {
        if (fullscreenVideoRef.current.srcObject !== stream) {
          fullscreenVideoRef.current.srcObject = stream;
        }
        fullscreenVideoRef.current.play().catch(() => {});
      }
    }
  }, [fullscreenUid, fullscreenType, trackTrigger, isVideoOn, isScreenSharing, profile.uid]);

  // List of active video/screen feeds (for quick switching in fullscreen)
  const participantsWithVideo = useMemo(() => {
    const list: { uid: string; username: string; isLocal: boolean; type: "camera" | "screen" }[] = [];
    if (isScreenSharing) {
      list.push({ uid: profile.uid, username: `${profile.username} (Screen)`, isLocal: true, type: "screen" });
    }
    activeParticipants.forEach((p) => {
      if (p.isScreenSharing) {
        list.push({ uid: p.uid, username: `${p.username} (Screen)`, isLocal: false, type: "screen" });
      }
    });
    if (isVideoOn) {
      list.push({ uid: profile.uid, username: `${profile.username} (Camera)`, isLocal: true, type: "camera" });
    }
    activeParticipants.forEach((p) => {
      if (p.isVideoOn) {
        list.push({ uid: p.uid, username: `${p.username} (Camera)`, isLocal: false, type: "camera" });
      }
    });
    return list;
  }, [isScreenSharing, isVideoOn, profile.uid, profile.username, activeParticipants]);

  // Automatically acquire studio microphone stream with Acoustic Echo Cancellation enabled (AEC)
  // while keeping noise suppression & AGC disabled so ANY sound (music, instruments, soundboards, whispers) is fully allowed
  const acquireMicrophoneStream = useCallback(async (): Promise<MediaStream> => {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,  // Hardware & OS Acoustic Echo Cancellation: eliminates speaker feedback echo
          noiseSuppression: false, // Disables browser noise gate so ANY sound (music, instruments, soundboards) passes through
          autoGainControl: false,  // Disables volume pumping/ducking so dynamics are preserved
          channelCount: { ideal: 2 },
          sampleRate: { ideal: 48000 },
          // High-fidelity Chromium audio flags
          googEchoCancellation: true,
          googEchoCancellation2: true,
          googDAEchoCancellation: true,
          googNoiseSuppression: false,
          googHighpassFilter: false,
          googTypingNoiseDetection: false,
          googAutoGainControl: false,
          googAudioMirroring: false,
        } as MediaTrackConstraints,
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
          audio: {
            echoCancellation: true,
          },
          video: false,
        });
      }
    }
  }, []);

  // Connect microphone to live Web Audio pipeline for speech/sound analysis & visual VAD
  const setupAudioPipeline = useCallback(
    async (sourceStream: MediaStream): Promise<MediaStream> => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }

      // Preserve native getUserMedia stream directly for WebRTC so AEC stays linked to speaker output
      rawStreamRef.current = sourceStream;
      localStreamRef.current = sourceStream;

      try {
        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

        if (!AudioContextClass) {
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

        // Analyser for real-time Voice & Sound Activity Detection (VAD)
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.2;

        source.connect(analyser);
        analyserRef.current = analyser;

        // Mixed destination node that combines microphone and any screen share audio
        const mixedDest = ctx.createMediaStreamDestination();
        mixedDestinationRef.current = mixedDest;

        const micGain = ctx.createGain();
        micGain.gain.value = isMutedRef.current ? 0 : 1.0;
        gainNodeRef.current = micGain;

        source.connect(micGain);
        micGain.connect(mixedDest);

        // Monitor real-time volume levels & speech/sound activity for local user and remote participants
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const updateLevel = () => {
          if (!isMountedRef.current) return;

          // Local microphone: sound & voice detection
          analyser.getByteFrequencyData(dataArray);
          const vadRes = localVadRef.current.analyze(dataArray, ctx.sampleRate);
          setAudioLevel(vadRes.energy);

          if (vadRes.isSpeaking && !isMutedRef.current) {
            setIsLocalSpeaking(true);
          } else {
            setIsLocalSpeaking(false);
          }

          // Evaluate speech for remote participants using SmartVoiceDetector
          const remoteMap: { [uid: string]: { analyser: AnalyserNode; source: MediaStreamAudioSourceNode } } = remoteAnalysersRef.current;
          for (const [pUid, rData] of Object.entries(remoteMap)) {
            if (rData && rData.analyser) {
              if (!remoteVadMapRef.current[pUid]) {
                remoteVadMapRef.current[pUid] = new SmartVoiceDetector();
              }
              const rArray = new Uint8Array(rData.analyser.frequencyBinCount);
              rData.analyser.getByteFrequencyData(rArray);
              const rVad = remoteVadMapRef.current[pUid].analyze(rArray, ctx.sampleRate);

              if (rVad.isSpeaking) {
                setRemoteSpeaking((prev) => (prev[pUid] ? prev : { ...prev, [pUid]: true }));
              } else {
                setRemoteSpeaking((prev) => (prev[pUid] ? { ...prev, [pUid]: false } : prev));
              }
            }
          }

          animFrameRef.current = requestAnimationFrame(updateLevel);
        };
        animFrameRef.current = requestAnimationFrame(updateLevel);

        if (mixedDest && mixedDest.stream && mixedDest.stream.getAudioTracks().length > 0) {
          localStreamRef.current = mixedDest.stream;
          return mixedDest.stream;
        }

        return sourceStream;
      } catch (err) {
        console.warn("AudioContext setup fallback to raw stream:", err);
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

  const getOrCreateDummyScreenTrack = useCallback((): MediaStreamTrack => {
    if (dummyScreenTrackRef.current && dummyScreenTrackRef.current.readyState === "live") {
      return dummyScreenTrackRef.current;
    }
    let canvas = dummyScreenCanvasRef.current;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#030303";
        ctx.fillRect(0, 0, 16, 16);
      }
      dummyScreenCanvasRef.current = canvas;
    }
    const canvasStream = canvas.captureStream(5);
    const track = canvasStream.getVideoTracks()[0];
    track.enabled = true;
    dummyScreenTrackRef.current = track;
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

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
          t.enabled = false;
        } catch {}
      });
      screenStreamRef.current = null;
    }

    if (dummyTrackRef.current) {
      try {
        dummyTrackRef.current.stop();
      } catch {}
      dummyTrackRef.current = null;
    }

    if (dummyScreenTrackRef.current) {
      try {
        dummyScreenTrackRef.current.stop();
      } catch {}
      dummyScreenTrackRef.current = null;
    }

    if (screenAudioSourceRef.current) {
      try {
        screenAudioSourceRef.current.disconnect();
      } catch {}
      screenAudioSourceRef.current = null;
    }

    if (screenGainNodeRef.current) {
      try {
        screenGainNodeRef.current.disconnect();
      } catch {}
      screenGainNodeRef.current = null;
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
    cameraSendersRef.current = {};
    screenSendersRef.current = {};
    audioSendersRef.current = {};

    Object.values(remoteStreamsRef.current).forEach((stream: MediaStream) => {
      stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
    });
    remoteStreamsRef.current = {};

    Object.values(remoteScreenStreamsRef.current).forEach((stream: MediaStream) => {
      stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
    });
    remoteScreenStreamsRef.current = {};

    (Object.values(remoteAnalysersRef.current) as Array<{ analyser: AnalyserNode; source: MediaStreamAudioSourceNode }>).forEach((entry) => {
      try {
        entry.source.disconnect();
      } catch {}
    });
    remoteAnalysersRef.current = {};
    setRemoteSpeaking({});
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

      if (p.isScreenSharing) {
        const screenStream = remoteScreenStreamsRef.current[p.uid];
        if (screenStream) {
          const screenVideoEl = remoteScreenVideoRefs.current[p.uid];
          if (screenVideoEl && screenVideoEl.srcObject !== screenStream) {
            screenVideoEl.srcObject = screenStream;
            screenVideoEl.play().catch(() => {});
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

  // Global user-gesture media resume listener to handle strict browser autoplay policies for audio and video
  useEffect(() => {
    const resumeMedia = () => {
      (Object.values(remoteAudioRefs.current) as (HTMLAudioElement | null)[]).forEach((el) => {
        if (el && el.paused && el.srcObject) {
          el.play().catch(() => {});
        }
      });
      (Object.values(remoteVideoRefs.current) as (HTMLVideoElement | null)[]).forEach((el) => {
        if (el && el.srcObject) {
          el.play().catch(() => {});
        }
      });
      (Object.values(remoteScreenVideoRefs.current) as (HTMLVideoElement | null)[]).forEach((el) => {
        if (el && el.srcObject) {
          el.play().catch(() => {});
        }
      });
      if (localVideoRef.current && localVideoRef.current.srcObject) {
        localVideoRef.current.play().catch(() => {});
      }
      if (localScreenVideoRef.current && localScreenVideoRef.current.srcObject) {
        localScreenVideoRef.current.play().catch(() => {});
      }
    };

    window.addEventListener("click", resumeMedia);
    window.addEventListener("keydown", resumeMedia);
    window.addEventListener("touchstart", resumeMedia);
    return () => {
      window.removeEventListener("click", resumeMedia);
      window.removeEventListener("keydown", resumeMedia);
      window.removeEventListener("touchstart", resumeMedia);
    };
  }, []);

  const sendSignal = useCallback(
    async (
      targetUid: string,
      type: "offer" | "answer" | "candidate" | "screenshare_started" | "screenshare_stopped",
      data: string
    ) => {
      const payload = {
        uid: profile.uid,
        targetUid,
        type,
        sdp: data,
        timestamp: Date.now(),
      };
      // 1. Instant delivery via Supabase Realtime Broadcast
      sendBroadcastSignal(payload);

      // 2. Persistent fallback via database table
      try {
        await addDoc(collection(db, "signals"), payload);
      } catch (err) {
        // Silently handled by broadcast
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

      // 1. Add microphone / mixed audio track
      micStream.getAudioTracks().forEach((track) => {
        const audioSender = pc.addTrack(track, micStream);
        audioSendersRef.current[partnerUid] = audioSender;
      });

      // Maximize audio sender encoding bitrate to 510kbps uncapped
      const audioSender = audioSendersRef.current[partnerUid] || pc.getSenders().find((s) => s.track?.kind === "audio");
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

      // 2. Add camera track (transceiver 1) with dedicated camera stream
      const realVideoTrack = videoStreamRef.current?.getVideoTracks()[0];
      const cameraTrack = realVideoTrack && realVideoTrack.readyState === "live"
        ? realVideoTrack
        : getOrCreateDummyVideoTrack();
      const cameraStream = videoStreamRef.current || new MediaStream([cameraTrack]);
      const cameraSender = pc.addTrack(cameraTrack, cameraStream);
      cameraSendersRef.current[partnerUid] = cameraSender;

      // 3. Add screen share track (transceiver 2) with dedicated screen stream
      const realScreenTrack = screenStreamRef.current?.getVideoTracks()[0];
      const screenTrack = realScreenTrack && realScreenTrack.readyState === "live"
        ? realScreenTrack
        : getOrCreateDummyScreenTrack();
      const screenStream = screenStreamRef.current || new MediaStream([screenTrack]);
      const screenSender = pc.addTrack(screenTrack, screenStream);
      screenSendersRef.current[partnerUid] = screenSender;

      // Ensure transceivers are configured to bidirectional sendrecv
      pc.getTransceivers().forEach((t) => {
        try {
          t.direction = "sendrecv";
        } catch (e) {}
      });

      // Handle local ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal(partnerUid, "candidate", JSON.stringify(event.candidate));
        }
      };

      // Handle remote incoming tracks (audio, camera, and screen share)
      pc.ontrack = (event) => {
        if (event.track.kind === "audio") {
          if (!remoteStreamsRef.current[partnerUid]) {
            remoteStreamsRef.current[partnerUid] = new MediaStream();
          }
          const rStream = remoteStreamsRef.current[partnerUid];
          if (!rStream.getTracks().some((track) => track.id === event.track.id)) {
            rStream.getAudioTracks().forEach((track) => rStream.removeTrack(track));
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

          event.track.onunmute = () => {
            if (audioEl) {
              audioEl.play().catch(() => {});
            }
          };

          // Attach remote audio track to analyser for accurate speaking detection
          if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
            try {
              if (remoteAnalysersRef.current[partnerUid]) {
                remoteAnalysersRef.current[partnerUid].source.disconnect();
              }
              const rSource = audioCtxRef.current.createMediaStreamSource(new MediaStream([event.track]));
              const rAnalyser = audioCtxRef.current.createAnalyser();
              rAnalyser.fftSize = 128;
              rAnalyser.smoothingTimeConstant = 0.2;
              rSource.connect(rAnalyser);
              remoteAnalysersRef.current[partnerUid] = { analyser: rAnalyser, source: rSource };
            } catch (e) {
              console.warn("Could not create remote audio analyser:", e);
            }
          }
        } else if (event.track.kind === "video") {
          const transceivers = pc.getTransceivers();
          const videoTransceivers = transceivers.filter((t) => t.receiver.track.kind === "video");
          const streamId = event.streams?.[0]?.id || "";
          const isScreen =
            streamId.includes("screen") ||
            event.track.contentHint === "detail" ||
            event.transceiver === videoTransceivers[1] ||
            event.transceiver.mid === "2" ||
            transceivers.indexOf(event.transceiver) === 2 ||
            (videoTransceivers.length >= 2 && event.transceiver === videoTransceivers[videoTransceivers.length - 1]);

          if (isScreen) {
            if (!remoteScreenStreamsRef.current[partnerUid]) {
              remoteScreenStreamsRef.current[partnerUid] = new MediaStream();
            }
            const scrStream = remoteScreenStreamsRef.current[partnerUid];
            if (!scrStream.getTracks().some((track) => track.id === event.track.id)) {
              scrStream.getVideoTracks().forEach((track) => scrStream.removeTrack(track));
              scrStream.addTrack(event.track);
            }

            const playScreenVideo = () => {
              const screenEl = remoteScreenVideoRefs.current[partnerUid];
              if (screenEl) {
                if (screenEl.srcObject !== scrStream) {
                  screenEl.srcObject = scrStream;
                }
                screenEl.play().catch(() => {});
              }
            };

            playScreenVideo();
            event.track.onunmute = () => {
              playScreenVideo();
              setTrackTrigger((v) => v + 1);
            };
          } else {
            // Camera track
            if (!remoteStreamsRef.current[partnerUid]) {
              remoteStreamsRef.current[partnerUid] = new MediaStream();
            }
            const rStream = remoteStreamsRef.current[partnerUid];
            if (!rStream.getTracks().some((track) => track.id === event.track.id)) {
              rStream.getVideoTracks().forEach((track) => rStream.removeTrack(track));
              rStream.addTrack(event.track);
            }

            const playCameraVideo = () => {
              const videoEl = remoteVideoRefs.current[partnerUid];
              if (videoEl) {
                if (videoEl.srcObject !== rStream) {
                  videoEl.srcObject = rStream;
                }
                videoEl.play().catch(() => {});
              }
            };

            playCameraVideo();
            event.track.onunmute = () => {
              playCameraVideo();
              setTrackTrigger((v) => v + 1);
            };
          }
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
          delete cameraSendersRef.current[partnerUid];
          delete screenSendersRef.current[partnerUid];
          delete audioSendersRef.current[partnerUid];
          if (remoteScreenStreamsRef.current[partnerUid]) {
            remoteScreenStreamsRef.current[partnerUid].getTracks().forEach((t) => t.stop());
            delete remoteScreenStreamsRef.current[partnerUid];
          }
          if (remoteAnalysersRef.current[partnerUid]) {
            try {
              remoteAnalysersRef.current[partnerUid].source.disconnect();
            } catch {}
            delete remoteAnalysersRef.current[partnerUid];
          }
          setRemoteSpeaking((prev) => {
            const next = { ...prev };
            delete next[partnerUid];
            return next;
          });
        }
      };

      return pc;
    },
    [getOrCreateDummyVideoTrack, getOrCreateDummyScreenTrack, sendSignal]
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
      const sigKey = signal.id || `${signal.uid}_${signal.type}_${signal.timestamp || ""}_${(signal.sdp || "").slice(0, 30)}`;
      if (processedSignalsRef.current.has(sigKey)) {
        return;
      }
      processedSignalsRef.current.add(sigKey);
      if (processedSignalsRef.current.size > 300) {
        const first = processedSignalsRef.current.values().next().value;
        if (first) processedSignalsRef.current.delete(first);
      }

      if (signal.timestamp && signal.timestamp < sessionStartTimeRef.current - 15000) {
        return;
      }
      const partnerUid = signal.uid;

      try {
        if (signal.type === "offer") {
          let pc = peersRef.current[partnerUid];
          const isDead =
            !pc || pc.connectionState === "closed" || pc.signalingState === "closed";

          if (isDead) {
            pc = createPeerConnection(partnerUid, micStream);
          } else if (pc.signalingState !== "stable") {
            const isPolite = profile.uid < partnerUid;
            if (!isPolite && pc.signalingState === "have-local-offer") {
              return;
            }
            try {
              await pc.setLocalDescription({ type: "rollback" });
            } catch (e) {
              pc = createPeerConnection(partnerUid, micStream);
            }
          }

          if (pc.signalingState === "stable" || pc.signalingState === "have-local-offer") {
            try {
              const offerDescription = new RTCSessionDescription(JSON.parse(signal.sdp));
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
            } catch (e) {
              // Gracefully ignore state transitions
            }
          }
        } else if (signal.type === "answer") {
          const pc = peersRef.current[partnerUid];
          if (pc && pc.signalingState === "have-local-offer") {
            try {
              const answerDescription = new RTCSessionDescription(JSON.parse(signal.sdp));
              await pc.setRemoteDescription(answerDescription);
              await processCandidateQueue(partnerUid, pc);
            } catch (e) {
              // Gracefully ignore stale/duplicate answer
            }
          }
        } else if (signal.type === "candidate") {
          const candidateData = JSON.parse(signal.sdp);
          const pc = peersRef.current[partnerUid];
          if (pc && pc.remoteDescription && pc.remoteDescription.type && pc.signalingState !== "closed") {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidateData));
            } catch (e) {}
          } else {
            if (!iceCandidateQueuesRef.current[partnerUid]) {
              iceCandidateQueuesRef.current[partnerUid] = [];
            }
            iceCandidateQueuesRef.current[partnerUid].push(candidateData);
          }
        } else if (signal.type === "screenshare_started") {
          const pc = peersRef.current[partnerUid];
          if (pc) {
            const videoTransceivers = pc.getTransceivers().filter((t) => t.receiver.track.kind === "video");
            const scrTrack = videoTransceivers.length >= 2 ? videoTransceivers[1].receiver.track : videoTransceivers[0]?.receiver?.track;
            if (scrTrack) {
              if (!remoteScreenStreamsRef.current[partnerUid]) {
                remoteScreenStreamsRef.current[partnerUid] = new MediaStream();
              }
              const s = remoteScreenStreamsRef.current[partnerUid];
              if (!s.getTracks().some((t) => t.id === scrTrack.id)) {
                s.getVideoTracks().forEach((t) => s.removeTrack(t));
                s.addTrack(scrTrack);
              }
              const screenEl = remoteScreenVideoRefs.current[partnerUid];
              if (screenEl) {
                screenEl.srcObject = s;
                screenEl.play().catch(() => {});
              }
            }
          }
          setTrackTrigger((v) => v + 1);
        } else if (signal.type === "screenshare_stopped") {
          if (remoteScreenStreamsRef.current[partnerUid]) {
            remoteScreenStreamsRef.current[partnerUid].getTracks().forEach((t) => t.stop());
            delete remoteScreenStreamsRef.current[partnerUid];
          }
          if (remoteScreenVideoRefs.current[partnerUid]) {
            remoteScreenVideoRefs.current[partnerUid]!.srcObject = null;
          }
          setTrackTrigger((v) => v + 1);
        }
      } catch (err: any) {
        const msg = String(err?.message || err || "");
        if (!msg.includes("Called in wrong state") && !msg.includes("stable")) {
          console.warn("Signal handling note:", err);
        }
      }
    },
    [createPeerConnection, processCandidateQueue, profile.uid, sendSignal]
  );

  // Main lifecycle: acquire microphone and register in voice_users
  useEffect(() => {
    isMountedRef.current = true;
    let unsubscribeSignals: () => void;
    let unsubscribeBroadcast: () => void;
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
        await setDoc(doc(db, "voice_users", profile.uid), {
          uid: profile.uid,
          username: profile.username,
          photoURL: profile.photoURL || "",
          isMuted: false,
          isVideoOn: false,
          isVideoLoading: false,
          isScreenSharing: false,
          isScreenAudioOn: false,
          timestamp: Date.now(),
        });

        if (!isMountedRef.current) {
          stopAllMediaTracks();
          return;
        }

        await setDoc(doc(db, "presence", profile.uid), {
          uid: profile.uid,
          username: profile.username,
          photoURL: profile.photoURL || "",
          status: "online",
          lastSeen: Date.now(),
          isMuted: false,
          inVoice: true,
        }, { merge: true }).catch(() => {});

        hasJoinedVoiceRef.current = true;

        // Real-time listener for voice participants
        const unsubUsers = onSnapshot(
          collection(db, "voice_users"),
          (snapshot) => {
            if (!isMountedRef.current) return;
            const users: Participant[] = [];
            const activeUids = new Set<string>();
            snapshot.forEach((d) => {
              const u = d.data() as Participant;
              activeUids.add(u.uid);
              if (u.uid !== profile.uid) {
                users.push(u);
                const pc = peersRef.current[u.uid];
                const isDead =
                  !pc ||
                  pc.connectionState === "closed" ||
                  pc.connectionState === "failed";
                if (
                  profile.uid < u.uid &&
                  isDead &&
                  localStreamRef.current
                ) {
                  initiateCall(u.uid, localStreamRef.current);
                }
              }
            });

            // Clean up screen stream for participants not sharing screen
            users.forEach((u) => {
              if (!u.isScreenSharing && remoteScreenStreamsRef.current[u.uid]) {
                remoteScreenStreamsRef.current[u.uid].getTracks().forEach((t) => t.stop());
                delete remoteScreenStreamsRef.current[u.uid];
                if (remoteScreenVideoRefs.current[u.uid]) {
                  remoteScreenVideoRefs.current[u.uid]!.srcObject = null;
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
                delete cameraSendersRef.current[peerUid];
                delete screenSendersRef.current[peerUid];
                delete audioSendersRef.current[peerUid];
                if (remoteStreamsRef.current[peerUid]) {
                  remoteStreamsRef.current[peerUid].getTracks().forEach((t) => t.stop());
                  delete remoteStreamsRef.current[peerUid];
                }
                if (remoteScreenStreamsRef.current[peerUid]) {
                  remoteScreenStreamsRef.current[peerUid].getTracks().forEach((t) => t.stop());
                  delete remoteScreenStreamsRef.current[peerUid];
                }
              }
            });

            users.sort((a, b) => {
              if (!a || !b) return 0;
              const nameCompare = (a.username || "").localeCompare(b.username || "");
              if (nameCompare !== 0) return nameCompare;
              return (a.uid || "").localeCompare(b.uid || "");
            });

            setParticipants(users);
          },
          (err) => {
            console.warn("voice_users listener error in VoiceChannel:", err);
          }
        );
        unsubscribeUsers = unsubUsers;

        // 1. Instant Real-time listener via Supabase Realtime Broadcast
        unsubscribeBroadcast = subscribeBroadcastSignals(profile.uid, async (signalData: any) => {
          if (!isMountedRef.current || !localStreamRef.current) return;
          const signal: VoiceSignal = {
            id: `broadcast_${signalData.uid}_${signalData.type}_${signalData.timestamp || Date.now()}`,
            uid: signalData.uid,
            targetUid: signalData.targetUid,
            type: signalData.type,
            sdp: signalData.sdp || "",
            timestamp: signalData.timestamp || Date.now(),
          };
          await handleSignal(signal, localStreamRef.current);
        });

        // 2. Real-time listener for WebRTC signals directed to current user via database
        const qSignals = query(
          collection(db, "signals"),
          where("targetUid", "==", profile.uid)
        );

        const unsubSignals = onSnapshot(
          qSignals,
          (snapshot) => {
            if (!isMountedRef.current) return;
            snapshot.forEach(async (signalDoc: any) => {
              const signal = {
                id: signalDoc.id,
                ...signalDoc.data(),
              } as VoiceSignal;
              deleteDoc(doc(db, "signals", signal.id)).catch(() => {});
              if (localStreamRef.current && isMountedRef.current) {
                await handleSignal(signal, localStreamRef.current);
              }
            });
          },
          (err) => {
            console.warn("signals listener error in VoiceChannel:", err);
          }
        );
        unsubscribeSignals = unsubSignals;
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
        await updateDoc(doc(db, "voice_users", profile.uid), {
          timestamp: Date.now(),
          isMuted: isMutedRef.current,
          isVideoOn: isVideoOnRef.current,
          isVideoLoading: isCameraLoadingRef.current,
          isScreenSharing: isScreenSharingRef.current,
          isScreenAudioOn: isScreenAudioOnRef.current,
        }).catch(() => {});
        await updateDoc(doc(db, "presence", profile.uid), {
          lastSeen: Date.now(),
          status: "online",
          inVoice: true,
          isMuted: isMutedRef.current,
        }).catch(() => {});
      } catch (e) {}
    }, 2000);

    return () => {
      isMountedRef.current = false;
      clearInterval(heartbeatInterval);
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("pagehide", handleUnload);

      stopAllMediaTracks();
      hasJoinedVoiceRef.current = false;

      deleteDoc(doc(db, "voice_users", profile.uid)).catch(() => {});
      updateDoc(doc(db, "presence", profile.uid), {
        inVoice: false,
        isMuted: false,
      }).catch(() => {});

      if (unsubscribeBroadcast) unsubscribeBroadcast();
      if (unsubscribeSignals) unsubscribeSignals();
      if (unsubscribeUsers) unsubscribeUsers();
    };
  }, [handleSignal, initiateCall, profile, stopAllMediaTracks]);

  // Continuously prune and close dead/lagging peer connections when a peer loses connection or battery
  useEffect(() => {
    const now = Date.now();
    participants.forEach((p) => {
      const ts = p.timestamp || (p as any).lastSeen;
      if (typeof ts === "number") {
        const isStaleOnFirestore = now - ts > 45000;
        const isVeryStaleOnFirestore = now - ts > 180000; // 3 minutes fallback
        const pc = peersRef.current[p.uid];
        
        // Only prune/close peer connection if:
        // 1. The connection is stale on Firestore AND we don't have an active connected state, OR
        // 2. The user has been completely silent on Firestore for over 3 minutes.
        const shouldPrunePeer = pc && (
          (isStaleOnFirestore && pc.connectionState !== "connected" && pc.iceConnectionState !== "connected") ||
          isVeryStaleOnFirestore
        );

        if (shouldPrunePeer) {
          try {
            pc.close();
          } catch (e) {}
          delete peersRef.current[p.uid];
          delete iceCandidateQueuesRef.current[p.uid];
          delete cameraSendersRef.current[p.uid];
          delete screenSendersRef.current[p.uid];
          delete audioSendersRef.current[p.uid];
          if (remoteStreamsRef.current[p.uid]) {
            remoteStreamsRef.current[p.uid].getTracks().forEach((t) => t.stop());
            delete remoteStreamsRef.current[p.uid];
          }
          if (remoteScreenStreamsRef.current[p.uid]) {
            remoteScreenStreamsRef.current[p.uid].getTracks().forEach((t) => t.stop());
            delete remoteScreenStreamsRef.current[p.uid];
          }
        }
        
        // If dead for over 180 seconds, clean up from Firestore
        if (now - ts > 180000) {
          deleteDoc(doc(db, "voice_users", p.uid)).catch(() => {});
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

    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = nextMuted ? 0 : 1.0;
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
    if (isCameraLoading) return;
    const nextVideoState = !isVideoOn;
    setCameraNotice(null);

    try {
      if (nextVideoState) {
        setIsCameraLoading(true);
        setIsVideoOn(true);
        isVideoOnRef.current = true;

        // Broadcast to all other participants immediately that camera is loading
        await updateDoc(doc(db, "voice_users", profile.uid), {
          isVideoLoading: true,
          isVideoOn: false,
        }).catch((err) => console.warn("Error setting isVideoLoading:", err));

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
          await updateDoc(doc(db, "voice_users", profile.uid), {
            isVideoOn: false,
            isVideoLoading: false,
          }).catch(() => {});
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
              const videoSender = cameraSendersRef.current[pUid] || pc.getSenders().find(
                (s) => s.track?.kind === "video"
              );
              if (videoSender) {
                await videoSender.replaceTrack(realVideoTrack);
              }
            }
          })
        );

        // 3. Mark camera as active and ready in Firestore
        setIsCameraLoading(false);
        await updateDoc(doc(db, "voice_users", profile.uid), {
          isVideoOn: true,
          isVideoLoading: false,
        });
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
              const videoSender = cameraSendersRef.current[pUid] || pc.getSenders().find(
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

        await updateDoc(doc(db, "voice_users", profile.uid), {
          isVideoOn: false,
          isVideoLoading: false,
        });
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
      await updateDoc(doc(db, "voice_users", profile.uid), {
        isVideoOn: false,
        isVideoLoading: false,
      }).catch(() => {});
    }
  };

  // Screen audio volume dynamic listener
  useEffect(() => {
    if (screenGainNodeRef.current) {
      screenGainNodeRef.current.gain.value = screenAudioVolume;
    }
  }, [screenAudioVolume]);

  // Stop Screen Share
  const stopScreenShare = useCallback(async () => {
    setIsScreenSharing(false);
    isScreenSharingRef.current = false;
    setIsScreenShareLoading(false);
    setIsScreenAudioOn(false);
    isScreenAudioOnRef.current = false;

    // 1. Swap back to dummy screen track across all peers
    const dummyTrack = getOrCreateDummyScreenTrack();
    await Promise.all(
      Object.keys(peersRef.current).map(async (pUid) => {
        const pc = peersRef.current[pUid];
        if (pc && pc.connectionState !== "closed") {
          let sender = screenSendersRef.current[pUid];
          if (!sender) {
            const videoSenders = pc.getSenders().filter((s) => s.track?.kind === "video");
            if (videoSenders.length >= 2) {
              sender = videoSenders[1];
            }
          }
          if (sender) {
            try {
              await sender.replaceTrack(dummyTrack);
            } catch (e) {}
          }
          if (pc.signalingState === "stable") {
            try {
              const offer = await pc.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true,
              });
              const highQualityOffer = new RTCSessionDescription({
                type: offer.type,
                sdp: optimizeAudioSdp(offer.sdp || ""),
              });
              await pc.setLocalDescription(highQualityOffer);
              sendSignal(pUid, "offer", JSON.stringify(highQualityOffer));
            } catch (renegErr) {}
          }
          sendSignal(pUid, "screenshare_stopped", "");
        }
      })
    );

    // 2. Disconnect screen audio from Web Audio mix
    if (screenAudioSourceRef.current) {
      try {
        screenAudioSourceRef.current.disconnect();
      } catch (e) {}
      screenAudioSourceRef.current = null;
    }
    if (screenGainNodeRef.current) {
      try {
        screenGainNodeRef.current.disconnect();
      } catch (e) {}
      screenGainNodeRef.current = null;
    }

    // 3. Stop screen capture stream tracks
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
          track.enabled = false;
        } catch (e) {}
      });
      screenStreamRef.current = null;
    }

    if (localScreenVideoRef.current) {
      localScreenVideoRef.current.srcObject = null;
    }

    // If currently viewing local screen in fullscreen, revert
    if (fullscreenUid === profile.uid && fullscreenType === "screen") {
      setFullscreenUid(null);
      setFullscreenType("camera");
    }

    // 4. Update Firestore
    await updateDoc(doc(db, "voice_users", profile.uid), {
      isScreenSharing: false,
      isScreenAudioOn: false,
      timestamp: Date.now(),
    }).catch(() => {});
    await updateDoc(doc(db, "presence", profile.uid), {
      isScreenSharing: false,
      lastSeen: Date.now(),
    }).catch(() => {});
  }, [fullscreenType, fullscreenUid, getOrCreateDummyScreenTrack, profile.uid, sendSignal]);

  // Start Screen Share with Audio Support
  const startScreenShare = async () => {
    if (isScreenShareLoading) return;
    setIsScreenShareLoading(true);

    try {
      // Prompt user to select screen / window / tab with audio support and robust multi-stage fallbacks
      let displayStream: MediaStream;
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            displaySurface: "monitor",
            frameRate: { ideal: 30, max: 60 },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 2,
          },
        });
      } catch (errAudio: any) {
        if (errAudio?.name === "NotAllowedError" || errAudio?.name === "AbortError" || errAudio?.name === "PermissionDeniedError") {
          throw errAudio;
        }
        try {
          displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
          });
        } catch (errAudio2: any) {
          if (errAudio2?.name === "NotAllowedError" || errAudio2?.name === "AbortError" || errAudio2?.name === "PermissionDeniedError") {
            throw errAudio2;
          }
          displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false,
          });
        }
      }

      if (!isMountedRef.current) {
        displayStream.getTracks().forEach((t) => t.stop());
        setIsScreenShareLoading(false);
        return;
      }

      screenStreamRef.current = displayStream;
      const screenVideoTrack = displayStream.getVideoTracks()[0];
      const screenAudioTracks = displayStream.getAudioTracks();
      const hasAudio = screenAudioTracks.length > 0;

      if (screenVideoTrack && "contentHint" in screenVideoTrack) {
        try {
          (screenVideoTrack as any).contentHint = "detail";
        } catch (e) {}
      }

      // Handle user clicking native browser "Stop sharing" button
      screenVideoTrack.onended = () => {
        stopScreenShare();
      };
      screenAudioTracks.forEach((at) => {
        at.onended = () => {
          if (!screenStreamRef.current || screenStreamRef.current.getVideoTracks().every((v) => v.readyState === "ended")) {
            stopScreenShare();
          }
        };
      });

      // Connect screen audio to the live AudioContext mix if audio track is present
      if (hasAudio && audioCtxRef.current && mixedDestinationRef.current) {
        try {
          if (audioCtxRef.current.state === "suspended") {
            await audioCtxRef.current.resume().catch(() => {});
          }
          const screenAudioSource = audioCtxRef.current.createMediaStreamSource(new MediaStream([screenAudioTracks[0]]));
          const screenGain = audioCtxRef.current.createGain();
          screenGain.gain.value = screenAudioVolume;
          screenAudioSource.connect(screenGain);
          screenGain.connect(mixedDestinationRef.current);
          screenAudioSourceRef.current = screenAudioSource;
          screenGainNodeRef.current = screenGain;
          setIsScreenAudioOn(true);
          isScreenAudioOnRef.current = true;
        } catch (audioErr) {
          console.warn("Screen audio mixing note:", audioErr);
        }
      } else {
        setIsScreenAudioOn(false);
        isScreenAudioOnRef.current = false;
      }

      // Attach to local preview element if present
      if (localScreenVideoRef.current) {
        localScreenVideoRef.current.srcObject = displayStream;
        localScreenVideoRef.current.play().catch(() => {});
      }

      // Replace screen dummy track with real screen track across all active peers
      await Promise.all(
        Object.keys(peersRef.current).map(async (pUid) => {
          const pc = peersRef.current[pUid];
          if (pc && pc.connectionState !== "closed") {
            let screenSender = screenSendersRef.current[pUid];
            if (!screenSender) {
              const videoSenders = pc.getSenders().filter((s) => s.track?.kind === "video");
              if (videoSenders.length >= 2) {
                screenSender = videoSenders[1];
                screenSendersRef.current[pUid] = screenSender;
              } else if (videoSenders.length === 1) {
                screenSender = videoSenders[0];
              }
            }

            if (screenSender) {
              await screenSender.replaceTrack(screenVideoTrack).catch(() => {});
              try {
                const params = screenSender.getParameters();
                if (!params.encodings || params.encodings.length === 0) {
                  params.encodings = [{}];
                }
                params.encodings[0].maxBitrate = 3000000;
                params.encodings[0].priority = "high";
                params.encodings[0].networkPriority = "high";
                await screenSender.setParameters(params).catch(() => {});
              } catch (e) {}
            } else {
              try {
                const newSender = pc.addTrack(screenVideoTrack, displayStream);
                screenSendersRef.current[pUid] = newSender;
              } catch (e) {}
            }

            if (pc.signalingState === "stable") {
              try {
                const offer = await pc.createOffer({
                  offerToReceiveAudio: true,
                  offerToReceiveVideo: true,
                });
                const highQualityOffer = new RTCSessionDescription({
                  type: offer.type,
                  sdp: optimizeAudioSdp(offer.sdp || ""),
                });
                await pc.setLocalDescription(highQualityOffer);
                sendSignal(pUid, "offer", JSON.stringify(highQualityOffer));
              } catch (renegErr) {}
            }

            // Send custom signaling message to notify peer that screen share started
            sendSignal(pUid, "screenshare_started", JSON.stringify({ hasAudio }));
          }
        })
      );

      setIsScreenSharing(true);
      isScreenSharingRef.current = true;
      setIsScreenShareLoading(false);

      await updateDoc(doc(db, "voice_users", profile.uid), {
        isScreenSharing: true,
        isScreenAudioOn: hasAudio,
        timestamp: Date.now(),
      }).catch(() => {});
      await updateDoc(doc(db, "presence", profile.uid), {
        isScreenSharing: true,
        lastSeen: Date.now(),
      }).catch(() => {});
    } catch (err: any) {
      setIsScreenShareLoading(false);
      // If user cancelled browser dialog, avoid annoying error alert
      if (err?.name !== "NotAllowedError" && err?.name !== "AbortError") {
        console.error("Failed to start screen share:", err);
        setCameraNotice("Could not start screen share. Please check display permissions.");
        setTimeout(() => setCameraNotice(null), 5000);
      }
    }
  };

  // Toggle Screen Share
  const toggleScreenShare = () => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      startScreenShare();
    }
  };

  const handleLeave = () => {
    // 1. Immediately delete voice_users document and mark presence as left voice
    deleteDoc(doc(db, "voice_users", profile.uid)).catch(() => {});
    updateDoc(doc(db, "presence", profile.uid), {
      inVoice: false,
      isMuted: false,
    }).catch(() => {});

    // 2. Play leave sound ONLY if we had joined voice and are now leaving (never duplicate)
    if (hasJoinedVoiceRef.current) {
      hasJoinedVoiceRef.current = false;
      try {
        leaveSoundRef.current ||= new Audio("/audio/LockChime.wav");
        leaveSoundRef.current.currentTime = 0;
        leaveSoundRef.current.volume = 1;
        leaveSoundRef.current.play().catch(() => {});
      } catch {}
    }

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
  const anyVideoOn = !!activeRemoteWithVideo || isVideoOn || !!activeScreenShare;

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
          <div
            className="relative aspect-video w-full bg-black overflow-hidden flex items-center justify-center group"
            onDoubleClick={() => {
              if (activeScreenShare) {
                setFullscreenUid(activeScreenShare.uid);
                setFullscreenType("screen");
              } else if (activeRemoteWithVideo) {
                setFullscreenUid(activeRemoteWithVideo.uid);
                setFullscreenType("camera");
              } else if (isVideoOn) {
                setFullscreenUid(profile.uid);
                setFullscreenType("camera");
              }
            }}
          >
            {activeScreenShare ? (
              <>
                {activeScreenShare.isLocal ? (
                  <video
                    ref={(el) => {
                      localScreenVideoRef.current = el;
                      if (el && screenStreamRef.current && el.srcObject !== screenStreamRef.current) {
                        el.srcObject = screenStreamRef.current;
                        el.play().catch(() => {});
                      }
                    }}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <video
                    ref={(el) => {
                      remoteScreenVideoRefs.current[activeScreenShare.uid] = el;
                      const stream = remoteScreenStreamsRef.current[activeScreenShare.uid];
                      if (el && stream && el.srcObject !== stream) {
                        el.srcObject = stream;
                        el.play().catch(() => {});
                      }
                    }}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-contain"
                  />
                )}
                <div className="absolute bottom-2 left-2 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-semibold text-white flex items-center gap-1">
                  <MonitorUp size={11} className="text-emerald-400" />
                  <span className="truncate max-w-[120px]">{activeScreenShare.username}</span>
                  {activeScreenShare.hasAudio && (
                    <Volume2 size={10} className="text-sky-300 ml-0.5" />
                  )}
                </div>

                {/* PiP Fullscreen Button for Screen Share */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFullscreenUid(activeScreenShare.uid);
                    setFullscreenType("screen");
                  }}
                  className="absolute top-2 left-2 p-1.5 rounded-lg bg-black/70 hover:bg-black/90 text-white/80 hover:text-white backdrop-blur-md border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shadow z-10"
                  title={`Full screen ${activeScreenShare.username}'s screen`}
                >
                  <Maximize2 size={12} />
                </button>

                {/* Picture-in-picture camera overlay inside PiP window */}
                {(activeRemoteWithVideo || isVideoOn) && (
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      if (activeRemoteWithVideo) {
                        setFullscreenUid(activeRemoteWithVideo.uid);
                        setFullscreenType("camera");
                      } else {
                        setFullscreenUid(profile.uid);
                        setFullscreenType("camera");
                      }
                    }}
                    className="absolute top-2 right-2 w-20 aspect-video rounded-md overflow-hidden border border-neutral-700 shadow-md bg-black cursor-pointer group/local"
                    title="Click to view camera fullscreen"
                  >
                    {activeRemoteWithVideo ? (
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
                    ) : (
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
                    )}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/local:opacity-100 flex items-center justify-center transition-opacity">
                      <Maximize2 size={10} className="text-white" />
                    </div>
                  </div>
                )}
              </>
            ) : activeRemoteWithVideo ? (
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

                {/* PiP Fullscreen Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFullscreenUid(activeRemoteWithVideo.uid);
                    setFullscreenType("camera");
                  }}
                  className="absolute top-2 left-2 p-1.5 rounded-lg bg-black/70 hover:bg-black/90 text-white/80 hover:text-white backdrop-blur-md border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shadow z-10"
                  title={`Full screen ${activeRemoteWithVideo.username}'s video`}
                >
                  <Maximize2 size={12} />
                </button>

                {isVideoOn && (
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setFullscreenUid(profile.uid);
                      setFullscreenType("camera");
                    }}
                    className="absolute top-2 right-2 w-20 aspect-video rounded-md overflow-hidden border border-neutral-700 shadow-md bg-black cursor-pointer group/local"
                    title="Click to full screen your video"
                  >
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
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/local:opacity-100 flex items-center justify-center transition-opacity">
                      <Maximize2 size={10} className="text-white" />
                    </div>
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

                {/* PiP Fullscreen Button for Local User */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFullscreenUid(profile.uid);
                    setFullscreenType("camera");
                  }}
                  className="absolute top-2 left-2 p-1.5 rounded-lg bg-black/70 hover:bg-black/90 text-white/80 hover:text-white backdrop-blur-md border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shadow z-10"
                  title="Full screen your video"
                >
                  <Maximize2 size={12} />
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="p-3 bg-[#111214] flex items-center justify-center gap-2.5">
            <div className="flex flex-col items-center gap-1">
              <div className="relative">
                {profile.photoURL ? (
                  <img
                    src={profile.photoURL}
                    alt={profile.username}
                    className="w-10 h-10 rounded-full object-cover border-2 transition-all"
                    style={{
                      borderColor: isLocalSpeaking && !isMuted ? userColors[profile.uid]?.border || "#5865F2" : "#2b2d31",
                      boxShadow: isLocalSpeaking && !isMuted ? `0 0 0 2px ${userColors[profile.uid]?.ring || "rgba(88,101,242,0.3)"}, 0 0 8px ${userColors[profile.uid]?.glow || "rgba(88,101,242,0.4)"}` : undefined,
                      transform: isLocalSpeaking && !isMuted ? "scale(1.06)" : "scale(1)",
                    }}
                  />
                ) : (
                  <div
                    className="w-10 h-10 rounded-full border-2 flex items-center justify-center text-xs font-bold text-white transition-all"
                    style={{
                      backgroundColor: (userColors[profile.uid]?.hex || "#5865F2") + "22",
                      borderColor: isLocalSpeaking && !isMuted ? userColors[profile.uid]?.border || "#5865F2" : "#2b2d31",
                      color: userColors[profile.uid]?.hex || "#5865F2",
                      boxShadow: isLocalSpeaking && !isMuted ? `0 0 0 2px ${userColors[profile.uid]?.ring || "rgba(88,101,242,0.3)"}, 0 0 8px ${userColors[profile.uid]?.glow || "rgba(88,101,242,0.4)"}` : undefined,
                      transform: isLocalSpeaking && !isMuted ? "scale(1.06)" : "scale(1)",
                    }}
                  >
                    {profile.username.charAt(0).toUpperCase()}
                  </div>
                )}
                {isMuted && (
                  <div className="absolute -bottom-1 -right-1 bg-red-600 p-0.5 rounded-full text-white shadow">
                    <MicOff size={10} />
                  </div>
                )}
              </div>
              <span className="text-[10px] font-medium text-neutral-300 truncate max-w-[60px]">
                You
              </span>
            </div>

            {activeParticipants.slice(0, 3).map((p) => {
              const isRemoteSpeaking = !!remoteSpeaking[p.uid] && !p.isMuted;
              const pColor = userColors[p.uid] || { hex: "#5865F2", glow: "rgba(88,101,242,0.4)", border: "rgba(88,101,242,0.85)", ring: "rgba(88,101,242,0.3)" };
              return (
                <div key={p.uid} className="flex flex-col items-center gap-1">
                  <div className="relative">
                    {p.photoURL ? (
                      <img
                        src={p.photoURL}
                        alt={p.username}
                        className="w-10 h-10 rounded-full object-cover border-2 transition-all"
                        style={{
                          borderColor: isRemoteSpeaking ? pColor.border : "#2b2d31",
                          boxShadow: isRemoteSpeaking ? `0 0 0 2px ${pColor.ring}, 0 0 8px ${pColor.glow}` : undefined,
                          transform: isRemoteSpeaking ? "scale(1.06)" : "scale(1)",
                        }}
                      />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-full border-2 flex items-center justify-center text-xs font-bold text-white transition-all"
                        style={{
                          backgroundColor: pColor.hex + "22",
                          borderColor: isRemoteSpeaking ? pColor.border : "#2b2d31",
                          color: pColor.hex,
                          boxShadow: isRemoteSpeaking ? `0 0 0 2px ${pColor.ring}, 0 0 8px ${pColor.glow}` : undefined,
                          transform: isRemoteSpeaking ? "scale(1.06)" : "scale(1)",
                        }}
                      >
                        {p.username.charAt(0).toUpperCase()}
                      </div>
                    )}
                    {p.isMuted && (
                      <div className="absolute -bottom-1 -right-1 bg-red-600 p-0.5 rounded-full text-white shadow">
                        <MicOff size={10} />
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] font-medium text-neutral-300 truncate max-w-[60px]">
                    {p.username}
                  </span>
                </div>
              );
            })}
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
            onClick={toggleScreenShare}
            className={`p-2 rounded-xl transition-all cursor-pointer ${
              isScreenSharing
                ? "bg-emerald-600 text-white font-bold"
                : "bg-[#2b2d31] text-white hover:bg-[#35373c]"
            }`}
            title={isScreenSharing ? "Stop sharing screen" : "Share your screen"}
          >
            {isScreenSharing ? <ScreenShare size={14} /> : <MonitorUp size={14} />}
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

      {/* Helper to render participant camera/avatar tiles */}
      {(() => {
        const renderLocalTile = (compact = false) => {
          const localColor = userColors[profile.uid] || {
            hex: "#5865F2",
            rgb: [88, 101, 242] as [number, number, number],
            glow: "rgba(88, 101, 242, 0.45)",
            border: "rgba(88, 101, 242, 0.85)",
            ring: "rgba(88, 101, 242, 0.35)",
          };

          return (
            <div
              key="local-user-tile"
              className={`relative aspect-video rounded-2xl bg-[#0f0f0f] border overflow-hidden flex flex-col items-center justify-center shadow-lg group transition-all duration-200 ${
                compact ? "h-full flex-shrink-0" : "w-full"
              }`}
              style={{
                borderColor: isLocalSpeaking && !isMuted ? localColor.border : "rgba(38, 38, 38, 0.9)",
                boxShadow: isLocalSpeaking && !isMuted 
                  ? `0 0 24px ${localColor.glow}`
                  : "0 4px 12px rgba(0,0,0,0.5)",
              }}
              onDoubleClick={() => {
                if (isVideoOn) {
                  setFullscreenUid(profile.uid);
                  setFullscreenType("camera");
                }
              }}
            >
              {/* Fullscreen Video Button */}
              {isVideoOn && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFullscreenUid(profile.uid);
                    setFullscreenType("camera");
                  }}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/75 hover:bg-black/95 text-white/80 hover:text-white backdrop-blur-md border border-neutral-700/60 shadow-lg transition-all opacity-0 group-hover:opacity-100 cursor-pointer z-30 hover:scale-105"
                  title="Full screen your video"
                >
                  <Maximize2 size={compact ? 13 : 15} />
                </button>
              )}

              {/* Audio Status Badge */}
              {(isMuted || isLocalSpeaking) && (
                <div className="absolute top-2 left-2 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded-lg border border-neutral-800 flex items-center gap-1.5 z-20 animate-in fade-in duration-150">
                  <div
                    className="w-1.5 h-1.5 rounded-full transition-colors"
                    style={{
                      backgroundColor: isMuted ? "#ef4444" : localColor.hex,
                      boxShadow: isLocalSpeaking && !isMuted ? `0 0 8px ${localColor.glow}` : undefined,
                    }}
                  />
                  <span className="text-[9px] font-bold text-white tracking-wider">
                    {isMuted ? "MUTED" : "SPEAKING"}
                  </span>
                </div>
              )}

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
                        className={`${compact ? "w-8 h-8" : "w-12 h-12"} object-contain`}
                      />
                    </div>
                  )}
                </div>
              ) : isCameraLoading ? (
                <div className="relative w-full h-full bg-[#30343b] flex items-center justify-center animate-in fade-in duration-200">
                  <img
                    src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/loading-discord-4cdhz1tE0SAtxrt5ioRt7yzc8DpALU.gif"
                    alt="Loading camera"
                    className={`${compact ? "w-8 h-8" : "w-12 h-12"} object-contain`}
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <div className="relative">
                    {profile.photoURL ? (
                      <img
                        src={profile.photoURL}
                        alt={profile.username}
                        className={`${compact ? "w-12 h-12" : "w-20 h-20"} rounded-full object-cover shadow-md transition-all duration-150`}
                        style={{
                          borderWidth: "2px",
                          borderColor: isLocalSpeaking && !isMuted ? localColor.border : "rgba(64, 64, 64, 0.8)",
                          boxShadow: isLocalSpeaking && !isMuted ? `0 0 0 4px ${localColor.ring}, 0 0 16px ${localColor.glow}` : undefined,
                          transform: isLocalSpeaking && !isMuted ? "scale(1.05)" : "scale(1)",
                        }}
                      />
                    ) : (
                      <div
                        className={`${compact ? "w-12 h-12 text-lg" : "w-20 h-20 text-2xl"} rounded-full border-2 flex items-center justify-center font-bold text-white transition-all duration-150`}
                        style={{
                          backgroundColor: localColor.hex + "22",
                          borderColor: isLocalSpeaking && !isMuted ? localColor.border : "rgba(64, 64, 64, 0.8)",
                          color: localColor.hex,
                          boxShadow: isLocalSpeaking && !isMuted ? `0 0 0 4px ${localColor.ring}, 0 0 16px ${localColor.glow}` : undefined,
                          transform: isLocalSpeaking && !isMuted ? "scale(1.05)" : "scale(1)",
                        }}
                      >
                        {profile.username.charAt(0).toUpperCase()}
                      </div>
                    )}
                    {isMuted && (
                      <div className="absolute -bottom-1 -right-1 bg-red-600 p-1 rounded-full text-white shadow-lg border-2 border-[#0f0f0f]">
                        <MicOff size={compact ? 11 : 14} />
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="absolute bottom-2 left-2 bg-black/75 backdrop-blur-md px-2.5 py-0.5 rounded-lg border border-neutral-800 flex items-center gap-1.5 z-20">
                <span className={`${compact ? "text-[11px]" : "text-xs"} font-bold text-white`}>
                  {profile.username} (You)
                </span>
                {isScreenSharing && (
                  <span className="text-[9px] text-emerald-400 font-extrabold uppercase tracking-wider bg-emerald-950/90 px-1.5 py-0.2 rounded border border-emerald-700/80 flex items-center gap-0.5 animate-pulse">
                    <MonitorUp size={9} />
                    <span>LIVE</span>
                  </span>
                )}
                {isMuted && (
                  <span className="text-[9px] text-red-400 font-bold uppercase tracking-wider bg-red-950/80 px-1 py-0.2 rounded border border-red-800/60">
                    Muted
                  </span>
                )}
              </div>
            </div>
          );
        };

        const renderRemoteTile = (p: Participant, compact = false) => {
          const isSpeaking = !!remoteSpeaking[p.uid] && !p.isMuted;
          const pColor = userColors[p.uid] || {
            hex: "#5865F2",
            rgb: [88, 101, 242] as [number, number, number],
            glow: "rgba(88, 101, 242, 0.45)",
            border: "rgba(88, 101, 242, 0.85)",
            ring: "rgba(88, 101, 242, 0.35)",
          };

          return (
            <div
              key={p.uid}
              className={`relative aspect-video rounded-2xl bg-[#0f0f0f] border overflow-hidden flex flex-col items-center justify-center shadow-lg group transition-all duration-200 ${
                compact ? "h-full flex-shrink-0" : "w-full"
              }`}
              style={{
                borderColor: isSpeaking ? pColor.border : "rgba(38, 38, 38, 0.9)",
                boxShadow: isSpeaking 
                  ? `0 0 24px ${pColor.glow}`
                  : "0 4px 12px rgba(0,0,0,0.5)",
              }}
              onDoubleClick={() => {
                if (p.isVideoOn) {
                  setFullscreenUid(p.uid);
                  setFullscreenType("camera");
                }
              }}
            >
              {/* Fullscreen Video Button */}
              {p.isVideoOn && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFullscreenUid(p.uid);
                    setFullscreenType("camera");
                  }}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/75 hover:bg-black/95 text-white/80 hover:text-white backdrop-blur-md border border-neutral-700/60 shadow-lg transition-all opacity-0 group-hover:opacity-100 cursor-pointer z-30 hover:scale-105"
                  title={`Full screen ${p.username}'s video`}
                >
                  <Maximize2 size={compact ? 13 : 15} />
                </button>
              )}

              {/* Audio Status Badge */}
              {(p.isMuted || isSpeaking) && (
                <div className="absolute top-2 left-2 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded-lg border border-neutral-800 flex items-center gap-1.5 z-20 animate-in fade-in duration-150">
                  <div
                    className="w-1.5 h-1.5 rounded-full transition-colors"
                    style={{
                      backgroundColor: p.isMuted ? "#ef4444" : pColor.hex,
                      boxShadow: isSpeaking ? `0 0 8px ${pColor.glow}` : undefined,
                    }}
                  />
                  <span className="text-[9px] font-bold text-white tracking-wider">
                    {p.isMuted ? "MUTED" : "SPEAKING"}
                  </span>
                </div>
              )}

              {/* Video Element */}
              {p.isVideoOn ? (
                <div className="relative w-full h-full">
                  <video
                    ref={(el) => {
                      remoteVideoRefs.current[p.uid] = el;
                      const remoteStream = remoteStreamsRef.current[p.uid];
                      if (el && remoteStream) {
                        if (el.srcObject !== remoteStream) {
                          el.srcObject = remoteStream;
                        }
                        el.play().catch(() => {});
                        if (el.readyState >= 1 || el.videoWidth > 0) {
                          setRemoteVideoLoaded((prev) => (prev[p.uid] ? prev : { ...prev, [p.uid]: true }));
                        }
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
                    className="w-full h-full object-cover"
                  />

                  {(!remoteVideoLoaded[p.uid] || p.isVideoLoading) && (
                    <div className="absolute inset-0 bg-[#30343b] flex items-center justify-center z-10 animate-in fade-in duration-200 pointer-events-none">
                      <img
                        src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/loading-discord-4cdhz1tE0SAtxrt5ioRt7yzc8DpALU.gif"
                        alt="Loading camera"
                        className={`${compact ? "w-8 h-8" : "w-12 h-12"} object-contain`}
                      />
                    </div>
                  )}
                </div>
              ) : p.isVideoLoading ? (
                <div className="relative w-full h-full bg-[#30343b] flex items-center justify-center animate-in fade-in duration-200">
                  <img
                    src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/loading-discord-4cdhz1tE0SAtxrt5ioRt7yzc8DpALU.gif"
                    alt="Loading camera"
                    className={`${compact ? "w-8 h-8" : "w-12 h-12"} object-contain`}
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <div className="relative">
                    {p.photoURL ? (
                      <img
                        src={p.photoURL}
                        alt={p.username}
                        className={`${compact ? "w-12 h-12" : "w-20 h-20"} rounded-full object-cover shadow-md transition-all duration-150`}
                        style={{
                          borderWidth: "2px",
                          borderColor: isSpeaking ? pColor.border : "rgba(64, 64, 64, 0.8)",
                          boxShadow: isSpeaking ? `0 0 0 4px ${pColor.ring}, 0 0 16px ${pColor.glow}` : undefined,
                          transform: isSpeaking ? "scale(1.05)" : "scale(1)",
                        }}
                      />
                    ) : (
                      <div
                        className={`${compact ? "w-12 h-12 text-lg" : "w-20 h-20 text-2xl"} rounded-full border-2 flex items-center justify-center font-bold text-white transition-all duration-150`}
                        style={{
                          backgroundColor: pColor.hex + "22",
                          borderColor: isSpeaking ? pColor.border : "rgba(64, 64, 64, 0.8)",
                          color: pColor.hex,
                          boxShadow: isSpeaking ? `0 0 0 4px ${pColor.ring}, 0 0 16px ${pColor.glow}` : undefined,
                          transform: isSpeaking ? "scale(1.05)" : "scale(1)",
                        }}
                      >
                        {p.username.charAt(0).toUpperCase()}
                      </div>
                    )}
                    {p.isMuted && (
                      <div className="absolute -bottom-1 -right-1 bg-red-600 p-1 rounded-full text-white shadow-lg border-2 border-[#0f0f0f]">
                        <MicOff size={compact ? 11 : 14} />
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="absolute bottom-2 left-2 bg-black/75 backdrop-blur-md px-2.5 py-0.5 rounded-lg border border-neutral-800 flex items-center gap-1.5 z-20">
                <span className={`${compact ? "text-[11px]" : "text-xs"} font-bold text-white`}>{p.username}</span>
                {p.isScreenSharing && (
                  <span className="text-[9px] text-emerald-400 font-extrabold uppercase tracking-wider bg-emerald-950/90 px-1.5 py-0.2 rounded border border-emerald-700/80 flex items-center gap-0.5 animate-pulse">
                    <MonitorUp size={9} />
                    <span>LIVE</span>
                  </span>
                )}
                {p.isMuted && (
                  <span className="text-[9px] text-red-400 font-bold uppercase tracking-wider bg-red-950/80 px-1 py-0.2 rounded border border-red-800/60">
                    Muted
                  </span>
                )}
              </div>
            </div>
          );
        };

        if (activeScreenShare) {
          return (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-3 sm:p-4 gap-3">
              {/* Zoom Layout Mode: Side-by-Side vs Gallery Strip */}
              {zoomLayoutMode === "side-by-side" ? (
                <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-3 overflow-hidden">
                  {/* Left / Main: Zoom Screen Share Stage */}
                  <div
                    className="relative flex-1 min-h-[300px] lg:min-h-0 bg-[#07080a] rounded-2xl border border-neutral-800/90 overflow-hidden shadow-2xl flex items-center justify-center group"
                    onDoubleClick={() => {
                      setFullscreenUid(activeScreenShare.uid);
                      setFullscreenType("screen");
                    }}
                  >
                    <div
                      className="w-full h-full flex items-center justify-center overflow-hidden transition-transform duration-200"
                      style={{ transform: `scale(${screenZoom})` }}
                    >
                      {activeScreenShare.isLocal ? (
                        <video
                          ref={(el) => {
                            localScreenVideoRef.current = el;
                            if (el && screenStreamRef.current && el.srcObject !== screenStreamRef.current) {
                              el.srcObject = screenStreamRef.current;
                              el.play().catch(() => {});
                            }
                          }}
                          autoPlay
                          playsInline
                          muted
                          className={`w-full h-full ${
                            screenFitMode === "cover" ? "object-cover" : "object-contain"
                          }`}
                        />
                      ) : (
                        <video
                          ref={(el) => {
                            remoteScreenVideoRefs.current[activeScreenShare.uid] = el;
                            const stream = remoteScreenStreamsRef.current[activeScreenShare.uid];
                            if (el && stream && el.srcObject !== stream) {
                              el.srcObject = stream;
                              el.play().catch(() => {});
                            }
                          }}
                          autoPlay
                          playsInline
                          muted
                          className={`w-full h-full ${
                            screenFitMode === "cover" ? "object-cover" : "object-contain"
                          }`}
                        />
                      )}
                    </div>

                    {/* Stage Header Badge */}
                    <div className="absolute top-3 left-3 flex items-center gap-2 z-20">
                      <div className="bg-black/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-neutral-800 flex items-center gap-2 shadow-lg">
                        <MonitorUp size={15} className="text-emerald-400 animate-pulse flex-shrink-0" />
                        <span className="text-xs font-bold text-white tracking-wide truncate max-w-[140px] sm:max-w-[220px]">
                          {activeScreenShare.username}'s Screen
                        </span>
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded font-extrabold uppercase tracking-wider">
                          LIVE
                        </span>
                        {activeScreenShare.hasAudio && (
                          <div className="text-[10px] bg-sky-500/20 text-sky-300 border border-sky-500/30 px-2 py-0.5 rounded font-extrabold uppercase tracking-wider flex items-center gap-1.5">
                            <Volume2 size={11} className="text-sky-400 animate-pulse" />
                            <span className="hidden sm:inline">Screen Audio</span>
                            <div className="flex items-center gap-0.5 h-2">
                              <span className="w-0.5 h-1.5 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                              <span className="w-0.5 h-2.5 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                              <span className="w-0.5 h-1 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Stage Controls: Zoom, Fit, Layout Switcher & Fullscreen */}
                    <div className="absolute top-3 right-3 flex items-center gap-1.5 z-20">
                      {/* Zoom & Fit Toolbar */}
                      <div className="flex items-center gap-1 bg-black/80 backdrop-blur-md p-1 rounded-xl border border-neutral-800 shadow-xl opacity-90 hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setScreenZoom((z) => Math.min(2.5, Number((z + 0.25).toFixed(2))))}
                          className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-300 hover:text-white transition-colors cursor-pointer"
                          title="Zoom In Screen"
                        >
                          <ZoomIn size={14} />
                        </button>
                        <span className="text-[10px] font-bold text-neutral-300 px-1 select-none min-w-[32px] text-center">
                          {Math.round(screenZoom * 100)}%
                        </span>
                        <button
                          onClick={() => setScreenZoom((z) => Math.max(0.75, Number((z - 0.25).toFixed(2))))}
                          className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-300 hover:text-white transition-colors cursor-pointer"
                          title="Zoom Out Screen"
                        >
                          <ZoomOut size={14} />
                        </button>
                        {screenZoom !== 1 && (
                          <button
                            onClick={() => setScreenZoom(1.0)}
                            className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-300 hover:text-white transition-colors cursor-pointer"
                            title="Reset Zoom"
                          >
                            <RotateCcw size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => setScreenFitMode((f) => (f === "contain" ? "cover" : "contain"))}
                          className="px-2 py-1 rounded-lg hover:bg-neutral-800 text-neutral-300 hover:text-white text-[11px] font-semibold transition-colors cursor-pointer"
                          title={screenFitMode === "contain" ? "Fill Area (Crop)" : "Fit Entire Frame"}
                        >
                          {screenFitMode === "contain" ? "Fit" : "Fill"}
                        </button>
                      </div>

                      {/* Layout Switcher: Side-by-side vs Gallery strip */}
                      <button
                        onClick={() => setZoomLayoutMode((m) => (m === "side-by-side" ? "gallery-strip" : "side-by-side"))}
                        className="p-2 rounded-xl bg-black/80 hover:bg-neutral-900 text-neutral-300 hover:text-white backdrop-blur-md border border-neutral-800 shadow-xl transition-all cursor-pointer"
                        title="Switch to Gallery Strip Layout"
                      >
                        <Layout size={15} />
                      </button>

                      {activeScreenShare.isLocal && (
                        <button
                          onClick={stopScreenShare}
                          className="px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-all cursor-pointer shadow-xl flex items-center gap-1.5 active:scale-95"
                          title="Stop sharing your screen"
                        >
                          <ScreenShareOff size={14} />
                          <span className="hidden sm:inline">Stop Sharing</span>
                        </button>
                      )}

                      <button
                        onClick={() => {
                          setFullscreenUid(activeScreenShare.uid);
                          setFullscreenType("screen");
                        }}
                        className="p-2 rounded-xl bg-black/80 hover:bg-black text-white/90 hover:text-white backdrop-blur-md border border-neutral-700/60 shadow-xl transition-all cursor-pointer hover:scale-105"
                        title="Full screen this presentation"
                      >
                        <Maximize2 size={15} />
                      </button>
                    </div>
                  </div>

                  {/* Right: Zoom Side-by-Side Gallery (Camera Feeds of Everyone) */}
                  <div className="w-full lg:w-72 xl:w-80 flex-shrink-0 flex lg:flex-col gap-3 overflow-x-auto lg:overflow-y-auto max-h-40 lg:max-h-full p-1">
                    <div className="w-48 lg:w-full flex-shrink-0 aspect-video">
                      {renderLocalTile(true)}
                    </div>
                    {activeParticipants.map((p) => (
                      <div key={p.uid} className="w-48 lg:w-full flex-shrink-0 aspect-video">
                        {renderRemoteTile(p, true)}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* Gallery Strip Layout (Screen in center, cameras at bottom) */
                <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
                  <div
                    className="relative flex-1 min-h-0 bg-[#07080a] rounded-2xl border border-neutral-800/90 overflow-hidden shadow-2xl flex items-center justify-center group"
                    onDoubleClick={() => {
                      setFullscreenUid(activeScreenShare.uid);
                      setFullscreenType("screen");
                    }}
                  >
                    <div
                      className="w-full h-full flex items-center justify-center overflow-hidden transition-transform duration-200"
                      style={{ transform: `scale(${screenZoom})` }}
                    >
                      {activeScreenShare.isLocal ? (
                        <video
                          ref={(el) => {
                            localScreenVideoRef.current = el;
                            if (el && screenStreamRef.current && el.srcObject !== screenStreamRef.current) {
                              el.srcObject = screenStreamRef.current;
                              el.play().catch(() => {});
                            }
                          }}
                          autoPlay
                          playsInline
                          muted
                          className={`w-full h-full ${
                            screenFitMode === "cover" ? "object-cover" : "object-contain"
                          }`}
                        />
                      ) : (
                        <video
                          ref={(el) => {
                            remoteScreenVideoRefs.current[activeScreenShare.uid] = el;
                            const stream = remoteScreenStreamsRef.current[activeScreenShare.uid];
                            if (el && stream && el.srcObject !== stream) {
                              el.srcObject = stream;
                              el.play().catch(() => {});
                            }
                          }}
                          autoPlay
                          playsInline
                          muted
                          className={`w-full h-full ${
                            screenFitMode === "cover" ? "object-cover" : "object-contain"
                          }`}
                        />
                      )}
                    </div>

                    {/* Stage Header Badge */}
                    <div className="absolute top-3 left-3 flex items-center gap-2 z-20">
                      <div className="bg-black/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-neutral-800 flex items-center gap-2 shadow-lg">
                        <MonitorUp size={15} className="text-emerald-400 animate-pulse flex-shrink-0" />
                        <span className="text-xs font-bold text-white tracking-wide truncate max-w-[140px] sm:max-w-[220px]">
                          {activeScreenShare.username}'s Screen
                        </span>
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded font-extrabold uppercase tracking-wider">
                          LIVE
                        </span>
                        {activeScreenShare.hasAudio && (
                          <div className="text-[10px] bg-sky-500/20 text-sky-300 border border-sky-500/30 px-2 py-0.5 rounded font-extrabold uppercase tracking-wider flex items-center gap-1.5">
                            <Volume2 size={11} className="text-sky-400 animate-pulse" />
                            <span className="hidden sm:inline">Screen Audio</span>
                            <div className="flex items-center gap-0.5 h-2">
                              <span className="w-0.5 h-1.5 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                              <span className="w-0.5 h-2.5 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                              <span className="w-0.5 h-1 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Stage Controls */}
                    <div className="absolute top-3 right-3 flex items-center gap-1.5 z-20">
                      {/* Zoom Toolbar */}
                      <div className="flex items-center gap-1 bg-black/80 backdrop-blur-md p-1 rounded-xl border border-neutral-800 shadow-xl opacity-90 hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setScreenZoom((z) => Math.min(2.5, Number((z + 0.25).toFixed(2))))}
                          className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-300 hover:text-white transition-colors cursor-pointer"
                          title="Zoom In Screen"
                        >
                          <ZoomIn size={14} />
                        </button>
                        <span className="text-[10px] font-bold text-neutral-300 px-1 select-none min-w-[32px] text-center">
                          {Math.round(screenZoom * 100)}%
                        </span>
                        <button
                          onClick={() => setScreenZoom((z) => Math.max(0.75, Number((z - 0.25).toFixed(2))))}
                          className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-300 hover:text-white transition-colors cursor-pointer"
                          title="Zoom Out Screen"
                        >
                          <ZoomOut size={14} />
                        </button>
                        {screenZoom !== 1 && (
                          <button
                            onClick={() => setScreenZoom(1.0)}
                            className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-300 hover:text-white transition-colors cursor-pointer"
                            title="Reset Zoom"
                          >
                            <RotateCcw size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => setScreenFitMode((f) => (f === "contain" ? "cover" : "contain"))}
                          className="px-2 py-1 rounded-lg hover:bg-neutral-800 text-neutral-300 hover:text-white text-[11px] font-semibold transition-colors cursor-pointer"
                          title={screenFitMode === "contain" ? "Fill Area (Crop)" : "Fit Entire Frame"}
                        >
                          {screenFitMode === "contain" ? "Fit" : "Fill"}
                        </button>
                      </div>

                      {/* Layout Switcher */}
                      <button
                        onClick={() => setZoomLayoutMode((m) => (m === "side-by-side" ? "gallery-strip" : "side-by-side"))}
                        className="p-2 rounded-xl bg-black/80 hover:bg-neutral-900 text-neutral-300 hover:text-white backdrop-blur-md border border-neutral-800 shadow-xl transition-all cursor-pointer"
                        title="Switch to Side-by-Side Layout"
                      >
                        <Columns size={15} />
                      </button>

                      {activeScreenShare.isLocal && (
                        <button
                          onClick={stopScreenShare}
                          className="px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-all cursor-pointer shadow-xl flex items-center gap-1.5 active:scale-95"
                          title="Stop sharing your screen"
                        >
                          <ScreenShareOff size={14} />
                          <span className="hidden sm:inline">Stop Sharing</span>
                        </button>
                      )}

                      <button
                        onClick={() => {
                          setFullscreenUid(activeScreenShare.uid);
                          setFullscreenType("screen");
                        }}
                        className="p-2 rounded-xl bg-black/80 hover:bg-black text-white/90 hover:text-white backdrop-blur-md border border-neutral-700/60 shadow-xl transition-all cursor-pointer hover:scale-105"
                        title="Full screen this presentation"
                      >
                        <Maximize2 size={15} />
                      </button>
                    </div>
                  </div>

                  {/* Bottom Zoom-style Participant Strip (Displays Everyone's Camera Feeds) */}
                  <div className="h-28 sm:h-36 flex-shrink-0 flex items-center gap-3 overflow-x-auto pb-1 px-1">
                    {renderLocalTile(true)}
                    {activeParticipants.map((p) => renderRemoteTile(p, true))}
                  </div>
                </div>
              )}
            </div>
          );
        }

        /* Regular Participant Grid */
        return (
          <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 items-center align-middle">
            {renderLocalTile(false)}
            {activeParticipants.map((p) => renderRemoteTile(p, false))}
          </div>
        );
      })()}

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

        {/* Screen Share Button */}
        <button
          onClick={toggleScreenShare}
          className={`p-3.5 rounded-2xl transition-all cursor-pointer ${
            isScreenSharing
              ? "bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-lg shadow-emerald-900/40"
              : "bg-neutral-900 text-white border border-neutral-800 hover:bg-neutral-800"
          }`}
          title={
            isScreenSharing
              ? "Stop Screen Sharing"
              : "Share Screen (Zoom-style presentation with system audio)"
          }
        >
          {isScreenSharing ? (
            <ScreenShare size={20} className="stroke-[2.2]" />
          ) : (
            <MonitorUp size={20} className="stroke-[2.2]" />
          )}
        </button>

        {/* Screen Audio Volume Control when local screen audio is active */}
        {isScreenSharing && isScreenAudioOn && (
          <div className="hidden lg:flex items-center gap-2 bg-neutral-900/90 border border-neutral-800 px-3 py-2 rounded-2xl animate-in fade-in duration-200">
            <Volume2 size={16} className="text-sky-400 flex-shrink-0" />
            <input
              type="range"
              min="0"
              max="1.5"
              step="0.05"
              value={screenAudioVolume}
              onChange={(e) => setScreenAudioVolume(parseFloat(e.target.value))}
              className="w-16 sm:w-20 accent-sky-400 cursor-pointer"
              title={`Screen Audio Volume: ${Math.round(screenAudioVolume * 100)}%`}
            />
            <span className="text-[10px] font-bold text-neutral-400 w-7">
              {Math.round(screenAudioVolume * 100)}%
            </span>
          </div>
        )}

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

    {/* Fullscreen User Video Overlay */}
    {fullscreenUid && (() => {
      const isFullscreenLocal = fullscreenUid === profile.uid;
      const fullscreenParticipant = isFullscreenLocal
        ? null
        : activeParticipants.find((p) => p.uid === fullscreenUid);

      const targetUsername = isFullscreenLocal
        ? `${profile.username} (You)`
        : fullscreenParticipant?.username || "Participant";
      const targetPhoto = isFullscreenLocal
        ? profile.photoURL
        : fullscreenParticipant?.photoURL;
      const targetIsMuted = isFullscreenLocal
        ? isMuted
        : !!fullscreenParticipant?.isMuted;
      const targetIsSpeaking = isFullscreenLocal
        ? isLocalSpeaking
        : !!remoteSpeaking[fullscreenUid] && !fullscreenParticipant?.isMuted;
      const targetIsVideo = isFullscreenLocal
        ? isVideoOn
        : !!fullscreenParticipant?.isVideoOn;
      const isTargetScreen = fullscreenType === "screen";
      const targetHasAudio = isFullscreenLocal
        ? isScreenAudioOn
        : !!fullscreenParticipant?.isScreenAudioOn;

      const targetColor = userColors[fullscreenUid] || {
        hex: "#5865F2",
        rgb: [88, 101, 242] as [number, number, number],
        glow: "rgba(88, 101, 242, 0.45)",
        border: "rgba(88, 101, 242, 0.85)",
        ring: "rgba(88, 101, 242, 0.35)",
      };

      const screenStream = isFullscreenLocal
        ? screenStreamRef.current
        : remoteScreenStreamsRef.current[fullscreenUid];

      const cameraStream = isFullscreenLocal
        ? videoStreamRef.current
        : remoteStreamsRef.current[fullscreenUid];

      return (
        <div
          id="user-video-fullscreen-overlay"
          ref={fullscreenContainerRef}
          onMouseMove={handleFullscreenMouseMove}
          className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center select-none overflow-hidden animate-in fade-in duration-200"
        >
          {/* Top Bar Floating Controls */}
          <div
            className={`absolute top-0 inset-x-0 p-4 z-40 flex items-center justify-between bg-gradient-to-b from-black/85 via-black/40 to-transparent transition-opacity duration-300 pointer-events-auto ${
              showFullscreenControls ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
          >
            {/* Participant Profile info */}
            <div className="flex items-center gap-3 bg-black/60 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/10 shadow-lg">
              <div className="relative">
                {targetPhoto ? (
                  <img
                    src={targetPhoto}
                    alt={targetUsername}
                    className="w-7 h-7 rounded-full object-cover"
                  />
                ) : (
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                    style={{ backgroundColor: targetColor.hex }}
                  >
                    {targetUsername.charAt(0).toUpperCase()}
                  </div>
                )}
                {targetIsSpeaking && (
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border border-black animate-pulse" />
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white truncate max-w-[200px]">
                  {targetUsername}
                </span>
                {isTargetScreen ? (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded font-extrabold flex items-center gap-1">
                    <MonitorUp size={11} /> SCREEN SHARE
                  </span>
                ) : targetIsVideo ? (
                  <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.5 rounded font-bold">
                    CAMERA
                  </span>
                ) : null}
                {isTargetScreen && targetHasAudio && (
                  <span className="text-[10px] bg-sky-500/20 text-sky-300 border border-sky-500/30 px-1.5 py-0.5 rounded font-bold flex items-center gap-1">
                    <Volume2 size={10} /> AUDIO
                  </span>
                )}
                {targetIsMuted ? (
                  <span className="text-[10px] bg-red-500/20 text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded font-bold">
                    MUTED
                  </span>
                ) : targetIsSpeaking ? (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded font-bold flex items-center gap-1">
                    <Radio size={10} className="animate-pulse" /> SPEAKING
                  </span>
                ) : null}
              </div>
            </div>

            {/* Right Side Buttons */}
            <div className="flex items-center gap-2">
              {/* Switcher pills for active cameras and screen shares */}
              {participantsWithVideo.length > 1 && (
                <div className="hidden md:flex items-center gap-1.5 bg-black/60 backdrop-blur-md px-2 py-1 rounded-full border border-white/10">
                  <span className="text-[11px] text-neutral-400 font-medium px-1.5">Switch:</span>
                  {participantsWithVideo.map((item) => (
                    <button
                      key={`${item.uid}-${item.type}`}
                      onClick={() => {
                        setFullscreenUid(item.uid);
                        setFullscreenType(item.type);
                      }}
                      className={`text-xs px-2.5 py-1 rounded-full font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                        fullscreenUid === item.uid && fullscreenType === item.type
                          ? "bg-white text-black font-semibold shadow"
                          : "text-neutral-300 hover:text-white hover:bg-white/10"
                      }`}
                    >
                      {item.type === "screen" && <MonitorUp size={12} />}
                      <span>{item.username}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Video Fit button */}
              {(targetIsVideo || isTargetScreen) && (
                <button
                  onClick={() => setFullscreenFit((f) => (f === "contain" ? "cover" : "contain"))}
                  className="px-3 py-1.5 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/10 text-neutral-200 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer shadow-lg"
                  title={fullscreenFit === "contain" ? "Fill screen (crop edges)" : "Fit to screen (show full frame)"}
                >
                  {fullscreenFit === "contain" ? "Fill Screen" : "Fit to Screen"}
                </button>
              )}

              {/* Browser Fullscreen button */}
              <button
                onClick={toggleNativeFullscreen}
                className="p-2 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/10 text-neutral-200 hover:text-white transition-colors cursor-pointer shadow-lg"
                title={isNativeFullscreen ? "Exit window fullscreen" : "Toggle window fullscreen"}
              >
                {isNativeFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>

              {/* Exit button */}
              <button
                onClick={exitFullscreen}
                className="p-2 rounded-full bg-black/60 hover:bg-red-500/80 backdrop-blur-md border border-white/10 text-neutral-200 hover:text-white transition-colors cursor-pointer shadow-lg"
                title="Exit full screen (Esc)"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Video or Screen or Avatar Display Area */}
          <div
            className="relative w-full h-full flex-1 flex items-center justify-center overflow-hidden bg-black"
            onDoubleClick={() => setFullscreenFit((f) => (f === "contain" ? "cover" : "contain"))}
          >
            {isTargetScreen ? (
              <div className="relative w-full h-full flex items-center justify-center">
                <video
                  ref={(el) => {
                    fullscreenVideoRef.current = el;
                    if (el && screenStream && el.srcObject !== screenStream) {
                      el.srcObject = screenStream;
                      el.play().catch(() => {});
                    }
                  }}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full max-w-full max-h-full transition-all duration-150 cursor-pointer ${
                    fullscreenFit === "cover" ? "object-cover" : "object-contain"
                  }`}
                />

                {/* Floating camera PiP in fullscreen mode */}
                {((isFullscreenLocal && isVideoOn) || (!isFullscreenLocal && fullscreenParticipant?.isVideoOn)) && (
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setFullscreenType("camera");
                    }}
                    className="absolute top-20 right-6 w-44 sm:w-56 aspect-video rounded-xl overflow-hidden border border-neutral-700 shadow-2xl bg-black cursor-pointer group/campip z-30 transition-transform hover:scale-105"
                    title="Click to view camera in main fullscreen"
                  >
                    <video
                      ref={(el) => {
                        if (el && cameraStream && el.srcObject !== cameraStream) {
                          el.srcObject = cameraStream;
                          el.play().catch(() => {});
                        }
                      }}
                      autoPlay
                      playsInline
                      muted
                      className={`w-full h-full object-cover ${isFullscreenLocal ? "transform -scale-x-100" : ""}`}
                    />
                    <div className="absolute bottom-2 left-2 bg-black/85 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-bold text-white shadow">
                      {targetUsername}
                    </div>
                  </div>
                )}
              </div>
            ) : targetIsVideo ? (
              <video
                ref={(el) => {
                  fullscreenVideoRef.current = el;
                  if (el && cameraStream && el.srcObject !== cameraStream) {
                    el.srcObject = cameraStream;
                    el.play().catch(() => {});
                  }
                }}
                autoPlay
                playsInline
                muted={isFullscreenLocal}
                className={`w-full h-full max-w-full max-h-full transition-all duration-150 cursor-pointer ${
                  fullscreenFit === "cover" ? "object-cover" : "object-contain"
                } ${isFullscreenLocal ? "transform -scale-x-100" : ""}`}
              />
            ) : (
              <div className="flex flex-col items-center gap-4 text-center px-4">
                <div className="relative">
                  {targetPhoto ? (
                    <img
                      src={targetPhoto}
                      alt={targetUsername}
                      className="w-28 h-28 rounded-full object-cover shadow-2xl border-4"
                      style={{
                        borderColor: targetIsSpeaking ? targetColor.border : "rgba(64,64,64,0.8)",
                        boxShadow: targetIsSpeaking
                          ? `0 0 0 6px ${targetColor.ring}, 0 0 24px ${targetColor.glow}`
                          : undefined,
                      }}
                    />
                  ) : (
                    <div
                      className="w-28 h-28 rounded-full border-4 flex items-center justify-center text-4xl font-bold text-white shadow-2xl"
                      style={{
                        backgroundColor: targetColor.hex + "22",
                        borderColor: targetIsSpeaking ? targetColor.border : "rgba(64,64,64,0.8)",
                        color: targetColor.hex,
                        boxShadow: targetIsSpeaking
                          ? `0 0 0 6px ${targetColor.ring}, 0 0 24px ${targetColor.glow}`
                          : undefined,
                      }}
                    >
                      {targetUsername.charAt(0).toUpperCase()}
                    </div>
                  )}
                  {targetIsMuted && (
                    <div className="absolute -bottom-1 -right-1 bg-red-600 p-2 rounded-full text-white shadow-xl border-2 border-black">
                      <MicOff size={18} />
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">{targetUsername}</h3>
                  <p className="text-sm text-neutral-400 mt-1">Camera is currently off</p>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Floating Control Dock */}
          <div
            className={`absolute bottom-0 inset-x-0 p-6 z-40 flex flex-col items-center gap-3 bg-gradient-to-t from-black/90 via-black/50 to-transparent transition-opacity duration-300 pointer-events-auto ${
              showFullscreenControls ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
          >
            {/* Mobile quick switcher if more than 1 video/screen feed */}
            {participantsWithVideo.length > 1 && (
              <div className="flex md:hidden items-center gap-1.5 bg-black/70 backdrop-blur-md p-1 rounded-full border border-white/10 max-w-full overflow-x-auto">
                {participantsWithVideo.map((item) => (
                  <button
                    key={`${item.uid}-${item.type}`}
                    onClick={() => {
                      setFullscreenUid(item.uid);
                      setFullscreenType(item.type);
                    }}
                    className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap transition-all cursor-pointer flex items-center gap-1 ${
                      fullscreenUid === item.uid && fullscreenType === item.type
                        ? "bg-white text-black font-semibold shadow"
                        : "text-neutral-300 hover:text-white hover:bg-white/10"
                    }`}
                  >
                    {item.type === "screen" && <MonitorUp size={11} />}
                    <span>{item.username}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3 bg-[#111214]/90 backdrop-blur-xl px-4 py-2.5 rounded-2xl border border-neutral-800 shadow-2xl">
              {/* Mic toggle */}
              <button
                onClick={toggleMute}
                className={`p-3 rounded-xl transition-all cursor-pointer ${
                  isMuted
                    ? "bg-red-600/20 text-red-500 border border-red-800/80 hover:bg-red-600/30"
                    : "bg-neutral-800 text-white hover:bg-neutral-700"
                }`}
                title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
              >
                {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
              </button>

              {/* Camera toggle */}
              <button
                onClick={toggleVideo}
                disabled={isCameraLoading}
                className={`p-3 rounded-xl transition-all cursor-pointer ${
                  isCameraLoading
                    ? "bg-neutral-800 text-neutral-400 cursor-wait"
                    : isVideoOn
                    ? "bg-white text-black font-bold shadow-lg"
                    : "bg-neutral-800 text-white hover:bg-neutral-700"
                }`}
                title={isVideoOn ? "Turn Off Camera" : "Turn On Camera"}
              >
                {isCameraLoading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : isVideoOn ? (
                  <Video size={18} />
                ) : (
                  <VideoOff size={18} />
                )}
              </button>

              {/* Screen Share toggle */}
              <button
                onClick={toggleScreenShare}
                className={`p-3 rounded-xl transition-all cursor-pointer ${
                  isScreenSharing
                    ? "bg-emerald-600 text-white font-bold shadow-lg"
                    : "bg-neutral-800 text-white hover:bg-neutral-700"
                }`}
                title={isScreenSharing ? "Stop Screen Sharing" : "Share Screen"}
              >
                {isScreenSharing ? <ScreenShare size={18} /> : <MonitorUp size={18} />}
              </button>

              {/* Screen Audio volume in fullscreen */}
              {isScreenSharing && isScreenAudioOn && (
                <div className="hidden sm:flex items-center gap-2 px-2 py-1 bg-neutral-900 rounded-xl border border-neutral-700">
                  <Volume2 size={14} className="text-sky-400" />
                  <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.05"
                    value={screenAudioVolume}
                    onChange={(e) => setScreenAudioVolume(parseFloat(e.target.value))}
                    className="w-16 accent-sky-400 cursor-pointer"
                    title={`Screen Audio Volume: ${Math.round(screenAudioVolume * 100)}%`}
                  />
                </div>
              )}

              <div className="h-6 w-px bg-neutral-700 mx-1" />

              {/* Disconnect voice */}
              <button
                onClick={() => {
                  exitFullscreen();
                  handleLeave();
                }}
                className="p-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white shadow-lg transition-all cursor-pointer active:scale-95"
                title="Disconnect from Voice"
              >
                <PhoneOff size={18} />
              </button>

              {/* Exit Fullscreen button */}
              <button
                onClick={exitFullscreen}
                className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white transition-all text-xs font-semibold cursor-pointer"
                title="Exit full screen (Esc)"
              >
                <Minimize2 size={16} />
                <span className="hidden sm:inline">Exit Full Screen</span>
              </button>
            </div>
          </div>
        </div>
      );
    })()}
  </>
  );
}
