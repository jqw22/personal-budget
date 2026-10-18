import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Served from https://jqw22.github.io/personal-budget/ on GitHub Pages.
  base: process.env.GITHUB_PAGES ? '/personal-budget/' : '/',
  plugins: [react()],
});
