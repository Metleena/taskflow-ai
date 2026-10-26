import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, errText } from './api';

export function useFetch<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(!!path);
  const load = useCallback(() => { if (!path) return; setLoading(true); api<T>(path).then((d) => { setData(d); setError(''); }).catch((e) => setError(errText(e))).finally(() => setLoading(false)); }, [path]);
  useEffect(load, [load]);
  return { data, error, loading, reload: load };
}
export const fmtDT = (d?: string | Date | null, tz?: string) => { if (!d) return '—'; try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(d)); } catch { return String(d); } };
export const fmtD = (d?: string | Date | null) => (d ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(d)) : '—');

const STATUS: Record<string, string> = {
  'Assigned': 'bg-slate-100 text-slate-700', 'In Progress': 'bg-blue-100 text-blue-800', 'Submitted': 'bg-indigo-100 text-indigo-800', 'Under Review': 'bg-violet-100 text-violet-800',
  'Changes Required': 'bg-amber-100 text-amber-900', 'Approved': 'bg-emerald-100 text-emerald-800', 'Completed': 'bg-emerald-200 text-emerald-900', 'On Hold': 'bg-stone-200 text-stone-700', 'Overdue': 'bg-red-100 text-red-800',
  sent: 'bg-emerald-100 text-emerald-800', failed: 'bg-red-100 text-red-800', pending: 'bg-slate-100 text-slate-700', processing: 'bg-blue-100 text-blue-800', skipped: 'bg-stone-200 text-stone-700',
  scheduled: 'bg-blue-100 text-blue-800', completed: 'bg-emerald-100 text-emerald-800', cancelled: 'bg-stone-200 text-stone-700', missed: 'bg-red-100 text-red-800',
};
export const Badge = ({ label }: { label: string }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS[label] ?? 'bg-slate-100 text-slate-700'}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{label}</span>);
export const TaskBadges = ({ t }: { t: any }) => <span className="flex flex-wrap gap-1"><Badge label={t.status} />{t.overdue && <Badge label="Overdue" />}</span>;

export const Spinner = () => <div role="status" className="p-8 text-center text-sm text-muted">Loading…</div>;
export const ErrorBox = ({ msg }: { msg: string }) => msg ? <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{msg}</div> : null;
export const Notice = ({ msg }: { msg: string }) => msg ? <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{msg}</div> : null;
export const Empty = ({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) => (
  <div className="rounded-lg border border-dashed border-line bg-white p-8 text-center"><p className="font-semibold">{title}</p>{hint && <p className="mt-1 text-sm text-muted">{hint}</p>}{action && <div className="mt-3">{action}</div>}</div>);
export const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <div className="space-y-1"><label className="block">{label}</label>{children}{hint && <p className="text-xs text-muted">{hint}</p>}</div>);
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return <div className="flex items-center justify-between pt-3 text-sm"><span className="text-muted">Page {page} of {pages} · {total} items</span>
    <span className="flex gap-2"><button className="btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button><button className="btn-ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button></span></div>;
}
export const Stat = ({ label, value, tone }: { label: string; value: ReactNode; tone?: 'warn' | 'bad' }) => (
  <div className="card"><p className="text-sm text-muted">{label}</p><p className={`mt-1 text-2xl font-bold ${tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : ''}`}>{value}</p></div>);
export const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
