/**
 * Password Encryption Utility
 *
 * Design notes
 * ------------
 * Camera passwords are the highest-value secret this app holds: anyone who has
 * them can view a user's home CCTV feed. They are encrypted at rest before
 * being written to Supabase.
 *
 * Key hierarchy (first match wins):
 *   1. A per-install device key in `expo-secure-store` (Android Keystore /
 *      iOS Keychain backed). Generated on first launch, never leaves the device.
 *   2. `EXPO_PUBLIC_ENCRYPTION_KEY` as a fallback for environments where
 *      SecureStore is unavailable (e.g. the Jest/node test environment).
 *
 * The device key is loaded once via `initializeEncryption()` during bootstrap
 * and cached in module scope so the encrypt/decrypt API can stay synchronous.
 *
 * IMPORTANT: `EXPO_PUBLIC_*` variables are inlined into the JS bundle by Metro
 * and are therefore extractable from a published APK/IPA. That is why SecureStore
 * is the primary key source. Even so, client-side encryption is defence in depth
 * only — a determined attacker with root can read process memory. The real fix is
 * to move camera credential storage to a server-side vault, which is out of scope
 * here but is the correct long-term architecture.
 *
 * Ciphertext format:
 *   v2:<base64(iv)>:<base64(ciphertext)>   AES-256-CBC, random 16-byte IV,
 *                                          key = SHA-256(device key)
 *   U2FsdGVk...                            legacy CryptoJS passphrase format,
 *                                          read-only (still decryptable so
 *                                          existing stored credentials survive)
 *
 * @module lib/crypto/encryption
 */

import CryptoJS from 'crypto-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const DEVICE_KEY_ALIAS = 'mtk_camera_encryption_key';
const V2_PREFIX = 'v2:';

// Populated by initializeEncryption(). Null until bootstrap completes.
let deviceKey: string | null = null;

/**
 * Fallback key from the environment. Used for tests and as a safety net when
 * SecureStore is unavailable. NOT secret — it ships inside the bundle.
 */
const ENV_KEY =
  process.env.EXPO_PUBLIC_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || '';

// Warn once so a missing key is visible without spamming the console.
let hasWarnedMissingKey = false;
function warnMissingKeyOnce(): void {
  if (hasWarnedMissingKey) return;
  hasWarnedMissingKey = true;
  console.warn(
    '[Encryption] No device key available. Falling back to the environment key. ' +
      'Call initializeEncryption() during bootstrap, and note that EXPO_PUBLIC_* ' +
      'values are extractable from the published bundle.',
  );
}

/**
 * Load (or create) the per-install device key and cache it for synchronous use.
 * Safe to call multiple times; only the first call performs I/O.
 *
 * Call this once during app bootstrap, before any camera is added.
 */
