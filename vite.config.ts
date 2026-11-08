import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Em dev, a API roda no `wrangler dev` (porta 8787)
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
});

