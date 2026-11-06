import React from 'react';
import { DesignElement } from '../types';
import { TextElement } from './elements/TextElement';
import { BarcodeElement } from './elements/BarcodeElement';
import { I2of5Element } from './elements/I2of5Element';
import { QRCodeElement } from './elements/QRCodeElement';
import { RectElement } from './elements/RectElement';
import { LineElement } from './elements/LineElement';
import { ImageElement } from './elements/ImageElement';

interface Props {
  elements: DesignElement[];
  labelWidth: number;   // dots
  labelHeight: number;  // dots
  scale: number;        // pixels per dot
}

function drawElement(element: DesignElement, scale: number): React.ReactNode {
  switch (element.type) {
    case 'text': return <TextElement element={element} scale={scale} />;
    case 'barcode128': return <BarcodeElement element={element} scale={scale} />;
    case 'barcodeI2of5': return <I2of5Element element={element} scale={scale} />;
    case 'qrcode': return <QRCodeElement element={element} scale={scale} />;
    case 'rect': return <RectElement element={element} scale={scale} />;
    case 'line': return <LineElement element={element} scale={scale} />;
    case 'image': return <ImageElement element={element} scale={scale} />;
    default: return null; // comment and raw fields are not drawn, as in the editor
  }
}

/**
 * A label drawn as the editor draws it, read-only: the same element components
 * placed at x/y (in dots) times the scale. {{variables}} are shown as typed.
 */
export function LabelPreview({ elements, labelWidth, labelHeight, scale }: Props) {
  return (
    <div style={{
      position: 'relative',
      width: Math.round(labelWidth * scale),
      height: Math.round(labelHeight * scale),
      background: '#fff',
      overflow: 'hidden',
      flexShrink: 0,
      userSelect: 'none',
    }}>
      {elements.map(element => (
        <div key={element.id} style={{ position: 'absolute', left: element.x * scale, top: element.y * scale }}>
          {drawElement(element, scale)}
        </div>
      ))}
    </div>
  );
}
