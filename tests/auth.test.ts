import { describe, it, expect } from 'vitest';
import { signJwt, verifyJwt, verifyTelegramAuth } from '../src/auth';

const SECRET = 'test-secret';

describe('signJwt / verifyJwt', () => {
  it('round-trips valid claims', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = await signJwt({ sub: '12345', name: 'Alice', exp }, SECRET);
    const claims = await verifyJwt(token, SECRET);
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe('12345');
    expect(claims!.name).toBe('Alice');
  });

  it('returns null for wrong secret', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = await signJwt({ sub: '12345', name: 'Alice', exp }, SECRET);
    expect(await verifyJwt(token, 'wrong-secret')).toBeNull();
  });

  it('returns null for expired token', async () => {
    const exp = Math.floor(Date.now() / 1000) - 1;
    const token = await signJwt({ sub: '12345', name: 'Alice', exp }, SECRET);
    expect(await verifyJwt(token, SECRET)).toBeNull();
  });

  it('returns null for tampered payload', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = await signJwt({ sub: '12345', name: 'Alice', exp }, SECRET);
    const parts = token.split('.');
    const tampered = `${parts[0]}.${btoa('{"sub":"99999","name":"Eve","exp":9999999999}')}.${parts[2]}`;
    expect(await verifyJwt(tampered, SECRET)).toBeNull();
  });
});

describe('verifyTelegramAuth', () => {
  it('rejects when hash is missing', async () => {
    const result = await verifyTelegramAuth({ id: 123, auth_date: Date.now() / 1000 }, 'token');
    expect(result).toBe(false);
  });

  it('rejects when auth_date is older than 24 hours', async () => {
    const stale = Math.floor(Date.now() / 1000) - 86401;
    const result = await verifyTelegramAuth({ id: 123, auth_date: stale, hash: 'abc' }, 'token');
    expect(result).toBe(false);
  });
});
