/**
 * Alarm Sound Service
 *
 * Plays the audible alarm for detections and manual emergency triggers.
 *
 * Fixes applied in this revision:
 *  - Volume is applied once, at the player. It was previously baked into the
 *    synthesised PCM *and* passed to the player, so the effective gain was
 *    volume^2 and a 0.8 setting played at 0.64.
 *  - playAlarm() is guarded by an in-flight token. Concurrent calls used to
 *    interleave `stopAlarm -> create -> assign`, orphaning an Audio.Sound that
 *    kept playing forever and leaking a native resource per detection.
 *  - Vibration respects the user's notification settings. It previously fired
 *    unconditionally, so a user who disabled vibration still got buzzed.
 *  - The repeat loop uses a timer rather than nested playback callbacks, which
 *    stopped reliably instead of racing the player.
 */

import type { AlarmSoundType } from '@/types';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { Vibration } from 'react-native';
import { getSound } from './soundGenerator';

export interface AlarmSound {
  id: AlarmSoundType;
  name: string;
  description: string;
  /** Vibration pattern for each sound type (used alongside audio). */
  vibrationPattern: number[];
}

export const ALARM_SOUNDS: AlarmSound[] = [
  {
    id: 'urgent',
    name: 'Urgent Alarm',
    description: 'High-priority emergency alarm',
    vibrationPattern: [0, 200, 100, 200, 100, 200, 100, 400],
  },
  {
    id: 'siren',
    name: 'Siren',
    description: 'Alternating siren sound',
    vibrationPattern: [0, 500, 200, 500, 200, 500],
  },
  {
    id: 'alert',
    name: 'Alert',
    description: 'Standard security alert',
    vibrationPattern: [0, 300, 150, 300, 150, 300],
  },
  {
    id: 'chime',
    name: 'Chime',
    description: 'Gentle notification chime',
    vibrationPattern: [0, 100, 100, 100],
  },
  {
    id: 'beep',
    name: 'Beep',
    description: 'Simple beep sound',
    vibrationPattern: [0, 150, 100, 150],
  },
  {
    id: 'heavy',
    name: 'Heavy Alarm',
    description: 'MAXIMUM VOLUME - Intense alarm',
    vibrationPattern: [0, 1000, 200, 1000, 200, 1000],
  },
  {
    id: 'sos',
    name: 'Emergency SOS',
    description: 'Distress pattern for manual emergency alerts',
    vibrationPattern: [
      0, 200, 100, 200, 100, 200, 200, 500, 200, 500, 200, 500,
    ],
  },
  {
    id: 'custom',
    name: 'Custom sound',
    description: 'Your own recording or an audio file you chose',
    vibrationPattern: [0, 500, 250, 500, 250, 500],
  },
];

export interface PlayAlarmOptions {
  /** Playback volume, 0..1. Applied by the player, not baked into the audio. */
  volume?: number;
  /** Play the sound more than once. */
  repeat?: boolean;
  /** Total plays when `repeat` is true. */
  repeatCount?: number;
  /** Whether to vibrate alongside the sound. */
  vibrate?: boolean;
}

const FALLBACK_ALARM: AlarmSound = {
  id: 'alert',
  name: 'Alert',
  description: 'Standard security alert',
  vibrationPattern: [0, 300, 150, 300, 150, 300],
};

/** Gap between repeats of a non-repeating-then-looping alarm. */
const REPEAT_GAP_MS = 250;

/**
 * Resolve the audio source for a sound type.
 *
 * For 'custom' this returns the user's imported file when one exists. A missing
 * or unplayable custom file deliberately falls back to the standard 'alert'
 * tone: during a real intrusion, playing nothing because the user's chosen file
 * went missing is the worst possible failure mode.
 */
