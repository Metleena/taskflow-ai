import { Router, type Request } from 'express';
import { z } from 'zod';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { config } from '../config.ts';
import { Task, User, Submission, Feedback, Meeting } from '../models.ts';
import { authenticate, requireRole } from '../auth.ts';
import { h, HttpError, oid, escapeRegex, audit } from '../util.ts';
import { tzOk } from './auth.ts';
import { PRIORITIES, TASK_STATUSES, CLOSED, EMPLOYEE_CAN_SUBMIT, canTransition, canComplete, isHttpUrl, isOverdue, validateMeeting, reviewPlan, makeKey } from '../domain/workflow.ts';
import { enqueue } from '../notifications.ts';
import { ALLOWED_EXT, TEXT_EXT, afterTaskCreated, generateExplanation, analyseSubmission, scheduleMeetingReminders, cancelMeetingReminders, scheduleDeadlineReminders } from '../services.ts';

export const taskRouter = Router();
taskRouter.use(authenticate);
const staff = requireRole('admin', 'manager');

export const scope = (u: any) => (u.role === 'admin' ? {} : u.role === 'manager' ? { manager: u._id } : { assignee: u._id });
const withFlags = (t: any) => { const o = t.toObject ? t.toObject() : t; return { ...o, overdue: isOverdue(o.deadline, o.status) }; };
async function loadTask(req: Request, id: any = req.params.id) {
  const t: any = await Task.findOne({ _id: oid.parse(id), ...scope(req.user) });
  if (!t) throw new HttpError(404, 'Task not found.'); // same answer whether it exists or not
  return t;
}
const link = z.string().url().max(2000).refine(isHttpUrl, 'Link must start with http:// or https://');
const tz = z.string().refine(tzOk, 'Unknown time zone');
const meetingIn = z.object({ startsAt: z.coerce.date(), timeZone: tz, platform: z.string().trim().max(60).default('Online'), link, reminderHours: z.array(z.number().positive().max(720)).max(5).optional() });
const list = z.array(z.string().trim().min(1).max(500)).min(1).max(30);

const taskBody = z.object({
  title: z.string().trim().min(3).max(200), description: z.string().trim().min(10).max(20000),
  assigneeIds: z.array(oid).min(1).max(50), department: z.string().trim().max(100).optional(),
  startDate: z.coerce.date(), deadline: z.coerce.date(), priority: z.enum(PRIORITIES),
  deliverables: list, acceptanceCriteria: list, referenceLinks: z.array(link).max(20).default([]),
  meeting: meetingIn, managerId: oid.optional(),
}).refine((b) => b.deadline > b.startDate, { message: 'Deadline must be after the start date.', path: ['deadline'] });

// ---------------- tasks ----------------
taskRouter.get('/tasks', h(async (req, res) => {
  const q = z.object({
    q: z.string().max(100).optional(), status: z.enum([...TASK_STATUSES, 'Overdue']).optional(), priority: z.enum(PRIORITIES).optional(), department: z.string().optional(),
    sort: z.enum(['deadline', '-deadline', 'createdAt', '-createdAt']).default('deadline'),
    page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(10),
  }).parse(req.query);
  const f: any = { ...scope(req.user) };
  if (q.q) f.title = new RegExp(escapeRegex(q.q), 'i');
  if (q.priority) f.priority = q.priority;
  if (q.department) f.department = q.department;
  if (q.status === 'Overdue') { f.deadline = { $lt: new Date() }; f.status = { $nin: CLOSED }; } else if (q.status) f.status = q.status;
  const sort: any = { [q.sort.replace('-', '')]: q.sort.startsWith('-') ? -1 : 1 };
  const [items, total] = await Promise.all([
    Task.find(f).sort(sort).skip((q.page - 1) * q.pageSize).limit(q.pageSize).populate('assignee', 'name email department').populate('manager', 'name email'),
    Task.countDocuments(f),
  ]);
  res.json({ items: items.map(withFlags), total, page: q.page, pageSize: q.pageSize });
}));

