import 'dotenv/config';
const e = process.env;
const nums = (s: string | undefined, d: string) => (s || d).split(',').map((x) => Number(x.trim())).filter((n) => n > 0);

export const config = {
  env: e.NODE_ENV || 'development',
  port: Number(e.PORT || 4000),
  mongoUri: e.MONGODB_URI || 'mongodb://127.0.0.1:27017/taskflow',
  jwtSecret: e.JWT_SECRET || '',
  clientUrl: (e.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, ''),
  smtp: { host: e.SMTP_HOST, port: Number(e.SMTP_PORT || 587), secure: e.SMTP_SECURE === 'true', user: e.SMTP_USER, pass: e.SMTP_PASS, from: e.SMTP_FROM },
  ai: { apiKey: e.ANTHROPIC_API_KEY, model: e.AI_MODEL || 'claude-sonnet-5-5', baseUrl: (e.AI_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '') },
  uploadDir: e.UPLOAD_DIR || 'uploads',
  maxFileMb: Number(e.MAX_FILE_MB || 15),
  meetingReminderHours: nums(e.MEETING_REMINDER_HOURS, '24,1'),
  deadlineReminderHours: nums(e.DEADLINE_REMINDER_HOURS, '48,24'),
  workerIntervalMs: Number(e.WORKER_INTERVAL_MS || 30_000),
  maxEmailAttempts: Number(e.MAX_EMAIL_ATTEMPTS || 5),
};
export function assertConfig() {
  if (config.jwtSecret.length < 32) throw new Error('JWT_SECRET must be set to a random string of at least 32 characters.');
}
export const mailConfigured = () => Boolean(config.smtp.host && config.smtp.from);
export const aiConfigured = () => Boolean(config.ai.apiKey);
