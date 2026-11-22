import { describe, expect, it } from 'vitest';
import {
  canonicalizeJson,
  fingerprintSnapshot,
} from '../src/electron-main/fingerprint';

describe('canonicalizeJson', () => {
  it('produces the same text for equivalent objects regardless of key order', () => {
    const first = {
      version: 1,
      children: [{ id: 'title', type: 'text', text: '标题', fill: '#111111' }],
    };
    const second = {
      children: [{ fill: '#111111', text: '标题', type: 'text', id: 'title' }],
      version: 1,
    };

    expect(canonicalizeJson(first)).toBe(canonicalizeJson(second));
    expect(canonicalizeJson(first)).toBe(
      '{"children":[{"fill":"#111111","id":"title","text":"标题","type":"text"}],"version":1}',
    );
  });

  it('keeps array order significant', () => {
    const ordered = {
      version: 1,
      children: [
        { id: 'a', type: 'text', text: '一' },
        { id: 'b', type: 'text', text: '二' },
      ],
    };
    const reversed = {
      version: 1,
      children: [
        { id: 'b', type: 'text', text: '二' },
        { id: 'a', type: 'text', text: '一' },
      ],
    };

    expect(canonicalizeJson(ordered)).not.toBe(canonicalizeJson(reversed));
  });
});

describe('fingerprintSnapshot', () => {
  it('hashes the canonical UTF-8 snapshot without depending on formatting', () => {
    const snapshot = {
      version: 1,
      filePath: '/tmp/未命名.json',
      children: [],
      variables: {},
    };

    const fingerprint = fingerprintSnapshot(snapshot);

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(
      fingerprintSnapshot({
        variables: {},
        children: [],
        filePath: '/tmp/未命名.json',
        version: 1,
      }),
    ).toBe(fingerprint);
  });

  it('changes when element order changes', () => {
    const base = {
      version: 1,
      children: [
        { id: 'a', type: 'text', text: '一' },
        { id: 'b', type: 'text', text: '二' },
      ],
    };

    const swapped = {
      ...base,
      children: [...base.children].reverse(),
    };

    expect(fingerprintSnapshot(base)).not.toBe(fingerprintSnapshot(swapped));
  });
});