taskRouter.post('/tasks', staff, h(async (req, res) => {
  const b = taskBody.parse(req.body);
  const errs = validateMeeting(b.meeting); if (errs.length) throw new HttpError(400, errs.join(' '));
  const assignees: any[] = await User.find({ _id: { $in: b.assigneeIds }, role: 'employee', status: 'active' });
  if (assignees.length !== new Set(b.assigneeIds).size) throw new HttpError(400, 'Every assignee must be an active employee.');
  let managerId = req.user._id;
  if (req.user.role === 'manager') { if (assignees.some((a) => String(a.manager) !== req.user.id)) throw new HttpError(400, 'You can only assign tasks to employees on your team.'); }
  else if (b.managerId) { const m: any = await User.findOne({ _id: b.managerId, role: { $in: ['manager', 'admin'] } }); if (!m) throw new HttpError(400, 'Responsible manager not found.'); managerId = m._id; }
  else if (assignees[0].manager) managerId = assignees[0].manager;
  const groupId = crypto.randomUUID(); const created: any[] = [];
  for (const a of assignees) { // one task per employee so status, submissions and reviews stay individual
    const task: any = await Task.create({ title: b.title, description: b.description, assignee: a._id, manager: managerId, createdBy: req.user._id, groupId, department: b.department ?? a.department, startDate: b.startDate, deadline: b.deadline, priority: b.priority, deliverables: b.deliverables, acceptanceCriteria: b.acceptanceCriteria, referenceLinks: b.referenceLinks });
    const meeting: any = await Meeting.create({ task: task._id, participants: [a._id], manager: managerId, ...b.meeting });
    await audit(req.user, 'task.create', 'Task', task.id, { assignee: a.id });
    void afterTaskCreated(task.id, meeting.id);
    created.push(task);
  }
  res.status(201).json({ items: created.map(withFlags), note: 'Assignment emails are queued; check Notifications for delivery status.' });
}));

taskRouter.get('/tasks/:id', h(async (req, res) => {
  const task: any = await loadTask(req);
  await task.populate([{ path: 'assignee', select: 'name email department timeZone' }, { path: 'manager', select: 'name email' }]);
  const isEmp = req.user.role === 'employee';
  const [meetings, submissions, feedback] = await Promise.all([
    Meeting.find({ task: task._id }).sort({ startsAt: 1 }),
    Submission.find({ task: task._id, ...(isEmp ? {} : { status: 'submitted' }) }).sort({ version: -1, createdAt: -1 }),
    Feedback.find({ task: task._id }).sort({ createdAt: -1 }),
  ]);
  const fb = feedback.map((f: any) => { const o = f.toObject(); if (isEmp && o.decision === 'none') delete o.managerComments; return o; });
  res.json({ task: withFlags(task), meetings, submissions, feedback: fb });
}));

taskRouter.patch('/tasks/:id', staff, h(async (req, res) => {
  const task: any = await loadTask(req);
  const b = z.object({ title: z.string().trim().min(3).max(200), description: z.string().trim().min(10).max(20000), department: z.string().max(100), startDate: z.coerce.date(), deadline: z.coerce.date(), priority: z.enum(PRIORITIES), deliverables: list, acceptanceCriteria: list, referenceLinks: z.array(link).max(20) }).partial().parse(req.body);
  if (CLOSED.includes(task.status)) throw new HttpError(409, 'Approved or completed tasks cannot be edited.');
  const textChanged = ['title', 'description', 'deliverables', 'acceptanceCriteria'].some((k) => (b as any)[k] !== undefined && JSON.stringify((b as any)[k]) !== JSON.stringify(task[k]));
  const deadlineChanged = b.deadline && b.deadline.getTime() !== task.deadline.getTime();
  task.set(b);
  if (task.deadline <= task.startDate) throw new HttpError(400, 'Deadline must be after the start date.');
  await task.save(); await audit(req.user, 'task.update', 'Task', task.id, { fields: Object.keys(b) });
  if (deadlineChanged) await scheduleDeadlineReminders(task); // old reminders skip themselves (deadline no longer matches)
  if (textChanged) void generateExplanation(task.id);
  res.json({ task: withFlags(task), note: textChanged ? 'The employee explanation is being regenerated.' : undefined });
}));

taskRouter.post('/tasks/:id/explain', staff, h(async (req, res) => {
  const task = await loadTask(req); void generateExplanation(task.id); res.status(202).json({ ok: true });
}));

taskRouter.post('/tasks/:id/status', h(async (req, res) => {
  const { status } = z.object({ status: z.enum(TASK_STATUSES) }).parse(req.body);
  const task: any = await loadTask(req);
  const allowed = req.user.role === 'employee' ? ['In Progress'] : ['Under Review', 'On Hold', 'In Progress', 'Assigned'];
  if (!allowed.includes(status) || !canTransition(task.status, status)) throw new HttpError(409, `You cannot change the status from “${task.status}” to “${status}”.`);
  const from = task.status; task.status = status; await task.save();
  await audit(req.user, 'task.status', 'Task', task.id, { from, to: status });
  res.json({ task: withFlags(task) });
}));

