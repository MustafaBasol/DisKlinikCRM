/**
 * package.mjs — dist/agent.cjs + scripts + example config + docs'u release
 * zip'ine paketler. Gerçek token/klinik config asla dahil edilmez.
 *
 * Cross-platform: Windows'ta PowerShell Compress-Archive, POSIX'te zip
 * (yoksa tar) kullanılır — bkz. archiveStrategy.mjs (platform seçimi orada
 * saf/test edilebilir fonksiyonlar olarak izole edilmiştir).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  chooseCreateStrategy,
  buildWindowsCompressArgs,
  buildPosixZipArgs,
  buildPosixTarFallbackArgs,
  chooseListStrategy,
  buildWindowsListArgs,
  buildPosixUnzipListArgs,
  buildPosixTarListArgs,
} from './archiveStrategy.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;

if (!fs.existsSync(path.join(root, 'dist/agent.cjs'))) {
  console.error('dist/agent.cjs not found — run "npm run build" first.');
  process.exit(1);
}

const releaseDir = path.join(root, 'release');
fs.mkdirSync(releaseDir, { recursive: true });

const stageDir = path.join(releaseDir, `.stage-${version}`);
fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });

fs.mkdirSync(path.join(stageDir, 'dist'));
fs.copyFileSync(path.join(root, 'dist/agent.cjs'), path.join(stageDir, 'dist/agent.cjs'));
if (fs.existsSync(path.join(root, 'dist/agent.cjs.map'))) {
  fs.copyFileSync(path.join(root, 'dist/agent.cjs.map'), path.join(stageDir, 'dist/agent.cjs.map'));
}

fs.mkdirSync(path.join(stageDir, 'scripts'));
for (const file of fs.readdirSync(path.join(root, 'scripts'))) {
  if (file.endsWith('.ps1')) {
    fs.copyFileSync(path.join(root, 'scripts', file), path.join(stageDir, 'scripts', file));
  }
}

fs.mkdirSync(path.join(stageDir, 'config'));
fs.copyFileSync(path.join(root, 'config/config.example.json'), path.join(stageDir, 'config/config.example.json'));

fs.copyFileSync(path.join(root, 'README.md'), path.join(stageDir, 'README.md'));

fs.writeFileSync(
  path.join(stageDir, 'RELEASE.json'),
  JSON.stringify(
    {
      agentVersion: version,
      requiredNodeRuntime: '>=20.0.0',
      standalone: false,
      note: 'Requires Node.js 20+ already installed on the target Windows PC. This is not a standalone executable.',
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
);

const zipPath = path.join(releaseDir, `noramedi-bridge-agent-${version}.zip`);
fs.rmSync(zipPath, { force: true });

function createZip() {
  const strategy = chooseCreateStrategy(process.platform);
  if (strategy === 'powershell') {
    const { cmd, args } = buildWindowsCompressArgs(stageDir, zipPath);
    execFileSync(cmd, args, { stdio: 'inherit' });
    return;
  }
  try {
    const { cmd, args, cwd } = buildPosixZipArgs(stageDir, zipPath);
    execFileSync(cmd, args, { stdio: 'inherit', cwd });
  } catch {
    console.warn('"zip" not available or failed — falling back to tar.');
    const { cmd, args } = buildPosixTarFallbackArgs(stageDir, zipPath);
    execFileSync(cmd, args, { stdio: 'inherit' });
  }
}

try {
  createZip();
} catch (err) {
  console.error(
    'Zip oluşturulamadı. Stage klasörü incelenebilmesi için silinmedi:',
    stageDir,
  );
  throw err;
}

const REQUIRED_ZIP_ENTRIES = [
  'dist/agent.cjs',
  'config/config.example.json',
  'README.md',
  'RELEASE.json',
];

function listZipEntries() {
  const strategy = chooseListStrategy(process.platform);
  if (strategy === 'powershell') {
    const { cmd, args } = buildWindowsListArgs(zipPath);
    return execFileSync(cmd, args, { encoding: 'utf8' });
  }
  try {
    const { cmd, args } = buildPosixUnzipListArgs(zipPath);
    return execFileSync(cmd, args, { encoding: 'utf8' });
  } catch {
    const { cmd, args } = buildPosixTarListArgs(zipPath);
    return execFileSync(cmd, args, { encoding: 'utf8' });
  }
}

function verifyZipContents() {
  const listing = listZipEntries()
    .split(/\r?\n/)
    .map(line => line.trim().replace(/\\/g, '/'))
    .filter(Boolean);

  const missing = [];
  for (const required of REQUIRED_ZIP_ENTRIES) {
    if (!listing.some(entry => entry.endsWith(required))) missing.push(required);
  }
  if (!listing.some(entry => /scripts\/.*\.ps1$/.test(entry))) {
    missing.push('scripts/*.ps1');
  }
  if (missing.length > 0) {
    console.error('Zip içeriği doğrulaması başarısız — eksik girdiler:', missing);
    console.error('Stage klasörü incelenebilmesi için silinmedi:', stageDir);
    process.exit(1);
  }
  console.log('Zip content verified: all required entries present.');
}

try {
  verifyZipContents();
} catch (err) {
  console.error(
    'Zip içeriği doğrulanamadı. Stage klasörü incelenebilmesi için silinmedi:',
    stageDir,
  );
  throw err;
}

fs.rmSync(stageDir, { recursive: true, force: true });
console.log(`Packaged: ${zipPath}`);
