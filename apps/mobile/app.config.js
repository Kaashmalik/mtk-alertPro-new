/**
 * Dynamic Expo config.
 *
 * `app.json` holds the static manifest. This file layers environment-specific
 * values on top of it so that build-varying values (AdMob unit IDs, SDK levels)
 * never have to be committed to source.
 *
 * Why this matters: ad unit IDs and API keys differ between dev/test and
 * production, and shipping Google's *test* App ID in a release build silently
 * breaks monetisation while still "working" locally.
 */

// Google's official test AdMob App IDs. Safe as a dev fallback; never ship these.
const ADMOB_TEST_ANDROID_APP_ID = 'ca-app-pub-3940256099942544~3347511713';
const ADMOB_TEST_IOS_APP_ID = 'ca-app-pub-3940256099942544~1458002511';

const { assertBuildInputs } = require('./plugins/verifyBuildInputs');

module.exports = ({ config }) => {
  // Fail the build here rather than shipping an APK that crashes on the splash
  // screen. See plugins/verifyBuildInputs.js for the two silent failure modes.
  assertBuildInputs(__dirname);

  const androidAdmobId = process.env.ADMOB_ANDROID_APP_ID;
  const iosAdmobId = process.env.ADMOB_IOS_APP_ID;

  // Drop dependency-injected permissions the app never uses (SYSTEM_ALERT_WINDOW
  // and legacy storage grants). app.json can only add permissions, so this has
  // to be a manifest-level opt-out. See plugins/withTrimmedPermissions.js.
  const withLocalPlugins = ['./plugins/withTrimmedPermissions'];

  const plugins = (config.plugins || []).map((plugin) => {
    if (
      Array.isArray(plugin) &&
      plugin[0] === 'react-native-google-mobile-ads'
    ) {
      return [
        plugin[0],
        {
          ...plugin[1],
          androidAppId: androidAdmobId || ADMOB_TEST_ANDROID_APP_ID,
          iosAppId: iosAdmobId || ADMOB_TEST_IOS_APP_ID,
        },
      ];
    }
    return plugin;
  });

  // Strip the bare string form of the ads plugin if it was used.
  const normalizedPlugins = plugins.map((plugin) =>
    plugin === 'react-native-google-mobile-ads'
      ? [
          'react-native-google-mobile-ads',
          {
            androidAppId: androidAdmobId || ADMOB_TEST_ANDROID_APP_ID,
            iosAppId: iosAdmobId || ADMOB_TEST_IOS_APP_ID,
            userTrackingPermission:
              'This app uses your advertising ID to show you relevant ads. You can opt out in settings.',
          },
        ]
      : plugin,
  );

  return {
    ...config,
    plugins: [...withLocalPlugins, ...normalizedPlugins],
    android: {
      ...config.android,
      // Google Play requires new apps and updates to target API 36 from 2026-08-31.
    },
    extra: {
      ...config.extra,
      // Remove committed placeholder secrets from the published config.
      revenuecatApiKey: undefined,
      sentryDsn: undefined,
      encryptionKey: undefined,
    },
  };
};
