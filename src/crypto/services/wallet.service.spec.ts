import { WalletService } from './wallet.service';

// Le compte #0 de Hardhat, clé publiée.
const PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

describe('WalletService', () => {
  it('should build the wallet of the key', () => {
    expect(new WalletService().createFromPrivateKey(PRIVATE_KEY).address).toBe(
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    );
  });

  // Singleton : un champ y garderait la clé en clair jusqu'à l'arrêt du
  // gateway, au-delà de toute rotation. Rien ne doit rester sur l'instance.
  it('should keep nothing of the key on the service', () => {
    const service = new WalletService();
    service.createFromPrivateKey(PRIVATE_KEY);

    expect(Object.keys(service)).toEqual([]);
    expect(JSON.stringify(Object.values(service))).not.toContain(
      PRIVATE_KEY.slice(2),
    );
  });

  it('should refuse a malformed key without quoting it', () => {
    const malformed = '0x' + 'ab'.repeat(31);
    expect(() => new WalletService().createFromPrivateKey(malformed)).toThrow(
      new Error('Invalid private key format'),
    );
  });
});
