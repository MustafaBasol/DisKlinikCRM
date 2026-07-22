/**
 * Post-treatment message template CRUD and queue management routes.
 *
 * GET    /api/post-treatment-templates              — list templates for clinic
 * POST   /api/post-treatment-templates              — create template
 * PUT    /api/post-treatment-templates/:id          — update template
 * DELETE /api/post-treatment-templates/:id          — delete template
 * GET    /api/post-treatment-queue                  — list queue entries
 * POST   /api/post-treatment-queue/:id/approve      — staff approval → send now
 * POST   /api/post-treatment-queue/:id/cancel       — cancel pending entry
 */

import express, { Response } from 'express';
import { z } from 'zod';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { getParam } from '../utils/helpers.js';
import { resolveEffectiveClinicId, validateAndGetScope } from '../utils/clinicScope.js';

const router = express.Router();

// ── Validation schemas ───────────────────────────────────────────────────────

const createTemplateSchema = z.object({
  title: z.string().min(1).max(200),
  targetType: z.enum(['service', 'package']),
  serviceId: z.string().optional().nullable(),
  treatmentPackageId: z.string().optional().nullable(),
  messageBody: z.string().min(1).max(2000),
  channel: z.enum(['whatsapp', 'instagram', 'preferred']),
  sendDelayMinutes: z.number().int().min(0).max(20160).default(0), // max 2 weeks
  requireStaffApproval: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

const updateTemplateSchema = createTemplateSchema.partial();

// ── GET /api/post-treatment-templates ───────────────────────────────────────

router.get(
  '/post-treatment-templates',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']),
  async (req: AuthRequest, res: Response) => {
    const selectedClinicId = typeof req.query.clinicId === 'string' ? req.query.clinicId : undefined;
    const scope = await validateAndGetScope(req.user!, selectedClinicId, res);
    if (scope === false) return;

    try {
      const templates = await prisma.postTreatmentMessageTemplate.findMany({
        where: scope,
        include: {
          service: { select: { id: true, name: true } },
          treatmentPackage: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      return res.json(templates);
    } catch {
      return res.status(500).json({ error: 'Failed to fetch post-treatment templates' });
    }
  },
);

// ── POST /api/post-treatment-templates ──────────────────────────────────────

router.post(
  '/post-treatment-templates',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    const organizationId = req.user!.organizationId as string;
    const requestedClinicId = typeof req.body?.clinicId === 'string' ? req.body.clinicId : undefined;
    const clinicId = await resolveEffectiveClinicId(req.user!, requestedClinicId);
    if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

    const parsed = createTemplateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { targetType, serviceId, treatmentPackageId } = parsed.data;

    if (targetType === 'service' && serviceId) {
      const svc = await prisma.appointmentType.findFirst({ where: { id: serviceId, clinicId } });
      if (!svc) return res.status(400).json({ error: 'Invalid serviceId' });
    }
    if (targetType === 'package' && treatmentPackageId) {
      const pkg = await prisma.treatmentPackage.findFirst({ where: { id: treatmentPackageId, clinicId } });
      if (!pkg) return res.status(400).json({ error: 'Invalid treatmentPackageId' });
    }

    try {
      const template = await prisma.postTreatmentMessageTemplate.create({
        data: {
          organizationId,
          clinicId,
          title: parsed.data.title,
          targetType,
          serviceId: serviceId ?? null,
          treatmentPackageId: treatmentPackageId ?? null,
          messageBody: parsed.data.messageBody,
          channel: parsed.data.channel,
          sendDelayMinutes: parsed.data.sendDelayMinutes,
          requireStaffApproval: parsed.data.requireStaffApproval,
          isActive: parsed.data.isActive,
        },
        include: {
          service: { select: { id: true, name: true } },
          treatmentPackage: { select: { id: true, name: true } },
        },
      });
      return res.status(201).json(template);
    } catch {
      return res.status(500).json({ error: 'Failed to create post-treatment template' });
    }
  },
);

// ── PUT /api/post-treatment-templates/:id ───────────────────────────────────

router.put(
  '/post-treatment-templates/:id',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    const id = getParam(req, 'id');
    const scope = await validateAndGetScope(req.user!, undefined, res);
    if (scope === false) return;

    const parsed = updateTemplateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const existing = await prisma.postTreatmentMessageTemplate.findFirst({ where: { id, ...scope } });
    if (!existing) return res.status(404).json({ error: 'Template not found' });

    const clinicId = existing.clinicId;
    const { targetType, serviceId, treatmentPackageId } = parsed.data;
    if (targetType === 'service' && serviceId) {
      const svc = await prisma.appointmentType.findFirst({ where: { id: serviceId, clinicId } });
      if (!svc) return res.status(400).json({ error: 'Invalid serviceId' });
    }
    if (targetType === 'package' && treatmentPackageId) {
      const pkg = await prisma.treatmentPackage.findFirst({ where: { id: treatmentPackageId, clinicId } });
      if (!pkg) return res.status(400).json({ error: 'Invalid treatmentPackageId' });
    }

    try {
      const updated = await prisma.postTreatmentMessageTemplate.update({
        where: { id },
        data: {
          ...(parsed.data.title !== undefined && { title: parsed.data.title }),
          ...(parsed.data.targetType !== undefined && { targetType: parsed.data.targetType }),
          ...(serviceId !== undefined && { serviceId: serviceId ?? null }),
          ...(treatmentPackageId !== undefined && { treatmentPackageId: treatmentPackageId ?? null }),
          ...(parsed.data.messageBody !== undefined && { messageBody: parsed.data.messageBody }),
          ...(parsed.data.channel !== undefined && { channel: parsed.data.channel }),
          ...(parsed.data.sendDelayMinutes !== undefined && { sendDelayMinutes: parsed.data.sendDelayMinutes }),
          ...(parsed.data.requireStaffApproval !== undefined && { requireStaffApproval: parsed.data.requireStaffApproval }),
          ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
        },
        include: {
          service: { select: { id: true, name: true } },
          treatmentPackage: { select: { id: true, name: true } },
        },
      });
      return res.json(updated);
    } catch {
      return res.status(500).json({ error: 'Failed to update post-treatment template' });
    }
  },
);

// ── DELETE /api/post-treatment-templates/:id ────────────────────────────────

router.delete(
  '/post-treatment-templates/:id',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    const id = getParam(req, 'id');
    const scope = await validateAndGetScope(req.user!, undefined, res);
    if (scope === false) return;

    const existing = await prisma.postTreatmentMessageTemplate.findFirst({ where: { id, ...scope } });
    if (!existing) return res.status(404).json({ error: 'Template not found' });

    try {
      await prisma.postTreatmentMessageTemplate.delete({ where: { id } });
      return res.json({ success: true });
    } catch {
      return res.status(500).json({ error: 'Failed to delete post-treatment template' });
    }
  },
);

// ── GET /api/post-treatment-queue ───────────────────────────────────────────

router.get(
  '/post-treatment-queue',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']),
  async (req: AuthRequest, res: Response) => {
    const { patientId, status, limit, clinicId: selectedClinicId } = req.query;
    const scope = await validateAndGetScope(req.user!, selectedClinicId as string | undefined, res);
    if (scope === false) return;

    try {
      const entries = await prisma.postTreatmentMessageQueue.findMany({
        where: {
          ...scope,
          ...(patientId ? { patientId: String(patientId) } : {}),
          ...(status ? { status: String(status) } : {}),
        },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true } },
          template: { select: { id: true, title: true, channel: true } },
        },
        orderBy: { scheduledAt: 'desc' },
        take: limit ? Math.min(Number(String(limit)), 200) : 100,
      });
      return res.json(entries);
    } catch {
      return res.status(500).json({ error: 'Failed to fetch post-treatment queue' });
    }
  },
);

