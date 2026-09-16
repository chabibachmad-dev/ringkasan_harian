import { defineConfig } from 'vite';

// Base path disesuaikan otomatis untuk GitHub Pages lewat env GITHUB_PAGES_BASE
// (di-set oleh workflow .github/workflows/deploy.yml sebagai "/<nama-repo>/").
export default defineConfig({
  base: process.env.GITHUB_PAGES_BASE || '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
