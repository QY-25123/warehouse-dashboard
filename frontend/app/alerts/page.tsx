import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { Alert } from '@/lib/types';
import { AlertPanel } from '@/components/AlertPanel';

export const metadata: Metadata = {
  title: 'Alert Panel | Warehouse Dashboard',
};

const API_INTERNAL = process.env.API_INTERNAL_URL ?? 'http://backend:8000';

export default async function AlertsPage() {
  const token = cookies().get('sb-access-token')?.value;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let initialAlerts: Alert[] = [];
  try {
    initialAlerts = await fetch(`${API_INTERNAL}/alerts?include_resolved=true`, { headers }).then((r) => r.json()) as Alert[];
  } catch {
    // backend offline at render time
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Alert Panel</h1>
        <p className="mt-1 text-sm text-gray-500">
          Active warehouse alerts — resolve directly from this panel.
        </p>
      </div>
      <AlertPanel initialAlerts={initialAlerts} />
    </div>
  );
}
