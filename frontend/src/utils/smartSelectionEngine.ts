/**
 * Smart Selection Engine
 * Handles intelligent text block grouping, column detection, and reading order
 */

import type { TextBlock, BoundingBox } from '../store/pdfStore';

export interface Column {
  index: number;
  x0: number;
  x1: number;
  blocks: TextBlock[];
}

export interface SmartSelectionResult {
  blocks: TextBlock[];
  text: string;
  columns: Column[];
  readingOrder: number[];
}

/**
 * Detect columns in a page using X-coordinate clustering
 * NOTE: Increased tolerance for word-level blocks from Tesseract
 */
export function detectColumns(blocks: TextBlock[], tolerance: number = 100): Column[] {
  if (blocks.length === 0) return [];

  // Sort blocks by X coordinate
  const sortedBlocks = [...blocks].sort((a, b) => a.bbox.x0 - b.bbox.x0);

  const columns: Column[] = [];
  let currentColumn: TextBlock[] = [sortedBlocks[0]];
  let columnX0 = sortedBlocks[0].bbox.x0;
  let columnX1 = sortedBlocks[0].bbox.x1;

  for (let i = 1; i < sortedBlocks.length; i++) {
    const block = sortedBlocks[i];

    // Check if block overlaps with current column (horizontally)
    // Increased tolerance to handle word-level spacing
    const overlaps = !(block.bbox.x0 > columnX1 + tolerance || block.bbox.x1 < columnX0 - tolerance);

    if (overlaps) {
      // Add to current column
      currentColumn.push(block);
      columnX0 = Math.min(columnX0, block.bbox.x0);
      columnX1 = Math.max(columnX1, block.bbox.x1);
    } else {
      // Start new column
      columns.push({
        index: columns.length,
        x0: columnX0,
        x1: columnX1,
        blocks: currentColumn,
      });

      currentColumn = [block];
      columnX0 = block.bbox.x0;
      columnX1 = block.bbox.x1;
    }
  }

  // Add last column
  if (currentColumn.length > 0) {
    columns.push({
      index: columns.length,
      x0: columnX0,
      x1: columnX1,
      blocks: currentColumn,
    });
  }

  return columns;
}

/**
 * Check if two blocks are on the same line (horizontally aligned)
 */
function areOnSameLine(block1: TextBlock, block2: TextBlock, tolerance: number = 10): boolean {
  const y1Mid = (block1.bbox.y0 + block1.bbox.y1) / 2;
  const y2Mid = (block2.bbox.y0 + block2.bbox.y1) / 2;

  // Use dynamic tolerance based on block height (handles different font sizes)
  const avgHeight = ((block1.bbox.y1 - block1.bbox.y0) + (block2.bbox.y1 - block2.bbox.y0)) / 2;
  const dynamicTolerance = Math.max(tolerance, avgHeight * 0.3); // 30% of average height

  return Math.abs(y1Mid - y2Mid) < dynamicTolerance;
}

/**
 * Sort blocks within a column in reading order (top to bottom, left to right)
 */
function sortBlocksInColumn(blocks: TextBlock[]): TextBlock[] {
  return blocks.sort((a, b) => {
    // Group by lines first
    if (areOnSameLine(a, b)) {
      // Same line: sort left to right
      return a.bbox.x0 - b.bbox.x0;
    }
    // Different lines: sort top to bottom
    return a.bbox.y0 - b.bbox.y0;
  });
}

/**
 * Join text blocks with intelligent spacing
 */
