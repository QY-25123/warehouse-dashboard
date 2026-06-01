'use client';

import { useState } from 'react';
import type { Forklift } from '@/lib/types';
import { ForkliftMap } from '@/components/ForkliftMap';
import { ForkliftHeatmap } from '@/components/ForkliftHeatmap';

type Tab = 'map' | 'heatmap';

interface Props {
  initialForklifts: Forklift[];
}

export function ForkliftTabs({ initialForklifts }: Props) {
  const [tab, setTab] = useState<Tab>('map');

  return (
    <div className="space-y-5">
      {/* Tab strip */}
      <div className="flex gap-1 rounded-lg border border-gray-200 bg-gray-100 p-1 w-fit">
        {([
          { id: 'map',     label: 'Live Map'         },
          { id: 'heatmap', label: 'Traffic Heatmap'  },
        ] as { id: Tab; label: string }[]).map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-md px-5 py-1.5 text-sm font-medium transition-colors ${
              tab === id
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'map' ? (
        <ForkliftMap initialForklifts={initialForklifts} />
      ) : (
        <ForkliftHeatmap />
      )}
    </div>
  );
}
