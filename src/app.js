import { BrowserProvider, Contract, Interface, ZeroAddress, formatEther, getAddress, keccak256, parseEther } from 'ethers';
import registryConfig from '../config/bnb-mainnet.json';
import { authenticateFour, buildFourCreateTransaction, getPublishedFourQuotes, requestFourCreatePayload, submitFourCreate, uploadFourImage } from './protocols/four-meme.mjs';
import { FLAP_GIFT_VAULT_FACTORY, FLAP_SPLIT_VAULT_FACTORY, buildFlapV6VaultTransaction, encodeGiftVaultData, encodeSplitVaultData, findFlapVanitySalt, readFlapCompatibility, submitFlapV6Vault } from './protocols/flap.mjs';

const LAUNCH_INTEGRATIONS_READY = false;
const BNB_CHAIN_HEX = '0x38';
const REGISTRY_ABI = [
  'function registerMuse(string name,string metadataURI)',
  'function isNameAvailable(string name) view returns (bool)',
  'function museOf(address owner) view returns ((string name,string metadataURI,uint64 registeredAt,uint64 updatedAt,bool active))',
  'function totalMuses() view returns (uint256)',
  'function ownerAt(uint256 index) view returns (address)',
  'event MuseRegistered(address indexed owner,bytes32 indexed nameHash,string name,string metadataURI)'
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const toast = $('#toast');
let activeAccount = '';
let activeMuse = null;
let selectedVenue = 'Four.Meme';
let browserProvider = null;
let fourQuotes = [];

function showToast(message, tone = 'neutral') {
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.classList.add('visible');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('visible'), 3600);
}

function shortAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function configuredRegistry() {
  return /^0x[0-9a-fA-F]{40}$/.test(registryConfig.registryAddress);
}

function normalizeMuseName(value) {
  const name = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]$/.test(name)) {
    throw new Error('Muse name must be 3–32 lowercase letters, numbers, hyphens or underscores.');
  }
  return name;
}

async function requireBnbMainnet() {
  let chainId = await window.ethereum.request({ method: 'eth_chainId' });
  if (chainId.toLowerCase() !== BNB_CHAIN_HEX) {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BNB_CHAIN_HEX }] });
    chainId = await window.ethereum.request({ method: 'eth_chainId' });
  }
  if (chainId.toLowerCase() !== BNB_CHAIN_HEX) throw new Error('BNB Mainnet is required.');
}

async function registryContract() {
  if (!configuredRegistry()) throw new Error('MuseRegistry deployment is pending. No transaction was sent.');
  browserProvider ??= new BrowserProvider(window.ethereum);
  const code = await browserProvider.getCode(registryConfig.registryAddress);
  if (code === '0x') throw new Error('Configured MuseRegistry has no bytecode. No transaction was sent.');
  if (registryConfig.registryRuntimeCodeHash && keccak256(code) !== registryConfig.registryRuntimeCodeHash) throw new Error('Configured MuseRegistry bytecode does not match the audited build. No transaction was sent.');
  return new Contract(registryConfig.registryAddress, REGISTRY_ABI, browserProvider);
}

function setMuseSelection(muse) {
  const select = $('#museSelect');
  const status = $('#museStatus');
  select.replaceChildren();
  const option = document.createElement('option');
  if (muse?.active) {
    option.textContent = muse.name;
    option.value = muse.name;
    select.disabled = false;
    status.textContent = 'Registered';
    activeMuse = muse;
    $('#museRegister').hidden = true;
  } else {
    option.textContent = configuredRegistry() ? 'No Muse registered for this wallet' : 'Registry deployment pending';
    select.disabled = true;
    status.textContent = configuredRegistry() ? 'Not registered' : 'Pending';
    activeMuse = null;
    $('#museRegister').hidden = false;
  }
  select.append(option);
}

