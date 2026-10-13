import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// WebXR no Quest exige contexto seguro (HTTPS), então o dev server e o preview usam
// certificado autoassinado. Os testes E2E definem SIMUVR_HTTP=1 para usar HTTP em localhost.
const useSsl = !process.env.SIMUVR_HTTP;

export default defineConfig(({ command }) => ({
  base: './',
  plugins: command === 'serve' && useSsl ? [basicSsl()] : [],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
}));
