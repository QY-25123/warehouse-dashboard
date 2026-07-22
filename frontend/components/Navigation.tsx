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
      ? 'text-[#FB923C]'
      : 'text-[#7B778A] hover:text-[#FAF0FF] transition-colors';

  return (
    <header className="border-b" style={{ background: '#1D1A26', borderColor: '#2D293D' }}>
      <div className="mx-auto max-w-7xl flex items-center justify-between px-4 sm:px-6 py-4 gap-4">

        {/* Logo */}
        <span className="text-base sm:text-lg font-semibold tracking-tight shrink-0" style={{ color: '#FB923C' }}>
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
              className={pathname.startsWith('/admin') ? 'text-[#FB923C]' : 'text-[#7B778A] hover:text-[#FAF0FF] transition-colors'}
            >
              Users
            </Link>
          )}
        </nav>

        {/* Desktop user section */}
        {user && !loading && (
          <div className="hidden md:flex items-center gap-3 text-sm shrink-0">
            <span className="text-gray-500 truncate max-w-[160px]">{user.email}</span>
            <span className="rounded px-2 py-0.5 text-xs font-medium uppercase" style={{ background: '#2D293D', color: '#9E9AAA' }}>
              {role}
            </span>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('open-wh-tour'))}
              title="Open onboarding tour"
              className="flex items-center justify-center w-6 h-6 rounded-full transition-colors text-xs font-bold"
              style={{ background: '#2D293D', color: '#9E9AAA' }}
            >
              ?
            </button>
            <button onClick={signOut} className="transition-colors" style={{ color: '#7B778A' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#FAF0FF')}
              onMouseLeave={e => (e.currentTarget.style.color = '#7B778A')}
            >
              Sign out
            </button>
          </div>
        )}

        {/* Mobile hamburger */}
        <button
          className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg transition-colors"
          style={{ color: '#7B778A' }}
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
        <div className="md:hidden px-4 pb-4" style={{ borderTop: '1px solid #2D293D', background: '#1D1A26' }}>
          <nav className="flex flex-col pt-3 gap-1">
            {LINKS.map(({ href, label, exact }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  (exact ? pathname === href : pathname.startsWith(href))
                    ? 'bg-[#FB923C18] text-[#FB923C]'
                    : 'text-[#7B778A] hover:bg-[#252033] hover:text-[#FAF0FF]'
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
                    ? 'bg-[#FB923C18] text-[#FB923C]'
                    : 'text-[#7B778A] hover:bg-[#252033] hover:text-[#FAF0FF]'
                }`}
              >
                Users
              </Link>
            )}
          </nav>

          {user && !loading && (
            <div className="mt-3 pt-3 flex flex-col gap-2" style={{ borderTop: '1px solid #2D293D' }}>
              <span className="px-3 text-sm truncate" style={{ color: '#7B778A' }}>{user.email}</span>
              <div className="flex items-center gap-3 px-3">
                <span className="rounded px-2 py-0.5 text-xs font-medium uppercase" style={{ background: '#2D293D', color: '#9E9AAA' }}>{role}</span>
                <button
                  onClick={() => { window.dispatchEvent(new CustomEvent('open-wh-tour')); setMenuOpen(false); }}
                  className="text-sm transition-colors" style={{ color: '#7B778A' }}
                >
                  ? Help
                </button>
                <button
                  onClick={signOut}
                  className="text-sm transition-colors" style={{ color: '#7B778A' }}
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
