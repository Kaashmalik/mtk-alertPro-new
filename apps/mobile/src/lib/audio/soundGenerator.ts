/**
 * Sound Generator Utility
 * Generates audio tones programmatically as base64-encoded WAV data
 */

import type { AlarmSoundType } from '@/types';

// Audio generation parameters
const SAMPLE_RATE = 44100;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1;

/**
 * Generate a sine wave tone as base64-encoded WAV
 */
export function generateTone(
  frequency: number,
  durationMs: number,
  volume = 0.5,
): string {
  const numSamples = Math.floor((SAMPLE_RATE * durationMs) / 1000);
  const samples = new Int16Array(numSamples);

  const amplitude = Math.floor(32767 * Math.min(1, Math.max(0, volume)));

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    samples[i] = Math.floor(amplitude * Math.sin(2 * Math.PI * frequency * t));
  }

  return createWavBase64(samples);
}

/**
 * Generate an alarm sound with frequency sweep (siren-like)
 */
export function generateSiren(
  startFreq: number,
  endFreq: number,
  durationMs: number,
  volume = 0.5,
): string {
  const numSamples = Math.floor((SAMPLE_RATE * durationMs) / 1000);
  const samples = new Int16Array(numSamples);

  const amplitude = Math.floor(32767 * Math.min(1, Math.max(0, volume)));

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    const progress = i / numSamples;
    // Sweep frequency from start to end
    const currentFreq = startFreq + (endFreq - startFreq) * progress;
    samples[i] = Math.floor(
      amplitude * Math.sin(2 * Math.PI * currentFreq * t),
    );
  }

  return createWavBase64(samples);
}

/**
 * Generate a beep sequence
 */
export function generateBeepSequence(
  frequency: number,
  beepDurationMs: number,
  pauseDurationMs: number,
  beepCount: number,
  volume = 0.5,
): string {
  const beepSamples = Math.floor((SAMPLE_RATE * beepDurationMs) / 1000);
  const pauseSamples = Math.floor((SAMPLE_RATE * pauseDurationMs) / 1000);
  const totalSamples = (beepSamples + pauseSamples) * beepCount;
  const samples = new Int16Array(totalSamples);

  const amplitude = Math.floor(32767 * Math.min(1, Math.max(0, volume)));

  let sampleIndex = 0;
  for (let beep = 0; beep < beepCount; beep++) {
    // Generate beep
    for (let i = 0; i < beepSamples; i++) {
      const t = i / SAMPLE_RATE;
      samples[sampleIndex++] = Math.floor(
        amplitude * Math.sin(2 * Math.PI * frequency * t),
      );
    }
    // Generate pause (silence)
    for (let i = 0; i < pauseSamples; i++) {
      samples[sampleIndex++] = 0;
    }
  }

  return createWavBase64(samples);
}

/**
 * Generate an urgent alarm (alternating high tones)
 */
export function generateUrgentAlarm(volume = 0.5): string {
  const numCycles = 4;
  const highFreq = 880;
  const lowFreq = 660;
  const cycleDuration = 200; // ms per tone

  const samplesPerCycle = Math.floor((SAMPLE_RATE * cycleDuration) / 1000);
  const totalSamples = samplesPerCycle * numCycles * 2;
  const samples = new Int16Array(totalSamples);

  const amplitude = Math.floor(32767 * Math.min(1, Math.max(0, volume)));

  let sampleIndex = 0;
  for (let cycle = 0; cycle < numCycles; cycle++) {
    // High tone
    for (let i = 0; i < samplesPerCycle; i++) {
      const t = i / SAMPLE_RATE;
      samples[sampleIndex++] = Math.floor(
        amplitude * Math.sin(2 * Math.PI * highFreq * t),
      );
    }
    // Low tone
    for (let i = 0; i < samplesPerCycle; i++) {
      const t = i / SAMPLE_RATE;
      samples[sampleIndex++] = Math.floor(
        amplitude * Math.sin(2 * Math.PI * lowFreq * t),
      );
    }
  }

  return createWavBase64(samples);
}

/**
 * Generate the international SOS distress pattern (... --- ...) as tones.
 *
 * Dot = 150ms, dash = 450ms, intra-character gap = 150ms,
 * inter-character gap = 450ms, letter gap = 900ms.
 */
