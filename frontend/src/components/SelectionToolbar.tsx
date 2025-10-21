import React from 'react';
import { Square, Lasso, Pen, Type } from 'lucide-react';
import './SelectionToolbar.css';

interface SelectionToolbarProps {
  currentTool: 'rectangle' | 'lasso' | 'polygon' | 'add-text';
  onToolChange: (tool: 'rectangle' | 'lasso' | 'polygon' | 'add-text') => void;
}

export const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
  currentTool,
  onToolChange,
}) => {
  return (
    <div className="selection-toolbar">
      <div className="toolbar-title">Selection Tools</div>
      <div className="tool-buttons">
        <button
          className={`tool-btn ${currentTool === 'rectangle' ? 'active' : ''}`}
          onClick={() => onToolChange('rectangle')}
          title="Rectangle Selection (R)"
        >
          <Square size={20} />
          <span>Rectangle</span>
          <kbd>R</kbd>
        </button>

        <button
          className={`tool-btn ${currentTool === 'lasso' ? 'active' : ''}`}
          onClick={() => onToolChange('lasso')}
          title="Lasso Selection (L)"
        >
          <Lasso size={20} />
          <span>Lasso</span>
          <kbd>L</kbd>
        </button>

        <button
          className={`tool-btn ${currentTool === 'polygon' ? 'active' : ''}`}
          onClick={() => onToolChange('polygon')}
          title="Polygon Selection (P)"
        >
          <Pen size={20} />
          <span>Polygon</span>
          <kbd>P</kbd>
        </button>

        <button
          className={`tool-btn ${currentTool === 'add-text' ? 'active' : ''}`}
          onClick={() => onToolChange('add-text')}
          title="Add Text Manually (T)"
        >
          <Type size={20} />
          <span>Add Text</span>
          <kbd>T</kbd>
        </button>
      </div>

      <div className="tool-instructions">
        {currentTool === 'rectangle' && (
          <p>Click and drag to select text in a rectangle</p>
        )}
        {currentTool === 'lasso' && (
          <p>Click and draw to select freeform. Release to finish.</p>
        )}
        {currentTool === 'polygon' && (
          <p>Click to add points. Click near start to close polygon.</p>
        )}
        {currentTool === 'add-text' && (
          <p>Draw a bounding box, then enter text manually</p>
        )}
      </div>
    </div>
  );
};
