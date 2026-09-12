const fs = require('fs');
let code = fs.readFileSync('src/components/VoiceChannel.tsx', 'utf8');

// 1. We want to remove the replaceTrack logic and use initiateCall instead for toggling.
// Wait, initiateCall is called with a partnerUid. We can loop over peersRef and call initiateCall for all of them!

code = code.replace(
  /if \(videoSender\) \{\s*await videoSender\.replaceTrack\(realVideoTrack\)\.catch\(\(\) => \{\}\);\s*try \{\s*const params = videoSender\.getParameters\(\);[\s\S]*?await videoSender\.setParameters\(params\)\.catch\(\(\) => \{\}\);\s*\} catch \(e\) \{\}\s*\}/g,
  `if (videoSender) {
                await videoSender.replaceTrack(realVideoTrack).catch(() => {});
                try {
                  const params = videoSender.getParameters();
                  if (!params.encodings || params.encodings.length === 0) {
                    params.encodings = [{}];
                  }
                  params.encodings[0].maxBitrate = 1500000;
                  params.encodings[0].priority = "high";
                  await videoSender.setParameters(params).catch(() => {});
                } catch (e) {}
              }
              // Force renegotiation to ensure remote peers display the new track
              if (localStreamRef.current) {
                initiateCall(pUid, localStreamRef.current);
              }`
);

// Do the same for stop camera
code = code.replace(
  /if \(videoSender\) \{\s*await videoSender\.replaceTrack\(dummyTrack\)\.catch\(\(\) => \{\}\);\s*\}/g,
  `if (videoSender) {
                await videoSender.replaceTrack(null).catch(() => {});
              }
              if (localStreamRef.current) {
                initiateCall(pUid, localStreamRef.current);
              }`
);
code = code.replace(
  /if \(videoSender\) \{\s*await videoSender\.replaceTrack\(null\)\.catch\(\(\) => \{\}\);\s*\}/g,
  `if (videoSender) {
                await videoSender.replaceTrack(null).catch(() => {});
              }
              if (localStreamRef.current) {
                initiateCall(pUid, localStreamRef.current);
              }`
);


// For screenshare start
code = code.replace(
  /if \(screenSender\) \{\s*await screenSender\.replaceTrack\(screenVideoTrack\)\.catch\(\(\) => \{\}\);\s*try \{\s*const params = screenSender\.getParameters\(\);[\s\S]*?await screenSender\.setParameters\(params\)\.catch\(\(\) => \{\}\);\s*\} catch \(e\) \{\}\s*\}/g,
  `if (screenSender) {
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
            }
            if (localStreamRef.current) {
              initiateCall(pUid, localStreamRef.current);
            }`
);

// For screenshare stop
code = code.replace(
  /if \(sender\) \{\s*try \{\s*await sender\.replaceTrack\(dummyTrack\);\s*\} catch \(e\) \{\}\s*\}/g,
  `if (sender) {
            try {
              await sender.replaceTrack(null);
            } catch (e) {}
          }
          if (localStreamRef.current) {
            initiateCall(pUid, localStreamRef.current);
          }`
);
code = code.replace(
  /if \(sender\) \{\s*try \{\s*await sender\.replaceTrack\(null\);\s*\} catch \(e\) \{\}\s*\}/g,
  `if (sender) {
            try {
              await sender.replaceTrack(null);
            } catch (e) {}
          }
          if (localStreamRef.current) {
            initiateCall(pUid, localStreamRef.current);
          }`
);


// Fix audio mic constraints
code = code.replace(
  /echoCancellation: true,\s*noiseSuppression: false,\s*autoGainControl: true,/g,
  `echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,`
);

fs.writeFileSync('src/components/VoiceChannel.tsx', code);
console.log("Renegotiation applied!");
