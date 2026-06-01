import type { Metadata } from 'next';
import type { InventoryItem } from '@/lib/types';
import { InventoryTable } from '@/components/InventoryTable';

export const metadata: Metadata = {
  title: 'Inventory | Warehouse Dashboard',
};

// Use the internal Docker service name so SSR works inside the container.
const API_INTERNAL = process.env.API_INTERNAL_URL ?? 'http://backend:8000';

export default async function InventoryPage() {
  let initialItems: InventoryItem[] = [];
  try {
    initialItems = await fetch(`${API_INTERNAL}/inventory`).then((r) => r.json()) as InventoryItem[];
  } catch {
    // backend offline at render time
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Inventory Status</h1>
        <p className="mt-1 text-sm text-gray-500">
          All 50 items across zones A1–D4 · quantities update in real time.
        </p>
      </div>
      <InventoryTable initialItems={initialItems} />
    </div>
  );
}
