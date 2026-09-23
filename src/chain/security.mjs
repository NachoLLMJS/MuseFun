import { getAddress, keccak256 } from 'ethers';
import protocolManifest from '../../config/protocol-mainnet.json' with { type: 'json' };

const IMPLEMENTATION_SLOT = protocolManifest.eip1967ImplementationSlot;

export async function assertRawChainId(provider, expected = 56n) {
  const raw = await provider.send('eth_chainId', []);
  const actual = BigInt(raw);
  if (actual !== expected) throw new Error(`RPC chain mismatch: expected ${expected}, received ${actual}. No transaction was sent.`);
  return actual;
}

export async function assertContractIdentity(provider, manifestKey) {
  const expected = protocolManifest.contracts[manifestKey];
  if (!expected) throw new Error(`Unknown contract manifest key: ${manifestKey}.`);
  await assertRawChainId(provider, BigInt(protocolManifest.chainId));
  const address = getAddress(expected.address);
  const code = await provider.getCode(address);
  if (code === '0x' || keccak256(code) !== expected.runtimeCodeHash) {
    throw new Error(`${manifestKey} proxy/runtime bytecode is not the approved build. No transaction was sent.`);
  }
  if (expected.implementation) {
    const raw = await provider.getStorage(address, IMPLEMENTATION_SLOT);
    const implementation = getAddress(`0x${raw.slice(-40)}`);
    if (implementation !== getAddress(expected.implementation)) throw new Error(`${manifestKey} implementation changed. No transaction was sent.`);
    const implementationCode = await provider.getCode(implementation);
    if (implementationCode === '0x' || keccak256(implementationCode) !== expected.implementationCodeHash) {
      throw new Error(`${manifestKey} implementation bytecode changed. No transaction was sent.`);
    }
  }
  return expected;
}

export { protocolManifest };