function joinBlocksWithSpacing(blocks: TextBlock[]): string {
  if (blocks.length === 0) return '';
  if (blocks.length === 1) return blocks[0].text;

  let result = blocks[0].text;

  for (let i = 1; i < blocks.length; i++) {
    const prev = blocks[i - 1];
    const curr = blocks[i];

    // Check if blocks are on the same line
    if (areOnSameLine(prev, curr)) {
      // Same line: add space
      result += ' ' + curr.text;
      console.log(`[JOIN] Same line: "${prev.text}" + " " + "${curr.text}"`);
    } else {
      // Different line: check if it's a new paragraph
      const verticalGap = curr.bbox.y0 - prev.bbox.y1;
      const avgHeight = (prev.bbox.y1 - prev.bbox.y0 + curr.bbox.y1 - curr.bbox.y0) / 2;

      if (verticalGap > avgHeight * 0.5) {
        // Large gap: new paragraph
        result += '\n\n' + curr.text;
        console.log(`[JOIN] New paragraph: "${prev.text}" + "\\n\\n" + "${curr.text}"`);
      } else {
        // Small gap: new line
        result += '\n' + curr.text;
        console.log(`[JOIN] New line: "${prev.text}" + "\\n" + "${curr.text}"`);
      }
    }
  }

  console.log(`[JOIN] Final result: "${result}"`);
  return result;
}

/**
 * Smart selection: Analyze selection and return intelligently grouped text
 */
export function smartTextSelection(
  selectedBlocks: TextBlock[],
  options: {
    detectColumns?: boolean;
    respectReadingOrder?: boolean;
    smartSpacing?: boolean;
  } = {}
): SmartSelectionResult {
  const {
    detectColumns: shouldDetectColumns = true,
    respectReadingOrder = true,
    smartSpacing = true,
  } = options;

  if (selectedBlocks.length === 0) {
    return {
      blocks: [],
      text: '',
      columns: [],
      readingOrder: [],
    };
  }

  // Detect columns if enabled
  const columns = shouldDetectColumns ? detectColumns(selectedBlocks) : [];

  let orderedBlocks: TextBlock[];

  if (columns.length > 1 && shouldDetectColumns) {
    // Multi-column layout: sort each column separately, then combine
    orderedBlocks = [];

    for (const column of columns) {
      const sortedColumnBlocks = sortBlocksInColumn(column.blocks);
      orderedBlocks.push(...sortedColumnBlocks);
    }
  } else {
    // Single column or column detection disabled: simple reading order
    orderedBlocks = respectReadingOrder
      ? sortBlocksInColumn(selectedBlocks)
      : selectedBlocks;
  }

  // Generate text with smart spacing
  const text = smartSpacing
    ? joinBlocksWithSpacing(orderedBlocks)
    : orderedBlocks.map((b) => b.text).join(' ');

  // Generate reading order indices
  const readingOrder = orderedBlocks.map((block) =>
    selectedBlocks.indexOf(block)
  );

  return {
    blocks: orderedBlocks,
    text,
    columns,
    readingOrder,
  };
}

/**
 * Calculate confidence score for a selection
 */
export function calculateSelectionConfidence(blocks: TextBlock[]): number {
  if (blocks.length === 0) return 0;

  const confidences = blocks
    .filter((b) => b.confidence !== undefined)
    .map((b) => b.confidence!);

  if (confidences.length === 0) return 1.0; // Native text has 100% confidence

  return confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length;
}

/**
 * Get selection statistics
 */
export function getSelectionStatistics(blocks: TextBlock[], text: string) {
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
  const charCount = text.length;
  const blockCount = blocks.length;
  const avgConfidence = calculateSelectionConfidence(blocks);

  return {
    wordCount,
    charCount,
    blockCount,
    avgConfidence,
  };
}

/**
 * Detect if selection spans multiple columns
 */
export function detectMultiColumnSelection(blocks: TextBlock[]): boolean {
  const columns = detectColumns(blocks);
  return columns.length > 1;
}

/**
 * Filter out decorative/non-text elements
 */
export function filterTextBlocks(blocks: TextBlock[]): TextBlock[] {
  return blocks.filter((block) => {
    // Remove blocks with no text
    if (!block.text || block.text.trim().length === 0) return false;

    // Remove blocks with only symbols/punctuation
    const alphanumericCount = (block.text.match(/[a-zA-Z0-9]/g) || []).length;
    if (alphanumericCount < block.text.length * 0.3) return false;

    // Remove very small blocks (likely noise)
    const width = block.bbox.x1 - block.bbox.x0;
    const height = block.bbox.y1 - block.bbox.y0;
    if (width < 5 || height < 5) return false;

    return true;
  });
}
