import React from 'react';
import { DesignElement } from '../../types';
import { getZplFont } from '../../utils/zplFonts';
import { FONT0_GLYPH, FONT0_HYPHEN, BASELINE_RATIO, canvasTextParts, fontMetrics, layoutText } from '../../utils/zplText';
import { ROTATION_DEGREES, isQuarterTurn } from '../../utils/rotation';

interface Props {
  element: DesignElement;
  scale: number;
  samples?: Record<string, string> | null;  // sample values shown in place of {{name}}
}

const VARIABLE_TINT = 'rgba(59, 130, 246, 0.22)';

// Text drawn where the printer puts it: each character at its printed position
// (see utils/zplText), in an SVG whose units are printer dots.
export function TextElement({ element, scale, samples }: Props) {
  const m = fontMetrics(element);
  const font = getZplFont(element.fontName);

  // {{name}} placeholders (or their sample values) are tinted
  const parts = canvasTextParts(element, samples);
  const text = parts.map(p => p.text).join('');
  const isVariable = parts.flatMap(p => [...p.text].map(() => !!p.variable));

  const layout = layoutText(element, text);
  const { chars, offsets } = layout;
  // ^FR: white text blended with "difference" prints black on white and white on black
  const reversed = element.reversed ?? false;
  const ink = reversed ? 'white' : 'black';

  const glyphScale = (m.font0 ? FONT0_GLYPH.scaleX : 1) * (m.width / m.height);
  const glyphSize = m.font0 ? m.height * FONT0_GLYPH.emPerHeight : m.height;
  const family = m.font0 ? FONT0_GLYPH.family : font.cssFamily;
  const weight = m.font0 ? FONT0_GLYPH.weight : font.fontWeight;

  const drawn = (
    <div
      title={layout.overflow ? 'The text does not fit in this block: the printer overprints the extra lines on the last one' : undefined}
      style={{
        position: 'relative',
        width: layout.width * scale,
        height: layout.height * scale,
        outline: layout.overflow ? '2px dashed #ef4444' : undefined,
        outlineOffset: 1,
        userSelect: 'none',
      }}
    >
      <svg
        width={layout.width * scale}
        height={layout.height * scale}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        style={{ position: 'absolute', inset: 0, overflow: 'visible', mixBlendMode: reversed ? 'difference' : undefined }}
      >
        {layout.lines.map((line, li) => {
          const xs = (i: number) => line.x + offsets[i] - offsets[line.start];
          const top = line.baseline - BASELINE_RATIO * m.height;

          // Runs of variable characters on this line
          const tints: { from: number; to: number }[] = [];
          for (let i = line.start; i < line.end; i++) {
            if (!isVariable[i]) continue;
            const last = tints[tints.length - 1];
            if (last && last.to === i) last.to = i + 1; else tints.push({ from: i, to: i + 1 });
          }

          // Font 0 hyphens are drawn as bars; spaces are kept as positioned characters
          const glyphs = chars.slice(line.start, line.end).map(ch =>
            ch === ' ' || (m.font0 && ch === '-') ? ' ' : ch
          );

          return (
            <g key={li}>
              {tints.map(t => (
                <rect key={t.from} x={xs(t.from)} y={top} width={xs(t.to) - xs(t.from)} height={m.height} fill={VARIABLE_TINT} rx={2} />
              ))}
              <text
                transform={`scale(${glyphScale}, 1)`}
                x={glyphs.map((_, i) => (xs(line.start + i) / glyphScale).toFixed(2)).join(' ')}
                y={line.baseline}
                fontFamily={family}
                fontWeight={weight}
                fontSize={glyphSize}
                fill={ink}
                style={{ whiteSpace: 'pre' }}
              >
                {glyphs.join('')}
              </text>
              {m.font0 && chars.slice(line.start, line.end).map((ch, i) => ch === '-' && (
                <rect
                  key={`h${i}`}
                  x={xs(line.start + i) + FONT0_HYPHEN.left * m.width}
                  y={line.baseline - FONT0_HYPHEN.top * m.height}
                  width={FONT0_HYPHEN.width * m.width}
                  height={FONT0_HYPHEN.height * m.height}
                  fill={ink}
                />
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );

  // Rotated text (^A orientation R/I/B): ^FO is the top-left of the turned text,
  // so the text is turned about its centre inside its turned footprint
  const orientation = element.orientation ?? 'N';
  if (orientation === 'N') return drawn;
  const w = layout.width * scale;
  const h = layout.height * scale;
  const quarter = isQuarterTurn(orientation);
  const boxW = quarter ? h : w;
  const boxH = quarter ? w : h;
  return (
    <div style={{ position: 'relative', width: boxW, height: boxH }}>
      <div style={{
        position: 'absolute',
        left: (boxW - w) / 2,
        top: (boxH - h) / 2,
        transform: `rotate(${ROTATION_DEGREES[orientation]}deg)`,
        transformOrigin: 'center',
      }}>
        {drawn}
      </div>
    </div>
  );
}
