import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Empty, ErrorBox, Pager, Spinner, fmtDT, useFetch } from '../ui';
export default function Meetings() {
  const [page, setPage] = useState(1); const [view, setView] = useState('upcoming');
  const { data, error, loading } = useFetch<any>(`/meetings?page=${page}${view === 'upcoming' ? '&upcoming=true' : ''}`);
  return (
    <div className="space-y-4"><div className="flex items-center justify-between"><h1 className="h1">Review meetings</h1>
      <select aria-label="View" className="!w-auto" value={view} onChange={(e) => { setView(e.target.value); setPage(1); }}><option value="upcoming">Upcoming</option><option value="all">History</option></select></div>
      <ErrorBox msg={error} />{loading && <Spinner />}
      {data && (data.items.length ? <><ul className="space-y-2">{data.items.map((m: any) => (
        <li key={m._id} className="card flex flex-wrap items-center justify-between gap-3"><span><Link className="font-semibold text-brand hover:underline" to={`/tasks/${m.task?._id}`}>{m.task?.title}</Link><br />
          <span className="text-sm text-muted">{fmtDT(m.startsAt, m.timeZone)} ({m.timeZone}) · {m.platform} · {m.participants?.map((p: any) => p.name).join(', ')}</span>{m.outcome && <span className="block text-sm">Outcome: {m.outcome}</span>}</span>
          <span className="flex items-center gap-2"><Badge label={m.status} />{m.status === 'scheduled' && <a className="btn-primary" href={m.link} target="_blank" rel="noreferrer">Join</a>}</span></li>))}</ul>
        <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></> : <Empty title={view === 'upcoming' ? 'No upcoming meetings' : 'No meetings yet'} />)}</div>);
}
