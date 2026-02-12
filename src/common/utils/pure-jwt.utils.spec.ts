import { PureJwtUtil } from './pure-jwt.util';

describe('PureJwtUtil', () => {
  const secret = 'test-secret-key-123456789';
  const payload = { sub: 'user-123', role: 'admin' };

  describe('sign', () => {
    it('should generate a valid 3-part JWT string', () => {
      const token = PureJwtUtil.sign(payload, secret);
      const parts = token.split('.');

      expect(parts).toHaveLength(3);
      expect(typeof token).toBe('string');
    });

    it('should produce different signatures for different secrets', () => {
      const token1 = PureJwtUtil.sign(payload, secret);
      const token2 = PureJwtUtil.sign(payload, 'different-secret');

      const sig1 = token1.split('.')[2];
      const sig2 = token2.split('.')[2];

      expect(sig1).not.toBe(sig2);
    });
  });

  describe('verify', () => {
    it('should return decoded payload for a valid token', () => {
      const token = PureJwtUtil.sign(payload, secret);
      const decoded = PureJwtUtil.verify(token, secret);

      expect(decoded).toMatchObject(payload);
    });

    it('should return null if the signature is invalid', () => {
      const token = PureJwtUtil.sign(payload, secret);
      const tamperedToken =
        token.substring(0, token.lastIndexOf('.') + 1) + 'invalid-signature';

      expect(() => {
        const result = PureJwtUtil.verify(tamperedToken, secret);
        expect(result).toBeNull();
      }).toThrow('Invalid signature');
    });

    it('should return null if the payload was tampered with', () => {
      const token = PureJwtUtil.sign(payload, secret);
      const parts = token.split('.');
      const tamperedPayload = Buffer.from(
        JSON.stringify({ ...payload, role: 'hacker' }),
      ).toString('base64url');
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      expect(() => {
        const result = PureJwtUtil.verify(tamperedToken, secret);
        expect(result).toBeNull();
      }).toThrow('Invalid signature');
    });

    it('should return null for malformed tokens', () => {
      expect(() => {
        expect(PureJwtUtil.verify('invalidtoken', secret)).toBeNull();
      }).toThrow('Invalid token format');
      expect(() => {
        expect(PureJwtUtil.verify('part1.part2', secret)).toBeNull();
      }).toThrow('Invalid token format');
    });
  });
});
