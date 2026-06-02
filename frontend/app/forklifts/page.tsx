import type { Metadata } from 'next';
import { api } from '@/lib/api';
import type { Forklift } from '@/lib/types';
import { ForkliftTabs } from '@/components/ForkliftTabs';

export const metadata: Metadata = {
  title: 'Operations Center | Warehouse Dashboard',
};

export default async function ForkliftsPage() {
  let initialForklifts: Forklift[] = [];
  try {
    initialForklifts = await api.forklifts.list();
  } catch {
    // backend offline at render time — WS will sync state once connected
  }

  return (
    <div
      className="min-h-screen"
      style={{ background: '#0F1117', borderTop: '3px solid #3B82F6' }}
    >
      <ForkliftTabs initialForklifts={initialForklifts} />
    </div>
  );
}
