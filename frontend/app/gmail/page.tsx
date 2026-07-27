import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { api } from '@/lib/api';
import { GmailOrders } from '@/components/GmailOrders';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Gmail Orders | Warehouse Dashboard',
};

export default async function GmailPage() {
  const token = cookies().get('sb-access-token')?.value;
  const initialOrders = await api.gmail.listOrders(token).catch(() => []);

  return <GmailOrders initialOrders={initialOrders} />;
}
