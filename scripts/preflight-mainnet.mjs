import { ContractFactory, JsonRpcProvider, Wallet, ZeroAddress, formatUnits, keccak256 } from 'ethers';
import { readFile } from 'node:fs/promises';
import { FOUR_TOKEN_MANAGER_2, getPublishedFourQuotes } from '../src/protocols/four-meme.mjs';
import { FLAP_GIFT_VAULT_FACTORY, FLAP_SPLIT_VAULT_FACTORY, FLAP_SWAP_REGISTRY, FLAP_VAULT_PORTAL, readFlapCompatibility } from '../src/protocols/flap.mjs';

const config = JSON.parse(await readFile(new URL('../config/bnb-mainnet.json', import.meta.url), 'utf8'));
const artifact = JSON.parse(await readFile(new URL('../artifacts/MuseRegistry.json', import.meta.url), 'utf8'));
const provider = new JsonRpcProvider(config.rpcUrl);
if (BigInt(await provider.send('eth_chainId', [])) !== 56n) throw new Error('RPC chain mismatch.');
const network = await provider.getNetwork();
if (network.chainId !== 56n) throw new Error(`RPC returned chain ${network.chainId}, expected 56.`);
const probe = Wallet.createRandom();
const deployTransaction = await new ContractFactory(artifact.abi, artifact.bytecode, probe).getDeployTransaction();
const [block, fee, deploymentGas, fourCode, flapCode, swapCode, quotes, split, gift] = await Promise.all([
  provider.getBlockNumber(),
  provider.getFeeData(),
  provider.estimateGas({ ...deployTransaction, from: probe.address }),
  provider.getCode(FOUR_TOKEN_MANAGER_2),
  provider.getCode(FLAP_VAULT_PORTAL),
  provider.getCode(FLAP_SWAP_REGISTRY),
  getPublishedFourQuotes(),
  readFlapCompatibility({ provider, quoteToken: ZeroAddress, dividendToken: '0x55d398326f99059ff775485246999027b3197955', vaultFactory: FLAP_SPLIT_VAULT_FACTORY }),
  readFlapCompatibility({ provider, quoteToken: ZeroAddress, dividendToken: ZeroAddress, vaultFactory: FLAP_GIFT_VAULT_FACTORY })
]);
if ([fourCode, flapCode, swapCode].some((code) => code === '0x')) throw new Error('One or more official protocol contracts has no bytecode.');
if (!quotes.length) throw new Error('Four.Meme returned no published quotes.');
if (!split.quote.enabled || !split.factory.enabled || !split.factory.official || !split.dividend.supported) throw new Error('Flap Split Vault/BNB/USDT route failed live validation.');
if (!gift.quote.enabled || !gift.factory.enabled || !gift.factory.official) throw new Error('Flap Gift Vault/BNB route failed live validation.');
let registry = { configured: false };
if (config.registryAddress) {
  const code = await provider.getCode(config.registryAddress);
  const hash = code === '0x' ? '' : keccak256(code);
  if (!code || code === '0x' || hash !== config.registryRuntimeCodeHash) throw new Error('Configured MuseRegistry failed bytecode verification.');
  registry = { configured: true, address: config.registryAddress, runtimeCodeHash: hash };
}
const gasPrice = fee.gasPrice ?? 0n;
console.log(JSON.stringify({
  ok: true,
  chainId: Number(network.chainId),
  block,
  protocolBytecode: { fourMeme: true, flapVaultPortal: true, flapSwapRegistry: true },
  fourMemePublishedQuotes: quotes.map(({ symbol, symbolAddress }) => ({ symbol, symbolAddress })),
  flap: { portalVersion: split.version, bnbQuote: split.quote, splitFactory: split.factory, giftFactory: gift.factory, usdtDividend: split.dividend },
  registry,
  deployment: { compiler: artifact.compiler, estimatedGas: deploymentGas.toString(), gasPriceGwei: formatUnits(gasPrice, 'gwei'), estimatedCostBNB: formatUnits(deploymentGas * gasPrice, 18), expectedRuntimeCodeHash: keccak256(artifact.deployedBytecode) }
}, null, 2));
