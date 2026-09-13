// High-fidelity Web Audio sound synthesizer for Discord ringtones and call sounds
// Works 100% offline, zero network latency, with clean looping and instant start/stop.

let audioCtx: AudioContext | null = null;
let incomingRingtoneInterval: any = null;
let outgoingRingInterval: any = null;

function getAudioContext(): AudioContext {
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Discord Ringtone Note Frequency Map
const NOTES: Record<string, number> = {
  C4: 261.63,
  D4: 293.66,
  Eb4: 311.13,
  F4: 349.23,
  G4: 392.0,
  Ab4: 415.3,
  Bb4: 466.16,
  C5: 523.25,
  D5: 587.33,
  Eb5: 622.25,
  F5: 698.46,
  G5: 783.99,
};

// Plays a synth chime bell note matching the Discord ringtone timbre
function playDiscordBell(ctx: AudioContext, freq: number, startTime: number, duration: number = 0.35, gainMult: number = 0.35) {
  try {
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc1.type = "sine";
    osc1.frequency.setValueAtTime(freq, startTime);

    // Subtle FM harmonics for bright bell-like Discord ringtone sound
    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(freq * 2.005, startTime);

    gainNode.gain.setValueAtTime(0.001, startTime);
    gainNode.gain.exponentialRampToValueAtTime(gainMult, startTime + 0.015);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc1.start(startTime);
    osc2.start(startTime);
    osc1.stop(startTime + duration);
    osc2.stop(startTime + duration);
  } catch (e) {}
}

export function playIncomingRingtone() {
  stopIncomingRingtone();
  const ctx = getAudioContext();

  const playSequence = () => {
    const now = ctx.currentTime;
    const tempo = 0.17; // Note spacing

    // Discord incoming call pattern
    const pattern = [
      { note: "C5", time: 0 },
      { note: "D5", time: 1 },
      { note: "G4", time: 2 },
      { note: "C5", time: 3 },
      { note: "D5", time: 4 },
      { note: "G4", time: 5 },

      { note: "C5", time: 7 },
      { note: "D5", time: 8 },
      { note: "F4", time: 9 },
      { note: "C5", time: 10 },
      { note: "D5", time: 11 },
      { note: "F4", time: 12 },

      { note: "C5", time: 14 },
      { note: "D5", time: 15 },
      { note: "G4", time: 16 },
      { note: "C5", time: 17 },
      { note: "D5", time: 18 },
      { note: "G4", time: 19 },

      { note: "Eb5", time: 21 },
      { note: "D5", time: 22 },
      { note: "C5", time: 23 },
      { note: "Bb4", time: 24 },
      { note: "G4", time: 25 },
    ];

    pattern.forEach((p) => {
      const freq = NOTES[p.note];
      if (freq) {
        playDiscordBell(ctx, freq, now + p.time * tempo, 0.4, 0.45);
      }
    });
  };

  playSequence();
  // Repeat every 5.2 seconds
  incomingRingtoneInterval = setInterval(() => {
    playSequence();
  }, 5200);
}

export function stopIncomingRingtone() {
  if (incomingRingtoneInterval) {
    clearInterval(incomingRingtoneInterval);
    incomingRingtoneInterval = null;
  }
}

// Outgoing calling ring (classic Discord / phone outgoing ring chime)
export function playOutgoingRing() {
  stopOutgoingRing();
  const ctx = getAudioContext();

  const playChime = () => {
    try {
      const now = ctx.currentTime;
      playDiscordBell(ctx, 440, now, 0.28, 0.25);
      playDiscordBell(ctx, 480, now + 0.12, 0.35, 0.3);
    } catch (e) {}
  };

  playChime();
  outgoingRingInterval = setInterval(() => {
    playChime();
  }, 2400);
}

export function stopOutgoingRing() {
  if (outgoingRingInterval) {
    clearInterval(outgoingRingInterval);
    outgoingRingInterval = null;
  }
}

// 3-note call disconnect / hangup sound
export function playCallEndSound() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    playDiscordBell(ctx, 480, now, 0.15, 0.3);
    playDiscordBell(ctx, 380, now + 0.12, 0.15, 0.3);
    playDiscordBell(ctx, 280, now + 0.24, 0.25, 0.35);
  } catch (e) {}
}

// Unavailable / Busy tone
export function playBusyTone() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    playDiscordBell(ctx, 420, now, 0.2, 0.35);
    playDiscordBell(ctx, 420, now + 0.35, 0.2, 0.35);
    playDiscordBell(ctx, 420, now + 0.7, 0.2, 0.35);
  } catch (e) {}
}

// Call join connected sound
export function playCallConnectedSound() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    playDiscordBell(ctx, 320, now, 0.15, 0.25);
    playDiscordBell(ctx, 480, now + 0.1, 0.15, 0.3);
    playDiscordBell(ctx, 640, now + 0.2, 0.25, 0.35);
  } catch (e) {}
}
