/**
 * noShowFollowUp.ts — shared "unresolved no-show" query.
 *
 * Both the main dashboard's "Aranacak Randevular" card (GET /dashboard/stats)
 * and the No-show Takibi page's default view (GET /no-shows/dashboard, reached
 * via /no-shows?recoveryStatus=unresolved) must report the same count. They
 * previously diverged: the dashboard counted all no-shows in the current
 * calendar month regardless of recovery status, while the no-show page
 * defaulted to the last 30 days and only unresolved ones. This module is the
 * single source of truth for that definition so the two can't drift again.
 */
import prisma from '../db.js';

export const NO_SHOW_FOLLOW_UP_WINDOW_DAYS = 30;

export function noShowFollowUpDateRange(now: Date = new Date()): { gte: Date; lte: Date } {
  const start = new Date(now);
  start.setDate(start.getDate() - NO_SHOW_FOLLOW_UP_WINDOW_DAYS);
  start.setHours(0, 0, 0, 0);
  return { gte: start, lte: now };
}

export function buildNoShowFollowUpWhere(
  clinicIdWhere: Record<string, any>,
  practitionerId?: string,
  now: Date = new Date(),
): Record<string, any> {
  return {
    ...clinicIdWhere,
    status: 'no_show',
    recoveryStatus: 'unresolved',
    startTime: noShowFollowUpDateRange(now),
    ...(practitionerId ? { practitionerId } : {}),
  };
}

export function countUnresolvedNoShows(
  clinicIdWhere: Record<string, any>,
  practitionerId?: string,
): Promise<number> {
  return prisma.appointment.count({ where: buildNoShowFollowUpWhere(clinicIdWhere, practitionerId) });
}
