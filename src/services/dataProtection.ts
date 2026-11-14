import nacl from 'tweetnacl';

type ProtectedEnvelope = {
  version: 1;
  nonce: string;
  ciphertext: string;
  digest: string;
};

let protectionSecret = 'development-only-locallearn-secret';
let restoredKey: Uint8Array | null = null;
export function exportProtectionKey() {return toBase64(key());}
export function restoreProtectionKey(value: string) {restoredKey = fromBase64(value);}

const encoder = new TextEncoder();
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array) {
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    result += alphabet[first >> 2];
    result += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)];
    result += second === undefined ? '=' : alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)];
    result += third === undefined ? '=' : alphabet[third & 63];
  }
  return result;
}

function fromBase64(value: string) {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 4) {
    const a = alphabet.indexOf(value[index]);
    const b = alphabet.indexOf(value[index + 1]);
    const c = value[index + 2] === '=' ? 0 : alphabet.indexOf(value[index + 2]);
    const d = value[index + 3] === '=' ? 0 : alphabet.indexOf(value[index + 3]);
    bytes.push((a << 2) | (b >> 4));
    if (value[index + 2] !== '=') bytes.push(((b & 15) << 4) | (c >> 2));
    if (value[index + 3] !== '=') bytes.push(((c & 3) << 6) | d);
  }
  return new Uint8Array(bytes);
}

function key() {
  if (restoredKey) return restoredKey;
  return nacl.hash(encoder.encode(`LocalLearn:${protectionSecret}`)).slice(0, nacl.secretbox.keyLength);
}

export function configureDataProtection(secret: string) {
  restoredKey = null;
  if (secret.trim()) protectionSecret = secret;
}

export function protectJson(value: unknown): string {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(encoder.encode(JSON.stringify(value)), nonce, key());
  const nonceText = toBase64(nonce);
  const ciphertextText = toBase64(ciphertext);
  const digest = toBase64(nacl.hash(encoder.encode(`${nonceText}.${ciphertextText}`)));
  const envelope: ProtectedEnvelope = { version: 1, nonce: nonceText, ciphertext: ciphertextText, digest };
  return JSON.stringify(envelope);
}

export function unprotectJson<T>(value: string): T {
  const envelope = JSON.parse(value) as ProtectedEnvelope;
  if (envelope.version !== 1) throw new Error('Unsupported protected data version.');
  const expected = toBase64(nacl.hash(encoder.encode(`${envelope.nonce}.${envelope.ciphertext}`)));
  if (expected !== envelope.digest) throw new Error('Protected data integrity check failed.');
  const plaintext = nacl.secretbox.open?.(fromBase64(envelope.ciphertext), fromBase64(envelope.nonce), key());
  if (!plaintext) throw new Error('Protected data could not be decrypted.');
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export function isProtectedJson(value: string | null | undefined) {
  if (!value) return false;
  try {
    const parsed = JSON.parse(value) as Partial<ProtectedEnvelope>;
    return parsed.version === 1 && typeof parsed.nonce === 'string' && typeof parsed.ciphertext === 'string';
  } catch (_) {
    return false;
  }
}
