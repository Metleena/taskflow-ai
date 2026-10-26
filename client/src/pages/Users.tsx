import { useState, type FormEvent } from 'react';
import { api, errText } from '../api';
import { useAuth } from '../auth';
import { Empty, ErrorBox, Field, Notice, Pager, Spinner, useFetch } from '../ui';
export default function Users() {
  const { me } = useAuth(); const isAdmin = me!.role === 'admin';
  const [page, setPage] = useState(1); const [q, setQ] = useState(''); const { data, error, loading, reload } = useFetch<any>(`/users?page=${page}&q=${encodeURIComponent(q)}`);
  const mgrs = useFetch<any>(isAdmin ? '/users?role=manager&pageSize=100' : null);
  const blank = { name: '', email: '', role: 'employee', department: '', manager: '' }; const [f, setF] = useState<any>(blank); const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  const up = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const create = async (e: FormEvent) => { e.preventDefault(); setErr(''); setOk(''); try { await api('/users', { body: { ...f, manager: f.role === 'employee' && f.manager ? f.manager : undefined, department: f.department || undefined } }); setOk('Account created. A set-password email is queued; check Notifications for its delivery status.'); setF(blank); reload(); } catch (x) { setErr(errText(x)); } };
  const act = async (id: string, fn: () => Promise<any>, msg: string) => { setErr(''); setOk(''); try { await fn(); setOk(msg); reload(); } catch (x) { setErr(errText(x)); } };
  return (
    <div className="space-y-4"><h1 className="h1">{isAdmin ? 'People' : 'My team'}</h1><ErrorBox msg={err} /><Notice msg={ok} />
      {isAdmin && <form onSubmit={create} className="card grid gap-3 sm:grid-cols-3"><h2 className="h2 sm:col-span-3">Add a person</h2>
        <Field label="Name"><input required value={f.name} onChange={up('name')} /></Field><Field label="Email"><input type="email" required value={f.email} onChange={up('email')} /></Field>
        <Field label="Role"><select value={f.role} onChange={up('role')}><option value="employee">Employee</option><option value="manager">Manager</option><option value="admin">Administrator</option></select></Field>
        <Field label="Department"><input value={f.department} onChange={up('department')} /></Field>
        {f.role === 'employee' && <Field label="Manager"><select value={f.manager} onChange={up('manager')}><option value="">None</option>{mgrs.data?.items.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>}
        <div className="flex items-end"><button className="btn-primary">Create account</button></div></form>}
      <input aria-label="Search people" placeholder="Search by name or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      {loading && <Spinner />}<ErrorBox msg={error} />
      {data && (data.items.length ? <><ul className="space-y-2">{data.items.map((u: any) => (
        <li key={u.id} className="card flex flex-wrap items-center justify-between gap-3 text-sm"><span><strong>{u.name}</strong> <span className="text-muted">· {u.email}</span><br /><span className="capitalize text-muted">{u.role}{u.department ? ` · ${u.department}` : ''}{u.status === 'disabled' ? ' · disabled' : ''}</span></span>
          {isAdmin && <span className="flex gap-2"><button className="btn-ghost" onClick={() => act(u.id, () => api(`/users/${u.id}/invite`, { method: 'POST', body: {} }), 'Invitation queued.')}>Resend invite</button>
            {u.id !== me!.id && <button className="btn-ghost" onClick={() => act(u.id, () => api(`/users/${u.id}`, { method: 'PATCH', body: { status: u.status === 'active' ? 'disabled' : 'active' } }), 'Account updated.')}>{u.status === 'active' ? 'Disable' : 'Enable'}</button>}</span>}</li>))}</ul>
        <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></> : <Empty title="No people found" />)}</div>);
}
