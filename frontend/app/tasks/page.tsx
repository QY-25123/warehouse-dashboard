import type { Metadata } from 'next';
import type { Task } from '@/lib/types';
import { TaskTable } from '@/components/TaskTable';

export const metadata: Metadata = {
  title: 'Task Monitor | Warehouse Dashboard',
};

// Use the internal Docker service name so SSR works inside the container.
const API_INTERNAL = process.env.API_INTERNAL_URL ?? 'http://backend:8000';

export default async function TasksPage() {
  let initialTasks: Task[] = [];
  try {
    initialTasks = await fetch(`${API_INTERNAL}/tasks`).then((r) => r.json()) as Task[];
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
