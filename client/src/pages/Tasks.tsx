import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { Empty, ErrorBox, Pager, Spinner, TaskBadges, fmtD, useFetch } from '../ui';
const STATUSES = ['Assigned', 'In Progress', 'Submitted', 'Under Review', 'Changes Required', 'Approved', 'Completed', 'On Hold', 'Overdue'];
export default function Tasks() {
  const { me } = useAuth(); const [sp, setSp] = useSearchParams();
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); if (k !== 'page') n.delete('page'); setSp(n); };
  const { data, error, loading } = useFetch<any>(`/tasks?${sp.toString()}`);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="h1">Tasks</h1>{me!.role !== 'employee' && <Link className="btn-primary" to="/tasks/new">Assign a task</Link>}</div>
      <div className="card grid gap-3 sm:grid-cols-4">
        <input aria-label="Search by title" placeholder="Search by title" value={sp.get('q') ?? ''} onChange={(e) => set('q', e.target.value)} />
        <select aria-label="Status" value={sp.get('status') ?? ''} onChange={(e) => set('status', e.target.value)}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        <select aria-label="Priority" value={sp.get('priority') ?? ''} onChange={(e) => set('priority', e.target.value)}><option value="">All priorities</option>{['Low', 'Medium', 'High', 'Critical'].map((p) => <option key={p}>{p}</option>)}</select>
        <select aria-label="Sort" value={sp.get('sort') ?? 'deadline'} onChange={(e) => set('sort', e.target.value)}><option value="deadline">Deadline: soonest</option><option value="-deadline">Deadline: latest</option><option value="-createdAt">Newest</option><option value="createdAt">Oldest</option></select>
      </div>
      <ErrorBox msg={error} />{loading && <Spinner />}
      {data && (data.items.length ? <>
        <ul className="space-y-2">{data.items.map((t: any) => (
          <li key={t._id}><Link to={`/tasks/${t._id}`} className="card flex flex-wrap items-center justify-between gap-3 hover:border-brand">
            <span className="min-w-0"><span className="block truncate font-semibold">{t.title}</span><span className="text-sm text-muted">{me!.role === 'employee' ? `Manager: ${t.manager?.name}` : t.assignee?.name} · {t.priority} priority · due {fmtD(t.deadline)}</span></span>
            <TaskBadges t={t} /></Link></li>))}</ul>
        <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => set('page', String(p))} /></>
        : <Empty title="No tasks match" hint={me!.role === 'employee' ? 'Tasks assigned to you will appear here.' : 'Adjust the filters or assign a new task.'} />)}
    </div>);
}
