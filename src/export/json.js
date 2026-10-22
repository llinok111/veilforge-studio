/**
 * Config (JSON) export and share-link encoding.
 *
 * Round-trip is guaranteed by `normalizeConfig`: parse(serialize(c)) deep-equals c
 * for every config the UI can produce, which the test suite asserts.
 */

import { prepare } from './shared.js';
import { serializeConfig, encodeShareHash } from '../core/config.js';

export function buildJsonExport(config, origin = '') {
  const cfg = prepare(config);
  const json = serializeConfig(cfg);
  const hash = encodeShareHash(cfg);
  const shareUrl = `${origin || 'https://example.com/veilforge/'}#${hash}`;

  return {
    format: 'json',
    mime: 'application/json',
    approx: 'exact',
    notes: [
      'Re-import this file in the studio to get the identical frame — every value is a literal, nothing is derived at load time.',
      `${shareUrl.length} characters of share URL encode the full config.`,
    ],
    files: [
      { name: `veilforge-${cfg.generator}.json`, mime: 'application/json', text: json },
    ],
    snippet: json,
    shareUrl,
    primary: `veilforge-${cfg.generator}.json`,
  };
}
