import React, { useMemo } from 'react';
import { DesignElement } from '../../types';
import { useDesignerStore } from '../../store/useDesignerStore';
import { useT } from '../../i18n';
import { useSimulationStore } from '../../store/useSimulationStore';
import { recordValue } from '../../utils/recordValue';
import { tableData } from '../../utils/simulation';
import { tableBox } from '../../utils/tableBox';
import { BASELINE_RATIO, FONT0_GLYPH, fontMetrics, layoutText } from '../../utils/zplText';
import { getZplFont } from '../../utils/zplFonts';
import {
  TABLE_DEFAULT_BORDER, TABLE_DEFAULT_FONT_SIZE, TABLE_DEFAULT_PADDING, TABLE_DEFAULT_ROW_HEIGHT,
  tableColumns, tableOverflows, tableSlotName, visibleRecords,
} from '../../utils/tableEdit';

interface Props { element: DesignElement; scale: number; }

const EMPTY_TINT = '#9ca3af';
const WARN = '#dc2626';

// The table as the generator prints it: a header row (if any), a row for each record the label holds, the
// lines between them, and in each cell the title or the value of its column. Drawn in an SVG whose units are
// printer dots (like the text element). The cells show the test records, in order; a cell with no value shows
// the {{variable}} it will print, so the table is readable before there is any data.
export function TableElement({ element, scale }: Props) {
  const t = useT();
  const records = useDesignerStore(s => s.records);
  const view = useSimulationStore(s => s.view);

  const columns = tableColumns(element);
  const box = tableBox(element);
  const overflows = useMemo(() => tableOverflows(element, records), [element, records]);

  if (columns.length === 0) {
    return (
      <div
        title={t('table.noColumns')}
        style={{
          width: box.width * scale, height: box.height * scale, boxSizing: 'border-box', display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: 4, border: `2px dashed ${WARN}`, background: '#fef2f2',
          color: WARN, fontSize: 11, textAlign: 'center', userSelect: 'none',
        }}
      >
        {t('table.noColumns')}
      </div>
    );
  }

  const rowHeight = Math.max(1, Math.round(element.rowHeight ?? TABLE_DEFAULT_ROW_HEIGHT));
  const header = element.headerRow ?? true;
  const capacity = Math.max(1, Math.round(element.rowsPerPage ?? 1));
  const rows = capacity + (header ? 1 : 0);
  const border = Math.max(0, Math.round(element.thickness ?? TABLE_DEFAULT_BORDER));
  const padding = Math.max(0, Math.round(element.cellPadding ?? TABLE_DEFAULT_PADDING));
  const fontSize = Math.max(1, Math.round(element.fontSize ?? TABLE_DEFAULT_FONT_SIZE));

  const colX: number[] = [];
  let at = 0;
  for (const c of columns) { colX.push(at); at += Math.max(1, c.width); }

  // What the table shows. While a simulation label is being viewed and it is this table's page, the records of that
  // label (the backend's distribution), and the slots it leaves empty print empty. Otherwise the editing preview:
  // the first records on page 1, and on page 2 only the variables (which records reach it is the simulation's to say).
  const { data, simulated } = tableData(element, records, view);
  const cellText = (row: number, column: number): { text: string; empty: boolean } => {
    const c = columns[column];
    if (header && row === 0) return { text: c.header, empty: false };
    const slot = row - (header ? 1 : 0) + 1;
    const value = recordValue(data[slot - 1], c.field);
    if (value) return { text: value, empty: false };
    if (simulated) return { text: '', empty: false };
    return { text: `{{${tableSlotName(c.field, slot, capacity)}}}`, empty: true };
  };

  const cell = { ...element, type: 'text' as const, block: undefined, fontSize, fontWidth: element.fontWidth, fontName: element.fontName ?? '0' };
  const m = fontMetrics(cell);
  const font = getZplFont(cell.fontName);
  const glyphScale = (m.font0 ? FONT0_GLYPH.scaleX : 1) * (m.width / m.height);
  const glyphSize = m.font0 ? m.height * FONT0_GLYPH.emPerHeight : m.height;
  const family = m.font0 ? FONT0_GLYPH.family : font.cssFamily;
  const weight = m.font0 ? FONT0_GLYPH.weight : font.fontWeight;
  const textTop = Math.max(0, Math.round((rowHeight - fontSize) / 2));
  const overflowing = new Set(overflows.map(o => `${o.column}`));

  const lineColor = border > 0 ? '#000' : '#d1d5db';
  const lineWidth = border > 0 ? border : 1;

  const texts: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    columns.forEach((c, ci) => {
      const { text, empty } = cellText(r, ci);
      if (text === '') return;
      const layout = layoutText(cell, text);
      const available = Math.max(1, c.width - 2 * padding);
      const lineW = layout.offsets[layout.chars.length];
      // Text wider than its column starts at the left edge: it runs into the next column, and is flagged
      const slack = Math.max(0, available - lineW);
      const shift = c.align === 'C' ? slack / 2 : c.align === 'R' ? slack : 0;
      const x0 = colX[ci] + padding + shift;
      const baseline = r * rowHeight + textTop + BASELINE_RATIO * fontSize;
      texts.push(
        <text
          key={`${r}-${ci}`}
          transform={`scale(${glyphScale}, 1)`}
          x={layout.chars.map((_, i) => ((x0 + layout.offsets[i]) / glyphScale).toFixed(2)).join(' ')}
          y={baseline}
          fontFamily={family}
          fontWeight={weight}
          fontSize={glyphSize}
          fill={empty ? EMPTY_TINT : '#000'}
          style={{ whiteSpace: 'pre' }}
        >
          {layout.chars.join('')}
        </text>,
      );
    });
  }

  return (
    <svg
      width={box.width * scale}
      height={box.height * scale}
      viewBox={`0 0 ${box.width} ${box.height}`}
      style={{ display: 'block', overflow: 'visible', userSelect: 'none' }}
      role="img"
      aria-label={t('element.table')}
    >
      <rect x={0} y={0} width={box.width} height={box.height} fill="white" fillOpacity={0.001} />
      {/* Outer box, then the lines between rows and columns (a pale dashed guide when the borders are off) */}
      <rect
        x={lineWidth / 2} y={lineWidth / 2} width={box.width - lineWidth} height={box.height - lineWidth}
        fill="none" stroke={lineColor} strokeWidth={lineWidth} strokeDasharray={border > 0 ? undefined : '6 4'}
      />
      {Array.from({ length: rows - 1 }, (_, i) => (
        <rect key={`r${i}`} x={0} y={(i + 1) * rowHeight} width={box.width} height={lineWidth} fill={lineColor} fillOpacity={border > 0 ? 1 : 0.8} />
      ))}
      {columns.slice(1).map((_, i) => (
        <rect key={`c${i}`} x={colX[i + 1]} y={0} width={lineWidth} height={box.height} fill={lineColor} fillOpacity={border > 0 ? 1 : 0.8} />
      ))}
      {header && <rect x={0} y={0} width={box.width} height={rowHeight} fill="#000" fillOpacity={0.06} />}
      {texts}
      {/* A column whose title or values do not fit: a dashed red outline and a mark; the detail is in the tooltip */}
      {columns.map((c, ci) => overflowing.has(`${ci}`) && (
        <g key={`w${ci}`}>
          <title>{t('table.overflowTip', { column: c.header || c.field, field: c.field })}</title>
          <rect x={colX[ci] + 1} y={1} width={Math.max(1, c.width - 2)} height={box.height - 2} fill="none" stroke={WARN} strokeWidth={Math.max(2, 2 / scale)} strokeDasharray="8 5" />
          <circle cx={colX[ci] + Math.max(1, c.width) - 9} cy={9} r={7} fill={WARN} />
          <text x={colX[ci] + Math.max(1, c.width) - 9} y={13} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">!</text>
        </g>
      ))}
    </svg>
  );
}
