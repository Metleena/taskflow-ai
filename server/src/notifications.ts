import crypto from 'node:crypto';
import { config } from './config.ts';
import { Notification, User, Task, Meeting, Feedback, NOTIFICATION_TYPES } from './models.ts';
import { renderEmail, type MailCtx } from './templates.ts';
import { sendMail, canSendMail } from './mailer.ts';
import { sha256 } from './auth.ts';
import { log } from './util.ts';

type NType = (typeof NOTIFICATION_TYPES)[number];
export interface EnqueueInput { key: string; type: NType; recipient: any; task?: any; meeting?: any; manager?: any; scheduledFor?: Date; payload?: Record<string, any> }

/** Idempotent: the same key can never create a second notification. */
export async function enqueue(i: EnqueueInput) {
  const doc = { recipient: i.recipient, task: i.task, meeting: i.meeting, manager: i.manager, type: i.type, scheduledFor: i.scheduledFor ?? new Date(), payload: i.payload ?? {} };
  try { return await Notification.findOneAndUpdate({ key: i.key }, { $setOnInsert: doc }, { upsert: true, new: true }); }
  catch (e: any) { if (e?.code === 11000) return Notification.findOne({ key: i.key }); throw e; }
}

/** Skip pending notifications that no longer apply (meeting cancelled/rescheduled, etc.). */
export const skipPending = (filter: object, reason: string) =>
  Notification.updateMany({ ...filter, status: 'pending' }, { $set: { status: 'skipped', lastError: reason } });

async function buildContext(n: any): Promise<MailCtx | { skip: string }> {
  const recipient: any = await User.findById(n.recipient);
  if (!recipient || recipient.status !== 'active') return { skip: 'Recipient is missing or inactive.' };
  const p = n.payload ?? {};
  const ctx: MailCtx = { recipient: { name: recipient.name, email: recipient.email, timeZone: recipient.timeZone }, appUrl: config.clientUrl, extra: p };
  if (n.task) {
    const task: any = await Task.findById(n.task).populate('assignee', 'name email timeZone').populate('manager', 'name email');
    if (!task) return { skip: 'Task no longer exists.' };
    ctx.task = task; ctx.employee = task.assignee; ctx.manager = task.manager;
    if (n.type === 'deadline_reminder' && (p.deadlineMs !== task.deadline.getTime() || ['Approved', 'Completed'].includes(task.status))) return { skip: 'Deadline changed or task closed.' };
  }
  if (n.meeting) {
    const m: any = await Meeting.findById(n.meeting);
    if (!m) return { skip: 'Meeting no longer exists.' };
    ctx.meeting = m;
    if (n.type === 'meeting_reminder' && (m.status !== 'scheduled' || m.startsAt.getTime() !== p.startsAtMs)) return { skip: 'Meeting was rescheduled, cancelled or already held.' };
  }
  if (p.feedbackId) ctx.feedback = await Feedback.findById(p.feedbackId);
  if (n.type === 'account_created') {
    const raw = crypto.randomBytes(32).toString('hex'); // generated per attempt; the raw token is never stored
    await User.updateOne({ _id: recipient._id }, { resetTokenHash: sha256(raw), resetTokenExpires: new Date(Date.now() + 48 * 3600_000) });
    ctx.extra = { ...p, setPasswordUrl: `${config.clientUrl}/set-password?token=${raw}` };
  }
  return ctx;
}

async function processOne(n: any) {
  try {
    const ctx = await buildContext(n);
    if ('skip' in ctx) return void (await Notification.updateOne({ _id: n._id }, { status: 'skipped', lastError: ctx.skip }));
    if (!canSendMail()) return void (await Notification.updateOne({ _id: n._id }, { status: 'failed', $inc: { attempts: 1 }, lastError: 'SMTP is not configured. Set SMTP_* variables, then use Retry.' }));
    const mail = renderEmail(n.type, ctx);
    const { messageId } = await sendMail({ to: ctx.recipient.email, ...mail });
    await Notification.updateOne({ _id: n._id }, { status: 'sent', sentAt: new Date(), messageId, lastError: null, $inc: { attempts: 1 } });
  } catch (e: any) {
    const attempts = (n.attempts ?? 0) + 1;
    const final = attempts >= config.maxEmailAttempts;
    log.error(`Notification ${n._id} attempt ${attempts} failed`, e);
    await Notification.updateOne({ _id: n._id }, { status: final ? 'failed' : 'pending', attempts, lastError: String(e.message).slice(0, 300), nextAttemptAt: new Date(Date.now() + Math.min(2 ** attempts, 60) * 60_000) });
  }
}

export let lastTickAt: Date | null = null;
/** Claims due notifications one at a time (atomic), so several workers cannot double-send. */
export async function tick(now = new Date()) {
  lastTickAt = now;
  await Notification.updateMany({ status: 'processing', lockedAt: { $lt: new Date(now.getTime() - 5 * 60_000) } }, { status: 'pending' }); // recover after a crash
  let n = 0;
  while (n < 100) {
    const doc = await Notification.findOneAndUpdate(
      { status: 'pending', scheduledFor: { $lte: now }, $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }] },
      { status: 'processing', lockedAt: now }, { sort: { scheduledFor: 1 }, new: true });
    if (!doc) break;
    n++; await processOne(doc);
  }
  return n;
}
let timer: NodeJS.Timeout | null = null;
export function startWorker() {
  if (timer) return;
  const run = () => tick().catch((e) => log.error('worker tick failed', e));
  timer = setInterval(run, config.workerIntervalMs); timer.unref(); run();
}
export const stopWorker = () => { if (timer) clearInterval(timer); timer = null; };
