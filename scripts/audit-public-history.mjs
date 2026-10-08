import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Metadata only: never persist or print matching secrets / personal identifiers.
function gitWithInput(input, ...args) {
  const result = spawnSync('git', args, { input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed`);
  return result.stdout;
}
function git(...args) { return gitWithInput(undefined, ...args); }
const destination = path.resolve(process.argv[2] ?? '.tmp/public-history-audit');
if (!destination.startsWith(path.resolve('.tmp') + path.sep)) throw new Error('Use an ignored .tmp destination');
mkdirSync(destination, { recursive: true });
const shallow = git('rev-parse', '--is-shallow-repository').trim();
if (shallow !== 'false') throw new Error('Full history required; shallow repository refused');
const objects = git('rev-list', '--objects', '--all').trim().split('\n');
const blobPaths = new Map();
const candidates = objects.filter((entry) => entry.includes(' '));
const objectTypes = gitWithInput(candidates.map(entry => entry.slice(0, entry.indexOf(' '))).join('\n') + '\n',
  'cat-file', '--batch-check=%(objectname) %(objecttype)').trim().split('\n');
const types = new Map(objectTypes.map(entry => entry.split(' ')));
for (const entry of objects) {
  const separator = entry.indexOf(' ');
  if (separator < 0) continue;
  const hash = entry.slice(0, separator), name = entry.slice(separator + 1);
  if (types.get(hash) === 'blob') blobPaths.set(hash, name);
}
const rules = [
  ['private-network', /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/g],
  ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  ['windows-user-path', /[A-Z]:[\\/]+Users[\\/]+[^\\/\s"'`<>]+/gi],
  ['phone-like', /(?<![\w.])(?:\+?86[- ]?)?1[3-9]\d{9}(?![\w.])/g],
  ['private-key-header', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['credential-assignment', /\b(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*["'][^"'\r\n]{8,}["']/gi]
];
const hits = [], binaries = [], malformedText = [];
const content = spawnSync('git', ['cat-file', '--batch'], {
  input: [...blobPaths.keys()].join('\n') + '\n', maxBuffer: 512 * 1024 * 1024
});
if (content.status !== 0) throw new Error('Unable to read historical blobs');
let cursor = 0;
for (const [blob, name] of blobPaths) {
  const end = content.stdout.indexOf(10, cursor);
  const header = content.stdout.subarray(cursor, end).toString('utf8').split(' ');
  if (header[0] !== blob || header[1] !== 'blob') throw new Error('Invalid git batch response');
  const size = Number(header[2]);
  const bytes = content.stdout.subarray(end + 1, end + 1 + size);
  const utf16le = bytes[0] === 0xff && bytes[1] === 0xfe;
  let value = utf16le ? bytes.subarray(2).toString('utf16le') : bytes.toString('utf8');
  cursor = end + 1 + size + 1;
  if (value.includes('\0')) {
    if (/\.(?:[cm]?[jt]sx?|json|md|ya?ml|txt|ps1|css|html|cs)$/i.test(name)) {
      malformedText.push({ blob, file: name, issue: 'NUL bytes in historical text; scanned after normalization' });
      value = value.replaceAll('\0', '');
    } else { binaries.push({ blob, file: name }); continue; }
  }
  value.split(/\r?\n/).forEach((line, index) => {
    for (const [rule, regex] of rules) {
      regex.lastIndex = 0;
      if (regex.test(line)) hits.push({ blob, file: name, line: index + 1, rule });
    }
  });
}
const tracked = [...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean))];
const exportRoot = path.join(destination, 'tracked-tree');
mkdirSync(exportRoot, { recursive: true });
for (const file of tracked) {
  const target = path.resolve(exportRoot, file);
  if (!target.startsWith(exportRoot + path.sep)) throw new Error('Unexpected tracked path');
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, readFileSync(file));
}
const authors = new Map();
for (const line of git('log', '--all', '--format=%aN%x00%aE').trim().split('\n')) {
  const id = createHash('sha256').update(line).digest('hex').slice(0, 16);
  authors.set(id, (authors.get(id) ?? 0) + 1);
}
const report = { generatedAt: new Date().toISOString(), shallow: false,
  refs: git('for-each-ref', '--format=%(refname)').trim().split('\n'),
  commits: Number(git('rev-list', '--all', '--count').trim()),
  uniqueHistoricalBlobs: blobPaths.size, trackedFiles: tracked.length,
  authors: [...authors].map(([pseudonymousId, commits]) => ({ pseudonymousId, commits })),
  rules: rules.map(([name]) => name), hits, binaries, malformedText,
  limits: 'Pattern candidates need manual classification; no claim of exhaustive personal-data detection. Author identities are hashed; copyright ownership requires owner confirmation.' };
writeFileSync(path.join(destination, 'privacy-candidates.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ commits: report.commits, uniqueHistoricalBlobs: report.uniqueHistoricalBlobs,
  trackedFiles: tracked.length, candidateCount: hits.length, binaryCount: binaries.length,
  authorCount: authors.size, report: path.join(destination, 'privacy-candidates.json'), trackedExport: exportRoot }));
