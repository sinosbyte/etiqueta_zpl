import React, { useMemo, useState } from 'react';
import { useDesignerStore } from '../store/useDesignerStore';
import { useSimulationStore } from '../store/useSimulationStore';
import { usePanelStore } from '../store/usePanelStore';
import { toast } from '../store/useToastStore';
import { MessageKey, useT } from '../i18n';
import {
  MAX_ADD_AT_ONCE, MAX_RECORDS, MAX_VALUE_LENGTH, addRecords, candidateLabelFields, dataFields, deleteRecord,
  labelFields as labelFieldsOf, labelValueConflicts, orphanFields, parsePaste, recordIssues, recordValue, removeOrphans, setCell,
} from '../utils/testData';
import { labelRecords, labelSummary, unplacedRecords, firstUnplaced } from '../utils/simulation';
import { RenderedLabel } from './RenderedLabel';
import { PdfExportBar } from './PdfExportBar';
import { TestValues } from './TestValues';

const WARN = '#dc2626';
const AMBER = 'var(--status-warning)';
const th: React.CSSProperties = {
  position: 'sticky', top: 0, background: 'var(--chrome-elevated)', textAlign: 'left', padding: '4px 6px', fontSize: 10,
  fontWeight: 600, letterSpacing: '0.04em', color: 'var(--chrome-text-muted)', borderBottom: '1px solid var(--chrome-border)',
  whiteSpace: 'nowrap', zIndex: 1,
};
const td: React.CSSProperties = { padding: 2, borderBottom: '1px solid var(--chrome-border)', verticalAlign: 'middle' };
const note: React.CSSProperties = { fontSize: 11, color: 'var(--chrome-text-faint)', margin: '4px 0', lineHeight: 1.5 };
const sectionTitle: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--chrome-text)', margin: '0 0 4px',
};

