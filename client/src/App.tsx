import { useState } from 'react';
import { Routes, Route, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Spinner } from './ui';
import Login from './pages/Login'; import SetPassword from './pages/SetPassword'; import Dashboard from './pages/Dashboard';
import Tasks from './pages/Tasks'; import TaskNew from './pages/TaskNew'; import TaskDetail from './pages/TaskDetail';
import Meetings from './pages/Meetings'; import Notifications from './pages/Notifications'; import Users from './pages/Users';
import Admin from './pages/Admin'; import Profile from './pages/Profile';

function Shell() {
  const { me, ready, logout } = useAuth(); const [open, setOpen] = useState(false); const loc = useLocation();
  if (!ready) return <Spinner />;
  if (!me) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  const links: [string, string, boolean][] = [['/', 'Dashboard', true], ['/tasks', 'Tasks', true], ['/meetings', 'Review meetings', true], ['/notifications', 'Notifications', true],
    ['/users', me.role === 'admin' ? 'People' : 'My team', me.role !== 'employee'], ['/admin', 'Reports & settings', me.role === 'admin'], ['/profile', 'Profile', true]];
  const nav = (
    <nav className="space-y-1 p-3" aria-label="Main">
      {links.filter((l) => l[2]).map(([to, label]) => (
        <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)} className={({ isActive }) => `block rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'bg-white text-brand' : 'text-white/85 hover:bg-white/10'}`}>{label}</NavLink>))}
    </nav>);
  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-60 shrink-0 bg-brand lg:block"><div className="p-5 text-lg font-bold text-white">TaskFlow</div>{nav}</aside>
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
          <button className="btn-ghost lg:hidden" aria-expanded={open} onClick={() => setOpen(!open)}>Menu</button>
          <span className="hidden text-sm text-muted lg:block">{me.department}</span>
          <div className="flex items-center gap-3 text-sm"><span className="text-right"><strong>{me.name}</strong><br /><span className="text-xs capitalize text-muted">{me.role}</span></span><button className="btn-ghost" onClick={logout}>Sign out</button></div>
        </header>
        {open && <div className="bg-brand lg:hidden">{nav}</div>}
        <main className="mx-auto max-w-6xl p-4 sm:p-6"><Outlet /></main>
      </div>
    </div>);
}
export default function App() {
  const { me } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<Login />} /><Route path="/set-password" element={<SetPassword />} />
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} /><Route path="tasks" element={<Tasks />} />
        <Route path="tasks/new" element={me?.role === 'employee' ? <Navigate to="/tasks" /> : <TaskNew />} />
        <Route path="tasks/:id" element={<TaskDetail />} /><Route path="meetings" element={<Meetings />} /><Route path="notifications" element={<Notifications />} />
        <Route path="users" element={me?.role === 'employee' ? <Navigate to="/" /> : <Users />} /><Route path="admin" element={me?.role === 'admin' ? <Admin /> : <Navigate to="/" />} />
        <Route path="profile" element={<Profile />} /><Route path="*" element={<p className="p-6">Page not found.</p>} />
      </Route>
    </Routes>);
}
