import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { api } from '@/lib/api';
import { DashboardClient } from '@/components/DashboardClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Operations Center | Warehouse Dashboard',
};

export default async function HomePage() {
  const token = cookies().get('sb-access-token')?.value;

  const [summary, throughput, forkliftTasks, alerts] = await Promise.allSettled([
    api.analytics.summary(token),
    api.analytics.throughput(token),
    api.analytics.forkliftTasks(token),
    api.alerts.list({ include_resolved: false }, token),
  ]);

  return (
    <DashboardClient
      initialSummary={summary.status === 'fulfilled' ? summary.value : null}
      initialThroughput={throughput.status === 'fulfilled' ? throughput.value : []}
      initialForkliftTasks={forkliftTasks.status === 'fulfilled' ? forkliftTasks.value : []}
      initialAlerts={alerts.status === 'fulfilled' ? alerts.value : []}
    />
  );
}
