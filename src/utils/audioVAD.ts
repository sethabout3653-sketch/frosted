// Robust Voice Activity Detection (VAD) Engine
// Discriminating stationary static, fan hum, and room noise from real human voice (whisper, speech, loud).

export class SmartVoiceDetector {
  private noiseFloor: number = 8; // Running adaptive noise floor
  private speechCounter: number = 0; // Number of consecutive speech frames
  private hangoverRemaining: number = 0; // Frames to hold active state after speech pauses
  private isSpeakingState: boolean = false;
  private prevVoiceEnergy: number = 0;
  private energyDeltaHistory: number[] = [];

  constructor() {}

  /**
   * Evaluates frequency data from an AnalyserNode to determine if sound is human speech vs background static.
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

    // Human Vocal band: ~150Hz to ~3600Hz
    const minVoiceBin = Math.max(1, Math.floor(150 / binWidth));
    const maxVoiceBin = Math.min(binCount - 1, Math.ceil(3600 / binWidth));

    // Whisper & fricative vocal band: ~900Hz to ~3400Hz
    const minWhisperBin = Math.max(1, Math.floor(900 / binWidth));
    const maxWhisperBin = Math.min(binCount - 1, Math.ceil(3400 / binWidth));

    // Low rumble noise band: < 90Hz
    const rumbleMaxBin = Math.max(1, Math.floor(90 / binWidth));
    // High hiss / static noise band: > 5800Hz
    const hissMinBin = Math.min(binCount - 1, Math.floor(5800 / binWidth));

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

    // Rumble energy (<90Hz)
    let rumbleEnergy = 0;
    let rumbleCount = 0;
    for (let i = 0; i <= rumbleMaxBin && i < binCount; i++) {
      rumbleEnergy += freqData[i];
      rumbleCount++;
    }
    const avgRumbleEnergy = rumbleCount > 0 ? rumbleEnergy / rumbleCount : 0;

    // High hiss energy (>5800Hz)
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
    // Speech syllables have dynamic energy transitions; static/fan hum is steady.
    const energyDelta = Math.abs(avgVoiceEnergy - this.prevVoiceEnergy);
    this.prevVoiceEnergy = avgVoiceEnergy;
    this.energyDeltaHistory.push(energyDelta);
    if (this.energyDeltaHistory.length > 8) this.energyDeltaHistory.shift();
    const avgEnergyDelta = this.energyDeltaHistory.reduce((a, b) => a + b, 0) / this.energyDeltaHistory.length;

    // Adaptive noise floor tracking (adapts to room background noise / fan / preamp hum)
    if (avgVoiceEnergy < this.noiseFloor * 1.25 || (spectralFlatness > 0.75 && avgEnergyDelta < 1.5)) {
      this.noiseFloor = this.noiseFloor * 0.92 + avgVoiceEnergy * 0.08;
    } else {
      this.noiseFloor = this.noiseFloor * 0.998 + avgVoiceEnergy * 0.002;
    }
    this.noiseFloor = Math.max(3, Math.min(40, this.noiseFloor));

    // Signal-to-Noise Ratio (SNR) in vocal band
    const snr = avgVoiceEnergy - this.noiseFloor;

    // Static & Background Noise Detection:
    // 1. Completely flat spectrum with low peak-to-average ratio and low delta = stationary hiss/fan
    const isFlatStatic = spectralFlatness > 0.78 && peakToAverageRatio < 1.45 && avgEnergyDelta < 2.0;
    // 2. Rumble or extreme hiss dominated = mic handling or fan airflow
    const isRumbleOrHiss = (avgRumbleEnergy > avgVoiceEnergy * 2.5 && avgVoiceEnergy < 25) ||
                          (avgHissEnergy > avgVoiceEnergy * 2.0 && avgVoiceEnergy < 25);
    // 3. Very low peak without vocal formants = noise floor
    const isBelowNoiseThreshold = snr < 2.0 && maxVoicePeak < 18;

    const isNoiseOnly = isFlatStatic || isRumbleOrHiss || isBelowNoiseThreshold;

    // Real Human Voice Detection:
    // A. Normal to Loud Speech: distinct vocal resonance peaks above noise floor
    const isSpeech = !isNoiseOnly && (
      (snr > 3.5 && maxVoicePeak >= 20 && spectralFlatness < 0.72) ||
      (avgVoiceEnergy > 22 && maxVoicePeak >= 28)
    );

    // B. Whispering: unvoiced speech with higher energy in 900Hz-3.4kHz whisper band and dynamic variation
    const isWhisper = !isNoiseOnly && (
      (avgWhisperEnergy > this.noiseFloor * 1.12 && maxVoicePeak >= 14 && avgEnergyDelta > 0.6) ||
      (snr > 1.8 && maxVoicePeak >= 16 && spectralFlatness < 0.75)
    );

    const isVoiceInstant = isSpeech || isWhisper;

    if (isVoiceInstant) {
      this.speechCounter = Math.min(6, this.speechCounter + 1);
    } else {
      this.speechCounter = Math.max(0, this.speechCounter - 1);
    }

    // Trigger on first frame of verified voice for ultra-low latency response
    const isTriggered = this.speechCounter >= 1;

    if (isTriggered) {
      this.hangoverRemaining = 12; // Hold light for ~300ms so words don't flicker between syllables
      this.isSpeakingState = true;
    } else if (this.hangoverRemaining > 0) {
      this.hangoverRemaining--;
      this.isSpeakingState = true;
    } else {
      this.isSpeakingState = false;
    }

    const confidence = Math.min(100, Math.max(0, Math.round((snr / 25) * 100)));
    const energy = Math.min(100, Math.round((avgVoiceEnergy / 100) * 100));

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
