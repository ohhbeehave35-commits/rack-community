// Public-tree audit. Print locations and rule names, never matching secrets.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const rules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['provider credential', /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[A-Z0-9]{16})\b/],
  ['wire credential', /\btb_[A-Za-z0-9_-]{30,}\b/],
  ['credential in URL', /[a-z]+:\/\/[^\s/:'"]+:[^\s/@'"]+@/i],
  ['private service URL', /https?:\/\/[^\s/'"<>]*(?:stinger|adamanti(?:um|um-door)|spark)[^\s/'"<>]*(?:\.[a-z]{2,}|:\d+)/i],
  ['private network URL', /https?:\/\/(?:10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)/],
  ['machine path', /(?:[A-Z]:[\\/]Users[\\/][^\s'"<>]+|\/home\/(?!runner\b)[A-Za-z0-9_-]+\/|~\/bin\/start-[a-z-]+\.sh)/i],
  ['private workspace marker', /\b(?:stinger[-_ ](?:vault|internal)|spark[-_ ](?:host|path))\b/i],
];
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
let failures = 0;
for (const file of new Set(files)) {
  if (file === 'tools/scan.mjs') continue; // Rule definitions, not exported data.
  const bytes = readFileSync(file);
  if (bytes.includes(0)) continue;
  const lines = bytes.toString('utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) for (const [name, rule] of rules) {
    // Exact synthetic refusal fixtures; these exercise SSRF rejection, not services.
    if (file === 'memory/src/lib/dream/review-fixes.test.ts' &&
        /^\s*"https:\/\/(?:user:pw@example\.com\/x|10\.0\.0\.1\/hook|192\.168\.0\.1\/hook|172\.16\.0\.1\/hook)",$/.test(lines[i])) continue;
    if (rule.test(lines[i])) { console.error(`${file}:${i + 1}: ${name}`); failures++; }
  }
}
console.log(failures ? `PUBLIC SCAN: FAIL (${failures} findings)` : 'PUBLIC SCAN: CLEAN (0 findings)');
process.exitCode = failures ? 1 : 0;
