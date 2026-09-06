const path = require('path');
const {
  getSentryExpoConfig
} = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);
const NATIVE_WEBSOCKET_SHIM = path.join(__dirname, 'metro', 'native-websocket.js');

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

// Stage 2.9: Node unit tests import `nativeCatalogDecode.ts` (stub). Android
// release builds must use the Expo-native implementation instead.
const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // @supabase/realtime-js contains a Node-only `ws` fallback that imports
  // `stream`. React Native provides a native WebSocket, so keep that fallback
  // out of the Android bundle.
  if (typeof moduleName === 'string' && (moduleName === 'ws' || moduleName.startsWith('ws/'))) {
    return { type: 'sourceFile', filePath: NATIVE_WEBSOCKET_SHIM };
  }
  if (
    platform === 'android' &&
    typeof moduleName === 'string' &&
    /nativeCatalogDecode(?:\.ts)?$/.test(moduleName) &&
    !moduleName.includes('nativeCatalogDecode.android') &&
    !moduleName.includes('nativeCatalogDecodeTypes') &&
    !moduleName.includes('nativeCatalogDecodeShared')
  ) {
    const redirected = moduleName.replace(/nativeCatalogDecode(?:\.ts)?$/, 'nativeCatalogDecode.android.ts');
    return context.resolveRequest(context, redirected, platform);
  }
  if (typeof upstreamResolveRequest === 'function') {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