taskRouter.post('/tasks/:id/complete', staff, h(async (req, res) => {
  const { note } = z.object({ note: z.string().max(2000).optional() }).parse(req.body ?? {});
  const task: any = await loadTask(req);
  if (!canComplete(task.status)) throw new HttpError(409, 'A task can be completed only after the manager has approved a submission.');
  task.status = 'Completed'; task.finalApproval = { by: req.user._id, at: new Date(), note }; await task.save();
  const open: any[] = await Meeting.find({ task: task._id, status: 'scheduled' });
  for (const m of open) { m.status = 'cancelled'; m.outcome = 'Task completed'; await m.save(); await cancelMeetingReminders(m._id, 'Task completed'); }
  const cycles = await Feedback.countDocuments({ task: task._id, decision: { $ne: 'none' } });
  for (const rid of [task.assignee, task.manager])
    await enqueue({ key: makeKey('task_completed', task.id, rid), type: 'task_completed', recipient: rid, task: task._id, manager: task.manager, payload: { completedAt: new Date(), reviewCycles: cycles, note } });
  await audit(req.user, 'task.complete', 'Task', task.id);
  res.json({ task: withFlags(task) });
}));

// ---------------- submissions ----------------
const uploadDir = path.resolve(config.uploadDir);
const fixName = (n: string) => Buffer.from(n, 'latin1').toString('utf8');
const upload = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => { fs.mkdir(uploadDir, { recursive: true }).then(() => cb(null, uploadDir), (e) => cb(e, uploadDir)); },
    filename: (_r, f, cb) => cb(null, crypto.randomUUID() + path.extname(f.originalname).toLowerCase()),
  }),
  limits: { fileSize: config.maxFileMb * 1024 * 1024, files: 10 },
  fileFilter: (_r, f, cb) => { const ext = path.extname(fixName(f.originalname)).toLowerCase(); ALLOWED_EXT.includes(ext) ? cb(null, true) : cb(new HttpError(400, `Files of type “${ext || 'unknown'}” are not allowed.`)); },
});
async function looksValid(f: Express.Multer.File) { // check content against the extension, not just the name
  const ext = path.extname(fixName(f.originalname)).toLowerCase();
  const fh = await fs.open(f.path, 'r'); const buf = Buffer.alloc(4096); const { bytesRead } = await fh.read(buf, 0, 4096, 0); await fh.close();
  const head = buf.subarray(0, bytesRead);
  if (ext === '.pdf') return head.subarray(0, 4).toString() === '%PDF';
  if (['.docx', '.xlsx', '.zip'].includes(ext)) return head.subarray(0, 2).toString() === 'PK';
  return TEXT_EXT.includes(ext) && !head.includes(0);
}
const toArray = (v: any): any[] => { if (v == null || v === '') return []; if (Array.isArray(v)) return v; try { const p = JSON.parse(v); return Array.isArray(p) ? p : [v]; } catch { return [v]; } };
const rm = (...names: string[]) => Promise.all(names.map((n) => fs.unlink(path.join(uploadDir, n)).catch(() => {})));

