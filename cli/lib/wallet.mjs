import { mkdir, readFile, writeFile, access, chmod } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { Wallet } from 'ethers';

export function normalizeMuseName(input) {
  const name = String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '');
  if (name.length < 3 || name.length > 32) throw new Error('Muse name must contain 3 to 32 canonical characters.');
  return name;
}

export function musefunHome(home) {
  return join(home, '.musefun');
}

export async function createEncryptedMuseWallet({ home, name, password }) {
  if (String(password ?? '').length < 12) throw new Error('Wallet password must contain at least 12 characters.');
  const canonicalName = normalizeMuseName(name);
  const walletDir = join(musefunHome(home), 'wallets');
  const profileDir = join(musefunHome(home), 'profiles');
  const keystorePath = join(walletDir, `${canonicalName}.json`);
  const profilePath = join(profileDir, `${canonicalName}.json`);

  await mkdir(walletDir, { recursive: true, mode: 0o700 });
  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  try {
    await access(keystorePath, constants.F_OK);
    throw new Error(`Muse wallet already exists: ${canonicalName}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const wallet = Wallet.createRandom();
  const encryptedJson = await wallet.encrypt(password);
  const profile = {
    schema: 'musefun-profile-v1',
    name: canonicalName,
    address: wallet.address,
    keystore: keystorePath,
    createdAt: new Date().toISOString(),
    registration: null
  };
  await writeFile(keystorePath, encryptedJson, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await Promise.all([chmod(keystorePath, 0o600), chmod(profilePath, 0o600)]).catch(() => {});
  return { name: canonicalName, address: wallet.address, keystorePath, profilePath };
}

export async function openMuseWallet({ keystorePath, password }) {
  const encryptedJson = await readFile(keystorePath, 'utf8');
  return Wallet.fromEncryptedJson(encryptedJson, password);
}
