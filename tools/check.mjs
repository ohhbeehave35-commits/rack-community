import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const windows = process.platform === 'win32';
const temp = join(root, '.data', 'test-tmp');
mkdirSync(temp, { recursive: true });
for (const key of ['TMP', 'TEMP', 'TMPDIR']) process.env[key] = temp;
function check(command, args, directory) {
  const result = spawnSync(command, args, { cwd: join(root, directory), stdio: 'inherit', shell: windows && command.endsWith('.cmd') });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
const mode = process.argv[2];
if (!['test', 'typecheck'].includes(mode)) throw new Error('Expected test or typecheck');
if (mode === 'test') {
  check(process.execPath, ['--test', 'tools/owner-gate.test.mjs'], '.');
  const venv = join(root, '.data/venv', windows ? 'Scripts/python.exe' : 'bin/python');
  check(existsSync(venv) ? venv : (process.env.RACK_PYTHON || (windows ? 'python' : 'python3')), ['-m', 'pytest', '-q', 'tests'], 'engine');
}
for (const app of ['panel', 'memory', 'room']) check(windows ? 'npm.cmd' : 'npm', ['run', mode], app);
if (mode === 'test') check(windows ? 'npm.cmd' : 'npm', ['run', 'desktop:test-wire'], 'room');
console.log(`RACK ${mode.toUpperCase()}: PASS (exit 0)`);
