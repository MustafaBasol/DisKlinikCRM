import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

await esbuild.build({
  entryPoints: [path.join(root, 'src/index.ts')],
  outfile: path.join(root, 'dist/agent.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
  // import.meta.url is unavailable in cjs output — agentVersion is baked in at build time instead.
  define: { __AGENT_VERSION__: JSON.stringify(pkg.version) },
});

console.log('Built dist/agent.cjs');
