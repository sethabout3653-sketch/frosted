// High-fidelity Web Audio & Custom Audio sound manager for Discord ringtones and call sounds
// Works offline, respects user's custom ringtone in Settings, zero noise clutter, instant stop on missed calls.

let audioCtx: AudioContext | null = null;
let incomingRingtoneInterval: any = null;
let outgoingRingInterval: any = null;
let currentRingtoneAudio: HTMLAudioElement | null = null;
let missedCallAudio: HTMLAudioElement | null = null;
let joinCallAudio: HTMLAudioElement | null = null;

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

function playDiscordBell(
  ctx: AudioContext,
  freq: number,
  startTime: number,
  duration: number = 0.35,
  gainMult: number = 0.35
) {
  try {
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc1.type = "sine";
    osc1.frequency.setValueAtTime(freq, startTime);

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

let currentOutgoingAudio: HTMLAudioElement | null = null;

export function playIncomingRingtone() {
  stopIncomingRingtone();

  // 1. Check if user configured a custom ringtone in Settings, or use default Discord ringtone
  try {
    const ringtoneType = localStorage.getItem("custom_ringtone_type") || "default";
    const customData = localStorage.getItem("custom_ringtone_data");
    const customUrl = localStorage.getItem("custom_ringtone_url");
    const savedVolume = parseFloat(localStorage.getItem("custom_ringtone_volume") || "0.85");

    let audioSrc: string = "/audio/discord-ringtone.mp3";

    if (ringtoneType === "custom_file" && customData) {
      audioSrc = customData;
    } else if (ringtoneType === "custom_url" && customUrl) {
      audioSrc = customUrl;
    } else if (ringtoneType === "discord_sound") {
      audioSrc = "/audio/discord_sound.mp3";
    } else if (ringtoneType === "discord_join") {
      audioSrc = "/audio/discord-join.mp3";
    } else if (ringtoneType === "lock_chime") {
      audioSrc = "/audio/LockChime.wav";
    } else {
      // Default: the official Discord ringtone audio file uploaded
      audioSrc = "/audio/discord-ringtone.mp3";
    }

    currentRingtoneAudio = new Audio(audioSrc);
    currentRingtoneAudio.loop = true;
    currentRingtoneAudio.volume = Math.min(1, Math.max(0, savedVolume));
    currentRingtoneAudio.play().catch(() => {});
    return;
  } catch (err) {
    console.warn("Could not load ringtone audio:", err);
  }
}

export function stopIncomingRingtone() {
  if (incomingRingtoneInterval) {
    clearInterval(incomingRingtoneInterval);
    incomingRingtoneInterval = null;
  }
  if (currentRingtoneAudio) {
    currentRingtoneAudio.pause();
    currentRingtoneAudio.currentTime = 0;
    currentRingtoneAudio = null;
  }
}

// Outgoing calling ring - uses the same iconic Discord ringtone
export function playOutgoingRing() {
  stopOutgoingRing();
  try {
    const savedVolume = parseFloat(localStorage.getItem("custom_ringtone_volume") || "0.85");
    currentOutgoingAudio = new Audio("/audio/discord-ringtone.mp3");
    currentOutgoingAudio.loop = true;
    currentOutgoingAudio.volume = Math.min(1, Math.max(0, savedVolume));
    currentOutgoingAudio.play().catch(() => {});
  } catch (e) {
    console.warn("Could not play outgoing ring:", e);
  }
}

export function stopOutgoingRing() {
  if (currentOutgoingAudio) {
    currentOutgoingAudio.pause();
    currentOutgoingAudio.currentTime = 0;
    currentOutgoingAudio = null;
  }
  if (outgoingRingInterval) {
    clearInterval(outgoingRingInterval);
    outgoingRingInterval = null;
  }
}

// Discord missed call / disconnect sound (uses the sound in the code: /audio/LockChime.wav)
export function playMissedCallSound() {
  // Immediately kill any ringing or looping audio first
  stopIncomingRingtone();
  stopOutgoingRing();

  try {
    missedCallAudio ||= new Audio("/audio/LockChime.wav");
    missedCallAudio.currentTime = 0;
    missedCallAudio.volume = 0.85;
    missedCallAudio.play().catch(() => {});
  } catch (e) {
    console.warn("Could not play missed call sound:", e);
  }
}

// Disconnect / hangup sound
export function playCallEndSound() {
  stopIncomingRingtone();
  stopOutgoingRing();

  try {
    missedCallAudio ||= new Audio("/audio/LockChime.wav");
    missedCallAudio.currentTime = 0;
    missedCallAudio.volume = 0.85;
    missedCallAudio.play().catch(() => {});
  } catch (e) {}
}

// Replaced harsh busy tone with the clean discord disconnect sound
export function playBusyTone() {
  playMissedCallSound();
}

// Call join connected sound
export function playCallConnectedSound() {
  try {
    joinCallAudio ||= new Audio("/audio/discord-join.mp3");
    joinCallAudio.currentTime = 0;
    joinCallAudio.volume = 0.82;
    joinCallAudio.play().catch(() => {});
  } catch (e) {}
}

