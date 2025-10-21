import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { usePdfStore } from '../store/pdfStore';
import type { BoundingBox } from '../store/pdfStore';
import { TextLayerOverlay } from './TextLayerOverlay';
import { TextOnlyView } from './TextOnlyView';
import { SelectionToolbar } from './SelectionToolbar';
import { AddTextModal } from './AddTextModal';
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
  getPolygonBounds,
  type Point,
} from '../utils/geometryUtils';

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
    viewMode,
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

  // Freeform selection states
  const [selectionTool, setSelectionTool] = useState<'rectangle' | 'lasso' | 'polygon' | 'add-text'>('rectangle');
  const [lassoPath, setLassoPath] = useState<Point[]>([]);
  const [polygonPoints, setPolygonPoints] = useState<Point[]>([]);

  // Add text mode states
  const [isAddTextModalOpen, setIsAddTextModalOpen] = useState(false);
  const [addTextBbox, setAddTextBbox] = useState<BoundingBox | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Get current page data (must be defined before useMemo hooks that depend on it)
  const currentPageData = pages.find((p) => p.page_number === currentPage);

  // Calculate effective scale (base fit * zoom level) - must be before useEffects that use it
  const baseScale = pageWidth / (currentPageData?.width || 800);
  const effectiveScale = baseScale * zoomLevel;

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

  // Handle scroll to annotation event
  useEffect(() => {
    const handleScrollToAnnotation = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { annotation } = customEvent.detail;

      if (!canvasRef.current) return;

      // Wait for page change to complete if needed
      setTimeout(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Calculate annotation position
        const y = annotation.bounding_box.y0 * effectiveScale;
        const x = annotation.bounding_box.x0 * effectiveScale;

        // Scroll canvas into view with the annotation centered
        const canvasRect = canvas.getBoundingClientRect();
        const containerRect = containerRef.current?.getBoundingClientRect();

        if (containerRect) {
          const scrollX = x - containerRect.width / 2;
          const scrollY = y - containerRect.height / 2;

          // Smooth scroll to the annotation
          containerRef.current?.scrollTo({
            top: scrollY,
            left: scrollX,
            behavior: 'smooth',
          });
        }
      }, 100);
    };

    window.addEventListener('scrollToAnnotation', handleScrollToAnnotation);
    return () => window.removeEventListener('scrollToAnnotation', handleScrollToAnnotation);
  }, [effectiveScale]);

  // Handle highlight annotation event (flashing effect)
  const [flashingAnnotationId, setFlashingAnnotationId] = useState<string | null>(null);

  useEffect(() => {
    const handleHighlightAnnotation = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { annotationId } = customEvent.detail;

      // Set the flashing annotation (this will trigger visual effect in canvas draw)
      setFlashingAnnotationId(annotationId);
    };

    window.addEventListener('highlightAnnotation', handleHighlightAnnotation);
    return () => window.removeEventListener('highlightAnnotation', handleHighlightAnnotation);
  }, []);

  // Keyboard shortcuts for tool switching
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if user is typing in an input
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
        case 'escape':
          // Cancel current polygon/lasso or close popup
          if (polygonPoints.length > 0) {
            setPolygonPoints([]);
          } else if (lassoPath.length > 0) {
            setLassoPath([]);
          } else if (textSelection) {
            event.preventDefault();
            const selection = window.getSelection();
            if (selection) {
              selection.removeAllRanges();
            }
            setTextSelection(null);
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [polygonPoints, lassoPath, textSelection]);

  // Close text selection popup on click outside
  useEffect(() => {
    if (!textSelection) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        // Clear browser selection when closing popup
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
        }
        setTextSelection(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [textSelection]);

  const onDocumentLoadSuccess = () => {
    // Document loaded successfully
  };

  const onPageLoadSuccess = () => {
    // Page loaded successfully
  };

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
        const isFlashing = flashingAnnotationId === ann.id;

        // Highlight flashing annotation (from click in annotation panel)
        if (isFlashing) {
          // Bright yellow flash effect
          ctx.fillStyle = 'rgba(255, 215, 0, 0.6)';
          ctx.fillRect(x - 6, y - 6, width + 12, height + 12);

          // Inner highlight
          ctx.fillStyle = 'rgba(255, 235, 59, 0.5)';
          ctx.fillRect(x, y, width, height);

          // Bold golden border
          ctx.strokeStyle = '#ffd700';
          ctx.lineWidth = 4;
          ctx.strokeRect(x, y, width, height);

          // Pulsing outer glow
          ctx.strokeStyle = '#ffd700';
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 4]);
          ctx.strokeRect(x - 4, y - 4, width + 8, height + 8);
          ctx.setLineDash([]);
        } else if (isSelected) {
          // Highlight selected annotation with enhanced styling
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

    // Draw lasso path
    if (lassoPath.length > 1) {
      // Show selected blocks in real-time for lasso mode
      if (lassoPath.length > 10 && currentPageData) {
        const closedPath = closePolygon(lassoPath, 20);
        const selectedBlocks = currentPageData.blocks.filter((block) =>
          bboxIntersectsPolygon(block.bbox, closedPath)
        );

        // Draw selected blocks
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

      // Fill semi-transparent
      ctx.fillStyle = 'rgba(255, 152, 0, 0.1)';
      ctx.fill();
    }

    // Draw polygon points
    if (polygonPoints.length > 0) {
      // Show selected blocks in real-time for polygon mode
      if (polygonPoints.length >= 3 && currentPageData) {
        const closedPolygon = closePolygon(polygonPoints, 20);
        const selectedBlocks = currentPageData.blocks.filter((block) =>
          bboxIntersectsPolygon(block.bbox, closedPolygon)
        );

        // Draw selected blocks
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

      // Draw lines between points
      if (polygonPoints.length > 1) {
        ctx.beginPath();
        ctx.moveTo(polygonPoints[0].x * effectiveScale, polygonPoints[0].y * effectiveScale);
        for (let i = 1; i < polygonPoints.length; i++) {
          ctx.lineTo(polygonPoints[i].x * effectiveScale, polygonPoints[i].y * effectiveScale);
        }
        ctx.strokeStyle = '#9c27b0';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Show fill preview
        ctx.fillStyle = 'rgba(156, 39, 176, 0.1)';
        ctx.fill();
      }

      // Draw points as circles
      polygonPoints.forEach((point, index) => {
        ctx.beginPath();
        ctx.arc(point.x * effectiveScale, point.y * effectiveScale, 6, 0, 2 * Math.PI);
        ctx.fillStyle = index === 0 ? '#e91e63' : '#9c27b0'; // First point is different color
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      });

      // Show distance to start point for closing
      if (polygonPoints.length > 2 && currentMousePos) {
        const distToStart = Math.sqrt(
          Math.pow(currentMousePos.x - polygonPoints[0].x, 2) +
            Math.pow(currentMousePos.y - polygonPoints[0].y, 2)
        );
        if (distToStart < 15) {
          // Highlight start point
          ctx.beginPath();
          ctx.arc(polygonPoints[0].x * effectiveScale, polygonPoints[0].y * effectiveScale, 12, 0, 2 * Math.PI);
          ctx.strokeStyle = '#4caf50';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }
    }

    // Draw current selection (after mouse up) - ONLY for canvas selections, not text layer
    // Text layer selections show native browser highlight, don't need canvas highlight
    if (textSelection && textSelection.pageNumber === currentPage && textSelection.stats) {
      // Only draw if selection has stats (came from canvas selection, not text layer)
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
  }, [currentPageData, effectiveScale, annotations, searchResults, currentSearchIndex, selectedAnnotation, textSelection, currentPage, hoveredBlocks, isSelecting, selectionStart, currentMousePos, liveSelectedBlocks, zoomLevel, flashingAnnotationId, lassoPath, polygonPoints]);

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !currentPageData) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / effectiveScale;
    const y = (e.clientY - rect.top) / effectiveScale;

    if (selectionTool === 'polygon') {
      // Polygon mode: Add point on click
      const newPoint = { x, y };
      setPolygonPoints([...polygonPoints, newPoint]);

      // Double-click or click near start to close polygon
      if (polygonPoints.length > 2) {
        const distToStart = Math.sqrt(
          Math.pow(x - polygonPoints[0].x, 2) + Math.pow(y - polygonPoints[0].y, 2)
        );
        if (distToStart < 15) {
          // Close polygon and select
          handlePolygonSelection(polygonPoints);
          setPolygonPoints([]);
        }
      }
      return;
    }

    if (selectionTool === 'lasso') {
      // Lasso mode: Start drawing
      setLassoPath([{ x, y }]);
      setIsSelecting(true);
      setTextSelection(null);
      return;
    }

    if (selectionTool === 'add-text') {
      // Add text mode: Start drawing bounding box
      setIsSelecting(true);
      setSelectionStart({ x, y });
      setCurrentMousePos({ x, y });
      return;
    }

    // Rectangle mode
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

    // Lasso mode: Add points to path
    if (isSelecting && selectionTool === 'lasso' && lassoPath.length > 0) {
      const newPath = [...lassoPath, { x, y }];
      setLassoPath(newPath);
      return;
    }

    if (isSelecting && selectionStart && selectionTool === 'rectangle') {
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

  // Handle polygon selection completion
  const handlePolygonSelection = (polygon: Point[]) => {
    if (!currentPageData || polygon.length < 3) return;

    const closedPolygon = closePolygon(polygon);

    // Find blocks inside polygon
    let selectedBlocks = currentPageData.blocks.filter((block) =>
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
    // Lasso mode: Complete selection
    if (isSelecting && selectionTool === 'lasso' && lassoPath.length > 10) {
      const simplifiedPath = simplifyPath(lassoPath, 3);
      handlePolygonSelection(simplifiedPath);
      setLassoPath([]);
      setIsSelecting(false);
      setLiveSelectedBlocks([]);
      return;
    }

    // Add text mode: Open modal with drawn bounding box
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

      // Check minimum size
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

    // Filter out empty/invalid blocks and decorative elements
    selectedBlocks = filterTextBlocks(selectedBlocks);

    if (selectedBlocks.length > 0) {
      // Use smart selection engine for intelligent text grouping
      const smartResult = smartTextSelection(selectedBlocks, {
        detectColumns: true,
        respectReadingOrder: true,
        smartSpacing: true,
      });

      const sortedBlocks = smartResult.blocks;
      const combinedText = smartResult.text;

      // DEBUG: Check if text has spaces
      console.log('[CANVAS SELECTION] Combined text:', combinedText);
      console.log('[CANVAS SELECTION] Has spaces?', combinedText.includes(' '));
      console.log('[CANVAS SELECTION] First 100 chars:', combinedText.substring(0, 100));

      // Log column detection for debugging
      if (smartResult.columns.length > 1) {
        console.log(`Smart Selection: Detected ${smartResult.columns.length} columns`);
      }

      // Calculate bounding box for all selected blocks
      const minX = Math.min(...sortedBlocks.map((b) => b.bbox.x0));
      const minY = Math.min(...sortedBlocks.map((b) => b.bbox.y0));
      const maxX = Math.max(...sortedBlocks.map((b) => b.bbox.x1));
      const maxY = Math.max(...sortedBlocks.map((b) => b.bbox.y1));

      // Validate bbox dimensions
      const width = maxX - minX;
      const height = maxY - minY;

      // Reject unreasonably large bounding boxes (likely errors)
      const maxReasonableWidth = 2000; // 2000 PDF units
      const maxReasonableHeight = 3000; // 3000 PDF units

      if (width > maxReasonableWidth || height > maxReasonableHeight) {
        console.warn('Canvas selection: Rejected large bbox:', { width, height });
        setIsSelecting(false);
        setSelectionStart(null);
        setLiveSelectedBlocks([]);
        setPreviewText('');
        return;
      }

      // Get statistics using smart engine
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

  if (!fileUrl) {
    return (
      <div className="pdf-viewer-empty">
        <p>No PDF loaded. Please upload a PDF file.</p>
      </div>
    );
  }

  // Handler for native text selection from TextLayerOverlay
  const handleTextLayerSelection = (text: string, bbox: BoundingBox) => {
    setTextSelection({
      text,
      bbox,
      pageNumber: currentPage,
    });
  };

  // Handler for manual text addition
  const handleAddTextSave = (text: string) => {
    if (!addTextBbox) return;

    // Create annotation directly with manually entered text
    const event = new CustomEvent('createAnnotation', {
      detail: {
        text,
        bbox: addTextBbox,
        pageNumber: currentPage,
      },
    });
    window.dispatchEvent(event);

    // Close modal and reset
    setIsAddTextModalOpen(false);
    setAddTextBbox(null);
  };

  const handleAddTextCancel = () => {
    setIsAddTextModalOpen(false);
    setAddTextBbox(null);
  };

  // Text-only view mode
  if (viewMode === 'text-only') {
    if (!currentPageData) {
      return (
        <div className="pdf-viewer-empty">
          <p>Loading page data...</p>
        </div>
      );
    }

    return (
      <div className="pdf-viewer-container" ref={containerRef}>
        <TextOnlyView pageData={currentPageData} currentPage={currentPage} />
      </div>
    );
  }

  // PDF view mode (with optional text layer overlay)
  return (
    <div className="pdf-viewer-container" ref={containerRef}>
      {/* Selection Toolbar */}
      <SelectionToolbar
        currentTool={selectionTool}
        onToolChange={(tool) => {
          setSelectionTool(tool);
          setPolygonPoints([]);
          setLassoPath([]);
        }}
      />

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
              renderTextLayer={false}
              renderAnnotationLayer={false}
            />

            {/* Invisible text layer for native browser selection */}
            {currentPageData && currentPageData.blocks && (
              <TextLayerOverlay
                blocks={currentPageData.blocks}
                scale={effectiveScale}
                pageWidth={pageWidth * zoomLevel}
                pageHeight={currentPageData.height * effectiveScale}
                onTextSelect={handleTextLayerSelection}
              />
            )}

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
                // Allow canvas events for lasso/polygon/add-text tools, otherwise let text layer handle
                pointerEvents:
                  selectionTool === 'lasso' || selectionTool === 'polygon' || selectionTool === 'add-text' || isSelecting
                    ? 'all'
                    : 'none',
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
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  // Clear browser selection when closing popup
                  const selection = window.getSelection();
                  if (selection) {
                    selection.removeAllRanges();
                  }
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
    </div>
  );
};
