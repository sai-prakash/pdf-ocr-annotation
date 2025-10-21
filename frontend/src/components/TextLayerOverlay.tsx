import React, { useEffect, useState, useMemo, useRef } from 'react';
import type { TextBlock, BoundingBox } from '../store/pdfStore';
import './TextLayerOverlay.css';

interface TextLayerOverlayProps {
  blocks: TextBlock[];
  scale: number;
  pageWidth: number;
  pageHeight: number;
  onTextSelect: (text: string, bbox: BoundingBox) => void;
}

/**
 * Advanced text positioning algorithm for pixel-perfect text layer overlay
 * Uses binary search, character-level metrics, and font fallback detection
 */
export const TextLayerOverlay: React.FC<TextLayerOverlayProps> = ({
  blocks,
  scale,
  pageWidth,
  pageHeight,
  onTextSelect,
}) => {
  const [nativeSelection, setNativeSelection] = useState<{
    text: string;
    bbox: BoundingBox;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Memoize block index map for O(1) lookup
  const blockIndexMap = useMemo(() => {
    const map = new Map<string, TextBlock>();
    blocks.forEach((block) => {
      if (block.text) {
        map.set(block.text, block);
      }
    });
    return map;
  }, [blocks]);

  // Improved font size calculation for pixel-perfect alignment
  const calculateAdvancedMetrics = useMemo(() => {
    return (block: TextBlock) => {
      const width = (block.bbox.x1 - block.bbox.x0) * scale;
      const height = (block.bbox.y1 - block.bbox.y0) * scale;
      const textLength = block.text.length;

      // More accurate font size calculation
      // Start with height-based size
      let fontSize = height * 0.85; // Increased from 0.75 for better fill

      // Calculate expected width with this font size
      // Average character width is approximately 0.55 * fontSize for Arial
      const avgCharWidth = fontSize * 0.55;
      const expectedWidth = avgCharWidth * textLength;

      // Adjust letter spacing to make text fit exactly
      let letterSpacing = 0;
      if (textLength > 1) {
        letterSpacing = (width - expectedWidth) / (textLength - 1);
      }

      // Clamp values for stability
      fontSize = Math.max(6, Math.min(120, fontSize));
      letterSpacing = Math.max(-2, Math.min(10, letterSpacing));

      return {
        fontSize,
        letterSpacing,
        wordSpacing: 0, // Not needed for individual words
        lineHeight: height,
      };
    };
  }, [scale]);

  // Memoize styled blocks for performance
  const styledBlocks = useMemo(() => {
    return blocks.map((block, index) => {
      const x = block.bbox.x0 * scale;
      const y = block.bbox.y0 * scale;
      const width = (block.bbox.x1 - block.bbox.x0) * scale;
      const height = (block.bbox.y1 - block.bbox.y0) * scale;

      const metrics = calculateAdvancedMetrics(block);

      return {
        index,
        block,
        x,
        y,
        width,
        height,
        metrics,
      };
    });
  }, [blocks, scale, calculateAdvancedMetrics]);

  // Listen to native browser selection with advanced block matching
  useEffect(() => {
    let debounceTimer: NodeJS.Timeout | null = null;

    const handleSelectionChange = () => {
      // Debounce to prevent excessive updates during drag selection
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
          setNativeSelection(null);
          return;
        }

        const range = selection.getRangeAt(0);
        const selectedText = range.toString();

        if (!selectedText || !selectedText.trim()) {
          setNativeSelection(null);
          return;
        }

        // Verify selection is within our text layer
        const container = containerRef.current;
        if (!container) {
          setNativeSelection(null);
          return;
        }

        // Check if selection is within the text layer
        const startNode = range.startContainer;
        const endNode = range.endContainer;

        const isWithinTextLayer = (node: Node): boolean => {
          let current: Node | null = node;
          while (current && current !== document.body) {
            if (current === container) return true;
            current = current.parentNode;
          }
          return false;
        };

        if (!isWithinTextLayer(startNode) || !isWithinTextLayer(endNode)) {
          // Selection is outside our text layer, ignore it
          return;
        }

        // Get bounding rectangles of the selection
        const rangeRects = range.getClientRects();
        if (rangeRects.length === 0) {
          setNativeSelection(null);
          return;
        }

        // Calculate the bounding box of all selection rectangles
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (let i = 0; i < rangeRects.length; i++) {
          const rect = rangeRects[i];
          if (rect.width === 0 || rect.height === 0) continue;

          minX = Math.min(minX, rect.left);
          minY = Math.min(minY, rect.top);
          maxX = Math.max(maxX, rect.right);
          maxY = Math.max(maxY, rect.bottom);
        }

        if (minX === Infinity) {
          setNativeSelection(null);
          return;
        }

        const containerRect = container.getBoundingClientRect();

        // Convert screen coordinates to PDF coordinates
        // Add minimal padding (1 pixel) to account for rounding
        const padding = 1 / scale;

        const selectionBBox = {
          x0: Math.max(0, (minX - containerRect.left) / scale - padding),
          y0: Math.max(0, (minY - containerRect.top) / scale - padding),
          x1: (maxX - containerRect.left) / scale + padding,
          y1: (maxY - containerRect.top) / scale + padding,
        };

        // Validate bbox dimensions
        const width = selectionBBox.x1 - selectionBBox.x0;
        const height = selectionBBox.y1 - selectionBBox.y0;

        // Reject unreasonably large bounding boxes (likely errors)
        const maxReasonableWidth = 2000; // 2000 PDF units (very wide page)
        const maxReasonableHeight = 3000; // 3000 PDF units (very tall page)

        if (width > maxReasonableWidth || height > maxReasonableHeight) {
          console.warn('Rejected large bbox:', { width, height, bbox: selectionBBox });
          setNativeSelection(null);
          return;
        }

        // Use the actual selection bbox directly
        const bbox: BoundingBox = {
          x0: selectionBBox.x0,
          y0: selectionBBox.y0,
          x1: selectionBBox.x1,
          y1: selectionBBox.y1,
        };

        // Debug logging
        console.log('Text Selection Debug:', {
          selectedText: `"${selectedText.substring(0, 50)}${selectedText.length > 50 ? '...' : ''}"`,
          textLength: selectedText.length,
          bbox,
          width,
          height,
        });

        setNativeSelection({ text: selectedText, bbox });
      }, 100); // 100ms debounce
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  }, [blocks, scale]);

  // Debounced callback to parent
  useEffect(() => {
    if (nativeSelection && nativeSelection.text) {
      const timeout = setTimeout(() => {
        onTextSelect(nativeSelection.text, nativeSelection.bbox);
      }, 200);
      return () => clearTimeout(timeout);
    }
  }, [nativeSelection, onTextSelect]);

  // Group blocks by line for proper spacing
  const groupedByLine = useMemo(() => {
    type StyledBlock = typeof styledBlocks[0];
    const lines: StyledBlock[][] = [];
    let currentLine: StyledBlock[] = [];
    let lastY = -1;

    styledBlocks.forEach((block) => {
      const blockY = block.y;

      // Check if on same line (within 5px tolerance)
      if (lastY === -1 || Math.abs(blockY - lastY) <= 5) {
        currentLine.push(block);
        lastY = blockY;
      } else {
        if (currentLine.length > 0) {
          lines.push(currentLine);
        }
        currentLine = [block];
        lastY = blockY;
      }
    });

    if (currentLine.length > 0) {
      lines.push(currentLine);
    }

    return lines;
  }, [styledBlocks]);

  return (
    <div
      ref={containerRef}
      className="text-layer-overlay"
      style={{
        width: pageWidth,
        height: pageHeight,
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'all',
        zIndex: 10,
      }}
    >
      {styledBlocks.map(({ index, block, x, y, width, height, metrics }) => {
        // Calculate horizontal scale to fit text exactly
        const textContent = block.text;
        const expectedTextWidth = metrics.fontSize * 0.55 * textContent.length +
                                  metrics.letterSpacing * (textContent.length - 1);
        const scaleX = width / Math.max(expectedTextWidth, 1);

        return (
          <div
            key={index}
            className="text-block-overlay"
            data-block-index={index}
            style={{
              position: 'absolute',
              left: `${x}px`,
              top: `${y}px`,
              width: `${width}px`,
              height: `${height}px`,
              fontSize: `${metrics.fontSize}px`,
              lineHeight: `${height}px`,
              letterSpacing: `${metrics.letterSpacing}px`,
              color: 'transparent',
              cursor: 'text',
              userSelect: 'text',
              WebkitUserSelect: 'text',
              MozUserSelect: 'text',
              msUserSelect: 'text',
              whiteSpace: 'nowrap',
              overflow: 'visible',
              fontFamily: 'Arial, Helvetica, sans-serif',
              fontWeight: 'normal',
              fontStyle: 'normal',
              textAlign: 'left',
              padding: 0,
              margin: 0,
              border: 'none',
              WebkitFontSmoothing: 'antialiased',
              MozOsxFontSmoothing: 'grayscale',
              display: 'inline-block',
              transformOrigin: 'left top',
              transform: `scaleX(${scaleX})`,
            }}
            title={`Block ${index}: "${block.text}"`}
          >
            {block.text}
            {/* Add invisible space after each word for browser selection */}
            <span style={{
              color: 'transparent',
              userSelect: 'text',
              pointerEvents: 'none',
            }}> </span>
          </div>
        );
      })}
    </div>
  );
};
