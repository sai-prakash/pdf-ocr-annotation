import React, { useState, useEffect, useRef } from 'react';
import './AddTextModal.css';

interface AddTextModalProps {
  isOpen: boolean;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  pageNumber: number;
  onSave: (text: string) => void;
  onCancel: () => void;
}

export const AddTextModal: React.FC<AddTextModalProps> = ({
  isOpen,
  bbox,
  pageNumber,
  onSave,
  onCancel,
}) => {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen]);

  const handleSave = () => {
    if (text.trim()) {
      onSave(text.trim());
      setText('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSave();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="add-text-modal-overlay" onClick={onCancel}>
      <div className="add-text-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Add Text Manually</h3>
          <button className="close-btn" onClick={onCancel}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="bbox-info">
            <span>Page {pageNumber}</span>
            <span>•</span>
            <span>
              Area: {Math.round(bbox.x1 - bbox.x0)} × {Math.round(bbox.y1 - bbox.y0)}
            </span>
          </div>

          <textarea
            ref={textareaRef}
            className="text-input"
            placeholder="Enter the text content for this area..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={8}
          />

          <div className="input-hint">
            Press <kbd>Ctrl+Enter</kbd> to save, <kbd>Esc</kbd> to cancel
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!text.trim()}
          >
            Add Text
          </button>
        </div>
      </div>
    </div>
  );
};
