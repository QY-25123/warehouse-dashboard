'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { InventoryItem, WsMessage } from '@/lib/types';
import { api } from '@/lib/api';
import { getClientToken } from '@/lib/client-auth';
import { useWebSocket } from '@/hooks/useWebSocket';

interface Props {
  initialItems: InventoryItem[];
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function InventoryTable({ initialItems }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<InventoryItem[]>(initialItems);
  const [zoneFilter, setZoneFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  // Client-side fetch so the table is populated even when the SSR fetch failed
  // (e.g. backend unreachable from inside the Next.js Docker container).
  useEffect(() => {
    getClientToken().then((token) =>
      api.inventory.list(undefined, token)
        .then((data) => setItems(data))
        .catch(() => {})
    );
  }, []);

  const onMessage = useCallback((msg: WsMessage) => {
    if (msg.type !== 'inventory_update') return;
    setItems((prev) =>
      prev.map((item) =>
        item.id === msg.payload.id
          ? { ...item, ...msg.payload, last_updated: new Date().toISOString() }
          : item
      )
    );
  }, []);

  const { connected } = useWebSocket({ onMessage });

  // Derive zones from actual data, sorted
  const zones = Array.from(new Set(items.map((i) => i.location_zone))).sort();

  const visible = items.filter((item) => {
    if (zoneFilter !== 'all' && item.location_zone !== zoneFilter) return false;
    if (search && !item.item_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const outOfStock = items.filter((i) => i.quantity === 0).length;
  const lowStock = items.filter((i) => i.quantity > 0 && i.quantity <= 10).length;

  return (
    <div className="space-y-5">
      {/* Live badge */}
      <div className="flex items-center gap-2 text-sm">
        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
        <span className="text-gray-500">
          {connected ? 'Live — quantity changes push instantly' : 'Reconnecting…'}
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-2xl font-bold text-gray-900">{items.length}</p>
          <p className="mt-0.5 text-xs text-gray-500">Total items</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className={`text-2xl font-bold ${outOfStock > 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {outOfStock}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">Out of stock</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className={`text-2xl font-bold ${lowStock > 0 ? 'text-yellow-600' : 'text-gray-900'}`}>
            {lowStock}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">Low stock (≤ 10)</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        {/* Zone dropdown */}
        <select
          value={zoneFilter}
          onChange={(e) => setZoneFilter(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All zones</option>
          {zones.map((z) => (
            <option key={z} value={z}>
              Zone {z}
            </option>
          ))}
        </select>

        {/* Search */}
        <input
          type="search"
          placeholder="Search items…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
              <th className="px-4 py-3">Item Name</th>
              <th className="px-4 py-3">Quantity</th>
              <th className="px-4 py-3">Zone</th>
              <th className="hidden sm:table-cell px-4 py-3">Last Updated</th>
              <th className="px-4 py-3 sr-only">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">
                  No items match the current filter.
                </td>
              </tr>
            ) : (
              visible.map((item) => {
                const isZero = item.quantity === 0;
                const isLow  = !isZero && item.quantity <= 10;
                return (
                  <tr
                    key={item.id}
                    className="cursor-pointer transition-colors hover:bg-blue-50"
                    title="View history & tasks"
                    onClick={() => router.push(`/inventory/${item.id}`)}
                  >
                    <td className="px-4 py-3 font-medium text-gray-800">
                      {item.item_name}
                    </td>
                    <td className="px-4 py-3">
                      {isZero ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                          0 — out of stock
                        </span>
                      ) : isLow ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-yellow-200 bg-yellow-50 px-2.5 py-0.5 text-xs font-medium text-yellow-700">
                          {item.quantity} — low
                        </span>
                      ) : (
                        <span className="tabular-nums font-medium text-gray-700">
                          {item.quantity}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 font-mono text-xs text-gray-600">
                        {item.location_zone}
                      </span>
                    </td>
                    <td className="hidden sm:table-cell whitespace-nowrap px-4 py-3 text-xs text-gray-400">
                      {fmtDate(item.last_updated)}
                    </td>
                    <td className="px-4 py-3 text-gray-300 group-hover:text-gray-500">
                      →
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        Showing {visible.length} of {items.length} items
      </p>
    </div>
  );
}
