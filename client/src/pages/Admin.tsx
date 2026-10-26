import { useState } from 'react';
import { Badge, ErrorBox, Pager, Spinner, fmtDT, useFetch } from '../ui';
export default function Admin() {
  const integ = useFetch<any>('/admin/integrations'); const rep = useFetch<any>('/admin/reports'); const [page, setPage] = useState(1); const audit = useFetch<any>(`/admin/audit?page=${page}`);
  const row = (label: string, ok: boolean, note?: string) => <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span><strong>{label}</strong>{note && <span className="block text-muted">{note}</span>}</span><Badge label={ok ? 'sent' : 'failed'} /></li>;
  return (
    <div className="space-y-5"><h1 className="h1">Reports & settings</h1>
      <section className="card"><h2 className="h2">Integrations</h2><ErrorBox msg={integ.error} />{integ.loading && <Spinner />}
        {integ.data && <><ul className="divide-y divide-line">{row('Email (SMTP)', integ.data.email.configured, integ.data.email.note)}{row('AI provider', integ.data.ai.configured, integ.data.ai.configured ? `${integ.data.ai.provider} · ${integ.data.ai.model}` : integ.data.ai.note)}
          <li className="py-2 text-sm"><strong>Meetings</strong><span className="block text-muted">{integ.data.meetings.note}</span></li>
          <li className="py-2 text-sm"><strong>Reminders</strong><span className="block text-muted">Meetings: {integ.data.reminders.meetingHours.join(', ')} h before · Deadlines: {integ.data.reminders.deadlineHours.join(', ')} h before · Last worker run: {fmtDT(integ.data.worker.lastTickAt)}</span></li></ul>
          <p className="mt-2 text-xs text-muted">{integ.data.note} “Configured” here means the settings exist, not that the provider accepted them; check Notifications for real delivery results.</p></>}</section>
      <section className="card"><h2 className="h2 mb-2">Progress by employee</h2>{rep.loading && <Spinner />}<ErrorBox msg={rep.error} />
        {rep.data && <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-muted"><tr><th className="py-1 pr-3">Employee</th><th className="pr-3">Department</th><th className="pr-3">Tasks</th><th className="pr-3">Completed</th><th>Overdue</th></tr></thead>
          <tbody>{rep.data.byEmployee.map((e: any, i: number) => <tr key={i} className="border-t border-line"><td className="py-1.5 pr-3">{e.employee}</td><td className="pr-3">{e.department ?? '—'}</td><td className="pr-3">{e.total}</td><td className="pr-3">{e.completed}</td><td className={e.overdue ? 'font-semibold text-red-700' : ''}>{e.overdue}</td></tr>)}</tbody></table></div>}</section>
      <section className="card"><h2 className="h2 mb-2">Audit log</h2>{audit.loading && <Spinner />}
        {audit.data && <><ul className="divide-y divide-line text-sm">{audit.data.items.map((a: any) => <li key={a._id} className="py-1.5"><strong>{a.action}</strong> <span className="text-muted">by {a.actor?.name ?? 'system'} · {fmtDT(a.createdAt)}</span></li>)}</ul><Pager page={audit.data.page} pageSize={audit.data.pageSize} total={audit.data.total} onPage={setPage} /></>}</section>
    </div>);
}
