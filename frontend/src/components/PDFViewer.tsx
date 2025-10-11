import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { usePdfStore } from '../store/pdfStore';
import type { BoundingBox } from '../store/pdfStore';
import './PDFViewer.css';
import {
  SpatialIndex,
  getIntersectionRatio,
  extractTextFromBlock,
  sortBlocksInReadingOrder,
  resolveOverlappingBlocks,
  filterValidBlocks,
  normalizeWhitespace,
  getSelectionStats,
  type SelectionMode,
  type SelectionRect,
} from '../utils/selectionUtils';

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

interface TextSelection {
  text: string;
  bbox: BoundingBox;
  pageNumber: number;
  stats?: {
    blockCount: number;
    wordCount: number;
    charCount: number;
    avgConfidence: number;
  };
}

export const PDFViewer: React.FC = () => {
  const {
    fileUrl,
    currentPage,
    zoomLevel,
    pages,
    annotations,
    searchResults,
    currentSearchIndex,
    selectedAnnotation,
  } = usePdfStore();

  const [pageWidth, setPageWidth] = useState<number>(800);
  const [textSelection, setTextSelection] = useState<TextSelection | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [currentMousePos, setCurrentMousePos] = useState<{ x: number; y: number } | null>(null);
  const [hoveredBlocks, setHoveredBlocks] = useState<any[]>([]);
  const [liveSelectedBlocks, setLiveSelectedBlocks] = useState<any[]>([]);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('word');
  const [previewText, setPreviewText] = useState<string>('');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Get current page data (must be defined before useMemo hooks that depend on it)
  const currentPageData = pages.find((p) => p.page_number === currentPage);

  // Create spatial index for performance (memoized)
  const spatialIndex = useMemo(() => {
    if (!currentPageData || !currentPageData.blocks) return null;
    return new SpatialIndex(currentPageData.blocks);
  }, [currentPageData]);

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setPageWidth(containerRef.current.offsetWidth - 40);
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  const onDocumentLoadSuccess = () => {
    // Document loaded successfully
  };

  const onPageLoadSuccess = () => {
    // Page loaded successfully
  };

  // Calculate effective scale (base fit * zoom level)
  const baseScale = pageWidth / (currentPageData?.width || 800);
  const effectiveScale = baseScale * zoomLevel;

  // Draw text blocks overlay for scanned pages
  useEffect(() => {
    if (!canvasRef.current || !currentPageData) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size to match PDF page
    const pageHeight = currentPageData.height * effectiveScale;
    const pageWidthScaled = currentPageData.width * effectiveScale;

    canvas.width = pageWidthScaled;
    canvas.height = pageHeight;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw text blocks (invisible but selectable areas)
    // Currently not rendering blocks to keep canvas clean
    // Blocks are accessible via spatial index for selection

    // Draw annotations
    annotations
      .filter((ann) => ann.page_number === currentPage)
      .forEach((ann) => {
        const x = ann.bounding_box.x0 * effectiveScale;
        const y = ann.bounding_box.y0 * effectiveScale;
        const width = (ann.bounding_box.x1 - ann.bounding_box.x0) * effectiveScale;
        const height = (ann.bounding_box.y1 - ann.bounding_box.y0) * effectiveScale;

        const isSelected = selectedAnnotation?.id === ann.id;

        // Highlight selected annotation with enhanced styling
        if (isSelected) {
          // Outer glow effect
          ctx.fillStyle = ann.color + '60'; // More opacity for selected
          ctx.fillRect(x - 4, y - 4, width + 8, height + 8);

          // Main highlight
          ctx.fillStyle = ann.color + '50';
          ctx.fillRect(x, y, width, height);

          // Bold border for selected
          ctx.strokeStyle = ann.color;
          ctx.lineWidth = 3;
          ctx.strokeRect(x, y, width, height);

          // Animated dashed outline
          ctx.strokeStyle = ann.color;
          ctx.lineWidth = 1;
          ctx.setLineDash([6, 3]);
          ctx.strokeRect(x - 2, y - 2, width + 4, height + 4);
          ctx.setLineDash([]);
        } else {
          // Normal annotation
          ctx.fillStyle = ann.color + '40'; // Add transparency
          ctx.fillRect(x, y, width, height);

          ctx.strokeStyle = ann.color;
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y, width, height);
        }
      });

    // Draw search results
    searchResults
      .filter((result) => result.page_number === currentPage)
      .forEach((result, index) => {
        const x = result.bbox.x0 * effectiveScale;
        const y = result.bbox.y0 * effectiveScale;
        const width = (result.bbox.x1 - result.bbox.x0) * effectiveScale;
        const height = (result.bbox.y1 - result.bbox.y0) * effectiveScale;

        // Find global index of this result
        const globalIndex = searchResults.findIndex(
          (r) => r.page_number === result.page_number && r.match_index === result.match_index
        );
        const isCurrentResult = globalIndex === currentSearchIndex;

        // Highlight current search result differently
        if (isCurrentResult) {
          ctx.fillStyle = 'rgba(255, 152, 0, 0.5)'; // Bright orange for current
          ctx.fillRect(x, y, width, height);

          ctx.strokeStyle = '#ff6f00';
          ctx.lineWidth = 3;
          ctx.strokeRect(x, y, width, height);

          // Add pulsing effect border
          ctx.strokeStyle = '#ff9800';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.strokeRect(x - 2, y - 2, width + 4, height + 4);
          ctx.setLineDash([]);
        } else {
          // Other search results - subtle yellow
          ctx.fillStyle = 'rgba(255, 255, 0, 0.3)';
          ctx.fillRect(x, y, width, height);

          ctx.strokeStyle = '#ffc107';
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, width, height);
        }
      });

    // Draw hovered blocks
    hoveredBlocks.forEach((block) => {
      const x = block.bbox.x0 * effectiveScale;
      const y = block.bbox.y0 * effectiveScale;
      const width = (block.bbox.x1 - block.bbox.x0) * effectiveScale;
      const height = (block.bbox.y1 - block.bbox.y0) * effectiveScale;

      ctx.fillStyle = 'rgba(100, 181, 246, 0.2)';
      ctx.fillRect(x, y, width, height);

      ctx.strokeStyle = '#64b5f6';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(x, y, width, height);
      ctx.setLineDash([]);
    });

    // Draw live selection during drag
    if (isSelecting && selectionStart && currentMousePos) {
      const startX = selectionStart.x * effectiveScale;
      const startY = selectionStart.y * effectiveScale;
      const endX = currentMousePos.x * effectiveScale;
      const endY = currentMousePos.y * effectiveScale;

      const rectX = Math.min(startX, endX);
      const rectY = Math.min(startY, endY);
      const rectWidth = Math.abs(endX - startX);
      const rectHeight = Math.abs(endY - startY);

      // Draw selection rectangle
      ctx.fillStyle = 'rgba(33, 150, 243, 0.15)';
      ctx.fillRect(rectX, rectY, rectWidth, rectHeight);

      ctx.strokeStyle = '#2196f3';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(rectX, rectY, rectWidth, rectHeight);
      ctx.setLineDash([]);

      // Draw selected blocks within the rectangle
      liveSelectedBlocks.forEach((block) => {
        const x = block.bbox.x0 * effectiveScale;
        const y = block.bbox.y0 * effectiveScale;
        const width = (block.bbox.x1 - block.bbox.x0) * effectiveScale;
        const height = (block.bbox.y1 - block.bbox.y0) * effectiveScale;

        ctx.fillStyle = 'rgba(33, 150, 243, 0.3)';
        ctx.fillRect(x, y, width, height);

        ctx.strokeStyle = '#2196f3';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width, height);
      });
    }

    // Draw current selection (after mouse up)
    if (textSelection && textSelection.pageNumber === currentPage) {
      const x = textSelection.bbox.x0 * effectiveScale;
      const y = textSelection.bbox.y0 * effectiveScale;
      const width = (textSelection.bbox.x1 - textSelection.bbox.x0) * effectiveScale;
      const height = (textSelection.bbox.y1 - textSelection.bbox.y0) * effectiveScale;

      ctx.fillStyle = 'rgba(33, 150, 243, 0.3)';
      ctx.fillRect(x, y, width, height);

      ctx.strokeStyle = '#2196f3';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, width, height);
    }
  }, [currentPageData, effectiveScale, annotations, searchResults, currentSearchIndex, selectedAnnotation, textSelection, currentPage, hoveredBlocks, isSelecting, selectionStart, currentMousePos, liveSelectedBlocks, zoomLevel]);

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !currentPageData) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / effectiveScale;
    const y = (e.clientY - rect.top) / effectiveScale;

    // Detect selection mode from modifier keys
    if (e.shiftKey) {
      setSelectionMode('line'); // Line mode
    } else if (e.ctrlKey || e.metaKey) {
      setSelectionMode('block'); // Block mode
    } else if (e.altKey) {
      setSelectionMode('precise'); // Precise mode
    } else {
      setSelectionMode('word'); // Default: word mode
    }

    setIsSelecting(true);
    setSelectionStart({ x, y });
    setCurrentMousePos({ x, y });
    setTextSelection(null); // Clear previous selection
    setPreviewText('');
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !currentPageData || !spatialIndex) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / effectiveScale;
    const y = (e.clientY - rect.top) / effectiveScale;

    setCurrentMousePos({ x, y });

    if (isSelecting && selectionStart) {
      // Calculate selection rectangle
      const selRect: SelectionRect = {
        left: Math.min(selectionStart.x, x),
        right: Math.max(selectionStart.x, x),
        top: Math.min(selectionStart.y, y),
        bottom: Math.max(selectionStart.y, y),
      };

      // Use spatial index for performance (10-100x faster on dense pages)
      const candidates = spatialIndex.query(selRect);

      // Filter blocks based on mode
      const threshold = selectionMode === 'block' ? 0.1 : 0.3;
      const selectedBlocks = candidates.filter((block) => {
        const ratio = getIntersectionRatio(selRect, block.bbox);
        return ratio > threshold;
      });

      setLiveSelectedBlocks(selectedBlocks);

      // Generate preview text
      if (selectedBlocks.length > 0) {
        const sortedBlocks = sortBlocksInReadingOrder(selectedBlocks);
        const textParts = sortedBlocks.map((block) =>
          extractTextFromBlock(block, selRect, selectionMode)
        );
        const combinedText = normalizeWhitespace(textParts.join(' '));
        setPreviewText(combinedText.substring(0, 150));
      } else {
        setPreviewText('');
      }
    } else {
      // Show hover effect on text blocks
      const hovered = currentPageData.blocks.filter((block) => {
        return (
          x >= block.bbox.x0 &&
          x <= block.bbox.x1 &&
          y >= block.bbox.y0 &&
          y <= block.bbox.y1
        );
      });
      setHoveredBlocks(hovered);
    }
  };

  const handleCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isSelecting || !selectionStart || !currentPageData || !spatialIndex) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / effectiveScale;
    const y = (e.clientY - rect.top) / effectiveScale;

    // Calculate selection rectangle
    const selRect: SelectionRect = {
      left: Math.min(selectionStart.x, x),
      right: Math.max(selectionStart.x, x),
      top: Math.min(selectionStart.y, y),
      bottom: Math.max(selectionStart.y, y),
    };

    // Check minimum selection size (prevent accidental tiny selections)
    const selectionWidth = selRect.right - selRect.left;
    const selectionHeight = selRect.bottom - selRect.top;

    if (selectionWidth < 5 && selectionHeight < 5) {
      // Too small - ignore
      setIsSelecting(false);
      setSelectionStart(null);
      setLiveSelectedBlocks([]);
      setPreviewText('');
      return;
    }

    // Use spatial index for performance
    const candidates = spatialIndex.query(selRect);

    // Find blocks with significant overlap
    const threshold = selectionMode === 'block' ? 0.05 : 0.15;
    let selectedBlocks = candidates.filter((block) => {
      const ratio = getIntersectionRatio(selRect, block.bbox);
      return ratio > threshold;
    });

    // Remove overlapping blocks (keep highest confidence)
    selectedBlocks = resolveOverlappingBlocks(selectedBlocks);

    // Filter out empty/invalid blocks
    selectedBlocks = filterValidBlocks(selectedBlocks);

    if (selectedBlocks.length > 0) {
      // Sort in reading order (handles multi-column layouts)
      const sortedBlocks = sortBlocksInReadingOrder(selectedBlocks);

      // Extract text with mode awareness
      const textParts = sortedBlocks.map((block) =>
        extractTextFromBlock(block, selRect, selectionMode)
      );

      // Combine text with proper whitespace
      const combinedText = normalizeWhitespace(textParts.join(' '));

      // Calculate bounding box for all selected blocks
      const minX = Math.min(...sortedBlocks.map((b) => b.bbox.x0));
      const minY = Math.min(...sortedBlocks.map((b) => b.bbox.y0));
      const maxX = Math.max(...sortedBlocks.map((b) => b.bbox.x1));
      const maxY = Math.max(...sortedBlocks.map((b) => b.bbox.y1));

      // Get statistics
      const stats = getSelectionStats(sortedBlocks, combinedText);

      setTextSelection({
        text: combinedText,
        bbox: { x0: minX, y0: minY, x1: maxX, y1: maxY },
        pageNumber: currentPage,
        stats,
      });
    }

    setIsSelecting(false);
    setSelectionStart(null);
    setLiveSelectedBlocks([]);
    setPreviewText('');
  };

  if (!fileUrl) {
    return (
      <div className="pdf-viewer-empty">
        <p>No PDF loaded. Please upload a PDF file.</p>
      </div>
    );
  }

  return (
    <div className="pdf-viewer-container" ref={containerRef}>
      <div className="pdf-viewer-content">
        <Document
          file={fileUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={<div className="pdf-loading">Loading PDF...</div>}
        >
          <div className="pdf-page-wrapper">
            <Page
              pageNumber={currentPage}
              width={pageWidth * zoomLevel}
              onLoadSuccess={onPageLoadSuccess}
              renderTextLayer={!currentPageData?.is_scanned}
              renderAnnotationLayer={false}
            />
            <canvas
              ref={canvasRef}
              className="pdf-overlay-canvas"
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={() => {
                setHoveredBlocks([]);
                setCurrentMousePos(null);
              }}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                cursor: isSelecting ? 'crosshair' : hoveredBlocks.length > 0 ? 'pointer' : 'text',
                pointerEvents: 'all',
              }}
            />
          </div>
        </Document>

        {isSelecting && (liveSelectedBlocks.length > 0 || previewText) && (
          <div className="selection-tooltip">
            <div className="selection-mode-badge">
              Mode: {selectionMode.toUpperCase()}
              {selectionMode === 'word' && ' (default)'}
              {selectionMode === 'line' && ' (Shift)'}
              {selectionMode === 'block' && ' (Ctrl)'}
              {selectionMode === 'precise' && ' (Alt)'}
            </div>
            <p>{liveSelectedBlocks.length} block{liveSelectedBlocks.length !== 1 ? 's' : ''} selected</p>
            {previewText && (
              <div className="selection-preview">
                <strong>Preview:</strong> {previewText}
                {previewText.length >= 150 ? '...' : ''}
              </div>
            )}
          </div>
        )}

        {textSelection && (
          <div className="text-selection-popup">
            <p>
              <strong>Selected:</strong> {textSelection.text.substring(0, 100)}
              {textSelection.text.length > 100 ? '...' : ''}
            </p>
            {textSelection.stats && (
              <div className="selection-stats">
                <span>{textSelection.stats.wordCount} words</span>
                <span>{textSelection.stats.charCount} characters</span>
                <span>{Math.round(textSelection.stats.avgConfidence * 100)}% confidence</span>
              </div>
            )}
            <div className="selection-actions">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(textSelection.text);
                  // Could show a toast notification here
                }}
                title="Copy text (Ctrl+C)"
              >
                Copy Text
              </button>
              <button
                onClick={() => {
                  // This will be handled by the annotation component
                  const event = new CustomEvent('createAnnotation', {
                    detail: textSelection,
                  });
                  window.dispatchEvent(event);
                  setTextSelection(null);
                }}
              >
                Create Annotation
              </button>
              <button onClick={() => setTextSelection(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
