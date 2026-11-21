// Adds a release signingConfig to android/app/build.gradle during `expo prebuild`.
// Credentials are never stored in the repo: they are read at build time from
// Gradle properties (e.g. ~/.gradle/gradle.properties or -P flags):
//   LOCALTUNES_UPLOAD_STORE_FILE, LOCALTUNES_UPLOAD_STORE_PASSWORD,
//   LOCALTUNES_UPLOAD_KEY_ALIAS, LOCALTUNES_UPLOAD_KEY_PASSWORD
// If they are absent, release builds fall back to the debug key (template default).
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// @localtunes/release-signing';

const SIGNING_CONFIG = `
        release {
            ${MARKER}
            if (project.hasProperty('LOCALTUNES_UPLOAD_STORE_FILE')) {
                storeFile file(LOCALTUNES_UPLOAD_STORE_FILE)
                storePassword LOCALTUNES_UPLOAD_STORE_PASSWORD
                keyAlias LOCALTUNES_UPLOAD_KEY_ALIAS
                keyPassword LOCALTUNES_UPLOAD_KEY_PASSWORD
            }
        }`;

function addReleaseSigning(gradle) {
  if (gradle.includes(MARKER)) return gradle;

  // 1. Add signingConfigs.release after the debug signing config.
  const debugSigning = /(signingConfigs\s*\{\s*debug\s*\{[^}]*\})/;
  if (!debugSigning.test(gradle)) {
    throw new Error('withReleaseSigning: could not find signingConfigs.debug in app/build.gradle');
  }
  gradle = gradle.replace(debugSigning, `$1${SIGNING_CONFIG}`);

  // 2. Point buildTypes.release at it (only when credentials are provided).
  const releaseBuildType = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
  if (!releaseBuildType.test(gradle)) {
    throw new Error('withReleaseSigning: could not find buildTypes.release signingConfig in app/build.gradle');
  }
  return gradle.replace(
    releaseBuildType,
    "$1signingConfig project.hasProperty('LOCALTUNES_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug"
  );
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withReleaseSigning: only Groovy build.gradle is supported');
    }
    cfg.modResults.contents = addReleaseSigning(cfg.modResults.contents);
    return cfg;
  });
};
