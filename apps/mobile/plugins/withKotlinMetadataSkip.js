const {
  withProjectBuildGradle,
  createRunOncePlugin,
} = require('expo/config-plugins');

const MARKER = '// mtk-kotlin-metadata-skip';

/**
 * Google Mobile Ads 25.4 (pulled in by react-native-google-mobile-ads) ships
 * Kotlin 2.3 metadata. The project compiles with Kotlin 2.1.x, so the compiler
 * refuses to read those modules unless the metadata version check is skipped.
 *
 * Injected into the root `build.gradle` `subprojects` block so it also applies to
 * autolinked native modules living in node_modules.
 */
function withKotlinMetadataSkip(config) {
  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error(
        'withKotlinMetadataSkip: can only modify Groovy build.gradle files.',
      );
    }

    const contents = config.modResults.contents;

    if (contents.includes(MARKER)) {
      return config;
    }

    const snippet = `
${MARKER}
subprojects {
  tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
    kotlinOptions.freeCompilerArgs += ["-Xskip-metadata-version-check"]
  }
}
`;

    config.modResults.contents = `${contents.trimEnd()}\n${snippet}`;
    return config;
  });
}

module.exports = createRunOncePlugin(
  withKotlinMetadataSkip,
  'mtk-kotlin-metadata-skip',
  '1.0.0',
);
