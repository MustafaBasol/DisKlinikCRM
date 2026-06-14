import express, { Response } from 'express';
import { z } from 'zod';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { getParam } from '../utils/helpers.js';

const router = express.Router();

const CONTACT_REQUEST_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST'] as const;

const OPEN_STATUSES = ['pending', 'in_progress'] as const;

const contactRequestStatusSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'resolved', 'closed']),
});

// ── Deduplication helper ──────────────────────────────────────────────────────

export async function upsertContactRequest(args: {
  clinicId: string;
  channel: string;
  externalSenderId: string;
  patientId?: string | null;
  phone?: string | null;
  name?: string | null;
  type: string;
  note?: string | null;
  lastMessage?: string | null;
  sourceConversationId?: string | null;
  sourceMessageId?: string | null;
}) {
  const existing = await prisma.contactRequest.findFirst({
    where: {
      clinicId: args.clinicId,
      channel: args.channel,
      externalSenderId: args.externalSenderId,
      status: { in: [...OPEN_STATUSES] },
    },
    orderBy: { createdAt: 'desc' },
  });

  const sanitizedNote = args.note ? args.note.slice(0, 2000) : undefined;
  const sanitizedLastMessage = args.lastMessage ? args.lastMessage.slice(0, 500) : undefined;

  if (existing) {
    return prisma.contactRequest.update({
      where: { id: existing.id },
      data: {
        ...(sanitizedNote ? { note: sanitizedNote } : {}),
        ...(sanitizedLastMessage ? { lastMessage: sanitizedLastMessage } : {}),
        updatedAt: new Date(),
      },
    });
  }

  return prisma.contactRequest.create({
    data: {
      clinicId: args.clinicId,
      patientId: args.patientId ?? null,
      channel: args.channel,
      externalSenderId: args.externalSenderId,
      phone: args.phone ?? null,
      name: args.name ?? null,
      type: args.type,
      status: 'pending',
      priority: 'normal',
      note: sanitizedNote ?? null,
      lastMessage: sanitizedLastMessage ?? null,
      sourceConversationId: args.sourceConversationId ?? null,
      sourceMessageId: args.sourceMessageId ?? null,
    },
  });
}

// ── GET /api/contact-requests ─────────────────────────────────────────────────

router.get('/contact-requests', authorize([...CONTACT_REQUEST_ROLES]), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { status, channel, type, search, page, limit } = req.query;

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(limit) || 50));
  const skip = (pageNum - 1) * limitNum;

  try {
    const where = {
      clinicId,
      ...(status ? { status: String(status) } : {}),
      ...(channel ? { channel: String(channel) } : {}),
      ...(type ? { type: String(type) } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: String(search), mode: 'insensitive' as const } },
              { phone: { contains: String(search), mode: 'insensitive' as const } },
              { note: { contains: String(search), mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.contactRequest.findMany({
        where,
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
          resolvedBy: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: [
          { status: 'asc' },
          { createdAt: 'desc' },
        ],
        skip,
        take: limitNum,
      }),
      prisma.contactRequest.count({ where }),
    ]);

    res.json({ items, total, page: pageNum, limit: limitNum });
  } catch (err) {
    console.error('[contact-requests] list error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/contact-requests/counts ─────────────────────────────────────────

router.get('/contact-requests/counts', authorize([...CONTACT_REQUEST_ROLES]), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  try {
    const unresolved = await prisma.contactRequest.count({
      where: { clinicId, status: { in: [...OPEN_STATUSES] } },
    });
    res.json({ unresolved });
  } catch (err) {
    console.error('[contact-requests] counts error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/contact-requests/:id ────────────────────────────────────────────

router.get('/contact-requests/:id', authorize([...CONTACT_REQUEST_ROLES]), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const id = getParam(req, 'id');
  try {
    const item = await prisma.contactRequest.findFirst({
      where: { id, clinicId },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        resolvedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  } catch (err) {
    console.error('[contact-requests] get error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/contact-requests/:id/status ───────────────────────────────────

router.patch('/contact-requests/:id/status', authorize([...CONTACT_REQUEST_ROLES]), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const id = getParam(req, 'id');
  const validation = contactRequestStatusSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  const { status } = validation.data;

  try {
    const existing = await prisma.contactRequest.findFirst({ where: { id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const resolvedFields =
      status === 'resolved'
        ? { resolvedAt: new Date(), resolvedById: req.user!.id }
        : status === 'pending' || status === 'in_progress'
          ? { resolvedAt: null, resolvedById: null }
          : {};

    const updated = await prisma.contactRequest.update({
      where: { id },
      data: { status, ...resolvedFields },
    });

    res.json(updated);
  } catch (err) {
    console.error('[contact-requests] status patch error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/contact-requests/:id/assign ───────────────────────────────────

router.patch('/contact-requests/:id/assign', authorize([...CONTACT_REQUEST_ROLES]), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const id = getParam(req, 'id');
  const assignedToId = req.body?.assignedToId ?? null;

  try {
    const existing = await prisma.contactRequest.findFirst({ where: { id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const updated = await prisma.contactRequest.update({
      where: { id },
      data: { assignedToId },
    });
    res.json(updated);
  } catch (err) {
    console.error('[contact-requests] assign error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
