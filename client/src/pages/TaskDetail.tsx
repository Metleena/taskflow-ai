import { useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { api, errText } from '../api';
import { useAuth } from '../auth';
import { Badge, ErrorBox, Field, Notice, Spinner, TaskBadges, fmtD, fmtDT, lines, useFetch } from '../ui';

const List = ({ items }: { items?: string[] }) => items?.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{items.map((i, k) => <li key={k}>{i}</li>)}</ul> : <p className="text-sm text-muted">None.</p>;
const Block = ({ title, children }: { title: string; children: ReactNode }) => <div><h3 className="text-sm font-bold">{title}</h3><div className="mt-1">{children}</div></div>;
const Reqs = ({ items }: { items?: any[] }) => items?.length ? <ul className="space-y-1.5 text-sm">{items.map((r, k) => <li key={k}><strong>{r.requirement}</strong> — {r.note}{r.evidence && <span className="block text-muted">Evidence: {r.evidence}</span>}</li>)}</ul> : <p className="text-sm text-muted">None.</p>;

function Report({ fb }: { fb: any }) {
  const a = fb.ai; const r = a?.report;
  if (a.status === 'pending') return <p className="text-sm text-muted">The AI analysis is still running. Refresh in a minute.</p>;
  if (a.status === 'unavailable' || a.status === 'failed') return <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">No AI report for this submission: {a.error} Your manager will review it directly.</p>;
  return (
    <div className="space-y-4">
      {a.status === 'sample' && <p className="rounded-md bg-slate-100 p-2 text-xs">Sample data for the demo. This report was not produced by an AI model.</p>}
      <p className="rounded-md bg-brand-soft p-3 text-sm"><strong>Advisory only.</strong> This is an AI-generated estimate of {r.progressPercent}% progress. {r.progressExplanation} Your manager makes the final decision.{r.requiresManagerReview && ' The AI could not fully judge this work from text alone, so manager review is especially important.'}</p>
      <Block title="How the task was understood"><p className="text-sm">{r.taskUnderstanding}</p></Block>
      <Block title="Summary of your work"><p className="text-sm">{r.submissionSummary}</p></Block>
      {r.comparisonWithPreviousFeedback && <Block title="Compared with earlier feedback"><p className="text-sm">{r.comparisonWithPreviousFeedback}</p></Block>}
      <div className="grid gap-4 md:grid-cols-3"><Block title="Completed"><Reqs items={r.completed} /></Block><Block title="Partly done"><Reqs items={r.partial} /></Block><Block title="Missing"><Reqs items={r.missing} /></Block></div>
      <Block title="Mistakes or inconsistencies">{r.mistakes?.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{r.mistakes.map((m: any, k: number) => <li key={k}>{m.issue}{m.where && <span className="text-muted"> ({m.where})</span>}</li>)}</ul> : <p className="text-sm text-muted">None found.</p>}</Block>
      <div className="grid gap-4 md:grid-cols-2"><Block title="Please correct"><List items={r.corrections} /></Block><Block title="Suggested improvements"><List items={r.improvements} /></Block>
        <Block title="Next steps"><List items={r.nextSteps} /></Block><Block title="Before the next review"><List items={r.preReviewActions} /></Block></div>
      <Block title="Questions to clarify with your manager"><List items={r.questionsForManager} /></Block>
      <Block title="Limits of this analysis"><List items={r.limitations} /></Block>
    </div>);
}

type MV = { startsAt: string; timeZone: string; platform: string; link: string };
const blankM = (): MV => ({ startsAt: '', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, platform: 'Google Meet', link: '' });
const toM = (v: MV) => ({ ...v, startsAt: v.startsAt ? new Date(v.startsAt).toISOString() : '' });
function MeetingFields({ v, set }: { v: MV; set: (v: MV) => void }) {
  const up = (k: keyof MV) => (e: any) => set({ ...v, [k]: e.target.value });
  return <div className="grid gap-3 sm:grid-cols-2"><Field label="Date and time"><input type="datetime-local" required value={v.startsAt} onChange={up('startsAt')} /></Field><Field label="Time zone"><input required value={v.timeZone} onChange={up('timeZone')} /></Field>
    <Field label="Platform"><input value={v.platform} onChange={up('platform')} /></Field><Field label="Meeting link"><input type="url" required placeholder="https://" value={v.link} onChange={up('link')} /></Field></div>;
}

function SubmitForm({ task, draft, onDone }: { task: any; draft: any; onDone: (m: string) => void }) {
  const [expl, setExpl] = useState(draft?.explanation ?? ''); const [diff, setDiff] = useState(draft?.difficulties ?? ''); const [links, setLinks] = useState((draft?.links ?? []).join('\n'));
  const [keep, setKeep] = useState<string[]>((draft?.files ?? []).map((f: any) => f.storedName)); const [files, setFiles] = useState<File[]>([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const send = async (isDraft: boolean) => {
    setErr(''); setBusy(true);
    const fd = new FormData(); fd.set('explanation', expl); fd.set('difficulties', diff); fd.set('links', JSON.stringify(lines(links))); fd.set('keepFiles', JSON.stringify(keep)); fd.set('draft', String(isDraft)); files.forEach((f) => fd.append('files', f));
    try { await api(`/tasks/${task._id}/submissions`, { form: fd }); onDone(isDraft ? 'Draft saved.' : 'Work submitted. The AI feedback report will appear shortly.'); } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); send(false); }} className="space-y-3"><ErrorBox msg={err} />
      <Field label="What did you do?" hint="Describe the work you completed, in your own words."><textarea rows={5} value={expl} onChange={(e) => setExpl(e.target.value)} /></Field>
      <Field label="Difficulties or open questions (optional)"><textarea rows={2} value={diff} onChange={(e) => setDiff(e.target.value)} /></Field>
      <Field label="Links" hint="GitHub repositories, documents or other URLs. One per line."><textarea rows={2} value={links} onChange={(e) => setLinks(e.target.value)} /></Field>
      {draft?.files?.length > 0 && <div className="text-sm"><p className="font-medium">Saved files</p>{draft.files.map((f: any) => <label key={f.storedName} className="flex items-center gap-2 font-normal"><input type="checkbox" checked={keep.includes(f.storedName)} onChange={(e) => setKeep(e.target.checked ? [...keep, f.storedName] : keep.filter((k) => k !== f.storedName))} />{f.originalName}</label>)}</div>}
      <Field label="Add files" hint="PDF, DOCX, XLSX, TXT, ZIP or source code. Up to 10 files."><input type="file" multiple onChange={(e) => setFiles([...(e.target.files ?? [])])} /></Field>
      <div className="flex flex-wrap gap-2"><button type="button" className="btn-ghost" disabled={busy} onClick={() => send(true)}>Save draft</button><button className="btn-primary" disabled={busy}>{busy ? 'Working…' : 'Submit work'}</button></div></form>);
}

