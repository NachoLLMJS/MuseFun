import { AbiCoder, Contract, Interface, ZeroAddress, concat, getAddress, getCreate2Address, isHexString, keccak256, randomBytes } from 'ethers';
import { assertContractIdentity, assertRawChainId } from '../chain/security.mjs';

export const FLAP_PORTAL = getAddress('0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0');
export const FLAP_VAULT_PORTAL = getAddress('0x90497450f2a706f1951b5bdda52B4E5d16f34C06');
export const FLAP_TAX_TOKEN_V3_IMPL = getAddress('0x024f18294970B5c76c0691b87f138A0317156422');
export const FLAP_SWAP_REGISTRY = getAddress('0x644A8f560138418bAD4EdEFC7c17878a3c2fBEB6');
export const FLAP_SPLIT_VAULT_FACTORY = getAddress('0xfab75Dc774cB9B38b91749B8833360B46a52345F');
export const FLAP_GIFT_VAULT_FACTORY = getAddress('0x025549F52B03cF36f9e1a337c02d3AA7Af66ab32');
export const FLAP_BNB_DEX_THRESHOLD = 1;

const PARAM_TUPLE = '(string name,string symbol,string meta,uint8 dexThresh,bytes32 salt,uint8 migratorType,address quoteToken,uint256 quoteAmt,bytes permitData,bytes32 extensionID,bytes extensionData,uint8 dexId,uint8 lpFeeProfile,uint16 buyTaxRate,uint16 sellTaxRate,uint64 taxDuration,uint64 antiFarmerDuration,uint16 mktBps,uint16 deflationBps,uint16 dividendBps,uint16 lpBps,uint256 minimumShareBalance,address dividendToken,address commissionReceiver,uint8 tokenVersion,address vaultFactory,bytes vaultData)';
const VAULT_ABI = [
  `function newTokenV6WithVault(${PARAM_TUPLE} params) payable returns (address token)`,
  'function vaultFactories(address factory) view returns (bool enabled,bool official,uint8 riskLevel,bytes29 reserved)',
  'function getFactoryPolicy(address factory) view returns (uint8 policy,bytes32 policyData,string description)',
  'event FlapTaxVaultTokenCreated(address indexed token,address indexed vault,address indexed vaultFactory)'
];
const PORTAL_ABI = [
  'function version() view returns (string)',
  'function getQuoteTokenConfiguration(address quoteToken) view returns ((uint8 enabled,uint8 defaultCurve,uint8 alternativeCurve,uint8 nativeToQuoteSwapType,uint8 dexId) config)',
  'function getSaltLock(bytes32 salt) view returns ((address locker,uint8 tokenVersion) entry)'
];
const SWAP_REGISTRY_ABI = [
  'function isSwapSupportedWithDetailedErrors(address quoteToken,address dividendToken) view returns (bool supported,uint8 errorCode,string errorMessage)',
  'function getTrustStatus(address token) view returns (uint8)',
  'function isBlacklisted(address token) view returns (bool)'
];
const vaultInterface = new Interface(VAULT_ABI);

export function encodeSplitVaultData(recipients) {
  if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > 10) throw new Error('Split Vault needs 1 to 10 recipients.');
  const normalized = recipients.map(({ recipient, bps }) => ({ recipient: getAddress(recipient), bps: Number(bps) }));
  if (new Set(normalized.map((item) => item.recipient.toLowerCase())).size !== normalized.length) throw new Error('Split Vault recipients must be unique.');
  if (normalized.some((item) => item.recipient === ZeroAddress || !Number.isInteger(item.bps) || item.bps < 1 || item.bps > 10000)) throw new Error('Split Vault recipient and bps values are invalid.');
  if (normalized.reduce((sum, item) => sum + item.bps, 0) !== 10000) throw new Error('Split Vault bps must total exactly 10000.');
  return AbiCoder.defaultAbiCoder().encode(['tuple(address recipient,uint16 bps)[]'], [normalized]);
}

export function encodeGiftVaultData(xHandle) {
  const handle = String(xHandle ?? '').trim();
  if (!/^[a-z0-9_]{1,15}$/.test(handle)) throw new Error('Gift Vault X handle must be lowercase and omit @.');
  return AbiCoder.defaultAbiCoder().encode(['tuple(string xHandle)'], [{ xHandle: handle }]);
}

function predictedTokenAddress(salt) {
  const cloneBytecode = concat(['0x3d602d80600a3d3981f3363d3d373d3d3d363d73', FLAP_TAX_TOKEN_V3_IMPL, '0x5af43d82803e903d91602b57fd5bf3']);
  return getCreate2Address(FLAP_PORTAL, salt, keccak256(cloneBytecode));
}

