import React, { useMemo, useState } from 'react';
import { DesignElement, TableColumn } from '../types';
import { useDesignerStore } from '../store/useDesignerStore';
import { useMeasure } from '../store/useUnitStore';
import { useT } from '../i18n';
import { conflictsOfTable, pagesText } from '../utils/variableOrigin';
import { NumberInput } from './NumberInput';
import {
  TABLE_DEFAULT_BORDER, TABLE_DEFAULT_FONT_SIZE, TABLE_DEFAULT_PADDING, TABLE_DEFAULT_ROW_HEIGHT, TABLE_FIELD_PATTERN,
  TABLE_MAX_CAPACITY, TABLE_MAX_COLUMNS, TABLE_MAX_PADDING, TABLE_MAX_ROW_HEIGHT, TABLE_MIN_COLUMN_WIDTH, TABLE_MIN_ROW_HEIGHT,
  addColumn, availableFields, bordersPatch, cellPaddingPatch, fontSizePatch, hasBorders, headerRowPatch, minTableWidth,
  moveColumn, removeColumn, rowHeightPatch, rowsPerPagePatch, sanitizeField, setTableWidth, tableColumns, tableIssues,
  tableOverflows, tableWidth, updateColumn,
} from '../utils/tableEdit';

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 500, color: 'var(--chrome-text-faint)', marginBottom: 4,
  textTransform: 'uppercase', letterSpacing: '0.06em',
};
const noteStyle: React.CSSProperties = { fontSize: 10, color: 'var(--chrome-text-faint)', margin: '4px 0 0', lineHeight: 1.5 };
const warnStyle: React.CSSProperties = { fontSize: 10, color: '#dc2626', margin: '4px 0 0', lineHeight: 1.5 };

// A text field that applies on Enter or on leaving it, and goes back to the saved value when what was typed is
// not accepted (an empty or invalid variable name), saying why
function CommitText({ value, onCommit, sanitize, validate, maxLength, list, ariaLabel, placeholder }: {
  value: string;
  onCommit(value: string): void;
  sanitize?(text: string): string;
  validate?(text: string): boolean;
  maxLength?: number;
  list?: string;
  ariaLabel: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const t = useT();
  const finish = () => {
    if (draft === null) return;
    if (draft !== value) {
      if (validate && !validate(draft)) setInvalid(true);
      else { setInvalid(false); onCommit(draft); }
    }
    setDraft(null);
  };
  return (
    <>
      <input
        className="chrome-input"
        type="text"
        value={draft ?? value}
        list={list}
        maxLength={maxLength}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        style={invalid ? { borderColor: '#dc2626' } : undefined}
        onChange={e => { setInvalid(false); setDraft(sanitize ? sanitize(e.target.value) : e.target.value); }}
        onBlur={finish}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setDraft(null); setInvalid(false); }
        }}
      />
      {invalid && <p style={warnStyle}>{t('table.invalidField')}</p>}
    </>
  );
}