// ── POST /api/post-treatment-queue/:id/approve ──────────────────────────────

router.post(
  '/post-treatment-queue/:id/approve',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']),
  async (req: AuthRequest, res: Response) => {
    const id = getParam(req, 'id');
    const scope = await validateAndGetScope(req.user!, undefined, res);
    if (scope === false) return;

    try {
      const entry = await prisma.postTreatmentMessageQueue.findFirst({
        where: { id, ...scope },
        select: { id: true, clinicId: true },
      });
      if (!entry) return res.status(404).json({ error: 'Queue entry not found' });

      const { approveAndSendQueueEntry } = await import('../services/postTreatmentMessaging.js');
      await approveAndSendQueueEntry(id, entry.clinicId);
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(400).json({ error: err?.message ?? 'Failed to approve post-treatment message' });
    }
  },
);

// ── POST /api/post-treatment-queue/:id/cancel ───────────────────────────────

router.post(
  '/post-treatment-queue/:id/cancel',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']),
  async (req: AuthRequest, res: Response) => {
    const id = getParam(req, 'id');
    const scope = await validateAndGetScope(req.user!, undefined, res);
    if (scope === false) return;

    const existing = await prisma.postTreatmentMessageQueue.findFirst({
      where: { id, ...scope, status: { in: ['pending', 'waiting_approval'] } },
    });
    if (!existing) return res.status(404).json({ error: 'Queue entry not found or already processed' });

    try {
      await prisma.postTreatmentMessageQueue.update({
        where: { id },
        data: { status: 'cancelled' },
      });
      return res.json({ success: true });
    } catch {
      return res.status(500).json({ error: 'Failed to cancel post-treatment message' });
    }
  },
);

export default router;