taskRouter.post('/tasks/:id/submissions', requireRole('employee'), upload.array('files', 10), h(async (req, res) => {
  const uploaded = (req.files as Express.Multer.File[]) ?? [];
  try {
    const task: any = await loadTask(req);
    const b = z.object({ explanation: z.string().max(20000).default(''), difficulties: z.string().max(5000).default(''), links: z.array(link).max(10), keepFiles: z.array(z.string()).optional(), draft: z.enum(['true', 'false']).default('false') })
      .parse({ ...req.body, links: toArray(req.body.links), keepFiles: req.body.keepFiles === undefined ? undefined : toArray(req.body.keepFiles) });
    const isDraft = b.draft === 'true';
    if (!EMPLOYEE_CAN_SUBMIT.includes(task.status)) throw new HttpError(409, `You cannot submit while the task is “${task.status}”.`);
    for (const f of uploaded) if (!(await looksValid(f))) throw new HttpError(400, `“${fixName(f.originalname)}” does not look like a valid ${path.extname(f.originalname).toLowerCase()} file.`);
    if (!isDraft && b.explanation.trim().length < 10) throw new HttpError(400, 'Describe the work you completed (at least 10 characters).');
    const sub: any = (await Submission.findOne({ task: task._id, employee: req.user._id, status: 'draft' })) ?? new Submission({ task: task._id, employee: req.user._id });
    let files = [...sub.files];
    if (b.keepFiles) { const drop = files.filter((f: any) => !b.keepFiles!.includes(f.storedName)); await rm(...drop.map((f: any) => f.storedName)); files = files.filter((f: any) => b.keepFiles!.includes(f.storedName)); }
    files.push(...uploaded.map((f) => ({ originalName: fixName(f.originalname), storedName: f.filename, size: f.size, mime: f.mimetype })));
    if (files.length > 10) throw new HttpError(400, 'A submission can contain at most 10 files.');
    sub.set({ explanation: b.explanation, difficulties: b.difficulties, links: b.links, files });
    if (isDraft) { await sub.save(); return res.json({ submission: sub, saved: 'draft' }); }
    sub.version = (await Submission.countDocuments({ task: task._id, employee: req.user._id, status: 'submitted' })) + 1;
    sub.status = 'submitted'; sub.submittedAt = new Date(); await sub.save();
    task.status = 'Submitted'; await task.save();
    const fb: any = await Feedback.create({ task: task._id, submission: sub._id, ai: { status: 'pending' } });
    await enqueue({ key: makeKey('submission_confirmation', sub.id), type: 'submission_confirmation', recipient: req.user._id, task: task._id, manager: task.manager, payload: { version: sub.version } });
    await audit(req.user, 'submission.create', 'Submission', sub.id, { version: sub.version });
    void analyseSubmission(fb.id);
    res.status(201).json({ submission: sub, feedbackId: fb.id });
  } catch (e) { await rm(...uploaded.map((f) => f.filename)); throw e; }
}));

taskRouter.get('/submissions/:id/files/:storedName', h(async (req, res) => {
  const sub: any = await Submission.findById(oid.parse(req.params.id));
  const file = sub?.files.find((f: any) => f.storedName === req.params.storedName);
  const allowedTask = sub && (await Task.findOne({ _id: sub.task, ...scope(req.user) }));
  if (!file || !allowedTask) throw new HttpError(404, 'File not found.');
  if (req.user.role !== 'employee' && sub.status === 'draft') throw new HttpError(404, 'File not found.');
  res.download(path.join(uploadDir, file.storedName), file.originalName);
}));

// ---------------- feedback & review ----------------
taskRouter.post('/feedback/:id/reanalyze', staff, h(async (req, res) => {
  const fb: any = await Feedback.findById(oid.parse(req.params.id)); if (!fb) throw new HttpError(404, 'Feedback not found.');
  await loadTask(req, fb.task); void analyseSubmission(fb.id); res.status(202).json({ ok: true });
}));

taskRouter.post('/feedback/:id/review', staff, h(async (req, res) => {
  const b = z.object({ managerComments: z.string().max(10000).default(''), decision: z.enum(['approved', 'changes_required']), meetingId: oid.optional(), meetingOutcome: z.string().max(5000).optional(), nextMeeting: meetingIn.optional() }).parse(req.body);
  const fb: any = await Feedback.findById(oid.parse(req.params.id)); if (!fb) throw new HttpError(404, 'Feedback not found.');
  const task: any = await loadTask(req, fb.task);
  if (fb.decision !== 'none') throw new HttpError(409, 'A decision has already been recorded for this submission.');
  if (!['Submitted', 'Under Review'].includes(task.status)) throw new HttpError(409, `This task is “${task.status}”; only submitted work can be reviewed.`);
  const plan = reviewPlan(b.decision, b.nextMeeting);
  if (plan.errors.length) throw new HttpError(400, plan.errors.join(' '));
  fb.set({ managerComments: b.managerComments, decision: b.decision, decidedBy: req.user._id, decidedAt: new Date() }); await fb.save();
  task.status = plan.nextStatus; await task.save();
  let prev: any = null;
  if (b.meetingId) { prev = await Meeting.findOne({ _id: b.meetingId, task: task._id }); if (prev) { prev.status = 'completed'; prev.outcome = b.meetingOutcome; await prev.save(); await cancelMeetingReminders(prev._id, 'Meeting completed'); } }
  let next: any = null;
  if (b.decision === 'changes_required') {
    next = await Meeting.create({ task: task._id, participants: [task.assignee], manager: task.manager, ...b.nextMeeting });
    if (prev) { prev.nextMeeting = next._id; await prev.save(); }
    await enqueue({ key: makeKey('next_meeting', next.id), type: 'next_meeting', recipient: task.assignee, task: task._id, meeting: next._id, manager: task.manager, payload: { feedbackId: fb.id } });
    await scheduleMeetingReminders(next);
  }
  await audit(req.user, 'feedback.review', 'Feedback', fb.id, { decision: b.decision });
  res.json({ feedback: fb, task: withFlags(task), nextMeeting: next });
}));

