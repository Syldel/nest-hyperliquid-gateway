import { Wallet } from 'ethers';

const PRIVATE_KEY =
  '0x822e9959e022b78423eb653a62ea0020cd283e71a2a8133a6ff2aeffaf373cff';

describe('Wallet creation', () => {
  it('should create wallet from private key', () => {
    const wallet = new Wallet(PRIVATE_KEY);
    expect(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });
});
