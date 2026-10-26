// Pure business rules. No framework or database imports, so they are easy to test.
export const ROLES = ['admin', 'manager', 'employee'] as const;
export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
export const TASK_STATUSES = ['Assigned', 'In Progress', 'Submitted', 'Under Review', 'Changes Required', 'Approved', 'Completed', 'On Hold'] as const;
export type Role = (typeof ROLES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];

// "Overdue" is derived from the deadline, never stored.
export const CLOSED: readonly TaskStatus[] = ['Approved', 'Completed'];
export const EMPLOYEE_CAN_SUBMIT: readonly TaskStatus[] = ['Assigned', 'In Progress', 'Changes Required'];

const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  'Assigned': ['In Progress', 'Submitted', 'On Hold'],
  'In Progress': ['Submitted', 'On Hold'],
  'Submitted': ['Under Review', 'Changes Required', 'Approved', 'On Hold'],
  'Under Review': ['Changes Required', 'Approved', 'On Hold'],
  'Changes Required': ['In Progress', 'Submitted', 'On Hold'],
  'Approved': ['Completed', 'Changes Required'],
  'Completed': [],
  'On Hold': ['Assigned', 'In Progress'],
};
export const canTransition = (from: TaskStatus, to: TaskStatus) => TRANSITIONS[from]?.includes(to) ?? false;

export const isOverdue = (deadline: Date, status: TaskStatus, now = new Date()) =>
  deadline.getTime() < now.getTime() && !CLOSED.includes(status);

/** Only a manager's explicit "complete" action may finish a task, and only from Approved. */
export const canComplete = (status: TaskStatus) => status === 'Approved';

export const isHttpUrl = (s: string) => {
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
};

/** Reminder instants (future only, de-duplicated, latest-first) for an event. */
export function reminderSchedule(eventAt: Date, hoursBefore: number[], now = new Date()) {
  const uniq = [...new Set(hoursBefore.filter((h) => Number.isFinite(h) && h > 0))].sort((a, b) => b - a);
  return uniq
    .map((h) => ({ offsetHours: h, at: new Date(eventAt.getTime() - h * 3600_000) }))
    .filter((r) => r.at.getTime() > now.getTime());
}

/** Idempotency key: the same logical notification always yields the same key. */
export const makeKey = (...parts: (string | number)[]) => parts.map(String).join(':');

/** A meeting needs a real future time and an http(s) link supplied by a person (never invented). */
export function validateMeeting(m: { startsAt?: Date | string | null; link?: string | null }, now = new Date()): string[] {
  const errors: string[] = [];
  const t = m.startsAt ? new Date(m.startsAt).getTime() : NaN;
  if (!Number.isFinite(t)) errors.push('A valid meeting date and time is required.');
  else if (t <= now.getTime()) errors.push('The meeting must be scheduled in the future.');
  if (!m.link || !isHttpUrl(m.link)) errors.push('A valid meeting link (http or https) is required.');
  return errors;
}

export type Decision = 'approved' | 'changes_required';
/** Review rules: "changes required" must schedule the next review; approval never auto-completes. */
export function reviewPlan(decision: Decision, nextMeeting: { startsAt?: any; link?: string | null } | undefined, now = new Date()) {
  if (decision === 'approved') return { errors: [] as string[], nextStatus: 'Approved' as TaskStatus };
  const errors = nextMeeting ? validateMeeting(nextMeeting, now) : ['Changes required: schedule the next review meeting (date, time and link).'];
  return { errors, nextStatus: 'Changes Required' as TaskStatus };
}
