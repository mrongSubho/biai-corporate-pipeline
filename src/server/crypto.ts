/**
 * Cloudflare Workers Compatible Web Crypto Primitives
 * Implements PBKDF2-HMAC-SHA256 password hashing, AES-256-GCM encryption for TOTP secrets,
 * RFC 6238 TOTP verification, and constant-time comparisons using crypto.subtle.
 */

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_KEY_BYTES = 32;

// Utility: ArrayBuffer to Base64
export function bufferToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Utility: Base64 to Uint8Array
export function base64ToBuffer(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Constant-time string comparison to prevent timing attacks
export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// SHA-256 Hash utility (hex output)
export async function sha256(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Generate secure random token
export function generateRandomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * PBKDF2-HMAC-SHA256 Password Hashing
 * Produces standard PHC format: $pbkdf2-sha256$i=100000$<salt_b64>$<hash_b64>
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(PBKDF2_SALT_BYTES);
  crypto.getRandomValues(salt);

  const enc = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    passwordKey,
    PBKDF2_KEY_BYTES * 8
  );

  const saltB64 = bufferToBase64(salt);
  const hashB64 = bufferToBase64(derivedBits);

  return `$pbkdf2-sha256$i=${PBKDF2_ITERATIONS}$${saltB64}$${hashB64}`;
}

/**
 * PBKDF2-HMAC-SHA256 Password Verification
 */
export async function verifyPassword(password: string, phcString: string): Promise<boolean> {
  if (!phcString || !phcString.startsWith('$pbkdf2-sha256$')) {
    return false;
  }

  const parts = phcString.split('$');
  // Format: ["", "pbkdf2-sha256", "i=100000", "<salt>", "<hash>"]
  if (parts.length < 5) return false;

  const iterPart = parts[2];
  const saltB64 = parts[3];
  const expectedHashB64 = parts[4];

  const iterations = parseInt(iterPart.replace('i=', ''), 10) || PBKDF2_ITERATIONS;
  const salt = base64ToBuffer(saltB64);

  const enc = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as any,
      iterations,
      hash: 'SHA-256'
    },
    passwordKey,
    PBKDF2_KEY_BYTES * 8
  );

  const actualHashB64 = bufferToBase64(derivedBits);
  return constantTimeCompare(actualHashB64, expectedHashB64);
}

/**
 * AES-256-GCM Encryption for sensitive secrets (TOTP secrets) at rest
 * Returns format: <iv_b64>:<ciphertext_b64>
 */
export async function encryptSecret(plaintext: string, secretKeyString: string): Promise<string> {
  const keyMaterial = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secretKeyString));
  const key = await crypto.subtle.importKey('raw', keyMaterial, 'AES-GCM', false, ['encrypt']);

  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );

  return `${bufferToBase64(iv)}:${bufferToBase64(ciphertext)}`;
}

/**
 * AES-256-GCM Decryption
 */
export async function decryptSecret(encryptedPayload: string, secretKeyString: string): Promise<string> {
  const parts = encryptedPayload.split(':');
  if (parts.length !== 2) throw new Error('Invalid encrypted payload format');

  const iv = base64ToBuffer(parts[0]);
  const ciphertext = base64ToBuffer(parts[1]);

  const keyMaterial = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secretKeyString));
  const key = await crypto.subtle.importKey('raw', keyMaterial, 'AES-GCM', false, ['decrypt']);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as any },
    key,
    ciphertext as any
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Base32 Encoding / Decoding for TOTP (RFC 3548 / RFC 4648)
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateBase32Secret(byteLength = 20): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32ToBytes(base32: string): Uint8Array {
  const clean = base32.toUpperCase().replace(/=+$/, '').replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

/**
 * RFC 6238 TOTP Code Computation
 */
export async function generateTotpCode(secretBase32: string, counterTime?: number, timeStep = 30): Promise<string> {
  const time = counterTime !== undefined ? counterTime : Math.floor(Date.now() / 1000);
  const counter = Math.floor(time / timeStep);

  const counterBytes = new Uint8Array(8);
  let temp = counter;
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = temp & 0xff;
    temp = Math.floor(temp / 256);
  }

  const keyBytes = base32ToBytes(secretBase32);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes as any,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );

  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binaryCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binaryCode % 1000000;
  return otp.toString().padStart(6, '0');
}

/**
 * RFC 6238 TOTP Verification with configurable drift window (+/- 1 step)
 */
export async function verifyTotpCode(secretBase32: string, inputCode: string, window = 1): Promise<boolean> {
  if (!inputCode || inputCode.trim().length !== 6) return false;
  const trimmed = inputCode.trim();
  const now = Math.floor(Date.now() / 1000);

  for (let i = -window; i <= window; i++) {
    const code = await generateTotpCode(secretBase32, now + i * 30, 30);
    if (constantTimeCompare(code, trimmed)) {
      return true;
    }
  }
  return false;
}
