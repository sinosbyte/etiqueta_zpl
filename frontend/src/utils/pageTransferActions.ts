import { DesignElement } from '../types';
import { t, MessageKey } from '../i18n';
import { toast } from '../store/useToastStore';
import { useDesignerStore } from '../store/useDesignerStore';
import { Refusal, TransferMode, TransferPlan } from './pageTransfer';

// What the user is told after moving or copying elements to another page, and the one entry point the screen uses.

const MAX_VALUE_SHOWN = 24;

/** How an element is named in a message: its type, and for a text its content. */
export function elementLabel(el: DesignElement): string {
  const type = t(`element.${el.type}` as MessageKey);
  const value = el.type === 'text' ? (el.value ?? '').trim() : '';
  if (!value) return type;
  return `${type} "${value.length > MAX_VALUE_SHOWN ? `${value.slice(0, MAX_VALUE_SHOWN)}…` : value}"`;
}

const refusalText = (r: Refusal, target: number): string =>
  t('transfer.refusedItem', {
    element: elementLabel(r.element),
    reason: t(`transfer.reason.${r.reason}` as MessageKey, { page: target + 1 }),
  });

/** The toast for the result: success when everything was transferred, info when only part, error when nothing. */
export function transferMessage(plan: TransferPlan): { type: 'success' | 'info' | 'error'; text: string } {
  const page = plan.target + 1;
  const n = plan.done.length;
  const refused = plan.refused.length > 0
    ? t('transfer.refused', { items: plan.refused.map(r => refusalText(r, plan.target)).join('; ') })
    : '';
  if (n === 0) {
    return { type: 'error', text: [t(plan.mode === 'move' ? 'transfer.noneMove' : 'transfer.noneCopy'), refused].filter(Boolean).join(' ') };
  }
  const done = plan.mode === 'move'
    ? (n === 1 ? t('transfer.moved1', { page }) : t('transfer.movedN', { n, page }))
    : (n === 1 ? t('transfer.copied1', { page }) : t('transfer.copiedN', { n, page }));
  return { type: refused ? 'info' : 'success', text: [done, refused].filter(Boolean).join(' ') };
}

/**
 * Moves or copies the selection to the page `target`, tells the user the result and brings the page into view.
 * One change of the store, so one step of undo. Returns the plan, or null when there was nothing selected.
 */
export function requestTransfer(mode: TransferMode, target: number): TransferPlan | null {
  const store = useDesignerStore.getState();
  const plan = mode === 'move' ? store.moveSelectedToPage(target) : store.copySelectedToPage(target);
  if (!plan) return null;
  const message = transferMessage(plan);
  toast[message.type](message.text);
  if (plan.done.length > 0 && typeof document !== 'undefined') {
    document.querySelector?.(`[data-page="${plan.target}"]`)?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }
  return plan;
}
