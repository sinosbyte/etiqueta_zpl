import { askConfirm } from '../store/useDialogStore';
import { useDesignerStore } from '../store/useDesignerStore';
import { t } from '../i18n';

/**
 * Removes the second page after asking, because its elements go with it. Cancelling (button, Esc or a click
 * outside) changes nothing. Resolves true only when the page was removed. It is one change of the store, so
 * undo brings the page and its elements back together.
 */
export async function requestRemovePage(): Promise<boolean> {
  if (useDesignerStore.getState().pages.length <= 1) return false;
  const ok = await askConfirm({
    title: t('page.removeTitle'),
    message: t('page.removeConfirm'),
    confirmLabel: t('page.removeButton'),
    danger: true,
  });
  if (!ok) return false;
  return useDesignerStore.getState().removePage();
}
