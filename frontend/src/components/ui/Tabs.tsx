'use client';

import { useState, type ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

interface TabsProps {
  items: TabItem[];
  defaultTab?: string;
  ariaLabel: string;
}

/** Keyboard-navigable tabs (arrow keys + tablist semantics). */
export function Tabs({ items, defaultTab, ariaLabel }: TabsProps) {
  const [active, setActive] = useState(defaultTab ?? items[0]?.id);
  return (
    <div>
      <div role="tablist" aria-label={ariaLabel}>
        {items.map((item, index) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={item.id === active}
            aria-controls={`panel-${item.id}`}
            id={`tab-${item.id}`}
            tabIndex={item.id === active ? 0 : -1}
            onClick={() => setActive(item.id)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
              event.preventDefault();
              const delta = event.key === 'ArrowRight' ? 1 : -1;
              const next = items[(index + delta + items.length) % items.length];
              setActive(next.id);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item) =>
        item.id === active ? (
          <div key={item.id} role="tabpanel" id={`panel-${item.id}`} aria-labelledby={`tab-${item.id}`}>
            {item.content}
          </div>
        ) : null,
      )}
    </div>
  );
}
