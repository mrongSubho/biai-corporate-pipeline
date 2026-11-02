import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      '$lib': path.resolve(__dirname, './src/lib'),
      '$client': path.resolve(__dirname, './src/client'),
      '$server': path.resolve(__dirname, './src/server')
    }
  },
  server: {
    port: 5174,
    host: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
