export default {
  solidity: {
    version: '0.8.37',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'paris'
    }
  },
  networks: {
    musefunLocal: {
      type: 'edr-simulated',
      chainType: 'l1',
      chainId: 56
    }
  }
};
