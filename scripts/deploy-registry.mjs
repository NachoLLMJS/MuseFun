import { readFile, writeFile } from 'node:fs/promises';
import { ContractFactory, JsonRpcProvider, Wallet, keccak256 } from 'ethers';
import { confirm, password as askPassword } from '@inquirer/prompts';

if (process.env.MUSEFUN_CONFIRM_MAINNET_DEPLOY !== 'I_UNDERSTAND_THIS_SPENDS_BNB') {
  throw new Error('Deployment locked. Set MUSEFUN_CONFIRM_MAINNET_DEPLOY only after reviewing the audit and gas estimate.');
}
if (!process.env.MUSEFUN_DEPLOYER_KEYSTORE) {
  throw new Error('An encrypted deployer keystore path is required. Raw private keys are not accepted.');
}

const configUrl = new URL('../config/bnb-mainnet.json', import.meta.url);
const config = JSON.parse(await readFile(configUrl, 'utf8'));
if (config.chainId !== 56) throw new Error('Refusing to deploy outside BNB Mainnet configuration.');
const artifact = JSON.parse(await readFile(new URL('../artifacts/MuseRegistry.json', import.meta.url), 'utf8'));
const keystore = await readFile(process.env.MUSEFUN_DEPLOYER_KEYSTORE, 'utf8');
const password = await askPassword({ message: 'Keystore password', mask: '*' });
const provider = new JsonRpcProvider(config.rpcUrl);
if (BigInt(await provider.send('eth_chainId', [])) !== 56n) throw new Error('RPC chain mismatch.');

const wallet = (await Wallet.fromEncryptedJson(keystore, password)).connect(provider);
const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
const deployRequest = await factory.getDeployTransaction();
await provider.call({ ...deployRequest, from: wallet.address });
const [estimatedGas, fee, balance] = await Promise.all([
  provider.estimateGas({ ...deployRequest, from: wallet.address }),
  provider.getFeeData(),
  provider.getBalance(wallet.address)
]);
const gasPrice = fee.gasPrice ?? 0n;
const estimatedCost = estimatedGas * gasPrice;
console.log(`Deployer: ${wallet.address}`);
console.log(`Balance: ${balance} wei; estimated gas: ${estimatedGas}; estimated cost: ${estimatedCost} wei.`);
if (balance < estimatedCost) throw new Error('Deployer has insufficient BNB for the estimated deployment cost. No transaction was sent.');
if (!(await confirm({ message: `Broadcast MuseRegistry deployment to BNB Mainnet (chain 56) from ${wallet.address}?`, default: false }))) {
  throw new Error('Cancelled. No transaction was sent.');
}

const contract = await factory.deploy();
console.log(`Broadcast ${contract.deploymentTransaction().hash}`);
await contract.waitForDeployment();
const registryAddress = await contract.getAddress();
const deployedCode = await provider.getCode(registryAddress);
const expectedHash = keccak256(artifact.deployedBytecode);
const actualHash = keccak256(deployedCode);
if (actualHash !== expectedHash) throw new Error(`Deployed runtime bytecode mismatch at ${registryAddress}.`);
config.registryAddress = registryAddress;
config.registryRuntimeCodeHash = actualHash;
await writeFile(configUrl, `${JSON.stringify(config, null, 2)}\n`);
console.log(`MuseRegistry deployed and verified at ${registryAddress}`);
