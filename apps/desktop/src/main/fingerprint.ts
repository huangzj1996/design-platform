import { createHash } from 'node:crypto';

/**
 * Serializes JSON data deterministically: object keys are sorted by their
 * UTF-16 code units, arrays keep their order, and no insignificant whitespace
 * is emitted. The editor only fingerprints plain JSON snapshots.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalizeJson(entry)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const members = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`);
  return `{${members.join(',')}}`;
}

/**
 * Computes the saved-snapshot fingerprint: SHA-256 over the canonical UTF-8
 * text. Equal JSON with different key order or indentation hashes the same;
 * a changed sibling order changes the hash.
 */
export function fingerprintSnapshot(snapshot: unknown): string {
  return createHash('sha256')
    .update(canonicalizeJson(snapshot), 'utf8')
    .digest('hex');
}
