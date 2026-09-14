import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { ChatProfile, DirectCallSession, CallStatus } from "../types";
import {
  db,
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  sendBroadcastSignal,
  subscribeBroadcastSignals,
} from "../supabase-adapter";
import { callAudio } from "../utils/callAudio";

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
  ],
};

export type CallUiState =
  | "idle"
  | "calling"
  | "ringing"
  | "connected"
  | "declined"
  | "ended"
  | "missed"
  | "cancelled";

interface CallContextType {
  activeCall: DirectCallSession | null;
  callState: CallUiState;
  callRole: "caller" | "receiver" | null;
  callDuration: number; // in seconds
  isMuted: boolean;
  isVideoOn: boolean;
  peerVideoOn: boolean;
  peerMuted: boolean;
  isScreenSharing: boolean;
  isPip: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  startCall: (target: { uid: string; username: string; photoURL: string }, isVideo?: boolean) => Promise<void>;
  startEchoCall: (isVideo?: boolean) => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  toggleVideo: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  setIsPip: (pip: boolean) => void;
  ringtoneVolume: number;
  setRingtoneVolume: (vol: number) => void;
  isTestingRingtone: boolean;
  testRingtone: () => void;
  stopTestRingtone: () => void;
}

const CallContext = createContext<CallContextType | null>(null);

export function useCall() {
  const context = useContext(CallContext);
  if (!context) {
    throw new Error("useCall must be used within a CallProvider");
  }
  return context;
}

