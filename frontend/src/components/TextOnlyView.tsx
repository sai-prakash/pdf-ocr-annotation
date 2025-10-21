import React, { useRef, useState, useEffect, useMemo } from 'react';
import type { PageData, BoundingBox } from '../store/pdfStore';
import { usePdfStore } from '../store/pdfStore';
import { TextLayerOverlay } from './TextLayerOverlay';
import { SelectionToolbar } from './SelectionToolbar';
import { AddTextModal } from './AddTextModal';
import './TextOnlyView.css';
import {
  SpatialIndex,
  getIntersectionRatio,
  extractTextFromBlock,
  sortBlocksInReadingOrder,
  resolveOverlappingBlocks,
  normalizeWhitespace,
  type SelectionMode,
  type SelectionRect,
} from '../utils/selectionUtils';
import {
  smartTextSelection,
  filterTextBlocks,
  getSelectionStatistics,
} from '../utils/smartSelectionEngine';
import {
  pointInPolygon,
  bboxIntersectsPolygon,
  simplifyPath,
  closePolygon,
  type Point,
} from '../utils/geometryUtils';

interface TextOnlyViewProps {
  pageData: PageData;
  currentPage: number;
}

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

export const TextOnlyView: React.FC<TextOnlyViewProps> = ({ pageData, currentPage }) => {
  const {
    annotations,
    searchResults,
    currentSearchIndex,
    selectedAnnotation,
    zoomLevel,
  } = usePdfStore();

  // Calculate scale to fit page width (similar to PDF viewer)
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const [pageWidth, setPageWidth] = useState<number>(800);
  const [textSelection, setTextSelection] = useState<TextSelection | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [currentMousePos, setCurrentMousePos] = useState<{ x: number; y: number } | null>(null);
  const [hoveredBlocks, setHoveredBlocks] = useState<any[]>([]);
  const [liveSelectedBlocks, setLiveSelectedBlocks] = useState<any[]>([]);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('word');
  const [previewText, setPreviewText] = useState<string>('');

  // Freeform selection states
  const [selectionTool, setSelectionTool] = useState<'rectangle' | 'lasso' | 'polygon' | 'add-text'>('rectangle');
  const [lassoPath, setLassoPath] = useState<Point[]>([]);
  const [polygonPoints, setPolygonPoints] = useState<Point[]>([]);

  // Add text mode states
  const [isAddTextModalOpen, setIsAddTextModalOpen] = useState(false);
  const [addTextBbox, setAddTextBbox] = useState<BoundingBox | null>(null);

  // Info overlay state
  const [showInfoOverlay, setShowInfoOverlay] = useState(false);

  // Calculate effective scale
  const baseScale = pageWidth / pageData.width;
  const effectiveScale = baseScale * zoomLevel;

  // Create spatial index for performance
  const spatialIndex = useMemo(() => {
    if (!pageData || !pageData.blocks) return null;
    return new SpatialIndex(pageData.blocks);
  }, [pageData]);

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

  // Same keyboard shortcuts as PDF view
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (event.key.toLowerCase()) {
        case 'r':
          setSelectionTool('rectangle');
          setPolygonPoints([]);
          setLassoPath([]);
          break;
        case 'l':
          setSelectionTool('lasso');
          setPolygonPoints([]);
          break;
        case 'p':
          setSelectionTool('polygon');
          setLassoPath([]);
          break;
        case 't':
          setSelectionTool('add-text');
          setPolygonPoints([]);
          setLassoPath([]);
          break;
        case 'i':
          setShowInfoOverlay(!showInfoOverlay);
          break;
        case 'escape':
          if (polygonPoints.length > 0) {
            setPolygonPoints([]);
          } else if (lassoPath.length > 0) {
            setLassoPath([]);
          } else if (textSelection) {
            event.preventDefault();
            setTextSelection(null);
          } else if (showInfoOverlay) {
            setShowInfoOverlay(false);
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [polygonPoints, lassoPath, textSelection, showInfoOverlay]);

  // Close text selection popup on click outside
  useEffect(() => {
    if (!textSelection) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        setTextSelection(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [textSelection]);

  // Draw canvas overlay (same as PDF viewer)
  useEffect(() => {
    if (!canvasRef.current || !pageData) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pageHeight = pageData.height * effectiveScale;
    const pageWidthScaled = pageData.width * effectiveScale;

    canvas.width = pageWidthScaled;
    canvas.height = pageHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw annotations (same as PDF viewer)
    annotations
      .filter((ann) => ann.page_number === currentPage)
      .forEach((ann) => {
        const x = ann.bounding_box.x0 * effectiveScale;
        const y = ann.bounding_box.y0 * effectiveScale;
        const width = (ann.bounding_box.x1 - ann.bounding_box.x0) * effectiveScale;
        const height = (ann.bounding_box.y1 - ann.bounding_box.y0) * effectiveScale;

        const isSelected = selectedAnnotation?.id === ann.id;

        if (isSelected) {
          ctx.fillStyle = ann.color + '60';
          ctx.fillRect(x - 4, y - 4, width + 8, height + 8);

          ctx.fillStyle = ann.color + '50';
          ctx.fillRect(x, y, width, height);

          ctx.strokeStyle = ann.color;
          ctx.lineWidth = 3;
          ctx.strokeRect(x, y, width, height);

          ctx.strokeStyle = ann.color;
          ctx.lineWidth = 1;
          ctx.setLineDash([6, 3]);
          ctx.strokeRect(x - 2, y - 2, width + 4, height + 4);
          ctx.setLineDash([]);
        } else {
          ctx.fillStyle = ann.color + '40';
          ctx.fillRect(x, y, width, height);

          ctx.strokeStyle = ann.color;
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y, width, height);
        }
      });

    // Draw search results
    searchResults
      .filter((result) => result.page_number === currentPage)
      .forEach((result) => {
        const x = result.bbox.x0 * effectiveScale;
        const y = result.bbox.y0 * effectiveScale;
        const width = (result.bbox.x1 - result.bbox.x0) * effectiveScale;
        const height = (result.bbox.y1 - result.bbox.y0) * effectiveScale;

        const globalIndex = searchResults.findIndex(
          (r) => r.page_number === result.page_number && r.match_index === result.match_index
        );
        const isCurrentResult = globalIndex === currentSearchIndex;

        if (isCurrentResult) {
          ctx.fillStyle = 'rgba(255, 152, 0, 0.5)';
          ctx.fillRect(x, y, width, height);

          ctx.strokeStyle = '#ff6f00';
          ctx.lineWidth = 3;
          ctx.strokeRect(x, y, width, height);
        } else {
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

      ctx.fillStyle = 'rgba(33, 150, 243, 0.15)';
      ctx.fillRect(rectX, rectY, rectWidth, rectHeight);

      ctx.strokeStyle = '#2196f3';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(rectX, rectY, rectWidth, rectHeight);
      ctx.setLineDash([]);

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

    // Draw lasso path
    if (lassoPath.length > 1) {
      if (lassoPath.length > 10 && pageData) {
        const closedPath = closePolygon(lassoPath, 20);
        const selectedBlocks = pageData.blocks.filter((block) =>
          bboxIntersectsPolygon(block.bbox, closedPath)
        );

        selectedBlocks.forEach((block) => {
          const x = block.bbox.x0 * effectiveScale;
          const y = block.bbox.y0 * effectiveScale;
          const width = (block.bbox.x1 - block.bbox.x0) * effectiveScale;
          const height = (block.bbox.y1 - block.bbox.y0) * effectiveScale;

          ctx.fillStyle = 'rgba(255, 152, 0, 0.25)';
          ctx.fillRect(x, y, width, height);

          ctx.strokeStyle = '#ff9800';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x, y, width, height);
        });
      }

      ctx.beginPath();
      ctx.moveTo(lassoPath[0].x * effectiveScale, lassoPath[0].y * effectiveScale);
      for (let i = 1; i < lassoPath.length; i++) {
        ctx.lineTo(lassoPath[i].x * effectiveScale, lassoPath[i].y * effectiveScale);
      }
      ctx.strokeStyle = '#ff9800';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(255, 152, 0, 0.1)';
      ctx.fill();
    }

    // Draw polygon points
    if (polygonPoints.length > 0) {
      if (polygonPoints.length >= 3 && pageData) {
        const closedPolygon = closePolygon(polygonPoints, 20);
        const selectedBlocks = pageData.blocks.filter((block) =>
          bboxIntersectsPolygon(block.bbox, closedPolygon)
        );

        selectedBlocks.forEach((block) => {
          const x = block.bbox.x0 * effectiveScale;
          const y = block.bbox.y0 * effectiveScale;
          const width = (block.bbox.x1 - block.bbox.x0) * effectiveScale;
          const height = (block.bbox.y1 - block.bbox.y0) * effectiveScale;

          ctx.fillStyle = 'rgba(156, 39, 176, 0.25)';
          ctx.fillRect(x, y, width, height);

          ctx.strokeStyle = '#9c27b0';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x, y, width, height);
        });
      }

      if (polygonPoints.length > 1) {
        ctx.beginPath();
        ctx.moveTo(polygonPoints[0].x * effectiveScale, polygonPoints[0].y * effectiveScale);
        for (let i = 1; i < polygonPoints.length; i++) {
          ctx.lineTo(polygonPoints[i].x * effectiveScale, polygonPoints[i].y * effectiveScale);
        }
        ctx.strokeStyle = '#9c27b0';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.fillStyle = 'rgba(156, 39, 176, 0.1)';
        ctx.fill();
      }

      polygonPoints.forEach((point, index) => {
        ctx.beginPath();
        ctx.arc(point.x * effectiveScale, point.y * effectiveScale, 6, 0, 2 * Math.PI);
        ctx.fillStyle = index === 0 ? '#e91e63' : '#9c27b0';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      });

      if (polygonPoints.length > 2 && currentMousePos) {
        const distToStart = Math.sqrt(
          Math.pow(currentMousePos.x - polygonPoints[0].x, 2) +
            Math.pow(currentMousePos.y - polygonPoints[0].y, 2)
        );
        if (distToStart < 15) {
          ctx.beginPath();
          ctx.arc(polygonPoints[0].x * effectiveScale, polygonPoints[0].y * effectiveScale, 12, 0, 2 * Math.PI);
          ctx.strokeStyle = '#4caf50';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }
    }

    // Draw current selection
    if (textSelection && textSelection.pageNumber === currentPage && textSelection.stats) {
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
  }, [pageData, effectiveScale, annotations, searchResults, currentSearchIndex, selectedAnnotation, textSelection, currentPage, hoveredBlocks, isSelecting, selectionStart, currentMousePos, liveSelectedBlocks, zoomLevel, lassoPath, polygonPoints]);

  // Mouse handlers (same as PDF viewer)
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !pageData) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / effectiveScale;
    const y = (e.clientY - rect.top) / effectiveScale;

    if (selectionTool === 'polygon') {
      const newPoint = { x, y };
      setPolygonPoints([...polygonPoints, newPoint]);

      if (polygonPoints.length > 2) {
        const distToStart = Math.sqrt(
          Math.pow(x - polygonPoints[0].x, 2) + Math.pow(y - polygonPoints[0].y, 2)
        );
        if (distToStart < 15) {
          handlePolygonSelection(polygonPoints);
          setPolygonPoints([]);
        }
      }
      return;
    }

    if (selectionTool === 'lasso') {
      setLassoPath([{ x, y }]);
      setIsSelecting(true);
      setTextSelection(null);
      return;
    }

    if (selectionTool === 'add-text') {
      setIsSelecting(true);
      setSelectionStart({ x, y });
      setCurrentMousePos({ x, y });
      return;
    }

    // Rectangle mode
    if (e.shiftKey) {
      setSelectionMode('line');
    } else if (e.ctrlKey || e.metaKey) {
      setSelectionMode('block');
    } else if (e.altKey) {
      setSelectionMode('precise');
    } else {
      setSelectionMode('word');
    }

    setIsSelecting(true);
    setSelectionStart({ x, y });
    setCurrentMousePos({ x, y });
    setTextSelection(null);
    setPreviewText('');
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !pageData || !spatialIndex) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / effectiveScale;
    const y = (e.clientY - rect.top) / effectiveScale;

    setCurrentMousePos({ x, y });

    if (isSelecting && selectionTool === 'lasso' && lassoPath.length > 0) {
      const newPath = [...lassoPath, { x, y }];
      setLassoPath(newPath);
      return;
    }

    if (isSelecting && selectionStart && selectionTool === 'rectangle') {
      const selRect: SelectionRect = {
        left: Math.min(selectionStart.x, x),
        right: Math.max(selectionStart.x, x),
        top: Math.min(selectionStart.y, y),
        bottom: Math.max(selectionStart.y, y),
      };

      const candidates = spatialIndex.query(selRect);
      const threshold = selectionMode === 'block' ? 0.1 : 0.3;
      const selectedBlocks = candidates.filter((block) => {
        const ratio = getIntersectionRatio(selRect, block.bbox);
        return ratio > threshold;
      });

      setLiveSelectedBlocks(selectedBlocks);

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
      const hovered = pageData.blocks.filter((block) => {
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

  const handlePolygonSelection = (polygon: Point[]) => {
    if (!pageData || polygon.length < 3) return;

    const closedPolygon = closePolygon(polygon);
    let selectedBlocks = pageData.blocks.filter((block) =>
      bboxIntersectsPolygon(block.bbox, closedPolygon)
    );

    selectedBlocks = filterTextBlocks(selectedBlocks);

    if (selectedBlocks.length > 0) {
      const smartResult = smartTextSelection(selectedBlocks, {
        detectColumns: true,
        respectReadingOrder: true,
        smartSpacing: true,
      });

      const sortedBlocks = smartResult.blocks;
      const combinedText = smartResult.text;

      const minX = Math.min(...sortedBlocks.map((b) => b.bbox.x0));
      const minY = Math.min(...sortedBlocks.map((b) => b.bbox.y0));
      const maxX = Math.max(...sortedBlocks.map((b) => b.bbox.x1));
      const maxY = Math.max(...sortedBlocks.map((b) => b.bbox.y1));

      const stats = getSelectionStatistics(sortedBlocks, combinedText);

      setTextSelection({
        text: combinedText,
        bbox: { x0: minX, y0: minY, x1: maxX, y1: maxY },
        pageNumber: currentPage,
        stats,
      });
    }
  };

  const handleCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isSelecting && selectionTool === 'lasso' && lassoPath.length > 10) {
      const simplifiedPath = simplifyPath(lassoPath, 3);
      handlePolygonSelection(simplifiedPath);
      setLassoPath([]);
      setIsSelecting(false);
      setLiveSelectedBlocks([]);
      return;
    }

    if (isSelecting && selectionTool === 'add-text' && selectionStart) {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / effectiveScale;
      const y = (e.clientY - rect.top) / effectiveScale;

      const bbox = {
        x0: Math.min(selectionStart.x, x),
        y0: Math.min(selectionStart.y, y),
        x1: Math.max(selectionStart.x, x),
        y1: Math.max(selectionStart.y, y),
      };

      const width = bbox.x1 - bbox.x0;
      const height = bbox.y1 - bbox.y0;

      if (width > 5 && height > 5) {
        setAddTextBbox(bbox);
        setIsAddTextModalOpen(true);
      }

      setIsSelecting(false);
      setSelectionStart(null);
      setCurrentMousePos(null);
      return;
    }

    if (!isSelecting || !selectionStart || !pageData || !spatialIndex) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / effectiveScale;
    const y = (e.clientY - rect.top) / effectiveScale;

    const selRect: SelectionRect = {
      left: Math.min(selectionStart.x, x),
      right: Math.max(selectionStart.x, x),
      top: Math.min(selectionStart.y, y),
      bottom: Math.max(selectionStart.y, y),
    };

    const selectionWidth = selRect.right - selRect.left;
    const selectionHeight = selRect.bottom - selRect.top;

    if (selectionWidth < 5 && selectionHeight < 5) {
      setIsSelecting(false);
      setSelectionStart(null);
      setLiveSelectedBlocks([]);
      setPreviewText('');
      return;
    }

    const candidates = spatialIndex.query(selRect);
    const threshold = selectionMode === 'block' ? 0.05 : 0.15;
    let selectedBlocks = candidates.filter((block) => {
      const ratio = getIntersectionRatio(selRect, block.bbox);
      return ratio > threshold;
    });

    selectedBlocks = resolveOverlappingBlocks(selectedBlocks);
    selectedBlocks = filterTextBlocks(selectedBlocks);

    if (selectedBlocks.length > 0) {
      const smartResult = smartTextSelection(selectedBlocks, {
        detectColumns: true,
        respectReadingOrder: true,
        smartSpacing: true,
      });

      const sortedBlocks = smartResult.blocks;
      const combinedText = smartResult.text;

      const minX = Math.min(...sortedBlocks.map((b) => b.bbox.x0));
      const minY = Math.min(...sortedBlocks.map((b) => b.bbox.y0));
      const maxX = Math.max(...sortedBlocks.map((b) => b.bbox.x1));
      const maxY = Math.max(...sortedBlocks.map((b) => b.bbox.y1));

      const width = maxX - minX;
      const height = maxY - minY;

      const maxReasonableWidth = 2000;
      const maxReasonableHeight = 3000;

      if (width > maxReasonableWidth || height > maxReasonableHeight) {
        console.warn('Text-only view: Rejected large bbox:', { width, height });
        setIsSelecting(false);
        setSelectionStart(null);
        setLiveSelectedBlocks([]);
        setPreviewText('');
        return;
      }

      const stats = getSelectionStatistics(sortedBlocks, combinedText);

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

  const handleTextLayerSelection = (text: string, bbox: BoundingBox) => {
    setTextSelection({
      text,
      bbox,
      pageNumber: currentPage,
    });
  };

  const handleAddTextSave = (text: string) => {
    if (!addTextBbox) return;

    const event = new CustomEvent('createAnnotation', {
      detail: {
        text,
        bbox: addTextBbox,
        pageNumber: currentPage,
      },
    });
    window.dispatchEvent(event);

    setIsAddTextModalOpen(false);
    setAddTextBbox(null);
  };

  const handleAddTextCancel = () => {
    setIsAddTextModalOpen(false);
    setAddTextBbox(null);
  };

  return (
    <div className="text-only-view" ref={containerRef}>
      {/* Selection Toolbar */}
      <SelectionToolbar
        currentTool={selectionTool}
        onToolChange={(tool) => {
          setSelectionTool(tool);
          setPolygonPoints([]);
          setLassoPath([]);
        }}
      />

      {/* Info Overlay Toggle */}
      <button
        className="info-overlay-toggle"
        onClick={() => setShowInfoOverlay(!showInfoOverlay)}
        title="Toggle Info Overlay (I)"
      >
        {showInfoOverlay ? 'Hide Info (I)' : 'Show Info (I)'}
      </button>

      {/* Info Overlay */}
      {showInfoOverlay && (
        <div className="text-only-info-overlay">
          <div className="info-header">
            <h3>Page {currentPage} - Text View</h3>
            <button className="close-info" onClick={() => setShowInfoOverlay(false)}>×</button>
          </div>
          <div className="info-stats">
            <div className="stat-item">
              <span className="stat-label">Text Blocks:</span>
              <span className="stat-value">{pageData.block_count}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Characters:</span>
              <span className="stat-value">{pageData.full_text.length}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Extraction:</span>
              <span className="stat-value">{pageData.is_scanned ? 'OCR' : 'Native'}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Words:</span>
              <span className="stat-value">{pageData.full_text.split(/\s+/).filter(w => w.length > 0).length}</span>
            </div>
          </div>
          <details className="raw-text-section">
            <summary>Show Raw Text (Copyable)</summary>
            <pre className="raw-text-content">{pageData.full_text}</pre>
          </details>
        </div>
      )}

      {/* Positioned text blocks (white background mimicking PDF) */}
      <div className="text-only-content">
        <div
          className="text-only-positioned"
          style={{
            position: 'relative',
            width: pageWidth * zoomLevel,
            height: pageData.height * effectiveScale,
            margin: '0 auto',
            backgroundColor: '#fff',
            border: '1px solid #e0e0e0',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          }}
        >
          {/* Text blocks rendered at exact positions */}
          {pageData.blocks.map((block, index) => {
            const x = block.bbox.x0 * effectiveScale;
            const y = block.bbox.y0 * effectiveScale;
            const width = (block.bbox.x1 - block.bbox.x0) * effectiveScale;
            const height = (block.bbox.y1 - block.bbox.y0) * effectiveScale;
            const fontSize = Math.max(10, height * 0.7);

            return (
              <div
                key={index}
                className={`text-block-positioned ${block.type}`}
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
                  pointerEvents: 'none',
                }}
              >
                {block.text}
              </div>
            );
          })}

          {/* Invisible text layer for native browser selection */}
          {pageData && pageData.blocks && (
            <TextLayerOverlay
              blocks={pageData.blocks}
              scale={effectiveScale}
              pageWidth={pageWidth * zoomLevel}
              pageHeight={pageData.height * effectiveScale}
              onTextSelect={handleTextLayerSelection}
            />
          )}

          {/* Canvas overlay for annotations and selections */}
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
              cursor:
                selectionTool === 'lasso' ? 'crosshair' :
                selectionTool === 'polygon' ? 'crosshair' :
                selectionTool === 'add-text' ? 'crosshair' :
                isSelecting ? 'crosshair' :
                hoveredBlocks.length > 0 ? 'pointer' : 'text',
              pointerEvents:
                selectionTool === 'lasso' || selectionTool === 'polygon' || selectionTool === 'add-text' || isSelecting
                  ? 'all'
                  : 'none',
            }}
          />
        </div>
      </div>

      {/* Selection tooltip */}
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

      {/* Text selection popup */}
      {textSelection && (
        <div ref={popupRef} className="text-selection-popup">
          <div className="popup-header">
            <strong>Selected Text</strong>
            {textSelection.stats && (
              <div className="selection-stats-inline">
                <span>{textSelection.stats.wordCount} words</span>
                <span>•</span>
                <span>{textSelection.stats.charCount} chars</span>
              </div>
            )}
          </div>
          <div className="popup-text-content">
            {textSelection.text}
          </div>
          {textSelection.stats && (
            <div className="selection-stats">
              <span>{textSelection.stats.blockCount} blocks</span>
              <span>{Math.round(textSelection.stats.avgConfidence * 100)}% confidence</span>
            </div>
          )}
          <div className="selection-actions">
            <button
              onClick={() => {
                navigator.clipboard.writeText(textSelection.text);
              }}
              title="Copy text (Ctrl+C)"
            >
              Copy Text
            </button>
            <button
              onClick={() => {
                const event = new CustomEvent('createAnnotation', {
                  detail: textSelection,
                });
                window.dispatchEvent(event);
                setTextSelection(null);
              }}
            >
              Create Annotation
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setTextSelection(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Add Text Modal */}
      {addTextBbox && (
        <AddTextModal
          isOpen={isAddTextModalOpen}
          bbox={addTextBbox}
          pageNumber={currentPage}
          onSave={handleAddTextSave}
          onCancel={handleAddTextCancel}
        />
      )}
    </div>
  );
};
