# API reference

Base path `/api`. Auth is an httpOnly cookie set by `POST /auth/login`. JSON bodies unless noted. Errors: `{ "error": string, "details"?: [{field, message}] }` (400 validation, 401 not signed in, 403 role, 404 not found or not yours, 409 invalid state). Lists accept `page`, `pageSize` and return `{ items, total, page, pageSize }`.

## Auth & users
| Method & path | Roles | Notes |
|---|---|---|
| `POST /auth/login` `{email,password}` | public | rate-limited |
| `POST /auth/logout` | any | |
| `POST /auth/set-password` `{token,password}` | public | single-use link from the invite email |
| `GET /auth/me`, `PATCH /auth/me` `{name?,timeZone?,currentPassword?,newPassword?}` | any | |
| `GET /users?role&q` | admin, manager (own employees) | |
| `POST /users` `{name,email,role,department?,manager?,timeZone?}` | admin | queues invite email |
| `PATCH /users/:id` | admin | cannot disable/demote self |
| `POST /users/:id/invite` | admin | re-send set-password email |

## Tasks
| Method & path | Roles | Notes |
|---|---|---|
| `GET /tasks?q&status&priority&department&sort&page` | all (scoped) | `status` also accepts `Overdue` |
| `POST /tasks` | admin, manager | `{title,description,assigneeIds[],department?,startDate,deadline,priority,deliverables[],acceptanceCriteria[],referenceLinks[],meeting:{startsAt,timeZone,platform,link,reminderHours?},managerId?}`; creates one task per assignee; explanation + emails run in background |
| `GET /tasks/:id` | all (scoped) | `{task, meetings, submissions, feedback}`; employees do not see manager comments before a decision |
| `PATCH /tasks/:id` | admin, manager | not for Approved/Completed |
| `POST /tasks/:id/explain` | admin, manager | regenerate AI explanation (202) |
| `POST /tasks/:id/status` `{status}` | employee: `In Progress`; staff: `Under Review`, `On Hold`, `In Progress`, `Assigned` | transition rules in `domain/workflow.ts` |
| `POST /tasks/:id/complete` `{note?}` | admin, manager | only from `Approved` |

## Submissions & feedback
| Method & path | Roles | Notes |
|---|---|---|
| `POST /tasks/:id/submissions` (multipart) | employee | fields: `explanation, difficulties, links` (JSON array), `keepFiles` (JSON array of stored names), `draft` (`true`/`false`), `files` (≤10, ≤`MAX_FILE_MB`). Draft saves keep status; submit creates the next version, sets `Submitted`, queues confirmation, starts AI analysis |
| `GET /submissions/:id/files/:storedName` | owner, task manager, admin | authorised download |
| `POST /feedback/:id/reanalyze` | admin, manager | 202 |
| `POST /feedback/:id/review` `{decision: approved\|changes_required, managerComments?, meetingId?, meetingOutcome?, nextMeeting?}` | admin, manager | `changes_required` requires `nextMeeting` (future, http(s) link); one decision per submission |

## Meetings
| Method & path | Roles | Notes |
|---|---|---|
| `GET /meetings?upcoming&status` | all (scoped) | |
| `POST /tasks/:id/meetings` `{startsAt,timeZone,platform,link,reminderHours?}` | admin, manager | |
| `PATCH /meetings/:id` `{action: reschedule\|cancel\|missed\|complete, ...}` | admin, manager | reschedule/cancel/missed notify participants and replace reminders |

## Other
| Method & path | Roles |
|---|---|
| `GET /dashboard` | all (role-specific payload) |
| `GET /notifications?status&type` | all (admin: all; manager: own + own tasks; employee: own) |
| `POST /notifications/:id/retry` | admin, manager |
| `GET /admin/integrations`, `GET /admin/reports`, `GET /admin/audit` | admin |
| `GET /health` | public |
