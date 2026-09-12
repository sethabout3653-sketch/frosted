const fs = require('fs');
let code = fs.readFileSync('src/components/VoiceChannel.tsx', 'utf8');

// I'll manually recreate the handleSignal block correctly
code = code.replace(/const handleSignal = useCallback\([\s\S]*?\[createPeerConnection, initiateCall, processCandidateQueue, profile\.uid, sendSignal, syncPeerTracks, activeRemoteWithVideo, activeScreenShare, fullscreenType\]\n\s*\);/g, `const handleSignal = useCallback(
    async (signal: VoiceSignal, micStream: MediaStream) => {
      const sigKey = signal.type === "candidate"
        ? \`\${signal.uid}_cand_\${(signal.sdp || (signal as any).candidate || "").slice(0, 80)}_\${signal.id || ""}\`
        : (signal.id || \`\${signal.uid}_\${signal.type}_\${signal.timestamp || ""}\`);

      if (processedSignalsRef.current.has(sigKey)) {
        return;
      }
      processedSignalsRef.current.add(sigKey);

      if (processedSignalsRef.current.size > 500) {
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
            } catch (e) {}
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
            } catch (e) {}
          }
        } else if (signal.type === "answer") {
          const pc = peersRef.current[partnerUid];
          if (pc && pc.signalingState === "have-local-offer") {
            try {
              const answerDescription = new RTCSessionDescription(JSON.parse(signal.sdp));
              await pc.setRemoteDescription(answerDescription);
              await processCandidateQueue(partnerUid, pc);
            } catch (e) {}
          }
        } else if (signal.type === "candidate") {
          const pc = peersRef.current[partnerUid];
          const candidateInit = JSON.parse(signal.sdp);
          if (pc && pc.remoteDescription && pc.remoteDescription.type) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidateInit));
            } catch (e) {}
          } else {
            if (!iceCandidateQueuesRef.current[partnerUid]) {
              iceCandidateQueuesRef.current[partnerUid] = [];
            }
            iceCandidateQueuesRef.current[partnerUid].push(candidateInit);
          }
        } else if ((signal.type as any) === "camera_started") {
          setRemoteVideoLoaded((prev) => ({ ...prev, [partnerUid]: true }));
        } else if ((signal.type as any) === "camera_loading") {
          setRemoteVideoLoaded((prev) => ({ ...prev, [partnerUid]: false }));
        } else if ((signal.type as any) === "camera_stopped") {
          setRemoteVideoLoaded((prev) => ({ ...prev, [partnerUid]: false }));
          if (remoteVideoRefs.current[partnerUid]) {
            remoteVideoRefs.current[partnerUid]!.srcObject = null;
          }
          if (fullscreenVideoRef.current && fullscreenType === "camera" && activeRemoteWithVideo?.uid === partnerUid) {
            fullscreenVideoRef.current.srcObject = null;
          }
        } else if ((signal.type as any) === "screen_stopped") {
          if (remoteScreenVideoRefs.current[partnerUid]) {
            remoteScreenVideoRefs.current[partnerUid]!.srcObject = null;
          }
          if (fullscreenVideoRef.current && fullscreenType === "screen" && activeScreenShare?.uid === partnerUid) {
            fullscreenVideoRef.current.srcObject = null;
          }
        } else if ((signal.type as any) === "user_joined_ack") {
          const pc = peersRef.current[partnerUid];
          const isDead = !pc || pc.connectionState === "closed" || pc.connectionState === "failed";
          if (isDead && localStreamRef.current) {
            lastCallAttemptRef.current[partnerUid] = Date.now();
            initiateCall(partnerUid, localStreamRef.current);
          } else if (pc) {
            syncPeerTracks(partnerUid, pc);
          }
        }
      } catch (err: any) {}
    },
    [createPeerConnection, initiateCall, processCandidateQueue, profile.uid, sendSignal, syncPeerTracks, activeRemoteWithVideo, activeScreenShare, fullscreenType]
  );`);

fs.writeFileSync('src/components/VoiceChannel.tsx', code);
console.log("Fixed handleSignal!");
