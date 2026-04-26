import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5176,
    proxy: {
      '/savePortfolio': 'http://localhost:3001',
      '/saveRealized': 'http://localhost:3001',
      '/saveSettings': 'http://localhost:3001',
      '/api': 'http://localhost:3001',
    }
  }
});
