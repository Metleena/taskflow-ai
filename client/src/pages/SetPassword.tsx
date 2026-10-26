import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errText } from '../api';
import { ErrorBox, Field, Notice } from '../ui';
export default function SetPassword() {
  const [params] = useSearchParams(); const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [done, setDone] = useState(false);
  const submit = async (e: FormEvent) => { e.preventDefault(); setErr(''); try { await api('/auth/set-password', { body: { token: params.get('token'), password: pw } }); setDone(true); } catch (x) { setErr(errText(x)); } };
  return (
    <div className="grid min-h-screen place-items-center p-4"><form onSubmit={submit} className="card w-full max-w-sm space-y-4">
      <h1 className="h1">Choose your password</h1><ErrorBox msg={err} />
      {done ? <><Notice msg="Password saved." /><Link className="btn-primary w-full" to="/login">Go to sign in</Link></> : <>
        <Field label="New password" hint="At least 10 characters, with letters and numbers."><input type="password" autoComplete="new-password" required minLength={10} value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <button className="btn-primary w-full">Save password</button></>}
    </form></div>);
}