function ReviewForm({ fb, meetings, onDone }: { fb: any; meetings: any[]; onDone: (m: string) => void }) {
  const [decision, setDecision] = useState('changes_required'); const [comments, setComments] = useState(''); const [m, setM] = useState<MV>(blankM());
  const open = meetings.filter((x) => x.status === 'scheduled'); const [mid, setMid] = useState(''); const [outcome, setOutcome] = useState(''); const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => { e.preventDefault(); setErr(''); try { await api(`/feedback/${fb._id}/review`, { body: { decision, managerComments: comments, meetingId: mid || undefined, meetingOutcome: outcome || undefined, nextMeeting: decision === 'changes_required' ? toM(m) : undefined } }); onDone(decision === 'approved' ? 'Approved. You can now confirm completion.' : 'Feedback saved. The employee will be emailed the corrections and the next meeting.'); } catch (x) { setErr(errText(x)); } };
  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border border-line bg-page p-3"><h3 className="h2">Your review</h3><ErrorBox msg={err} />
      <fieldset className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2 font-normal"><input type="radio" checked={decision === 'changes_required'} onChange={() => setDecision('changes_required')} />Changes required</label><label className="flex items-center gap-2 font-normal"><input type="radio" checked={decision === 'approved'} onChange={() => setDecision('approved')} />Approve</label></fieldset>
      <Field label="Comments for the employee"><textarea rows={3} value={comments} onChange={(e) => setComments(e.target.value)} /></Field>
      {open.length > 0 && <div className="grid gap-3 sm:grid-cols-2"><Field label="Meeting this review followed (optional)"><select value={mid} onChange={(e) => setMid(e.target.value)}><option value="">None</option>{open.map((x) => <option key={x._id} value={x._id}>{fmtDT(x.startsAt, x.timeZone)}</option>)}</select></Field>{mid && <Field label="Meeting outcome"><textarea rows={2} value={outcome} onChange={(e) => setOutcome(e.target.value)} /></Field>}</div>}
      {decision === 'changes_required' && <div><p className="mb-2 text-sm font-medium">Next review meeting (required)</p><MeetingFields v={m} set={setM} /></div>}
      <button className="btn-primary">Save decision</button></form>);
}

