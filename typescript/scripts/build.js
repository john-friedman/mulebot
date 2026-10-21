import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {DOC_PAGES} from '../src/config.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const repository = fileURLToPath(new URL('../..', import.meta.url));
const dist = join(root, 'dist');

await mkdir(dist, { recursive: true });
execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', root], {stdio: 'inherit'});
for (const directory of ['docs', 'ui']) {
  await cp(join(repository, directory), join(dist, directory), { recursive: true });
}
await cp(join(repository, 'LICENSE'), join(dist, 'LICENSE'));
const licenses = await Promise.all([
  ['dt-sql-parser', 'LICENSE'], ['antlr4ng', 'LICENSE.txt'],
  ['antlr4-c3', 'License.txt'], ['sql.js', 'LICENSE'],
].map(async ([name, file]) => `${name}\n${await readFile(join(root, 'node_modules', name, file), 'utf8')}`));
await writeFile(join(dist, 'THIRD_PARTY_LICENSES.txt'), licenses.join('\n\n'));

const documentation = await Promise.all(Object.values(DOC_PAGES).map(async name =>
  `--- docs/${name} ---\n${await readFile(join(dist, 'docs', name), 'utf8')}`));
const schema = await readFile(join(dist, 'docs/schema.md'), 'utf8');
await build({
  entryPoints: [join(root, 'src/index.ts')], outfile: join(dist, 'index.js'),
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022', minify: true, keepNames: true,
  plugins: [{name: 'portable-assets', setup(builder) {
    builder.onResolve({filter: /^mulebot:context$/}, () => ({path: 'context', namespace: 'mulebot'}));
    builder.onLoad({filter: /.*/, namespace: 'mulebot'}, () => ({contents:
      `export const documentation = ${JSON.stringify(documentation.join('\n\n'))}; export const schema = ${JSON.stringify(schema)};`}));
    // The in-memory asm.js build needs no filesystem. Its Node random source uses Web Crypto.
    builder.onResolve({filter: /^node:(fs|crypto)$/}, args => ({path: args.path, namespace: 'sqlite-platform'}));
    builder.onLoad({filter: /.*/, namespace: 'sqlite-platform'}, args => ({contents: args.path === 'node:crypto'
      ? 'export function randomFillSync(bytes) { return globalThis.crypto.getRandomValues(bytes); }'
      : 'export default {};'}));
  }}],
});
await build({entryPoints: [join(root, 'src/server.ts'), join(root, 'src/cli.ts')], outdir: dist,
  bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['./index.js', './server.js']});
