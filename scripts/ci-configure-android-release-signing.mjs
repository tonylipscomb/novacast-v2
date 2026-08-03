#!/usr/bin/env node
/**
 * CI-only helper: after `expo prebuild`, optionally point the generated
 * android/app/build.gradle release buildType at novacast-release.jks.
 *
 * Invoked only when NOVACAST_KEYSTORE_BASE64 is present. Does not change
 * committed app source; android/ is generated and gitignored.
 */

import fs from 'node:fs';

const path = 'android/app/build.gradle';

if (!fs.existsSync(path)) {
  console.error(`Missing ${path}. Run expo prebuild first.`);
  process.exit(1);
}

let gradle = fs.readFileSync(path, 'utf8');

if (gradle.includes("storeFile file('novacast-release.jks')")) {
  console.log('Release keystore signing already configured.');
  process.exit(0);
}

const debugSigningMarker = `signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`;

const releaseSigningBlock = `signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            storeFile file('novacast-release.jks')
            storePassword System.getenv("NOVACAST_KEYSTORE_PASSWORD")
            keyAlias System.getenv("NOVACAST_KEY_ALIAS")
            keyPassword System.getenv("NOVACAST_KEY_PASSWORD")
        }
    }`;

if (!gradle.includes(debugSigningMarker)) {
  console.error('Unexpected signingConfigs block; refusing to patch build.gradle');
  process.exit(1);
}

gradle = gradle.replace(debugSigningMarker, releaseSigningBlock);

// Keep the debug buildType on debug signing; rewrite the release buildType only.
let seenFirstDebugSigning = false;
gradle = gradle.replace(/signingConfig signingConfigs\.debug/g, (match) => {
  if (!seenFirstDebugSigning) {
    seenFirstDebugSigning = true;
    return match;
  }
  return 'signingConfig signingConfigs.release';
});

if (!gradle.includes('signingConfig signingConfigs.release')) {
  console.error('Failed to point release buildType at signingConfigs.release');
  process.exit(1);
}

fs.writeFileSync(path, gradle);
console.log('Configured android/app/build.gradle for release keystore signing.');
