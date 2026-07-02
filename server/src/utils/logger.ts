/**
 * logger.ts — Yapısal (JSON) loglama: pino + pino-http
 *
 * PII/sır maskeleme kuralları:
 *  - Authorization / Cookie / Set-Cookie başlıkları redact edilir.
 *  - URL query'sindeki token benzeri parametreler maskelenir
 *    (e-posta doğrulama, webhook verify token vb. GET ile taşınıyor).
 *  - Request/response BODY hiçbir zaman loglanmaz (pino-http varsayılanı) —
 *    hasta verisi ve şifreler body'de taşındığı için bu bilinçli bir sınır.
 */

import pino from 'pino';
import { pinoHttp } from 'pino-http';

const SENSITIVE_QUERY_PARAMS =
  /([?&](?:token|code|key|secret|signature|hub\.verify_token|hub\.challenge)=)[^&#]*/gi;

export function maskUrl(url: string): string {
  return url.replace(SENSITIVE_QUERY_PARAMS, '$1***');
}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: undefined, // pid/hostname loglanmasın
});

export const httpLogger = pinoHttp({
  logger,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
    ],
    censor: '***',
  },
  serializers: {
    req(req) {
      req.url = maskUrl(req.url);
      return req;
    },
  },
  customLogLevel(_req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
});
