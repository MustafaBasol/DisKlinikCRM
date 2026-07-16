/**
 * useClinicBulkExportStatus.ts — KVKK-HIGH-004 bounded-backoff status
 * polling for a clinic bulk export job.
 *
 * Deliberately NOT built on src/components/imaging/pairingPoller.ts — that
 * poller is a fixed-interval, no-backoff primitive scoped to the imaging
 * bridge pairing domain. Reusing it here would couple the privacy/export
 * feature to an unrelated domain module for no benefit. This hook is
 * self-contained and owns its own backoff schedule.
 *
 * Backoff: 2s -> 4s -> 8s -> capped at 15s. Gives up (marks `timedOut`)
 * after MAX_POLL_DURATION_MS total. Stops immediately once the job reaches
 * a terminal status (ready | failed | expired) or on unmount.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { clinicBulkExportService } from '../services/api';
import { getErrorMessage } from '../utils/errors';

export type ClinicBulkExportStatus = 'queued' | 'generating' | 'ready' | 'failed' | 'expired';

export interface ClinicBulkExportJobState {
  jobId: string;
  status: ClinicBulkExportStatus;
  purpose: string;
  createdAt: string;
  expiresAt: string | null;
  downloadedAt: string | null;
  failureCode: string | null;
}

const BACKOFF_SCHEDULE_MS = [2000, 4000, 8000, 15000];
const MAX_POLL_DURATION_MS = 30 * 60 * 1000; // 30 minutes

const TERMINAL_STATUSES: ClinicBulkExportStatus[] = ['ready', 'failed', 'expired'];

export function useClinicBulkExportStatus(clinicId: string | null, jobId: string | null) {
  const [job, setJob] = useState<ClinicBulkExportJobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  const aliveRef = useRef(true);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    stop();
    setJob(null);
    setError(null);
    setTimedOut(false);
    attemptRef.current = 0;
    startedAtRef.current = null;

    if (!clinicId || !jobId) return;

    startedAtRef.current = Date.now();

    const poll = async () => {
      if (!aliveRef.current) return;
      try {
        const response = await clinicBulkExportService.getStatus(clinicId, jobId);
        if (!aliveRef.current) return;
        const data = response.data as ClinicBulkExportJobState;
        setJob(data);
        setError(null);

        if (TERMINAL_STATUSES.includes(data.status)) {
          stop();
          return;
        }
      } catch (err) {
        if (!aliveRef.current) return;
        setError(getErrorMessage(err));
      }

      if (!aliveRef.current) return;
      const elapsed = Date.now() - (startedAtRef.current ?? Date.now());
      if (elapsed >= MAX_POLL_DURATION_MS) {
        setTimedOut(true);
        stop();
        return;
      }

      const delay = BACKOFF_SCHEDULE_MS[Math.min(attemptRef.current, BACKOFF_SCHEDULE_MS.length - 1)];
      attemptRef.current += 1;
      timerRef.current = setTimeout(poll, delay);
    };

    void poll();

    return () => {
      aliveRef.current = false;
      stop();
    };
  }, [clinicId, jobId, stop]);

  return { job, error, timedOut };
}
