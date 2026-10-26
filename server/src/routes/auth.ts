import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { User } from '../models.ts';
import { authenticate, requireRole, hashPassword, verifyPassword, passwordProblem, signToken, cookieOptions, COOKIE, sha256 } from '../auth.ts';
import { h, HttpError, oid, escapeRegex, audit } from '../util.ts';
import { ROLES } from '../domain/workflow.ts';
import { enqueue } from '../notifications.ts';
import { config } from '../config.ts';

export const pub = (u: any) => ({ id: u.id, name: u.name, email: u.email, role: u.role, department: u.department, manager: u.manager, status: u.status, timeZone: u.timeZone });
export const tzOk = (tz: string) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };
const tz = z.string().refine(tzOk, 'Unknown time zone');
const pw = z.string().superRefine((p, ctx) => { const m = passwordProblem(p); if (m) ctx.addIssue({ code: 'custom', message: m }); });

export const authRouter = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, skip: () => config.env === 'test', standardHeaders: true, legacyHeaders: false, message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' } });

authRouter.post('/auth/login', loginLimiter, h(async (req, res) => {
  const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const user: any = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
  const ok = await verifyPassword(password, user?.passwordHash);
  if (!user || !ok || user.status !== 'active') throw new HttpError(401, 'Email or password is incorrect.');
  res.cookie(COOKIE, signToken(user.id), cookieOptions).json({ user: pub(user) });
}));
authRouter.post('/auth/logout', (_req, res) => { res.clearCookie(COOKIE, { path: '/' }).json({ ok: true }); });

authRouter.post('/auth/set-password', loginLimiter, h(async (req, res) => {
  const { token, password } = z.object({ token: z.string().min(20), password: pw }).parse(req.body);
  const user: any = await User.findOne({ resetTokenHash: sha256(token), resetTokenExpires: { $gt: new Date() } }).select('+resetTokenHash +resetTokenExpires');
  if (!user) throw new HttpError(400, 'This link is invalid or has expired. Ask your administrator to send a new one.');
  user.passwordHash = await hashPassword(password); user.resetTokenHash = undefined; user.resetTokenExpires = undefined;
  await user.save(); await audit(user, 'user.password_set', 'User', user.id);
  res.json({ ok: true });
}));

authRouter.use(authenticate);
authRouter.get('/auth/me', h(async (req, res) => res.json({ user: pub(req.user) })));
authRouter.patch('/auth/me', h(async (req, res) => {
  const b = z.object({ name: z.string().min(1).max(120).optional(), timeZone: tz.optional(), currentPassword: z.string().optional(), newPassword: pw.optional() }).parse(req.body);
  const user: any = await User.findById(req.user.id).select('+passwordHash');
  if (b.name) user.name = b.name;
  if (b.timeZone) user.timeZone = b.timeZone;
  if (b.newPassword) {
    if (!(await verifyPassword(b.currentPassword ?? '', user.passwordHash))) throw new HttpError(400, 'Current password is incorrect.');
    user.passwordHash = await hashPassword(b.newPassword);
  }
  await user.save(); await audit(user, 'user.profile_update', 'User', user.id);
  res.json({ user: pub(user) });
}));

// ---- user management ----
authRouter.get('/users', requireRole('admin', 'manager'), h(async (req, res) => {
  const q = z.object({ role: z.enum(ROLES).optional(), q: z.string().max(100).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
  const f: any = {};
  if (req.user.role === 'manager') { f.role = 'employee'; f.manager = req.user._id; } else if (q.role) f.role = q.role;
  if (q.q) f.$or = [{ name: new RegExp(escapeRegex(q.q), 'i') }, { email: new RegExp(escapeRegex(q.q), 'i') }];
  const [items, total] = await Promise.all([User.find(f).sort({ name: 1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize), User.countDocuments(f)]);
  res.json({ items: items.map(pub), total, page: q.page, pageSize: q.pageSize });
}));
const userBody = z.object({ name: z.string().min(1).max(120), email: z.string().email(), role: z.enum(ROLES), department: z.string().max(100).optional(), manager: oid.optional().nullable(), timeZone: tz.optional() });
authRouter.post('/users', requireRole('admin'), h(async (req, res) => {
  const b = userBody.parse(req.body);
  if (b.role === 'employee' && b.manager) { const m: any = await User.findById(b.manager); if (!m || m.role !== 'manager') throw new HttpError(400, 'Manager must be a user with the manager role.'); }
  const user: any = await User.create({ ...b, manager: b.manager ?? undefined });
  await enqueue({ key: `account_created:${user.id}`, type: 'account_created', recipient: user._id });
  await audit(req.user, 'user.create', 'User', user.id, { role: user.role });
  res.status(201).json({ user: pub(user) });
}));
authRouter.patch('/users/:id', requireRole('admin'), h(async (req, res) => {
  const b = userBody.partial().extend({ status: z.enum(['active', 'disabled']).optional() }).parse(req.body);
  if (req.params.id === req.user.id && (b.status === 'disabled' || (b.role && b.role !== 'admin'))) throw new HttpError(400, 'You cannot disable or demote your own account.');
  const user: any = await User.findByIdAndUpdate(oid.parse(req.params.id), b, { new: true, runValidators: true });
  if (!user) throw new HttpError(404, 'User not found.');
  await audit(req.user, 'user.update', 'User', user.id, b);
  res.json({ user: pub(user) });
}));
authRouter.post('/users/:id/invite', requireRole('admin'), h(async (req, res) => {
  const user: any = await User.findById(oid.parse(req.params.id));
  if (!user) throw new HttpError(404, 'User not found.');
  await enqueue({ key: `account_created:${user.id}:${Date.now()}`, type: 'account_created', recipient: user._id });
  res.json({ ok: true, message: 'Invitation queued. Check Notifications for delivery status.' });
}));
