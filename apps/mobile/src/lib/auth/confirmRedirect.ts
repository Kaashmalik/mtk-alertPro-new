/**
 * Where the confirmation email should send the user.
 *
 * The professional flow is: email link -> real https page in the browser ->
 * "Open app" hand-off. That requires the web origin that serves the app, which
 * is a deployment fact rather than something to hardcode, so it comes from the
 * environment.
 *
 * When no web origin is configured (local dev, or a build that has not been
 * deployed to the web yet) this falls back to the app's custom scheme so the
 * link still lands in the app instead of a dead localhost page.
 *
 * @module lib/auth/confirmRedirect
 */

/** Must match the "scheme" in app.json. */
export const APP_SCHEME = 'mtkalertpro';

const CONFIRM_PATH = '/auth/confirm';

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * The origin serving the web build, or null when none is configured.
 * Trailing slashes and stray whitespace are tolerated because this is a value
 * a human types into an env file.
 */
export function getWebOrigin(): string | null {
  const raw = process.env.EXPO_PUBLIC_WEB_ORIGIN?.trim();
  if (!raw) return null;
  return stripTrailingSlash(raw) || null;
}

/**
 * Absolute URL the confirmation email should point at.
 *
 * A bare host like "example.com" is assumed to be https, which is what a real
 * deployment uses; anything already carrying a scheme is respected as-is.
 */
export function getConfirmRedirectUrl(): string {
  const origin = getWebOrigin();
  if (origin) {
    if (!/^https?:\/\//i.test(origin)) {
      return `https://${origin}${CONFIRM_PATH}`;
    }
    return `${origin}${CONFIRM_PATH}`;
  }
  return `${APP_SCHEME}://${CONFIRM_PATH.replace(/^\//, '')}`;
}

/** True when confirmation will hand off through a browser rather than a deep link. */
export function usesBrowserConfirmation(): boolean {
  return getWebOrigin() !== null;
}
