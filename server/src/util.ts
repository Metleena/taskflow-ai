import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { z, ZodError } from 'zod';
import { AuditLog } from './models.ts';

declare global { namespace Express { interface Request { user: any } } }

export class HttpError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
export const h = (fn: (req: Request, res: Response) => Promise<any>): RequestHandler => (req, res, next) => { fn(req, res).catch(next); };
export const oid = z.preprocess((val) => (val != null ? String(val) : val), z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id')) as z.ZodType<string>;
export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const log = {
  info: (...a: any[]) => { if (process.env.NODE_ENV !== 'test') console.log(new Date().toISOString(), ...a); },
  error: (msg: string, err?: any) => console.error(new Date().toISOString(), msg, err?.message ?? ''), // never logs bodies or secrets
};
export const audit = (actor: any, action: string, entity: string, entityId: any, meta?: object) =>
  AuditLog.create({ actor: actor?._id ?? actor, action, entity, entityId: String(entityId), meta }).catch((e) => log.error('audit failed', e));

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) return res.status(400).json({ error: 'Validation failed', details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File is too large.' });
  if (err?.code === 11000) return res.status(409).json({ error: 'A record with these details already exists.' });
  if (err?.name === 'CastError') return res.status(400).json({ error: 'Invalid identifier.' });
  log.error('Unhandled error', err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
}
