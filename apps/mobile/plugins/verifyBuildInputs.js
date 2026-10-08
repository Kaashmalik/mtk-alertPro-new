/**
 * Build-input sanity checks.
 *
 * Two ways to ship a crashing APK without a single red error in the EAS log:
 *
 *  1. The app source never reaches the build machine. A `.easignore` rule with
 *     no interior slash (e.g. `src/`) matches every `src/` directory in the
 *     repo, so `apps/mobile/src/**` is dropped from the upload. Metro then
 *     bundles `expo-router/entry` with zero routes (≈950 modules instead of
 *     ≈3700), the build succeeds, and the APK dies right after the splash
 *     screen because there is no app code to render.
 *
 *  2. `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` are not
 *     inlined into the bundle, and `src/lib/supabase/client.ts` throws during
 *     module evaluation - again a fatal, redbox-less crash on a release build.
 *
 * Both are silent at build time and loud only at runtime, so they are checked
 * here, while `app.config.js` is evaluated on the machine that will do the
 * bundling.
 */

const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_ENV_KEYS = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
];

function envFileDeclares(key, file) {
  try {
    if (!fs.existsSync(file)) return false;
    if (/\.example$/i.test(file)) return false;
    return new RegExp(`^${key}\\s*=\\s*\\S`, 'm').test(
      fs.readFileSync(file, 'utf8'),
    );
  } catch {
    return false;
  }
}

function hasEnvValue(key, appRoot) {
  if (process.env[key]?.trim()) return true;

  let entries = [];
  try {
    entries = fs.readdirSync(appRoot);
  } catch {
    return false;
  }

  return entries.some(
    (name) =>
      name.startsWith('.env') && envFileDeclares(key, path.join(appRoot, name)),
  );
}

function collectProblems(appRoot) {
  const problems = [];

  if (!fs.existsSync(path.join(appRoot, 'src', 'app', '_layout.tsx'))) {
    problems.push(
      'apps/mobile/src was not uploaded to this build. Check the root ' +
        '.easignore for an unanchored "src/" (or similar) rule - it matches ' +
        'every src/ directory in the repo and strips the app source out of ' +
        'the bundle, which produces an APK that crashes on the splash screen.',
    );
  }

  const missingEnv = REQUIRED_ENV_KEYS.filter(
    (key) => !hasEnvValue(key, appRoot),
  );
  if (missingEnv.length > 0) {
    problems.push(
      `Missing ${missingEnv.join(' and ')}. They must be available while Metro bundles the app (an EAS environment variable, an eas.json "env" entry, or an uploaded .env file) - without them the Supabase client throws while the JS bundle is loading and the app crashes on launch.`,
    );
  }

  return problems;
}

function assertBuildInputs(appRoot) {
  const problems = collectProblems(appRoot);
  if (problems.length > 0) {
    throw new Error(
      `Refusing to build a crashing APK:\n${problems
        .map((problem) => ` - ${problem}`)
        .join('\n')}`,
    );
  }
}

module.exports = { REQUIRED_ENV_KEYS, collectProblems, assertBuildInputs };
