import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const read = (name) => readFileSync(join(root, name), 'utf8');

test('MuseFun page exposes the full launcher composition and no retired MusePad brand', () => {
  const html = read('index.html');
  assert.match(html, /<title>MUSEFUN<\/title>/);
  assert.match(read('docs.html'), /<title>MUSEFUN<\/title>/);
  assert.match(html, /MuseFun/);
  assert.doesNotMatch(html, /MUSEPAD|MusePad/i);
  assert.doesNotMatch(html, /Your Muse\.\s*<br>Your rules\./, 'launch-card slogan must be absent');
  assert.doesNotMatch(html, />3\. Token details</, 'token details legend must be absent');
  assert.doesNotMatch(html, /class="network-pill"/, 'header network dropdown must be absent');
  for (const copy of ['Register your Muse.', 'Launch anything.', 'Four.Meme', 'Flap', 'Muse Archetypes', 'Recent Muses']) {
    assert.ok(html.includes(copy), `missing ${copy}`);
  }
  assert.doesNotMatch(html, /Recent Launches/);
  assert.match(html, /registered on MuseFun/i);
});

test('web Muse state comes from the registry rather than fabricated registrations', () => {
  const html = read('index.html');
  const js = read('src/app.js');
  assert.doesNotMatch(html, /<option>NachoMuse|<option>ChillMuse|class="status-chip">Registered/);
  assert.match(html, /Connect wallet to load your Muse/);
  assert.match(html, /npx --yes github:NachoLLMJS\/MuseFun wallet:create/);
  assert.match(js, /museOf/);
  assert.match(js, /totalMuses/);
  assert.match(js, /registryAddress/);
  assert.match(js, /registerMuse\.estimateGas/);
  assert.match(html, /id="registerMuseButton"/);
});

test('navigation opens real My Muses modal, standalone docs, and exposes Twitter after About', () => {
  const html = read('index.html');
  const js = read('src/app.js');
  const docs = read('docs.html');
  const docsCss = read('src/docs.css');
  assert.match(html, /id="myMusesLink"/);
  assert.match(html, /<dialog[^>]+id="myMusesModal"/);
  assert.match(js, /openMyMuses/);
  assert.match(js, /activeMuse/);
  assert.match(html, /href="\/docs\.html"[^>]+target="_blank"/);
  assert.match(html, /href="\/docs\.html#overview"[^>]+target="_blank"[^>]+rel="noopener"[^>]*>About<\/a>/);
  assert.match(docs, /MuseFun Documentation/);
  assert.match(docs, /docs-sidebar/);
  assert.match(docsCss, /position:\s*sticky/);
  assert.match(html, /About<\/a>\s*<a[^>]+id="twitterLink"[^>]*>Twitter<\/a>/);
  assert.match(html, /href="https:\/\/x\.com\/musefunbinance"[^>]+id="twitterLink"[^>]+target="_blank"[^>]+rel="noopener noreferrer"/);
});

test('venue buttons use official local brand assets instead of emoji', () => {
  const html = read('index.html');
  assert.match(html, /assets\/four-meme-logo\.svg/);
  assert.match(html, /assets\/flap-icon\.svg/);
  assert.doesNotMatch(html, /🖐️|🦋/);
});

test('all generated identity assets are present as separate production files', () => {
  const names = ['musefun-background.png', 'musefun-logo.png', 'chill-muse.png', 'builder-muse.png', 'degen-muse.png', 'hodl-muse.png'];
  for (const name of names) assert.ok(existsSync(join(root, 'public', 'assets', name)), `missing ${name}`);
});

test('launcher remains disabled until the security audit passes', () => {
  const js = read('src/app.js');
  assert.match(js, /eth_requestAccounts/);
  assert.match(js, /LAUNCH_INTEGRATIONS_READY\s*=\s*false/);
  assert.match(js, /getPublishedFourQuotes/);
  assert.match(js, /readFlapCompatibility/);
  assert.match(js, /estimateGas/);
  assert.match(js, /No transaction was sent/);
});

test('mobile layout has an explicit true-narrow breakpoint', () => {
  const css = read('src/styles.css');
  assert.match(css, /@media\s*\(max-width:\s*700px\)/);
  assert.match(css, /grid-template-columns:\s*1fr/);
  assert.match(css, /overflow-x:\s*hidden/);
});

test('desktop uses a near edge-to-edge master container and header', () => {
  const css = read('src/styles.css');
  assert.match(css, /\.page-shell\s*\{\s*width:\s*calc\(100%\s*-\s*32px\)/);
  assert.match(css, /\.topbar\s*\{[^}]*border-radius:\s*28px/s);
});

test('desktop lower containers stay anchored to the viewport bottom on tall screens', () => {
  const css = read('src/styles.css');
  assert.match(css, /\.page-shell\s*\{[^}]*min-height:\s*100vh[^}]*display:\s*flex[^}]*flex-direction:\s*column/s);
  assert.match(css, /main#home\s*\{[^}]*flex:\s*1[^}]*display:\s*flex[^}]*flex-direction:\s*column/s);
  assert.match(css, /\.hero-grid\s*\{[^}]*min-height:\s*570px[^}]*flex:\s*1\s+0\s+570px/s);
  assert.match(css, /\.dashboard-strip\s*\{[^}]*margin-top:\s*auto/s);
});
