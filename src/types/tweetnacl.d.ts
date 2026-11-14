declare module 'tweetnacl' {
  const nacl: {
    randomBytes(length: number): Uint8Array;
    hash(message: Uint8Array): Uint8Array;
    secretbox: {
      (message: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
      nonceLength: number;
      keyLength: number;
    };
  };
  export default nacl;
}
