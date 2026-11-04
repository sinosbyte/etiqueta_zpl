import React, { useState } from 'react';
import { useDesignerStore } from '../store/useDesignerStore';
import { exportZpl, ExportFormat } from '../utils/zplClient';
import { useT, MessageKey } from '../i18n';

interface Props { onClose(): void; zplOverride?: string; }

const FORMATS: { value: ExportFormat; label: string; description: MessageKey; ext: string }[] = [
  { value: 'png', label: 'PNG',  description: 'export.png', ext: '.png' },
  { value: 'pdf', label: 'PDF',  description: 'export.pdf', ext: '.pdf' },
  { value: 'epl', label: 'EPL',  description: 'export.epl', ext: '.epl' },
  { value: 'zpl', label: 'ZPL',  description: 'export.zpl', ext: '.zpl' },
];

export function ExportModal({ onClose, zplOverride }: Props) {
  const { zplCode, labelWidth, labelHeight } = useDesignerStore();
  const t = useT();
  const [format, setFormat] = useState<ExportFormat>('png');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleDownload = async () => {
    setLoading(true);
    setError('');
    try {
      const blob = await exportZpl(zplOverride ?? zplCode, labelWidth, labelHeight, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `label.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('export.failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ width: 320 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--chrome-text)', margin: 0 }}>{t('export.title')}</h2>
          <button
            onClick={onClose}
            className="chrome-icon-btn"
            style={{ fontSize: 18, color: 'var(--chrome-text-faint)' }}
          >×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          {FORMATS.map(f => (
            <label
              key={f.value}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                borderRadius: 6,
                cursor: 'pointer',
                border: `1px solid ${format === f.value ? 'var(--accent)' : 'var(--chrome-border)'}`,
                background: format === f.value ? 'var(--accent-subtle)' : 'var(--chrome-bg)',
                transition: 'border-color 0.1s, background 0.1s',
              }}
            >
              <input
                type="radio"
                name="format"
                value={f.value}
                checked={format === f.value}
                onChange={() => setFormat(f.value)}
                style={{ accentColor: 'var(--accent)' }}
              />
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--chrome-text)' }}>{f.label}</span>
                <span style={{ fontSize: 11, color: 'var(--chrome-text-muted)', marginLeft: 8 }}>{t(f.description)}</span>
              </div>
              <span style={{ fontSize: 10, color: 'var(--chrome-text-faint)', fontFamily: 'monospace' }}>{f.ext}</span>
            </label>
          ))}
        </div>

        {error && (
          <p style={{ fontSize: 11, color: 'var(--status-error)', marginBottom: 12 }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleDownload}
            disabled={loading}
            className="chrome-btn chrome-btn-success"
            style={{ flex: 1, justifyContent: 'center', opacity: loading ? 0.6 : 1 }}
          >
            {loading ? t('export.exporting') : t('export.download')}
          </button>
          <button onClick={onClose} className="chrome-btn chrome-btn-ghost">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  );
}
