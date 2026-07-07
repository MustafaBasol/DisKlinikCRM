/**
 * archiveStrategy.mjs — pure, platform-based command selection for
 * scripts/package.mjs. Kept dependency-free and side-effect-free (no
 * execFileSync calls here) so it can be exercised by a plain unit test
 * without touching the filesystem or spawning processes.
 *
 * Windows' built-in tar (bsdtar) misparses a drive-letter path like
 * "E:\foo\bar.zip" passed to "-f" as a remote "host:path" spec unless
 * --force-local is given — and Windows' tar build in this environment
 * does not support --force-local at all. So archive *creation* on
 * Windows uses PowerShell's Compress-Archive instead of tar entirely.
 */

/** @param {NodeJS.Platform} platform */
export function chooseCreateStrategy(platform) {
  return platform === 'win32' ? 'powershell' : 'zip';
}

function escapeForPowerShellSingleQuoted(value) {
  return value.replace(/'/g, "''");
}

/** Compress-Archive with a "<stageDir>\*" glob puts stage dir contents at
 * the zip root — no extra parent folder in the archive. */
export function buildWindowsCompressArgs(stageDir, zipPath) {
  const escapedStage = escapeForPowerShellSingleQuoted(stageDir);
  const escapedZip = escapeForPowerShellSingleQuoted(zipPath);
  return {
    cmd: 'powershell.exe',
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -Path '${escapedStage}\\*' -DestinationPath '${escapedZip}' -Force`,
    ],
  };
}

/** `zip -r` run with cwd=stageDir so entries are relative to the stage
 * dir, not prefixed with the stage dir's own name. */
export function buildPosixZipArgs(stageDir, zipPath) {
  return { cmd: 'zip', args: ['-r', '-q', zipPath, '.'], cwd: stageDir };
}

/** Fallback for POSIX systems without `zip` installed. No drive-letter
 * ambiguity exists on POSIX, so --force-local is neither needed nor used. */
export function buildPosixTarFallbackArgs(stageDir, zipPath) {
  return { cmd: 'tar', args: ['-a', '-c', '-f', zipPath, '-C', stageDir, '.'] };
}

/** @param {NodeJS.Platform} platform */
export function chooseListStrategy(platform) {
  return platform === 'win32' ? 'powershell' : 'unzip';
}

export function buildWindowsListArgs(zipPath) {
  const escapedZip = escapeForPowerShellSingleQuoted(zipPath);
  return {
    cmd: 'powershell.exe',
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
        `$zip = [System.IO.Compression.ZipFile]::OpenRead('${escapedZip}'); ` +
        `$zip.Entries | ForEach-Object { $_.FullName }; $zip.Dispose()`,
    ],
  };
}

export function buildPosixUnzipListArgs(zipPath) {
  return { cmd: 'unzip', args: ['-Z1', zipPath] };
}

/** Fallback for POSIX systems without `unzip` installed. */
export function buildPosixTarListArgs(zipPath) {
  return { cmd: 'tar', args: ['-tf', zipPath] };
}
