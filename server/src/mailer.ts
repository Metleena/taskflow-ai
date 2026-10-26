import nodemailer from 'nodemailer';
import { config, mailConfigured } from './config.ts';

let transport: any = null;
export const __setTransportForTests = (t: any) => { transport = t; };
const getTransport = () => transport ??= nodemailer.createTransport({
  host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure,
  auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
});
export const canSendMail = () => transport !== null || mailConfigured();

/** Resolves only when the SMTP server accepted the message; throws otherwise. */
export async function sendMail(m: { to: string; subject: string; html: string; text: string }) {
  const info = await getTransport().sendMail({ from: config.smtp.from ?? 'TaskFlow <no-reply@localhost>', ...m });
  if (info.rejected?.length) throw new Error(`Recipient rejected: ${info.rejected.join(', ')}`);
  return { messageId: info.messageId as string };
}
