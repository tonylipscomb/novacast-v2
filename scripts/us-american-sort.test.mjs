import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isUsAmericanLiveLabel,
  sortLiveCategoriesUsFirst,
  sortLiveChannelsUsFirst,
} from '../src/features/providers/usAmericanSort.ts';

test('isUsAmericanLiveLabel detects country codes and common USA naming', () => {
  assert.equal(isUsAmericanLiveLabel('USA Entertainment', 'US'), true);
  assert.equal(isUsAmericanLiveLabel('USA Entertainment'), true);
  assert.equal(isUsAmericanLiveLabel('United States News'), true);
  assert.equal(isUsAmericanLiveLabel('American Sports'), true);
  assert.equal(isUsAmericanLiveLabel('US | ESPN', 'US'), true);
  assert.equal(isUsAmericanLiveLabel('UK Entertainment', 'GB'), false);
  assert.equal(isUsAmericanLiveLabel('Canada News', 'CA'), false);
});

test('isUsAmericanLiveLabel detects standalone US token in category names', () => {
  assert.equal(isUsAmericanLiveLabel('4K US SERIES'), true);
  assert.equal(isUsAmericanLiveLabel('TV SHOWS US'), true);
  assert.equal(isUsAmericanLiveLabel('UK SERIES', 'GB'), false);
});

test('sortLiveCategoriesUsFirst keeps US/American categories ahead while preserving order within each group', () => {
  const sorted = sortLiveCategoriesUsFirst([
    { id: '1', name: 'UK Entertainment', countryCode: 'GB' },
    { id: '2', name: 'USA Sports' },
    { id: '3', name: 'Canada News', countryCode: 'CA' },
    { id: '4', name: 'USA News' },
    { id: '5', name: 'International Mix' },
  ]);

  assert.deepEqual(
    sorted.map((category) => category.id),
    ['4', '2', '3', '1', '5'],
  );
});

test('sortLiveCategoriesUsFirst uses raw provider labels when normalized names omit country markers', () => {
  const sorted = sortLiveCategoriesUsFirst([
    { id: '1', name: 'Series', rawName: 'UK | SERIES', countryCode: 'GB' },
    { id: '2', name: 'Series', rawName: 'US | SERIES', countryCode: 'US' },
    { id: '3', name: 'International Mix' },
  ]);

  assert.deepEqual(
    sorted.map((category) => category.id),
    ['2', '1', '3'],
  );
});

test('sortLiveCategoriesUsFirst pushes Hindi and regional language categories to the end', () => {
  const sorted = sortLiveCategoriesUsFirst([
    { id: '1', name: 'HINDI SERIES' },
    { id: '2', name: 'US SERIES' },
    { id: '3', name: 'ENGLISH SERIES' },
    { id: '4', name: 'TAMIL MOVIES' },
    { id: '5', name: 'GENERAL' },
  ]);

  assert.deepEqual(
    sorted.map((category) => category.id),
    ['2', '3', '5', '1', '4'],
  );
});

test('sortLiveCategoriesUsFirst pushes Islamic and religious categories to the end', () => {
  const sorted = sortLiveCategoriesUsFirst([
    { id: '1', name: 'ISLAMIC MOVIES' },
    { id: '2', name: 'US MOVIES' },
    { id: '3', name: 'MUSLIM FILMS' },
    { id: '4', name: 'ENGLISH MOVIES' },
    { id: '5', name: 'ACTION' },
  ]);

  assert.deepEqual(
    sorted.map((category) => category.id),
    ['2', '4', '5', '1', '3'],
  );
});

test('sortLiveChannelsUsFirst uses parsed country prefixes on channel names', () => {
  const sorted = sortLiveChannelsUsFirst([
    { id: '1', name: 'BBC One', countryCode: 'GB' },
    { id: '2', name: 'ESPN', countryCode: 'US' },
    { id: '3', name: 'CBC News', countryCode: 'CA' },
    { id: '4', name: 'Fox News', countryCode: 'US' },
  ]);

  assert.deepEqual(
    sorted.map((channel) => channel.id),
    ['2', '4', '3', '1'],
  );
});
