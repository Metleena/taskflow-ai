import { Router } from 'express';
import { z } from 'zod';
import { Task, User, Meeting, Feedback, Notification, AuditLog, NOTIFICATION_TYPES } from '../models.ts';
import { authenticate, requireRole } from '../auth.ts';
import { h, HttpError, oid, audit } from '../util.ts';
import { scope } from './tasks.ts';
import { config, mailConfigured, aiConfigured } from '../config.ts';
import { lastTickAt } from '../notifications.ts';
import { CLOSED } from '../domain/workflow.ts';

export const miscRouter = Router();
miscRouter.use(authenticate);

const progressPipeline = (match: object, groupBy: string) => [
  { $match: match },
  { $group: { _id: groupBy, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } },
      overdue: { $sum: { $cond: [{ $and: [{ $lt: ['$deadline', new Date()] }, { $not: [{ $in: ['$status', CLOSED] }] }] }, 1, 0] } } } },
  { $sort: { total: -1 } }, { $limit: 50 },
] as any[];

miscRouter.get('/dashboard', h(async (req, res) => {
  const u = req.user; const sc: any = scope(u); const now = new Date();
  const c = (f: object) => Task.countDocuments({ ...sc, ...f });
  const soon = new Date(now.getTime() + 7 * 86400_000);
  const [total, active, completed, overdue, assigned, inProgress, awaitingReview, changesRequired, dueSoon, taskIds] = await Promise.all([
    c({}), c({ status: { $ne: 'Completed' } }), c({ status: 'Completed' }), c({ deadline: { $lt: now }, status: { $nin: CLOSED } }),
    c({ status: 'Assigned' }), c({ status: 'In Progress' }), c({ status: { $in: ['Submitted', 'Under Review'] } }), c({ status: 'Changes Required' }),
    Task.find({ ...sc, deadline: { $gte: now, $lte: soon }, status: { $nin: CLOSED } }).sort({ deadline: 1 }).limit(5).select('title deadline status priority'),
    Task.find(sc).distinct('_id'),
  ]);
  const meetingScope = u.role === 'admin' ? {} : u.role === 'manager' ? { manager: u._id } : { participants: u._id };
  const [upcomingMeetings, recentFeedback] = await Promise.all([
    Meeting.find({ ...meetingScope, status: 'scheduled', startsAt: { $gte: now } }).sort({ startsAt: 1 }).limit(5).populate('task', 'title'),
    Feedback.find({ task: { $in: taskIds } }).sort({ createdAt: -1 }).limit(5).populate('task', 'title status').select('task ai.status ai.report.progressPercent ai.report.progressExplanation decision createdAt'),
  ]);
  const out: any = { counts: { total, active, completed, overdue, assigned, inProgress, awaitingReview, changesRequired }, dueSoon, upcomingMeetings, recentFeedback };
  if (u.role === 'admin') { out.counts.employees = await User.countDocuments({ role: 'employee', status: 'active' }); out.counts.managers = await User.countDocuments({ role: 'manager', status: 'active' }); }
  if (u.role === 'manager') out.counts.employees = await User.countDocuments({ role: 'employee', manager: u._id, status: 'active' });
  if (u.role !== 'employee') out.departmentProgress = (await Task.aggregate(progressPipeline(sc, '$department'))).map((d) => ({ department: d._id || 'Unassigned', total: d.total, completed: d.completed, overdue: d.overdue }));
  res.json(out);
}));

miscRouter.get('/notifications', h(async (req, res) => {
  const q = z.object({ status: z.enum(['pending', 'processing', 'sent', 'failed', 'skipped']).optional(), type: z.enum(NOTIFICATION_TYPES).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(15) }).parse(req.query);
  const u = req.user; const f: any = u.role === 'admin' ? {} : u.role === 'manager' ? { $or: [{ recipient: u._id }, { manager: u._id }] } : { recipient: u._id };
  if (q.status) f.status = q.status; if (q.type) f.type = q.type;
  const [items, total] = await Promise.all([
    Notification.find(f).sort({ scheduledFor: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).select('-payload -key').populate('recipient', 'name email').populate('task', 'title'),
    Notification.countDocuments(f)]);
  res.json({ items, total, page: q.page, pageSize: q.pageSize });
}));
miscRouter.post('/notifications/:id/retry', requireRole('admin', 'manager'), h(async (req, res) => {
  const n: any = await Notification.findById(oid.parse(req.params.id));
  if (!n || (req.user.role === 'manager' && String(n.manager) !== req.user.id)) throw new HttpError(404, 'Notification not found.');
  if (!['failed', 'skipped'].includes(n.status)) throw new HttpError(409, 'Only failed or skipped notifications can be retried.');
  n.set({ status: 'pending', attempts: 0, nextAttemptAt: null, lastError: null, scheduledFor: new Date() }); await n.save();
  await audit(req.user, 'notification.retry', 'Notification', n.id);
  res.json({ ok: true });
}));

const admin = Router(); admin.use(requireRole('admin'));
admin.get('/integrations', h(async (_req, res) => res.json({
  email: { configured: mailConfigured(), host: config.smtp.host ?? null, from: config.smtp.from ?? null, note: mailConfigured() ? 'SMTP settings are present. Delivery status is recorded per notification.' : 'SMTP is not configured; emails will be recorded as failed until it is.' },
  ai: { configured: aiConfigured(), provider: 'anthropic', model: config.ai.model, note: aiConfigured() ? undefined : 'Set ANTHROPIC_API_KEY to enable explanations and feedback analysis.' },
  meetings: { mode: 'manager-supplied links', providers: [], note: 'Meeting links are always entered by a manager. No provider integration is connected.' },
  worker: { lastTickAt, intervalMs: config.workerIntervalMs },
  reminders: { meetingHours: config.meetingReminderHours, deadlineHours: config.deadlineReminderHours },
  note: 'Integrations are configured through environment variables (see .env.example) and need a server restart.',
})));
admin.get('/audit', h(async (req, res) => {
  const { page } = z.object({ page: z.coerce.number().int().min(1).default(1) }).parse(req.query);
  const [items, total] = await Promise.all([AuditLog.find().sort({ createdAt: -1 }).skip((page - 1) * 25).limit(25).populate('actor', 'name role'), AuditLog.countDocuments()]);
  res.json({ items, total, page, pageSize: 25 });
}));
admin.get('/reports', h(async (_req, res) => {
  const byEmployee = await Task.aggregate(progressPipeline({}, '$assignee'));
  const users = await User.find({ _id: { $in: byEmployee.map((e) => e._id) } }).select('name department');
  const names = new Map(users.map((x: any) => [String(x._id), x]));
  res.json({
    byDepartment: (await Task.aggregate(progressPipeline({}, '$department'))).map((d) => ({ department: d._id || 'Unassigned', total: d.total, completed: d.completed, overdue: d.overdue })),
    byEmployee: byEmployee.map((e) => ({ employee: (names.get(String(e._id)) as any)?.name ?? 'Unknown', department: (names.get(String(e._id)) as any)?.department, total: e.total, completed: e.completed, overdue: e.overdue })),
  });
}));
miscRouter.use('/admin', admin);
