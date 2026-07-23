const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The project root accumulates loose debug artifacts from manual device/emulator
// testing sessions (screenshots, UI-dump XML, adb/gradle/metro logs, sideloaded
// APKs - several 100MB+). None of these are part of the app bundle, but without
// an explicit blockList entry Metro's file-map crawler watches and fingerprints
// all of them on every startup and file-change event, which was a major
// contributor to Metro exhausting its heap and crashing with "Ineffective
// mark-compacts near heap limit". Excluded here instead of deleted, since they
// may still be needed for manual testing.
//
// @expo/metro-file-map reapplies blockList patterns to project-root-relative
// paths as well as absolute ones, so this only matches files sitting directly
// in the project root (no path separator before the extension) - it does not
// affect nested assets such as assets/images/*.png.
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : [config.resolver.blockList]),
  /^[^\\/]+\.(?:png|jpe?g|gif|apk|xml|log|txt)$/,
];

module.exports = config;
