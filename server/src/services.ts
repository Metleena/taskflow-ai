import fs from 'node:fs/promises';
import path from 'node:path';
import { config, aiConfigured } from './config.ts';
import { Task, Submission, Feedback, Meeting, User } from './models.ts';
import { structured, explanationSchema, analysisSchema, EXPLAIN_SYSTEM, ANALYSE_SYSTEM, AiUnavailable } from './ai.ts';
import { enqueue, skipPending } from './notifications.ts';
import { reminderSchedule, makeKey } from './domain/workflow.ts';
import { log } from './util.ts';

export const TEXT_EXT = ['.txt', '.md', '.csv', '.json', '.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.cpp', '.cs', '.go', '.rb', '.php', '.html', '.css', '.sql', '.sh', '.yml', '.yaml'];
export const BINARY_EXT = ['.pdf', '.docx', '.xlsx', '.zip'];
export const ALLOWED_EXT = [...TEXT_EXT, ...BINARY_EXT];

const taskBlock = (t: any) => `<task>
Title: ${t.title}
Description: ${t.description}
Deliverables: ${(t.deliverables ?? []).join('; ')}
Acceptance criteria: ${(t.acceptanceCriteria ?? []).join('; ')}
Priority: ${t.priority}. Start: ${t.startDate.toISOString()}. Deadline: ${t.deadline.toISOString()}.
</task>`;

export async function generateExplanation(taskId: any) {
  const task: any = await Task.findById(taskId);
  if (!task) return;
  if (!aiConfigured()) { task.aiExplanation = { status: 'unavailable', error: 'AI is not configured (set ANTHROPIC_API_KEY).' }; return void (await task.save()); }
  try {
    const out = await structured(explanationSchema, EXPLAIN_SYSTEM, taskBlock(task), 2500);
    task.aiExplanation = { ...out, status: 'generated', model: config.ai.model, generatedAt: new Date() };
  } catch (e: any) {
    log.error('explanation failed', e);
    task.aiExplanation = { status: e instanceof AiUnavailable ? 'unavailable' : 'failed', error: String(e.message).slice(0, 300) };
  }
  await task.save();
}

export async function analyseSubmission(feedbackId: any) {
  const fb: any = await Feedback.findById(feedbackId);
  if (!fb) return;
  const [sub, task]: any[] = await Promise.all([Submission.findById(fb.submission), Task.findById(fb.task)]);
  if (!aiConfigured()) { fb.ai = { status: 'unavailable', error: 'AI is not configured. The manager must review this submission manually.' }; return void (await fb.save()); }
  fb.ai = { status: 'pending' }; await fb.save();
  const notRead: string[] = []; const parts: string[] = []; let budget = 60_000;
  for (const f of sub.files) {
    const ext = path.extname(f.originalName).toLowerCase();
    if (TEXT_EXT.includes(ext) && budget > 0) {
      const raw = (await fs.readFile(path.resolve(config.uploadDir, f.storedName), 'utf8').catch(() => '')).slice(0, Math.min(20_000, budget));
      budget -= raw.length; parts.push(`<file name="${f.originalName}">\n${raw}\n</file>`);
    } else notRead.push(`${f.originalName} (${ext || 'unknown'} content was not extracted)`);
  }
  const prev: any[] = await Feedback.find({ task: task._id, _id: { $ne: fb._id } }).sort({ createdAt: -1 }).limit(2);
  const prevText = prev.map((p) => `Earlier feedback: AI corrections: ${(p.ai?.report?.corrections ?? []).join('; ')}. Manager comments: ${p.managerComments ?? 'none'}. Decision: ${p.decision}.`).join('\n');
  const prompt = `${taskBlock(task)}\n${prevText ? `<previous_feedback>\n${prevText}\n</previous_feedback>\n` : ''}<submission version="${sub.version}">
Written explanation: ${sub.explanation}
Difficulties reported: ${sub.difficulties || 'none'}
Links (not opened by the system): ${sub.links.join(', ') || 'none'}
Files not readable by the system: ${notRead.join('; ') || 'none'}
</submission>\n${parts.join('\n')}`;
  try {
    const report: any = await structured(analysisSchema, ANALYSE_SYSTEM, prompt, 5000);
    if (notRead.length || sub.links.length) { report.requiresManagerReview = true; report.limitations = [...new Set([...report.limitations, ...(notRead.length ? [`Could not read: ${notRead.join(', ')}`] : []), ...(sub.links.length ? ['Submitted links were not opened or checked.'] : [])])]; }
    fb.ai = { status: 'completed', report, model: config.ai.model, generatedAt: new Date(), filesNotRead: notRead };
    await fb.save();
    await enqueue({ key: makeKey('feedback_available', fb.id), type: 'feedback_available', recipient: task.assignee, task: task._id, manager: task.manager, payload: { feedbackId: fb.id, version: sub.version } });
  } catch (e: any) {
    log.error('analysis failed', e);
    fb.ai = { status: 'failed', error: String(e.message).slice(0, 300), filesNotRead: notRead }; await fb.save();
  }
}

export async function scheduleMeetingReminders(meeting: any) {
  const recipients = [...new Set([...meeting.participants.map(String), String(meeting.manager)])];
  const hours = meeting.reminderHours?.length ? meeting.reminderHours : config.meetingReminderHours;
  for (const r of reminderSchedule(meeting.startsAt, hours))
    for (const rid of recipients)
      await enqueue({ key: makeKey('meeting_reminder', meeting.id, meeting.startsAt.getTime(), r.offsetHours, rid), type: 'meeting_reminder', recipient: rid, task: meeting.task, meeting: meeting._id, scheduledFor: r.at, payload: { startsAtMs: meeting.startsAt.getTime(), offsetHours: r.offsetHours } });
}
export const cancelMeetingReminders = (meetingId: any, reason: string) => skipPending({ meeting: meetingId, type: 'meeting_reminder' }, reason);

export async function scheduleDeadlineReminders(task: any) {
  for (const r of reminderSchedule(task.deadline, config.deadlineReminderHours))
    await enqueue({ key: makeKey('deadline_reminder', task.id, task.deadline.getTime(), r.offsetHours), type: 'deadline_reminder', recipient: task.assignee, task: task._id, manager: task.manager, scheduledFor: r.at, payload: { deadlineMs: task.deadline.getTime(), offsetHours: r.offsetHours } });
}

/** Runs after the HTTP response: explanation → assignment email → reminders. Never blocks on AI. */
export async function afterTaskCreated(taskId: any, meetingId: any) {
  try {
    await generateExplanation(taskId);
    const task: any = await Task.findById(taskId); const meeting: any = await Meeting.findById(meetingId);
    await enqueue({ key: makeKey('task_assigned', task.id), type: 'task_assigned', recipient: task.assignee, task: task._id, meeting: meeting?._id, manager: task.manager });
    await scheduleDeadlineReminders(task);
    if (meeting) await scheduleMeetingReminders(meeting);
  } catch (e) { log.error('afterTaskCreated failed', e); }
}
export const userById = (id: any) => User.findById(id);
