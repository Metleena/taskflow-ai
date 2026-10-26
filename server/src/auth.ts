import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { RequestHandler } from 'express';
import { config } from './config.ts';
import { User } from './models.ts';
import { HttpError } from './util.ts';
import type { Role } from './domain/workflow.ts';

export const COOKIE = 'tf_token';
export const hashPassword = (p: string) => bcrypt.hash(p, 12);
export const verifyPassword = (p: string, hash?: string) => (hash ? bcrypt.compare(p, hash) : Promise.resolve(false));
export const passwordProblem = (p: string) =>
  p.length < 10 ? 'Password must be at least 10 characters.' : !/[A-Za-z]/.test(p) || !/\d/.test(p) ? 'Password must contain letters and numbers.' : null;
export const signToken = (id: string) => jwt.sign({ sub: id }, config.jwtSecret, { expiresIn: '8h' });
export const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure: config.env === 'production', maxAge: 8 * 3600_000, path: '/' };
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = req.cookies?.[COOKIE];
    if (!token) throw new HttpError(401, 'Please sign in.');
    let sub: string;
    try { sub = (jwt.verify(token, config.jwtSecret) as any).sub; } catch { throw new HttpError(401, 'Your session has expired. Please sign in again.'); }
    const user = await User.findById(sub);
    if (!user || user.status !== 'active') throw new HttpError(401, 'This account is not active.');
    req.user = user;
    next();
  } catch (e) { next(e); }
};
export const requireRole = (...roles: Role[]): RequestHandler => (req, _res, next) =>
  roles.includes(req.user?.role) ? next() : next(new HttpError(403, 'You do not have permission to do this.'));
