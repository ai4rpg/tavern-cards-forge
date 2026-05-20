import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli/index.ts'],
  format: ['esm'],
  target: 'node20',
  splitting: false,
  sourcemap: false,
  clean: true,
  dts: false,
  outDir: 'dist',
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __tcfCreateRequire } from 'module';",
      'const require = __tcfCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  outExtension: () => ({ js: '.mjs' }),
  noExternal: [
    'commander',
    'crc',
    'fast-json-patch',
    'jiti',
    'lodash',
    'png-chunk-text',
    'png-chunks-extract',
    'yaml',
    'jsonpath-plus',
    'zod',
  ],
});
