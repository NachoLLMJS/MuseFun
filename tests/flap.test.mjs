import test from 'node:test';
import assert from 'node:assert/strict';
import { AbiCoder, Interface, ZeroAddress, parseEther } from 'ethers';
import { FLAP_PORTAL, FLAP_SPLIT_VAULT_FACTORY, FLAP_VAULT_PORTAL, buildFlapV6VaultTransaction, encodeSplitVaultData, findFlapVanitySalt, validateFlapV6Params } from '../src/protocols/flap.mjs';

test('Split Vault payload only accepts unique recipients totaling 10000 bps', () => {
  const data = encodeSplitVaultData([{ recipient: '0x0000000000000000000000000000000000000001', bps: 10000 }]);
  const [decoded] = AbiCoder.defaultAbiCoder().decode(['tuple(address recipient,uint16 bps)[]'], data);
  assert.equal(decoded[0].bps, 10000n);
  assert.throws(() => encodeSplitVaultData([
    { recipient: '0x0000000000000000000000000000000000000001', bps: 5000 },
    { recipient: '0x0000000000000000000000000000000000000001', bps: 5000 }
  ]), /unique/i);
  assert.throws(() => encodeSplitVaultData([{ recipient: '0x0000000000000000000000000000000000000001', bps: 9999 }]), /10000/);
});

test('V6 vault launch only accepts current Tax Token V3 constraints', () => {
  const base = { dexThresh: 1, migratorType: 1, dexId: 0, lpFeeProfile: 0, buyTaxRate: 300, sellTaxRate: 1000, mktBps: 5000, deflationBps: 0, dividendBps: 5000, lpBps: 0, tokenVersion: 6, dividendToken: ZeroAddress, minimumShareBalance: 10000n * 10n ** 18n, quoteToken: ZeroAddress, permitData: '0x' };
  assert.doesNotThrow(() => validateFlapV6Params(base));
  assert.throws(() => validateFlapV6Params({ ...base, tokenVersion: 7 }), /Tax Token V3/i);
  assert.throws(() => validateFlapV6Params({ ...base, mktBps: 4999 }), /10000/);
  assert.throws(() => validateFlapV6Params({ ...base, buyTaxRate: 0 }), /non-zero/i);
  assert.doesNotThrow(() => validateFlapV6Params({ ...base, quoteToken: '0x0000000000000000000000000000000000000002', dividendToken: '0x0000000000000000000000000000000000000002', permitData: '0x' }));
  assert.throws(() => validateFlapV6Params({ ...base, quoteToken: '0x0000000000000000000000000000000000000002', dividendToken: '0x0000000000000000000000000000000000000002', permitData: 'not-hex' }), /permitData/i);
});

test('builds exact VaultPortal V6 calldata with a valid 7777 salt', async () => {
  const { salt, address } = await findFlapVanitySalt({ suffix: '7777' });
  assert.match(address, /7777$/i);
  const params = {
    name: 'Muse Token', symbol: 'MUSE', meta: 'ipfs://meta', dexThresh: 1, salt, migratorType: 1,
    quoteToken: ZeroAddress, quoteAmt: parseEther('0.01'), permitData: '0x', extensionID: `0x${'00'.repeat(32)}`, extensionData: '0x',
    dexId: 0, lpFeeProfile: 0, buyTaxRate: 300, sellTaxRate: 1000, taxDuration: 31536000n, antiFarmerDuration: 3600n,
    mktBps: 10000, deflationBps: 0, dividendBps: 0, lpBps: 0, minimumShareBalance: 0n, dividendToken: ZeroAddress,
    commissionReceiver: ZeroAddress, tokenVersion: 6, vaultFactory: FLAP_SPLIT_VAULT_FACTORY,
    vaultData: encodeSplitVaultData([{ recipient: '0x0000000000000000000000000000000000000001', bps: 10000 }])
  };
  const tx = buildFlapV6VaultTransaction(params);
  assert.equal(tx.to, FLAP_VAULT_PORTAL);
  assert.equal(tx.value, parseEther('0.01'));
  assert.throws(() => buildFlapV6VaultTransaction({ ...params, dexThresh: 0 }), /FOUR_FIFTHS/);
  assert.equal(new Interface(['function newTokenV6WithVault((string,string,string,uint8,bytes32,uint8,address,uint256,bytes,bytes32,bytes,uint8,uint8,uint16,uint16,uint64,uint64,uint16,uint16,uint16,uint16,uint256,address,address,uint8,address,bytes)) payable']).parseTransaction({ data: tx.data }).name, 'newTokenV6WithVault');
  assert.match(FLAP_PORTAL, /^0x/);
});
