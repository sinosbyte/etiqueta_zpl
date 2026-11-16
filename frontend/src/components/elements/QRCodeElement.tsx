import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { DesignElement } from '../../types';
import { qrPrinted, qrText } from '../../utils/qr';

interface Props { element: DesignElement; scale: number; }

export function QRCodeElement({ element, scale }: Props) {
  const [src, setSrc] = useState('');
  const isDynamic = element.dynamic && element.variableName;
  // With a stored magnification the symbol is drawn at the size it prints (modules x magnification)
  // and with the same error correction; without one it fills the box, as it always did
  const explicit = element.qrMagnification !== undefined;
  const printed = explicit ? qrPrinted(element) : null;
  const side = printed ? printed.size : Math.max(element.width, element.height);
  const size = side * scale;
  const text = explicit ? qrText(element).text : (element.value || 'https://example.com');
  const level = element.qrErrorCorrection ?? 'M';

  useEffect(() => {
    if (isDynamic) return;
    QRCode.toDataURL(text, explicit
      ? { width: size, margin: 0, errorCorrectionLevel: level }
      : { width: size, margin: 1 })
      .then(setSrc)
      .catch(() => setSrc(''));
  }, [text, size, isDynamic, explicit, level]);

  if (isDynamic) {
    return (
      <div
        style={{
          width: size,
          height: size,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px dashed #9ca3af',
          background: '#f9fafb',
          userSelect: 'none',
          overflow: 'hidden',
          textAlign: 'center',
          padding: 4,
          boxSizing: 'border-box',
        }}
      >
        <span style={{ fontSize: Math.max(10, size * 0.12), fontFamily: 'monospace', color: '#374151', wordBreak: 'break-all' }}>
          {`{{${element.variableName}}}`}
        </span>
        <span style={{ fontSize: Math.max(9, size * 0.09), color: '#9ca3af' }}>qr</span>
      </div>
    );
  }

  return (
    <div style={{ width: size, height: size }}>
      {src && <img src={src} alt="QR" style={{ width: size, height: size }} />}
    </div>
  );
}
