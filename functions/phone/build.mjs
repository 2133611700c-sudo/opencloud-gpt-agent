import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

await build({
  entryPoints: [fileURLToPath(new URL('./index.mjs', import.meta.url))],
  outfile: fileURLToPath(new URL('./dist/index.mjs', import.meta.url)),
  bundle: true, platform: 'node', target: 'node24', format: 'esm', external: ['pg-native'],
  banner: { js: "import{createRequire as ___cr}from'node:module';import{fileURLToPath as ___f}from'node:url';import{dirname as ___d}from'node:path';const require=___cr(import.meta.url);const __filename=___f(import.meta.url);const __dirname=___d(__filename);" },
});