function MeetingRow({ m, staff, onDone, onErr }: { m: any; staff: boolean; onDone: (s: string) => void; onErr: (s: string) => void }) {
  const [edit, setEdit] = useState(false); const [v, setV] = useState<MV>({ ...blankM(), timeZone: m.timeZone, platform: m.platform, link: m.link }); const [reason, setReason] = useState('');
  const call = async (body: any, msg: string) => { try { await api(`/meetings/${m._id}`, { method: 'PATCH', body }); setEdit(false); onDone(msg); } catch (x) { onErr(errText(x)); } };
  return (
    <li className="py-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span><strong>{fmtDT(m.startsAt, m.timeZone)}</strong> ({m.timeZone}) · {m.platform}{m.rescheduleCount ? ` · rescheduled ${m.rescheduleCount}×` : ''}<br /><a className="text-brand underline" href={m.link} target="_blank" rel="noreferrer">{m.link}</a>{m.outcome && <span className="block text-muted">Outcome: {m.outcome}</span>}</span><Badge label={m.status} /></div>
      {staff && m.status === 'scheduled' && <div className="mt-2 flex flex-wrap gap-2"><button className="btn-ghost" onClick={() => setEdit(!edit)}>Reschedule</button><button className="btn-ghost" onClick={() => call({ action: 'missed' }, 'Marked as missed.')}>Mark missed</button><button className="btn-danger" onClick={() => confirm('Cancel this meeting and notify participants?') && call({ action: 'cancel' }, 'Meeting cancelled.')}>Cancel</button></div>}
      {edit && <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); call({ action: 'reschedule', ...toM(v), reason: reason || undefined }, 'Meeting rescheduled. Participants are being emailed.'); }}><MeetingFields v={v} set={setV} /><Field label="Reason (optional)"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field><button className="btn-primary">Save new time</button></form>}</li>);
}