async function registerMuseInBrowser() {
  try {
    if (!activeAccount) await connectWallet();
    if (!activeAccount) return;
    await requireBnbMainnet();
    const name = normalizeMuseName($('#museName').value);
    const metadataURI = $('#museMetadata').value.trim();
    if (!metadataURI || metadataURI.length > 256) throw new Error('Add a metadata URI of at most 256 characters.');
    const readContract = await registryContract();
    if (!(await readContract.isNameAvailable(name))) throw new Error('That Muse name is already permanently reserved.');
    const signer = await browserProvider.getSigner();
    if ((await signer.getAddress()).toLowerCase() !== activeAccount.toLowerCase()) throw new Error('Active wallet changed. Reconnect first.');
    const contract = readContract.connect(signer);
    const gas = await contract.registerMuse.estimateGas(name, metadataURI);
    const approved = window.confirm(`Register “${name}” permanently on BNB Mainnet?\n\nContract: ${registryConfig.registryAddress}\nEstimated gas: ${gas}\nMetadata: ${metadataURI}`);
    if (!approved) throw new Error('Cancelled. No transaction was sent.');
    $('#registerMuseButton').disabled = true;
    const transaction = await contract.registerMuse(name, metadataURI);
    showToast(`Registration sent: ${transaction.hash.slice(0, 10)}…`, 'neutral');
    const receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1) throw new Error('Registration was not confirmed.');
    const event = receipt.logs.filter((log) => log.address.toLowerCase() === registryConfig.registryAddress.toLowerCase()).map((log) => { try { return contract.interface.parseLog(log); } catch { return null; } }).find((log) => log?.name === 'MuseRegistered');
    if (!event || event.args.owner.toLowerCase() !== activeAccount.toLowerCase() || event.args.name !== name || event.args.metadataURI !== metadataURI) throw new Error('Confirmed receipt did not contain the requested Muse registration event.');
    await Promise.all([loadConnectedMuse(), loadRecentMuses()]);
    showToast('Muse registered on BNB Mainnet.', 'success');
  } catch (error) {
    showToast(error?.code === 4001 ? 'Wallet signature rejected.' : error?.message || 'Registration failed.', 'warning');
  } finally {
    $('#registerMuseButton').disabled = false;
  }
}

async function loadConnectedMuse() {
  if (!configuredRegistry()) {
    setMuseSelection(null);
    return;
  }
  const contract = await registryContract();
  const muse = await contract.museOf(activeAccount);
  setMuseSelection(muse);
}

function renderMyMusesModal() {
  const content = $('#myMusesContent');
  content.replaceChildren();
  const walletButton = $('#modalWalletButton');
  if (!activeAccount) {
    const empty = document.createElement('div');
    empty.className = 'my-muse-empty';
    const image = document.createElement('img');
    image.src = '/assets/musefun-logo.png';
    image.alt = '';
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = 'Connect your wallet';
    const note = document.createElement('p');
    note.textContent = 'Your confirmed BNB Chain Muse will appear here.';
    copy.append(title, note);
    empty.append(image, copy);
    content.append(empty);
    walletButton.hidden = false;
    walletButton.textContent = 'Connect Wallet';
    return;
  }
  if (!activeMuse?.active) {
    const empty = document.createElement('div');
    empty.className = 'my-muse-empty';
    const image = document.createElement('img');
    image.src = '/assets/musefun-logo.png';
    image.alt = '';
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = configuredRegistry() ? 'No Muse registered' : 'Registry deployment pending';
    const note = document.createElement('p');
    note.textContent = configuredRegistry() ? 'Register a Muse from this wallet to see it here.' : 'No placeholder or simulated Muse is being shown.';
    copy.append(title, note);
    empty.append(image, copy);
    content.append(empty);
    walletButton.hidden = true;
    return;
  }
  const card = document.createElement('article');
  card.className = 'my-muse-card';
  const image = document.createElement('img');
  image.src = '/assets/musefun-logo.png';
  image.alt = `${activeMuse.name} Muse`;
  const details = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = activeMuse.name;
  const confirmed = document.createElement('span');
  confirmed.className = 'confirmed';
  confirmed.textContent = 'CONFIRMED ON-CHAIN';
  const grid = document.createElement('div');
  grid.className = 'muse-detail-grid';
  const fields = [
    ['OWNER', shortAddress(activeAccount)],
    ['NETWORK', 'BNB Chain'],
    ['REGISTERED', new Date(Number(activeMuse.registeredAt) * 1000).toLocaleDateString()],
    ['UPDATED', new Date(Number(activeMuse.updatedAt) * 1000).toLocaleDateString()]
  ];
  fields.forEach(([label, value]) => {
    const item = document.createElement('div');
    const key = document.createElement('span');
    key.textContent = label;
    const data = document.createElement('strong');
    data.textContent = value;
    item.append(key, data);
    grid.append(item);
  });
  const metadata = document.createElement('p');
  metadata.className = 'muse-metadata';
  metadata.textContent = `Metadata: ${activeMuse.metadataURI}`;
  details.append(title, confirmed, grid, metadata);
  card.append(image, details);
  content.append(card);
  walletButton.hidden = true;
}

