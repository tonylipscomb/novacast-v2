import assert from 'node:assert/strict';
import test from 'node:test';
import { APK_DOWNLOAD_PATH, DOWNLOADER_CODE } from './siteConfig.ts';

test('download button targets the permanent relative APK path', () => {
  assert.equal(APK_DOWNLOAD_PATH, '/downloads/novacast.apk');
});

test('Downloader code remains stable', () => {
  assert.equal(DOWNLOADER_CODE, '6275368');
});
