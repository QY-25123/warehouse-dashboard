import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { api } from '@/lib/api';
import { TelegramDashboard } from '@/components/TelegramDashboard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Telegram Workflow | Warehouse Dashboard',
};

export default async function TelegramPage() {
  const token = cookies().get('sb-access-token')?.value;
  const conversations = await api.telegram.conversations(token).catch(() => []);

  return <TelegramDashboard initialConversations={conversations} />;
}
