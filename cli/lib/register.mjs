import { Contract, Interface, getAddress, keccak256 } from 'ethers';
import { normalizeMuseName } from './wallet.mjs';

export const MUSE_REGISTRY_ABI = [
  'function registerMuse(string name,string metadataURI)',
  'function museOf(address owner) view returns ((string name,string metadataURI,uint64 registeredAt,uint64 updatedAt,bool active))',
  'function ownerOfName(string name) view returns (address)',
  'function isNameAvailable(string name) view returns (bool)',
  'function totalMuses() view returns (uint256)',
  'function ownerAt(uint256 index) view returns (address)',
  'event MuseRegistered(address indexed owner,bytes32 indexed nameHash,string name,string metadataURI)'
];

export async function registerMuseOnchain({ provider, wallet, registryAddress, expectedChainId = 56, expectedCodeHash = '', name, metadataURI, confirmTransaction }) {
  const canonicalName = normalizeMuseName(name);
  const uri = String(metadataURI ?? '').trim();
  if (!uri || uri.length > 256) throw new Error('Metadata URI must contain 1 to 256 characters.');
  const address = getAddress(registryAddress);
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(expectedChainId)) {
    throw new Error(`Wrong network: expected chain ${expectedChainId}, received ${network.chainId}. No transaction was sent.`);
  }
  const code = await provider.getCode(address);
  if (code === '0x') throw new Error('Registry address has no contract code. No transaction was sent.');
  if (expectedCodeHash && keccak256(code) !== expectedCodeHash) throw new Error('Registry bytecode does not match the audited MuseFun build. No transaction was sent.');

  const signer = wallet.provider ? wallet : wallet.connect(provider);
  const contract = new Contract(address, MUSE_REGISTRY_ABI, signer);
  const available = await contract.isNameAvailable(canonicalName);
  if (!available) throw new Error(`Muse name is unavailable: ${canonicalName}. No transaction was sent.`);
  const estimatedGas = await contract.registerMuse.estimateGas(canonicalName, uri);
  if (confirmTransaction && !(await confirmTransaction({ estimatedGas, owner: await signer.getAddress(), registryAddress: address, name: canonicalName, metadataURI: uri }))) {
    throw new Error('Cancelled. No transaction was sent.');
  }
  const transaction = await contract.registerMuse(canonicalName, uri);
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) throw new Error('Registration transaction did not succeed.');

  const iface = new Interface(MUSE_REGISTRY_ABI);
  const registration = receipt.logs
    .filter((log) => getAddress(log.address) === address)
    .map((log) => { try { return iface.parseLog(log); } catch { return null; } })
    .find((log) => log?.name === 'MuseRegistered');
  if (!registration) throw new Error('Confirmed receipt is missing MuseRegistered event.');
  const owner = getAddress(registration.args.owner);
  if (owner !== getAddress(await signer.getAddress()) || registration.args.name !== canonicalName || registration.args.metadataURI !== uri) {
    throw new Error('MuseRegistered event does not match the requested registration.');
  }
  return { owner, name: canonicalName, metadataURI: uri, transactionHash: receipt.hash, blockNumber: receipt.blockNumber };
}
