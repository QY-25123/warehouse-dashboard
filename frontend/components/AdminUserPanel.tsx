'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getClientToken } from '@/lib/client-auth';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

interface UserProfile {
  id: string;
  email: string;
  role: string;
  display_name: string | null;
  created_at: string;
}

async function apiFetch<T>(
  path: string,
  opts: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> ?? {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function AdminUserPanel() {
  const { role } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const isAdmin = role === 'admin';

  const [showForm, setShowForm] = useState(false);
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formName, setFormName] = useState('');
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const [showResetModal, setShowResetModal] = useState(false);
  const [resetting, setResetting]           = useState(false);
  const [resetDone, setResetDone]           = useState(false);
  const [resetError, setResetError]         = useState('');

  async function loadUsers() {
    try {
      const token = await getClientToken();
      const data = await apiFetch<UserProfile[]>('/admin/users', {}, token);
      setUsers(data);
      setError('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    setFormLoading(true);
    try {
      const token = await getClientToken();
      await apiFetch<UserProfile>(
        '/admin/users',
        {
          method: 'POST',
          body: JSON.stringify({
            email: formEmail,
            password: formPassword,
            role: 'operator',
            display_name: formName || undefined,
          }),
        },
        token,
      );
      setFormEmail('');
      setFormPassword('');
      setFormName('');
      setShowForm(false);
      await loadUsers();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Failed to create user');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleReset() {
    setResetting(true);
    setResetError('');
    setResetDone(false);
    try {
      const token = await getClientToken();
      await apiFetch('/admin/reset', { method: 'POST' }, token);
      setResetDone(true);
      setShowResetModal(false);
      setTimeout(() => window.location.href = '/forklifts', 1500);
    } catch (e: unknown) {
      setResetError(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setResetting(false);
    }
  }

  async function handleDelete(userId: string) {
    if (!confirm('Are you sure you want to delete this user?')) return;
    setDeleting((prev) => new Set(prev).add(userId));
    try {
      const token = await getClientToken();
      await apiFetch(`/admin/users/${userId}`, { method: 'DELETE' }, token);
      await loadUsers();
    } catch {
      // keep the row
    } finally {
      setDeleting((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  }

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {loading ? 'Loading...' : `${users.length} user${users.length !== 1 ? 's' : ''}`}
        </p>
        {isAdmin && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
          >
            {showForm ? 'Cancel' : 'Create User'}
          </button>
        )}
      </div>

      {isAdmin && showForm && (
        <form
          onSubmit={handleCreate}
          className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <input
                type="email"
                required
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Password</label>
              <input
                type="password"
                required
                minLength={6}
                value={formPassword}
                onChange={(e) => setFormPassword(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Display Name</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Optional"
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {formError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>
          )}

          <button
            type="submit"
            disabled={formLoading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {formLoading ? 'Creating...' : 'Create'}
          </button>
        </form>
      )}

      {!loading && users.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Email</th>
                <th className="hidden sm:table-cell px-4 py-3 text-left font-medium text-gray-500">Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Role</th>
                <th className="hidden md:table-cell px-4 py-3 text-left font-medium text-gray-500">Created</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{u.email}</td>
                  <td className="hidden sm:table-cell px-4 py-3 text-gray-600">{u.display_name || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium uppercase text-gray-700">
                      {u.role}
                    </span>
                  </td>
                  <td className="hidden md:table-cell px-4 py-3 text-gray-500">{fmtDate(u.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    {isAdmin && (
                      <button
                        onClick={() => handleDelete(u.id)}
                        disabled={deleting.has(u.id)}
                        className="text-red-600 hover:text-red-800 text-xs font-medium disabled:opacity-40"
                      >
                        {deleting.has(u.id) ? 'Deleting...' : 'Delete'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* ── Danger Zone ─────────────────────────────────────────────────── */}
      {isAdmin && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5">
          <h2 className="text-sm font-semibold text-red-700 mb-1">Danger Zone</h2>
          <p className="text-sm text-red-600 mb-4">
            Resets all simulation data — tasks, events, alerts, and inventory
            quantities — back to the original seed state.
          </p>

          {resetDone && (
            <p className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 border border-green-200">
              System reset successfully. The simulator is rebuilding from tick 1.
            </p>
          )}
          {resetError && (
            <p className="mb-3 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">
              {resetError}
            </p>
          )}

          <button
            onClick={() => { setResetDone(false); setResetError(''); setShowResetModal(true); }}
            className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-600 hover:text-white hover:border-red-600"
          >
            Reset System
          </button>
        </div>
      )}

      {/* ── Confirmation Modal ───────────────────────────────────────────── */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">

            {/* Red header bar */}
            <div className="bg-red-600 px-6 py-4 flex items-center gap-3">
              <svg className="h-6 w-6 text-white flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <h2 className="text-lg font-bold text-white">Reset System</h2>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-gray-700 leading-relaxed">
                This will <span className="font-semibold text-red-600">permanently erase</span> all
                simulation data and cannot be undone:
              </p>
              <ul className="space-y-1.5 text-sm text-gray-600">
                {[
                  'All tasks (pending, in-progress, completed)',
                  'All events and audit logs',
                  'All alerts',
                  'All inventory quantities (restored to seed values)',
                  'All forklift positions (restored to seed positions)',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="mt-0.5 h-4 w-4 flex-shrink-0 rounded-full bg-red-100 text-red-600 text-xs flex items-center justify-center font-bold">✕</span>
                    {item}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-gray-500">
                User accounts are <span className="font-medium text-gray-700">not affected</span>.
                The simulator restarts automatically — no backend restart needed.
              </p>

              {resetError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 border border-red-200">
                  {resetError}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 justify-end px-6 py-4 bg-gray-50 border-t border-gray-100">
              <button
                onClick={() => { setShowResetModal(false); setResetError(''); }}
                disabled={resetting}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                disabled={resetting}
                className="rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
              >
                {resetting && (
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                )}
                {resetting ? 'Resetting…' : 'Yes, Reset Everything'}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
