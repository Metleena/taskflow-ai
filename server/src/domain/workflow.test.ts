import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, isOverdue, canComplete, reminderSchedule, makeKey, validateMeeting, reviewPlan, isHttpUrl } from './workflow.ts';

const now = new Date('2026-01-10T10:00:00Z');
const inHours = (h: number) => new Date(now.getTime() + h * 3600_000);

test('status transitions', () => {
  assert.equal(canTransition('Assigned', 'In Progress'), true);
  assert.equal(canTransition('Submitted', 'Completed'), false, 'cannot skip approval');
  assert.equal(canTransition('Under Review', 'Completed'), false);
  assert.equal(canTransition('Approved', 'Completed'), true);
  assert.equal(canTransition('Completed', 'In Progress'), false, 'completed is final');
});
test('completion only from Approved', () => {
  assert.equal(canComplete('Approved'), true);
  for (const s of ['Assigned', 'In Progress', 'Submitted', 'Under Review', 'Changes Required', 'On Hold', 'Completed'] as const)
    assert.equal(canComplete(s), false, s);
});
test('overdue is derived and ignores closed tasks', () => {
  assert.equal(isOverdue(inHours(-1), 'In Progress', now), true);
  assert.equal(isOverdue(inHours(1), 'In Progress', now), false);
  assert.equal(isOverdue(inHours(-1), 'Approved', now), false);
  assert.equal(isOverdue(inHours(-1), 'Completed', now), false);
});
test('reminders: future only, unique, latest first', () => {
  const r = reminderSchedule(inHours(2), [24, 1, 1, 0, -5], now);
  assert.deepEqual(r.map((x) => x.offsetHours), [1], '24h reminder is already in the past');
  const r2 = reminderSchedule(inHours(48), [1, 24, 24], now);
  assert.deepEqual(r2.map((x) => x.offsetHours), [24, 1]);
  assert.equal(r2[0].at.getTime(), inHours(24).getTime());
});
test('idempotency keys are stable and sensitive to rescheduling', () => {
  assert.equal(makeKey('meeting_reminder', 'm1', 1000, 24, 'u1'), makeKey('meeting_reminder', 'm1', 1000, 24, 'u1'));
  assert.notEqual(makeKey('meeting_reminder', 'm1', 1000, 24, 'u1'), makeKey('meeting_reminder', 'm1', 2000, 24, 'u1'));
});
test('meeting validation requires future time and real link', () => {
  assert.deepEqual(validateMeeting({ startsAt: inHours(5), link: 'https://meet.example.com/abc' }, now), []);
  assert.equal(validateMeeting({ startsAt: inHours(-5), link: 'https://x.io' }, now).length, 1);
  assert.equal(validateMeeting({ startsAt: inHours(5), link: '' }, now).length, 1);
  assert.equal(validateMeeting({ startsAt: inHours(5), link: 'javascript:alert(1)' }, now).length, 1);
  assert.equal(validateMeeting({}, now).length, 2);
});
test('review plan', () => {
  assert.equal(reviewPlan('approved', undefined, now).nextStatus, 'Approved');
  assert.ok(reviewPlan('changes_required', undefined, now).errors.length > 0);
  assert.ok(reviewPlan('changes_required', { startsAt: inHours(-1), link: 'https://a.b' }, now).errors.length > 0);
  const ok = reviewPlan('changes_required', { startsAt: inHours(24), link: 'https://a.b/c' }, now);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.nextStatus, 'Changes Required');
});
test('url check', () => { assert.equal(isHttpUrl('https://github.com/a/b'), true); assert.equal(isHttpUrl('ftp://x'), false); assert.equal(isHttpUrl('nope'), false); });
