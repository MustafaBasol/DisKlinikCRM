/**
 * package.mjs — dist/agent.cjs + scripts + example config + docs'u release
 * zip'ine paketler. Gerçek token/klinik config asla dahil edilmez.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

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

// Node 20+'ta built-in zip yok; platformdaki 'tar' (bsdtar/zip destekli, Windows 10+'ta hazır) kullanılır.
// --force-local: Windows bsdtar, "E:\..." gibi sürücü harfli yolları host:path
// uzak-arşiv sözdizimi sanabiliyor (":" karakteri yüzünden) — bu bayrak yolu
// her zaman yerel dosya sistemi olarak ele almasını zorunlu kılar.
try {
  execFileSync('tar', ['--force-local', '-a', '-c', '-f', zipPath, '-C', stageDir, '.'], { stdio: 'inherit' });
} catch (err) {
  console.error('Zip oluşturulamadı ("tar" bulunamadı olabilir). Stage klasörü elle sıkıştırılabilir:', stageDir);
  throw err;
}

fs.rmSync(stageDir, { recursive: true, force: true });
console.log(`Packaged: ${zipPath}`);
