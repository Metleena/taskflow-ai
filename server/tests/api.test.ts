import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import fs from 'node:fs/promises';

process.env.SMTP_HOST = 'test'; process.env.SMTP_FROM = 'TaskFlow <test@example.com>';
const { createApp } = await import('../src/app.ts');
const M = await import('../src/models.ts');
const { hashPassword } = await import('../src/auth.ts');
const { __setTransportForTests } = await import('../src/mailer.ts');
const { tick } = await import('../src/notifications.ts');
const { afterTaskCreated } = await import('../src/services.ts');

const PW = 'Test-Password-123';
let mongod: MongoMemoryServer; const app = createApp();
const sent: any[] = []; let failNext = 0;
const futureISO = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const meeting = (h = 48) => ({ startsAt: futureISO(h), timeZone: 'Asia/Kolkata', platform: 'Google Meet', link: 'https://meet.example.com/abc' });
let admin: any, mgr: any, mgr2: any, emp: any, emp2: any;

async function login(email: string) { const a = request.agent(app); await a.post('/api/auth/login').send({ email, password: PW }).expect(200); return a; }
const taskPayload = (ids: string[]) => ({ title: 'Build report', description: 'Create the monthly sales report.', assigneeIds: ids, startDate: futureISO(-24), deadline: futureISO(24 * 10), priority: 'High', deliverables: ['XLSX file'], acceptanceCriteria: ['Totals match finance'], meeting: meeting() });
async function createTask(m: any, ids: string[]) { const r = await m.post('/api/tasks').send(taskPayload(ids)).expect(201); return r.body.items[0]; }
const waitFor = async (fn: () => Promise<boolean>) => { for (let i = 0; i < 50; i++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timeout'); };

beforeAll(async () => {
  mongod = await MongoMemoryServer.create(); await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  __setTransportForTests({ sendMail: async (m: any) => { if (failNext > 0) { failNext--; throw new Error('SMTP down'); } sent.push(m); return { messageId: `id-${sent.length}`, rejected: [] }; } });
});
afterAll(async () => { await mongoose.disconnect(); await mongod.stop(); await fs.rm('.test-uploads', { recursive: true, force: true }); });
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.models).map((m) => m.deleteMany({}))); sent.length = 0; failNext = 0;
  const passwordHash = await hashPassword(PW); const mk = (name: string, role: string, manager?: any) => M.User.create({ name, email: `${name.toLowerCase().replace(/\s/g, '.')}@t.test`, role, department: 'Eng', manager, passwordHash });
  admin = await mk('Ada Admin', 'admin'); mgr = await mk('Mia Manager', 'manager'); mgr2 = await mk('Max Manager', 'manager');
  emp = await mk('Eli Employee', 'employee', mgr._id); emp2 = await mk('Eve Employee', 'employee', mgr._id);
});

describe('authentication & authorization', () => {
  it('rejects bad credentials and unauthenticated access', async () => {
    await request(app).post('/api/auth/login').send({ email: emp.email, password: 'wrong-password' }).expect(401);
    await request(app).get('/api/tasks').expect(401);
  });
  it('enforces roles', async () => {
    const e = await login(emp.email);
    await e.post('/api/tasks').send(taskPayload([emp.id])).expect(403);
    await e.get('/api/admin/reports').expect(403);
    await e.post('/api/users').send({ name: 'X', email: 'x@t.test', role: 'admin' }).expect(403);
  });
  it('hides tasks from other employees and managers (404, not 403)', async () => {
    const m = await login(mgr.email); const t = await createTask(m, [emp.id]);
    await (await login(emp2.email)).get(`/api/tasks/${t._id}`).expect(404);
    await (await login(mgr2.email)).get(`/api/tasks/${t._id}`).expect(404);
    await (await login(emp.email)).get(`/api/tasks/${t._id}`).expect(200);
  });
});

describe('task assignment', () => {
  it('validates input and refuses invented/invalid meetings', async () => {
    const m = await login(mgr.email);
    await m.post('/api/tasks').send({ ...taskPayload([emp.id]), meeting: { ...meeting(), link: 'not-a-link' } }).expect(400);
    await m.post('/api/tasks').send({ ...taskPayload([emp.id]), meeting: { ...meeting(-5) } }).expect(400);
    await m.post('/api/tasks').send({ ...taskPayload([emp.id]), deadline: futureISO(-100) }).expect(400);
  });
  it('managers cannot assign to employees outside their team', async () => {
    await (await login(mgr2.email)).post('/api/tasks').send(taskPayload([emp.id])).expect(400);
  });
  it('creates one task per employee and queues exactly one assignment email each, with honest AI status', async () => {
    const m = await login(mgr.email);
    const r = await m.post('/api/tasks').send(taskPayload([emp.id, emp2.id])).expect(201);
    expect(r.body.items).toHaveLength(2);
    await waitFor(async () => (await M.Notification.countDocuments({ type: 'task_assigned' })) === 2);
    await afterTaskCreated(r.body.items[0]._id, (await M.Meeting.findOne({ task: r.body.items[0]._id }))!.id); // re-run: must not duplicate
    expect(await M.Notification.countDocuments({ type: 'task_assigned' })).toBe(2);
    const t: any = await M.Task.findById(r.body.items[0]._id);
    expect(t.aiExplanation.status).toBe('unavailable'); // no API key in tests: nothing is faked
    await tick(); const mail = sent.find((s) => s.to === emp.email && /New task assigned/.test(s.subject));
    expect(mail.text).toContain('https://meet.example.com/abc'); expect(mail.text).toContain('Mia Manager');
  });
});

