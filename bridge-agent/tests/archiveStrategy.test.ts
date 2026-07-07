/**
 * archiveStrategy.test.ts — packaging command/platform-selection regression
 * test. scripts/archiveStrategy.mjs is plain JS (run pre-build by
 * scripts/package.mjs, not part of the tsc/tsx source graph), so it is
 * loaded via a dynamic import with a URL argument — tsc does not try to
 * resolve type declarations for a non-literal import() specifier.
 *
 * Run with: tsx tests/archiveStrategy.test.ts
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { test, section, summarizeAndExit } from './testHarness.js';

const archiveStrategyUrl = new URL('../scripts/archiveStrategy.mjs', import.meta.url);

interface ArchiveCommand {
  cmd: string;
  args: string[];
  cwd?: string;
}

interface ArchiveStrategyModule {
  chooseCreateStrategy(platform: string): 'powershell' | 'zip';
  buildWindowsCompressArgs(stageDir: string, zipPath: string): ArchiveCommand;
  buildPosixZipArgs(stageDir: string, zipPath: string): ArchiveCommand;
  buildPosixTarFallbackArgs(stageDir: string, zipPath: string): ArchiveCommand;
  chooseListStrategy(platform: string): 'powershell' | 'unzip';
  buildWindowsListArgs(zipPath: string): ArchiveCommand;
  buildPosixUnzipListArgs(zipPath: string): ArchiveCommand;
  buildPosixTarListArgs(zipPath: string): ArchiveCommand;
}

async function main() {
  const mod = (await import(archiveStrategyUrl.href)) as unknown as ArchiveStrategyModule;

  section('create-strategy platform selection');

  await test('win32 uses PowerShell Compress-Archive, never tar', () => {
    assert.equal(mod.chooseCreateStrategy('win32'), 'powershell');
  });

  await test('linux/darwin use zip', () => {
    assert.equal(mod.chooseCreateStrategy('linux'), 'zip');
    assert.equal(mod.chooseCreateStrategy('darwin'), 'zip');
  });

  section('Windows Compress-Archive command shape');

  await test('never passes --force-local (unsupported on this tar build)', () => {
    const { cmd, args } = mod.buildWindowsCompressArgs('C:\\stage', 'C:\\out.zip');
    assert.equal(cmd, 'powershell.exe');
    assert.ok(!args.some(a => a.includes('--force-local')));
  });

  await test('stage dir contents land at the zip root (glob, no parent folder)', () => {
    const { args } = mod.buildWindowsCompressArgs('C:\\rel\\.stage-1.0.0', 'C:\\rel\\out.zip');
    const command = args[args.length - 1] as string;
    assert.match(command, /-Path '.*\.stage-1\.0\.0\\\*'/);
    assert.match(command, /-DestinationPath '.*out\.zip'/);
  });

  await test('paths with spaces survive as a single quoted PowerShell literal', () => {
    const stageDir = path.join('E:', 'Ek Gelir', 'Siteler', 'DisKlinikCRM-git', 'bridge-agent', 'release', '.stage-0.1.0');
    const zipPath = path.join('E:', 'Ek Gelir', 'Siteler', 'DisKlinikCRM-git', 'bridge-agent', 'release', 'noramedi-bridge-agent-0.1.0.zip');
    const { args } = mod.buildWindowsCompressArgs(stageDir, zipPath);
    const command = args[args.length - 1] as string;
    assert.ok(command.includes(`'${stageDir}\\*'`));
    assert.ok(command.includes(`'${zipPath}'`));
  });

  await test('embedded single quotes are escaped for PowerShell', () => {
    const { args } = mod.buildWindowsCompressArgs("C:\\it's a stage", 'C:\\out.zip');
    const command = args[args.length - 1] as string;
    assert.ok(command.includes("it''s a stage"));
  });

  section('POSIX zip/tar command shape');

  await test('zip runs with cwd=stageDir so entries are relative, not prefixed', () => {
    const { cmd, args, cwd } = mod.buildPosixZipArgs('/tmp/.stage-1.0.0', '/tmp/out.zip');
    assert.equal(cmd, 'zip');
    assert.equal(cwd, '/tmp/.stage-1.0.0');
    assert.deepEqual(args, ['-r', '-q', '/tmp/out.zip', '.']);
  });

  await test('tar fallback never includes --force-local (POSIX has no drive-letter ambiguity)', () => {
    const { cmd, args } = mod.buildPosixTarFallbackArgs('/tmp/.stage-1.0.0', '/tmp/out.zip');
    assert.equal(cmd, 'tar');
    assert.ok(!args.includes('--force-local'));
    assert.deepEqual(args, ['-a', '-c', '-f', '/tmp/out.zip', '-C', '/tmp/.stage-1.0.0', '.']);
  });

  section('list-strategy platform selection (packaging verification step)');

  await test('win32 lists via PowerShell, POSIX via unzip/tar', () => {
    assert.equal(mod.chooseListStrategy('win32'), 'powershell');
    assert.equal(mod.chooseListStrategy('linux'), 'unzip');
  });

  await test('Windows list command never uses --force-local either', () => {
    const { cmd, args } = mod.buildWindowsListArgs('C:\\out.zip');
    assert.equal(cmd, 'powershell.exe');
    assert.ok(!args.some(a => a.includes('--force-local')));
  });

  summarizeAndExit();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
