/**
 * Custom alarm sound storage.
 *
 * The built-in alarm tones are generated at runtime (see soundGenerator), which
 * means the user could not use a sound that actually matches their environment -
 * a dog barking, a klaxon, their own recorded voice. This copies a chosen or
 * recorded file into the app's document directory and stores that path, so the
 * sound survives reboots and reinstalls of the picker (a cache:// URI does not).
 *
 * @module lib/audio/customAlarmSound
 */

import { logError } from '@/lib/utils/errorHandler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

const CUSTOM_SOUND_KEY = 'custom-alarm-sound-uri';
const CUSTOM_SOUND_NAME_KEY = 'custom-alarm-sound-name';

/** Directory we own; files here are removed only when the user clears it. */
const CUSTOM_DIR = `${FileSystem.documentDirectory ?? ''}custom-alarm/`;

export interface CustomAlarmSound {
  uri: string;
  name: string;
}

async function ensureDir(): Promise<boolean> {
  if (!FileSystem.documentDirectory) return false;
  const info = await FileSystem.getInfoAsync(CUSTOM_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CUSTOM_DIR, { intermediates: true });
  }
  return true;
}

/** Audio extensions the alarm player can open. */
const SUPPORTED_EXTENSIONS = [
  '.m4a',
  '.mp3',
  '.aac',
  '.wav',
  '.aiff',
  '.caf',
  '.3gp',
  '.ogg',
];

/** Fallback for sources the picker returned without a usable extension. */
const DEFAULT_EXTENSION = '.m4a';

/** Strips any query string, so `foo.mp3?x=1` still resolves as `.mp3`. */
function pathOf(uri: string): string {
  return uri.split('?')[0].toLowerCase();
}

export function isSupportedAudioFile(uri: string): boolean {
  const target = pathOf(uri);
  return SUPPORTED_EXTENSIONS.some((ext) => target.endsWith(ext));
}

/**
 * Resolve the extension to store the file under. Picked assets often carry the
 * extension only in `name`, and a bare cache path may have none at all.
 */
function resolveExtension(source: string, displayName?: string): string {
  for (const candidate of [source, displayName ?? '']) {
    if (!candidate) continue;
    const target = pathOf(candidate);
    const match = SUPPORTED_EXTENSIONS.find((ext) => target.endsWith(ext));
    if (match) return match;
  }
  return DEFAULT_EXTENSION;
}

/**
 * Picker results are already absolute `file://` URIs; only a bare filesystem
 * path needs to be resolved against the cache directory. Prefixing a cache
 * directory onto an absolute `file://` path would produce an invalid URI.
 */
function resolveSource(sourceUri: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(sourceUri)) return sourceUri;
  return `${FileSystem.cacheDirectory ?? ''}${sourceUri.replace(/^\/+/, '')}`;
}

/**
 * Copy a picked/recorded audio file into permanent app storage.
 * @returns the stored sound, or null when the copy failed.
 */
export async function saveCustomAlarmSound(
  sourceUri: string,
  displayName?: string,
): Promise<CustomAlarmSound | null> {
  try {
    if (!(await ensureDir())) {
      console.warn('[CustomAlarm] No writable document directory');
      return null;
    }

    const source = resolveSource(sourceUri);
    const ext = resolveExtension(sourceUri, displayName);
    // Timestamp avoids clobbering a previously imported sound.
    const dest = `${CUSTOM_DIR}alarm-${Date.now()}${ext}`;

    await FileSystem.copyAsync({ from: source, to: dest });

    await AsyncStorage.setItem(CUSTOM_SOUND_KEY, dest);
    await AsyncStorage.setItem(
      CUSTOM_SOUND_NAME_KEY,
      displayName?.trim() ||
        `Custom sound (${ext.replace('.', '').toUpperCase()})`,
    );

    return { uri: dest, name: displayName?.trim() || 'Custom sound' };
  } catch (error) {
    logError(error, 'customAlarmSound.saveCustomAlarmSound');
    return null;
  }
}

/** The stored custom sound, or null when none is set. */
export async function getCustomAlarmSound(): Promise<CustomAlarmSound | null> {
  try {
    const uri = await AsyncStorage.getItem(CUSTOM_SOUND_KEY);
    if (!uri) return null;
    const name = await AsyncStorage.getItem(CUSTOM_SOUND_NAME_KEY);
    // The file may have been removed outside the app; treat that as "unset".
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      await clearCustomAlarmSound();
      return null;
    }
    return { uri, name: name ?? 'Custom sound' };
  } catch (error) {
    logError(error, 'customAlarmSound.getCustomAlarmSound');
    return null;
  }
}

/** Remove the stored sound file and its metadata. */
export async function clearCustomAlarmSound(): Promise<boolean> {
  try {
    const uri = await AsyncStorage.getItem(CUSTOM_SOUND_KEY);
    if (uri) {
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists) await FileSystem.deleteAsync(uri, { idempotent: true });
    }
    await AsyncStorage.multiRemove([CUSTOM_SOUND_KEY, CUSTOM_SOUND_NAME_KEY]);
    return true;
  } catch (error) {
    logError(error, 'customAlarmSound.clearCustomAlarmSound');
    return false;
  }
}