describe('email delivery', () => {
  it('records failures, retries with backoff, and only reports sent when delivered', async () => {
    const m = await login(mgr.email); await createTask(m, [emp.id]);
    await waitFor(async () => (await M.Notification.countDocuments({ type: 'task_assigned' })) === 1);
    failNext = 1; await tick();
    let n: any = await M.Notification.findOne({ type: 'task_assigned' });
    expect(n.status).toBe('pending'); expect(n.attempts).toBe(1); expect(n.lastError).toContain('SMTP down'); expect(sent).toHaveLength(0);
    await tick(new Date(Date.now() + 3 * 60_000)); // after the backoff window
    n = await M.Notification.findOne({ type: 'task_assigned' });
    expect(n.status).toBe('sent'); expect(n.messageId).toBeTruthy();
  });
  it('does not send twice when ticks overlap', async () => {
    const m = await login(mgr.email); await createTask(m, [emp.id]);
    await waitFor(async () => (await M.Notification.countDocuments({ type: 'task_assigned' })) === 1);
    await Promise.all([tick(), tick()]);
    expect(sent.filter((s) => /New task assigned/.test(s.subject))).toHaveLength(1);
  });
});

describe('submission → feedback → review → completion', () => {
  async function submitted() {
    const m = await login(mgr.email); const e = await login(emp.email); const t = await createTask(m, [emp.id]);
    const r = await e.post(`/api/tasks/${t._id}/submissions`).field('explanation', 'I built the XLSX report with totals.').field('links', JSON.stringify(['https://github.com/a/b'])).attach('files', Buffer.from('a,b\n1,2'), 'data.csv').expect(201);
    return { m, e, t, fbId: r.body.feedbackId as string };
  }
  it('validates files and keeps version history', async () => {
    const m = await login(mgr.email); const e = await login(emp.email); const t = await createTask(m, [emp.id]);
    await e.post(`/api/tasks/${t._id}/submissions`).field('explanation', 'x'.repeat(20)).attach('files', Buffer.from('MZ'), 'run.exe').expect(400);
    await e.post(`/api/tasks/${t._id}/submissions`).field('explanation', 'x'.repeat(20)).attach('files', Buffer.from('not a pdf'), 'fake.pdf').expect(400);
    await e.post(`/api/tasks/${t._id}/submissions`).field('explanation', 'short').expect(400);
    await e.post(`/api/tasks/${t._id}/submissions`).field('explanation', 'x'.repeat(20)).field('links', JSON.stringify(['javascript:alert(1)'])).expect(400);
    await e.post(`/api/tasks/${t._id}/submissions`).field('explanation', 'first version of the work').expect(201);
    await e.post(`/api/tasks/${t._id}/submissions`).field('explanation', 'second attempt').expect(409); // still awaiting review
    expect((await M.Task.findById(t._id))!.status).toBe('Submitted');
  });
  it('saves drafts without changing status', async () => {
    const m = await login(mgr.email); const e = await login(emp.email); const t = await createTask(m, [emp.id]);
    await e.post(`/api/tasks/${t._id}/submissions`).field('draft', 'true').field('explanation', 'wip').expect(200);
    expect((await M.Task.findById(t._id))!.status).toBe('Assigned');
    expect((await login(mgr.email).then((a) => a.get(`/api/tasks/${t._id}`))).body.submissions).toHaveLength(0); // drafts are private
  });
  it('without an AI key the feedback is marked unavailable, never faked', async () => {
    const { fbId } = await submitted();
    await waitFor(async () => (await M.Feedback.findById(fbId))!.ai!.status === 'unavailable');
    expect((await M.Notification.countDocuments({ type: 'feedback_available' }))).toBe(0);
  });
  it('protects uploaded files', async () => {
    const { t, e } = await submitted(); const sub: any = await M.Submission.findOne({ task: t._id });
    const url = `/api/submissions/${sub.id}/files/${sub.files[0].storedName}`;
    await e.get(url).expect(200);
    await (await login(emp2.email)).get(url).expect(404);
    await request(app).get(url).expect(401);
  });
  it('requires a valid next meeting when changes are required, then emails feedback + meeting', async () => {
    const { m, fbId, t } = await submitted();
    await m.post(`/api/feedback/${fbId}/review`).send({ decision: 'changes_required', managerComments: 'Add totals' }).expect(400);
    await m.post(`/api/feedback/${fbId}/review`).send({ decision: 'changes_required', nextMeeting: { ...meeting(-2) } }).expect(400);
    const r = await m.post(`/api/feedback/${fbId}/review`).send({ decision: 'changes_required', managerComments: 'Add totals', nextMeeting: meeting(72) }).expect(200);
    expect(r.body.task.status).toBe('Changes Required');
    await m.post(`/api/feedback/${fbId}/review`).send({ decision: 'approved' }).expect(409); // one decision per submission
    await tick(); const mail = sent.find((s) => /Next review scheduled/.test(s.subject));
    expect(mail.text).toContain('Add totals'); expect(mail.text).toContain('https://meet.example.com/abc');
    expect(await M.Meeting.countDocuments({ task: t._id, status: 'scheduled' })).toBe(2);
  });
  it('never completes a task without manager approval, then completes with confirmation', async () => {
    const { m, e, t, fbId } = await submitted();
    await m.post(`/api/tasks/${t._id}/complete`).send({}).expect(409);
    await e.post(`/api/tasks/${t._id}/complete`).send({}).expect(403);
    await e.post(`/api/feedback/${fbId}/review`).send({ decision: 'approved' }).expect(403);
    await m.post(`/api/feedback/${fbId}/review`).send({ decision: 'approved', managerComments: 'Great' }).expect(200);
    expect((await M.Task.findById(t._id))!.status).toBe('Approved');
    await m.post(`/api/tasks/${t._id}/complete`).send({ note: 'Well done' }).expect(200);
    const done: any = await M.Task.findById(t._id); expect(done.status).toBe('Completed'); expect(String(done.finalApproval.by)).toBe(mgr.id);
    await tick(); expect(sent.filter((s) => /Task completed/.test(s.subject)).map((s) => s.to).sort()).toEqual([emp.email, mgr.email].sort());
    await m.post(`/api/tasks/${t._id}/complete`).send({}).expect(409);
  });
});

