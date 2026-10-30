import React from 'react';
import { useDesignerStore } from '../store/useDesignerStore';
import { ElementType } from '../types';
import { toast } from '../store/useToastStore';
import { DEFAULT_THRESHOLD, chooseImage, imagePatch, imageSources, initialImageWidth, rasterize } from '../utils/graphic';

const PALETTE: { type: ElementType; label: string; icon: React.ReactNode }[] = [
  {
    type: 'text',
    label: 'Text',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M3 3h10M8 3v10M5 13h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    type: 'barcode128',
    label: 'Barcode 128',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="3" width="1.5" height="10" fill="currentColor"/>
        <rect x="5" y="3" width="1" height="10" fill="currentColor"/>
        <rect x="7.5" y="3" width="2" height="10" fill="currentColor"/>
        <rect x="11" y="3" width="1" height="10" fill="currentColor"/>
        <rect x="13" y="3" width="1.5" height="10" fill="currentColor"/>
      </svg>
    ),
  },
  {
    type: 'barcodeI2of5',
    label: 'Interleaved 2 of 5',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="3" width="1" height="10" fill="currentColor"/>
        <rect x="4" y="3" width="2.5" height="10" fill="currentColor"/>
        <rect x="7.5" y="3" width="1" height="10" fill="currentColor"/>
        <rect x="9.5" y="3" width="2.5" height="10" fill="currentColor"/>
        <rect x="13" y="3" width="1" height="10" fill="currentColor"/>
      </svg>
    ),
  },
  {
    type: 'qrcode',
    label: 'QR Code',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
        <rect x="3.5" y="3.5" width="2" height="2" fill="currentColor"/>
        <rect x="9" y="2" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
        <rect x="10.5" y="3.5" width="2" height="2" fill="currentColor"/>
        <rect x="2" y="9" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
        <rect x="3.5" y="10.5" width="2" height="2" fill="currentColor"/>
        <rect x="9" y="9" width="2" height="2" fill="currentColor"/>
        <rect x="12" y="9" width="2" height="2" fill="currentColor"/>
        <rect x="9" y="12" width="2" height="2" fill="currentColor"/>
        <rect x="12" y="12" width="2" height="2" fill="currentColor"/>
      </svg>
    ),
  },
  {
    type: 'rect',
    label: 'Box',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="4" width="12" height="8" rx="0.5" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
  },
  {
    type: 'line',
    label: 'Line',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    type: 'image',
    label: 'Image / logo',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1.3"/>
        <circle cx="5.5" cy="6.5" r="1.2" fill="currentColor"/>
        <path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      </svg>
    ),
  },
];

interface Props {
  onNavigateToMyDesigns(): void;
}

export function Sidebar({ onNavigateToMyDesigns }: Props) {
  const { addElement, activeTab, elements, clearAll, labelWidth, labelHeight } = useDesignerStore();

  const handleClearAll = () => {
    if (window.confirm('Remove all elements from the canvas?')) clearAll();
  };

  // A picture (e.g. a logo) becomes a black and white ^GFA image
  const handleAdd = async (type: ElementType) => {
    if (type !== 'image') {
      addElement(type, 50, 50);
      return;
    }
    try {
      const image = await chooseImage();
      if (!image) return;
      const source = { image, threshold: DEFAULT_THRESHOLD };
      const bitmap = rasterize(source, initialImageWidth(image, labelWidth, labelHeight));
      const id = addElement('image', 50, 50, imagePatch(bitmap));
      imageSources.set(id, source);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open the picture');
    }
  };

  return (
    <div style={{
      width: 152,
      background: 'var(--chrome-surface)',
      borderRight: '1px solid var(--chrome-border)',
      display: 'flex',
      flexDirection: 'column',
      padding: '12px 8px',
      gap: 2,
      flexShrink: 0,
      userSelect: 'none',
    }}>
      {activeTab === 'design' && (
        <>
          <span className="panel-label" style={{ padding: '0 6px', marginBottom: 6 }}>Elements</span>

          {PALETTE.map(({ type, label, icon }) => (
            <button
              key={type}
              onClick={() => handleAdd(type)}
              title={`Add ${label}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 10px',
                borderRadius: 6,
                border: '1px solid transparent',
                background: 'transparent',
                color: 'var(--chrome-text-muted)',
                fontSize: 12,
                fontWeight: 500,
                fontFamily: 'inherit',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.1s, color 0.1s',
                width: '100%',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'var(--chrome-elevated)';
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--chrome-text)';
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--chrome-border)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--chrome-text-muted)';
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent';
              }}
            >
              <span style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {icon}
              </span>
              {label}
            </button>
          ))}

          {elements.length > 0 && (
            <>
              <div style={{ height: 1, background: 'var(--chrome-border)', margin: '8px 6px 4px' }} />
              <button
                onClick={handleClearAll}
                title="Remove all elements"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 10px',
                  borderRadius: 6,
                  border: '1px solid transparent',
                  background: 'transparent',
                  color: 'var(--status-error)',
                  fontSize: 12,
                  fontWeight: 500,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  width: '100%',
                  opacity: 0.7,
                  transition: 'opacity 0.1s, background 0.1s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.opacity = '1';
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--status-error-subtle)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.opacity = '0.7';
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 3.5h10M5.5 3.5V2h3v1.5M5.5 6v5M8.5 6v5M3.5 3.5l.5 8h6l.5-8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Clear canvas
              </button>
            </>
          )}
        </>
      )}

      <div style={{ flex: 1 }} />

      <div style={{ height: 1, background: 'var(--chrome-border)', margin: '4px 6px 8px' }} />
      <button
        onClick={onNavigateToMyDesigns}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 10px',
          borderRadius: 6,
          border: '1px solid transparent',
          background: 'transparent',
          color: 'var(--chrome-text-muted)',
          fontSize: 12,
          fontWeight: 500,
          fontFamily: 'inherit',
          cursor: 'pointer',
          width: '100%',
          transition: 'background 0.1s, color 0.1s',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.background = 'var(--chrome-elevated)';
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--chrome-text)';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--chrome-text-muted)';
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2 5a1 1 0 011-1h3.5l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V5z" stroke="currentColor" strokeWidth="1.3"/>
        </svg>
        My Designs
      </button>
    </div>
  );
}
