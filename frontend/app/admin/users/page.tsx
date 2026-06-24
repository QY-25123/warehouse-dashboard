import type { Metadata } from 'next';
import { AdminUserPanel } from '@/components/AdminUserPanel';

export const metadata: Metadata = {
  title: 'User Management | Warehouse Dashboard',
};

export default function AdminUsersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
        <p className="mt-1 text-sm text-gray-500">
          Create, manage, and remove user accounts.
        </p>
      </div>
      <AdminUserPanel />
    </div>
  );
}
