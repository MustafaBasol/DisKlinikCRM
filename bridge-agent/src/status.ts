/**
 * status.ts — status/status.json atomik yazımı. Yalnızca watchId taşır,
 * gerçek klasör yolu/dosya adı/token/DICOM etiketi ASLA içermez.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface WatchStatus {
  watchId: string;
  available: boolean;
  lastEventCategory?: string;
}

export interface AgentStatus {
  agentVersion: string;
  startedAt: string;
  connectionState: 'online' | 'offline';
  authState: 'valid' | 'invalid';
  lastHeartbeatAt?: string;
  pendingCount: number;
  failedCount: number;
  watchedFolders: WatchStatus[];
  lastErrorCategory?: string;
}

export class StatusWriter {
  constructor(private readonly statusDir: string) {
    fs.mkdirSync(statusDir, { recursive: true });
  }

  write(status: AgentStatus): void {
    const finalPath = path.join(this.statusDir, 'status.json');
    const tmpPath = `${finalPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(status, null, 2));
    fs.renameSync(tmpPath, finalPath);
  }

  read(): AgentStatus | null {
    const finalPath = path.join(this.statusDir, 'status.json');
    if (!fs.existsSync(finalPath)) return null;
    return JSON.parse(fs.readFileSync(finalPath, 'utf8')) as AgentStatus;
  }
}
