import react from '@vitejs/plugin-react';
import hai from 'hai-browser-vite';
import { defineConfig, type Plugin } from 'vite';

/** Tiny fake backend so the demo has real network requests. */
function mockApi(): Plugin {
  let nextOrder = 1042;
  return {
    name: 'mock-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'POST' || !req.url?.startsWith('/api/')) return next();
        let body = '';
        req.on('data', chunk => (body += chunk));
        req.on('end', () => {
          res.setHeader('Content-Type', 'application/json');
          if (req.url === '/api/orders') res.end(JSON.stringify({ id: nextOrder++, ...JSON.parse(body || '{}') }));
          else if (req.url === '/api/contact') res.end(JSON.stringify({ ok: true }));
          else if (req.url === '/api/newsletter') res.end(JSON.stringify({ ok: true }));
          else {
            res.statusCode = 404;
            res.end('{}');
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [hai(), react(), mockApi()],
  server: { port: 5180, host: '127.0.0.1' },
});
