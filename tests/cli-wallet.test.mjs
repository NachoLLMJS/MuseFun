import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEncryptedMuseWallet, openMuseWallet, normalizeMuseName } from '../cli/lib/wallet.mjs';

test('creates an encrypted keystore without writing a plaintext private key', async () => {
  const home = await mkdtemp(join(tmpdir(), 'musefun-wallet-'));
  const result = await createEncryptedMuseWallet({ home, name: 'Nacho Muse', password: 'correct horse battery staple' });
  const raw = await readFile(result.keystorePath, 'utf8');
  const parsed = JSON.parse(raw);
  assert.match(raw, /"crypto"/i);
  assert.equal(parsed.privateKey, undefined);
  assert.equal(parsed.mnemonic, undefined);
  assert.doesNotMatch(raw, /correct horse battery staple/i);
  assert.match(result.address, /^0x[0-9A-Fa-f]{40}$/);
  const opened = await openMuseWallet({ keystorePath: result.keystorePath, password: 'correct horse battery staple' });
  assert.equal(opened.address, result.address);
});

test('refuses weak passwords and refuses to overwrite a Muse wallet', async () => {
  const home = await mkdtemp(join(tmpdir(), 'musefun-wallet-'));
  await assert.rejects(createEncryptedMuseWallet({ home, name: 'nachomuse', password: 'short' }), /at least 12/i);
  await createEncryptedMuseWallet({ home, name: 'nachomuse', password: 'a secure password' });
  await assert.rejects(createEncryptedMuseWallet({ home, name: 'nachomuse', password: 'another secure password' }), /already exists/i);
});

test('normalizes Muse names into the same canonical on-chain format', () => {
  assert.equal(normalizeMuseName('  Nacho Muse  '), 'nacho-muse');
  assert.throws(() => normalizeMuseName('!!'), /3 to 32/i);
});
