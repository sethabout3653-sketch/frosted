/**
 * High-fidelity Discord notification audio synthesizer using Web Audio API.
 * Guarantees crisp, instant playback on any browser/network without external file loading.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    audioCtx = new AudioCtx();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Plays the iconic 2-tone Discord message/invite notification chime.
 */
export function playDiscordNotificationSound() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Master gain
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.25, now);
    masterGain.connect(ctx.destination);

    // Chime Note 1: 660 Hz (E5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(660, now);

    gain1.gain.setValueAtTime(0.01, now);
    gain1.gain.linearRampToValueAtTime(0.3, now + 0.01);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc1.connect(gain1);
    gain1.connect(masterGain);

    osc1.start(now);
    osc1.stop(now + 0.13);

    // Chime Note 2: 880 Hz (A5) - plays ~75ms later
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880, now + 0.075);

    gain2.gain.setValueAtTime(0.01, now + 0.075);
    gain2.gain.linearRampToValueAtTime(0.4, now + 0.085);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc2.connect(gain2);
    gain2.connect(masterGain);

    osc2.start(now + 0.075);
    osc2.stop(now + 0.3);
  } catch (err) {
    console.warn("Could not play notification sound:", err);
  }
}
