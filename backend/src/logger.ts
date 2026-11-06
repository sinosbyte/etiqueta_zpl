import pino from 'pino';
import { isProduction } from './config';

/** Request fields that carry credentials (JWT, integration token, refresh cookie): never written to the logs. */
export const LOG_REDACT_PATHS = ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'];

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' },
  // Human-readable in dev; pure JSON in production for log aggregators.
  transport: isProduction ? undefined : { target: 'pino-pretty' },
});

export default logger;
