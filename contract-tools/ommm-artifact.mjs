import fs from 'node:fs';
import solc from 'solc';

export function compileOmmm() {
  const source = fs.readFileSync(new URL('../contracts/dlang/OmmmReserve.sol', import.meta.url), 'utf8');
  const input = {
    language: 'Solidity', sources: { 'OmmmReserve.sol': { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode'] } }
    }
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import(path) {
    if (!path.startsWith('@openzeppelin/contracts/') || path.includes('..')) return { error: 'Unexpected contract import' };
    try {
      const contents = fs.readFileSync(new URL(`node_modules/${path}`, import.meta.url), 'utf8');
      input.sources[path] = { content: contents };
      return { contents };
    }
    catch (error) { return { error: `Contract dependency unavailable: ${error.message}` }; }
  } }));
  const errors = (output.errors || []).filter(error => error.severity === 'error');
  if (errors.length) throw Error(errors.map(error => error.formattedMessage).join('\n'));
  const artifact = output.contracts['OmmmReserve.sol'].OmmmReserve;
  return { input, source, compiler: solc.version(), abi: artifact.abi,
    bytecode: `0x${artifact.evm.bytecode.object}`, runtime: artifact.evm.deployedBytecode };
}