function openMyMuses(event) {
  event?.preventDefault();
  renderMyMusesModal();
  $('#myMusesModal').showModal();
}

function renderRecentRows(records) {
  const container = $('#recentMuses');
  container.querySelectorAll('.muse-row, .empty-launches').forEach((node) => node.remove());
  if (!records.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-launches';
    const icon = document.createElement('span');
    icon.className = 'empty-orbit';
    icon.textContent = '✦';
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = configuredRegistry() ? 'No registered Muses yet' : 'Registry deployment pending';
    const note = document.createElement('small');
    note.textContent = configuredRegistry() ? 'Confirmed on-chain registrations will appear here.' : 'No registration data is being simulated.';
    copy.append(title, note);
    empty.append(icon, copy);
    container.append(empty);
    return;
  }
  records.forEach(({ owner, muse }) => {
    const row = document.createElement('div');
    row.className = 'table-row muse-row';
    row.setAttribute('role', 'row');
    const values = [muse.name, shortAddress(owner), new Date(Number(muse.registeredAt) * 1000).toLocaleDateString(), 'BNB Chain', 'Confirmed'];
    values.forEach((value) => { const cell = document.createElement('span'); cell.textContent = value; row.append(cell); });
    container.append(row);
  });
}

async function loadRecentMuses() {
  if (!configuredRegistry()) {
    renderRecentRows([]);
    return;
  }
  try {
    const contract = await registryContract();
    const total = Number(await contract.totalMuses());
    const start = Math.max(0, total - 5);
    const owners = await Promise.all(Array.from({ length: total - start }, (_, offset) => contract.ownerAt(start + offset)));
    const records = await Promise.all(owners.reverse().map(async (owner) => ({ owner, muse: await contract.museOf(owner) })));
    renderRecentRows(records.filter(({ muse }) => muse.active));
  } catch (error) {
    renderRecentRows([]);
    console.error('Could not load Muse registry', error);
  }
}

async function connectWallet() {
  if (!window.ethereum) {
    showToast('No browser wallet found. Install a compatible EIP-1193 wallet.', 'warning');
    return;
  }
  try {
    await requireBnbMainnet();
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    if (!accounts?.[0]) throw new Error('No account returned');
    activeAccount = accounts[0];
    browserProvider = new BrowserProvider(window.ethereum);
    $('#walletLabel').textContent = shortAddress(activeAccount);
    $('#walletButton').classList.add('connected');
    await loadConnectedMuse();
    if ($('#myMusesModal').open) renderMyMusesModal();
    showToast(configuredRegistry() ? 'Wallet connected and registry checked.' : 'Wallet connected. Registry deployment is still pending.', configuredRegistry() ? 'success' : 'warning');
  } catch (error) {
    showToast(error?.code === 4001 ? 'Wallet connection cancelled.' : error?.message || 'Could not connect wallet.', 'warning');
  }
}

