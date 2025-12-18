import { Injectable } from '@nestjs/common';
import { Wallet } from 'ethers';

@Injectable()
export class WalletService {
  private _wallet?: Wallet;

  constructor() {}

  createFromPrivateKey(privateKey: string): Wallet {
    if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
      throw new Error('Invalid private key format');
    }
    this._wallet = new Wallet(privateKey);
    return this._wallet;
  }

  get wallet(): Wallet {
    if (!this._wallet) {
      throw new Error(
        'Wallet has not been initialized. Call createFromPrivateKey first.',
      );
    }
    return this._wallet;
  }
}
