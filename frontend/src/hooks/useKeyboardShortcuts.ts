import { useEffect } from 'react';

interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  callback: (e: KeyboardEvent) => void;
  description: string;
}

export const useKeyboardShortcuts = (shortcuts: KeyboardShortcut[]) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input fields
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      for (const shortcut of shortcuts) {
        const ctrlMatch = shortcut.ctrl ? (e.ctrlKey || e.metaKey) : !e.ctrlKey && !e.metaKey;
        const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey;
        const altMatch = shortcut.alt ? e.altKey : !e.altKey;

        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();

        if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
          e.preventDefault();
          shortcut.callback(e);
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts]);
};

// Export common shortcut patterns
export const SHORTCUTS = {
  // Navigation
  NEXT_PAGE: { key: 'ArrowRight', description: 'Next page' },
  PREV_PAGE: { key: 'ArrowLeft', description: 'Previous page' },
  FIRST_PAGE: { key: 'Home', description: 'First page' },
  LAST_PAGE: { key: 'End', description: 'Last page' },
  PAGE_DOWN: { key: ' ', description: 'Page down' },
  PAGE_UP: { key: ' ', shift: true, description: 'Page up' },

  // Search
  FIND: { key: 'f', ctrl: true, description: 'Find in document' },
  FIND_NEXT: { key: 'F3', description: 'Find next' },
  FIND_PREV: { key: 'F3', shift: true, description: 'Find previous' },

  // Zoom
  ZOOM_IN: { key: '+', ctrl: true, description: 'Zoom in' },
  ZOOM_OUT: { key: '-', ctrl: true, description: 'Zoom out' },
  ZOOM_RESET: { key: '0', ctrl: true, description: 'Reset zoom' },

  // Selection
  SELECT_ALL: { key: 'a', ctrl: true, description: 'Select all text' },
  COPY: { key: 'c', ctrl: true, description: 'Copy selection' },
  ESCAPE: { key: 'Escape', description: 'Cancel/Close' },

  // Annotation
  DELETE: { key: 'Delete', description: 'Delete annotation' },
  DELETE_BACK: { key: 'Backspace', description: 'Delete annotation' },

  // Undo/Redo
  UNDO: { key: 'z', ctrl: true, description: 'Undo' },
  REDO: { key: 'z', ctrl: true, shift: true, description: 'Redo' },
};
