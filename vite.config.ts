import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  // Relative assets keep the build portable on GitHub Pages and future custom domains.
  base: './',
});
