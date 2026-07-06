/**
 * imagingBridgePublic.ts — Görüntüleme köprü ajanı public heartbeat endpoint'i.
 *
 * /api/public altına authenticate ÖNCESİNDE bağlanır; kullanıcı oturumu değil,
 * köprü token'ı (Bearer) ile kimlik doğrular. Token veritabanında yalnızca
 * sha256 özeti (tokenHash) olarak durur — kayıt routes/imaging.ts'te yapılır.
 *
 * Güvenlik ilkeleri:
 *  - İptal edilen (revoked) ajan anında reddedilir; tüm ret durumları aynı
 *    jenerik 401 döner (token geçerliliği hakkında bilgi sızdırılmaz).
 *  - IP ve token bazlı çift rate limit (mevcut createRateLimiter altyapısı).
 *  - Loglara/audit metadata'sına düz metin token, PHI/PII veya hasta verisi
 *    ASLA yazılmaz — yalnızca ajan ID'si ve sürüm.
 *  - Yanıt minimaldir; klinik/hasta verisi dönmez. Görüntü yükleme bu
 *    endpoint'te YOKTUR (gelecek faz — docs/47-imaging-bridge-contract.md).
 */

import express, { Request, Response } from 'express';
import prisma from '../db.js';
import { createRateLimiter } from '../utils/helpers.js';
import { writeAuditLog } from '../utils/auditLog.js';
import { hashBridgeToken } from '../services/imaging/bridgeTokens.js';
import { imagingBridgeHeartbeatSchema } from '../schemas/index.js';

const router = express.Router();

// Ajan ~60 sn'de bir heartbeat atar; token başına 6/dk cömert bir tavandır.
// IP limiti token brute-force denemelerini DB'ye ulaşmadan keser.
const heartbeatIpLimiter = createRateLimiter(60, 60 * 1000, 'imaging-bridge-hb-ip');
const heartbeatTokenLimiter = createRateLimiter(6, 60 * 1000, 'imaging-bridge-hb-token');

// POST /api/public/imaging/bridge/heartbeat
router.post('/imaging/bridge/heartbeat', async (req: Request, res: Response) => {
  try {
    const ipKey = req.ip ?? 'unknown';
    if (!(await heartbeatIpLimiter.check(ipKey))) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    await heartbeatIpLimiter.record(ipKey);

    const authHeader = req.headers.authorization;
    const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : undefined;
    if (!rawToken) return res.status(401).json({ error: 'Unauthorized' });

    // Token bazlı limit özet (hash) üzerinden anahtarlanır — düz metin token
    // rate-limit store'una dahi yazılmaz.
    const tokenHash = hashBridgeToken(rawToken);
    if (!(await heartbeatTokenLimiter.check(tokenHash))) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    await heartbeatTokenLimiter.record(tokenHash);

    const validation = imagingBridgeHeartbeatSchema.safeParse(req.body ?? {});
    if (!validation.success) return res.status(400).json({ error: 'Invalid payload' });

    const agent = await prisma.imagingBridgeAgent.findUnique({
      where: { tokenHash },
      select: { id: true, clinicId: true, status: true, clinic: { select: { organizationId: true } } },
    });

    // Bilinmeyen ve iptal edilmiş token aynı jenerik yanıtı alır.
    if (!agent || agent.status === 'revoked') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const firstSeen = agent.status === 'pending';
    await prisma.imagingBridgeAgent.update({
      where: { id: agent.id },
      data: {
        status: 'online',
        lastSeenAt: new Date(),
        ...(validation.data.agentVersion ? { agentVersion: validation.data.agentVersion } : {}),
      },
    });

    if (firstSeen) {
      await writeAuditLog({
        organizationId: agent.clinic.organizationId,
        clinicId: agent.clinicId,
        action: 'imaging_bridge_heartbeat_first_seen',
        entityType: 'imaging_bridge_agent',
        entityId: agent.id,
        metadata: validation.data.agentVersion ? { agentVersion: validation.data.agentVersion } : null,
      });
    }

    // Minimal yanıt: ajan durumu dışında hiçbir veri dönmez.
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Heartbeat failed' });
  }
});

export default router;
