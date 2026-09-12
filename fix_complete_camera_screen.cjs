const fs = require('fs');
let code = fs.readFileSync('src/components/VoiceChannel.tsx', 'utf8');

// 1. Fix activeScreenShare computation to not block on cache
const oldActiveScreen = `  const activeScreenShare = useMemo(() => {
    if (isScreenSharing && screenStreamRef.current && screenStreamRef.current.getVideoTracks().some((t) => t.readyState === "live")) {
      return {
        uid: profile.uid,
        username: profile.username,
        isLocal: true,
        hasAudio: isScreenAudioOn,
      };
    }
    const remoteSharer = activeParticipants.find(
      (p) =>
        p.isScreenSharing === true &&
        (!!remoteScreenSharersRef.current[p.uid] ||
          (!!remoteScreenStreamsRef.current[p.uid] &&
            remoteScreenStreamsRef.current[p.uid].getVideoTracks().some((t) => t.readyState === "live" && t.enabled)))
    );
    if (remoteSharer) {
      return {
        uid: remoteSharer.uid,
        username: remoteSharer.username,
        isLocal: false,
        hasAudio: !!remoteSharer.isScreenAudioOn || !!remoteScreenSharersRef.current[remoteSharer.uid]?.hasAudio,
      };
    }
    return null;
  }, [isScreenSharing, profile.uid, profile.username, isScreenAudioOn, activeParticipants, trackTrigger]);`;

const newActiveScreen = `  const activeScreenShare = useMemo(() => {
    if (isScreenSharing && screenStreamRef.current && screenStreamRef.current.getVideoTracks().some((t) => t.readyState === "live")) {
      return {
        uid: profile.uid,
        username: profile.username,
        isLocal: true,
        hasAudio: isScreenAudioOn,
      };
    }
    const remoteSharer = activeParticipants.find(
      (p) => p.uid !== profile.uid && p.isScreenSharing === true
    );
    if (remoteSharer) {
      return {
        uid: remoteSharer.uid,
        username: remoteSharer.username,
        isLocal: false,
        hasAudio: !!remoteSharer.isScreenAudioOn || !!remoteScreenSharersRef.current[remoteSharer.uid]?.hasAudio,
      };
    }
    return null;
  }, [isScreenSharing, profile.uid, profile.username, isScreenAudioOn, activeParticipants, trackTrigger]);`;

code = code.replace(oldActiveScreen, newActiveScreen);