// ---------------- meetings ----------------
const meetingScope = (u: any) => (u.role === 'admin' ? {} : u.role === 'manager' ? { manager: u._id } : { participants: u._id });
taskRouter.get('/meetings', h(async (req, res) => {
  const q = z.object({ upcoming: z.enum(['true', 'false']).optional(), status: z.enum(['scheduled', 'completed', 'cancelled', 'missed']).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(15) }).parse(req.query);
  const f: any = { ...meetingScope(req.user) };
  if (q.status) f.status = q.status;
  if (q.upcoming === 'true') { f.status = 'scheduled'; f.startsAt = { $gte: new Date() }; }
  const [items, total] = await Promise.all([
    Meeting.find(f).sort({ startsAt: q.upcoming === 'true' ? 1 : -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).populate('task', 'title status').populate('participants', 'name').populate('manager', 'name email'),
    Meeting.countDocuments(f)]);
  res.json({ items, total, page: q.page, pageSize: q.pageSize });
}));

taskRouter.post('/tasks/:id/meetings', staff, h(async (req, res) => {
  const task: any = await loadTask(req); const b = meetingIn.parse(req.body);
  const errs = validateMeeting(b); if (errs.length) throw new HttpError(400, errs.join(' '));
  if (CLOSED.includes(task.status)) throw new HttpError(409, 'This task is closed.');
  const m: any = await Meeting.create({ task: task._id, participants: [task.assignee], manager: task.manager, ...b });
  await enqueue({ key: makeKey('next_meeting', m.id), type: 'next_meeting', recipient: task.assignee, task: task._id, meeting: m._id, manager: task.manager });
  await scheduleMeetingReminders(m); await audit(req.user, 'meeting.create', 'Meeting', m.id);
  res.status(201).json({ meeting: m });
}));

taskRouter.patch('/meetings/:id', staff, h(async (req, res) => {
  const b = z.discriminatedUnion('action', [
    z.object({ action: z.literal('reschedule'), startsAt: z.coerce.date(), timeZone: tz.optional(), platform: z.string().max(60).optional(), link: link.optional(), reason: z.string().max(500).optional() }),
    z.object({ action: z.literal('cancel'), reason: z.string().max(500).optional() }),
    z.object({ action: z.literal('missed'), reason: z.string().max(500).optional() }),
    z.object({ action: z.literal('complete'), outcome: z.string().max(5000).optional() }),
  ]).parse(req.body);
  const m: any = await Meeting.findOne({ _id: oid.parse(req.params.id), ...meetingScope(req.user) });
  if (!m) throw new HttpError(404, 'Meeting not found.');
  if (m.status !== 'scheduled') throw new HttpError(409, `This meeting is already ${m.status}.`);
  const notify = async (kind: string, reason?: string) => {
    for (const rid of [...m.participants, m.manager])
      await enqueue({ key: makeKey('meeting_changed', m.id, kind, m.startsAt.getTime(), rid), type: 'meeting_changed', recipient: rid, task: m.task, meeting: m._id, manager: m.manager, payload: { kind, reason } });
  };
  if (b.action === 'reschedule') {
    const errs = validateMeeting({ startsAt: b.startsAt, link: b.link ?? m.link }); if (errs.length) throw new HttpError(400, errs.join(' '));
    await cancelMeetingReminders(m._id, 'Meeting rescheduled');
    m.set({ startsAt: b.startsAt, ...(b.timeZone && { timeZone: b.timeZone }), ...(b.platform && { platform: b.platform }), ...(b.link && { link: b.link }) }); m.rescheduleCount += 1; await m.save();
    await scheduleMeetingReminders(m); await notify('rescheduled', b.reason);
  } else if (b.action === 'complete') { m.status = 'completed'; m.outcome = b.outcome; await m.save(); await cancelMeetingReminders(m._id, 'Meeting completed'); }
  else { m.status = b.action === 'cancel' ? 'cancelled' : 'missed'; await m.save(); await cancelMeetingReminders(m._id, `Meeting ${m.status}`); await notify(m.status === 'cancelled' ? 'cancelled' : 'missed', b.reason); }
  await audit(req.user, `meeting.${b.action}`, 'Meeting', m.id);
  res.json({ meeting: m });
}));
