const fs = require('fs');
let code = fs.readFileSync('src/components/VoiceChannel.tsx', 'utf8');

// 1. Relax camera constraints to prevent OverconstrainedError
code = code.replace(
  /width: \{ ideal: 1280, min: 640 \},\s*height: \{ ideal: 720, min: 480 \},\s*frameRate: \{ ideal: 30, max: 30 \}/g,
  `width: { ideal: 1280 },
            height: { ideal: 720 }`
);

// 2. Ensure createPeerConnection uses addTransceiver cleanly
// We already applied the addTransceiver fix in previous turn, let's verify if it's there
if (code.includes('cameraSender = pc.addTransceiver("video"')) {
  console.log("addTransceiver already present!");
}

// 3. Fix local and remote video rendering by ensuring srcObject is updated correctly.
// Let's check if there's any logic hiding the video if track isn't ready.
// Actually, let's add a continuous animation to the dummy tracks JUST IN CASE they are used anywhere,
// to ensure the encoder never freezes.
code = code.replace(
  /ctx\.fillRect\(0, 0, 16, 16\);\s*\}\s*dummyCanvasRef\.current = canvas;/g,
  `ctx.fillRect(0, 0, 16, 16);
      }
      
      const draw = () => {
        if (!dummyCanvasRef.current) return;
        const context = dummyCanvasRef.current.getContext("2d");
        if (context) {
          context.fillStyle = "#0a0a0a";
          context.fillRect(0, 0, 16, 16);
          context.fillStyle = \`rgba(20, 20, 20, \${Math.random()})\`;
          context.fillRect(0, 0, 2, 2);
        }
        requestAnimationFrame(draw);
      };
      draw();
      
      dummyCanvasRef.current = canvas;`
);

code = code.replace(
  /ctx\.fillRect\(0, 0, 16, 16\);\s*\}\s*dummyScreenCanvasRef\.current = canvas;/g,
  `ctx.fillRect(0, 0, 16, 16);
      }
      
      const drawScreen = () => {
        if (!dummyScreenCanvasRef.current) return;
        const context = dummyScreenCanvasRef.current.getContext("2d");
        if (context) {
          context.fillStyle = "#030303";
          context.fillRect(0, 0, 16, 16);
          context.fillStyle = \`rgba(15, 15, 15, \${Math.random()})\`;
          context.fillRect(0, 0, 2, 2);
        }
        requestAnimationFrame(drawScreen);
      };
      drawScreen();

      dummyScreenCanvasRef.current = canvas;`
);

// 4. Force video tags to play immediately when srcObject is set
// React ref callbacks for videos are already doing `el.play().catch(() => {})`, which is good.

// 5. Let's make sure the audio context suspended fix was applied correctly
// In the previous fix:
// localStreamRef.current = sourceStream;
// return sourceStream;
// This was applied.

fs.writeFileSync('src/components/VoiceChannel.tsx', code);
console.log("Black screen fixes applied!");
