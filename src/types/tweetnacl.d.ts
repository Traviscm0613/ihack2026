declare module 'tweetnacl' {
  const nacl: {
    setPRNG(generator: (bytes: Uint8Array, length: number) => void): void;
    randomBytes(length: number): Uint8Array;
    hash(message: Uint8Array): Uint8Array;
    secretbox: {
      (message: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
      open(ciphertext: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array | null;
      nonceLength: number;
      keyLength: number;
    };
  };
  export default nacl;
}
