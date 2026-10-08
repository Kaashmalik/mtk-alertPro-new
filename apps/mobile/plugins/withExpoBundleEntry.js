const {
  withAppBuildGradle,
  createRunOncePlugin,
} = require('expo/config-plugins');

const MARKER = '// mtk-expo-entry-override';

/**
 * Expo resolves `--entry-file` against the monorepo root (repo root), but the
 * React Native Gradle plugin emits that argument relative to `react.root`
 * (`apps/mobile`). The relative path therefore resolves above the repository and
 * Metro fails with:
 *
 *   Unable to resolve module ./../../node_modules/expo-router/entry.js
 *     from D:\MalikTech\mtk-alert-pro/.
 *
 * We append a second, absolute `--entry-file` to `extraPackagerArgs`. Because
 * those args are emitted *after* the plugin's own `--entry-file` and Expo's
 * parser keeps the last occurrence, the absolute path wins. Absolute paths are
 * independent of whatever root the CLI decides to resolve against.
 */
function withExpoBundleEntry(config) {
  return withAppBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language !== 'groovy') {
      throw new Error(
        'withExpoBundleEntry: can only modify Groovy build.gradle files.',
      );
    }

    const contents = modConfig.modResults.contents;

    if (contents.includes(MARKER)) {
      return modConfig;
    }

    const anchor = 'bundleCommand = "export:embed"';

    if (!contents.includes(anchor)) {
      throw new Error(
        'withExpoBundleEntry: could not find the "bundleCommand" anchor in app/build.gradle.',
      );
    }

    const snippet = `
    ${anchor}

    ${MARKER}
    def mtkExpoEntry = ["node", "-e", "require('expo/scripts/resolveAppEntry')", projectRoot, "android", "absolute"].execute(null, rootDir).text.trim()
    extraPackagerArgs.add("--entry-file")
    extraPackagerArgs.add(mtkExpoEntry)`;

    modConfig.modResults.contents = contents.replace(anchor, snippet);
    return modConfig;
  });
}

module.exports = createRunOncePlugin(
  withExpoBundleEntry,
  'mtk-expo-entry-override',
  '1.0.0',
);
