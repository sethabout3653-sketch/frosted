const fs = require('fs');
let code = fs.readFileSync('src/components/VoiceChannel.tsx', 'utf8');

// 1. Fix audio context suspended issue
code = code.replace(
  /localStreamRef\.current = mixedDest\.stream;\s*return mixedDest\.stream;/g,
  `localStreamRef.current = sourceStream;
        return sourceStream;`
);

let cameraStr = `const cameraTrack = realVideoTrack && realVideoTrack.readyState === "live"
        ? realVideoTrack
        : getOrCreateDummyVideoTrack();
      const cameraStream = videoStreamRef.current || new MediaStream([cameraTrack]);
      const cameraSender = pc.addTrack(cameraTrack, cameraStream);`;
      
let newCameraStr = `const cameraStream = videoStreamRef.current || new MediaStream();
      let cameraSender;
      if (realVideoTrack && realVideoTrack.readyState === "live") {
        cameraSender = pc.addTrack(realVideoTrack, cameraStream);
      } else {
        cameraSender = pc.addTransceiver("video", { direction: "sendrecv", streams: [cameraStream] }).sender;
      }`;
code = code.replace(cameraStr, newCameraStr);

let screenStr = `const screenTrack = realScreenTrack && realScreenTrack.readyState === "live"
        ? realScreenTrack
        : getOrCreateDummyScreenTrack();
      const screenStream = screenStreamRef.current || new MediaStream([screenTrack]);
      const screenSender = pc.addTrack(screenTrack, screenStream);`;

let newScreenStr = `const screenStream = screenStreamRef.current || new MediaStream();
      let screenSender;
      if (realScreenTrack && realScreenTrack.readyState === "live") {
        screenSender = pc.addTrack(realScreenTrack, screenStream);
      } else {
        screenSender = pc.addTransceiver("video", { direction: "sendrecv", streams: [screenStream] }).sender;
      }`;
code = code.replace(screenStr, newScreenStr);

// Let's also fix the getOrCreateDummyVideoTrack usage for rollback when stopping video
let rollbackCameraStr = `const dummyTrack = getOrCreateDummyVideoTrack();
                await videoSender.replaceTrack(dummyTrack).catch(() => {});`;
code = code.replace(rollbackCameraStr, `await videoSender.replaceTrack(null).catch(() => {});`);

let rollbackScreenStr = `const dummyTrack = getOrCreateDummyScreenTrack();
              await sender.replaceTrack(dummyTrack);`;
code = code.replace(rollbackScreenStr, `await sender.replaceTrack(null);`);

fs.writeFileSync('src/components/VoiceChannel.tsx', code);
console.log("Replaced correctly!");