describe('meeting management', () => {
  it('reschedule replaces reminders; cancelled meetings are not reminded; participants are notified', async () => {
    const m = await login(mgr.email); const t = await createTask(m, [emp.id]);
    await waitFor(async () => (await M.Notification.countDocuments({ type: 'meeting_reminder' })) === 4);
    const mt: any = await M.Meeting.findOne({ task: t._id });
    const before = await M.Notification.countDocuments({ type: 'meeting_reminder', status: 'pending' });
    expect(before).toBe(4); // 24h + 1h, for employee and manager
    await m.patch(`/api/meetings/${mt.id}`).send({ action: 'reschedule', startsAt: futureISO(100), reason: 'Clash' }).expect(200);
    expect(await M.Notification.countDocuments({ type: 'meeting_reminder', status: 'skipped' })).toBe(4);
    expect(await M.Notification.countDocuments({ type: 'meeting_reminder', status: 'pending' })).toBe(4);
    await m.patch(`/api/meetings/${mt.id}`).send({ action: 'reschedule', startsAt: futureISO(-1) }).expect(400);
    await m.patch(`/api/meetings/${mt.id}`).send({ action: 'cancel' }).expect(200);
    expect(await M.Notification.countDocuments({ type: 'meeting_reminder', status: 'pending' })).toBe(0);
    expect(await M.Notification.countDocuments({ type: 'meeting_changed' })).toBe(4); // (rescheduled + cancelled) x (employee + manager)
    await m.patch(`/api/meetings/${mt.id}`).send({ action: 'cancel' }).expect(409);
  });
});

describe('admin', () => {
  it('creates users, queues an invite and lets the user set a password', async () => {
    const a = await login(admin.email);
    await a.post('/api/users').send({ name: 'New Hire', email: 'new@t.test', role: 'employee', manager: mgr.id }).expect(201);
    await tick(); const mail = sent.find((s) => /account is ready/.test(s.subject));
    const token = /token=([a-f0-9]+)/.exec(mail.text)![1];
    await request(app).post('/api/auth/set-password').send({ token, password: 'short' }).expect(400);
    await request(app).post('/api/auth/set-password').send({ token, password: 'Brand-New-Pass-9' }).expect(200);
    await request(app).post('/api/auth/set-password').send({ token, password: 'Another-Pass-99' }).expect(400); // single use
    await request(app).post('/api/auth/login').send({ email: 'new@t.test', password: 'Brand-New-Pass-9' }).expect(200);
  });
});
