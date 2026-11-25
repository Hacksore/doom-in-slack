import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [{
    name: 'doom-local-dev',
    configureServer(server) {
      let engine: string;
      let wasm: string;
      let wad: string;
      try {
        engine = readFileSync('.build/engine.js', 'utf8');
        wasm = gzipSync(readFileSync('.build/engine.wasm')).toString('base64');
        wad = gzipSync(readFileSync('.build/doom1.wad')).toString('base64');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        throw new Error('Run pnpm setup and pnpm build before starting the dev server.');
      }

      server.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/') return next();
        try {
          const html = readFileSync('src/shell.html', 'utf8')
            // Vite's client needs same-origin scripts and a local WebSocket.
            .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i, '')
            .replace('/*ENGINE*/', () => engine)
            .replace('__WASM__', wasm)
            .replace('__WAD__', wad)
            .replace('__NOTICES__', 'See the licenses directory for notices and credits.');
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.end(await server.transformIndexHtml('/', html));
        } catch (error) {
          next(error);
        }
      });
    },
    handleHotUpdate({ file, server }) {
      if (file.endsWith('/src/shell.html')) {
        server.ws.send({ type: 'full-reload', path: '*' });
        return [];
      }
    },
  }],
});