export function generateSos(volume = 1.0): string {
  const DOT = 150;
  const DASH = 450;
  const INTRA_GAP = 150;
  const LETTER_GAP = 900;
  const FREQ = 1200; // High, piercing tone that carries on a phone speaker

  // "SOS" = ... --- ...
  const letter: number[][] = [
    [DOT, DOT, DOT],
    [DASH, DASH, DASH],
    [DOT, DOT, DOT],
  ];

  const amplitude = Math.floor(32767 * Math.min(1, Math.max(0, volume)));

  // Pre-compute total length so the buffer is allocated exactly once.
  const totalMs = letter.reduce(
    (sum, marks) =>
      sum +
      marks.reduce((s, m) => s + m, 0) +
      INTRA_GAP * (marks.length - 1) +
      LETTER_GAP,
    0,
  );

  const samples = new Int16Array(Math.floor((SAMPLE_RATE * totalMs) / 1000));
  let sampleIndex = 0;

  const writeTone = (durationMs: number): void => {
    const count = Math.floor((SAMPLE_RATE * durationMs) / 1000);
    for (let i = 0; i < count && sampleIndex < samples.length; i++) {
      const t = i / SAMPLE_RATE;
      // Short attack/release ramps avoid an audible click at note edges.
      const envelope = Math.min(
        1,
        Math.min(i, count - i) / (SAMPLE_RATE * 0.005),
      );
      samples[sampleIndex++] = Math.floor(
        amplitude * envelope * Math.sin(2 * Math.PI * FREQ * t),
      );
    }
  };

  const writeSilence = (durationMs: number): void => {
    const count = Math.floor((SAMPLE_RATE * durationMs) / 1000);
    for (let i = 0; i < count && sampleIndex < samples.length; i++) {
      samples[sampleIndex++] = 0;
    }
  };

  letter.forEach((marks, letterIndex) => {
    marks.forEach((mark, markIndex) => {
      writeTone(mark);
      if (markIndex < marks.length - 1) writeSilence(INTRA_GAP);
    });
    if (letterIndex < letter.length - 1) writeSilence(LETTER_GAP);
  });

  return createWavBase64(samples);
}

/**
 * Generate a gentle chime sound
 */
export function generateChime(volume = 0.3): string {
  const frequencies = [523, 659, 784]; // C5, E5, G5 - C major chord
  const durationMs = 400;
  const numSamples = Math.floor((SAMPLE_RATE * durationMs) / 1000);
  const samples = new Int16Array(numSamples);

  const amplitude = Math.floor(
    (32767 * Math.min(1, Math.max(0, volume))) / frequencies.length,
  );

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    // Apply envelope (fade out)
    const envelope = 1 - i / numSamples;
    let sample = 0;

    for (const freq of frequencies) {
      sample += Math.sin(2 * Math.PI * freq * t);
    }

    samples[i] = Math.floor(amplitude * sample * envelope);
  }

  return createWavBase64(samples);
}

/**
 * Create WAV file header and convert samples to base64
 */
function createWavBase64(samples: Int16Array): string {
  const dataLength = samples.length * 2; // 2 bytes per sample (16-bit)
  const fileLength = 44 + dataLength; // Header (44 bytes) + data

  const buffer = new ArrayBuffer(fileLength);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, fileLength - 8, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Chunk size
  view.setUint16(20, 1, true); // Audio format (PCM)
  view.setUint16(22, NUM_CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * NUM_CHANNELS * (BITS_PER_SAMPLE / 8), true); // Byte rate
  view.setUint16(32, NUM_CHANNELS * (BITS_PER_SAMPLE / 8), true); // Block align
  view.setUint16(34, BITS_PER_SAMPLE, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Write samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(offset, samples[i], true);
    offset += 2;
  }

  // Convert to base64
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return `data:audio/wav;base64,${btoa(binary)}`;
}

/**
 * Helper to write string to DataView
 */
function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// Pre-generated sounds cache.
//
// Sounds are synthesised at FULL amplitude and cached once per type. Volume is
// applied at the audio player, not baked into the PCM. Previously volume was
// baked in AND passed to the player, which multiplied to volume^2 (a 0.8
// setting played at 0.64), and caching per volume re-synthesised the whole
// waveform for every distinct level.
let soundCache: Partial<Record<AlarmSoundType, string>> = {};

/**
 * Get or generate a sound by type.
 *
 * @param type - Sound to produce
 * @param volume - Retained for backwards compatibility and ignored. Playback
 *                 volume is controlled by the audio player via setVolumeAsync,
 *                 which allows live changes without re-synthesis.
 */
export function getSound(type: AlarmSoundType, _volume?: number): string {
  const cached = soundCache[type];
  if (cached) {
    return cached;
  }

  let sound: string;

  switch (type) {
    case 'urgent':
      sound = generateUrgentAlarm(1.0);
      break;
    case 'siren':
      sound = generateSiren(400, 800, 1000, 1.0);
      break;
    case 'alert':
      sound = generateBeepSequence(660, 200, 100, 3, 1.0);
      break;
    case 'chime':
      sound = generateChime(1.0);
      break;
    case 'beep':
      sound = generateTone(880, 300, 1.0);
      break;
    case 'heavy':
      // Heavy alarm: intense dual-tone siren at maximum intensity.
      sound = generateSiren(300, 1200, 1500, 1.0);
      break;
    case 'sos':
      // SOS: the international distress morse pattern (... --- ...) rendered
      // as tones. Deliberately distinct from every detection alarm so a user
      // can identify an emergency trigger by ear alone.
      sound = generateSos(1.0);
      break;
    default:
      sound = generateTone(440, 200, 1.0);
  }

  soundCache[type] = sound;
  return sound;
}

/**
 * Clear the sound cache
 */
export function clearSoundCache(): void {
  soundCache = {};
}
