const { withAppBuildGradle } = require('@expo/config-plugins');

const MARKER = '// NovaCast debug package suffix';
const SNIPPET = `${MARKER}
            applicationIdSuffix '.dev'
`;

function withNovacastDevPackage(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      return config;
    }

    if (!config.modResults.contents.includes(MARKER)) {
      const debugBuildType = /(buildTypes\s*\{\s*\r?\n\s*debug\s*\{\s*)/;
      if (!debugBuildType.test(config.modResults.contents)) {
        throw new Error('NovaCast debug build type was not found.');
      }
      config.modResults.contents = config.modResults.contents.replace(debugBuildType, `$1${SNIPPET}`);
    }

    return config;
  });
}

module.exports = withNovacastDevPackage;
