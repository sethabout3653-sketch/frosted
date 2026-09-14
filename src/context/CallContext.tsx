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
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isPip, setIsPip] = useState(false);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const [ringtoneVolume, setRingtoneVolumeState] = useState(callAudio.getVolume());
  const [isTestingRingtone, setIsTestingRingtone] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const activeCallRef = useRef<DirectCallSession | null>(null);
  const callStateRef = useRef(callState);
  const durationIntervalRef = useRef<any>(null);
  const timeoutTimerRef = useRef<any>(null);
  const echoTimerRef = useRef<any>(null);
  const stopTestTimerRef = useRef<any>(null);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

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

    setActiveCall(null);
    setCallState("idle");
    setCallRole(null);
    setCallDuration(0);
    setIsMuted(false);
    setIsVideoOn(false);
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

      // Add local tracks
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // Handle incoming remote track
      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          remoteStreamRef.current = event.streams[0];
          setRemoteStream(event.streams[0]);
        }
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
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
            video: isVideo,
          });
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
    [profile]
  );

  // Accept incoming call
  const acceptCall = useCallback(async () => {
    const call = activeCallRef.current;
    if (!call || !profile) return;

    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }

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

    // Acquire media
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: call.isVideoCall,
      });
      localStreamRef.current = stream;
      setLocalStream(stream);

      // Set up peer connection as receiver (waits for offer)
      await setupPeerConnection(stream, false, call.id, call.callerUid);
    } catch (err) {
      console.warn("Failed to get user media for call:", err);
    }

    // Start timer
    setCallDuration(0);
    durationIntervalRef.current = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
  }, [profile, setupPeerConnection]);

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
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      if (audioTracks.length > 0) {
        const nextEnabled = !audioTracks[0].enabled;
        audioTracks.forEach((t) => {
          t.enabled = nextEnabled;
        });
        setIsMuted(!nextEnabled);
      }
    }
  }, []);

  // Toggle camera
  const toggleVideo = useCallback(async () => {
    if (!localStreamRef.current) return;

    const videoTracks = localStreamRef.current.getVideoTracks();
    if (videoTracks.length > 0) {
      const nextEnabled = !videoTracks[0].enabled;
      videoTracks.forEach((t) => {
        t.enabled = nextEnabled;
      });
      setIsVideoOn(nextEnabled);
    } else {
      // Add video track
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const newTrack = videoStream.getVideoTracks()[0];
        if (newTrack) {
          localStreamRef.current.addTrack(newTrack);
          if (pcRef.current) {
            pcRef.current.addTrack(newTrack, localStreamRef.current);
          }
          setIsVideoOn(true);
        }
      } catch (err) {
        console.warn("Cannot enable camera:", err);
      }
    }
  }, []);

  // Toggle screen share
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      // Revert to camera / no screen
      setIsScreenSharing(false);
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      const screenTrack = displayStream.getVideoTracks()[0];

      if (screenTrack && pcRef.current && localStreamRef.current) {
        const senders = pcRef.current.getSenders();
        const videoSender = senders.find((s) => s.track && s.track.kind === "video");
        if (videoSender) {
          videoSender.replaceTrack(screenTrack);
        } else {
          pcRef.current.addTrack(screenTrack, localStreamRef.current);
        }

        setIsScreenSharing(true);

        screenTrack.onended = () => {
          setIsScreenSharing(false);
        };
      }
    } catch (err) {
      console.warn("Screen share cancelled or failed:", err);
    }
  }, [isScreenSharing]);

  // Real-time signal subscriber for call invites, accepts, declines, cancels, ends, and WebRTC
  useEffect(() => {
    if (!profile) return;

    const unsubscribeSignals = subscribeBroadcastSignals(profile.uid, async (sig: any) => {
      if (!sig || !sig.type) return;

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
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: { echoCancellation: true, noiseSuppression: true },
              video: current.isVideoCall,
            });
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
        if (pcRef.current && sig.sdp) {
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
          } catch (e) {
            console.warn("[WebRTC] Error handling offer:", e);
          }
        }
      }

      // 7. WebRTC Answer
      if (sig.type === "call_webrtc_answer") {
        if (pcRef.current && sig.sdp) {
          try {
            await pcRef.current.setRemoteDescription(
              new RTCSessionDescription({ type: "answer", sdp: sig.sdp })
            );
          } catch (e) {
            console.warn("[WebRTC] Error handling answer:", e);
          }
        }
      }

      // 8. WebRTC Candidate
      if (sig.type === "call_webrtc_candidate") {
        if (pcRef.current && sig.candidate) {
          try {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(sig.candidate));
          } catch (e) {
            console.warn("[WebRTC] Error adding ICE candidate:", e);
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
    </CallContext.Provider>
  );
}
