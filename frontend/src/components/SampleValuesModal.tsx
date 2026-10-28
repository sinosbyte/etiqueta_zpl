import React, { useState } from 'react';

interface Props {
  variables: string[];
  initialValues?: Record<string, string>;
  confirmLabel: string;
  onConfirm(values: Record<string, string>): void;
  onClose(): void;
}

export function SampleValuesModal({ variables, initialValues = {}, confirmLabel, onConfirm, onClose }: Props) {
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(variables.map(v => [v, initialValues[v] ?? '']))
  );

  const setValue = (name: string, value: string) =>
    setValues(prev => ({ ...prev, [name]: value }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ width: 300 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--chrome-text)', margin: 0 }}>Sample values</h2>
          <button onClick={onClose} className="chrome-icon-btn" style={{ fontSize: 18 }}>×</button>
        </div>

        <p style={{ fontSize: 11, color: 'var(--chrome-text-faint)', marginBottom: 12, lineHeight: 1.5 }}>
          Enter example values to render a preview. Leave blank to use the variable name.
        </p>

        <div className="chrome-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto', marginBottom: 16 }}>
          {variables.map(name => (
            <div key={name}>
              <label style={{
                display: 'block',
                fontSize: 10,
                color: 'var(--accent)',
                marginBottom: 4,
                fontFamily: 'monospace',
              }}>
                {`{{${name}}}`}
              </label>
              <input
                type="text"
                className="chrome-input"
                value={values[name] ?? ''}
                placeholder={name}
                onChange={e => setValue(name, e.target.value)}
              />
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => onConfirm(values)}
            className="chrome-btn chrome-btn-primary"
            style={{ flex: 1, justifyContent: 'center' }}
          >
            {confirmLabel}
          </button>
          <button onClick={onClose} className="chrome-btn chrome-btn-ghost">Cancel</button>
        </div>
      </div>
    </div>
  );
}