function updateRewardOptions() {
  const dividend = $('#dividend');
  const previous = dividend.value;
  dividend.replaceChildren();
  const none = document.createElement('option');
  none.value = 'none';
  none.textContent = '— None';
  dividend.append(none);
  if (selectedVenue === 'Four.Meme') {
    const quote = fourQuotes[Number($('#pair').value)];
    if (quote) {
      const option = document.createElement('option');
      option.value = quote.symbolAddress;
      option.textContent = `${quote.symbol} — selected quote`;
      dividend.append(option);
    }
  } else {
    const option = document.createElement('option');
    option.value = '0x55d398326f99059ff775485246999027b3197955';
    option.textContent = 'USDT';
    dividend.append(option);
  }
  if ([...dividend.options].some((option) => option.value === previous)) dividend.value = previous;
}

async function refreshVenueSupport() {
  const pair = $('#pair');
  pair.replaceChildren();
  try {
    if (selectedVenue === 'Four.Meme') {
      fourQuotes = await getPublishedFourQuotes();
      fourQuotes.forEach((quote, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = quote.symbol;
        pair.append(option);
      });
      $('#vaultLabel').hidden = true;
      $('#giftHandleLabel').hidden = true;
      $('#dividend').title = 'Four.Meme holder rewards are paid in the selected quote asset.';
    } else {
      const option = document.createElement('option');
      option.value = ZeroAddress;
      option.textContent = 'BNB — live validated';
      pair.append(option);
      $('#vaultLabel').hidden = false;
      $('#giftHandleLabel').hidden = $('#vaultFactory').value !== FLAP_GIFT_VAULT_FACTORY;
      $('#taxRate').value = $('#taxRate').value === '0' ? '5' : $('#taxRate').value;
      $('#dividend').title = 'Flap Tax Token V3 supports the configured dividend token after simulation.';
    }
    updateRewardOptions();
  } catch (error) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Live support unavailable';
    pair.append(option);
    showToast(error.message, 'warning');
  }
}

async function chooseVenue(button) {
  $$('.venue').forEach((item) => {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', String(active));
  });
  selectedVenue = button.dataset.venue;
  $('#formNote').textContent = `${selectedVenue} route selected. Live protocol support is checked before signing.`;
  await refreshVenueSupport();
}

async function copyRegistrationCommand() {
  const command = 'npx --yes github:NachoLLMJS/MuseFun wallet:create --name my-muse';
  try {
    await navigator.clipboard.writeText(command);
    showToast('Wallet creation command copied.', 'success');
  } catch {
    showToast(command, 'neutral');
  }
}

async function launchFourMeme({ signer, name, ticker, metadata, initialBuy, rewardPercent, taxRate }) {
  const quote = fourQuotes[Number($('#pair').value)];
  if (!quote) throw new Error('Choose a currently published Four.Meme quote.');
  const nativePreSale = quote.symbol === 'BNB';
  if (!nativePreSale && initialBuy > 0) throw new Error('ERC-20 creator pre-buy is not enabled until Four.Meme publishes its allowance route. Set Initial Buy to 0.');
  const file = $('#tokenImage').files[0];
  if (!file) throw new Error('Four.Meme requires a token image upload.');
  if (rewardPercent > 0 && $('#dividend').value !== quote.symbolAddress) throw new Error('Four.Meme holder rewards must use the selected quote asset.');
  if (rewardPercent > 0 && taxRate === 0) throw new Error('Holder rewards require a non-zero trading tax.');
  const prepareApproved = window.confirm(`Prepare a Four.Meme launch for ${ticker}?\n\nThis signs the official login message and uploads the selected image to Four.Meme. It does not send a blockchain transaction.`);
  if (!prepareApproved) throw new Error('Cancelled. No data was uploaded and no transaction was sent.');
  const accessToken = await authenticateFour({ address: activeAccount, signMessage: (message) => signer.signMessage(message) });
  const imgUrl = await uploadFourImage({ file, accessToken });
  const request = {
    name,
    shortName: ticker,
    desc: metadata,
    imgUrl,
    launchTime: Date.now(),
    label: 'Others',
    lpTradingFee: 0.0025,
    webUrl: '', twitterUrl: '', telegramUrl: '',
    preSale: String(initialBuy),
    feePlan: false,
    raisedToken: quote
  };
  if (taxRate > 0) request.tokenTaxInfo = {
    burnRate: 0,
    divideRate: rewardPercent,
    feeRate: taxRate,
    liquidityRate: 0,
    minSharing: 100000,
    recipientAddress: activeAccount,
    recipientRate: 100 - rewardPercent
  };
  const payload = await requestFourCreatePayload({ request, accessToken });
  const transaction = buildFourCreateTransaction({ createArg: payload.createArg, signature: payload.signature, preSale: String(initialBuy), deployCost: String(quote.deployCost || '0'), nativePreSale });
  const gas = await browserProvider.estimateGas({ ...transaction, from: activeAccount });
  const approved = window.confirm(`Launch ${ticker} through Four.Meme on BNB Mainnet?\n\nContract: ${transaction.to}\nPair: ${quote.symbol}\nTotal BNB value: ${formatEther(transaction.value)} (deployment fee${nativePreSale ? ' + creator pre-buy' : ''})\nEstimated gas: ${gas}`);
  if (!approved) throw new Error('Cancelled. No transaction was sent.');
  return submitFourCreate({ provider: browserProvider, signer, transaction });
}

