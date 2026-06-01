import type { Metadata } from 'next';
import { api } from '@/lib/api';
import type { Forklift } from '@/lib/types';
import { ForkliftTabs } from '@/components/ForkliftTabs';

export const metadata: Metadata = {
  title: 'Forklift Tracking | Warehouse Dashboard',
};

export default async function ForkliftsPage() {
  let initialForklifts: Forklift[] = [];
  try {
    initialForklifts = await api.forklifts.list();
  } catch {
    // backend offline at render time — WS will sync state once connected
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Forklift Tracking</h1>
        <p className="mt-1 text-sm text-gray-500">
          Real-time positions and statuses · Traffic heatmap by zone.
        </p>
      </div>
      <ForkliftTabs initialForklifts={initialForklifts} />
    </div>
  );
}
