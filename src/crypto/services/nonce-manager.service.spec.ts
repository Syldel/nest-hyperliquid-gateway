import { NonceManagerService } from './nonce-manager.service';

describe('NonceManagerService', () => {
  let service: NonceManagerService;

  beforeEach(() => {
    service = new NonceManagerService();
  });

  it('devrait retourner un timestamp', () => {
    const ts = service.getTimestamp();
    expect(typeof ts).toBe('number');
    expect(ts).toBeGreaterThan(0);
  });

  it('devrait retourner des timestamps monotoniques', () => {
    const t1 = service.getTimestamp();
    const t2 = service.getTimestamp();
    expect(t2).toBeGreaterThanOrEqual(t1);
  });

  it('devrait forcer l’incrémentation si l’horloge recule', () => {
    const originalNow = Date.now;
    const mockNow = jest
      .fn()
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(900);

    // On simule un retour en arrière de l'horloge
    global.Date.now = mockNow as unknown as () => number;

    const t1 = service.getTimestamp();
    const t2 = service.getTimestamp();

    expect(t1).toBe(1000);
    expect(t2).toBe(1001);

    global.Date.now = originalNow;
  });
});
