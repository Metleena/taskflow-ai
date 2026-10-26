import type { NOTIFICATION_TYPES } from './models.ts';
type NType = (typeof NOTIFICATION_TYPES)[number];

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const fmtDateTime = (d: Date | string, tz = 'UTC') => {
  try { return new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: tz, timeZoneName: 'short' }).format(new Date(d)); }
  catch { return new Date(d).toISOString(); }
};
export const fmtDate = (d: Date | string, tz = 'UTC') => {
  try { return new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: tz }).format(new Date(d)); } catch { return new Date(d).toISOString(); }
};

export interface MailCtx {
  recipient: { name: string; email: string; timeZone?: string };
  task?: any; employee?: any; manager?: any; meeting?: any; feedback?: any;
  extra?: Record<string, any>; appUrl: string;
}
type Section = { h?: string; p?: string; list?: string[]; rows?: [string, string][] };

const taskLink = (c: MailCtx) => `${c.appUrl}/tasks/${c.task?._id ?? c.task?.id}`;
const meetingRows = (m: any, tz: string): [string, string][] => m ? [
  ['Date and time', fmtDateTime(m.startsAt, m.timeZone || tz)], ['Time zone', m.timeZone || tz], ['Platform', m.platform], ['Meeting link', m.link],
] : [];
const common = (c: MailCtx): Section => ({
  rows: [
    ['Task', c.task?.title], ['Employee', c.employee?.name ?? c.recipient.name],
    ['Manager', c.manager ? `${c.manager.name} (${c.manager.email})` : '—'],
    ...(c.task?.deadline ? [['Deadline', fmtDateTime(c.task.deadline, c.recipient.timeZone)] as [string, string]] : []),
    ...(c.task?.status ? [['Status', c.task.status] as [string, string]] : []),
  ],
});

