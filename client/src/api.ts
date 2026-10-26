export class ApiError extends Error { details?: { field: string; message: string }[]; status = 0; }
export async function api<T = any>(path: string, o: { method?: string; body?: any; form?: FormData } = {}): Promise<T> {
  const res = await fetch('/api' + path, {
    method: o.method ?? (o.body || o.form ? 'POST' : 'GET'), credentials: 'same-origin',
    headers: o.body ? { 'content-type': 'application/json' } : undefined, body: o.form ?? (o.body ? JSON.stringify(o.body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('tf:unauthorized'));
    const e = new ApiError(data.error || 'Request failed'); e.details = data.details; e.status = res.status; throw e;
  }
  return data;
}
export const errText = (e: any) => (e?.details?.length ? e.details.map((d: any) => `${d.field ? d.field + ': ' : ''}${d.message}`).join(' · ') : e?.message ?? 'Something went wrong');
