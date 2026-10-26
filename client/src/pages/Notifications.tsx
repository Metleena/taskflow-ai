import { useState } from 'react';
import { api, errText } from '../api';
import { useAuth } from '../auth';
import { Badge, Empty, ErrorBox, Pager, Spinner, fmtDT, useFetch } from '../ui';
export default function Notifications() {
  const { me } = useAuth(); const [page, setPage] = useState(1); const [status, setStatus] = useState(''); const [err, setErr] = useState('');
  const { data, error, loading, reload } = useFetch<any>(`/notifications?page=${page}${status ? `&status=${status}` : ''}`);
  const retry = async (id: string) => { setErr(''); try { await api(`/notifications/${id}/retry`, { method: 'POST', body: {} }); reload(); } catch (x) { setErr(errText(x)); } };
  return (
    <div className="space-y-4"><div className="flex items-center justify-between"><h1 className="h1">Notifications</h1>
      <select aria-label="Status" className="!w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All</option>{['pending', 'sent', 'failed', 'skipped'].map((s) => <option key={s}>{s}</option>)}</select></div>
      <p className="text-sm text-muted">Each row shows what actually happened to the email. “Sent” means the mail server accepted it.</p>
      <ErrorBox msg={error || err} />{loading && <Spinner />}
      {data && (data.items.length ? <><ul className="space-y-2">{data.items.map((n: any) => (
        <li key={n._id} className="card flex flex-wrap items-start justify-between gap-3 text-sm"><span><strong>{n.type.replace(/_/g, ' ')}</strong> to {n.recipient?.name}<br /><span className="text-muted">{n.task?.title} · {n.status === 'sent' ? `sent ${fmtDT(n.sentAt)}` : `scheduled ${fmtDT(n.scheduledFor)}`} · attempts {n.attempts}</span>{n.lastError && <span className="block text-red-700">{n.lastError}</span>}</span>
          <span className="flex items-center gap-2"><Badge label={n.status} />{me!.role !== 'employee' && ['failed', 'skipped'].includes(n.status) && <button className="btn-ghost" onClick={() => retry(n._id)}>Retry</button>}</span></li>))}</ul>
        <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></> : <Empty title="No notifications" />)}</div>);
}
