import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import solc from 'solc';
import hre from 'hardhat';
import { BrowserProvider, ContractFactory, Wallet } from 'ethers';
import { registerMuseOnchain } from '../cli/lib/register.mjs';

function compile() {
  const source = readFileSync(new URL('../contracts/MuseRegistry.sol', import.meta.url), 'utf8');
  const output = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity',
    sources: { 'MuseRegistry.sol': { content: source } },
    settings: { evmVersion: 'paris', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } }
  })));
  return output.contracts['MuseRegistry.sol'].MuseRegistry;
}

let connection;
let provider;

before(async () => {
  connection = await hre.network.connect('musefunLocal');
  provider = new BrowserProvider(connection.provider);
});

after(async () => connection.close());

async function fixture() {
  const deployer = await provider.getSigner(0);
  const artifact = compile();
  const registry = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, deployer).deploy();
  await registry.waitForDeployment();
  const wallet = await provider.getSigner(1);
  return { provider, registry, wallet };
}

test('register command signs a real transaction and authenticates the receipt event', async () => {
  const { provider, registry, wallet } = await fixture();
  const result = await registerMuseOnchain({
    provider,
    wallet,
    registryAddress: await registry.getAddress(),
    expectedChainId: 56,
    name: 'cli-muse',
    metadataURI: 'ipfs://cli-metadata'
  });
  assert.match(result.transactionHash, /^0x[0-9a-f]{64}$/i);
  const walletAddress = await wallet.getAddress();
  assert.equal(result.owner, walletAddress);
  assert.equal((await registry.museOf(walletAddress)).name, 'cli-muse');
});

test('registration fails before signing on the wrong chain or missing registry code', async () => {
  const { provider, wallet } = await fixture();
  await assert.rejects(registerMuseOnchain({ provider, wallet, registryAddress: Wallet.createRandom().address, expectedChainId: 56, name: 'cli-muse', metadataURI: 'ipfs://x' }), /no contract code/i);
  await assert.rejects(registerMuseOnchain({ provider, wallet, registryAddress: Wallet.createRandom().address, expectedChainId: 97, name: 'cli-muse', metadataURI: 'ipfs://x' }), /expected chain 97/i);
});
