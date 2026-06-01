import type { Metadata } from 'next';
import type { Alert } from '@/lib/types';
import { AlertPanel } from '@/components/AlertPanel';

export const metadata: Metadata = {
  title: 'Alert Panel | Warehouse Dashboard',
};

// Use the internal Docker service name so SSR works inside the container.
const API_INTERNAL = process.env.API_INTERNAL_URL ?? 'http://backend:8000';

export default async function AlertsPage() {
  // Fetch all alerts (including resolved) so the client can filter locally.
  let initialAlerts: Alert[] = [];
  try {
    initialAlerts = await fetch(`${API_INTERNAL}/alerts?include_resolved=true`).then((r) => r.json()) as Alert[];
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
