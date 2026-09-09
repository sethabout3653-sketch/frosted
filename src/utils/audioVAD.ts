// Intelligent Noise vs. Voice Activity Detection (VAD) Engine
// Sensitive to human voice (whispering, normal talking, and loud speech) while distinguishing stationary background noise.

export type SpeechIntensity = "whispering" | "talking" | "loud" | "none";

export class SmartVoiceDetector {
  private noiseFloor: number = 6; // Running adaptive noise floor
  private speechCounter: number = 0; // Number of consecutive speech frames
  private hangoverRemaining: number = 0; // Frames to hold active state after speech stops
  private isSpeakingState: boolean = false;
  private currentIntensity: SpeechIntensity = "none";

  constructor() {}

  /**
   * Evaluates frequency data from an AnalyserNode to determine if the sound is human speech (whisper/talk/loud) or noise.
   * @param freqData Uint8Array of byte frequency data from Web Audio AnalyserNode
   * @param sampleRate AudioContext sample rate (typically 44100 or 48000)
   * @returns { isSpeaking: boolean, intensity: SpeechIntensity, confidence: number, energy: number, isNoiseOnly: boolean }
   */
  public analyze(freqData: Uint8Array, sampleRate: number = 48000): {
    isSpeaking: boolean;
    intensity: SpeechIntensity;
    confidence: number;
    energy: number;
    isNoiseOnly: boolean;
  } {
    const binCount = freqData.length;
    const binWidth = (sampleRate / 2) / Math.max(1, binCount);

    // Human Vocal band: ~150Hz to ~3800Hz (captures deep voices through quiet whisper harmonics)
    const minVoiceBin = Math.max(1, Math.floor(150 / binWidth));
    const maxVoiceBin = Math.min(binCount - 1, Math.ceil(3800 / binWidth));

    // Whisper & fricative band: ~1000Hz to ~3500Hz
    const minWhisperBin = Math.max(1, Math.floor(1000 / binWidth));
    const maxWhisperBin = Math.min(binCount - 1, Math.ceil(3500 / binWidth));

    // Low rumble noise band: < 90Hz
    const rumbleMaxBin = Math.max(1, Math.floor(90 / binWidth));
    // Extreme high hiss noise band: > 6000Hz
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

    // Rumble energy (<90Hz)
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

    // Peak-to-Average Ratio
    const peakToAverageRatio = avgVoiceEnergy > 0 ? maxVoicePeak / avgVoiceEnergy : 1;

    // Adaptive noise floor tracking
    if (avgVoiceEnergy < this.noiseFloor * 1.3 || spectralFlatness > 0.8) {
      this.noiseFloor = this.noiseFloor * 0.94 + avgVoiceEnergy * 0.06;
    } else {
      this.noiseFloor = this.noiseFloor * 0.998 + avgVoiceEnergy * 0.002;
    }
    this.noiseFloor = Math.max(2, Math.min(35, this.noiseFloor));

    // Signal-to-Noise Ratio (SNR)
    const snr = avgVoiceEnergy - this.noiseFloor;

    // Detect if pure stationary background noise
    const isStationaryNoise = spectralFlatness > 0.82 && peakToAverageRatio < 1.4 && maxVoicePeak < 20;
    const isExtremeRumble = avgRumbleEnergy > avgVoiceEnergy * 3.0 && avgVoiceEnergy < 20;
    const isNoiseOnly = (isStationaryNoise || isExtremeRumble || snr < 1.5) && maxVoicePeak < 15;

    // 1. Whisper Detection:
    // Low total volume but clear energy in voice/whisper frequency band
    const isWhispering = !isNoiseOnly && (
      (snr > 2.0 && maxVoicePeak >= 12 && avgWhisperEnergy > this.noiseFloor * 1.15) ||
      (maxVoicePeak >= 16 && avgVoiceEnergy > this.noiseFloor + 2.5)
    );

    // 2. Normal Talking:
    const isNormalTalking = !isNoiseOnly && (
      (snr > 5.0 && maxVoicePeak >= 22) ||
      (avgVoiceEnergy > 16 && maxVoicePeak >= 26)
    );

    // 3. Loud Talking / Shouting:
    const isLoudTalking = !isNoiseOnly && (
      (snr > 16 && maxVoicePeak >= 45) ||
      avgVoiceEnergy > 38 ||
      maxVoicePeak >= 65
    );

    const isVoiceInstant = isWhispering || isNormalTalking || isLoudTalking;

    if (isVoiceInstant) {
      this.speechCounter = Math.min(8, this.speechCounter + 1);
    } else {
      this.speechCounter = Math.max(0, this.speechCounter - 1);
    }

    // Require 1 frame for whisper/voice activation to ensure ultra-low latency responsiveness
    const isTriggered = this.speechCounter >= 1;

    if (isTriggered) {
      this.hangoverRemaining = isLoudTalking ? 15 : isNormalTalking ? 12 : 8; // Hangover hold
      this.isSpeakingState = true;
      if (isLoudTalking) {
        this.currentIntensity = "loud";
      } else if (isNormalTalking) {
        this.currentIntensity = "talking";
      } else {
        this.currentIntensity = "whispering";
      }
    } else if (this.hangoverRemaining > 0) {
      this.hangoverRemaining--;
      this.isSpeakingState = true;
    } else {
      this.isSpeakingState = false;
      this.currentIntensity = "none";
    }

    const confidence = Math.min(100, Math.max(0, Math.round((snr / 30) * 100)));
    const energy = Math.min(100, Math.round((avgVoiceEnergy / 100) * 100));

    return {
      isSpeaking: this.isSpeakingState,
      intensity: this.currentIntensity,
      confidence,
      energy,
      isNoiseOnly,
    };
  }

  public reset() {
    this.speechCounter = 0;
    this.hangoverRemaining = 0;
    this.isSpeakingState = false;
    this.currentIntensity = "none";
  }
}
