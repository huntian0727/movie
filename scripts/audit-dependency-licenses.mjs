import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const packages = Object.entries(lock.packages).filter(([name]) => name).map(([location, entry]) => {
  const installedLicense = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md', 'COPYING', 'license-mit']
    .find((file) => existsSync(path.join(location, file)));
  const reviewedUpstream = `docs/legal/upstream/${path.basename(location)}-${entry.version}-LICENSE.txt`;
  const licenseFile = installedLicense ? `${location}/${installedLicense}` : existsSync(reviewedUpstream) ? reviewedUpstream : null;
  return { location, version: entry.version, developmentOnly: !!entry.dev,
    licenseDeclared: entry.license ?? 'UNCONFIRMED', resolved: entry.resolved, integrity: entry.integrity,
    manuallyReviewedLicense: location.endsWith('/parse-cache-control') && entry.version === '1.0.1' ? 'BSD-3-Clause (verified installed LICENSE)' : null,
    licenseFile,
    licenseFileSha256: licenseFile ? createHash('sha256').update(readFileSync(licenseFile)).digest('hex') : null };
});
const binaries = ['node_modules/ffmpeg-static/ffmpeg.exe', 'node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe']
  .map((file) => {
    const bytes = readFileSync(file);
    const version = spawnSync(path.resolve(file), ['-version'], { encoding: 'utf8', windowsHide: true });
    if (version.status !== 0) throw new Error(`Unable to inspect ${file}`);
    return { file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
      versionAndBuildConfiguration: version.stdout, compliance: 'PENDING_CORRESPONDING_SOURCE_AND_BUILD_PROVENANCE' };
  });
const report = { generatedAt: new Date().toISOString(), lockVersion: lock.lockfileVersion,
  note: 'Declarations are an inventory, not an ownership/legal approval. Transitive and binary licensing requires source/notices review. No project license has been granted.',
  packages, binaries };
mkdirSync('docs/legal', { recursive: true });
writeFileSync('docs/legal/dependency-inventory.json', JSON.stringify(report, null, 2));
const notices = ['# Third-party license texts', '', 'Generated from installed production dependencies; binary-source compliance remains pending.', ''];
for (const item of packages.filter(item => !item.developmentOnly)) {
  notices.push(`## ${item.location} ${item.version}`, '', `Declared: ${item.licenseDeclared}; reviewed: ${item.manuallyReviewedLicense ?? 'see text'}`, '');
  if (item.licenseFile) notices.push(readFileSync(item.licenseFile, 'utf8'), '');
  else notices.push('LICENSE TEXT MISSING — formal distribution requires review.', '');
}
writeFileSync('docs/legal/THIRD-PARTY-NOTICES.txt', notices.join('\n'));
const uncertain = packages.filter((item) => item.licenseDeclared === 'UNCONFIRMED');
console.log(JSON.stringify({ packages: packages.length, production: packages.filter((item) => !item.developmentOnly).length,
  declaredLicenses: [...new Set(packages.map((item) => item.licenseDeclared))].sort(),
  missingDeclarations: uncertain.map(({ location }) => location), binaryVersions: binaries.map((b) => ({ file: b.file, version: b.versionAndBuildConfiguration.split('\n')[0], sha256: b.sha256 })) }));
