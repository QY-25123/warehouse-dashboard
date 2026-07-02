'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

const LINKS = [
  { href: '/',           label: 'Dashboard', exact: true  },
  { href: '/forklifts',  label: 'Forklifts', exact: false },
  { href: '/tasks',      label: 'Tasks',     exact: false },
  { href: '/inventory',  label: 'Inventory', exact: false },
  { href: '/alerts',     label: 'Alerts',    exact: false },
  { href: '/events',     label: 'Events',    exact: false },
] as const;

export function Navigation() {
  const pathname = usePathname();
  const { user, role, signOut, loading } = useAuth();

  if (pathname === '/login') return null;

  return (
    <header className="bg-gray-900 text-white shadow-lg">
      <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
        <span className="text-lg font-semibold tracking-tight">
          Warehouse Dashboard
        </span>
        <nav className="flex gap-6 text-sm font-medium">
          {LINKS.map(({ href, label, exact }) => (
            <Link
              key={href}
              href={href}
              className={
                (exact ? pathname === href : pathname.startsWith(href))
                  ? 'text-blue-400'
                  : 'text-gray-300 hover:text-white transition-colors'
              }
            >
              {label}
            </Link>
          ))}
          {role === 'admin' && (
            <Link
              href="/admin/users"
              className={
                pathname.startsWith('/admin')
                  ? 'text-blue-400'
                  : 'text-gray-300 hover:text-white transition-colors'
              }
            >
              Users
            </Link>
          )}
        </nav>
        {user && !loading && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-400">{user.email}</span>
            <span className="rounded bg-gray-700 px-2 py-0.5 text-xs font-medium uppercase">
              {role}
            </span>
            <button
              onClick={signOut}
              className="text-gray-400 hover:text-white transition-colors"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
