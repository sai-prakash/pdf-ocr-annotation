import React from 'react';
import type { PageData } from '../store/pdfStore';
import './TextOnlyView.css';

interface TextOnlyViewProps {
  pageData: PageData;
  currentPage: number;
}

export const TextOnlyView: React.FC<TextOnlyViewProps> = ({ pageData, currentPage }) => {
  // Calculate scale to fit page width (similar to PDF viewer)
  const containerWidth = 900; // Max width of text-only-view
  const scale = containerWidth / pageData.width;
  const scaledHeight = pageData.height * scale;

  return (
    <div className="text-only-view">
      <div className="text-only-header">
        <h2>Page {currentPage} - Text View (Positioned)</h2>
        <div className="text-only-stats">
          <span>{pageData.block_count} text blocks</span>
          <span>{pageData.full_text.length} characters</span>
          <span>{pageData.is_scanned ? 'OCR Extracted' : 'Native Text'}</span>
        </div>
      </div>

      {/* Positioned text blocks matching PDF layout */}
      <div
        className="text-only-positioned"
        style={{
          position: 'relative',
          width: containerWidth,
          height: scaledHeight,
          margin: '0 auto',
          backgroundColor: '#fff',
          border: '1px solid #e0e0e0',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        }}
      >
        {pageData.blocks.map((block, index) => {
          const x = block.bbox.x0 * scale;
          const y = block.bbox.y0 * scale;
          const width = (block.bbox.x1 - block.bbox.x0) * scale;
          const height = (block.bbox.y1 - block.bbox.y0) * scale;
          const fontSize = Math.max(10, height * 0.7);

          return (
            <div
              key={index}
              className={`text-block-positioned ${block.type}`}
              title={`Confidence: ${Math.round(block.confidence * 100)}%`}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                width,
                minHeight: height,
                fontSize: `${fontSize}px`,
                lineHeight: `${height}px`,
                opacity: block.confidence < 0.5 ? 0.6 : 1,
                userSelect: 'text',
                cursor: 'text',
                whiteSpace: 'pre',
                overflow: 'hidden',
              }}
            >
              {block.text}
            </div>
          );
        })}
      </div>

      <div className="text-only-raw">
        <details>
          <summary>Show Raw Text (Copyable)</summary>
          <pre className="raw-text-content">{pageData.full_text}</pre>
        </details>
      </div>
    </div>
  );
};
