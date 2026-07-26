/**
 * logger.ts — Yapısal (JSON) loglama: pino + pino-http
 *
 * HTTP request logu, pino-http'nin varsayılan req serializer'ını KULLANMAZ.
 * pino-http'nin std serializer'ı req.query, req.params, req.headers (tüm
 * başlıklar dahil x-forwarded-for/x-real-ip) ve req.remoteAddress alanlarını
 * olduğu gibi log objesine koyar; bunlardan yalnızca authorization/cookie
 * redact edilirdi — geri kalanı (clinicId/patientId query param'ları, UUID
 * path segment'leri, forwarded IP zinciri) düz metin olarak sızardı.
 *
 * Bunun yerine yalnızca operasyonel açıdan gerekli, açıkça izin verilmiş
 * (allowlist) alanlar log'a yazılır: request id, method, route template
 * (veya UUID/identifier'ları temizlenmiş fallback path), status code,
 * response time. Ham request/response nesnesi, header'lar, query, params,
 * body ve IP asla loglanmaz.
 *
 * Detaylar: docs/program/evidence/HTTP_LOG_PRIVACY_HARDENING_001.md
 */

import pino from 'pino';
import { pinoHttp } from 'pino-http';
import type { Request, Response } from 'express';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: undefined, // pid/hostname loglanmasın
});

const UUID_SEGMENT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_ID_SEGMENT_RE = /^\d{4,}$/;
const EMAIL_SEGMENT_RE = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;
const OPAQUE_TOKEN_SEGMENT_RE = /^[A-Za-z0-9_-]{20,}$/;

function isIdentifierLikeSegment(segment: string): boolean {
  return (
    UUID_SEGMENT_RE.test(segment) ||
    NUMERIC_ID_SEGMENT_RE.test(segment) ||
    EMAIL_SEGMENT_RE.test(segment) ||
    OPAQUE_TOKEN_SEGMENT_RE.test(segment)
  );
}

/**
 * Route template bulunamadığında kullanılan güvenli fallback: query string
 * ve fragment atılır, path segment'leri tek tek UUID/e-posta/uzun opak
 * token/uzun sayısal id olup olmadığına bakılarak `:id` ile değiştirilir.
 */
export function sanitizePathFallback(rawPath: string | undefined | null): string {
  if (!rawPath) return '';
  const withoutQueryOrFragment = rawPath.split('?')[0].split('#')[0];
  return withoutQueryOrFragment
    .split('/')
    .map(segment => (segment === '' || !isIdentifierLikeSegment(segment) ? segment : ':id'))
    .join('/');
}

/**
 * pino-http'nin customSuccessObject/customErrorObject callback'lerine Node'un
 * ham IncomingMessage tipi geçiriliyor; Express bu nesneyi runtime'da
 * baseUrl/route/originalUrl ile genişletiyor ama tip tanımı bunu bilmiyor —
 * bu yüzden yalnızca ihtiyaç duyulan alanlar için minimal bir şekil kullanılır.
 */
interface RouteAwareRequest {
  baseUrl?: string;
  route?: { path?: unknown };
  originalUrl?: string;
  url?: string;
}

/**
 * Eşleşen Express route'u varsa (mount edilmiş router'lar dahil, baseUrl +
 * route.path) onu döndürür; response tamamlanana kadar bu bilgi kesinleşmez,
 * bu yüzden yalnızca completion/error log'unda hesaplanır (bkz. buildHttpLogger).
 * Route eşleşmemişse (404, route öncesi hata) sanitizePathFallback'e düşer.
 */
export function safeRoute(req: RouteAwareRequest): string {
  const route = req.route;
  if (route && typeof route.path === 'string') {
    const base = typeof req.baseUrl === 'string' ? req.baseUrl : '';
    return `${base}${route.path}` || '/';
  }
  return sanitizePathFallback(req.originalUrl ?? req.url);
}

/** Request log'unda tutulan tek şey: id ve method — ikisi de zaman içinde değişmez. */
function safeRequestLog(req: Request) {
  return {
    id: req.id,
    method: req.method,
  };
}

function safeResponseLog(res: Response) {
  return {
    statusCode: res.statusCode,
  };
}

function safeErrorLog(err: unknown) {
  const error = err instanceof Error ? err : new Error(String(err));
  return {
    type: error.name,
    message: error.message,
    ...(process.env.NODE_ENV !== 'production' ? { stack: error.stack } : {}),
  };
}

const REDACT_PATHS = [
  // Mevcut auth/cookie koruması (defense in depth — safeRequestLog zaten
  // header içermiyor, ama req serializer'ı bypass eden bir binding olursa
  // bu satırlar son çare olarak devrede kalır).
  'req.headers.authorization',
  'req.headers.Authorization',
  'req.headers.cookie',
  'req.headers.Cookie',
  'req.headers["set-cookie"]',
  'req.headers["Set-Cookie"]',
  'res.headers["set-cookie"]',
  'res.headers["Set-Cookie"]',
  // Forwarded/real IP zinciri ve diğer sır/oturum başlıkları.
  'req.headers["x-forwarded-for"]',
  'req.headers["X-Forwarded-For"]',
  'req.headers["x-real-ip"]',
  'req.headers["X-Real-Ip"]',
  'req.headers["x-csrf-token"]',
  'req.headers["X-Csrf-Token"]',
  'req.headers["x-api-key"]',
  'req.headers["X-Api-Key"]',
  // Ham IP/bağlantı bilgisi ve query/params — serializer bunları zaten
  // koymuyor, bu satırlar yalnızca ek güvenlik katmanı.
  'req.remoteAddress',
  'req.remotePort',
  'req.query',
  'req.params',
];

export function buildHttpLogger(instance: pino.Logger = logger) {
  return pinoHttp({
    logger: instance,
    wrapSerializers: false,
    redact: {
      paths: REDACT_PATHS,
      censor: '***',
    },
    serializers: {
      req: safeRequestLog,
      res: safeResponseLog,
      err: safeErrorLog,
    },
    customLogLevel(_req, res, err) {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    // req.route yalnızca response tamamlandığında (route handler'lar
    // çalıştıktan sonra) kesinleşir; bu yüzden route template'i burada,
    // completion/error objesine ayrı bir alan olarak ekliyoruz — req
    // serializer'ı (yukarıda) request başında çalışıp id/method'u sabitliyor.
    customSuccessObject(req, res, successObject) {
      return {
        ...successObject,
        route: safeRoute(req),
      };
    },
    customErrorObject(req, res, error, errorObject) {
      return {
        ...errorObject,
        route: safeRoute(req),
      };
    },
  });
}

export const httpLogger = buildHttpLogger(logger);
