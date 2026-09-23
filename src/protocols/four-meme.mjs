import { Interface, getAddress, isHexString, parseEther } from 'ethers';
import { assertContractIdentity, assertRawChainId } from '../chain/security.mjs';

export const FOUR_API = 'https://four.meme/meme-api';
export const FOUR_TOKEN_MANAGER_2 = getAddress('0x5c952063c7fc8610FFDB798152D69F0B9550762b');
const CREATE_ABI = [
  'function createToken(bytes args,bytes signature) payable',
  'event TokenCreate(address creator,address token,uint256 requestId,string name,string symbol,uint256 totalSupply,uint256 launchTime,uint256 launchFee)'
];
const createInterface = new Interface(CREATE_ABI);

async function apiJson(response, label) {
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}. No transaction was sent.`);
  const body = await response.json();
  if (String(body.code) !== '0') throw new Error(`${label} rejected the request: ${body.msg || body.code}. No transaction was sent.`);
  return body.data;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function getPublishedFourQuotes({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${FOUR_API}/v1/public/config`, { cache: 'no-store' });
  const data = await apiJson(response, 'Four.Meme config');
  if (!Array.isArray(data)) throw new Error('Four.Meme returned an invalid quote configuration.');
  return data.filter((item) => item.status === 'PUBLISH' && /^0x[0-9a-fA-F]{40}$/.test(item.symbolAddress));
}

export function validateFourTaxInfo(info) {
  if (!info) return;
  if (![1, 3, 5, 10].includes(Number(info.feeRate))) throw new Error('Four.Meme fee rate must be 1, 3, 5 or 10 percent.');
  const fields = ['burnRate', 'divideRate', 'liquidityRate', 'recipientRate', 'giggleCharityRate', 'binanceCharityRate'];
  const total = fields.reduce((sum, key) => sum + Number(info[key] || 0), 0);
  if (!fields.every((key) => Number.isFinite(Number(info[key] || 0)) && Number(info[key] || 0) >= 0) || total !== 100) {
    throw new Error('Four.Meme tax allocations must be non-negative and sum to 100.');
  }
}

export async function authenticateFour({ address, signMessage, fetchImpl = fetch }) {
  const account = getAddress(address);
  const nonceResponse = await fetchImpl(`${FOUR_API}/v1/private/user/nonce/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountAddress: account, verifyType: 'LOGIN', networkCode: 'BSC' })
  });
  const nonce = await apiJson(nonceResponse, 'Four.Meme nonce');
  const signature = await signMessage(`You are sign in Meme ${nonce}`);
  const loginResponse = await fetchImpl(`${FOUR_API}/v1/private/user/login/dex`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ region: 'WEB', langType: 'EN', loginIp: '', inviteCode: '', verifyInfo: { address: account, networkCode: 'BSC', signature, verifyType: 'LOGIN' }, walletName: 'MetaMask' })
  });
  const accessToken = await apiJson(loginResponse, 'Four.Meme login');
  if (typeof accessToken !== 'string' || accessToken.length < 16) throw new Error('Four.Meme returned an invalid access token. No transaction was sent.');
  return accessToken;
}

export async function uploadFourImage({ file, accessToken, fetchImpl = fetch }) {
  if (!(file instanceof Blob)) throw new Error('Four.Meme requires an image file.');
  const form = new FormData();
  form.append('file', file);
  const response = await fetchImpl(`${FOUR_API}/v1/private/token/upload`, { method: 'POST', headers: { 'meme-web-access': accessToken }, body: form });
  return apiJson(response, 'Four.Meme image upload');
}

export async function requestFourCreatePayload({ request, accessToken, fetchImpl = fetch }) {
  validateFourTaxInfo(request.tokenTaxInfo);
  if (!request.raisedToken || request.raisedToken.status !== 'PUBLISH') throw new Error('Selected Four.Meme quote is not currently published.');
  const freshQuotes = await getPublishedFourQuotes({ fetchImpl });
  const canonicalQuote = freshQuotes.find((quote) => getAddress(quote.symbolAddress) === getAddress(request.raisedToken.symbolAddress));
  if (!canonicalQuote || stableJson(canonicalQuote) !== stableJson(request.raisedToken)) throw new Error('Four.Meme quote preset changed or is not canonical. No transaction was sent.');
  const response = await fetchImpl(`${FOUR_API}/v1/private/token/create`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'meme-web-access': accessToken }, body: JSON.stringify(request)
  });
  const data = await apiJson(response, 'Four.Meme create payload');
  if (!isHexString(data?.createArg) || !isHexString(data?.signature)) throw new Error('Four.Meme returned invalid creation bytes.');
  return data;
}

export function buildFourCreateTransaction({ createArg, signature, preSale = '0', deployCost = '0', nativePreSale = true }) {
  if (!isHexString(createArg) || !isHexString(signature)) throw new Error('Four.Meme creation bytes must be hexadecimal.');
  const value = (nativePreSale ? parseEther(String(preSale || '0')) : 0n) + parseEther(String(deployCost || '0'));
  return { to: FOUR_TOKEN_MANAGER_2, data: createInterface.encodeFunctionData('createToken', [createArg, signature]), value };
}

export async function submitFourCreate({ provider, signer, transaction }) {
  await assertRawChainId(provider);
  await assertContractIdentity(provider, 'fourTokenManager2');
  if (getAddress(transaction.to) !== FOUR_TOKEN_MANAGER_2) throw new Error('Unexpected Four.Meme transaction destination. No transaction was sent.');
  const parsed = createInterface.parseTransaction({ data: transaction.data, value: transaction.value });
  if (parsed?.name !== 'createToken') throw new Error('Unexpected Four.Meme transaction selector. No transaction was sent.');
  const from = await signer.getAddress();
  await provider.call({ ...transaction, from });
  await provider.estimateGas({ ...transaction, from });
  await assertRawChainId(provider);
  await assertContractIdentity(provider, 'fourTokenManager2');
  const sent = await signer.sendTransaction(transaction);
  const receipt = await sent.wait();
  if (!receipt || receipt.status !== 1) throw new Error('Four.Meme launch transaction failed.');
  const event = receipt.logs.filter((log) => getAddress(log.address) === FOUR_TOKEN_MANAGER_2).map((log) => { try { return createInterface.parseLog(log); } catch { return null; } }).find((log) => log?.name === 'TokenCreate');
  if (!event || getAddress(event.args.creator) !== getAddress(from)) throw new Error('Confirmed receipt is missing the expected Four.Meme TokenCreate event.');
  return { transactionHash: receipt.hash, token: getAddress(event.args.token), requestId: event.args.requestId };
}
