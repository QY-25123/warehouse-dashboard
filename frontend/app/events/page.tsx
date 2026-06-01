import type { Metadata } from 'next';
import type { Event } from '@/lib/types';
import { EventLog } from '@/components/EventLog';

export const metadata: Metadata = {
  title: 'Event Log | Warehouse Dashboard',
};

// Use the internal Docker service name so SSR works inside the container.
const API_INTERNAL = process.env.API_INTERNAL_URL ?? 'http://backend:8000';

export default async function EventsPage() {
  let initialEvents: Event[] = [];
  try {
    initialEvents = await fetch(`${API_INTERNAL}/events?limit=100`).then((r) => r.json()) as Event[];
  } catch {
    // backend offline at render time
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
