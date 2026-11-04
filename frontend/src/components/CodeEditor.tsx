import React from 'react';
import Editor from '@monaco-editor/react';
import { useDesignerStore } from '../store/useDesignerStore';
import { registerZplLanguage, ZPL_LANGUAGE_ID } from '../utils/zplLanguage';
import { useT } from '../i18n';

export function CodeEditor() {
  const { zplCode, zplError, onCodeChange } = useDesignerStore();
  const t = useT();

  return (
    <div className="flex flex-col flex-1 overflow-hidden h-full">
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 12px',
        background: 'var(--chrome-surface)',
        borderBottom: '1px solid var(--chrome-border)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--chrome-text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>ZPL</span>
        <span style={{ fontSize: 11, color: 'var(--chrome-text-faint)' }}>{t('code.sync')}</span>
      </div>

      {zplError && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          background: 'var(--status-error-subtle)',
          borderBottom: '1px solid rgba(247,92,92,0.3)',
          fontSize: 11,
          color: 'var(--status-error)',
        }}>
          <span>⚠</span>
          <span>{zplError}</span>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          defaultLanguage={ZPL_LANGUAGE_ID}
          beforeMount={registerZplLanguage}
          theme="vs-dark"
          value={zplCode}
          onChange={v => onCodeChange(v ?? '')}
          options={{
            fontSize: 13,
            minimap: { enabled: false },
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
          }}
        />
      </div>
    </div>
  );
}
