import mongoose, { Schema } from 'mongoose';
import { ROLES, PRIORITIES, TASK_STATUSES } from './domain/workflow.ts';

const ref = (to: string, extra: object = {}) => ({ type: Schema.Types.ObjectId, ref: to, ...extra });
const opts = { timestamps: true };

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, select: false },
  role: { type: String, enum: ROLES, required: true },
  department: { type: String, trim: true, index: true },
  manager: ref('User', { index: true }),
  status: { type: String, enum: ['active', 'disabled'], default: 'active' },
  timeZone: { type: String, default: 'UTC' },
  resetTokenHash: { type: String, select: false },
  resetTokenExpires: { type: Date, select: false },
}, opts);
export const User = mongoose.model('User', userSchema);

const explanationSchema = new Schema({
  status: { type: String, enum: ['pending', 'generated', 'unavailable', 'failed'], default: 'pending' },
  error: String, model: String, generatedAt: Date,
  summary: String, whyItMatters: String, steps: [String], expectedOutput: String,
  howItIsEvaluated: String, deadlinesAndConstraints: String, clarifyingQuestions: [String],
}, { _id: false });

const taskSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, required: true, maxlength: 20000 },
  aiExplanation: { type: explanationSchema, default: () => ({}) },
  assignee: ref('User', { required: true, index: true }),
  manager: ref('User', { required: true, index: true }),
  createdBy: ref('User', { required: true }),
  groupId: { type: String, index: true }, // tasks created together for several employees share a groupId
  department: { type: String, index: true },
  startDate: { type: Date, required: true },
  deadline: { type: Date, required: true, index: true },
  priority: { type: String, enum: PRIORITIES, default: 'Medium' },
  deliverables: [String],
  acceptanceCriteria: [String],
  referenceLinks: [String],
  status: { type: String, enum: TASK_STATUSES, default: 'Assigned', index: true },
  finalApproval: { by: ref('User'), at: Date, note: String },
}, opts);
taskSchema.index({ title: 'text' });
export const Task = mongoose.model('Task', taskSchema);

const fileSchema = new Schema({ originalName: String, storedName: String, size: Number, mime: String }, { _id: false });
const submissionSchema = new Schema({
  task: ref('Task', { required: true, index: true }),
  employee: ref('User', { required: true, index: true }),
  status: { type: String, enum: ['draft', 'submitted'], default: 'draft' },
  version: { type: Number, default: 0 },
  explanation: { type: String, default: '', maxlength: 20000 },
  difficulties: { type: String, default: '', maxlength: 5000 },
  files: [fileSchema],
  links: [String],
  submittedAt: Date,
}, opts);
export const Submission = mongoose.model('Submission', submissionSchema);

const feedbackSchema = new Schema({
  task: ref('Task', { required: true, index: true }),
  submission: ref('Submission', { required: true, index: true }),
  ai: {
    status: { type: String, enum: ['pending', 'completed', 'unavailable', 'failed', 'sample'], default: 'pending' },
    error: String, model: String, generatedAt: Date,
    report: Schema.Types.Mixed,
    filesNotRead: [String],
  },
  managerComments: { type: String, maxlength: 10000 },
  decision: { type: String, enum: ['none', 'approved', 'changes_required'], default: 'none' },
  decidedBy: ref('User'), decidedAt: Date,
}, opts);
export const Feedback = mongoose.model('Feedback', feedbackSchema);

const meetingSchema = new Schema({
  task: ref('Task', { required: true, index: true }),
  participants: [ref('User')],
  manager: ref('User', { required: true, index: true }),
  startsAt: { type: Date, required: true, index: true },
  timeZone: { type: String, default: 'UTC' },
  platform: { type: String, default: 'Online' },
  link: { type: String, required: true },
  reminderHours: [Number],
  status: { type: String, enum: ['scheduled', 'completed', 'cancelled', 'missed'], default: 'scheduled', index: true },
  rescheduleCount: { type: Number, default: 0 },
  outcome: String,
  nextMeeting: ref('Meeting'),
}, opts);
export const Meeting = mongoose.model('Meeting', meetingSchema);

export const NOTIFICATION_TYPES = ['account_created', 'task_assigned', 'deadline_reminder', 'meeting_reminder', 'submission_confirmation', 'feedback_available', 'next_meeting', 'meeting_changed', 'task_completed'] as const;
const notificationSchema = new Schema({
  recipient: ref('User', { required: true, index: true }),
  task: ref('Task', { index: true }),
  meeting: ref('Meeting'),
  manager: ref('User', { index: true }),
  type: { type: String, enum: NOTIFICATION_TYPES, required: true },
  key: { type: String, required: true, unique: true }, // idempotency key
  scheduledFor: { type: Date, required: true },
  nextAttemptAt: Date,
  lockedAt: Date,
  status: { type: String, enum: ['pending', 'processing', 'sent', 'failed', 'skipped'], default: 'pending', index: true },
  attempts: { type: Number, default: 0 },
  lastError: String, sentAt: Date, messageId: String,
  payload: Schema.Types.Mixed,
}, opts);
notificationSchema.index({ status: 1, scheduledFor: 1 });
export const Notification = mongoose.model('Notification', notificationSchema);

const auditSchema = new Schema({
  actor: ref('User'), action: { type: String, required: true }, entity: String, entityId: String, meta: Schema.Types.Mixed,
}, opts);
auditSchema.index({ createdAt: -1 });
export const AuditLog = mongoose.model('AuditLog', auditSchema);
