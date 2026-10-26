import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../auth';
import { Badge, Empty, ErrorBox, Spinner, Stat, fmtD, fmtDT, useFetch } from '../ui';

export default function Dashboard() {
  const { me } = useAuth(); const { data, error, loading } = useFetch<any>('/dashboard');
  if (loading) return <Spinner />; if (error) return <ErrorBox msg={error} />; if (!data) return null;
  const c = data.counts; const role = me!.role;
  const stats: [string, any, ('warn' | 'bad')?][] = role === 'admin'
    ? [['Employees', c.employees], ['Active tasks', c.active], ['Completed', c.completed], ['Overdue', c.overdue, c.overdue ? 'bad' : undefined], ['Awaiting review', c.awaitingReview, c.awaitingReview ? 'warn' : undefined], ['Upcoming meetings', data.upcomingMeetings.length]]
    : role === 'manager'
    ? [['Employees on my team', c.employees], ['Tasks assigned', c.total], ['In progress', c.inProgress], ['Awaiting my review', c.awaitingReview, c.awaitingReview ? 'warn' : undefined], ['Overdue', c.overdue, c.overdue ? 'bad' : undefined], ['Upcoming meetings', data.upcomingMeetings.length]]
    : [['My tasks', c.active], ['Due within 7 days', data.dueSoon.length, data.dueSoon.length ? 'warn' : undefined], ['Overdue', c.overdue, c.overdue ? 'bad' : undefined], ['Corrections pending', c.changesRequired, c.changesRequired ? 'warn' : undefined], ['Upcoming meetings', data.upcomingMeetings.length], ['Completed', c.completed]];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="h1">Hello, {me!.name.split(' ')[0]}</h1>{role !== 'employee' && <Link className="btn-primary" to="/tasks/new">Assign a task</Link>}</div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">{stats.map(([l, v, t]) => <Stat key={l} label={l} value={v} tone={t} />)}</div>
      {role !== 'employee' && (
        <section className="card"><h2 className="h2 mb-3">Department progress</h2>
          {data.departmentProgress?.length ? <div className="h-64" role="img" aria-label="Tasks per department"><ResponsiveContainer><BarChart data={data.departmentProgress}><CartesianGrid strokeDasharray="3 3" stroke="#d5dee3" /><XAxis dataKey="department" fontSize={12} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip /><Legend />
            <Bar dataKey="total" name="Total" fill="#9fc3cc" /><Bar dataKey="completed" name="Completed" fill="#0f4c5c" /><Bar dataKey="overdue" name="Overdue" fill="#c2410c" /></BarChart></ResponsiveContainer></div> : <Empty title="No tasks yet" />}</section>)}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card"><h2 className="h2 mb-3">Upcoming review meetings</h2>
          {data.upcomingMeetings.length ? <ul className="divide-y divide-line">{data.upcomingMeetings.map((m: any) => <li key={m._id} className="py-2 text-sm"><Link className="font-semibold text-brand hover:underline" to={`/tasks/${m.task?._id}`}>{m.task?.title}</Link><br /><span className="text-muted">{fmtDT(m.startsAt, m.timeZone)} · {m.platform}</span></li>)}</ul> : <p className="text-sm text-muted">Nothing scheduled.</p>}</section>
        <section className="card"><h2 className="h2 mb-3">{role === 'employee' ? 'Due soon' : 'Deadlines this week'}</h2>
          {data.dueSoon.length ? <ul className="divide-y divide-line">{data.dueSoon.map((t: any) => <li key={t._id} className="flex items-center justify-between gap-2 py-2 text-sm"><Link className="font-semibold text-brand hover:underline" to={`/tasks/${t._id}`}>{t.title}</Link><span className="shrink-0 text-muted">{fmtD(t.deadline)}</span></li>)}</ul> : <p className="text-sm text-muted">Nothing due in the next 7 days.</p>}</section>
      </div>
      <section className="card"><h2 className="h2 mb-3">Latest feedback</h2>
        {data.recentFeedback.length ? <ul className="divide-y divide-line">{data.recentFeedback.map((f: any) => <li key={f._id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
          <Link className="font-semibold text-brand hover:underline" to={`/tasks/${f.task?._id}`}>{f.task?.title}</Link>
          <span className="flex items-center gap-2 text-muted">{f.ai?.status === 'completed' ? `AI estimate ${f.ai.report?.progressPercent}%` : `AI: ${f.ai?.status}`}{f.decision !== 'none' && <Badge label={f.decision === 'approved' ? 'Approved' : 'Changes Required'} />}</span></li>)}</ul> : <p className="text-sm text-muted">No feedback yet.</p>}</section>
    </div>);
}
