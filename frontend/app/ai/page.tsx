import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { api } from '@/lib/api';
import { AIWorkflow } from '@/components/AIWorkflow';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AI Task Planner | Warehouse Dashboard',
};

export default async function AIPage() {
  const token = cookies().get('sb-access-token')?.value;

  const capacities = await api.ai.getCapacities(token).catch(() => []);

  return <AIWorkflow initialCapacities={capacities} />;
}
