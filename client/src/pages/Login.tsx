import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { ErrorBox, Field } from '../ui';
import { errText } from '../api';
export default function Login() {
  const { me, login } = useAuth(); const nav = useNavigate(); const loc: any = useLocation();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  if (me) return <Navigate to="/" replace />;
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); try { await login(email, password); nav(loc.state?.from ?? '/', { replace: true }); } catch (x) { setErr(errText(x)); } finally { setBusy(false); } };
  return (
    <div className="grid min-h-screen place-items-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
        <div><h1 className="h1">Sign in to TaskFlow</h1><p className="text-sm text-muted">Tasks, reviews and feedback in one place.</p></div>
        <ErrorBox msg={err} />
        <Field label="Work email"><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>);
}