export default function TaskDetail() {
  const { id } = useParams(); const { me } = useAuth(); const { data, error, loading, reload } = useFetch<any>(`/tasks/${id}`);
  const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [nm, setNm] = useState<MV>(blankM()); const [showNew, setShowNew] = useState(false); const [note, setNote] = useState('');
  if (loading && !data) return <Spinner />; if (error) return <ErrorBox msg={error} />; if (!data) return null;
  const { task: t, meetings, submissions, feedback } = data; const staff = me!.role !== 'employee'; const ex = t.aiExplanation;
  const done = (m: string) => { setMsg(m); setErr(''); reload(); };
  const run = async (fn: () => Promise<any>, ok: string) => { setErr(''); setMsg(''); try { await fn(); done(ok); } catch (x) { setErr(errText(x)); } };
  const status = (s: string) => run(() => api(`/tasks/${t._id}/status`, { body: { status: s } }), `Status changed to ${s}.`);
  const sub = (sid: string) => submissions.find((s: any) => s._id === sid);
  const draft = submissions.find((s: any) => s.status === 'draft');
  const canSubmit = !staff && ['Assigned', 'In Progress', 'Changes Required'].includes(t.status);
  const pending = feedback.find((f: any) => f.decision === 'none' && sub(f.submission)?.status === 'submitted');
  const events = [...meetings.map((m: any) => ({ at: m.startsAt, node: <span>Review meeting <Badge label={m.status} /></span> })), ...submissions.filter((s: any) => s.status === 'submitted').map((s: any) => ({ at: s.submittedAt, node: <span>Version {s.version} submitted</span> })), ...feedback.filter((f: any) => f.decision !== 'none').map((f: any) => ({ at: f.decidedAt, node: <span>Manager decision: {f.decision === 'approved' ? 'approved' : 'changes required'}</span> }))].sort((a, b) => +new Date(a.at) - +new Date(b.at));

  return (
    <div className="space-y-4">
      <section className="card space-y-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="h1">{t.title}</h1><p className="text-sm text-muted">{staff ? `Assigned to ${t.assignee?.name}` : `Manager: ${t.manager?.name} (${t.manager?.email})`} · {t.priority} priority</p></div><TaskBadges t={t} /></div>
        <p className="text-sm">Start {fmtD(t.startDate)} · Deadline <strong className={t.overdue ? 'text-red-700' : ''}>{fmtDT(t.deadline)}</strong></p>
        <ErrorBox msg={err} /><Notice msg={msg} />
        <div className="flex flex-wrap gap-2">
          {!staff && ['Assigned', 'Changes Required'].includes(t.status) && <button className="btn-ghost" onClick={() => status('In Progress')}>Start working</button>}
          {staff && t.status === 'Submitted' && <button className="btn-ghost" onClick={() => status('Under Review')}>Start review</button>}
          {staff && ['Assigned', 'In Progress', 'Submitted', 'Under Review', 'Changes Required'].includes(t.status) && <button className="btn-ghost" onClick={() => status('On Hold')}>Put on hold</button>}
          {staff && t.status === 'On Hold' && <button className="btn-ghost" onClick={() => status('In Progress')}>Resume</button>}
          {staff && <button className="btn-ghost" onClick={() => run(() => api(`/tasks/${t._id}/explain`, { body: {} }), 'Regenerating the explanation. Refresh in a minute.')}>Regenerate explanation</button>}
        </div>
        {staff && t.status === 'Approved' && <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3"><p className="text-sm font-semibold">Approved. Confirm that every acceptance criterion is met to complete this task.</p><input aria-label="Closing note" placeholder="Closing note (optional)" value={note} onChange={(e) => setNote(e.target.value)} /><button className="btn-primary" onClick={() => run(() => api(`/tasks/${t._id}/complete`, { body: { note: note || undefined } }), 'Task completed. Completion emails are queued.')}>Confirm completion</button></div>}
        {t.status === 'Completed' && <p className="text-sm text-emerald-800">Completed {fmtDT(t.finalApproval?.at)}{t.finalApproval?.note ? ` — ${t.finalApproval.note}` : ''}</p>}</section>

      <section className="card space-y-3"><h2 className="h2">What you need to do</h2>
        {ex?.status === 'generated' ? <div className="space-y-3 text-sm"><p>{ex.summary}</p><Block title="Why it matters"><p>{ex.whyItMatters}</p></Block><Block title="How to approach it"><ol className="list-decimal space-y-1 pl-5">{ex.steps.map((s: string, k: number) => <li key={k}>{s}</li>)}</ol></Block>
          <Block title="Expected output"><p>{ex.expectedOutput}</p></Block><Block title="How it will be evaluated"><p>{ex.howItIsEvaluated}</p></Block><Block title="Deadlines and constraints"><p>{ex.deadlinesAndConstraints}</p></Block>
          {ex.clarifyingQuestions?.length > 0 && <Block title="Worth clarifying with your manager"><List items={ex.clarifyingQuestions} /></Block>}<p className="text-xs text-muted">Plain-language explanation by AI ({ex.model}). The manager’s original wording below is what counts.</p></div>
          : <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{ex?.status === 'pending' ? 'The AI explanation is being prepared.' : `An AI explanation is not available: ${ex?.error ?? 'unknown reason'}. Read your manager’s original description below.`}</p>}
        <h3 className="h2 pt-2">Manager’s original description</h3><p className="whitespace-pre-wrap text-sm">{t.description}</p>
        <div className="grid gap-4 md:grid-cols-2"><Block title="Expected deliverables"><List items={t.deliverables} /></Block><Block title="Acceptance criteria"><List items={t.acceptanceCriteria} /></Block></div>
        {t.referenceLinks?.length > 0 && <Block title="Reference links"><ul className="space-y-1 text-sm">{t.referenceLinks.map((l: string) => <li key={l}><a className="text-brand underline" href={l} target="_blank" rel="noreferrer">{l}</a></li>)}</ul></Block>}</section>

      {events.length > 0 && <section className="card"><h2 className="h2 mb-3">Review cycle</h2><ol className="space-y-2 border-l-2 border-brand/30 pl-4 text-sm">{events.map((e, k) => <li key={k}><span className="text-muted">{fmtDT(e.at)}</span><br />{e.node}</li>)}</ol></section>}

      <section className="card"><div className="flex items-center justify-between"><h2 className="h2">Review meetings</h2>{staff && t.status !== 'Completed' && <button className="btn-ghost" onClick={() => setShowNew(!showNew)}>Schedule a meeting</button>}</div>
        {showNew && <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => api(`/tasks/${t._id}/meetings`, { body: toM(nm) }), 'Meeting scheduled. The employee is being emailed.').then(() => setShowNew(false)); }}><MeetingFields v={nm} set={setNm} /><button className="btn-primary">Schedule</button></form>}
        <ul className="divide-y divide-line">{meetings.map((m: any) => <MeetingRow key={m._id} m={m} staff={staff} onDone={done} onErr={setErr} />)}</ul></section>

      {canSubmit && <section className="card"><h2 className="h2 mb-3">{t.status === 'Changes Required' ? 'Submit your revised work' : 'Submit work'}</h2><SubmitForm key={draft?._id ?? 'new'} task={t} draft={draft} onDone={done} /></section>}

      <section className="card space-y-4"><h2 className="h2">Submissions and feedback</h2>
        {submissions.filter((s: any) => s.status === 'submitted').length === 0 && <p className="text-sm text-muted">Nothing has been submitted yet.</p>}
        {submissions.filter((s: any) => s.status === 'submitted').map((s: any) => { const fb = feedback.find((f: any) => f.submission === s._id); return (
          <details key={s._id} className="rounded-md border border-line p-3" open={s._id === submissions.find((x: any) => x.status === 'submitted')?._id}><summary className="cursor-pointer text-sm font-semibold">Version {s.version} · {fmtDT(s.submittedAt)}{fb?.decision && fb.decision !== 'none' ? ` · ${fb.decision === 'approved' ? 'approved' : 'changes required'}` : ''}</summary>
            <div className="mt-3 space-y-3"><p className="whitespace-pre-wrap text-sm">{s.explanation}</p>{s.difficulties && <p className="text-sm text-muted">Difficulties: {s.difficulties}</p>}
              {s.links?.length > 0 && <ul className="text-sm">{s.links.map((l: string) => <li key={l}><a className="text-brand underline" href={l} target="_blank" rel="noreferrer">{l}</a></li>)}</ul>}
              {s.files?.length > 0 && <ul className="text-sm">{s.files.map((f: any) => <li key={f.storedName}><a className="text-brand underline" href={`/api/submissions/${s._id}/files/${f.storedName}`}>{f.originalName}</a> <span className="text-muted">({Math.ceil(f.size / 1024)} KB)</span></li>)}</ul>}
              {fb && <><h3 className="h2 pt-2">AI feedback report</h3><Report fb={fb} />{fb.managerComments && <div className="rounded-md border border-line bg-page p-3 text-sm"><strong>Manager comments:</strong> {fb.managerComments}</div>}</>}
              {staff && fb && pending?._id === fb._id && ['Submitted', 'Under Review'].includes(t.status) && <><button className="btn-ghost" onClick={() => run(() => api(`/feedback/${fb._id}/reanalyze`, { body: {} }), 'Re-running the analysis. Refresh in a minute.')}>Re-run AI analysis</button><ReviewForm fb={fb} meetings={meetings} onDone={done} /></>}</div></details>); })}</section>
    </div>);
}
