// Call Audio Manager for handling outgoing and incoming call ringtones
// Uses /audio/ringtone.mp3 (the uploaded mp3 ringtone file)

class CallAudioManager {
  private static instance: CallAudioManager;
  private ringtoneAudio: HTMLAudioElement | null = null;
  private endChimeAudio: HTMLAudioElement | null = null;
  private joinChimeAudio: HTMLAudioElement | null = null;
  private isRingtonePlaying = false;
  private ringtoneVolume = 0.8;

  private constructor() {
    // Lazy initialized on first user interaction
  }

  public static getInstance(): CallAudioManager {
    if (!CallAudioManager.instance) {
      CallAudioManager.instance = new CallAudioManager();
    }
    return CallAudioManager.instance;
  }

  private initAudio() {
    if (typeof window === "undefined") return;

    if (!this.ringtoneAudio) {
      this.ringtoneAudio = new Audio("/audio/ringtone.mp3");
      this.ringtoneAudio.preload = "auto";
      this.ringtoneAudio.loop = true;
      this.ringtoneAudio.volume = this.ringtoneVolume;
    }

    if (!this.endChimeAudio) {
      this.endChimeAudio = new Audio("/audio/LockChime.wav");
      this.endChimeAudio.preload = "auto";
      this.endChimeAudio.volume = 0.7;
    }

    if (!this.joinChimeAudio) {
      this.joinChimeAudio = new Audio("/audio/discord-join.mp3");
      this.joinChimeAudio.preload = "auto";
      this.joinChimeAudio.volume = 0.75;
    }
  }

  public setVolume(vol: number) {
    this.ringtoneVolume = Math.max(0, Math.min(1, vol));
    if (this.ringtoneAudio) {
      this.ringtoneAudio.volume = this.ringtoneVolume;
    }
  }

  public getVolume(): number {
    return this.ringtoneVolume;
  }

  public async startRingtone(): Promise<boolean> {
    this.initAudio();
    if (!this.ringtoneAudio) return false;

    try {
      this.ringtoneAudio.loop = true;
      this.ringtoneAudio.currentTime = 0;
      this.ringtoneAudio.volume = this.ringtoneVolume;
      const playPromise = this.ringtoneAudio.play();
      if (playPromise !== undefined) {
        await playPromise;
      }
      this.isRingtonePlaying = true;
      return true;
    } catch (err) {
      console.warn("[CallAudio] Autoplay or playback prevented:", err);
      this.isRingtonePlaying = false;
      return false;
    }
  }

  public stopRingtone() {
    if (this.ringtoneAudio) {
      try {
        this.ringtoneAudio.pause();
        this.ringtoneAudio.currentTime = 0;
      } catch (e) {}
    }
    this.isRingtonePlaying = false;
  }

  public isPlaying(): boolean {
    return this.isRingtonePlaying;
  }

  public playCallConnected() {
    this.stopRingtone();
    this.initAudio();
    if (this.joinChimeAudio) {
      try {
        this.joinChimeAudio.currentTime = 0;
        this.joinChimeAudio.play().catch(() => {});
      } catch (e) {}
    }
  }

  public playCallEnd() {
    this.stopRingtone();
    this.initAudio();
    if (this.endChimeAudio) {
      try {
        this.endChimeAudio.currentTime = 0;
        this.endChimeAudio.play().catch(() => {});
      } catch (e) {}
    }
  }

  public async previewRingtone(durationMs = 8000): Promise<() => void> {
    this.initAudio();
    await this.startRingtone();

    const timer = setTimeout(() => {
      this.stopRingtone();
    }, durationMs);

    return () => {
      clearTimeout(timer);
      this.stopRingtone();
    };
  }
}

export const callAudio = CallAudioManager.getInstance();
