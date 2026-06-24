import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { Task } from '@/lib/types';
import { TaskTable } from '@/components/TaskTable';

export const metadata: Metadata = {
  title: 'Task Monitor | Warehouse Dashboard',
};

const API_INTERNAL = process.env.API_INTERNAL_URL ?? 'http://backend:8000';

export default async function TasksPage() {
  const token = cookies().get('sb-access-token')?.value;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let initialTasks: Task[] = [];
  try {
    initialTasks = await fetch(`${API_INTERNAL}/tasks`, { headers }).then((r) => r.json()) as Task[];
  } catch {
    // backend offline at render time
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Task Monitor</h1>
        <p className="mt-1 text-sm text-gray-500">
          Live task queue — updates pushed via WebSocket as the simulator runs.
        </p>
      </div>
      <TaskTable initialTasks={initialTasks} />
    </div>
  );
}