const check = (label: string, checked: boolean, onChange: (on: boolean) => void, id: string) => (
  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
    <input type="checkbox" checked={checked} data-testid={id} onChange={e => onChange(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
    <span style={{ fontSize: 12, color: 'var(--chrome-text-muted)' }}>{label}</span>
  </label>
);

/** The properties of the selected table: how it looks, how many records it holds, and its columns. */
export function TablePanel({ el }: { el: DesignElement }) {
  const t = useT();
  const m = useMeasure();
  const updateElement = useDesignerStore(s => s.updateElement);
  const elements = useDesignerStore(s => s.elements);
  const records = useDesignerStore(s => s.records);

  const columns = tableColumns(el);
  const issues = useMemo(() => tableIssues(el), [el]);
  const overflows = useMemo(() => tableOverflows(el, records), [el, records]);
  const fields = useMemo(() => availableFields(elements, records, el), [elements, records, el]);
  const listId = `table-fields-${el.id}`;
  const apply = (patch: Partial<DesignElement> | null) => { if (patch) updateElement(el.id, patch); };
  const total = tableWidth(el);
  const capacity = Math.max(1, Math.round(el.rowsPerPage ?? 1));

  const issueText = (i: ReturnType<typeof tableIssues>[number]): string => {
    switch (i.kind) {
      case 'noColumns': return t('table.noColumns');
      case 'emptyField': return t('table.issueEmptyField', { n: i.column + 1 });
      case 'duplicateField': return t('table.issueDuplicate', { n: i.column + 1, field: i.field });
      case 'caseClash': return t('table.issueCase', { n: i.column + 1, field: i.field, other: i.other });
    }
  };

  const columnCard = (c: TableColumn, i: number) => {
    const over = overflows.filter(o => o.column === i);
    return (
      <div key={i} data-testid={`table-column-${i}`} style={{ border: '1px solid var(--chrome-border)', borderRadius: 6, padding: 8, marginBottom: 8, background: 'var(--chrome-elevated)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)', flex: 1 }}>{t('table.column', { n: i + 1 })}</span>
          <button type="button" className="chrome-icon-btn" aria-label={t('table.moveUp')} title={t('table.moveUp')} disabled={i === 0}
            style={{ opacity: i === 0 ? 0.3 : 1 }} onClick={() => apply(moveColumn(el, i, -1))}>◀</button>
          <button type="button" className="chrome-icon-btn" aria-label={t('table.moveDown')} title={t('table.moveDown')} disabled={i === columns.length - 1}
            style={{ opacity: i === columns.length - 1 ? 0.3 : 1 }} onClick={() => apply(moveColumn(el, i, 1))}>▶</button>
          <button type="button" className="chrome-icon-btn" aria-label={t('table.removeColumn')}
            title={columns.length <= 1 ? t('table.lastColumn') : t('table.removeColumn')} disabled={columns.length <= 1}
            style={{ opacity: columns.length <= 1 ? 0.3 : 1 }} onClick={() => apply(removeColumn(el, i))}>✕</button>
        </div>

        <label style={labelStyle}>{t('table.header')}</label>
        <CommitText
          ariaLabel={`${t('table.header')} ${i + 1}`}
          value={c.header}
          maxLength={60}
          onCommit={v => apply(updateColumn(el, i, { header: v }))}
        />

        <label style={{ ...labelStyle, marginTop: 6 }} title={t('table.fieldTitle')}>{t('table.field')}</label>
        <CommitText
          ariaLabel={`${t('table.field')} ${i + 1}`}
          value={c.field}
          list={listId}
          sanitize={sanitizeField}
          validate={v => TABLE_FIELD_PATTERN.test(v)}
          onCommit={v => apply(updateColumn(el, i, { field: v }))}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
          <div>
            <label style={labelStyle}>{`${t('table.width')} ${m.label}`}</label>
            <NumberInput key={m.unit} min={m.show(TABLE_MIN_COLUMN_WIDTH)} decimals={m.decimals} step={m.step} value={m.show(c.width)}
              onCommit={v => apply(updateColumn(el, i, { width: Math.max(TABLE_MIN_COLUMN_WIDTH, Math.round(m.read(v))) }))}
            />
          </div>
          <div>
            <label style={labelStyle}>{t('table.align')}</label>
            <select className="chrome-input" value={c.align} aria-label={`${t('table.align')} ${i + 1}`}
              onChange={e => apply(updateColumn(el, i, { align: e.target.value as TableColumn['align'] }))}>
              <option value="L">{t('panel.left')}</option>
              <option value="C">{t('panel.center')}</option>
              <option value="R">{t('panel.right')}</option>
            </select>
          </div>
        </div>
        {over.map(o => (
          <p key={o.where} style={warnStyle} role="alert">
            {t(o.where === 'header' ? 'table.overflowHeader' : 'table.overflowCell', { needed: o.needed, available: o.available })}
          </p>
        ))}
      </div>
    );
  };

  return (
    <div style={{ borderTop: '1px solid var(--chrome-border)', paddingTop: 12, marginTop: 12 }}>
      <datalist id={listId}>{fields.map(f => <option key={f} value={f} />)}</datalist>

      <h4 style={{ ...labelStyle, marginBottom: 8 }}>{t('table.general')}</h4>

      <div style={{ marginBottom: 8 }}>
        <label style={labelStyle} title={t('table.totalWidthTitle')}>{`${t('table.totalWidth')} ${m.label}`}</label>
        <NumberInput key={m.unit} min={m.show(minTableWidth(el))} decimals={m.decimals} step={m.step} value={m.show(total)}
          onCommit={v => apply(setTableWidth(el, Math.max(minTableWidth(el), Math.round(m.read(v)))))}
        />
        <p style={noteStyle}>{t('table.totalWidthNote')}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <div>
          <label style={labelStyle}>{`${t('table.rowHeight')} ${m.label}`}</label>
          <NumberInput key={m.unit} min={m.show(TABLE_MIN_ROW_HEIGHT)} max={m.show(TABLE_MAX_ROW_HEIGHT)} decimals={m.decimals} step={m.step}
            value={m.show(Math.round(el.rowHeight ?? TABLE_DEFAULT_ROW_HEIGHT))}
            onCommit={v => apply(rowHeightPatch(m.read(v)))}
          />
        </div>
        <div>
          <label style={labelStyle} title={t('table.rowsTitle')}>{t('table.rows')}</label>
          <NumberInput min={1} max={TABLE_MAX_CAPACITY} decimals={0} value={capacity}
            onCommit={v => apply(rowsPerPagePatch(v))}
          />
        </div>
        <div>
          <label style={labelStyle} title={t('table.paddingTitle')}>{`${t('table.padding')} ${m.label}`}</label>
          <NumberInput key={m.unit} min={0} max={m.show(TABLE_MAX_PADDING)} decimals={m.decimals} step={m.step}
            value={m.show(Math.round(el.cellPadding ?? TABLE_DEFAULT_PADDING))}
            onCommit={v => apply(cellPaddingPatch(m.read(v)))}
          />
        </div>
        <div>
          <label style={labelStyle}>{t('panel.fontSize')}</label>
          <NumberInput min={1} max={999} decimals={0} value={Math.round(el.fontSize ?? TABLE_DEFAULT_FONT_SIZE)}
            onCommit={v => apply(fontSizePatch(v))}
          />
        </div>
      </div>
      {capacity > 1 && <p style={noteStyle}>{t('table.rowsNote', { n: capacity })}</p>}

      <div style={{ marginTop: 8 }}>
        {check(t('table.showHeader'), el.headerRow ?? true, on => apply(headerRowPatch(on)), 'table-header')}
        {check(t('table.showBorders'), hasBorders(el), on => apply(bordersPatch(on)), 'table-borders')}
      </div>
      {hasBorders(el) && (el.thickness ?? TABLE_DEFAULT_BORDER) !== TABLE_DEFAULT_BORDER && (
        <p style={noteStyle}>{t('table.borderKept', { n: el.thickness ?? 0 })}</p>
      )}

      <h4 style={{ ...labelStyle, margin: '12px 0 8px' }}>{t('table.columns')} ({columns.length}/{TABLE_MAX_COLUMNS})</h4>
      {/* Cells of this table that have the name of a free variable of the label: the cell is printed instead */}
      {(() => {
        const found = conflictsOfTable(elements, el.id);
        const collisions = found.filter(c => c.severity === 'collision');
        const ambiguous = found.filter(c => c.severity === 'ambiguous');
        const names = (items: typeof found) => items.map(c => `{{${c.name}}}`).join(', ');
        const pages = (items: typeof found, key: 'collidingPages' | 'freePages') => pagesText([...new Set(items.flatMap(c => c[key]))].sort((a, b) => a - b));
        return (
          <>
            {collisions.length > 0 && (
              <p role="alert" data-testid="table-conflict" style={{ ...warnStyle, color: 'var(--status-warning)', marginBottom: 8 }}>
                {t('conflict.table', { names: names(collisions), pages: pages(collisions, 'collidingPages') })}
              </p>
            )}
            {ambiguous.length > 0 && (
              <p role="status" data-testid="table-conflict-note" style={{ ...noteStyle, marginBottom: 8 }}>
                {t('conflict.tableAmbiguous', { names: names(ambiguous), pages: pages(ambiguous, 'freePages') })}
              </p>
            )}
          </>
        );
      })()}
      {issues.length > 0 && (
        <div role="alert" data-testid="table-issues" style={{ marginBottom: 8 }}>
          {issues.map((i, k) => <p key={k} style={warnStyle}>{issueText(i)}</p>)}
        </div>
      )}
      {columns.map(columnCard)}
      <button
        type="button"
        className="chrome-btn chrome-btn-ghost"
        style={{ width: '100%', justifyContent: 'center' }}
        disabled={columns.length >= TABLE_MAX_COLUMNS}
        title={columns.length >= TABLE_MAX_COLUMNS ? t('table.maxColumns', { n: TABLE_MAX_COLUMNS }) : undefined}
        onClick={() => apply(addColumn(el))}
      >
        {t('table.addColumn')}
      </button>
      <p style={noteStyle}>{t('table.columnsNote')}</p>
    </div>
  );
}
