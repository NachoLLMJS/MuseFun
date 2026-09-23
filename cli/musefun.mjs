#!/usr/bin/env node
import { Command } from 'commander';
import { password as askPassword, confirm } from '@inquirer/prompts';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { JsonRpcProvider } from 'ethers';
import { createEncryptedMuseWallet, musefunHome, normalizeMuseName, openMuseWallet } from './lib/wallet.mjs';
import { registerMuseOnchain } from './lib/register.mjs';

const program = new Command();
program.name('musefun').description('Create a non-custodial Muse wallet and register a Muse on BNB Chain.').version('0.1.0');

async function loadConfig() {
  return JSON.parse(await readFile(new URL('../config/bnb-mainnet.json', import.meta.url), 'utf8'));
}

async function newPassword() {
  const first = await askPassword({ message: 'Create a wallet password (12+ characters):', mask: '*' });
  const second = await askPassword({ message: 'Confirm wallet password:', mask: '*' });
  if (first !== second) throw new Error('Passwords do not match.');
  return first;
}

program.command('wallet:create')
  .requiredOption('--name <name>', 'Muse name')
  .description('Create an encrypted local EVM wallet. No network request is made.')
  .action(async ({ name }) => {
    const result = await createEncryptedMuseWallet({ home: homedir(), name, password: await newPassword() });
    console.log(`Muse: ${result.name}`);
    console.log(`Address: ${result.address}`);
    console.log(`Encrypted keystore: ${result.keystorePath}`);
    console.log('Fund only after making an offline backup. MuseFun never receives your key or password.');
  });

program.command('register')
  .requiredOption('--name <name>', 'Canonical Muse name')
  .requiredOption('--metadata-uri <uri>', 'Permanent metadata URI, preferably ipfs://')
  .option('--rpc <url>', 'BNB Mainnet RPC URL')
  .description('Sign and submit a Muse registration from its encrypted local wallet.')
  .action(async (options) => {
    const config = await loadConfig();
    if (!config.registryAddress) throw new Error('MuseRegistry is not deployed/configured. No transaction was sent.');
    const name = normalizeMuseName(options.name);
    const base = musefunHome(homedir());
    const keystorePath = join(base, 'wallets', `${name}.json`);
    const profilePath = join(base, 'profiles', `${name}.json`);
    const walletPassword = await askPassword({ message: 'Wallet password:', mask: '*' });
    const wallet = await openMuseWallet({ keystorePath, password: walletPassword });
    const provider = new JsonRpcProvider(options.rpc || config.rpcUrl);
    const rawChainId = BigInt(await provider.send('eth_chainId', []));
    if (rawChainId !== BigInt(config.chainId)) throw new Error(`RPC chain mismatch: expected ${config.chainId}, received ${rawChainId}. No transaction was sent.`);
    const fee = await provider.getFeeData();
    const result = await registerMuseOnchain({
      provider, wallet, registryAddress: config.registryAddress, expectedChainId: config.chainId,
      expectedCodeHash: config.registryRuntimeCodeHash, name, metadataURI: options.metadataUri,
      confirmTransaction: ({ estimatedGas }) => confirm({
        message: `Register ${name} permanently from ${wallet.address} on BNB Mainnet? Registry: ${config.registryAddress}; estimated gas: ${estimatedGas}; gas price: ${fee.gasPrice ?? 'unknown'} wei`,
        default: false
      })
    });
    const profile = JSON.parse(await readFile(profilePath, 'utf8'));
    profile.registration = { chainId: config.chainId, registry: config.registryAddress, transactionHash: result.transactionHash, blockNumber: result.blockNumber, metadataURI: result.metadataURI };
    await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    console.log(`Registered: ${result.name}`);
    console.log(`Owner: ${result.owner}`);
    console.log(`Transaction: ${config.explorerUrl}/tx/${result.transactionHash}`);
  });

program.parseAsync().catch((error) => {
  console.error(`MuseFun error: ${error.message}`);
  process.exitCode = 1;
});
