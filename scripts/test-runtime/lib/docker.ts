/**
 * Thin Docker CLI wrapper. Every invocation uses an argv array (never a shell
 * string), so no shell-quoting/injection surface exists regardless of what a
 * generated name/secret/label value contains.
 */
import { spawn, spawnSync } from 'node:child_process';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runDockerSync(args: string[]): CommandResult {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.error) {
    return { code: 1, stdout: '', stderr: String(result.error.message ?? result.error) };
  }
  return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export function dockerAvailable(): { available: boolean; detail: string } {
  const version = runDockerSync(['version', '--format', '{{.Server.Version}}']);
  if (version.code !== 0) {
    return { available: false, detail: version.stderr.trim() || version.stdout.trim() || 'docker CLI not reachable' };
  }
  return { available: true, detail: version.stdout.trim() };
}

/** Pure — parses `docker inspect --format '{{json .NetworkSettings.Ports}}'` output. */
export function parsePortBindings(portsJson: string, containerPort: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(portsJson);
  } catch {
    throw new Error(`Could not parse Docker port-bindings JSON: ${portsJson}`);
  }
  const bindings = (parsed as Record<string, Array<{ HostIp?: string; HostPort?: string }>> | null)?.[
    `${containerPort}/tcp`
  ];
  if (!Array.isArray(bindings) || bindings.length === 0 || !bindings[0]?.HostPort) {
    throw new Error(`No host port binding found for container port ${containerPort}/tcp`);
  }
  const port = Number.parseInt(bindings[0].HostPort, 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid host port value "${bindings[0].HostPort}" for ${containerPort}/tcp`);
  }
  return port;
}

/** Queries the actual Docker-assigned host port after container startup (never pre-scanned). */
export function getHostPort(containerName: string, containerPort: string): number {
  const result = runDockerSync(['inspect', '--format', '{{json .NetworkSettings.Ports}}', containerName]);
  if (result.code !== 0) {
    throw new Error(`docker inspect failed for ${containerName}: ${result.stderr.trim()}`);
  }
  return parsePortBindings(result.stdout.trim(), containerPort);
}

/**
 * Pure — parses `docker inspect --format '{{json .NetworkSettings.Networks}}'`
 * output and returns the container's own IPv4 address *on the named network*,
 * or null when the container is not attached to it / has no address there.
 *
 * F4-CI-L4-STORAGE-GATE-001: this is the address that makes the disposable
 * MinIO destination a genuinely non-loopback network identity (its own
 * container network namespace, not this host's loopback interface) — see
 * lib/minio.ts and the Lane C rationale in
 * docs/program/evidence/F4-CI-L4-STORAGE-GATE-001_LAYER4_STORAGE_GATE.md.
 * Returning null (rather than throwing) is deliberate: a platform where the
 * container network is not routable from the host must fall back to the
 * published loopback port, not fail the run.
 */
export function parseContainerNetworkAddress(networksJson: string, networkName: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(networksJson);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const entry = (parsed as Record<string, { IPAddress?: unknown } | null>)[networkName];
  const address = entry?.IPAddress;
  if (typeof address !== 'string' || address.trim().length === 0) return null;
  return address.trim();
}

/** Queries this container's own IPv4 address on the given user-defined network. */
export function getContainerNetworkAddress(containerName: string, networkName: string): string | null {
  const result = runDockerSync(['inspect', '--format', '{{json .NetworkSettings.Networks}}', containerName]);
  if (result.code !== 0) return null;
  return parseContainerNetworkAddress(result.stdout.trim(), networkName);
}

export function dockerRun(args: string[]): string {
  const result = runDockerSync(['run', '-d', ...args]);
  if (result.code !== 0) {
    throw new Error(`docker run failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result.stdout.trim();
}

export function dockerRemoveContainer(name: string): CommandResult {
  return runDockerSync(['rm', '-f', name]);
}

export function dockerCreateNetwork(name: string, labels: string[]): CommandResult {
  return runDockerSync(['network', 'create', ...labels, name]);
}

export function dockerRemoveNetwork(name: string): CommandResult {
  return runDockerSync(['network', 'rm', name]);
}

export function dockerExec(container: string, cmd: string[]): CommandResult {
  return runDockerSync(['exec', container, ...cmd]);
}

export interface InspectedResource {
  id: string;
  name: string;
  labels: Record<string, string>;
}

export function listLabeledContainers(labelFilterArgs: string[]): InspectedResource[] {
  const ids = runDockerSync(['ps', '-aq', ...labelFilterArgs]);
  if (ids.code !== 0) throw new Error(`docker ps failed: ${ids.stderr.trim()}`);
  const idList = ids.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  if (idList.length === 0) return [];
  const inspect = runDockerSync(['inspect', ...idList]);
  if (inspect.code !== 0) throw new Error(`docker inspect failed: ${inspect.stderr.trim()}`);
  const parsed = JSON.parse(inspect.stdout) as Array<{ Id: string; Name?: string; Config?: { Labels?: Record<string, string> } }>;
  return parsed.map((c) => ({ id: c.Id, name: (c.Name ?? '').replace(/^\//, ''), labels: c.Config?.Labels ?? {} }));
}

export function listLabeledNetworks(labelFilterArgs: string[]): InspectedResource[] {
  const ids = runDockerSync(['network', 'ls', '-q', ...labelFilterArgs]);
  if (ids.code !== 0) throw new Error(`docker network ls failed: ${ids.stderr.trim()}`);
  const idList = ids.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  if (idList.length === 0) return [];
  const inspect = runDockerSync(['network', 'inspect', ...idList]);
  if (inspect.code !== 0) throw new Error(`docker network inspect failed: ${inspect.stderr.trim()}`);
  const parsed = JSON.parse(inspect.stdout) as Array<{ Id: string; Name?: string; Labels?: Record<string, string> }>;
  return parsed.map((n) => ({ id: n.Id, name: n.Name ?? '', labels: n.Labels ?? {} }));
}

/**
 * Async spawn used for long-running commands so signal handlers keep firing.
 * `shell` defaults to false (argv array, no shell-quoting surface). Windows
 * `.cmd` shims (npm.cmd/npx.cmd) cannot be spawned directly without a shell —
 * callers invoking those set `shell: true` explicitly; every arg passed
 * through it here is a fixed, internally-generated literal (script/profile
 * names), never externally-supplied text, so this carries no injection risk.
 */
export function spawnAsync(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; shell?: boolean } = {},
): Promise<{ code: number }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: 'inherit', shell: opts.shell ?? false });
    child.on('exit', (code) => resolve({ code: code ?? 1 }));
    child.on('error', () => resolve({ code: 1 }));
  });
}
