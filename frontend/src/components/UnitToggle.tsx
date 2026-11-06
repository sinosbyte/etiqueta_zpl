import React from 'react';
import { Unit, useUnitStore } from '../store/useUnitStore';
import { useT } from '../i18n';

/** mm / dots switch for the measurement fields. */
export function UnitToggle() {
  const t = useT();
  const { unit, setUnit } = useUnitStore();
  const options: { value: Unit; label: string }[] = [
    { value: 'mm', label: 'mm' },
    { value: 'dots', label: t('unit.dots') },
  ];
  return (
    <div
      title={t('toolbar.unitTitle')}
      style={{ display: 'flex', background: 'var(--chrome-elevated)', borderRadius: 6, padding: 2, gap: 1 }}
    >
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => setUnit(o.value)}
          style={{
            padding: '2px 8px',
            borderRadius: 4,
            border: 'none',
            fontSize: 11,
            fontWeight: 500,
            fontFamily: 'inherit',
            cursor: 'pointer',
            background: unit === o.value ? 'var(--chrome-surface)' : 'transparent',
            color: unit === o.value ? 'var(--chrome-text)' : 'var(--chrome-text-muted)',
            boxShadow: unit === o.value ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
