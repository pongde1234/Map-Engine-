import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { concatBytes, utf8 } from '@me/schema';

/** Chain hash: sha256(prev_hash_hex || stored_body_bytes), hex. */
export function chainHash(prevHash: string, body: Uint8Array): string {
  return bytesToHex(sha256(concatBytes(utf8(prevHash), body)));
}

export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}