export function CallProvider({
  children,
  profile,
}: {
  children: React.ReactNode;
  profile: ChatProfile | null;
}) {
  const [activeCall, setActiveCall] = useState<DirectCallSession | null>(null);
  const [callState, setCallState] = useState<CallUiState>("idle");
  const [callRole, setCallRole] = useState<"caller" | "receiver" | null>(null);
  const [callDuration, setCallDuration] = useState<number>(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [peerVideoOn, setPeerVideoOn] = useState(false);
  const [peerMuted, setPeerMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isPip, setIsPip] = useState(false);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const [ringtoneVolume, setRingtoneVolumeState] = useState(callAudio.getVolume());
  const [isTestingRingtone, setIsTestingRingtone] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const audioTransceiverRef = useRef<RTCRtpTransceiver | null>(null);
  const videoTransceiverRef = useRef<RTCRtpTransceiver | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const activeCallRef = useRef<DirectCallSession | null>(null);
  const callStateRef = useRef(callState);
  const durationIntervalRef = useRef<any>(null);
  const timeoutTimerRef = useRef<any>(null);
  const echoTimerRef = useRef<any>(null);
  const stopTestTimerRef = useRef<any>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const pendingOfferRef = useRef<{ sdp: string; callId: string; uid: string } | null>(null);

  // Screen audio and mixer nodes
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micGainRef = useRef<GainNode | null>(null);
  const screenAudioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const screenGainRef = useRef<GainNode | null>(null);
  const mixedDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const isMutedRef = useRef(isMuted);

  useEffect(() => {
    isMutedRef.current = isMuted;
    if (micGainRef.current) {
      micGainRef.current.gain.value = isMuted ? 0 : 1.0;
    }
  }, [isMuted]);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  // Robust media acquisition helper with multi-tier fallbacks
  const acquireMediaStream = useCallback(async (isVideo: boolean): Promise<MediaStream> => {
    if (typeof navigator !== "undefined" && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      // 1. Try requested audio + video
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: isVideo ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" } : false,
        });
        return stream;
      } catch (err1) {
        console.warn("[Media] Full constraint failed, attempting audio-only:", err1);
      }

      // 2. Try audio-only if video failed
      if (isVideo) {
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
            video: false,
          });
          return audioStream;
        } catch (err2) {
          console.warn("[Media] Audio-only fallback failed:", err2);
        }
      }

      // 3. Try standard basic audio constraint
      try {
        const basicAudio = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        return basicAudio;
      } catch (err3) {
        console.warn("[Media] Basic audio failed:", err3);
      }
    }

    // 4. Fallback: Generate synthetic silent audio stream to keep WebRTC pipeline unbroken
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const dst = ctx.createMediaStreamDestination();
        osc.connect(dst);
        osc.start();
        const track = dst.stream.getAudioTracks()[0];
        if (track) track.enabled = false;
        return dst.stream;
      }
    } catch (e) {
      console.warn("[Media] Synthetic audio stream fallback error:", e);
    }

    return new MediaStream();
  }, []);

  // Clean up streams on unmount
  const stopLocalMedia = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => {
        try { t.stop(); } catch (e) {}
      });
      localStreamRef.current = null;
      setLocalStream(null);
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((t) => {
        try { t.stop(); } catch (e) {}
      });
      remoteStreamRef.current = null;
      setRemoteStream(null);
    }
  }, []);

  const cleanupPeerConnection = useCallback(() => {
    if (pcRef.current) {
      try {
        pcRef.current.onicecandidate = null;
        pcRef.current.ontrack = null;
        pcRef.current.close();
      } catch (e) {}
      pcRef.current = null;
    }
    audioTransceiverRef.current = null;
    videoTransceiverRef.current = null;
    pendingIceCandidatesRef.current = [];
    pendingOfferRef.current = null;
  }, []);

  const resetCallState = useCallback(() => {
    callAudio.stopRingtone();
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
    if (echoTimerRef.current) {
      clearTimeout(echoTimerRef.current);
      echoTimerRef.current = null;
    }
    stopLocalMedia();
    cleanupPeerConnection();

    if (screenAudioSourceRef.current) {
      try {
        screenAudioSourceRef.current.disconnect();
      } catch (e) {}
      screenAudioSourceRef.current = null;
    }
    if (screenGainRef.current) {
      try {
        screenGainRef.current.disconnect();
      } catch (e) {}
      screenGainRef.current = null;
    }
    if (micSourceRef.current) {
      try {
        micSourceRef.current.disconnect();
      } catch (e) {}
      micSourceRef.current = null;
    }
    if (micGainRef.current) {
      try {
        micGainRef.current.disconnect();
      } catch (e) {}
      micGainRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      try {
        audioCtxRef.current.close();
      } catch (e) {}
      audioCtxRef.current = null;
    }
    mixedDestRef.current = null;

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch (e) {}
      });
      screenStreamRef.current = null;
    }

    setActiveCall(null);
    setCallState("idle");
    setCallRole(null);
    setCallDuration(0);
    setIsMuted(false);
    setIsVideoOn(false);
    setPeerVideoOn(false);
    setPeerMuted(false);
    setIsScreenSharing(false);
    setIsPip(false);
  }, [stopLocalMedia, cleanupPeerConnection]);

  const setRingtoneVolume = useCallback((vol: number) => {
    setRingtoneVolumeState(vol);
    callAudio.setVolume(vol);
  }, []);

  const testRingtone = useCallback(() => {
    if (isTestingRingtone) {
      stopTestRingtone();
      return;
    }
    setIsTestingRingtone(true);
    callAudio.startRingtone().then(() => {
      if (stopTestTimerRef.current) clearTimeout(stopTestTimerRef.current);
      stopTestTimerRef.current = setTimeout(() => {
        callAudio.stopRingtone();
        setIsTestingRingtone(false);
      }, 7000);
    });
  }, [isTestingRingtone]);

  const stopTestRingtone = useCallback(() => {
    if (stopTestTimerRef.current) clearTimeout(stopTestTimerRef.current);
    callAudio.stopRingtone();
    setIsTestingRingtone(false);
  }, []);

  // WebRTC track setup helper
  const setupPeerConnection = useCallback(
    async (stream: MediaStream, isInitiator: boolean, callId: string, peerUid: string) => {
      cleanupPeerConnection();

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      // Add transceivers upfront so both audio and video m-lines are negotiated in SDP
      try {
        const audioTrans = pc.addTransceiver("audio", { direction: "sendrecv" });
        audioTransceiverRef.current = audioTrans;
      } catch (e) {
        console.warn("[WebRTC] audio transceiver error:", e);
      }

      try {
        const videoTrans = pc.addTransceiver("video", { direction: "sendrecv" });
        videoTransceiverRef.current = videoTrans;
      } catch (e) {
        console.warn("[WebRTC] video transceiver error:", e);
      }

      // Attach initial local audio track
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack && audioTransceiverRef.current?.sender) {
        try {
          await audioTransceiverRef.current.sender.replaceTrack(audioTrack);
        } catch (e) {
          try { pc.addTrack(audioTrack, stream); } catch (e2) {}
        }
      }

      // Attach initial local video track if present
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && videoTransceiverRef.current?.sender) {
        try {
          await videoTransceiverRef.current.sender.replaceTrack(videoTrack);
        } catch (e) {
          try { pc.addTrack(videoTrack, stream); } catch (e2) {}
        }
      }

      // Handle incoming remote tracks (audio and/or video)
      pc.ontrack = (event) => {
        console.log("[WebRTC] ontrack received:", event.track.kind, event.track.id);
        let curr = remoteStreamRef.current;
        if (!curr) {
          curr = new MediaStream();
          remoteStreamRef.current = curr;
        }

        // Replace existing track of same kind if present
        curr.getTracks().filter((t) => t.kind === event.track.kind).forEach((t) => {
          try { curr?.removeTrack(t); } catch (e) {}
        });
        curr.addTrack(event.track);

        if (event.track.kind === "video") {
          setPeerVideoOn(true);
        }

        const freshStream = new MediaStream(curr.getTracks());
        setRemoteStream(freshStream);

        event.track.onmute = () => {
          if (event.track.kind === "video") {
            setPeerVideoOn(false);
          }
          if (remoteStreamRef.current) {
            setRemoteStream(new MediaStream(remoteStreamRef.current.getTracks()));
          }
        };

        event.track.onunmute = () => {
          if (event.track.kind === "video") {
            setPeerVideoOn(true);
          }
          if (remoteStreamRef.current) {
            setRemoteStream(new MediaStream(remoteStreamRef.current.getTracks()));
          }
        };

        event.track.onended = () => {
          if (event.track.kind === "video") {
            setPeerVideoOn(false);
          }
          if (remoteStreamRef.current) {
            setRemoteStream(new MediaStream(remoteStreamRef.current.getTracks()));
          }
        };
      };

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && profile) {
          sendBroadcastSignal({
            id: `ice_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            callId,
            type: "call_webrtc_candidate",
            uid: profile.uid,
            targetUid: peerUid,
            candidate: event.candidate.toJSON(),
            timestamp: Date.now(),
          });
        }
      };

      // Handle ICE connection state changes
      pc.oniceconnectionstatechange = () => {
        console.log("[WebRTC] ICE state:", pc.iceConnectionState);
        if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
          try {
            pc.restartIce();
          } catch (e) {}
        }
      };

      // If initiator, create offer
      if (isInitiator) {
        try {
          const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
          });
          await pc.setLocalDescription(offer);
          if (profile) {
            sendBroadcastSignal({
              id: `offer_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              callId,
              type: "call_webrtc_offer",
              uid: profile.uid,
              targetUid: peerUid,
              sdp: offer.sdp,
              timestamp: Date.now(),
            });
          }
        } catch (err) {
          console.warn("[WebRTC] Error creating offer:", err);
        }
      } else if (pendingOfferRef.current) {
        // If receiver had an offer queued before connection setup finished, drain it immediately
        const queued = pendingOfferRef.current;
        pendingOfferRef.current = null;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: queued.sdp }));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          if (profile) {
            sendBroadcastSignal({
              id: `ans_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              callId: queued.callId,
              type: "call_webrtc_answer",
              uid: profile.uid,
              targetUid: queued.uid,
              sdp: answer.sdp,
              timestamp: Date.now(),
            });
          }

          // Apply any buffered ICE candidates
          while (pendingIceCandidatesRef.current.length > 0) {
            const cand = pendingIceCandidatesRef.current.shift();
            if (cand) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(cand));
              } catch (e) {}
            }
          }
        } catch (e) {
          console.warn("[WebRTC] Error handling queued offer:", e);
        }
      }

      return pc;
    },
    [cleanupPeerConnection, profile]
  );

  // Start outgoing call
  const startCall = useCallback(
    async (target: { uid: string; username: string; photoURL: string }, isVideo = false) => {
      if (!profile) return;
      if (activeCallRef.current) return;

      const callId = `call_${profile.uid}_${target.uid}_${Date.now()}`;
      const session: DirectCallSession = {
        id: callId,
        callerUid: profile.uid,
        callerName: profile.username,
        callerPhoto: profile.photoURL,
        targetUid: target.uid,
        targetName: target.username,
        targetPhoto: target.photoURL,
        status: "ringing",
        isVideoCall: isVideo,
        createdAt: Date.now(),
      };

      setActiveCall(session);
      setCallRole("caller");
      setCallState("calling");
      setIsVideoOn(isVideo);

      // Start looping ringtone.mp3 for caller!
      await callAudio.startRingtone();

      // Write call document and broadcast invite
      try {
        await setDoc(doc(db, "calls", callId), session);
      } catch (e) {}

      sendBroadcastSignal({
        id: `invite_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        callId,
        type: "call_invite",
        uid: profile.uid,
        targetUid: target.uid,
        caller: {
          uid: profile.uid,
          username: profile.username,
          photoURL: profile.photoURL,
        },
        target: {
          uid: target.uid,
          username: target.username,
          photoURL: target.photoURL,
        },
        isVideo,
        timestamp: Date.now(),
      });

      // 35-second unanswered timeout
      if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = setTimeout(() => {
        if (callStateRef.current === "calling") {
          callAudio.playCallEnd();
          setCallState("missed");
          setTimeout(() => resetCallState(), 2500);
        }
      }, 35000);
    },
    [profile, resetCallState]
  );

  // Echo test bot call (allows testing calling and hearing the ringtone even when alone)
  const startEchoCall = useCallback(
    async (isVideo = false) => {
      if (!profile) return;
      if (activeCallRef.current) return;

      const callId = `call_echo_${profile.uid}_${Date.now()}`;
      const session: DirectCallSession = {
        id: callId,
        callerUid: profile.uid,
        callerName: profile.username,
        callerPhoto: profile.photoURL,
        targetUid: "echo_bot",
        targetName: "Frosted Echo Bot",
        targetPhoto: "https://api.dicebear.com/7.x/bottts/svg?seed=FrostedBot",
        status: "ringing",
        isVideoCall: isVideo,
        createdAt: Date.now(),
        isEchoTest: true,
      };

      setActiveCall(session);
      setCallRole("caller");
      setCallState("calling");
      setIsVideoOn(isVideo);

      // Start playing ringtone.mp3
      await callAudio.startRingtone();

      // After 2.5 seconds, Echo Bot answers the call
      echoTimerRef.current = setTimeout(async () => {
        callAudio.playCallConnected();
        setCallState("connected");

        // Acquire mic and camera
        try {
          const stream = await acquireMediaStream(isVideo);
          localStreamRef.current = stream;
          setLocalStream(stream);

          // For echo test, mirror stream to remote so user can preview their own audio/video
          remoteStreamRef.current = stream;
          setRemoteStream(stream);
        } catch (err) {
          console.warn("Could not acquire media devices for echo test:", err);
        }

        // Start call duration timer
        setCallDuration(0);
        durationIntervalRef.current = setInterval(() => {
          setCallDuration((prev) => prev + 1);
        }, 1000);
      }, 2500);
    },
    [profile, acquireMediaStream]
  );

  // Accept incoming call
  const acceptCall = useCallback(async () => {
    const call = activeCallRef.current;
    if (!call || !profile) return;

    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }

    // Instantly stop ringtone and switch to connected state
    callAudio.playCallConnected();
    setCallState("connected");
    setIsVideoOn(call.isVideoCall);

    try {
      await updateDoc(doc(db, "calls", call.id), {
        status: "accepted",
        acceptedAt: Date.now(),
      });
    } catch (e) {}

    // Send accept broadcast signal
    sendBroadcastSignal({
      id: `accept_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      callId: call.id,
      type: "call_accept",
      targetUid: call.callerUid,
      uid: profile.uid,
      timestamp: Date.now(),
    });

    // Acquire media with automatic fallback
    try {
      const stream = await acquireMediaStream(call.isVideoCall);
      localStreamRef.current = stream;
      setLocalStream(stream);

      // Set up peer connection as receiver (waits for offer or drains queued offer)
      await setupPeerConnection(stream, false, call.id, call.callerUid);
    } catch (err) {
      console.warn("Failed to get user media for call:", err);
    }

    // Start timer
    setCallDuration(0);
    durationIntervalRef.current = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
  }, [profile, acquireMediaStream, setupPeerConnection]);

  // Decline incoming call
  const declineCall = useCallback(async () => {
    const call = activeCallRef.current;
    if (!call || !profile) return;

    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }

    callAudio.playCallEnd();
    setCallState("declined");

    try {
      await updateDoc(doc(db, "calls", call.id), {
        status: "declined",
        endedAt: Date.now(),
      });
    } catch (e) {}

    sendBroadcastSignal({
      id: `decline_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      callId: call.id,
      type: "call_decline",
      targetUid: call.callerUid,
      uid: profile.uid,
      timestamp: Date.now(),
    });

    setTimeout(() => {
      resetCallState();
    }, 1500);
  }, [profile, resetCallState]);

  // End active call or cancel outgoing call
  const endCall = useCallback(async () => {
    const call = activeCallRef.current;
    callAudio.playCallEnd();
    setCallState("ended");

    if (call && profile) {
      const isCaller = call.callerUid === profile.uid;
      const peerUid = isCaller ? call.targetUid : call.callerUid;

      try {
        await updateDoc(doc(db, "calls", call.id), {
          status: callStateRef.current === "calling" ? "cancelled" : "ended",
          endedAt: Date.now(),
        });
      } catch (e) {}

      sendBroadcastSignal({
        id: `end_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        callId: call.id,
        type: callStateRef.current === "calling" ? "call_cancel" : "call_end",
        targetUid: peerUid,
        uid: profile.uid,
        timestamp: Date.now(),
      });
    }

    setTimeout(() => {
      resetCallState();
    }, 1200);
  }, [profile, resetCallState]);

  // Toggle microphone
  const toggleMute = useCallback(() => {
    const call = activeCallRef.current;
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);

    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach((t) => {
        t.enabled = !nextMuted;
      });
    }

    if (call && profile) {
      const isCaller = call.callerUid === profile.uid;
      const peerUid = isCaller ? call.targetUid : call.callerUid;
      sendBroadcastSignal({
        id: `sig_track_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        callId: call.id,
        type: "call_track_state",
        uid: profile.uid,
        targetUid: peerUid,
        isVideoOn,
        isMuted: nextMuted,
        timestamp: Date.now(),
      });
    }
  }, [isMuted, isVideoOn, profile]);

  // Toggle camera
  const toggleVideo = useCallback(async () => {
    const call = activeCallRef.current;
    const isCurrentlyOn = isVideoOn;

    if (isCurrentlyOn) {
      // Turn video off
      if (localStreamRef.current) {
        const vTracks = localStreamRef.current.getVideoTracks();
        vTracks.forEach((t) => {
          try {
            t.stop();
            localStreamRef.current?.removeTrack(t);
          } catch (e) {}
        });
        setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
      }

      if (videoTransceiverRef.current?.sender) {
        try {
          await videoTransceiverRef.current.sender.replaceTrack(null);
        } catch (e) {
          console.warn("[WebRTC] replaceTrack null error:", e);
        }
      }

      setIsVideoOn(false);

      if (call && profile) {
        const isCaller = call.callerUid === profile.uid;
        const peerUid = isCaller ? call.targetUid : call.callerUid;
        sendBroadcastSignal({
          id: `sig_track_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          callId: call.id,
          type: "call_track_state",
          uid: profile.uid,
          targetUid: peerUid,
          isVideoOn: false,
          isMuted,
          timestamp: Date.now(),
        });
      }
    } else {
      // Turn video on
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        });
        const newTrack = videoStream.getVideoTracks()[0];
        if (newTrack) {
          let curr = localStreamRef.current;
          if (!curr) {
            curr = new MediaStream();
            localStreamRef.current = curr;
          }
          curr.getVideoTracks().forEach((t) => curr?.removeTrack(t));
          curr.addTrack(newTrack);
          setLocalStream(new MediaStream(curr.getTracks()));

          if (videoTransceiverRef.current?.sender) {
            await videoTransceiverRef.current.sender.replaceTrack(newTrack);
          } else if (pcRef.current) {
            try {
              pcRef.current.addTrack(newTrack, curr);
            } catch (e) {}
          }

          setIsVideoOn(true);

          if (call && profile) {
            const isCaller = call.callerUid === profile.uid;
            const peerUid = isCaller ? call.targetUid : call.callerUid;
            sendBroadcastSignal({
              id: `sig_track_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              callId: call.id,
              type: "call_track_state",
              uid: profile.uid,
              targetUid: peerUid,
              isVideoOn: true,
              isMuted,
              timestamp: Date.now(),
            });
          }
        }
      } catch (err) {
        console.warn("Cannot enable camera:", err);
      }
    }
  }, [isVideoOn, isMuted, profile]);

  const stopScreenShare = useCallback(async () => {
    setIsScreenSharing(false);

    if (screenAudioSourceRef.current) {
      try {
        screenAudioSourceRef.current.disconnect();
      } catch (e) {}
      screenAudioSourceRef.current = null;
    }
    if (screenGainRef.current) {
      try {
        screenGainRef.current.disconnect();
      } catch (e) {}
      screenGainRef.current = null;
    }

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch (e) {}
      });
      screenStreamRef.current = null;
    }

    // Restore video track back to camera if enabled or null
    const camTrack = localStreamRef.current?.getVideoTracks()[0] || null;
    if (videoTransceiverRef.current?.sender) {
      try {
        await videoTransceiverRef.current.sender.replaceTrack(camTrack);
      } catch (e) {}
    }

    // Restore audio track back to direct mic stream or mixed mic
    const micTrack = localStreamRef.current?.getAudioTracks()[0] || null;
    if (micTrack && audioTransceiverRef.current?.sender) {
      try {
        await audioTransceiverRef.current.sender.replaceTrack(micTrack);
      } catch (e) {}
    }
  }, []);

  // Set up Web Audio mixing node for combining mic and screen audio
  const setupMixedAudio = useCallback((micTrack: MediaStreamTrack | null, screenAudioTrack: MediaStreamTrack | null) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }

      if (!mixedDestRef.current) {
        mixedDestRef.current = ctx.createMediaStreamDestination();
      }

      if (micTrack) {
        if (micSourceRef.current) {
          try {
            micSourceRef.current.disconnect();
          } catch (e) {}
        }
        const micSource = ctx.createMediaStreamSource(new MediaStream([micTrack]));
        const micGain = ctx.createGain();
        micGain.gain.value = isMutedRef.current ? 0 : 1.0;
        micSource.connect(micGain);
        micGain.connect(mixedDestRef.current);
        micSourceRef.current = micSource;
        micGainRef.current = micGain;
      }

      if (screenAudioTrack) {
        if (screenAudioSourceRef.current) {
          try {
            screenAudioSourceRef.current.disconnect();
          } catch (e) {}
        }
        const screenSource = ctx.createMediaStreamSource(new MediaStream([screenAudioTrack]));
        const screenGain = ctx.createGain();
        screenGain.gain.value = 1.0;
        screenSource.connect(screenGain);
        screenGain.connect(mixedDestRef.current);
        screenAudioSourceRef.current = screenSource;
        screenGainRef.current = screenGain;
      }

      const mixedTrack = mixedDestRef.current.stream.getAudioTracks()[0];
      return mixedTrack || micTrack;
    } catch (err) {
      console.warn("[WebAudio] Mixer error, falling back to direct tracks:", err);
      return micTrack;
    }
  }, []);

  // Toggle screen share with high-fidelity system/tab audio capture and Web Audio mixing
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      await stopScreenShare();
      return;
    }

    try {
      let displayStream: MediaStream;
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: 30, max: 60 },
            width: { max: 1920 },
            height: { max: 1080 },
          },
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: { ideal: 2 },
            sampleRate: { ideal: 48000 },
            ...({
              suppressLocalAudioPlayback: false,
              systemAudio: "include",
              selfBrowserSurface: "exclude",
              surfaceSwitching: "include",
            } as any),
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

      screenStreamRef.current = displayStream;
      const screenVideoTrack = displayStream.getVideoTracks()[0];
      const screenAudioTracks = displayStream.getAudioTracks();

      if (screenVideoTrack) {
        if (videoTransceiverRef.current?.sender) {
          await videoTransceiverRef.current.sender.replaceTrack(screenVideoTrack);
        } else if (pcRef.current && localStreamRef.current) {
          pcRef.current.addTrack(screenVideoTrack, localStreamRef.current);
        }

        // Mix screen audio into the active WebRTC audio sender so the peer hears the screen audio
        const micTrack = localStreamRef.current?.getAudioTracks()[0] || null;
        if (screenAudioTracks.length > 0 && micTrack) {
          const mixedTrack = setupMixedAudio(micTrack, screenAudioTracks[0]);
          if (mixedTrack && audioTransceiverRef.current?.sender) {
            await audioTransceiverRef.current.sender.replaceTrack(mixedTrack);
          }
        } else if (screenAudioTracks.length > 0 && audioTransceiverRef.current?.sender) {
          await audioTransceiverRef.current.sender.replaceTrack(screenAudioTracks[0]);
        }

        setIsScreenSharing(true);

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
      }
    } catch (err) {
      console.warn("Screen share cancelled or failed:", err);
    }
  }, [isScreenSharing, setupMixedAudio, stopScreenShare]);

  // Real-time signal subscriber for call invites, accepts, declines, cancels, ends, and WebRTC
  useEffect(() => {
    if (!profile) return;

    const unsubscribeSignals = subscribeBroadcastSignals(profile.uid, async (sig: any) => {
      if (!sig || !sig.type) return;

      // Track state update from remote peer (camera toggle, mic mute)
      if (sig.type === "call_track_state") {
        if (typeof sig.isVideoOn === "boolean") {
          setPeerVideoOn(sig.isVideoOn);
        }
        if (typeof sig.isMuted === "boolean") {
          setPeerMuted(sig.isMuted);
        }
      }

      // 1. Incoming Call Invite
      if (sig.type === "call_invite") {
        const targetUid = sig.targetUid || sig.target?.uid;
        const callerUid = sig.uid || sig.caller?.uid;

        if (targetUid === profile.uid && callerUid && callerUid !== profile.uid) {
          // If we are already in another call, ignore
          if (callStateRef.current !== "idle") {
            return;
          }

          const callerName = sig.caller?.username || sig.callerName || "User";
          const callerPhoto = sig.caller?.photoURL || sig.callerPhoto || "";

          const callSession: DirectCallSession = {
            id: sig.callId || `call_${callerUid}_${profile.uid}_${Date.now()}`,
            callerUid,
            callerName,
            callerPhoto,
            targetUid: profile.uid,
            targetName: profile.username,
            targetPhoto: profile.photoURL,
            status: "ringing",
            isVideoCall: !!sig.isVideo,
            createdAt: sig.timestamp || Date.now(),
          };

          setActiveCall(callSession);
          setCallRole("receiver");
          setCallState("ringing");

          // Start looping ringtone.mp3 for recipient
          callAudio.startRingtone();

          // 35s timeout if unhandled
          if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
          timeoutTimerRef.current = setTimeout(() => {
            if (callStateRef.current === "ringing") {
              callAudio.stopRingtone();
              setCallState("missed");
              setTimeout(() => resetCallState(), 2000);
            }
          }, 35000);
        }
      }

      // 2. Call Accepted by recipient
      if (sig.type === "call_accept") {
        const current = activeCallRef.current;
        if (current && current.id === sig.callId && callStateRef.current === "calling") {
          if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
          callAudio.playCallConnected();
          setCallState("connected");

          // Caller acquires media and sends WebRTC offer
          try {
            const stream = await acquireMediaStream(current.isVideoCall);
            localStreamRef.current = stream;
            setLocalStream(stream);

            await setupPeerConnection(stream, true, current.id, current.targetUid);
          } catch (err) {
            console.warn("Caller media capture failed:", err);
          }

          // Start timer
          setCallDuration(0);
          durationIntervalRef.current = setInterval(() => {
            setCallDuration((prev) => prev + 1);
          }, 1000);
        }
      }

      // 3. Call Declined by recipient
      if (sig.type === "call_decline") {
        const current = activeCallRef.current;
        if (current && current.id === sig.callId) {
          callAudio.playCallEnd();
          setCallState("declined");
          setTimeout(() => resetCallState(), 2500);
        }
      }

      // 4. Call Cancelled by caller before answer
      if (sig.type === "call_cancel") {
        const current = activeCallRef.current;
        if (current && current.id === sig.callId) {
          callAudio.stopRingtone();
          setCallState("cancelled");
          setTimeout(() => resetCallState(), 1500);
        }
      }

      // 5. Active Call Ended
      if (sig.type === "call_end") {
        const current = activeCallRef.current;
        if (current && current.id === sig.callId) {
          callAudio.playCallEnd();
          setCallState("ended");
          setTimeout(() => resetCallState(), 1200);
        }
      }

      // 6. WebRTC Offer
      if (sig.type === "call_webrtc_offer") {
        if (sig.sdp) {
          if (pcRef.current) {
            try {
              await pcRef.current.setRemoteDescription(
                new RTCSessionDescription({ type: "offer", sdp: sig.sdp })
              );
              const answer = await pcRef.current.createAnswer();
              await pcRef.current.setLocalDescription(answer);

              sendBroadcastSignal({
                id: `ans_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                callId: sig.callId,
                type: "call_webrtc_answer",
                uid: profile.uid,
                targetUid: sig.uid,
                sdp: answer.sdp,
                timestamp: Date.now(),
              });

              // Apply buffered ICE candidates
              while (pendingIceCandidatesRef.current.length > 0) {
                const cand = pendingIceCandidatesRef.current.shift();
                if (cand) {
                  try {
                    await pcRef.current.addIceCandidate(new RTCIceCandidate(cand));
                  } catch (e) {}
                }
              }
            } catch (e) {
              console.warn("[WebRTC] Error handling offer:", e);
            }
          } else {
            // Queue pending offer if receiver connection is still bootstrapping
            pendingOfferRef.current = { sdp: sig.sdp, callId: sig.callId, uid: sig.uid };
          }
        }
      }

      // 7. WebRTC Answer
      if (sig.type === "call_webrtc_answer") {
        if (pcRef.current && sig.sdp) {
          try {
            if (pcRef.current.signalingState === "have-local-offer") {
              await pcRef.current.setRemoteDescription(
                new RTCSessionDescription({ type: "answer", sdp: sig.sdp })
              );

              // Apply buffered ICE candidates
              while (pendingIceCandidatesRef.current.length > 0) {
                const cand = pendingIceCandidatesRef.current.shift();
                if (cand) {
                  try {
                    await pcRef.current.addIceCandidate(new RTCIceCandidate(cand));
                  } catch (e) {}
                }
              }
            }
          } catch (e) {
            console.warn("[WebRTC] Error handling answer:", e);
          }
        }
      }

      // 8. WebRTC Candidate
      if (sig.type === "call_webrtc_candidate") {
        if (sig.candidate) {
          if (pcRef.current && pcRef.current.remoteDescription && pcRef.current.remoteDescription.type) {
            try {
              await pcRef.current.addIceCandidate(new RTCIceCandidate(sig.candidate));
            } catch (e) {
              console.warn("[WebRTC] Error adding ICE candidate:", e);
            }
          } else {
            pendingIceCandidatesRef.current.push(sig.candidate);
          }
        }
      }
    });

    // Also listen to database 'calls' collection snapshot for redundancy
    const qCalls = query(
      collection(db, "calls"),
      where("targetUid", "==", profile.uid)
    );

    const unsubCalls = onSnapshot(qCalls, (snapshot) => {
      snapshot.forEach((callDoc: any) => {
        const data = callDoc.data() as DirectCallSession;
        if (!data) return;

        // Fallback: Detect incoming ringing call
        if (
          data.status === "ringing" &&
          data.callerUid !== profile.uid &&
          callStateRef.current === "idle" &&
          (data.createdAt || 0) > Date.now() - 35000
        ) {
          const callSession: DirectCallSession = {
            id: data.id || callDoc.id,
            callerUid: data.callerUid,
            callerName: data.callerName || "User",
            callerPhoto: data.callerPhoto || "",
            targetUid: profile.uid,
            targetName: profile.username,
            targetPhoto: profile.photoURL,
            status: "ringing",
            isVideoCall: !!data.isVideoCall,
            createdAt: data.createdAt || Date.now(),
          };

          setActiveCall(callSession);
          setCallRole("receiver");
          setCallState("ringing");
          callAudio.startRingtone();
        }

        // Clean up stale or ended calls
        if (data.status === "ended" || data.status === "declined" || data.status === "cancelled") {
          if (activeCallRef.current?.id === data.id && callStateRef.current !== "idle") {
            callAudio.stopRingtone();
            resetCallState();
          }
        }
      });
    });

    return () => {
      unsubscribeSignals();
      unsubCalls();
    };
  }, [profile, setupPeerConnection, resetCallState]);

  return (
    <CallContext.Provider
      value={{
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
        startCall,
        startEchoCall,
        acceptCall,
        declineCall,
        endCall,
        toggleMute,
        toggleVideo,
        toggleScreenShare,
        setIsPip,
        ringtoneVolume,
        setRingtoneVolume,
        isTestingRingtone,
        testRingtone,
        stopTestRingtone,
      }}
    >
      {children}
      {/* Persistent global audio element for remote WebRTC audio */}
      <audio
        id="persistent-direct-call-audio"
        ref={(el) => {
          if (el && remoteStream && callState === "connected") {
            if (el.srcObject !== remoteStream) {
              el.srcObject = remoteStream;
            }
            el.volume = 1.0;
            el.muted = false;
            el.play().catch((err) => {
              console.warn("[CallAudio] Autoplay interaction required:", err);
            });
          } else if (el && callState !== "connected") {
            el.srcObject = null;
          }
        }}
        autoPlay
        playsInline
      />
    </CallContext.Provider>
  );
}
