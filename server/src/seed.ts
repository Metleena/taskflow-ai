// Demo data. Run with: npm run seed   (WARNING: wipes the collections it touches)
import mongoose from 'mongoose';
import { config, assertConfig } from './config.ts';
import { User, Task, Submission, Feedback, Meeting, Notification, AuditLog } from './models.ts';
import { hashPassword } from './auth.ts';

assertConfig();
await mongoose.connect(config.mongoUri);
if (config.env === 'production') throw new Error('Refusing to seed in production.');
await Promise.all([User, Task, Submission, Feedback, Meeting, Notification, AuditLog].map((m) => m.deleteMany({})));

const password = process.env.SEED_PASSWORD || 'Demo-Password-2026';
const passwordHash = await hashPassword(password);
const mk = (name: string, email: string, role: string, department: string, manager?: any) =>
  User.create({ name, email, role, department, manager, passwordHash, timeZone: 'Asia/Kolkata' }) as Promise<any>;

const admin = await mk('Aditi Rao', 'admin@demo.test', 'admin', 'Administration');
const m1 = await mk('Vikram Shah', 'vikram.manager@demo.test', 'manager', 'Engineering');
const m2 = await mk('Neha Iyer', 'neha.manager@demo.test', 'manager', 'Marketing');
const e1 = await mk('Ravi Kumar', 'ravi@demo.test', 'employee', 'Engineering', m1._id);
const e2 = await mk('Priya Menon', 'priya@demo.test', 'employee', 'Engineering', m1._id);
const e3 = await mk('Arjun Das', 'arjun@demo.test', 'employee', 'Marketing', m2._id);
const day = 86400_000; const now = Date.now();
const mkTask = (o: any) => Task.create({ createdBy: o.manager, startDate: new Date(now - 5 * day), priority: 'Medium', ...o, aiExplanation: { status: 'unavailable', error: 'Sample data: no AI explanation was generated.' } }) as Promise<any>;

const t1 = await mkTask({ title: 'Build the customer feedback API', description: 'Create a REST endpoint that stores customer feedback and returns a list with pagination.', assignee: e1._id, manager: m1._id, department: 'Engineering', deadline: new Date(now + 6 * day), priority: 'High', status: 'Changes Required', deliverables: ['Source code in a Git repository', 'README with setup steps'], acceptanceCriteria: ['POST and GET endpoints work', 'Input is validated', 'Pagination supported'] });
const t2 = await mkTask({ title: 'Quarterly campaign performance report', description: 'Summarise Q3 campaign results with a chart per channel.', assignee: e3._id, manager: m2._id, department: 'Marketing', deadline: new Date(now - 2 * day), priority: 'Critical', status: 'In Progress', deliverables: ['XLSX workbook', 'One-page summary'], acceptanceCriteria: ['Every channel has a chart', 'Totals reconcile with finance'] });
await mkTask({ title: 'Update onboarding checklist', description: 'Review the onboarding checklist and update outdated steps.', assignee: e2._id, manager: m1._id, department: 'Engineering', deadline: new Date(now + 14 * day), priority: 'Low', status: 'Assigned', deliverables: ['Updated checklist document'], acceptanceCriteria: ['Outdated steps removed', 'New tools listed'] });

const past = await Meeting.create({ task: t1._id, participants: [e1._id], manager: m1._id, startsAt: new Date(now - 1 * day), timeZone: 'Asia/Kolkata', platform: 'Google Meet', link: 'https://meet.example.com/demo-review-1', status: 'completed', outcome: 'Validation and pagination still missing.' });
const next = await Meeting.create({ task: t1._id, participants: [e1._id], manager: m1._id, startsAt: new Date(now + 2 * day), timeZone: 'Asia/Kolkata', platform: 'Google Meet', link: 'https://meet.example.com/demo-review-2' });
past.nextMeeting = next._id; await past.save();
await Meeting.create({ task: t2._id, participants: [e3._id], manager: m2._id, startsAt: new Date(now + 1 * day), timeZone: 'Asia/Kolkata', platform: 'Zoom', link: 'https://zoom.example.com/j/demo' });

const sub = await Submission.create({ task: t1._id, employee: e1._id, status: 'submitted', version: 1, submittedAt: new Date(now - 2 * day), explanation: 'POST /feedback saves an entry. GET /feedback returns all entries.', difficulties: 'Unsure how to handle pagination.', links: ['https://github.com/example/feedback-api'] });
await Feedback.create({ task: t1._id, submission: sub._id, decision: 'changes_required', decidedBy: m1._id, decidedAt: new Date(now - 1 * day), managerComments: 'Good start. Please add validation and pagination before the next review.',
  ai: { status: 'sample', model: 'sample-data', generatedAt: new Date(now - 2 * day), report: {
    taskUnderstanding: 'Sample data (not AI-generated): build a validated, paginated feedback API.', submissionSummary: 'POST and GET endpoints exist.',
    completed: [{ requirement: 'POST endpoint works', note: 'Described in the explanation.' }], partial: [], missing: [{ requirement: 'Input is validated', note: 'No validation is mentioned.' }, { requirement: 'Pagination supported', note: 'GET returns all entries.' }],
    mistakes: [], corrections: ['Validate required fields on POST.', 'Add page and pageSize parameters to GET.'], improvements: ['Document the endpoints in the README.'], nextSteps: ['Add validation', 'Add pagination', 'Resubmit'], questionsForManager: [],
    progressPercent: 40, progressExplanation: 'One of three acceptance criteria is met.', preReviewActions: ['Resubmit before the meeting.'], limitations: ['Sample data only.'], requiresManagerReview: true } } });

console.log(`Seeded. Sign in with any of these (password: ${password}):\n  admin@demo.test, vikram.manager@demo.test, neha.manager@demo.test, ravi@demo.test, priya@demo.test, arjun@demo.test`);
await mongoose.disconnect();
