import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/extension.ts'],
  format: ['cjs'],
  outDir: 'dist',
  external: ['vscode'],
  noExternal: ['@babel/parser', '@babel/traverse', '@babel/types'],
  bundle: true,
  splitting: false,
  clean: true,
});
