import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('Nimlane branding and preview warning are present', () => {
  assert.match(html, /Nimlane · Nimiq Pay Research Preview/);
  assert.match(html, /No live payments · No downloads/);
  assert.doesNotMatch(html, /LightningCommerce|Version 0\.3/);
});

test('public preview never labels its BTC invoice network as wallet mainnet', () => {
  assert.match(main, /c\.previewOnly\?'PREVIEW · NO PAYMENTS'/);
});