export function renderEmail(type: NType, c: MailCtx): { subject: string; html: string; text: string } {
  const tz = c.recipient.timeZone || 'UTC';
  const hi = `Hello ${c.recipient.name},`;
  const t = c.task; const x = c.extra ?? {};
  let subject = ''; let sections: Section[] = []; let cta: [string, string] | null = t ? ['Open task', taskLink(c)] : null;
  const report = c.feedback?.ai?.report;

  switch (type) {
    case 'account_created':
      subject = 'Your TaskFlow account is ready';
      sections = [{ p: `${hi} an account has been created for you on TaskFlow (${c.recipient.email}).` }, { p: 'Use the button below to choose your password. The link works once and expires in 48 hours.' }];
      cta = ['Set your password', x.setPasswordUrl]; break;
    case 'task_assigned': {
      const e = t.aiExplanation?.status === 'generated' ? t.aiExplanation : null;
      subject = `New task assigned: ${t.title}`;
      sections = [{ p: `${hi} ${c.manager?.name ?? 'Your manager'} has assigned you a new task.` }];
      if (e) sections.push({ h: 'What you need to do', p: e.summary }, { h: 'Why it matters', p: e.whyItMatters }, { h: 'How to approach it', list: e.steps }, { h: 'Expected output', p: e.expectedOutput }, { h: 'How your work will be evaluated', p: e.howItIsEvaluated });
      else sections.push({ h: 'Task description (from your manager)', p: t.description }, { p: 'A plain-language AI explanation was not available when this email was sent. Your manager’s original description is shown above.' }, { h: 'Expected deliverables', list: t.deliverables }, { h: 'Acceptance criteria', list: t.acceptanceCriteria });
      if (e?.clarifyingQuestions?.length) sections.push({ h: 'Worth clarifying with your manager', list: e.clarifyingQuestions });
      sections.push({ h: 'Dates', rows: [['Start date', fmtDate(t.startDate, tz)], ['Deadline', fmtDateTime(t.deadline, tz)], ['Priority', t.priority]] });
      if (c.meeting) sections.push({ h: 'First review meeting', rows: meetingRows(c.meeting, tz) });
      sections.push({ h: 'How to submit', p: 'Open the task in TaskFlow, then use “Submit work”. You can write an explanation, upload files (PDF, DOCX, XLSX, TXT, ZIP or source code) and add links. Drafts are saved until you submit.' }, { h: 'Manager contact', p: c.manager ? `${c.manager.name} — ${c.manager.email}` : '' });
      break; }
    case 'deadline_reminder':
      subject = `Deadline reminder: ${t.title}`;
      sections = [{ p: `${hi} this task is due in about ${x.offsetHours} hour(s).` }, common(c)]; break;
    case 'meeting_reminder':
      subject = `Review meeting reminder: ${t.title}`;
      sections = [{ p: `${hi} a review meeting starts in about ${x.offsetHours} hour(s).` }, { rows: [['Task', t.title], ...meetingRows(c.meeting, c.recipient.timeZone || 'UTC'), ['Current status', t.status]] },
        { h: 'Please prepare', list: ['Submit your latest work in TaskFlow before the meeting so the feedback report is ready.', 'Note any questions or blockers you want to discuss.'] }]; break;
    case 'submission_confirmation':
      subject = `Submission received: ${t.title}`;
      sections = [{ p: `${hi} we received version ${x.version} of your work.` }, { p: 'An AI analysis is prepared as advisory feedback. Your manager makes every approval decision.' }, common(c)]; break;
    case 'feedback_available':
      subject = `Feedback is ready: ${t.title}`;
      sections = [{ p: `${hi} an AI-generated feedback report is ready for version ${x.version}. It is advisory; your manager decides on approval.` }];
      if (report) sections.push({ h: `Progress estimate: ${report.progressPercent}%`, p: report.progressExplanation }, { h: 'Top corrections', list: (report.corrections ?? []).slice(0, 5) });
      break;
    case 'next_meeting': {
      subject = `Next review scheduled: ${t.title}`;
      sections = [{ p: `${hi} your manager scheduled the next review meeting.` }, { rows: meetingRows(c.meeting, tz) }];
      if (c.feedback?.managerComments) sections.push({ h: 'Comments from your manager', p: c.feedback.managerComments });
      if (report?.corrections?.length) sections.push({ h: 'What to correct before the meeting', list: report.corrections });
      sections.push(common(c)); break; }
    case 'meeting_changed': {
      const verb = ({ rescheduled: 'rescheduled', cancelled: 'cancelled', missed: 'marked as missed' } as any)[x.kind] ?? 'updated';
      subject = `Review meeting ${verb}: ${t.title}`;
      sections = [{ p: `${hi} the review meeting for “${t.title}” was ${verb}.` }];
      if (x.kind === 'rescheduled') sections.push({ h: 'New details', rows: meetingRows(c.meeting, tz) });
      if (x.reason) sections.push({ p: `Reason: ${x.reason}` });
      break; }
    case 'task_completed':
      subject = `Task completed: ${t.title}`;
      sections = [{ p: `${hi} “${t.title}” has been approved and marked completed by ${c.manager?.name ?? 'the manager'}.` }, { rows: [['Task', t.title], ['Employee', c.employee?.name ?? ''], ['Completed on', fmtDateTime(x.completedAt ?? new Date(), tz)], ['Review cycles', String(x.reviewCycles ?? '—')]] }];
      if (x.note) sections.push({ h: 'Closing note', p: x.note }); break;
  }

  const body = sections.map((s) => [
    s.h ? `<h3 style="margin:20px 0 6px;font-size:15px;color:#0f3d4c">${esc(s.h)}</h3>` : '',
    s.p ? `<p style="margin:6px 0;line-height:1.55">${esc(s.p).replace(/\n/g, '<br>')}</p>` : '',
    s.list?.length ? `<ul style="margin:6px 0;padding-left:20px;line-height:1.55">${s.list.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '',
    s.rows?.length ? `<table style="border-collapse:collapse;margin:6px 0">${s.rows.map(([k, v]) => `<tr><td style="padding:3px 14px 3px 0;color:#5b6b75">${esc(k)}</td><td style="padding:3px 0"><strong>${/^https?:\/\//.test(v) ? `<a href="${esc(v)}">${esc(v)}</a>` : esc(v)}</strong></td></tr>`).join('')}</table>` : '',
  ].join('')).join('');
  const html = `<!doctype html><html><body style="margin:0;background:#f3f6f8;font-family:Arial,Helvetica,sans-serif;color:#1c2b33"><div style="max-width:620px;margin:0 auto;padding:24px"><div style="background:#0f4c5c;color:#fff;padding:14px 20px;border-radius:6px 6px 0 0;font-weight:bold">TaskFlow</div><div style="background:#fff;padding:20px;border:1px solid #dde5ea;border-top:0;border-radius:0 0 6px 6px">${body}${cta?.[1] ? `<p style="margin:24px 0 8px"><a href="${esc(cta[1])}" style="background:#0f4c5c;color:#fff;padding:10px 18px;border-radius:5px;text-decoration:none;display:inline-block">${esc(cta[0])}</a></p>` : ''}</div><p style="color:#8a99a3;font-size:12px">You received this because of your role in TaskFlow.</p></div></body></html>`;
  const text = sections.map((s) => [s.h ? `${s.h}` : '', s.p ?? '', ...(s.list ?? []).map((i) => `- ${i}`), ...(s.rows ?? []).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join('\n')).join('\n\n') + (cta?.[1] ? `\n\n${cta[0]}: ${cta[1]}` : '');
  return { subject, html, text };
}
