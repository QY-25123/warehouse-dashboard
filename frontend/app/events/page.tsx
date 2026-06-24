import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { Event } from '@/lib/types';
import { EventLog } from '@/components/EventLog';

export const metadata: Metadata = {
  title: 'Event Log | Warehouse Dashboard',
};

const API_INTERNAL = process.env.API_INTERNAL_URL ?? 'http://backend:8000';

export default async function EventsPage() {
  const token = cookies().get('sb-access-token')?.value;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let initialEvents: Event[] = [];
  try {
    const res = await fetch(`${API_INTERNAL}/events?limit=100`, { cache: 'no-store', headers });
    if (res.ok) {
      initialEvents = (await res.json()) as Event[];
    }
  } catch (e) {
    console.error('Failed to fetch initial events:', e);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Real-Time Event Log</h1>
        <p className="mt-1 text-sm text-gray-500">
          Last 100 events · new events prepend live via WebSocket.
        </p>
      </div>
      <EventLog initialEvents={initialEvents} />
    </div>
  );
}
