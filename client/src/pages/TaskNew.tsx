import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errText } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Field, Spinner, lines, useFetch } from '../ui';

export default function TaskNew() {
  const { me } = useAuth(); const nav = useNavigate();
  const emps = useFetch<any>('/users?role=employee&pageSize=100'); const mgrs = useFetch<any>(me!.role === 'admin' ? '/users?role=manager&pageSize=100' : null);
  const [f, setF] = useState<any>({ title: '', description: '', department: '', priority: 'Medium', startDate: new Date().toISOString().slice(0, 10), deadline: '', deliverables: '', acceptanceCriteria: '', referenceLinks: '', managerId: '', mDate: '', platform: 'Google Meet', link: '', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  const [ids, setIds] = useState<string[]>([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const up = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const r = await api('/tasks', { body: { title: f.title, description: f.description, assigneeIds: ids, department: f.department || undefined, priority: f.priority, startDate: new Date(f.startDate).toISOString(), deadline: new Date(f.deadline).toISOString(), deliverables: lines(f.deliverables), acceptanceCriteria: lines(f.acceptanceCriteria), referenceLinks: lines(f.referenceLinks), managerId: f.managerId || undefined, meeting: { startsAt: new Date(f.mDate).toISOString(), timeZone: f.timeZone, platform: f.platform, link: f.link } } });
      nav(r.items.length === 1 ? `/tasks/${r.items[0]._id}` : '/tasks');
    } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  };
  if (emps.loading) return <Spinner />;
  return (
    <form onSubmit={submit} className="max-w-3xl space-y-4"><h1 className="h1">Assign a task</h1><ErrorBox msg={err} />
      <section className="card space-y-4"><h2 className="h2">The task</h2>
        <Field label="Title"><input required minLength={3} value={f.title} onChange={up('title')} /></Field>
        <Field label="Description" hint="Write what you need in your own words. The AI rewrites it in plain language for the employee and will not add requirements."><textarea required rows={5} value={f.description} onChange={up('description')} /></Field>
        <Field label="Expected deliverables" hint="One per line."><textarea required rows={3} value={f.deliverables} onChange={up('deliverables')} /></Field>
        <Field label="Acceptance criteria" hint="One per line. The task can only be completed when these are met."><textarea required rows={3} value={f.acceptanceCriteria} onChange={up('acceptanceCriteria')} /></Field>
        <Field label="Reference documents or links" hint="One URL per line (optional)."><textarea rows={2} value={f.referenceLinks} onChange={up('referenceLinks')} /></Field></section>
      <section className="card space-y-4"><h2 className="h2">Who and when</h2>
        <fieldset><legend className="mb-1 text-sm font-medium">Assign to (one task is created per person)</legend>
          {emps.data?.items.length ? <div className="grid gap-1 sm:grid-cols-2">{emps.data.items.map((u: any) => <label key={u.id} className="flex items-center gap-2 font-normal"><input type="checkbox" checked={ids.includes(u.id)} onChange={(e) => setIds(e.target.checked ? [...ids, u.id] : ids.filter((x) => x !== u.id))} />{u.name} <span className="text-muted">({u.department})</span></label>)}</div> : <p className="text-sm text-muted">No employees available to assign.</p>}</fieldset>
        {me!.role === 'admin' && <Field label="Responsible manager"><select value={f.managerId} onChange={up('managerId')}><option value="">Employee’s own manager</option>{mgrs.data?.items.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Department"><input value={f.department} onChange={up('department')} placeholder="Defaults to the employee’s" /></Field>
          <Field label="Priority"><select value={f.priority} onChange={up('priority')}>{['Low', 'Medium', 'High', 'Critical'].map((p) => <option key={p}>{p}</option>)}</select></Field>
          <Field label="Start date"><input type="date" required value={f.startDate} onChange={up('startDate')} /></Field>
          <Field label="Deadline"><input type="datetime-local" required value={f.deadline} onChange={up('deadline')} /></Field></div></section>
      <section className="card space-y-4"><h2 className="h2">First review meeting</h2><p className="text-sm text-muted">Paste a link from your meeting tool. TaskFlow never creates meeting links on its own.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date and time"><input type="datetime-local" required value={f.mDate} onChange={up('mDate')} /></Field>
          <Field label="Time zone"><input required value={f.timeZone} onChange={up('timeZone')} /></Field>
          <Field label="Platform"><input value={f.platform} onChange={up('platform')} /></Field>
          <Field label="Meeting link"><input type="url" required placeholder="https://" value={f.link} onChange={up('link')} /></Field></div></section>
      <button className="btn-primary" disabled={busy || !ids.length}>{busy ? 'Assigning…' : `Assign task${ids.length > 1 ? 's' : ''}`}</button>
    </form>);
}
