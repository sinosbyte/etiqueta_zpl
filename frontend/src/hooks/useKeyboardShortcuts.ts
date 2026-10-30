import { useEffect } from 'react';
import { useDesignerStore } from '../store/useDesignerStore';
import { useDesignsStore } from '../store/useDesignsStore';
import { useHistory } from './useHistory';

/** True when the event originates from a text-entry surface we shouldn't hijack. */
function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * Global canvas keyboard shortcuts. Mount once inside the designer view.
 *   Ctrl/Cmd+S        — open the save dialog (intercepts browser save)
 *   Ctrl/Cmd+Z        — undo
 *   Ctrl/Cmd+Shift+Z  — redo
 *   Ctrl/Cmd+Y        — redo
 *   Delete/Backspace  — delete the current selection
 *   Ctrl/Cmd+D        — duplicate selection
 *   Arrows            — move the selection 1 dot (Shift: one grid step)
 * All shortcuts except Ctrl+S are suppressed while typing in an input/editor.
 */
export function useKeyboardShortcuts() {
  const { undo, redo } = useHistory();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // Save works from anywhere, and must pre-empt the browser's own Ctrl+S.
      if (mod && key === 's') {
        e.preventDefault();
        useDesignsStore.getState().openSaveModal();
        return;
      }

      if (isEditableTarget(e.target)) return;

      if (mod && key === 'd') {
        e.preventDefault();
        useDesignerStore.getState().duplicateSelected();
        return;
      }
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const { selectedId, selectedIds } = useDesignerStore.getState();
        if (selectedId || selectedIds.length) {
          e.preventDefault();
          useDesignerStore.getState().deleteSelected();
        }
        return;
      }
      if (e.key === 'Escape') {
        useDesignerStore.getState().clearSelection();
        return;
      }
      // Arrows nudge the selection 1 dot; with Shift, one grid step
      const ARROWS: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
      };
      const arrow = ARROWS[e.key];
      if (arrow) {
        const { selectedId, selectedIds, gridSize, moveSelected } = useDesignerStore.getState();
        if (!selectedId && !selectedIds.length) return;
        e.preventDefault();
        const step = e.shiftKey ? gridSize : 1;
        moveSelected(arrow[0] * step, arrow[1] * step);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);
}
