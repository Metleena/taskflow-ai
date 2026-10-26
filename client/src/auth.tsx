import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
export interface Me { id: string; name: string; email: string; role: 'admin' | 'manager' | 'employee'; department?: string; timeZone: string }
const Ctx = createContext<{ me: Me | null; ready: boolean; login: (e: string, p: string) => Promise<void>; logout: () => Promise<void>; refresh: () => Promise<void> }>(null as any);
export const useAuth = () => useContext(Ctx);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null); const [ready, setReady] = useState(false);
  const refresh = async () => { try { setMe((await api('/auth/me')).user); } catch { setMe(null); } setReady(true); };
  useEffect(() => { refresh(); const f = () => setMe(null); window.addEventListener('tf:unauthorized', f); return () => window.removeEventListener('tf:unauthorized', f); }, []);
  const login = async (email: string, password: string) => setMe((await api('/auth/login', { body: { email, password } })).user);
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); setMe(null); };
  return <Ctx.Provider value={{ me, ready, login, logout, refresh }}>{children}</Ctx.Provider>;
}
