import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { InventoryItem, InventoryItemTask, InventoryEvent } from '@/lib/types';
import { InventoryItemDetail } from '@/components/InventoryItemDetail';

const API_INTERNAL = process.env.API_INTERNAL_URL ?? 'http://backend:8000';

interface Props {
  params: { id: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Item #${params.id} | Inventory | Warehouse Dashboard` };
}

export default async function InventoryItemPage({ params }: Props) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) notFound();

  let item: InventoryItem | null = null;
  let tasks: InventoryItemTask[] = [];
  let history: InventoryEvent[] = [];

  try {
    const res = await fetch(`${API_INTERNAL}/inventory/${id}`, { cache: 'no-store' });
    if (res.status === 404) notFound();
    if (res.ok) item = await res.json();
  } catch {
    // backend offline at render time — client component will fetch
  }

  try {
    tasks = await fetch(`${API_INTERNAL}/inventory/${id}/tasks`)
      .then((r) => (r.ok ? r.json() : []));
  } catch { /* offline */ }

  try {
    history = await fetch(`${API_INTERNAL}/inventory/${id}/history`)
      .then((r) => (r.ok ? r.json() : []));
  } catch { /* offline */ }

  if (!item) {
    // SSR failed but not 404 — render shell; client component will load data
    item = {
      id,
      item_name: '',
      quantity: 0,
      location_zone: '',
      last_updated: new Date().toISOString(),
    };
  }

  return (
    <InventoryItemDetail
      initialItem={item}
      initialTasks={tasks}
      initialHistory={history}
    />
  );
}
