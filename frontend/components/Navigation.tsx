'use client';

import { useState, useEffect } from 'react';
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
  { href: '/ai',         label: 'AI Tasks',  exact: false },
  { href: '/telegram',   label: 'Telegram',  exact: false },
] as const;

export function Navigation() {
  const pathname = usePathname();
  const { user, role, signOut, loading } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close mobile menu on route change.
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  if (pathname === '/login') return null;

  const linkClass = (href: string, exact: boolean) =>
    (exact ? pathname === href : pathname.startsWith(href))
      ? 'text-blue-600'
      : 'text-gray-600 hover:text-gray-900 transition-colors';

  return (
    <header className="bg-white text-gray-900 shadow-sm border-b border-gray-200">
      <div className="mx-auto max-w-7xl flex items-center justify-between px-4 sm:px-6 py-4 gap-4">

        {/* Logo */}
        <span className="text-base sm:text-lg font-semibold tracking-tight shrink-0">
          Warehouse Dashboard
        </span>

        {/* Desktop nav */}
        <nav className="hidden md:flex gap-5 text-sm font-medium flex-1 justify-center">
          {LINKS.map(({ href, label, exact }) => (
            <Link key={href} href={href} className={linkClass(href, exact)}>
              {label}
            </Link>
          ))}
          {role === 'admin' && (
            <Link
              href="/admin/users"
              className={pathname.startsWith('/admin') ? 'text-blue-600' : 'text-gray-600 hover:text-gray-900 transition-colors'}
            >
              Users
            </Link>
          )}
        </nav>

        {/* Desktop user section */}
        {user && !loading && (
          <div className="hidden md:flex items-center gap-3 text-sm shrink-0">
            <span className="text-gray-500 truncate max-w-[160px]">{user.email}</span>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium uppercase text-gray-600">
              {role}
            </span>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('open-wh-tour'))}
              title="Open onboarding tour"
              className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-900 transition-colors text-xs font-bold"
            >
              ?
            </button>
            <button onClick={signOut} className="text-gray-500 hover:text-gray-900 transition-colors">
              Sign out
            </button>
          </div>
        )}

        {/* Mobile hamburger */}
        <button
          className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        >
          {menuOpen ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="md:hidden border-t border-gray-200 bg-white px-4 pb-4">
          <nav className="flex flex-col pt-3 gap-1">
            {LINKS.map(({ href, label, exact }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  (exact ? pathname === href : pathname.startsWith(href))
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                {label}
              </Link>
            ))}
            {role === 'admin' && (
              <Link
                href="/admin/users"
                onClick={() => setMenuOpen(false)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  pathname.startsWith('/admin')
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                Users
              </Link>
            )}
          </nav>

          {user && !loading && (
            <div className="mt-3 pt-3 border-t border-gray-200 flex flex-col gap-2">
              <span className="px-3 text-sm text-gray-500 truncate">{user.email}</span>
              <div className="flex items-center gap-3 px-3">
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium uppercase text-gray-600">{role}</span>
                <button
                  onClick={() => { window.dispatchEvent(new CustomEvent('open-wh-tour')); setMenuOpen(false); }}
                  className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
                >
                  ? Help
                </button>
                <button
                  onClick={signOut}
                  className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
                >
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
