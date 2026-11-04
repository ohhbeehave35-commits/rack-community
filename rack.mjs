#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { ownerCookie } from './tools/owner-gate.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const data = resolve(process.env.RACK_DIR || join(root, '.data', 'rack'));
const windows = process.platform === 'win32';
export const python = process.env.RACK_PYTHON || (windows ? 'python' : 'python3');
const venv = join(root, '.data', 'venv', windows ? 'Scripts/python.exe' : 'bin/python');
const apps = ['panel', 'memory', 'room'];

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: windows && command.endsWith('.cmd') });
  if (result.error || result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.error?.code})`);
}

function install() {
  mkdirSync(join(root, '.data'), { recursive: true });
  if (!existsSync(venv)) run(python, ['-m', 'venv', join(root, '.data', 'venv')]);
  run(venv, ['-m', 'pip', 'install', '-r', 'engine/requirements.txt']);
  for (const app of apps) run(windows ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund'], join(root, app));
  console.log('Rack 2.0.0 installed. Run: node rack.mjs up');
}

async function up() {
  if (windows) throw new Error('The engine actor requires Linux (fcntl, flock and process groups). Use Linux or WSL2 for rack up.');
  if (!existsSync(venv) || apps.some(app => !existsSync(join(root, app, 'node_modules/vite/bin/vite.js')))) {
    throw new Error('Install first: node rack.mjs install');
  }
  mkdirSync(data, { recursive: true });
  const lock = join(data, 'rack.pid');
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid rack.pid; inspect it before removing it.');
    try { process.kill(pid, 0); throw new Error('A Rack owner is already running.'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; unlinkSync(lock); }
  }
  const fd = openSync(lock, 'wx', 0o600); writeFileSync(fd, String(process.pid)); closeSync(fd);
  const children = [];
  let stopping = false;
  const stop = (code) => {
    if (stopping) return; stopping = true;
    for (const child of children) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
    setTimeout(() => {
      for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
      unlinkSync(lock); process.exit(code);
    }, 1500);
  };
  process.on('SIGINT', () => stop(0)); process.on('SIGTERM', () => stop(0));
  try {
    for (const name of ['recipes', 'samples', 'peaks.conf']) if (!existsSync(join(data, name))) cpSync(join(root, 'engine', name), join(data, name), { recursive: true });
    const tokenPath = join(data, '.token');
    if (!existsSync(tokenPath)) writeFileSync(tokenPath, randomBytes(24).toString('base64url'), { mode: 0o600 });
    const ports = [process.env.RACK_PANEL_PORT || '8080', process.env.RACK_MEMORY_PORT || '8081', process.env.RACK_ROOM_PORT || '8082', process.env.RACK_API_PORT || '8797'];
    if (ports.some(p => !/^\d+$/.test(p) || +p < 1024 || +p > 65535) || new Set(ports).size !== 4) throw new Error('Rack needs four distinct ports between 1024 and 65535.');
    const env = { ...process.env, RACK_DIR: data, RACK_TOKEN: readFileSync(tokenPath, 'utf8').trim(), RACK_API_PORT: ports[3], RACK_CORS_ORIGINS: `http://127.0.0.1:${ports[0]}` };
    const launch = (command, args, cwd, extra = {}) => {
      const child = spawn(command, args, { cwd, env: { ...env, ...extra }, stdio: 'inherit', detached: true });
      children.push(child);
      child.on('error', () => { console.error('Rack child could not start.'); stop(1); });
      child.on('exit', (code) => { if (!stopping) { console.error(`Rack child exited (${code}); stopping all services.`); stop(1); } });
    };
    launch(venv, ['-m', 'uvicorn', 'rack_api:app', '--host', '127.0.0.1', '--port', ports[3]], join(root, 'engine'));
    launch(venv, ['rack_actor.py'], join(root, 'engine'));
    apps.forEach((app, i) => launch(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', ports[i]], join(root, app), {
      DATABASE_URL: '', DATABASE_URL_UNPOOLED: '', DATABASE_POSTGRES_URL_NON_POOLING: '', POSTGRES_URL_NON_POOLING: '',
      PGLITE_DATA_DIR: join(data, app), VITE_RACK_EMBEDDED: '1',
      VITE_RACK_API_BASE: '/engine',
      VITE_RACK_MEMORY_URL: `http://127.0.0.1:${ports[1]}`, VITE_RACK_ROOM_URL: `http://127.0.0.1:${ports[2]}`,
    }));
    const headers = env.RACK_OWNER_PASSWORD ? { Cookie: `rack_owner=${ownerCookie(env.RACK_OWNER_PASSWORD)}` } : {};
    const deadline = Date.now() + 120000;
    for (const port of ports) {
      while (!stopping) {
        try { const response = await fetch(`http://127.0.0.1:${port}/`, { headers, signal: AbortSignal.timeout(5000) }); if (response.ok) break; } catch {}
        if (Date.now() > deadline) throw new Error(`Service on port ${port} did not become ready.`);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    if (!stopping) {
      console.log(`Rack 2.0.0 ready: http://127.0.0.1:${ports[0]}`);
      console.log(`Somnus: http://127.0.0.1:${ports[1]} | TalkBack: http://127.0.0.1:${ports[2]} | Engine: http://127.0.0.1:${ports[3]}`);
      console.log(`One local owner. Controls token file: ${tokenPath}. Ctrl+C stops all services.`);
    }
  } catch (error) { console.error(error.message); stop(1); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === 'install') install();
    else if (process.argv[2] === 'up') await up();
    else { console.log('Rack 2.0.0: node rack.mjs install | node rack.mjs up'); process.exitCode = 2; }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
