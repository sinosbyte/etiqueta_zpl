import { t } from '../i18n';
import { askConfirm } from '../store/useDialogStore';
import { useAuthStore } from '../store/useAuthStore';
import { isDirtyNow } from '../hooks/useUnsavedChanges';

/**
 * Signing out on purpose: with unsaved changes it asks first (cancelling keeps the session and the work as they
 * are); then the session ends and the editor is cleared, so the next person in this tab starts blank.
 */
export async function requestLogout(): Promise<void> {
  if (isDirtyNow()) {
    const ok = await askConfirm({
      title: t('unsaved.dialogTitle'),
      message: t('unsaved.confirmLogout'),
      confirmLabel: t('unsaved.logoutDiscard'),
      danger: true,
    });
    if (!ok) return;
  }
  useAuthStore.getState().logout();
}
