import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import solc from 'solc';
import hre from 'hardhat';
import { BrowserProvider, ContractFactory } from 'ethers';

function compile() {
  const source = readFileSync(new URL('../contracts/MuseRegistry.sol', import.meta.url), 'utf8');
  const input = {
    language: 'Solidity',
    sources: { 'MuseRegistry.sol': { content: source } },
    settings: { evmVersion: 'paris', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } }
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter((entry) => entry.severity === 'error');
  assert.deepEqual(errors, [], errors.map((entry) => entry.formattedMessage).join('\n'));
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
  const artifact = compile();
  const owner = await provider.getSigner(0);
  const stranger = await provider.getSigner(1);
  const registry = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, owner).deploy();
  await registry.waitForDeployment();
  return { registry, owner, stranger };
}

test('wallet registers one canonical Muse and reads it back', async () => {
  const { registry, owner } = await fixture();
  await (await registry.registerMuse('nachomuse', 'ipfs://bafy-metadata')).wait();
  const muse = await registry.museOf(await owner.getAddress());
  assert.equal(muse.name, 'nachomuse');
  assert.equal(muse.metadataURI, 'ipfs://bafy-metadata');
  assert.equal(muse.active, true);
  assert.equal(await registry.ownerOfName('nachomuse'), await owner.getAddress());
});

test('duplicate names, invalid names and second registrations fail closed', async () => {
  const { registry, stranger } = await fixture();
  await (await registry.registerMuse('nachomuse', 'ipfs://one')).wait();
  await assert.rejects(registry.connect(stranger).registerMuse.staticCall('nachomuse', 'ipfs://two'));
  await assert.rejects(registry.connect(stranger).registerMuse.staticCall('Upper Case', 'ipfs://two'));
  await assert.rejects(registry.registerMuse.staticCall('another', 'ipfs://two'));
});

test('only the Muse owner can update metadata and names remain permanently reserved', async () => {
  const { registry, owner, stranger } = await fixture();
  await (await registry.registerMuse('nachomuse', 'ipfs://one')).wait();
  await assert.rejects(registry.connect(stranger).updateMuse.staticCall('ipfs://stolen'));
  await (await registry.updateMuse('ipfs://two')).wait();
  assert.equal((await registry.museOf(await owner.getAddress())).metadataURI, 'ipfs://two');
  assert.equal(registry.interface.hasFunction('unregisterMuse'), false);
  await assert.rejects(registry.connect(stranger).registerMuse.staticCall('nachomuse', 'ipfs://new'));
});

test('exposes an append-only owner index for real Recent Muses views', async () => {
  const { registry, owner, stranger } = await fixture();
  await (await registry.registerMuse('first-muse', 'ipfs://first')).wait();
  await (await registry.connect(stranger).registerMuse('second-muse', 'ipfs://second')).wait();
  assert.equal(await registry.totalMuses(), 2n);
  assert.equal(await registry.ownerAt(0), await owner.getAddress());
  assert.equal(await registry.ownerAt(1), await stranger.getAddress());
  await assert.rejects(registry.ownerAt(2));
});
