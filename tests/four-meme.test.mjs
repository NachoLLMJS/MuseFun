import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface, parseEther } from 'ethers';
import { FOUR_TOKEN_MANAGER_2, getPublishedFourQuotes, buildFourCreateTransaction, validateFourTaxInfo } from '../src/protocols/four-meme.mjs';

test('Four.Meme quote choices come only from current published API config', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ code: 0, data: [
    { symbol: 'BNB', symbolAddress: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', status: 'PUBLISH', deployCost: '0' },
    { symbol: 'HIDDEN', symbolAddress: '0x0000000000000000000000000000000000000001', status: 'HIDE', deployCost: '0' }
  ] }) });
  const quotes = await getPublishedFourQuotes({ fetchImpl: fakeFetch });
  assert.deepEqual(quotes.map((quote) => quote.symbol), ['BNB']);
});

test('Four.Meme tax allocations and rates fail closed', () => {
  assert.doesNotThrow(() => validateFourTaxInfo({ feeRate: 5, burnRate: 20, divideRate: 30, liquidityRate: 40, recipientRate: 10 }));
  assert.throws(() => validateFourTaxInfo({ feeRate: 2, burnRate: 20, divideRate: 30, liquidityRate: 40, recipientRate: 10 }), /fee rate/i);
  assert.throws(() => validateFourTaxInfo({ feeRate: 5, burnRate: 20, divideRate: 30, liquidityRate: 40, recipientRate: 5 }), /sum to 100/i);
});

test('Four.Meme transaction uses official TokenManager2 and exact opaque backend bytes', () => {
  const createArg = '0x1234';
  const signature = `0x${'11'.repeat(65)}`;
  const tx = buildFourCreateTransaction({ createArg, signature, preSale: '0.1', deployCost: '0.01' });
  assert.equal(tx.to, FOUR_TOKEN_MANAGER_2);
  assert.equal(tx.value, parseEther('0.11'));
  const decoded = new Interface(['function createToken(bytes args,bytes signature) payable']).decodeFunctionData('createToken', tx.data);
  assert.equal(decoded.args, createArg);
  assert.equal(decoded.signature, signature);
});

test('Four.Meme ERC-20 quote creation never sends the pre-buy as native BNB', () => {
  const tx = buildFourCreateTransaction({ createArg: '0x1234', signature: `0x${'11'.repeat(65)}`, preSale: '2', deployCost: '0.01', nativePreSale: false });
  assert.equal(tx.value, parseEther('0.01'));
});