// 2. Fix syncPeerTracks to accurately link camera & screen share
const oldSyncPeerTracks = `  // Synchronize remote peer tracks (audio, camera, screen share) to MediaStreams and Video elements
  const syncPeerTracks = useCallback((partnerUid: string, pc: RTCPeerConnection) => {
    if (!pc || pc.connectionState === "closed") return;
    const transceivers = pc.getTransceivers();

    // 1. Audio track
    const audioTransceivers = transceivers.filter((t) => t.receiver.track?.kind === "audio");
    if (audioTransceivers.length > 0) {
      const aTrack = audioTransceivers[0].receiver.track;
      if (aTrack) {
        aTrack.enabled = true;
        let aStream = remoteAudioStreamsRef.current[partnerUid];
        if (!aStream || !aStream.getAudioTracks().some((t) => t.id === aTrack.id)) {
          aStream = new MediaStream([aTrack]);
          remoteAudioStreamsRef.current[partnerUid] = aStream;
        }
        
        let audioEl = remoteAudioRefs.current[partnerUid];
        if (!audioEl) {
          audioEl = new Audio();
          audioEl.autoplay = true;
          (audioEl as any).playsInline = true;
          remoteAudioRefs.current[partnerUid] = audioEl;
        }
        if (audioEl.srcObject !== aStream) {
          audioEl.srcObject = aStream;
        }
        audioEl.play().catch(() => {});
        aTrack.onunmute = () => {
          let el = remoteAudioRefs.current[partnerUid];
          if (!el) {
            el = new Audio();
            el.autoplay = true;
            (el as any).playsInline = true;
            remoteAudioRefs.current[partnerUid] = el;
          }
          if (el.srcObject !== aStream) {
            el.srcObject = aStream;
          }
          el.play().catch(() => {});
        };
      }
    }

    // 2. Camera video track
    const videoTransceivers = transceivers.filter((t) => t.receiver.track?.kind === "video");
    if (videoTransceivers.length >= 1) {
      const camTrack = videoTransceivers[0].receiver.track;
      if (camTrack) {
        camTrack.enabled = true;
        let cStream = remoteCameraStreamsRef.current[partnerUid];
        if (!cStream || !cStream.getVideoTracks().some((t) => t.id === camTrack.id)) {
          cStream = new MediaStream([camTrack]);
          remoteCameraStreamsRef.current[partnerUid] = cStream;
          remoteStreamsRef.current[partnerUid] = cStream;
        }
        
        const camEl = remoteVideoRefs.current[partnerUid];
        if (camEl) {
          if (camEl.srcObject !== cStream) {
            camEl.srcObject = cStream;
          }
          camEl.play().catch(() => {});
        }
        setRemoteVideoLoaded((prev) => ({ ...prev, [partnerUid]: true }));
        camTrack.onunmute = () => {
          const el = remoteVideoRefs.current[partnerUid];
          const stream = remoteCameraStreamsRef.current[partnerUid] || remoteStreamsRef.current[partnerUid];
          if (el && stream) {
            if (el.srcObject !== stream) {
              el.srcObject = stream;
            }
            el.play().catch(() => {});
          }
          setRemoteVideoLoaded((prev) => ({ ...prev, [partnerUid]: true }));
          setTrackTrigger((v) => v + 1);
        };
      }
    }

    // 3. Screen share video track
    let scrTrack: MediaStreamTrack | null = null;
    if (transceivers.length >= 3 && transceivers[2].receiver.track?.kind === "video") {
      scrTrack = transceivers[2].receiver.track;
    } else if (videoTransceivers.length >= 2) {
      scrTrack = videoTransceivers[1].receiver.track;
    }

    if (scrTrack) {
      scrTrack.enabled = true;
      let scrStream = remoteScreenStreamsRef.current[partnerUid];
      if (!scrStream || !scrStream.getVideoTracks().some((t) => t.id === scrTrack!.id)) {
        // Create a completely new MediaStream to ensure the <video> element detects the change
        scrStream = new MediaStream([scrTrack]);
        remoteScreenStreamsRef.current[partnerUid] = scrStream;
      }
      
      const screenEl = remoteScreenVideoRefs.current[partnerUid];
      if (screenEl) {
        if (screenEl.srcObject !== scrStream) {
          screenEl.srcObject = scrStream;
        }
        screenEl.play().catch(() => {});
      }

      scrTrack.onunmute = () => {
        const el = remoteScreenVideoRefs.current[partnerUid];
        if (el && remoteScreenStreamsRef.current[partnerUid]) {
          if (el.srcObject !== remoteScreenStreamsRef.current[partnerUid]) {
            el.srcObject = remoteScreenStreamsRef.current[partnerUid];
          }
          el.play().catch(() => {});
        }
        setTrackTrigger((v) => v + 1);
      };
    }
  }, []);`;

