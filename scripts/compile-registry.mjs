import { readFile, mkdir, writeFile } from 'node:fs/promises';
import solc from 'solc';

const source = await readFile(new URL('../contracts/MuseRegistry.sol', import.meta.url), 'utf8');
const input = {
  language: 'Solidity',
  sources: { 'MuseRegistry.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'paris',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'metadata'] } }
  }
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors ?? []).filter((item) => item.severity === 'error');
if (errors.length) throw new Error(errors.map((item) => item.formattedMessage).join('\n'));
const compiled = output.contracts['MuseRegistry.sol'].MuseRegistry;
const artifact = {
  contractName: 'MuseRegistry',
  sourceName: 'MuseRegistry.sol',
  compiler: solc.version(),
  abi: compiled.abi,
  bytecode: `0x${compiled.evm.bytecode.object}`,
  deployedBytecode: `0x${compiled.evm.deployedBytecode.object}`,
  metadata: JSON.parse(compiled.metadata)
};
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
await writeFile(new URL('../artifacts/MuseRegistry.json', import.meta.url), `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`Compiled MuseRegistry with ${artifact.compiler}; deployment bytecode ${artifact.bytecode.length / 2 - 1} bytes.`);
