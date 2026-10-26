import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.ts';
import { authRouter } from './routes/auth.ts';
import { taskRouter } from './routes/tasks.ts';
import { miscRouter } from './routes/misc.ts';
import { errorHandler } from './util.ts';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use('/api', rateLimit({ windowMs: 15 * 60_000, limit: 600, skip: () => config.env === 'test', standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please slow down.' } }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', authRouter, taskRouter, miscRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));
  const dist = path.resolve('../client/dist'); // single-origin deployment: `npm run build` in client/
  if (fs.existsSync(dist)) { app.use(express.static(dist)); app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html'))); }
  app.use(errorHandler);
  return app;
}
