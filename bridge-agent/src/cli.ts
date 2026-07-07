/**
 * cli.ts — `--status`, `--retry-failed <ingestKey|all>`, `--validate-config`
 * alt komutları. Servis dışı, kısa ömürlü çalıştırmalar.
 */
import fs from 'node:fs';
import { loadConfig } from './config.js';
import { Logger } from './logger.js';
import { BridgeQueue } from './queue.js';
import { StatusWriter } from './status.js';

export function runValidateConfig(configPath: string): void {
  const config = loadConfig(configPath);
  console.log(`OK — ${config.watches.length} watch(es), serverUrl=${config.serverUrl}`);
  for (const w of config.watches) {
    console.log(`  watchId=${w.watchId} deviceId=${w.deviceId} modality=${w.modality ?? '(default)'}`);
  }
}

export function runStatus(configPath: string): void {
  const config = loadConfig(configPath);
  const writer = new StatusWriter(config.statusDir);
  const status = writer.read();
  if (!status) {
    console.log('No status recorded yet (agent may not have started).');
    return;
  }
  console.log(JSON.stringify(status, null, 2));
}

export function runRetryFailed(configPath: string, target: string): void {
  const config = loadConfig(configPath);
  const logger = new Logger(config.logDir);
  const queue = new BridgeQueue(config.queueDir, logger);
  const failedDir = `${config.queueDir}/failed`;
  const targets = target === 'all' ? fs.existsSync(failedDir) ? fs.readdirSync(failedDir) : [] : [target];

  const validDeviceIds = new Set(config.watches.map(w => w.deviceId));

  for (const ingestKey of targets) {
    try {
      const item = queue.requeueFailed(ingestKey);
      if (!validDeviceIds.has(item.meta.deviceId)) {
        console.warn(`Warning: ${ingestKey} references deviceId "${item.meta.deviceId}" no longer present in config.watches — requeued anyway, will 404 until config is fixed.`);
      }
      console.log(`Requeued ${ingestKey}`);
    } catch (err) {
      console.error(`Failed to requeue ${ingestKey}: ${(err as Error).message}`);
    }
  }
  logger.close();
}