async function resolveAudioSource(
  soundType: AlarmSoundType,
  generated: string,
): Promise<string> {
  if (soundType !== 'custom') return generated;

  try {
    const { getCustomAlarmSound } = await import('./customAlarmSound');
    const custom = await getCustomAlarmSound();
    if (custom?.uri) {
      console.log('[AlarmService] Playing custom alarm sound');
      return custom.uri;
    }
  } catch (error) {
    console.warn('[AlarmService] Custom sound unavailable:', error);
  }

  console.warn(
    '[AlarmService] No custom sound set - falling back to standard alert',
  );
  return getSound('alert');
}

class AlarmService {
  private sound: Audio.Sound | null = null;
  private isPlaying = false;
  private initialized = false;
  /**
   * Monotonic token; a call whose token is stale on resume must not attach.
   */
  private playToken = 0;
  private repeatTimer: ReturnType<typeof setTimeout> | null = null;
  private currentVolume = 0.8;

  /**
   * Settings preview uses its own player and its own token, entirely separate
   * from the live alarm. Sharing `sound`/`playToken` meant previewing a sound
   * in settings called stopAlarm() and silenced a real intrusion alarm - the
   * opposite of what the preview is for.
   */
  private previewSoundInstance: Audio.Sound | null = null;
  private previewToken = 0;

  /**
   * Configure the audio session.
   *
   * `playsInSilentModeIOS` is required: users expect a security alarm to be
   * audible when the ringer switch is off. Android is handled via the
   * USAGE_ALARM stream.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        interruptionModeIOS: InterruptionModeIOS.DuckOthers,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
        playThroughEarpieceAndroid: false,
      });
      this.initialized = true;
    } catch (error) {
      console.error(
        '[AlarmService] Failed to initialize audio session:',
        error,
      );
    }
  }

  /**
   * Play an alarm sound with audio and optional vibration.
   */
  async playAlarm(
    soundType: AlarmSoundType = 'alert',
    options: PlayAlarmOptions = {},
  ): Promise<void> {
    const {
      volume = 0.8,
      repeat = false,
      repeatCount = 3,
      vibrate = true,
    } = options;

    await this.initialize();

    // Stop whatever is currently sounding, THEN claim the token.
    //
    // Order matters. stopAlarm() increments playToken to invalidate in-flight
    // calls, so claiming the token first and stopping afterwards guaranteed
    // `token !== this.playToken` and every alarm returned before playing.
    // There is no await between the two statements, so the claim is still
    // atomic with respect to other callers: if a newer call claims in between,
    // this one detects the stale token below and unloads itself.
    await this.stopAlarm();
    const token = ++this.playToken;

    this.isPlaying = true;
    this.currentVolume = clampVolume(volume);

    const soundConfig = findSound(soundType);
    const totalPlays = repeat ? Math.max(1, repeatCount) : 1;

    try {
      // A user-supplied file has no generated counterpart, so it must win over
      // the built-in tone. If it is missing we fall back rather than stay silent
      // during an intrusion.
      const audioUri = await resolveAudioSource(soundType, getSound(soundType));

      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUri },
        { volume: this.currentVolume, shouldPlay: true },
      );

      // A newer call may have started while we awaited creation. Unload our
      // player immediately rather than leaking it.
      if (token !== this.playToken) {
        await unloadQuietly(sound);
        return;
      }

      this.sound = sound;

      if (vibrate) {
        Vibration.vibrate(soundConfig.vibrationPattern);
      }

      let playsRemaining = totalPlays - 1;

