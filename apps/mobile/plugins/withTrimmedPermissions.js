const {
  withAndroidManifest,
  createRunOncePlugin,
} = require('expo/config-plugins');

/**
 * Permissions the app does not need, but which arrive anyway.
 *
 * `app.json`'s `android.permissions` array is additive only: it can add a
 * permission, never remove one. Several native dependencies declare permissions
 * in their own AAR manifests, and the manifest merger unions them in, so the
 * final APK ships them even though the app never requests or uses them.
 *
 * Two categories matter:
 *  - SYSTEM_ALERT_WINDOW lets the app draw over other apps. Play Console treats
 *    it as a sensitive permission requiring a declaration and justification,
 *    and the app has no overlay UI, so shipping it invites review questions.
 *  - WRITE_EXTERNAL_STORAGE and READ_MEDIA_AUDIO are legacy/deprecated storage
 *    grants. On API 33+ they do nothing useful, and WRITE_EXTERNAL_STORAGE is
 *    rejected outright for apps targeting modern API levels.
 *
 * `tools:node="remove"` is the manifest merger's opt-out: it strips the
 * declaration that dependencies contributed instead of adding a second one.
 * Doing it here rather than by hand-editing android/ matters because android/ is
 * generated and gitignored -- `expo prebuild` would otherwise restore the
 * unwanted permissions on the next run.
 */
const PERMISSIONS_TO_REMOVE = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.READ_MEDIA_AUDIO',
];

const TOOLS_NS = 'http://schemas.android.com/tools';

function withTrimmedPermissions(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    // The merger only honours tools:* attributes when the tools namespace is
    // declared, so make sure it is present before adding any removal markers.
    // xml2js keys namespace declarations by their prefixed form ('xmlns:tools'),
    // not by the URI, otherwise serialisation fails with "Invalid character in name".
    manifest.$ = manifest.$ || {};
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = TOOLS_NS;
    }

    const existing = manifest['uses-permission'] || [];

    // Drop the plain declaration AND emit a tools:node="remove" marker.
    //
    // Keeping the plain <uses-permission> alongside the removal marker does not
    // work: `remove` only strips declarations coming from *lower*-priority
    // (library) manifests, so a plain sibling in this same, highest-priority
    // manifest would be merged in normally and the permission would ship
    // regardless. The removal marker has to be the only entry for that name.
    const removeSet = new Set(PERMISSIONS_TO_REMOVE);

    const kept = existing.filter(
      (entry) => !(entry.$ && removeSet.has(entry.$['android:name'])),
    );

    const removals = PERMISSIONS_TO_REMOVE.map((name) => ({
      $: {
        'android:name': name,
        'tools:node': 'remove',
      },
    }));

    manifest['uses-permission'] = [...kept, ...removals];

    return config;
  });
}

module.exports = createRunOncePlugin(
  withTrimmedPermissions,
  'mtk-trim-permissions',
  '1.0.0',
);
