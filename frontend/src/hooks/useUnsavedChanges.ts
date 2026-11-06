import { useEffect, useMemo } from 'react';
import { useDesignerStore } from '../store/useDesignerStore';
import { useDesignsStore } from '../store/useDesignsStore';
import { signatureOf } from '../utils/unsaved';
import { t } from '../i18n';

/** True when the editor holds changes that were not saved (or an unsaved new design). */
export function useIsDirty(): boolean {
  const elements = useDesignerStore(s => s.elements);
  const labelWidth = useDesignerStore(s => s.labelWidth);
  const labelHeight = useDesignerStore(s => s.labelHeight);
  const sampleValues = useDesignerStore(s => s.sampleValues);
  const saved = useDesignsStore(s => s.savedSignature);
  return useMemo(
    () => signatureOf(elements, labelWidth, labelHeight, sampleValues) !== saved,
    [elements, labelWidth, labelHeight, sampleValues, saved],
  );
}

/** The same check outside React, for handlers that are about to replace what is in the editor. */
export function isDirtyNow(): boolean {
  const s = useDesignerStore.getState();
  return signatureOf(s.elements, s.labelWidth, s.labelHeight, s.sampleValues) !== useDesignsStore.getState().savedSignature;
}

/** Before replacing the editor's content: true when nothing would be lost or the user accepts losing it. */
export function confirmDiscardChanges(): boolean {
  return !isDirtyNow() || window.confirm(t('unsaved.confirmDiscard'));
}

/** Makes the browser ask before closing or reloading the tab while there are unsaved changes. */
export function useWarnBeforeUnload(): void {
  const dirty = useIsDirty();
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}
