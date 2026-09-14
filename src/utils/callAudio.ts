// Call Audio Manager for handling outgoing and incoming call ringtones
// Uses /audio/ringtone.mp3 (the uploaded mp3 ringtone file)

class CallAudioManager {
  private static instance: CallAudioManager;
  private ringtoneAudio: HTMLAudioElement | null = null;
  private endChimeAudio: HTMLAudioElement | null = null;
  private joinChimeAudio: HTMLAudioElement | null = null;
  private audioCtx: AudioContext | null = null;
  private oscillatorInterval: any = null;
  private isRingtonePlaying = false;
  private ringtoneVolume = 0.85;
  private isUnlocked = false;

  private constructor() {
    if (typeof window !== "undefined") {
      const unlock = () => {
        if (!this.isUnlocked) {
          this.isUnlocked = true;
          this.initAudio();
          if (this.audioCtx && this.audioCtx.state === "suspended") {
            this.audioCtx.resume().catch(() => {});
          }
        }
      };
      window.addEventListener("click", unlock, { passive: true });
      window.addEventListener("keydown", unlock, { passive: true });
      window.addEventListener("touchstart", unlock, { passive: true });
      window.addEventListener("pointerdown", unlock, { passive: true });
    }
  }

  public static getInstance(): CallAudioManager {
    if (!CallAudioManager.instance) {
      CallAudioManager.instance = new CallAudioManager();
    }
    return CallAudioManager.instance;
  }

  private initAudio() {
    if (typeof window === "undefined") return;

    if (!this.audioCtx) {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          this.audioCtx = new AudioContextClass();
        }
      } catch (e) {}
    }

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
    this.isRingtonePlaying = true;

    if (this.audioCtx && this.audioCtx.state === "suspended") {
      this.audioCtx.resume().catch(() => {});
    }

    let played = false;

    if (this.ringtoneAudio) {
      try {
        this.ringtoneAudio.loop = true;
        this.ringtoneAudio.currentTime = 0;
        this.ringtoneAudio.volume = this.ringtoneVolume;
        const playPromise = this.ringtoneAudio.play();
        if (playPromise !== undefined) {
          await playPromise;
          played = true;
        }
      } catch (err) {
        console.warn("[CallAudio] Direct ringtone playback deferred until gesture:", err);
        // Queue playback on next user gesture if blocked by autoplay
        const playOnGesture = () => {
          if (this.isRingtonePlaying && this.ringtoneAudio) {
            this.ringtoneAudio.currentTime = 0;
            this.ringtoneAudio.play().catch(() => {});
          }
        };
        window.addEventListener("click", playOnGesture, { once: true, passive: true });
        window.addEventListener("pointerdown", playOnGesture, { once: true, passive: true });
        window.addEventListener("keydown", playOnGesture, { once: true, passive: true });
      }
    }

    return played;
  }

  public stopRingtone() {
    this.isRingtonePlaying = false;
    if (this.ringtoneAudio) {
      try {
        this.ringtoneAudio.pause();
        this.ringtoneAudio.currentTime = 0;
      } catch (e) {}
    }
    if (this.oscillatorInterval) {
      clearInterval(this.oscillatorInterval);
      this.oscillatorInterval = null;
    }
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

