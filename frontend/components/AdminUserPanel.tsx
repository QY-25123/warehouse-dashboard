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
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Email</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Role</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Created</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{u.email}</td>
                  <td className="px-4 py-3 text-gray-600">{u.display_name || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium uppercase text-gray-700">
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{fmtDate(u.created_at)}</td>
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
    </div>
  );
}
