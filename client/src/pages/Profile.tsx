import { useState, type FormEvent } from 'react';
import { api, errText } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Field, Notice } from '../ui';
export default function Profile() {
  const { me, refresh } = useAuth(); const [name, setName] = useState(me!.name); const [tz, setTz] = useState(me!.timeZone);
  const [cur, setCur] = useState(''); const [nw, setNw] = useState(''); const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  const save = async (e: FormEvent) => { e.preventDefault(); setErr(''); setOk(''); try { await api('/auth/me', { method: 'PATCH', body: { name, timeZone: tz, ...(nw ? { currentPassword: cur, newPassword: nw } : {}) } }); await refresh(); setCur(''); setNw(''); setOk('Profile saved.'); } catch (x) { setErr(errText(x)); } };
  return (
    <div className="max-w-xl space-y-4"><h1 className="h1">Your profile</h1>
      <form onSubmit={save} className="card space-y-4"><ErrorBox msg={err} /><Notice msg={ok} />
        <p className="text-sm text-muted">{me!.email} · <span className="capitalize">{me!.role}</span>{me!.department ? ` · ${me!.department}` : ''}</p>
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label="Time zone" hint="Used for dates in your emails, e.g. Asia/Kolkata."><input value={tz} onChange={(e) => setTz(e.target.value)} /></Field>
        <h2 className="h2 pt-2">Change password</h2>
        <Field label="Current password"><input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="New password" hint="At least 10 characters, with letters and numbers."><input type="password" autoComplete="new-password" value={nw} onChange={(e) => setNw(e.target.value)} /></Field>
        <button className="btn-primary">Save changes</button></form></div>);
}
