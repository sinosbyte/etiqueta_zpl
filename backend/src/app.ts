import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { authRouter } from './routes/auth';
import { authenticate } from './middleware/authenticate';
import { proxyLimiter, templatesLimiter, tokensLimiter } from './middleware/rateLimit';
import { errorHandler } from './middleware/errorHandler';
import { zplRouter } from './routes/zpl';
import { designsRouter } from './routes/designs';
import { templatesRouter } from './routes/templates';
import { tokensRouter } from './routes/tokens';
import { healthRouter } from './routes/health';
import logger from './logger';
import { FRONTEND_URL, isProduction, MAX_BODY_SIZE } from './config';
import path from 'path';

const app = express();

// Security headers (CSP, HSTS, X-Content-Type-Options, etc.)
app.use(helmet({
  crossOriginOpenerPolicy: false,
  contentSecurityPolicy: false,
}));

// Structured HTTP request logging
app.use(pinoHttp({ logger }));

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) {
      cb(null, true);
      return;
    }
    if (origin === FRONTEND_URL || (!isProduction && origin.startsWith('http://localhost:'))) {
      cb(null, true);
    } else {
      cb(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // allow the refresh-token cookie to be sent cross-origin (dev: 5173→3001)
}));

app.use(express.json({ limit: MAX_BODY_SIZE }));
app.use(cookieParser());

app.use('/health', healthRouter);
app.use('/api/auth', authRouter);                         // public; limiters applied per-route
app.use('/api/designs', authenticate, designsRouter);     // protected
app.use('/api/templates', templatesLimiter, authenticate, templatesRouter); // protected; changes need is_admin
app.use('/api/tokens', tokensLimiter, authenticate, tokensRouter); // integration tokens: signed-in session only
app.use('/api', authenticate, proxyLimiter, zplRouter);   // protected, rate-limited

if (isProduction) {
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('*', (_req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
  );
}

// Centralized error handler — must be last
app.use(errorHandler);

export default app;
