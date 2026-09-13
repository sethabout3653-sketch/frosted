// Robust Voice Activity & Sound Detection (VAD) Engine
// Discriminating stationary static, fan hum, and room noise from real human voice (whisper, speech, loud) and any intentional audio.

export class SmartVoiceDetector {
  private noiseFloor: number = 6; // Running adaptive noise floor
  private speechCounter: number = 0; // Number of consecutive speech/sound frames
  private hangoverRemaining: number = 0; // Frames to hold active state after speech pauses
  private isSpeakingState: boolean = false;
  private prevVoiceEnergy: number = 0;
  private energyDeltaHistory: number[] = [];

  constructor() {}

  /**
   * Evaluates frequency data from an AnalyserNode to determine if sound is human speech/intentional audio vs background static.
   * @param freqData Uint8Array of byte frequency data from Web Audio AnalyserNode
   * @param sampleRate AudioContext sample rate (typically 44100 or 48000)
   */
  public analyze(freqData: Uint8Array, sampleRate: number = 48000): {
    isSpeaking: boolean;
    confidence: number;
    energy: number;
    isNoiseOnly: boolean;
  } {
    const binCount = freqData.length;
    const binWidth = (sampleRate / 2) / Math.max(1, binCount);

    // Human Vocal band: ~120Hz to ~4000Hz
    const minVoiceBin = Math.max(1, Math.floor(120 / binWidth));
    const maxVoiceBin = Math.min(binCount - 1, Math.ceil(4000 / binWidth));

    // Whisper & fricative vocal band: ~800Hz to ~3800Hz
    const minWhisperBin = Math.max(1, Math.floor(800 / binWidth));
    const maxWhisperBin = Math.min(binCount - 1, Math.ceil(3800 / binWidth));

    // Low rumble noise band: < 80Hz
    const rumbleMaxBin = Math.max(1, Math.floor(80 / binWidth));
    // High hiss / static noise band: > 6000Hz
    const hissMinBin = Math.min(binCount - 1, Math.floor(6000 / binWidth));

    let voiceEnergy = 0;
    let voiceBinCount = 0;
    let maxVoicePeak = 0;
    let logSum = 0;
    let linSum = 0;

    for (let i = minVoiceBin; i <= maxVoiceBin; i++) {
      const val = freqData[i];
      voiceEnergy += val;
      voiceBinCount++;
      if (val > maxVoicePeak) maxVoicePeak = val;

      const norm = Math.max(1, val);
      logSum += Math.log(norm);
      linSum += norm;
    }

    const avgVoiceEnergy = voiceBinCount > 0 ? voiceEnergy / voiceBinCount : 0;

    // Whisper band energy
    let whisperEnergy = 0;
    let whisperCount = 0;
    for (let i = minWhisperBin; i <= maxWhisperBin; i++) {
      whisperEnergy += freqData[i];
      whisperCount++;
    }
    const avgWhisperEnergy = whisperCount > 0 ? whisperEnergy / whisperCount : 0;

    // Rumble energy (<80Hz)
    let rumbleEnergy = 0;
    let rumbleCount = 0;
    for (let i = 0; i <= rumbleMaxBin && i < binCount; i++) {
      rumbleEnergy += freqData[i];
      rumbleCount++;
    }
    const avgRumbleEnergy = rumbleCount > 0 ? rumbleEnergy / rumbleCount : 0;

    // High hiss energy (>6000Hz)
    let hissEnergy = 0;
    let hissCount = 0;
    for (let i = hissMinBin; i < binCount; i++) {
      hissEnergy += freqData[i];
      hissCount++;
    }
    const avgHissEnergy = hissCount > 0 ? hissEnergy / hissCount : 0;

    // Spectral Flatness Measure (SFM)
    const geometricMean = Math.exp(logSum / Math.max(1, voiceBinCount));
    const arithmeticMean = linSum / Math.max(1, voiceBinCount);
    const spectralFlatness = arithmeticMean > 0 ? geometricMean / arithmeticMean : 1;

    // Peak-to-Average Ratio in vocal band
    const peakToAverageRatio = avgVoiceEnergy > 0 ? maxVoicePeak / avgVoiceEnergy : 1;

    // Dynamic Temporal Envelope Variance:
    // Speech syllables & intentional sounds have dynamic energy transitions; static/fan hum is steady.
    const energyDelta = Math.abs(avgVoiceEnergy - this.prevVoiceEnergy);
    this.prevVoiceEnergy = avgVoiceEnergy;
    this.energyDeltaHistory.push(energyDelta);
    if (this.energyDeltaHistory.length > 8) this.energyDeltaHistory.shift();
    const avgEnergyDelta = this.energyDeltaHistory.reduce((a, b) => a + b, 0) / this.energyDeltaHistory.length;

    // Adaptive noise floor tracking (adapts to room background noise / fan / preamp hum)
    if (avgVoiceEnergy < this.noiseFloor * 1.2 || (spectralFlatness > 0.8 && avgEnergyDelta < 1.0)) {
      this.noiseFloor = this.noiseFloor * 0.94 + avgVoiceEnergy * 0.06;
    } else {
      this.noiseFloor = this.noiseFloor * 0.998 + avgVoiceEnergy * 0.002;
    }
    this.noiseFloor = Math.max(2, Math.min(35, this.noiseFloor));

    // Signal-to-Noise Ratio (SNR) in vocal band
    const snr = avgVoiceEnergy - this.noiseFloor;

    // Static & Background Noise Detection:
    // 1. Completely flat spectrum with low peak-to-average ratio and low delta = stationary hiss/fan
    const isFlatStatic = spectralFlatness > 0.82 && peakToAverageRatio < 1.4 && avgEnergyDelta < 1.5;
    // 2. Rumble or extreme hiss dominated = mic handling or fan airflow
    const isRumbleOrHiss = (avgRumbleEnergy > avgVoiceEnergy * 3.0 && avgVoiceEnergy < 20) ||
                          (avgHissEnergy > avgVoiceEnergy * 2.5 && avgVoiceEnergy < 20);
    // 3. Very low peak without vocal formants = noise floor
    const isBelowNoiseThreshold = snr < 1.2 && maxVoicePeak < 14;

    const isNoiseOnly = isFlatStatic || isRumbleOrHiss || isBelowNoiseThreshold;

    // Real Human Voice & Intentional Sound Detection:
    // A. Normal to Loud Speech: distinct vocal resonance peaks above noise floor
    const isSpeech = !isNoiseOnly && (
      (snr > 2.2 && maxVoicePeak >= 16 && spectralFlatness < 0.78) ||
      (avgVoiceEnergy > 16 && maxVoicePeak >= 22)
    );

    // B. Whispering: unvoiced speech with energy in whisper band and dynamic variation
    const isWhisper = !isNoiseOnly && (
      (avgWhisperEnergy > this.noiseFloor * 1.1 && maxVoicePeak >= 12 && avgEnergyDelta > 0.4) ||
      (snr > 1.2 && maxVoicePeak >= 14 && spectralFlatness < 0.8)
    );

    // C. Music, instruments, singing, soundboards, laughter, shouts & intentional audio / any noise
    const isIntentionalSound = !isFlatStatic && !isRumbleOrHiss && (
      (avgVoiceEnergy > this.noiseFloor * 1.15 && maxVoicePeak >= 16) ||
      maxVoicePeak >= 22 ||
      (avgEnergyDelta > 3.0 && avgVoiceEnergy > 10)
    );

    const isVoiceInstant = isSpeech || isWhisper || isIntentionalSound;

    if (isVoiceInstant) {
      this.speechCounter = Math.min(5, this.speechCounter + 1);
    } else {
      this.speechCounter = Math.max(0, this.speechCounter - 1);
    }

    // Trigger on first frame of verified voice or sound for immediate visual feedback
    const isTriggered = this.speechCounter >= 1;

    if (isTriggered) {
      this.hangoverRemaining = 12; // Hold light for ~280-300ms so words don't flicker between syllables
      this.isSpeakingState = true;
    } else if (this.hangoverRemaining > 0) {
      this.hangoverRemaining--;
      this.isSpeakingState = true;
    } else {
      this.isSpeakingState = false;
    }

    const confidence = Math.min(100, Math.max(0, Math.round((snr / 20) * 100)));
    const energy = Math.min(100, Math.round((avgVoiceEnergy / 90) * 100));

    return {
      isSpeaking: this.isSpeakingState,
      confidence,
      energy,
      isNoiseOnly,
    };
  }

  public reset() {
    this.speechCounter = 0;
    this.hangoverRemaining = 0;
    this.isSpeakingState = false;
    this.prevVoiceEnergy = 0;
    this.energyDeltaHistory = [];
  }
}