export async function initializeEncryption(): Promise<void> {
  if (deviceKey) return;

  // SecureStore is a native module; the node test environment has no native
  // implementation, so guard rather than crash.
  if (
    Platform.OS === 'web' ||
    typeof SecureStore?.setItemAsync !== 'function'
  ) {
    if (!deviceKey) deviceKey = ENV_KEY || null;
    return;
  }

  try {
    const existing = await SecureStore.getItemAsync(DEVICE_KEY_ALIAS);
    if (existing) {
      deviceKey = existing;
      return;
    }

    const generated = generateRandomKey(32);
    await SecureStore.setItemAsync(DEVICE_KEY_ALIAS, generated, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    deviceKey = generated;
  } catch (error) {
    // A locked or unavailable keystore must not brick the app; degrade to the
    // environment key and surface the failure loudly.
    console.error(
      '[Encryption] SecureStore unavailable, using environment key:',
      error,
    );
    deviceKey = ENV_KEY || null;
  }
}

/**
 * Resolve the active encryption key.
 * Throws if no key is available — failing loudly is safer than writing
 * plaintext credentials to the database.
 */
function getEncryptionKey(): string {
  const key = deviceKey || ENV_KEY;
  if (!key) {
    throw new Error(
      'CRITICAL SECURITY ERROR: Encryption key not configured. ' +
        'Call initializeEncryption() during bootstrap or set EXPO_PUBLIC_ENCRYPTION_KEY. ' +
        'Camera passwords cannot be stored without encryption.',
    );
  }
  // Falling back to the env key means the "per-install" device key was never
  // provisioned, so the ciphertext is only as private as a value baked into
  // the published bundle. Surface that exactly once.
  if (!deviceKey) {
    warnMissingKeyOnce();
  }
  return key;
}

/**
 * Derive a fixed 256-bit key from the (possibly short) device key.
 * SHA-256 gives a deterministic 32-byte key for use as raw AES-256 material.
 */
function deriveKey(key: string): CryptoJS.lib.WordArray {
  return CryptoJS.SHA256(key);
}

function toBase64(wordArray: CryptoJS.lib.WordArray): string {
  return CryptoJS.enc.Base64.stringify(wordArray);
}

function fromBase64(value: string): CryptoJS.lib.WordArray {
  return CryptoJS.enc.Base64.parse(value);
}

/**
 * Encrypt a password using AES-256-CBC with a random IV.
 *
 * @param password - Plain text password
 * @param salt - Binding context (typically the user ID). Prevents a ciphertext
 *               lifted from one row being replayed into another.
 * @returns Ciphertext in `v2:` format
 */
export function encryptPassword(password: string, salt: string): string {
  if (!password) {
    throw new Error('Password is required for encryption');
  }
  if (!salt) {
    throw new Error('Salt is required for encryption');
  }

  try {
    const key = deriveKey(getEncryptionKey());

    // Random IV per encryption. Reusing an IV with the same key under CBC
    // leaks relationships between plaintexts, so this must not be a constant.
    const iv = CryptoJS.lib.WordArray.random(16);

    const encrypted = CryptoJS.AES.encrypt(
      CryptoJS.enc.Utf8.parse(`${salt}:${password}`),
      key,
      {
        iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      },
    );

    return `${V2_PREFIX}${toBase64(iv)}:${toBase64(encrypted.ciphertext)}`;
  } catch (error) {
    console.error('[Encryption] Failed to encrypt password:', error);
    throw new Error('Encryption failed');
  }
}

/**
 * Decrypt a password. Handles both the current `v2:` format and the legacy
 * CryptoJS passphrase format so previously stored credentials keep working.
 *
 * @param encryptedPassword - Ciphertext produced by encryptPassword
 * @param salt - The same salt used during encryption
 * @returns The original plain text password
 */
export function decryptPassword(
  encryptedPassword: string,
  salt: string,
): string {
  if (!encryptedPassword) {
    throw new Error('Encrypted password is required for decryption');
  }
  if (!salt) {
    throw new Error('Salt is required for decryption');
  }

  const saltPrefix = `${salt}:`;

  try {
    if (encryptedPassword.startsWith(V2_PREFIX)) {
      const [, ivB64, cipherB64] = encryptedPassword.split(':');
      if (!ivB64 || !cipherB64) {
        throw new Error('Malformed v2 ciphertext');
      }

      const key = deriveKey(getEncryptionKey());
      const decryptedBytes = CryptoJS.AES.decrypt(
        CryptoJS.lib.CipherParams.create({
          ciphertext: fromBase64(cipherB64),
        }),
        key,
        {
          iv: fromBase64(ivB64),
          mode: CryptoJS.mode.CBC,
          padding: CryptoJS.pad.Pkcs7,
        },
      );

      const decrypted = decryptedBytes.toString(CryptoJS.enc.Utf8);
      if (!decrypted) {
        throw new Error('Decryption produced empty result');
      }
      if (!decrypted.startsWith(saltPrefix)) {
        throw new Error('Invalid salt - decryption failed');
      }
      return decrypted.substring(saltPrefix.length);
    }

    // Legacy: CryptoJS passphrase mode.
    //
    // Legacy rows were encrypted with the environment key, NOT the per-install
    // SecureStore key. Trying only the active key meant that as soon as
    // initializeEncryption() generated a device key, every previously stored
    // camera password became undecryptable - a silent data-loss regression on
    // upgrade.
    //
    // The legacy envelope carries no key id, so each candidate is tried in
    // turn. The salt prefix check below is a strong verifier: a wrong key
    // yields garbage that will not start with `${salt}:`, so a false positive
    // is not possible.
    const candidates = legacyKeyCandidates();

    for (const candidate of candidates) {
      const decrypted = tryDecryptLegacy(
        encryptedPassword,
        candidate,
        saltPrefix,
      );
      if (decrypted !== null) {
        return decrypted;
      }
    }

    throw new Error('Decryption produced empty result');
  } catch (error) {
    console.error('[Encryption] Failed to decrypt password:', error);
    throw new Error('Decryption failed - invalid key or corrupted data');
  }
}

/**
 * Keys that a legacy ciphertext might have been produced with, most likely
 * first. The environment key leads because that is what every pre-v2 build
 * used; the active key is included so a partially-migrated install still reads.
 */
function legacyKeyCandidates(): string[] {
  const candidates: string[] = [];
  if (ENV_KEY) candidates.push(ENV_KEY);
  try {
    const active = getEncryptionKey();
    if (!candidates.includes(active)) candidates.push(active);
  } catch {
    // No active key configured; the environment key alone is still worth trying.
  }
  return candidates;
}

/**
 * Attempt one legacy decryption. Returns the password, or null if this key
 * does not decrypt the value.
 */
function tryDecryptLegacy(
  encryptedPassword: string,
  key: string,
  saltPrefix: string,
): string | null {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedPassword, key);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    if (!decrypted || !decrypted.startsWith(saltPrefix)) {
      return null;
    }
    return decrypted.substring(saltPrefix.length);
  } catch {
    return null;
  }
}

/**
 * Create a SHA-256 hash of a string.
 * Useful for comparing values without storing them.
 */
export function hashString(value: string): string {
  if (!value) {
    throw new Error('Value is required for hashing');
  }
  return CryptoJS.SHA256(value).toString(CryptoJS.enc.Hex);
}

/**
 * Generate a cryptographically random hex string.
 *
 * @param length - Length in BYTES (default 32 → 64 hex characters)
 */
export function generateRandomKey(length = 32): string {
  return CryptoJS.lib.WordArray.random(length).toString(CryptoJS.enc.Hex);
}

/**
 * Check whether a value is already encrypted.
 *
 * Recognises both the current `v2:` format and the legacy OpenSSL-compatible
 * base64 envelope. The check is deliberately strict: a loose base64-charset
 * test would treat plain alphanumeric passwords (e.g. "hunter2") as encrypted
 * and skip encryption entirely, leaving plaintext credentials in the database.
 */
export function isEncrypted(value: string): boolean {
  if (!value) return false;
  return value.startsWith(V2_PREFIX) || value.startsWith('U2FsdGVk');
}

/**
 * Test seam: reset the cached device key. Used by tests only.
 */
export function __resetDeviceKeyForTests(): void {
  deviceKey = null;
  hasWarnedMissingKey = false;
}
