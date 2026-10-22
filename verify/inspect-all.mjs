/** Inspect all six generators at the default palette and print text views. */

import { inspect } from './ascii.mjs';
import { createServer } from '../tools/serve.mjs';

const server = createServer();
await new Promise((r) => server.listen(4329, '127.0.0.1', r));

const GEN = ['mesh', 'noise', 'blobs', 'flow', 'particles', 'texture'];
for (const g of GEN) {
  await inspect({ generator: g, seed: 20261022, aspect: '16:9', animated: false }, { label: g });
}
server.close();
