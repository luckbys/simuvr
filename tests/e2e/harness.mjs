// Utilitários E2E: sobe `vite preview` e abre o Chromium headless com WebGL por software.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

export const PORT = 4173;
export const URL_BASE = `http://localhost:${PORT}/`;

export async function startServer() {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', 'localhost'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SIMUVR_HTTP: '1', NO_PROXY: 'localhost,127.0.0.1', no_proxy: 'localhost,127.0.0.1' },
    detached: true,
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite preview não subiu a tempo')), 30000);
    const onData = (d) => {
      if (String(d).includes(String(PORT))) {
        clearTimeout(t);
        resolve();
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (c) => reject(new Error(`vite preview saiu com código ${c}`)));
  });
  // o processo é líder de grupo (detached): encerra o npx e o vite filho juntos
  return () => {
    try {
      process.kill(-proc.pid, 'SIGTERM');
    } catch {
      /* já encerrou */
    }
  };
}

export async function launch() {
  return chromium.launch({
    headless: true,
    args: [
      '--use-angle=swiftshader',
      '--use-gl=angle',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--no-sandbox',
    ],
  });
}

export function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

export function assert(cond, msg) {
  if (!cond) throw new Error(`FALHOU: ${msg}`);
  console.log(`ok  - ${msg}`);
}
