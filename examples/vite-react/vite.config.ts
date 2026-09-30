import react from '@vitejs/plugin-react';
import hai from 'hai-browser-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [hai(), react()],
  server: { port: 5173, host: '127.0.0.1' },
});
