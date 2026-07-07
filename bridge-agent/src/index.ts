#!/usr/bin/env node
/**
 * index.ts — İnce bin girişi. argv'yi ayrıştırır, servisi ya da CLI alt
 * komutlarından birini çalıştırır.
 *
 * Kullanım:
 *   agent.cjs --config <path>                     (servis, ön planda çalışır)
 *   agent.cjs --config <path> --status
 *   agent.cjs --config <path> --retry-failed <ingestKey|all>
 *   agent.cjs --config <path> --validate-config
 */
import { BridgeService } from './service.js';
import { runValidateConfig, runStatus, runRetryFailed } from './cli.js';

function parseArgs(argv: string[]): { config?: string; status: boolean; retryFailed?: string; validateConfig: boolean } {
  const result: ReturnType<typeof parseArgs> = { status: false, validateConfig: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--config') result.config = argv[++i];
    else if (arg === '--status') result.status = true;
    else if (arg === '--retry-failed') result.retryFailed = argv[++i];
    else if (arg === '--validate-config') result.validateConfig = true;
  }
  return result;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.config) {
    console.error('Usage: agent.cjs --config <path/to/config.json> [--status | --retry-failed <ingestKey|all> | --validate-config]');
    process.exit(1);
  }

  if (args.validateConfig) {
    runValidateConfig(args.config);
    return;
  }
  if (args.status) {
    runStatus(args.config);
    return;
  }
  if (args.retryFailed) {
    runRetryFailed(args.config, args.retryFailed);
    return;
  }

  const service = new BridgeService(args.config);
  service.start();
}

main();