// A cell of the grid: the value is applied on Enter or on leaving the cell
function Cell({ value, onCommit, label, muted }: { value: string; onCommit(v: string): void; label: string; muted?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const finish = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <input
      className="chrome-input"
      type="text"
      aria-label={label}
      value={draft ?? value}
      maxLength={MAX_VALUE_LENGTH}
      style={{ minWidth: 90, width: '100%', opacity: muted ? 0.6 : 1 }}
      onChange={e => setDraft(e.target.value)}
      onBlur={finish}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

/** The records of the tables (pagesConfig.records): the grid with everything it already had. */
function RecordsSection({ gridHeight }: { gridHeight: number }) {
  const t = useT();
  const elements = useDesignerStore(s => s.elements);
  const records = useDesignerStore(s => s.records);
  const setRecords = useDesignerStore(s => s.setRecords);
  const [many, setMany] = useState('5');
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');

  const fields = useMemo(() => dataFields(elements), [elements]);
  // Variables that change from label to label (a volume, a UC): columns of their own, taken from the label's first record
  const perLabel = useMemo(() => labelFieldsOf(elements, records), [elements, records]);
  const candidates = useMemo(() => candidateLabelFields(elements, records), [elements, records]);
  const known = useMemo(() => [...fields, ...perLabel], [fields, perLabel]);
  const orphans = useMemo(() => orphanFields(records, known), [records, known]);
  const issues = useMemo(() => recordIssues(records, fields), [records, fields]);
  const full = records.length >= MAX_RECORDS;

  if (fields.length === 0) {
    return (
      <section data-testid="tr-records">
        <h3 style={sectionTitle}>{t('td.records')}</h3>
        <p style={{ ...note, color: 'var(--chrome-text)', fontSize: 12 }} role="note">{t('td.noTable')}</p>
        {records.length > 0 && <p style={note}>{t('td.noTableKept', { n: records.length })}</p>}
      </section>
    );
  }

  const add = (n: number) => {
    const next = addRecords(records, known, n);
    if (!next) { toast.error(t('td.limit', { n: MAX_RECORDS })); return; }
    setRecords(next);
  };
  const applyPaste = () => {
    const { records: read, skipped } = parsePaste(pasted, fields, [...perLabel, ...candidates]);
    const room = MAX_RECORDS - records.length;
    const take = read.slice(0, Math.max(0, room));
    if (take.length === 0) { toast.error(read.length === 0 ? t('td.pasteNothing') : t('td.limit', { n: MAX_RECORDS })); return; }
    setRecords([...records, ...take]);
    const left = skipped + (read.length - take.length);
    toast.success(t('td.pasteAdded', { n: take.length }));
    if (left > 0) toast.error(t('td.pasteSkipped', { n: left, max: MAX_RECORDS }));
    setPasted('');
    setPasting(false);
  };
  const issueText = (i: ReturnType<typeof recordIssues>[number]): string => {
    switch (i.kind) {
      case 'emptyRecord': return t('td.issueEmptyRecord', { n: i.row + 1 });
      case 'emptyValues': return t('td.issueEmptyValues', { n: i.row + 1, fields: i.fields.join(', ') });
      case 'tooLong': return t('td.issueTooLong', { n: i.row + 1, field: i.field, max: MAX_VALUE_LENGTH });
      case 'control': return t('td.issueControl', { n: i.row + 1, field: i.field });
    }
  };

  const columns = [...known, ...orphans];
  return (
    <section data-testid="tr-records">
      <h3 style={sectionTitle}>{t('td.records')} ({records.length})</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <button type="button" className="chrome-btn chrome-btn-primary" onClick={() => add(1)} disabled={full} data-testid="td-add">{t('td.add')}</button>
        <input
          className="chrome-input" type="text" inputMode="numeric" aria-label={t('td.addManyLabel')} title={t('td.addManyTitle')}
          value={many} style={{ width: 52, textAlign: 'center' }}
          onChange={e => setMany(e.target.value.replace(/\D/g, '').slice(0, 2))}
        />
        <button
          type="button" className="chrome-btn chrome-btn-ghost" disabled={full} data-testid="td-add-many"
          onClick={() => add(Math.min(MAX_ADD_AT_ONCE, Math.max(1, Number(many) || 1)))}
        >
          {t('td.addMany')}
        </button>
        <button type="button" className="chrome-btn chrome-btn-ghost" title={t('td.pasteTitle')} onClick={() => setPasting(p => !p)} data-testid="td-paste-toggle">
          {t('td.paste')}
        </button>
        <span style={{ fontSize: 11, color: 'var(--chrome-text-faint)' }}>
          {t('td.fields')} {fields.map(f => `{{${f}}}`).join(' ')}
        </span>
      </div>
      {perLabel.length > 0 && <p style={note} data-testid="td-perlabel-help">{t('td.perLabelHelp')}</p>}
      {full && <p style={{ ...note, color: AMBER }}>{t('td.limit', { n: MAX_RECORDS })}</p>}

      {pasting && (
        <div style={{ marginBottom: 8 }}>
          <p style={note}>{t('td.pasteHelp')}</p>
          <textarea
            className="chrome-input" rows={4} value={pasted} onChange={e => setPasted(e.target.value)}
            aria-label={t('td.paste')} data-testid="td-paste-text" style={{ width: '100%', fontFamily: 'monospace' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button type="button" className="chrome-btn chrome-btn-primary" onClick={applyPaste} data-testid="td-paste-apply">{t('td.pasteApply')}</button>
            <button type="button" className="chrome-btn chrome-btn-ghost" onClick={() => { setPasting(false); setPasted(''); }}>{t('td.pasteCancel')}</button>
          </div>
        </div>
      )}

      {orphans.length > 0 && (
        <div role="alert" data-testid="td-orphans" style={{ ...note, color: AMBER }}>
          {t('td.orphans', { fields: orphans.join(', ') })}{' '}
          <button
            type="button" className="chrome-btn chrome-btn-ghost" style={{ marginLeft: 4 }}
            onClick={() => setRecords(removeOrphans(records, known))}
          >
            {t('td.orphansRemove')}
          </button>
        </div>
      )}

      {records.length === 0 ? (
        <p style={note}>{t('td.empty')}</p>
      ) : (
        <div style={{ overflow: 'auto', maxHeight: gridHeight, border: '1px solid var(--chrome-border)', borderRadius: 4 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }} data-testid="td-grid">
            <thead>
              <tr>
                <th style={{ ...th, width: 34 }}>#</th>
                {columns.map(c => (
                  <th
                    key={c} style={{ ...th, color: orphans.includes(c) ? AMBER : th.color }}
                    title={orphans.includes(c) ? t('td.orphanColumn') : perLabel.includes(c) ? t('td.perLabelTitle') : undefined}
                    data-testid={perLabel.includes(c) ? `td-label-col-${c}` : undefined}
                  >
                    {c}{perLabel.includes(c) ? ` · ${t('td.perLabelTag')}` : ''}
                  </th>
                ))}
                <th style={{ ...th, width: 28 }} />
              </tr>
            </thead>
            <tbody>
              {records.map((r, row) => (
                <tr key={row} data-testid={`td-row-${row}`}>
                  <td style={{ ...td, textAlign: 'center', fontSize: 10, color: 'var(--chrome-text-faint)' }}>{row + 1}</td>
                  {columns.map(c => (
                    <td key={c} style={td}>
                      <Cell
                        muted={orphans.includes(c)}
                        label={t('td.cell', { n: row + 1, field: c })}
                        value={recordValue(r, c)}
                        onCommit={v => { const next = setCell(records, row, c, v); if (next) setRecords(next); }}
                      />
                    </td>
                  ))}
                  <td style={{ ...td, textAlign: 'center' }}>
                    <button
                      type="button" className="chrome-icon-btn" aria-label={t('td.delete', { n: row + 1 })} title={t('td.delete', { n: row + 1 })}
                      onClick={() => { const next = deleteRecord(records, row); if (next) setRecords(next); }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {issues.length > 0 && (
        <details style={{ marginTop: 6 }} data-testid="td-issues">
          <summary style={{ ...note, cursor: 'pointer', color: AMBER }}>{t('td.issues')} ({issues.length})</summary>
          {issues.slice(0, 8).map((i, k) => <p key={k} style={{ ...note, margin: '2px 0' }}>{issueText(i)}</p>)}
          {issues.length > 8 && <p style={note}>… +{issues.length - 8}</p>}
        </details>
      )}
    </section>
  );
}

const KNOWN_WARNINGS = new Set(['repeat-page-without-table', 'unplaced-records']);

/**
 * The preview: the real rendering (Labelary, through the simulation, the queue and the cache that already exist) of
 * the label with the values on the left. It is only asked for when the user clicks Pré-visualizar / Atualizar; changing
 * a value never sends anything, it only marks the picture as out of date.
 */
function PreviewSection({ maximized }: { maximized: boolean }) {
  const t = useT();
  const elements = useDesignerStore(s => s.elements);
  const sim = useSimulationStore();
  const fields = useMemo(() => dataFields(elements), [elements]);
  const sentLabelFields = useMemo(() => labelFieldsOf(elements, sim.sent), [elements, sim.sent]);
  const result = sim.result;
  const loading = sim.status === 'loading';

  const describe = (label: { page: number; recordStart: number; recordCount: number }): string => {
    const s = labelSummary(label as never);
    if (s.count === 0) return t('sim.noRecords');
    return s.count === 1 ? t('sim.record1', { n: s.from }) : t('sim.recordsRange', { from: s.from, to: s.to });
  };

  return (
    <section data-testid="tp-preview" aria-label={t('pv.title')}>
      <h3 style={sectionTitle}>{t('pv.title')}</h3>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button" className="chrome-btn chrome-btn-primary" data-testid="sim-run"
          disabled={loading} onClick={() => void sim.run()}
        >
          {loading ? t('sim.running') : result ? t('pv.refresh') : t('pv.run')}
        </button>
        {result && !sim.stale && (
          <span style={{ fontSize: 12, color: 'var(--chrome-text)' }} data-testid="sim-summary">
            {result.labels.length === 1
              ? t('sim.summary1', { records: result.totalRecords })
              : t('sim.summary', { labels: result.labels.length, records: result.totalRecords })}
          </span>
        )}
      </div>

      {!result && sim.status !== 'error' && <p style={note} data-testid="pv-intro">{t('pv.intro')}</p>}
      {sim.status === 'error' && <p role="alert" style={{ ...note, color: WARN }}>{t('sim.error', { message: sim.error })}</p>}
      {result && sim.stale && <p role="alert" data-testid="sim-stale" style={{ ...note, color: AMBER, fontWeight: 600 }}>{t('sim.stale')}</p>}

      {result && (
        <div style={{ opacity: sim.stale ? 0.55 : 1, marginTop: 4 }} data-testid="sim-result">
          {result.warnings.length > 0 && (
            <div style={{ marginBottom: 6 }} data-testid="sim-warnings">
              <strong style={{ fontSize: 11, color: AMBER }}>{t('sim.warnings')}</strong>
              {result.warnings.map(w => (
                <p key={w} style={{ ...note, margin: '2px 0' }}>
                  {KNOWN_WARNINGS.has(w) ? t(`sim.warn.${w}` as MessageKey) : w}
                </p>
              ))}
            </div>
          )}

          {result.labels.length > 1 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }} role="tablist">
              {result.labels.map(l => (
                <button
                  key={l.index} type="button" role="tab" aria-selected={sim.selected === l.index}
                  data-testid={`sim-label-${l.index}`}
                  className={`chrome-btn ${sim.selected === l.index ? 'chrome-btn-primary' : 'chrome-btn-ghost'}`}
                  style={{ flexDirection: 'column', alignItems: 'flex-start', height: 'auto', padding: '3px 8px', lineHeight: 1.3 }}
                  onClick={() => sim.select(l.index)}
                >
                  <span style={{ fontWeight: 600 }}>{t('sim.labelTitle', { n: l.index })} · {t('sim.page', { n: l.page + 1 })}</span>
                  <span style={{ fontSize: 10, opacity: 0.85 }}>{describe(l)}</span>
                </button>
              ))}
            </div>
          )}

          {(() => {
            const label = result.labels.find(l => l.index === sim.selected);
            if (!label) return null;
            const rows = labelRecords(label, sim.sent);
            const cols = [...fields, ...sentLabelFields, ...orphanFields(sim.sent, [...fields, ...sentLabelFields])];
            const conflicts = labelValueConflicts(rows, sentLabelFields);
            return (
              <div data-testid="sim-detail">
                {sim.size && (
                  <RenderedLabel label={label} total={result.labels.length} width={sim.size.width} height={sim.size.height} imageHeight={maximized ? 420 : 230} />
                )}
                {!sim.stale && (
                  <button type="button" className="chrome-btn chrome-btn-ghost" style={{ marginTop: 6 }} onClick={() => sim.setViewing(!sim.viewing)} data-testid="sim-toggle-view">
                    {sim.viewing ? t('sim.back') : t('sim.show')}
                  </button>
                )}
                {conflicts.length > 0 && (
                  <p role="alert" style={{ ...note, color: AMBER }} data-testid="sim-conflict">{t('sim.labelConflict', { fields: conflicts.join(', ') })}</p>
                )}
                {rows.length > 0 && (
                  <>
                    <strong style={{ fontSize: 12, display: 'block', marginTop: 8 }}>{t('sim.contents')}</strong>
                    <div style={{ overflow: 'auto', maxHeight: 110, border: '1px solid var(--chrome-border)', borderRadius: 4, marginTop: 4 }}>
                      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                        <thead><tr><th style={th}>#</th>{cols.map(c => <th key={c} style={th}>{c}</th>)}</tr></thead>
                        <tbody>
                          {rows.map((r, i) => (
                            <tr key={i}>
                              <td style={{ ...td, padding: '2px 6px', fontSize: 10 }}>{label.recordStart + i + 1}</td>
                              {cols.map(c => <td key={c} style={{ ...td, padding: '2px 6px', fontSize: 12 }}>{recordValue(r, c)}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                <PdfExportBar />
              </div>
            );
          })()}

          {result.unplaced > 0 && (
            <div style={{ marginTop: 8 }} data-testid="sim-unplaced">
              <strong style={{ fontSize: 12, color: WARN }}>{t('sim.unplaced', { n: result.unplaced })}</strong>
              <div style={{ overflow: 'auto', maxHeight: 100, border: `1px solid ${WARN}`, borderRadius: 4, marginTop: 4 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <tbody>
                    {unplacedRecords(result, sim.sent).map((r, i) => (
                      <tr key={i}>
                        <td style={{ ...td, padding: '2px 6px', fontSize: 10 }}>{firstUnplaced(result, sim.sent) + i}</td>
                        {[...fields, ...sentLabelFields, ...orphanFields(sim.sent, [...fields, ...sentLabelFields])].map(c => <td key={c} style={{ ...td, padding: '2px 6px', fontSize: 12 }}>{recordValue(r, c)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The single place to test a label: the values and the records on the left, the real preview on the right, in a bar
 * under the canvas that can take the whole editor area. Nothing here is a different "mode": a design of one label, of
 * several pages or with a table are all handled by the same fields and the same preview.
 */
export function TestDataPanel() {
  const t = useT();
  const count = useDesignerStore(s => s.records.length);
  const stale = useSimulationStore(s => s.stale && !!s.result);
  const open = usePanelStore(p => p.open);
  const maximized = usePanelStore(p => p.maximized);
  const toggle = () => usePanelStore.getState().setOpen(!usePanelStore.getState().open);

  return (
    <section
      aria-label={t('td.title')}
      style={{
        flexShrink: 0, borderTop: '1px solid var(--chrome-border)', background: 'var(--chrome-surface)', display: 'flex', flexDirection: 'column',
        ...(open ? { height: maximized ? '100%' : '52%', minHeight: 0 } : {}),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', minHeight: 32, flexWrap: 'wrap' }}>
        <button
          type="button" className="chrome-btn chrome-btn-ghost" aria-expanded={open} data-testid="td-toggle"
          title={open ? t('td.toggleClose') : t('td.toggleOpen')} onClick={toggle}
        >
          {open ? '▼' : '▲'} {t('td.title')} · {count === 1 ? t('td.count1') : t('td.count', { n: count })}{stale ? ' •' : ''}
        </button>
        {open && <span style={{ fontSize: 10, color: 'var(--chrome-text-faint)' }}>{t('td.flow')}</span>}
        <span style={{ flex: 1 }} />
        {open && (
          <button
            type="button" className="chrome-btn chrome-btn-ghost" data-testid="td-maximize" aria-pressed={maximized}
            title={maximized ? t('td.restore') : t('td.maximize')} onClick={() => usePanelStore.getState().setMaximized(!maximized)}
          >
            {maximized ? '⤡' : '⤢'} {maximized ? t('td.restore') : t('td.maximize')}
          </button>
        )}
      </div>
      {open && (
        <div
          data-testid="td-body"
          style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr)', flex: 1, minHeight: 0, borderTop: '1px solid var(--chrome-border)' }}
        >
          <div data-testid="td-left" style={{ overflowY: 'auto', padding: '8px 12px 12px', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
            <TestValues />
            <RecordsSection gridHeight={maximized ? 420 : 200} />
          </div>
          <div data-testid="td-right" style={{ overflowY: 'auto', padding: '8px 12px 12px', borderLeft: '1px solid var(--chrome-border)', minHeight: 0 }}>
            <PreviewSection maximized={maximized} />
          </div>
        </div>
      )}
    </section>
  );
}