      const scheduleNext = (): void => {
        this.repeatTimer = setTimeout(() => {
          this.repeatTimer = null;
          if (!this.isPlaying || playsRemaining <= 0) return;

          playsRemaining--;
          if (vibrate) {
            Vibration.vibrate(soundConfig.vibrationPattern);
          }
          sound.replayAsync().catch((error) => {
            console.error('[AlarmService] Replay failed:', error);
          });
          scheduleNext();
        }, REPEAT_GAP_MS);
      };

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          if (playsRemaining > 0 && this.isPlaying) {
            scheduleNext();
          } else {
            void this.stopAlarm();
          }
        }
      });
    } catch (error) {
      console.error('[AlarmService] Failed to play alarm audio:', error);
      // Audio failed; vibration (if requested) is the fallback so the alert
      // is still perceptible.
      if (vibrate) {
        Vibration.vibrate(soundConfig.vibrationPattern);
      }
      this.isPlaying = false;
    }
  }

  /**
   * Preview a sound from settings. Never repeats and never touches the live
   * alarm's player, state, or token, so it cannot interfere with an alarm that
   * is already sounding.
   *
   * A live alarm always wins: if one is playing the preview is skipped, since
   * it would be inaudible anyway and the alarm must not be disturbed.
   */
  async previewSound(
    soundType: AlarmSoundType,
    volume = 0.5,
    vibrate = false,
  ): Promise<void> {
    await this.initialize();

    if (this.isPlaying) {
      // Do not disturb a live alarm.
      return;
    }

    // Replace any previous preview only.
    const previousPreview = this.previewSoundInstance;
    this.previewSoundInstance = null;
    if (previousPreview) {
      await unloadQuietly(previousPreview);
    }

    const token = ++this.previewToken;
    const soundConfig = findSound(soundType);

    try {
      const audioUri = await resolveAudioSource(soundType, getSound(soundType));

      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUri },
        { volume: clampVolume(volume), shouldPlay: true },
      );

      // Superseded while creating, or an alarm started meanwhile: discard.
      if (token !== this.previewToken || this.isPlaying) {
        await unloadQuietly(sound);
        return;
      }

      this.previewSoundInstance = sound;

      if (vibrate) {
        Vibration.vibrate(soundConfig.vibrationPattern);
      }

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          void unloadQuietly(sound);
          if (this.previewSoundInstance === sound) {
            this.previewSoundInstance = null;
          }
        }
      });
    } catch (error) {
      console.error('[AlarmService] Failed to preview sound:', error);
    }
  }

  /**
   * Change the volume of the currently playing alarm without restarting it.
   */
  async setVolume(volume: number): Promise<void> {
    this.currentVolume = clampVolume(volume);
    if (this.sound) {
      try {
        await this.sound.setVolumeAsync(this.currentVolume);
      } catch (error) {
        console.error('[AlarmService] Failed to set volume:', error);
      }
    }
  }

  /**
   * Stop the alarm and release the player.
   *
   * Also silences any settings preview: when a real alarm fires it must be the
   * only thing audible.
   */
  async stopAlarm(): Promise<void> {
    // Invalidate any in-flight playAlarm so late resolutions clean up.
    this.playToken++;

    // Invalidate any in-flight preview too.
    this.previewToken++;

    if (this.repeatTimer) {
      clearTimeout(this.repeatTimer);
      this.repeatTimer = null;
    }

    Vibration.cancel();

    const sound = this.sound;
    this.sound = null;
    this.isPlaying = false;

    if (sound) {
      await unloadQuietly(sound);
    }

    const preview = this.previewSoundInstance;
    this.previewSoundInstance = null;
    if (preview) {
      await unloadQuietly(preview);
    }
  }

  isAlarmPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Release resources on app teardown.
   */
  async cleanup(): Promise<void> {
    await this.stopAlarm();
    this.initialized = false;
  }
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0.8;
  return Math.min(1, Math.max(0, volume));
}

function findSound(type: AlarmSoundType): AlarmSound {
  return ALARM_SOUNDS.find((s) => s.id === type) ?? FALLBACK_ALARM;
}

async function unloadQuietly(sound: Audio.Sound): Promise<void> {
  try {
    await sound.stopAsync();
  } catch {
    // Already stopped or unloaded; nothing to do.
  }
  try {
    await sound.unloadAsync();
  } catch {
    // Native handle may already be released.
  }
}

// Export singleton instance
export const alarmService = new AlarmService();

// Export convenience functions
export const playAlarm = alarmService.playAlarm.bind(alarmService);
export const stopAlarm = alarmService.stopAlarm.bind(alarmService);
export const previewSound = alarmService.previewSound.bind(alarmService);
