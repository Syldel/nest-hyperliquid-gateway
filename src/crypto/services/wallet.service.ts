import { Injectable } from '@nestjs/common';
import { Wallet } from 'ethers';

/**
 * Construit le `Wallet` qui signe, et ne le garde **pas**.
 *
 * Jusqu'au 2026-11-05, ce service (un singleton) rangeait le dernier `Wallet`
 * dans un champ, exposé par un getter que personne n'appelait. La clé de
 * l'agent restait donc en clair en mémoire jusqu'à l'arrêt du gateway, alors
 * que `UserClient` ne la garde que scellée sous une clé de session ; elle
 * survivait aussi à une rotation et à l'éviction du cache. Le `Wallet` vit
 * désormais le temps de l'action qui le demande.
 */
@Injectable()
export class WalletService {
  createFromPrivateKey(privateKey: string): Wallet {
    if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
      // Le message ne cite jamais la clé.
      throw new Error('Invalid private key format');
    }
    return new Wallet(privateKey);
  }
}
