const enc = new TextEncoder();
const dec = new TextDecoder();

// Base64url encode bytes or a string
function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Base64url decode to bytes
function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

type KeyUsage = 'sign' | 'verify' | 'encrypt' | 'decrypt' | 'wrapKey' | 'unwrapKey' | 'deriveKey' | 'deriveBits';

async function importHmacKey(keyBytes: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usage,
  );
}

/**
 * Verify the Telegram Login Widget auth payload.
 * See: https://core.telegram.org/widgets/login#checking-authorization
 */
export async function verifyTelegramAuth(
  data: Record<string, string | number>,
  botToken: string,
): Promise<boolean> {
  const { hash, ...fields } = data;
  if (!hash || typeof hash !== 'string') return false;

  // Reject if auth_date is older than 24 hours
  const authDate = Number(fields.auth_date);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return false;

  // Build data check string: sorted key=value pairs joined by \n
  const checkString = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  // secret_key = SHA256(bot_token)
  const secretKey = await crypto.subtle.digest('SHA-256', enc.encode(botToken));

  // HMAC-SHA256(check_string, secret_key)
  const key = await importHmacKey(new Uint8Array(secretKey), ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(checkString));
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return expected === hash;
}

export interface JwtClaims {
  sub: string;
  name: string;
  exp: number;
}

/**
 * Sign a JWT with HS256 using the given secret.
 */
export async function signJwt(claims: JwtClaims, secret: string): Promise<string> {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  const data = `${header}.${payload}`;
  const key = await importHmacKey(enc.encode(secret), ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

/**
 * Verify a JWT and return its claims, or null if invalid/expired.
 */
export async function verifyJwt(token: string, secret: string): Promise<JwtClaims | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts;
    const key = await importHmacKey(enc.encode(secret), ['verify']);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlDecode(sig),
      enc.encode(`${header}.${payload}`),
    );
    if (!valid) return null;
    const claims = JSON.parse(dec.decode(b64urlDecode(payload))) as JwtClaims;
    if (Date.now() / 1000 > claims.exp) return null;
    return claims;
  } catch {
    return null;
  }
}
