import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Phone,
  PhoneOff,
  PhoneIncoming,
  PhoneOutgoing,
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  Maximize2,
  Minimize2,
  X,
  Volume2,
  VolumeX,
  Sparkles,
  AlertCircle,
  Radio,
  Clock,
} from "lucide-react";
import { ChatProfile, PrivateCall, PrivateCallSignal } from "../types";
import {
  doc,
  collection,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  db,
  toTimestampMs,
} from "../supabase-adapter";
import {
  playIncomingRingtone,
  stopIncomingRingtone,
  playOutgoingRing,
  stopOutgoingRing,
  playCallEndSound,
  playCallConnectedSound,
  playMissedCallSound,
} from "../utils/callSounds";
import {
  sendOffAppNotification,
  requestNotificationPermission,
  isAppInForeground,
} from "../utils/callNotifications";

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
  ],
  iceCandidatePoolSize: 8,
};

interface PrivateCallManagerProps {
  profile: ChatProfile | null;
  onOpenChat?: () => void;
}

// Global hook/event listener to trigger calls from any component
export let initiatePrivateCallGlobal: (targetUser: {
  uid: string;
  username: string;
  photoURL: string;
}, callType?: "voice" | "video") => void = () => {};

export default function PrivateCallManager({
  profile,
  onOpenChat,
}: PrivateCallManagerProps) {
  // Call States
  const [activeCall, setActiveCall] = useState<PrivateCall | null>(null);
  const [callStatus, setCallStatus] = useState<
    "idle" | "calling" | "ringing" | "connected" | "unavailable" | "ended"
  >("idle");
  const [unavailableMessage, setUnavailableMessage] = useState<string | null>(null);
  const [missedCallNotice, setMissedCallNotice] = useState<{
    callerUsername: string;
    callerPhotoURL: string;
    timestamp: number;
  } | null>(null);

  // In-Call Controls
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [callingSecondsLeft, setCallingSecondsLeft] = useState(40);
  const [isLocalSpeaking, setIsLocalSpeaking] = useState(false);
  const [isRemoteSpeaking, setIsRemoteSpeaking] = useState(false);

  // Remote Stream and Media References
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioStreamRef = useRef<MediaStream | null>(null);
  const remoteVideoStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const vadAnimFrameRef = useRef<number | null>(null);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const timeoutTimerRef = useRef<any>(null);
  const durationTimerRef = useRef<any>(null);
  const activeCallRef = useRef<PrivateCall | null>(null);
  const profileRef = useRef<ChatProfile | null>(profile);
  const callUnsubRef = useRef<(() => void) | null>(null);
  const signalsUnsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  // Request notification permission once on initial profile load
  useEffect(() => {
    if (profile) {
      requestNotificationPermission();
    }
  }, [profile]);

  // Cleanup helper
  const cleanupMedia = useCallback(() => {
    stopIncomingRingtone();
    stopOutgoingRing();

    if (vadAnimFrameRef.current) {
      cancelAnimationFrame(vadAnimFrameRef.current);
      vadAnimFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setIsLocalSpeaking(false);
    setIsRemoteSpeaking(false);

    if (timeoutTimerRef.current) {
      clearInterval(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((t) => t.stop());
      remoteStreamRef.current = null;
    }
    if (remoteAudioStreamRef.current) {
      remoteAudioStreamRef.current.getTracks().forEach((t) => t.stop());
      remoteAudioStreamRef.current = null;
    }
    if (remoteVideoStreamRef.current) {
      remoteVideoStreamRef.current.getTracks().forEach((t) => t.stop());
      remoteVideoStreamRef.current = null;
    }

    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch (e) {}
      peerConnectionRef.current = null;
    }

    if (callUnsubRef.current) {
      callUnsubRef.current();
      callUnsubRef.current = null;
    }
    if (signalsUnsubRef.current) {
      signalsUnsubRef.current();
      signalsUnsubRef.current = null;
    }

    setIsScreenSharing(false);
  }, []);

  // Hangup / End Call
  const handleEndCall = useCallback(
    async (reason: "hangup" | "decline" | "timeout" = "hangup") => {
      const currentCall = activeCallRef.current;
      const myUid = profileRef.current?.uid;

      cleanupMedia();
      playMissedCallSound();

      if (currentCall && myUid) {
        const isCaller = currentCall.callerUid === myUid;
        const newStatus =
          reason === "timeout"
            ? "timeout"
            : reason === "decline"
            ? "declined"
            : currentCall.status === "ringing"
            ? "missed"
            : "ended";

        try {
          await updateDoc(doc(db, "private_calls", currentCall.id), {
            status: newStatus,
            endedAt: Date.now(),
          });
        } catch (e) {}
      }

      setCallStatus("idle");
      setActiveCall(null);
      setCallDuration(0);
    },
    [cleanupMedia]
  );

  // Initialize WebRTC Peer Connection
  const setupWebRTC = useCallback(
    async (call: PrivateCall, isInitiator: boolean) => {
      try {
        // High-fidelity microphone constraints with aggressive echo cancellation
        const constraints: MediaStreamConstraints = {
          audio: {
            echoCancellation: { ideal: true },
            noiseSuppression: { ideal: true },
            autoGainControl: { ideal: true },
            sampleRate: 48000,
            googEchoCancellation: { ideal: true },
            googAutoGainControl: { ideal: true },
            googNoiseSuppression: { ideal: true },
            googHighpassFilter: { ideal: true },
          } as any,
          video:
            call.callType === "video"
              ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
              : false,
        };

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (mediaErr) {
          console.warn("Could not get video/audio with ideal constraints, falling back to basic audio:", mediaErr);
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          });
        }

        localStreamRef.current = stream;
        if (localVideoRef.current && call.callType === "video") {
          localVideoRef.current.srcObject = stream;
        }

        const pc = new RTCPeerConnection(RTC_CONFIG);
        peerConnectionRef.current = pc;

        // Add local tracks to peer connection
        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream);
        });

        // Dedicated separate remote streams for audio and video to prevent echo
        const remoteAudioStream = new MediaStream();
        const remoteVideoStream = new MediaStream();
        remoteAudioStreamRef.current = remoteAudioStream;
        remoteVideoStreamRef.current = remoteVideoStream;

        pc.ontrack = (event) => {
          if (event.track.kind === "audio") {
            remoteAudioStream.addTrack(event.track);
            if (remoteAudioRef.current) {
              remoteAudioRef.current.srcObject = remoteAudioStream;
              remoteAudioRef.current.play().catch(() => {});
            }
          } else if (event.track.kind === "video") {
            remoteVideoStream.addTrack(event.track);
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = remoteVideoStream;
              remoteVideoRef.current.play().catch(() => {});
            }
          }
        };

        // Real-time speech activity detection for Discord speaking green rings
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          const ctx = new AudioContextClass();
          audioContextRef.current = ctx;

          const localSource = ctx.createMediaStreamSource(stream);
          const localAnalyser = ctx.createAnalyser();
          localAnalyser.fftSize = 256;
          localSource.connect(localAnalyser);

          const remoteSource = ctx.createMediaStreamSource(remoteAudioStream);
          const remoteAnalyser = ctx.createAnalyser();
          remoteAnalyser.fftSize = 256;
          remoteSource.connect(remoteAnalyser);

          const localData = new Uint8Array(localAnalyser.frequencyBinCount);
          const remoteData = new Uint8Array(remoteAnalyser.frequencyBinCount);

          const checkVAD = () => {
            localAnalyser.getByteFrequencyData(localData);
            let localSum = 0;
            for (let i = 0; i < localData.length; i++) localSum += localData[i];
            const localAvg = localSum / localData.length;
            setIsLocalSpeaking(localAvg > 16);

            remoteAnalyser.getByteFrequencyData(remoteData);
            let remoteSum = 0;
            for (let i = 0; i < remoteData.length; i++) remoteSum += remoteData[i];
            const remoteAvg = remoteSum / remoteData.length;
            setIsRemoteSpeaking(remoteAvg > 16);

            vadAnimFrameRef.current = requestAnimationFrame(checkVAD);
          };
          vadAnimFrameRef.current = requestAnimationFrame(checkVAD);
        } catch (vadErr) {}

        // ICE candidate exchange
        pc.onicecandidate = (event) => {
          if (event.candidate && profileRef.current) {
            const candidateSignal: PrivateCallSignal = {
              id: "cand_" + Math.random().toString(36).substring(2, 9),
              callId: call.id,
              fromUid: profileRef.current.uid,
              toUid: isInitiator ? call.calleeUid : call.callerUid,
              type: "candidate",
              payload: JSON.stringify(event.candidate),
              timestamp: Date.now(),
            };
            setDoc(doc(db, "private_call_signals", candidateSignal.id), candidateSignal).catch(() => {});
          }
        };

        // Listen for signaling messages (Offer, Answer, Candidates)
        const signalsQuery = collection(db, "private_call_signals");
        const processedSignals = new Set<string>();

        const unsubSignals = onSnapshot(signalsQuery, async (snapshot) => {
          if (!profileRef.current) return;
          const myUid = profileRef.current.uid;

          for (const docSnap of snapshot.docs) {
            const sig = docSnap.data() as PrivateCallSignal;
            if (!sig || sig.callId !== call.id || sig.toUid !== myUid || processedSignals.has(sig.id)) {
              continue;
            }
            processedSignals.add(sig.id);

            try {
              if (sig.type === "offer" && !isInitiator) {
                const offer = JSON.parse(sig.payload);
                await pc.setRemoteDescription(new RTCSessionDescription(offer));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);

                const answerSignal: PrivateCallSignal = {
                  id: "ans_" + Math.random().toString(36).substring(2, 9),
                  callId: call.id,
                  fromUid: myUid,
                  toUid: call.callerUid,
                  type: "answer",
                  payload: JSON.stringify(answer),
                  timestamp: Date.now(),
                };
                await setDoc(doc(db, "private_call_signals", answerSignal.id), answerSignal);
              } else if (sig.type === "answer" && isInitiator) {
                const answer = JSON.parse(sig.payload);
                if (pc.signalingState !== "stable") {
                  await pc.setRemoteDescription(new RTCSessionDescription(answer));
                }
              } else if (sig.type === "candidate") {
                const candidate = JSON.parse(sig.payload);
                if (candidate) {
                  await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
                }
              }
            } catch (err) {
              console.warn("Error handling WebRTC signal:", err);
            }
          }
        });

        signalsUnsubRef.current = unsubSignals;

        // If Initiator, create & send Offer
        if (isInitiator && profileRef.current) {
          const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
          });
          await pc.setLocalDescription(offer);

          const offerSignal: PrivateCallSignal = {
            id: "off_" + Math.random().toString(36).substring(2, 9),
            callId: call.id,
            fromUid: profileRef.current.uid,
            toUid: call.calleeUid,
            type: "offer",
            payload: JSON.stringify(offer),
            timestamp: Date.now(),
          };
          await setDoc(doc(db, "private_call_signals", offerSignal.id), offerSignal);
        }
      } catch (err) {
        console.error("WebRTC setup error:", err);
      }
    },
    []
  );

  // Initiate an Outgoing Call
  const initiateCall = useCallback(
    async (
      targetUser: { uid: string; username: string; photoURL: string },
      callType: "voice" | "video" = "video"
    ) => {
      if (!profile) return;
      if (profile.uid === targetUser.uid) return;

      cleanupMedia();

      const callId = `call_${profile.uid}_${targetUser.uid}_${Date.now()}`;
      const newCall: PrivateCall = {
        id: callId,
        callerUid: profile.uid,
        callerUsername: profile.username,
        callerPhotoURL: profile.photoURL,
        calleeUid: targetUser.uid,
        calleeUsername: targetUser.username,
        calleePhotoURL: targetUser.photoURL,
        status: "ringing",
        callType,
        createdAt: Date.now(),
      };

      setActiveCall(newCall);
      setCallStatus("calling");
      setCallingSecondsLeft(40);
      setIsVideoOn(callType === "video");
      setIsMuted(false);
      playOutgoingRing();

      // Write call document to database
      await setDoc(doc(db, "private_calls", callId), newCall);

      // Start 40-second timeout countdown
      let secondsLeft = 40;
      if (timeoutTimerRef.current) clearInterval(timeoutTimerRef.current);
      timeoutTimerRef.current = setInterval(() => {
        secondsLeft -= 1;
        setCallingSecondsLeft(secondsLeft);

        if (secondsLeft <= 0) {
          clearInterval(timeoutTimerRef.current);
          timeoutTimerRef.current = null;

          // 40 seconds expired -> auto hangup
          stopOutgoingRing();
          playMissedCallSound();

          updateDoc(doc(db, "private_calls", callId), {
            status: "timeout",
            endedAt: Date.now(),
          }).catch(() => {});

          setUnavailableMessage(`${targetUser.username} is not available`);
          setCallStatus("unavailable");

          setTimeout(() => {
            setUnavailableMessage(null);
            setCallStatus("idle");
            setActiveCall(null);
          }, 4500);
        }
      }, 1000);

      // Listen for call status changes (accepted, declined, timeout)
      const unsub = onSnapshot(collection(db, "private_calls"), (snapshot: any) => {
        const docSnap = snapshot.docs.find((d: any) => d.id === callId);
        if (!docSnap) return;

        const updatedCall = docSnap.data() as PrivateCall;
        if (updatedCall.status === "accepted") {
          stopOutgoingRing();
          if (timeoutTimerRef.current) {
            clearInterval(timeoutTimerRef.current);
            timeoutTimerRef.current = null;
          }
          playCallConnectedSound();
          setCallStatus("connected");
          setActiveCall(updatedCall);

          // Start duration timer
          const startTs = Date.now();
          if (durationTimerRef.current) clearInterval(durationTimerRef.current);
          durationTimerRef.current = setInterval(() => {
            setCallDuration(Math.floor((Date.now() - startTs) / 1000));
          }, 1000);

          // Connect WebRTC as initiator
          setupWebRTC(updatedCall, true);
        } else if (
          updatedCall.status === "declined" ||
          updatedCall.status === "timeout" ||
          updatedCall.status === "missed"
        ) {
          stopOutgoingRing();
          if (timeoutTimerRef.current) {
            clearInterval(timeoutTimerRef.current);
            timeoutTimerRef.current = null;
          }
          playMissedCallSound();
          setUnavailableMessage(`${targetUser.username} is not available`);
          setCallStatus("unavailable");

          setTimeout(() => {
            setUnavailableMessage(null);
            setCallStatus("idle");
            setActiveCall(null);
          }, 4000);
        } else if (updatedCall.status === "ended") {
          handleEndCall("hangup");
        }
      });

      callUnsubRef.current = unsub;
    },
    [profile, cleanupMedia, setupWebRTC, handleEndCall]
  );

  // Register global call initiator
  useEffect(() => {
    initiatePrivateCallGlobal = initiateCall;
  }, [initiateCall]);

  // Answer Incoming Call
  const handleAnswerCall = useCallback(
    async (call: PrivateCall) => {
      stopIncomingRingtone();
      playCallConnectedSound();

      await updateDoc(doc(db, "private_calls", call.id), {
        status: "accepted",
        acceptedAt: Date.now(),
      });

      setCallStatus("connected");
      setActiveCall({ ...call, status: "accepted" });

      // Start duration timer
      const startTs = Date.now();
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
      durationTimerRef.current = setInterval(() => {
        setCallDuration(Math.floor((Date.now() - startTs) / 1000));
      }, 1000);

      // Connect WebRTC as receiver
      setupWebRTC(call, false);
    },
    [setupWebRTC]
  );

  // Global incoming call listener
  useEffect(() => {
    if (!profile?.uid) return;
    const myUid = profile.uid;

    const unsub = onSnapshot(collection(db, "private_calls"), (snapshot: any) => {
      const now = Date.now();

      snapshot.docs.forEach((docSnap: any) => {
        const call = docSnap.data() as PrivateCall;
        if (!call || call.calleeUid !== myUid) return;

        // Ignore calls older than 60 seconds
        const callAge = now - toTimestampMs(call.createdAt);
        if (callAge > 60000) return;

        // 1. INCOMING CALL RINGING STATE
        if (call.status === "ringing") {
          // If we're not currently already in a call with someone else
          if (!activeCallRef.current || activeCallRef.current.id === call.id) {
            setActiveCall(call);
            setCallStatus("ringing");
            playIncomingRingtone();

            // Check if off-app / tab unfocused
            if (!isAppInForeground()) {
              sendOffAppNotification({
                title: `${call.callerUsername} is calling you!`,
                body: `Incoming ${call.callType} call. Click to answer.`,
                icon: call.callerPhotoURL,
                tag: `call-${call.id}`,
                onAnswer: () => {
                  handleAnswerCall(call);
                },
                onDecline: () => {
                  handleEndCall("decline");
                },
                onClick: () => {
                  onOpenChat?.();
                },
              });
            }
          }
        }

        // 2. CALL MISSED OR TIMEOUT WHILE RINGING (no answer)
        else if (
          (call.status === "timeout" || call.status === "missed") &&
          activeCallRef.current?.id === call.id &&
          callStatus === "ringing"
        ) {
          stopIncomingRingtone();
          playMissedCallSound();
          setCallStatus("idle");
          setActiveCall(null);

          // Show in-app missed call notice
          setMissedCallNotice({
            callerUsername: call.callerUsername,
            callerPhotoURL: call.callerPhotoURL,
            timestamp: Date.now(),
          });

          // Show off-app notification for missed call if tab is hidden
          if (!isAppInForeground()) {
            sendOffAppNotification({
              title: "Missed Call",
              body: `missed call from ${call.callerUsername}`,
              icon: call.callerPhotoURL,
              tag: `missed-${call.id}`,
              onClick: () => {
                onOpenChat?.();
              },
            });
          }

          setTimeout(() => {
            setMissedCallNotice(null);
          }, 5000);
        }

        // 3. CALL ENDED BY CALLER
        else if (call.status === "ended" && activeCallRef.current?.id === call.id) {
          handleEndCall("hangup");
        }
      });
    });

    return () => {
      unsub();
    };
  }, [profile?.uid, callStatus, handleAnswerCall, handleEndCall, onOpenChat]);

  // Toggle Microphone
  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  // Toggle Camera Video
  const toggleVideo = async () => {
    if (!localStreamRef.current) return;
    const videoTrack = localStreamRef.current.getVideoTracks()[0];

    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setIsVideoOn(videoTrack.enabled);
    } else if (!isVideoOn && peerConnectionRef.current) {
      try {
        const vStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720 },
        });
        const newTrack = vStream.getVideoTracks()[0];
        localStreamRef.current.addTrack(newTrack);
        peerConnectionRef.current.addTrack(newTrack, localStreamRef.current);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
        }
        setIsVideoOn(true);
      } catch (e) {
        console.warn("Could not start video camera:", e);
      }
    }
  };

  // Toggle Screen Share
  const toggleScreenShare = async () => {
    if (!peerConnectionRef.current || !localStreamRef.current) return;

    if (isScreenSharing) {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }
      setIsScreenSharing(false);
    } else {
      try {
        const sStream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30 } },
          audio: true,
        });
        screenStreamRef.current = sStream;

        const screenTrack = sStream.getVideoTracks()[0];
        const senders = peerConnectionRef.current.getSenders();
        const videoSender = senders.find((s) => s.track?.kind === "video");

        if (videoSender) {
          videoSender.replaceTrack(screenTrack);
        }

        screenTrack.onended = () => {
          setIsScreenSharing(false);
          if (localStreamRef.current) {
            const originalVideo = localStreamRef.current.getVideoTracks()[0];
            if (videoSender && originalVideo) {
              videoSender.replaceTrack(originalVideo);
            }
          }
        };

        setIsScreenSharing(true);
      } catch (e) {
        console.warn("Screen share cancelled or failed:", e);
      }
    }
  };

  // Format Duration string
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
  };

  return (
    <>
      {/* Hidden Audio element for remote participant speech */}
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      {/* 1. INCOMING CALL NOTIFICATION BANNER / CARD */}
      {callStatus === "ringing" && activeCall && profile && activeCall.calleeUid === profile.uid && (
        <div className="fixed top-6 right-6 z-[9999] w-[360px] max-w-[calc(100vw-32px)] bg-neutral-950/95 border border-emerald-500/50 rounded-2xl p-4 shadow-2xl backdrop-blur-2xl animate-in slide-in-from-top-4 fade-in duration-200">
          <div className="flex items-center gap-3.5 mb-3">
            <div className="relative flex-shrink-0">
              <div className="w-12 h-12 rounded-full overflow-hidden bg-neutral-800 border-2 border-emerald-500 animate-pulse shadow-lg shadow-emerald-500/20">
                <img
                  src={activeCall.callerPhotoURL}
                  alt={activeCall.callerUsername}
                  className="w-full h-full object-cover"
                />
              </div>
              <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-black flex items-center justify-center">
                <PhoneIncoming size={9} className="text-black animate-bounce" />
              </span>
            </div>

            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-bold text-white truncate">
                {activeCall.callerUsername} is calling you!
              </h4>
              <p className="text-xs text-neutral-400 flex items-center gap-1.5 mt-0.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span>Incoming {activeCall.callType} call...</span>
              </p>
            </div>
          </div>

          {/* 2 Buttons: Answer & Decline */}
          <div className="grid grid-cols-2 gap-2.5 mt-2">
            <button
              id="call-answer-btn"
              onClick={() => handleAnswerCall(activeCall)}
              className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-bold transition-all shadow-lg shadow-emerald-950/50 cursor-pointer"
            >
              <Phone size={15} />
              <span>Answer</span>
            </button>

            <button
              id="call-decline-btn"
              onClick={() => handleEndCall("decline")}
              className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-rose-600/90 hover:bg-rose-500 active:scale-95 text-white text-xs font-bold transition-all shadow-lg shadow-rose-950/50 cursor-pointer"
            >
              <PhoneOff size={15} />
              <span>Decline</span>
            </button>
          </div>
        </div>
      )}

      {/* 2. OUTGOING CALLING CARD (with 40s Countdown) */}
      {callStatus === "calling" && activeCall && (
        <div className="fixed top-6 right-6 z-[9999] w-[340px] max-w-[calc(100vw-32px)] bg-neutral-950/95 border border-neutral-800 rounded-2xl p-4 shadow-2xl backdrop-blur-2xl animate-in slide-in-from-top-4 fade-in duration-200">
          <div className="flex items-center gap-3.5 mb-3">
            <div className="relative flex-shrink-0">
              <div className="w-12 h-12 rounded-full overflow-hidden bg-neutral-800 border-2 border-neutral-700 shadow-md">
                <img
                  src={activeCall.calleePhotoURL}
                  alt={activeCall.calleeUsername}
                  className="w-full h-full object-cover"
                />
              </div>
              <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-cyan-500 border-2 border-black flex items-center justify-center">
                <PhoneOutgoing size={9} className="text-black" />
              </span>
            </div>

            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-bold text-white truncate">
                Calling {activeCall.calleeUsername}...
              </h4>
              <p className="text-xs text-neutral-400 flex items-center gap-1.5 mt-0.5">
                <Clock size={11} className="text-neutral-500" />
                <span>Ringing ({callingSecondsLeft}s left)</span>
              </p>
            </div>
          </div>

          {/* Progress Bar of 40s timeout */}
          <div className="w-full bg-neutral-900 rounded-full h-1.5 overflow-hidden mb-3">
            <div
              className="bg-neutral-400 h-full transition-all duration-1000 ease-linear rounded-full"
              style={{ width: `${(callingSecondsLeft / 40) * 100}%` }}
            />
          </div>

          <button
            id="call-cancel-btn"
            onClick={() => handleEndCall("hangup")}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-rose-600/80 hover:bg-rose-500 text-white text-xs font-bold transition-all cursor-pointer"
          >
            <PhoneOff size={14} />
            <span>Cancel Call</span>
          </button>
        </div>
      )}

      {/* 3. "[USERNAME] IS NOT AVAILABLE" NOTIFICATION MODAL */}
      {callStatus === "unavailable" && unavailableMessage && (
        <div className="fixed top-6 right-6 z-[9999] w-[320px] max-w-[calc(100vw-32px)] bg-neutral-950 border border-neutral-800 rounded-2xl p-4 shadow-2xl backdrop-blur-2xl animate-in slide-in-from-top-4 fade-in duration-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-400 flex-shrink-0">
              <PhoneOff size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-bold text-white">Call Ended</h4>
              <p className="text-xs text-neutral-400 mt-0.5 font-medium">
                {unavailableMessage}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 4. MISSED CALL NOTIFICATION TOAST */}
      {missedCallNotice && (
        <div className="fixed top-6 right-6 z-[9999] w-[340px] max-w-[calc(100vw-32px)] bg-neutral-950 border border-neutral-800 rounded-2xl p-4 shadow-2xl backdrop-blur-2xl animate-in slide-in-from-top-4 fade-in duration-200">
          <div className="flex items-center gap-3">
            <div className="relative flex-shrink-0">
              <div className="w-10 h-10 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700">
                <img
                  src={missedCallNotice.callerPhotoURL}
                  alt={missedCallNotice.callerUsername}
                  className="w-full h-full object-cover"
                />
              </div>
              <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-rose-500 border-2 border-black flex items-center justify-center">
                <PhoneOff size={8} className="text-white" />
              </span>
            </div>

            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-bold text-white">Missed Call</h4>
              <p className="text-xs text-neutral-400 mt-0.5 truncate">
                missed call from {missedCallNotice.callerUsername}
              </p>
            </div>

            <button
              onClick={() => setMissedCallNotice(null)}
              className="text-neutral-500 hover:text-white p-1 rounded-md transition-colors"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      {/* 5. ACTIVE VOICE / VIDEO CALL SCREEN - MATCHES DISCORD GENERAL VOICE CHANNEL */}
      {callStatus === "connected" && activeCall && profile && (
        <div
          id="private-call-modal"
          className={`fixed z-[9999] transition-all duration-200 ${
            isFullscreen
              ? "inset-0 bg-[#0c0d0e] flex flex-col"
              : isMinimized
              ? "bottom-6 right-6 w-80 h-52 bg-[#111214] border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
              : "inset-4 md:inset-10 lg:inset-16 bg-[#111214] border border-neutral-800 rounded-3xl shadow-2xl backdrop-blur-3xl overflow-hidden flex flex-col"
          }`}
        >
          {/* Audio Output Element - Strictly dedicated for remote audio to prevent ANY echo */}
          <audio ref={remoteAudioRef} autoPlay playsInline />

          {/* Top Voice Header - Styled identically to General Voice */}
          <div className="px-5 py-3.5 bg-[#18191c] border-b border-neutral-800/90 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-emerald-400 font-bold text-xs uppercase tracking-wider hidden sm:inline">
                  Voice Connected
                </span>
                <span className="text-neutral-600 font-medium text-xs hidden sm:inline">/</span>
                <h3 className="text-xs font-bold text-white truncate">
                  Direct Voice &bull;{" "}
                  {activeCall.callerUid === profile.uid
                    ? activeCall.calleeUsername
                    : activeCall.callerUsername}
                </h3>
                <span className="text-[11px] text-neutral-400 font-mono px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800/80">
                  {formatTime(callDuration)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                id="voice-disconnect-header-btn"
                onClick={() => handleEndCall("hangup")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600/90 hover:bg-rose-500 text-white text-xs font-bold shadow transition-all cursor-pointer"
                title="Disconnect from voice call"
              >
                <PhoneOff size={13} />
                <span className="hidden sm:inline">Disconnect</span>
              </button>

              {!isFullscreen && (
                <button
                  onClick={() => setIsMinimized(!isMinimized)}
                  className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
                  title={isMinimized ? "Expand View" : "Minimize to Corner"}
                >
                  {isMinimized ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
                </button>
              )}

              {!isMinimized && (
                <button
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
                  title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                >
                  <Maximize2 size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Main Stage */}
          <div className="flex-1 bg-[#0f0f11] relative flex items-center justify-center p-4 overflow-hidden min-h-0">
            {/* If video or screen share is enabled, show the video layout */}
            {isVideoOn || isScreenSharing ? (
              <div className="w-full h-full relative flex items-center justify-center bg-black rounded-2xl overflow-hidden border border-neutral-800">
                {/* Remote video element - MUST BE MUTED to prevent echo loop with remoteAudioRef */}
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  muted={true}
                  className="w-full h-full object-contain"
                />

                {/* Remote User Pill in Video Mode */}
                <div className="absolute bottom-3 left-3 z-10 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl text-xs font-semibold text-white flex items-center gap-2 border border-white/10">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isRemoteSpeaking ? "bg-emerald-400 animate-pulse" : "bg-neutral-500"
                    }`}
                  />
                  <span>
                    {activeCall.callerUid === profile.uid
                      ? activeCall.calleeUsername
                      : activeCall.callerUsername}
                  </span>
                </div>

                {/* Local Camera Video Thumbnail (PiP) */}
                {!isMinimized && (
                  <div className="absolute bottom-4 right-4 w-44 h-32 bg-neutral-900/90 border border-neutral-700/80 rounded-2xl overflow-hidden shadow-2xl z-20">
                    <video
                      ref={localVideoRef}
                      autoPlay
                      playsInline
                      muted={true}
                      className="w-full h-full object-cover transform -scale-x-100"
                    />
                    {!isVideoOn && (
                      <div className="absolute inset-0 bg-neutral-950 flex flex-col items-center justify-center text-xs text-neutral-400 font-bold">
                        Camera Off
                      </div>
                    )}
                    <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur-md px-2 py-0.5 rounded-lg text-[10px] font-bold text-white flex items-center gap-1.5 border border-white/10">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isLocalSpeaking && !isMuted ? "bg-emerald-400 animate-pulse" : "bg-neutral-500"
                        }`}
                      />
                      <span>You {isMuted && "(Muted)"}</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* VOICE CALL STAGE - Matches Discord General Voice Tiles */
              <div className="w-full h-full max-w-4xl grid grid-cols-1 sm:grid-cols-2 gap-4 items-center justify-center">
                {/* Tile 1: Remote Participant */}
                <div className="h-full max-h-80 bg-[#1e1f22] border border-neutral-800 rounded-2xl flex flex-col items-center justify-center relative p-6 shadow-xl transition-all">
                  <div
                    className={`relative rounded-full p-1 transition-all duration-200 ${
                      isRemoteSpeaking
                        ? "ring-4 ring-emerald-500 shadow-lg shadow-emerald-500/20 scale-105"
                        : "ring-2 ring-neutral-800"
                    }`}
                  >
                    <div className="w-24 h-24 rounded-full overflow-hidden bg-neutral-900 border-2 border-neutral-800">
                      <img
                        src={
                          activeCall.callerUid === profile.uid
                            ? activeCall.calleePhotoURL
                            : activeCall.callerPhotoURL
                        }
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>

                  <h4 className="text-sm font-bold text-white mt-3 truncate max-w-[80%]">
                    {activeCall.callerUid === profile.uid
                      ? activeCall.calleeUsername
                      : activeCall.callerUsername}
                  </h4>

                  {/* Floating username label bottom-left */}
                  <div className="absolute bottom-3 left-3 bg-[#111214]/90 backdrop-blur-md px-2.5 py-1 rounded-lg text-xs font-semibold text-white flex items-center gap-1.5 border border-neutral-800">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isRemoteSpeaking ? "bg-emerald-400 animate-pulse" : "bg-neutral-500"
                      }`}
                    />
                    <span className="truncate max-w-[120px]">
                      {activeCall.callerUid === profile.uid
                        ? activeCall.calleeUsername
                        : activeCall.callerUsername}
                    </span>
                  </div>

                  {/* Status Indicator bottom-right */}
                  <div className="absolute bottom-3 right-3 w-7 h-7 rounded-full bg-[#111214]/90 border border-neutral-800 flex items-center justify-center text-neutral-300">
                    <Mic size={13} className={isRemoteSpeaking ? "text-emerald-400" : "text-neutral-400"} />
                  </div>
                </div>

                {/* Tile 2: Local User ("You") */}
                <div className="h-full max-h-80 bg-[#1e1f22] border border-neutral-800 rounded-2xl flex flex-col items-center justify-center relative p-6 shadow-xl transition-all">
                  <div
                    className={`relative rounded-full p-1 transition-all duration-200 ${
                      isLocalSpeaking && !isMuted
                        ? "ring-4 ring-emerald-500 shadow-lg shadow-emerald-500/20 scale-105"
                        : "ring-2 ring-neutral-800"
                    }`}
                  >
                    <div className="w-24 h-24 rounded-full overflow-hidden bg-neutral-900 border-2 border-neutral-800">
                      <img
                        src={profile.photoURL}
                        alt={profile.username}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>

                  <h4 className="text-sm font-bold text-white mt-3 truncate max-w-[80%]">
                    {profile.username} (You)
                  </h4>

                  {/* Floating username label bottom-left */}
                  <div className="absolute bottom-3 left-3 bg-[#111214]/90 backdrop-blur-md px-2.5 py-1 rounded-lg text-xs font-semibold text-white flex items-center gap-1.5 border border-neutral-800">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isLocalSpeaking && !isMuted ? "bg-emerald-400 animate-pulse" : "bg-neutral-500"
                      }`}
                    />
                    <span>You</span>
                  </div>

                  {/* Mute/Mic Indicator bottom-right */}
                  <div
                    className={`absolute bottom-3 right-3 w-7 h-7 rounded-full border flex items-center justify-center ${
                      isMuted
                        ? "bg-rose-500/20 border-rose-500/40 text-rose-400"
                        : "bg-[#111214]/90 border-neutral-800 text-neutral-300"
                    }`}
                  >
                    {isMuted ? (
                      <MicOff size={13} className="text-rose-400" />
                    ) : (
                      <Mic size={13} className={isLocalSpeaking ? "text-emerald-400" : "text-neutral-400"} />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Call Controls Bar - Styled after Discord Voice Control Deck */}
          <div className="p-3.5 bg-[#18191c] border-t border-neutral-800/90 flex items-center justify-center gap-3 flex-shrink-0">
            {/* Mic Mute Toggle */}
            <button
              id="voice-toggle-mic-btn"
              onClick={toggleMute}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl font-bold text-xs transition-all cursor-pointer ${
                isMuted
                  ? "bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-950/50"
                  : "bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white"
              }`}
              title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
            >
              {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
              <span className="hidden sm:inline">{isMuted ? "Unmute" : "Mute"}</span>
            </button>

            {/* Video Camera Toggle */}
            <button
              id="voice-toggle-camera-btn"
              onClick={toggleVideo}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl font-bold text-xs transition-all cursor-pointer ${
                isVideoOn
                  ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/50"
                  : "bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white"
              }`}
              title={isVideoOn ? "Turn Camera Off" : "Turn Camera On"}
            >
              {!isVideoOn ? <VideoOff size={16} /> : <Video size={16} />}
              <span className="hidden sm:inline">{isVideoOn ? "Camera On" : "Camera"}</span>
            </button>

            {/* Screen Share Toggle */}
            <button
              id="voice-toggle-screenshare-btn"
              onClick={toggleScreenShare}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl font-bold text-xs transition-all cursor-pointer ${
                isScreenSharing
                  ? "bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-950/50"
                  : "bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white"
              }`}
              title={isScreenSharing ? "Stop Screen Share" : "Share Screen"}
            >
              <MonitorUp size={16} />
              <span className="hidden sm:inline">{isScreenSharing ? "Sharing" : "Screen"}</span>
            </button>

            {/* End Call / Disconnect */}
            <button
              id="call-hangup-btn"
              onClick={() => handleEndCall("hangup")}
              className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-xl shadow-rose-950/60 transition-all cursor-pointer active:scale-95 ml-2"
              title="Disconnect"
            >
              <PhoneOff size={16} />
              <span>Disconnect</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
