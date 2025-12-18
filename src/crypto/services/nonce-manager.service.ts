import { Injectable } from '@nestjs/common';

@Injectable()
export class NonceManagerService {
  private lastTimestamp = 0;

  /**
   * Hyperliquid doesn't use nonces.
   * It only requires monotonically increasing timestamps.
   */
  getTimestamp(): number {
    const now = Date.now();

    // Ensure monotonic (never decreasing)
    if (now <= this.lastTimestamp) {
      this.lastTimestamp += 1;
    } else {
      this.lastTimestamp = now;
    }

    return this.lastTimestamp;
  }
}