async function launchFlap({ signer, name, ticker, metadata, initialBuy, rewardPercent, taxRate }) {
  if (taxRate <= 0) throw new Error('Flap VaultPortal V6 requires a non-zero Tax Token V3 rate.');
  if (!metadata) throw new Error('Flap requires a metadata CID or URI.');
  const metaCid = metadata.replace(/^ipfs:\/\//i, '');
  if (!/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/.test(metaCid)) throw new Error('Flap metadata must be a pinned IPFS CID (CIDv0 or CIDv1).');
  const vaultFactory = $('#vaultFactory').value;
  const dividendToken = rewardPercent > 0 && $('#dividend').value !== 'none' ? $('#dividend').value : ZeroAddress;
  if (rewardPercent > 0 && dividendToken === ZeroAddress) throw new Error('Choose a dividend token when reward allocation is non-zero.');
  const compatibility = await readFlapCompatibility({ provider: browserProvider, quoteToken: ZeroAddress, vaultFactory, dividendToken });
  if (!compatibility.quote.enabled || !compatibility.factory.enabled) throw new Error('Selected Flap quote or vault factory is not live-enabled.');
  if (rewardPercent > 0 && !compatibility.dividend.supported) throw new Error(`Flap dividend route is unsupported: ${compatibility.dividend.errorMessage || compatibility.dividend.errorCode}.`);
  if (compatibility.dividend.blacklisted) throw new Error('Selected Flap dividend token is blacklisted.');
  showToast('Finding a valid Flap 7777 salt locally…', 'neutral');
  const { salt, address: predictedAddress } = await findFlapVanitySalt({ suffix: '7777' });
  const vaultData = vaultFactory === FLAP_GIFT_VAULT_FACTORY
    ? encodeGiftVaultData($('#giftHandle').value)
    : encodeSplitVaultData([{ recipient: activeAccount, bps: 10000 }]);
  const params = {
    name, symbol: ticker, meta: metaCid, dexThresh: 1, salt, migratorType: 1,
    quoteToken: ZeroAddress, quoteAmt: parseEther(String(initialBuy)), permitData: '0x',
    extensionID: `0x${'00'.repeat(32)}`, extensionData: '0x', dexId: 0, lpFeeProfile: 0,
    buyTaxRate: taxRate * 100, sellTaxRate: taxRate * 100, taxDuration: 31536000n, antiFarmerDuration: 3600n,
    mktBps: 10000 - rewardPercent * 100, deflationBps: 0, dividendBps: rewardPercent * 100, lpBps: 0,
    minimumShareBalance: rewardPercent > 0 ? 10000n * 10n ** 18n : 0n, dividendToken,
    commissionReceiver: activeAccount, tokenVersion: 6, vaultFactory, vaultData
  };
  const transaction = buildFlapV6VaultTransaction(params);
  await browserProvider.call({ ...transaction, from: activeAccount });
  const gas = await browserProvider.estimateGas({ ...transaction, from: activeAccount });
  const approved = window.confirm(`Launch ${ticker} through Flap VaultPortal ${compatibility.version}?\n\nContract: ${transaction.to}\nPredicted token: ${predictedAddress}\nVault: ${vaultFactory}\nValue: ${initialBuy} BNB\nEstimated gas: ${gas}`);
  if (!approved) throw new Error('Cancelled. No transaction was sent.');
  return submitFlapV6Vault({ provider: browserProvider, signer, params });
}

async function prepareLaunch() {
  try {
    const name = $('#tokenName').value.trim();
    const ticker = $('#ticker').value.trim().toUpperCase();
    const metadata = $('#tokenMetadata').value.trim();
    const initialBuy = Number($('#initialBuy').value || 0);
    const rewardPercent = Number($('#dividendPercent').value || 0);
    const taxRate = Number($('#taxRate').value || 0);
    if (!name || !ticker) throw new Error('Add a token name and ticker first.');
    if (!Number.isFinite(initialBuy) || initialBuy < 0) throw new Error('Initial buy must be a non-negative number.');
    if (!Number.isInteger(rewardPercent) || rewardPercent < 0 || rewardPercent > 100) throw new Error('Reward allocation must be an integer from 0 to 100.');
    if (!activeAccount) throw new Error('Connect your wallet before preparing a launch.');
    if (!activeMuse) throw new Error('This wallet has no confirmed on-chain Muse.');
    await requireBnbMainnet();
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (accounts?.[0]?.toLowerCase() !== activeAccount.toLowerCase()) throw new Error('Active wallet changed. Reconnect before signing.');
    if (!LAUNCH_INTEGRATIONS_READY) throw new Error(`${selectedVenue} launch integration is locked. No transaction was sent.`);
    const signer = await browserProvider.getSigner();
    $('#launchButton').disabled = true;
    const result = selectedVenue === 'Four.Meme'
      ? await launchFourMeme({ signer, name, ticker, metadata, initialBuy, rewardPercent, taxRate })
      : await launchFlap({ signer, name, ticker, metadata, initialBuy, rewardPercent, taxRate });
    showToast(`Launch confirmed: ${result.token}`, 'success');
  } catch (error) {
    showToast(error?.code === 4001 ? 'Wallet signature rejected.' : error?.message || 'Launch failed.', 'warning');
  } finally {
    $('#launchButton').disabled = false;
  }
}

$('#walletButton').addEventListener('click', connectWallet);
$('#myMusesLink').addEventListener('click', openMyMuses);
$('#closeMyMuses').addEventListener('click', () => $('#myMusesModal').close());
$('#modalWalletButton').addEventListener('click', async () => { await connectWallet(); renderMyMusesModal(); });
$('#myMusesModal').addEventListener('click', (event) => { if (event.target === $('#myMusesModal')) $('#myMusesModal').close(); });

$('#copyCommand').addEventListener('click', copyRegistrationCommand);
$('#registerMuseButton').addEventListener('click', registerMuseInBrowser);
$('#launchButton').addEventListener('click', prepareLaunch);
$$('.venue').forEach((button) => button.addEventListener('click', () => chooseVenue(button)));
$('#pair').addEventListener('change', updateRewardOptions);
$('#tokenImage').addEventListener('change', (event) => {
  $('#uploadName').textContent = event.target.files[0]?.name || 'No file';
});
$('#vaultFactory').addEventListener('change', () => { $('#giftHandleLabel').hidden = $('#vaultFactory').value !== FLAP_GIFT_VAULT_FACTORY; });
$('#ticker').addEventListener('input', (event) => { event.target.value = event.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase(); });
window.ethereum?.on?.('accountsChanged', () => window.location.reload());
window.ethereum?.on?.('chainChanged', () => window.location.reload());
chooseVenue($('.venue.active'));
loadRecentMuses();
