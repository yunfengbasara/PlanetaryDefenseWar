import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5192 },
  build: { target: 'es2022' },
});
