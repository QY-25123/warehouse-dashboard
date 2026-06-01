'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/forklifts',  label: 'Forklifts'  },
  { href: '/tasks',      label: 'Tasks'      },
  { href: '/inventory',  label: 'Inventory'  },
  { href: '/alerts',     label: 'Alerts'     },
  { href: '/events',     label: 'Events'     },
] as const;

export function Navigation() {
  const pathname = usePathname();

  return (
    <header className="bg-gray-900 text-white shadow-lg">
      <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
        <span className="text-lg font-semibold tracking-tight">
          Warehouse Dashboard
        </span>
        <nav className="flex gap-6 text-sm font-medium">
          {LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={
                pathname.startsWith(href)
                  ? 'text-blue-400'
                  : 'text-gray-300 hover:text-white transition-colors'
              }
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