export async function findFlapVanitySalt({ suffix = '7777', seed = randomBytes(32), maxIterations = 2_000_000 } = {}) {
  if (!/^[0-9a-f]{1,4}$/i.test(suffix)) throw new Error('Vanity suffix must contain 1 to 4 hex characters.');
  let salt = keccak256(seed);
  for (let iterations = 0; iterations <= maxIterations; iterations += 1) {
    const address = predictedTokenAddress(salt);
    if (address.toLowerCase().endsWith(suffix.toLowerCase())) return { salt, address, iterations };
    salt = keccak256(salt);
    if (iterations > 0 && iterations % 4000 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Could not find a ${suffix} vanity salt within ${maxIterations} iterations.`);
}

export function validateFlapV6Params(params) {
  if (Number(params.tokenVersion) !== 6) throw new Error('Flap VaultPortal V6 only supports Tax Token V3.');
  if (!Number.isInteger(Number(params.dexThresh)) || Number(params.dexThresh) < 0 || Number(params.dexThresh) > 5) throw new Error('Flap dexThresh must be a valid enum value (0-5).');
  if (getAddress(params.quoteToken) === ZeroAddress && Number(params.dexThresh) !== FLAP_BNB_DEX_THRESHOLD) throw new Error('Flap BNB Mainnet currently enables FOUR_FIFTHS (dexThresh 1) only.');
  if (!Number.isInteger(Number(params.migratorType)) || Number(params.migratorType) < 0 || Number(params.migratorType) > 3) throw new Error('Flap migratorType must be a valid enum value (0-3).');
  if (Number(params.dexId) !== 0) throw new Error('Flap BNB Mainnet currently supports DEX0 only.');
  if (!Number.isInteger(Number(params.lpFeeProfile)) || Number(params.lpFeeProfile) < 0 || Number(params.lpFeeProfile) > 2) throw new Error('Flap LP fee profile must be 0-2.');
  if (Number(params.buyTaxRate) <= 0 || Number(params.sellTaxRate) <= 0) throw new Error('Flap V6 buy and sell tax rates must be non-zero.');
  const uint16Fields = ['buyTaxRate', 'sellTaxRate', 'mktBps', 'deflationBps', 'dividendBps', 'lpBps'];
  if (uint16Fields.some((key) => !Number.isInteger(Number(params[key])) || Number(params[key]) < 0 || Number(params[key]) > 10000)) throw new Error('Flap tax rates and allocations must be integer basis points from 0 to 10000.');
  const total = ['mktBps', 'deflationBps', 'dividendBps', 'lpBps'].reduce((sum, key) => sum + Number(params[key] || 0), 0);
  if (total !== 10000) throw new Error('Flap V6 tax allocations must total exactly 10000 bps.');
  if (getAddress(params.quoteToken) !== ZeroAddress && !isHexString(params.permitData)) throw new Error('Flap permitData must be valid hexadecimal when supplied.');
  if (Number(params.dividendBps) > 0 && BigInt(params.minimumShareBalance ?? 0) < 10000n * 10n ** 18n) throw new Error('Dividend launches require a minimum share balance of at least 10,000 tokens.');
  if (Number(params.dividendBps) > 0 && getAddress(params.quoteToken) !== ZeroAddress && getAddress(params.dividendToken) === ZeroAddress) throw new Error('Zero-address dividends are valid only for a native quote token.');
}

export function buildFlapV6VaultTransaction(params) {
  validateFlapV6Params(params);
  if (!isHexString(params.salt, 32)) throw new Error('Flap salt must be bytes32.');
  if (!predictedTokenAddress(params.salt).toLowerCase().endsWith('7777')) throw new Error('Flap salt does not produce the required 7777 token suffix.');
  const nativeCreationFee = getAddress(params.quoteToken) === ZeroAddress ? 0n : 1_000_000_000n;
  const value = getAddress(params.quoteToken) === ZeroAddress ? BigInt(params.quoteAmt) : nativeCreationFee;
  return { to: FLAP_VAULT_PORTAL, data: vaultInterface.encodeFunctionData('newTokenV6WithVault', [params]), value };
}

export async function readFlapCompatibility({ provider, quoteToken, vaultFactory, dividendToken = quoteToken }) {
  await assertRawChainId(provider);
  await Promise.all([
    assertContractIdentity(provider, 'flapPortal'),
    assertContractIdentity(provider, 'flapVaultPortal'),
    assertContractIdentity(provider, 'flapSwapRegistry')
  ]);
  const portal = new Contract(FLAP_PORTAL, PORTAL_ABI, provider);
  const vaultPortal = new Contract(FLAP_VAULT_PORTAL, VAULT_ABI, provider);
  const swapRegistry = new Contract(FLAP_SWAP_REGISTRY, SWAP_REGISTRY_ABI, provider);
  const normalizedQuote = getAddress(quoteToken);
  const normalizedDividend = getAddress(dividendToken);
  const needsSwap = normalizedDividend !== ZeroAddress && normalizedDividend !== normalizedQuote;
  const [version, quote, factory, policy, swap, trust, blacklisted] = await Promise.all([
    portal.version(),
    portal.getQuoteTokenConfiguration(normalizedQuote),
    vaultPortal.vaultFactories(getAddress(vaultFactory)),
    vaultPortal.getFactoryPolicy(getAddress(vaultFactory)),
    needsSwap ? swapRegistry.isSwapSupportedWithDetailedErrors(normalizedQuote, normalizedDividend) : [true, 0, ''],
    needsSwap ? swapRegistry.getTrustStatus(normalizedDividend) : 1,
    needsSwap ? swapRegistry.isBlacklisted(normalizedDividend) : false
  ]);
  return {
    version,
    quote: { enabled: Number(quote.enabled) === 1, defaultCurve: Number(quote.defaultCurve), alternativeCurve: Number(quote.alternativeCurve), nativeToQuoteSwapType: Number(quote.nativeToQuoteSwapType), dexId: Number(quote.dexId) },
    factory: { enabled: factory.enabled, official: factory.official, riskLevel: Number(factory.riskLevel), permissionPolicy: Number(policy.policy), policyDescription: policy.description },
    dividend: { supported: Boolean(swap[0]) && !blacklisted, errorCode: Number(swap[1]), errorMessage: swap[2], trust: Number(trust), blacklisted: Boolean(blacklisted) }
  };
}

export async function submitFlapV6Vault({ provider, signer, params }) {
  if (![FLAP_SPLIT_VAULT_FACTORY, FLAP_GIFT_VAULT_FACTORY].includes(getAddress(params.vaultFactory))) throw new Error('Unknown Flap vault factory. No transaction was sent.');
  const compatibility = await readFlapCompatibility({ provider, quoteToken: params.quoteToken, vaultFactory: params.vaultFactory, dividendToken: params.dividendToken });
  if (!compatibility.quote.enabled) throw new Error('Selected Flap quote token is not enabled. No transaction was sent.');
  if (!compatibility.factory.enabled || !compatibility.factory.official || compatibility.factory.permissionPolicy === 2) throw new Error('Selected Flap vault factory is not approved for public launch. No transaction was sent.');
  if (Number(params.dividendBps) > 0 && !compatibility.dividend.supported) throw new Error(`Selected Flap dividend route is unsupported: ${compatibility.dividend.errorMessage || compatibility.dividend.errorCode}. No transaction was sent.`);
  const transaction = buildFlapV6VaultTransaction(params);
  const from = await signer.getAddress();
  const portal = new Contract(FLAP_PORTAL, PORTAL_ABI, provider);
  const saltLock = await portal.getSaltLock(params.salt);
  if (saltLock.locker !== ZeroAddress && getAddress(saltLock.locker) !== getAddress(from)) throw new Error('Flap salt is locked by another account. No transaction was sent.');
  if (saltLock.locker !== ZeroAddress && Number(saltLock.tokenVersion) !== 6) throw new Error('Flap salt is locked for another token version. No transaction was sent.');
  await provider.call({ ...transaction, from });
  await provider.estimateGas({ ...transaction, from });
  await assertRawChainId(provider);
  await Promise.all([assertContractIdentity(provider, 'flapPortal'), assertContractIdentity(provider, 'flapVaultPortal')]);
  const sent = await signer.sendTransaction(transaction);
  const receipt = await sent.wait();
  if (!receipt || receipt.status !== 1) throw new Error('Flap launch transaction failed.');
  const event = receipt.logs.filter((log) => getAddress(log.address) === FLAP_VAULT_PORTAL).map((log) => { try { return vaultInterface.parseLog(log); } catch { return null; } }).find((log) => log?.name === 'FlapTaxVaultTokenCreated');
  if (!event) throw new Error('Confirmed receipt is missing FlapTaxVaultTokenCreated.');
  if (getAddress(event.args.vaultFactory) !== getAddress(params.vaultFactory)) throw new Error('Confirmed Flap event used an unexpected vault factory.');
  if (getAddress(event.args.token) !== getAddress(predictedTokenAddress(params.salt))) throw new Error('Confirmed Flap event token does not match the approved CREATE2 address.');
  const [tokenCode, vaultCode] = await Promise.all([provider.getCode(event.args.token), provider.getCode(event.args.vault)]);
  if (tokenCode === '0x' || vaultCode === '0x') throw new Error('Confirmed Flap token or vault has no deployed bytecode.');
  return { transactionHash: receipt.hash, token: getAddress(event.args.token), vault: getAddress(event.args.vault), vaultFactory: getAddress(event.args.vaultFactory) };
}