const newSyncPeerTracks = `  // Synchronize remote peer tracks (audio, camera, screen share) to MediaStreams and Video elements
  const syncPeerTracks = useCallback((partnerUid: string, pc: RTCPeerConnection) => {
    if (!pc || pc.connectionState === "closed") return;
    const transceivers = pc.getTransceivers();

    // 1. Audio track
    const audioTransceivers = transceivers.filter((t) => t.receiver.track?.kind === "audio");
    if (audioTransceivers.length > 0) {
      const aTrack = audioTransceivers[0].receiver.track;
      if (aTrack) {
        aTrack.enabled = true;
        let aStream = remoteAudioStreamsRef.current[partnerUid];
        if (!aStream || !aStream.getAudioTracks().some((t) => t.id === aTrack.id)) {
          aStream = new MediaStream([aTrack]);
          remoteAudioStreamsRef.current[partnerUid] = aStream;
        }
        
        let audioEl = remoteAudioRefs.current[partnerUid];
        if (!audioEl) {
          audioEl = new Audio();
          audioEl.autoplay = true;
          (audioEl as any).playsInline = true;
          remoteAudioRefs.current[partnerUid] = audioEl;
        }
        if (audioEl.srcObject !== aStream) {
          audioEl.srcObject = aStream;
        }
        audioEl.play().catch(() => {});
        aTrack.onunmute = () => {
          let el = remoteAudioRefs.current[partnerUid];
          if (el && el.srcObject !== aStream) {
            el.srcObject = aStream;
          }
          el?.play().catch(() => {});
        };
      }
    }

    // 2. Video transceivers (Index 0 = Camera, Index 1 = Screen Share)
    const videoTransceivers = transceivers.filter((t) => t.receiver.track?.kind === "video");
    
    // Camera track
    if (videoTransceivers.length >= 1 && videoTransceivers[0].receiver.track) {
      const camTrack = videoTransceivers[0].receiver.track;
      camTrack.enabled = true;
      let cStream = remoteCameraStreamsRef.current[partnerUid];
      if (!cStream || !cStream.getVideoTracks().some((t) => t.id === camTrack.id)) {
        cStream = new MediaStream([camTrack]);
        remoteCameraStreamsRef.current[partnerUid] = cStream;
        remoteStreamsRef.current[partnerUid] = cStream;
      }
      
      const camEl = remoteVideoRefs.current[partnerUid];
      if (camEl && camEl.srcObject !== cStream) {
        camEl.srcObject = cStream;
        camEl.play().catch(() => {});
      }
      setRemoteVideoLoaded((prev) => ({ ...prev, [partnerUid]: true }));
      camTrack.onunmute = () => {
        const el = remoteVideoRefs.current[partnerUid];
        if (el && cStream) {
          if (el.srcObject !== cStream) el.srcObject = cStream;
          el.play().catch(() => {});
        }
        setRemoteVideoLoaded((prev) => ({ ...prev, [partnerUid]: true }));
        setTrackTrigger((v) => v + 1);
      };
    }

    // Screen share track
    if (videoTransceivers.length >= 2 && videoTransceivers[1].receiver.track) {
      const scrTrack = videoTransceivers[1].receiver.track;
      scrTrack.enabled = true;
      let scrStream = remoteScreenStreamsRef.current[partnerUid];
      if (!scrStream || !scrStream.getVideoTracks().some((t) => t.id === scrTrack.id)) {
        scrStream = new MediaStream([scrTrack]);
        remoteScreenStreamsRef.current[partnerUid] = scrStream;
      }
      
      const screenEl = remoteScreenVideoRefs.current[partnerUid];
      if (screenEl && screenEl.srcObject !== scrStream) {
        screenEl.srcObject = scrStream;
        screenEl.play().catch(() => {});
      }

      scrTrack.onunmute = () => {
        const el = remoteScreenVideoRefs.current[partnerUid];
        if (el && scrStream) {
          if (el.srcObject !== scrStream) el.srcObject = scrStream;
          el.play().catch(() => {});
        }
        setTrackTrigger((v) => v + 1);
      };
    }
  }, []);`;

code = code.replace(oldSyncPeerTracks, newSyncPeerTracks);

// 3. Clean up toggleVideo to remove any initiateCall loops
code = code.replace(
  /\/\/ Force renegotiation to ensure remote peers display the new track\s*if \(localStreamRef\.current\) \{\s*initiateCall\(pUid, localStreamRef\.current\);\s*\}/g,
  ''
);

code = code.replace(
  /if \(localStreamRef\.current\) \{\s*initiateCall\(pUid, localStreamRef\.current\);\s*\}/g,
  ''
);

// 4. In JSX, remove permanently stuck isVideoLoading overlay if isVideoOn is true or after timeout
code = code.replace(
  /\{p\.isVideoLoading && \(\s*<div className="absolute inset-0 bg-\[#30343b\] flex items-center justify-center z-10 animate-in fade-in duration-200 pointer-events-none">[\s\S]*?<\/div>\s*\)\}/g,
  `{!remoteVideoLoaded[p.uid] && p.isVideoLoading && (
                    <div className="absolute inset-0 bg-[#30343b] flex items-center justify-center z-10 animate-in fade-in duration-200 pointer-events-none">
                      <img
                        src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/loading-discord-4cdhz1tE0SAtxrt5ioRt7yzc8DpALU.gif"
                        alt="Loading camera"
                        className={\`\${compact ? "w-8 h-8" : "w-12 h-12"} object-contain\`}
                      />
                    </div>
                  )}`
);

fs.writeFileSync('src/components/VoiceChannel.tsx', code);
console.log("Applied clean video/screen synchronization!");
