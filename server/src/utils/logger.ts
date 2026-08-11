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
 * (eşleşen bir route yoksa sabit, kullanıcı girdisi taşımayan bir etiket),
 * status code, response time. Ham request/response nesnesi, header'lar,
 * query, params, body ve IP asla loglanmaz.
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

/**
 * Route template bulunamadığında (404, route öncesi hata, veya route.path
 * string olmayan bir değer — array/RegExp) kullanılan güvenli fallback.
 *
 * Önceki tasarım, path segment'lerini tek tek bilinen kalıplara (UUID,
 * e-posta, uzun opak token, uzun sayısal id, telefon) göre sınıflandırıp
 * yalnızca eşleşenleri `:id` ile değiştiriyordu. Bu yaklaşım prensipte asla
 * tam olamaz: 4 haneden kısa sayısal id'ler (`/42`), serbest metin/isim
 * benzeri slug'lar (`/jane-doe`), kısa sır/referans kodları (`/AB123`) gibi
 * bilinmeyen biçimler her zaman atlatılabilir — çağıran taraf hangi path'in
 * eşleşmeyeceğini (dolayısıyla hangi ham segmentin log'a düşeceğini)
 * doğrudan kontrol eder. Sınıflandırma yerine sabit, geri döndürülemez bir
 * etiket kullanmak bu sızıntı sınıfının tamamını kapatır; eşleşen route'lar
 * zaten `safeRoute()` içinde ayrı bir daldan, kendi template'iyle loglanır —
 * bu fallback yalnızca "route eşleşmedi" bilgisini taşır.
 */
export function sanitizePathFallback(
  _rawPath: string | undefined | null,
): string {
  return '/:unmatched';
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

/**
 * error.message serbest metindir — uygulama kodu (thrown Error, Prisma
 * hatası, üçüncü parti API yanıtı vb.) buraya patientId/clinicId/e-posta/
 * token gibi istek kaynaklı değerleri gömebilir (örn. `Patient ${id} not
 * found`). Production'da mesajı olduğu gibi loglamak bu PR'ın engellemeye
 * çalıştığı sızıntıyı `err.message` üzerinden yeniden açar; bu yüzden
 * production'da yalnızca sabit, içerik taşımayan bir mesaj + hata tipi
 * (error.name) loglanır. Tanılama için error.name + reqId + route yeterli;
 * tam mesaj/stack yalnızca production dışında.
 */
/**
 * Exported (F3-OBS-001) so callers outside this file's own HTTP-error path —
 * currently utils/fatalErrorHandlers.ts's process-level uncaughtException/
 * unhandledRejection handlers — can log an error through the exact same
 * production-safe redaction policy instead of re-implementing it.
 */
export function safeErrorLog(err: unknown) {
  const error = err instanceof Error ? err : new Error(String(err));
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    type: error.name,
    message: isProduction ? 'internal error' : error.message,
    ...(isProduction ? {} : { stack: error.stack }),
  };
}

/**
 * server/src/index.ts'in global Express hata middleware'i için tek güvenli
 * loglama noktası — ham `err` nesnesini asla `console.error`/log stream'ine
 * yazmaz (aksi halde bu PR'ın httpLogger için kapattığı sızıntı, ayrı bir
 * yoldan — PM2/stdout üzerinden — yeniden açılmış olur).
 *
 * Alanlar bilinçli olarak `errType`/`errMessage`/`errStack` — `err` DEĞİL:
 * pino her instance'a varsayılan olarak bir `err` serializer'ı
 * (`pino-std-serializers`) bağlar; `logger`/test'lerdeki capturing instance
 * gibi `err` serializer'ını override etmeyen bir logger'a zaten
 * sanitize edilmiş bir düz obje `err` anahtarıyla verilirse, o varsayılan
 * serializer devreye girip objeyi (gerçek bir Error olmadığı için) yeniden,
 * beklenmedik şekilde işler. Ayrı, çakışmayan alan adları bu riski tamamen
 * ortadan kaldırır.
 */
export function logUnhandledError(
  req: RouteAwareRequest & { id?: unknown },
  status: number,
  err: unknown,
  instance: pino.Logger = logger,
) {
  const safeErr = safeErrorLog(err);
  instance.error(
    {
      reqId: req.id,
      route: safeRoute(req),
      status,
      errType: safeErr.type,
      errMessage: safeErr.message,
      ...('stack' in safeErr ? { errStack: safeErr.stack } : {}),
    },
    'unhandled error',
  );
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
