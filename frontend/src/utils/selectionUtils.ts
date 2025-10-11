// Advanced Selection Utilities

export interface Block {
  text: string;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  confidence?: number;
}

export interface SelectionRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export type SelectionMode = 'precise' | 'word' | 'line' | 'block' | 'column';

/**
 * Spatial Index for fast block lookup
 * Dramatically improves performance on dense pages (1000+ blocks)
 */
export class SpatialIndex {
  private grid: Map<string, Block[]> = new Map();
  private cellSize: number;

  constructor(blocks: Block[], cellSize = 50) {
    this.cellSize = cellSize;
    this.indexBlocks(blocks);
  }


  private indexBlocks(blocks: Block[]) {
    for (const block of blocks) {
      const minCellX = Math.floor(block.bbox.x0 / this.cellSize);
      const maxCellX = Math.floor(block.bbox.x1 / this.cellSize);
      const minCellY = Math.floor(block.bbox.y0 / this.cellSize);
      const maxCellY = Math.floor(block.bbox.y1 / this.cellSize);

      for (let cx = minCellX; cx <= maxCellX; cx++) {
        for (let cy = minCellY; cy <= maxCellY; cy++) {
          const key = `${cx},${cy}`;
          if (!this.grid.has(key)) {
            this.grid.set(key, []);
          }
          this.grid.get(key)!.push(block);
        }
      }
    }
  }

  query(selRect: SelectionRect): Block[] {
    const candidates = new Set<Block>();

    const minCellX = Math.floor(selRect.left / this.cellSize);
    const maxCellX = Math.floor(selRect.right / this.cellSize);
    const minCellY = Math.floor(selRect.top / this.cellSize);
    const maxCellY = Math.floor(selRect.bottom / this.cellSize);

    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        const key = `${cx},${cy}`;
        const blocks = this.grid.get(key) || [];
        blocks.forEach((b) => candidates.add(b));
      }
    }

    return Array.from(candidates);
  }
}

/**
 * Calculate intersection ratio between selection and block
 */
export function getIntersectionRatio(selRect: SelectionRect, bbox: Block['bbox']): number {
  const intersectLeft = Math.max(selRect.left, bbox.x0);
  const intersectRight = Math.min(selRect.right, bbox.x1);
  const intersectTop = Math.max(selRect.top, bbox.y0);
  const intersectBottom = Math.min(selRect.bottom, bbox.y1);

  const intersectWidth = Math.max(0, intersectRight - intersectLeft);
  const intersectHeight = Math.max(0, intersectBottom - intersectTop);
  const intersectArea = intersectWidth * intersectHeight;

  const blockWidth = bbox.x1 - bbox.x0;
  const blockHeight = bbox.y1 - bbox.y0;
  const blockArea = blockWidth * blockHeight;

  return blockArea > 0 ? intersectArea / blockArea : 0;
}

/**
 * Snap character indices to word boundaries
 */
export function snapToWordBoundaries(
  text: string,
  startChar: number,
  endChar: number
): { startChar: number; endChar: number } {
  // Word boundary characters
  const wordBoundaryRegex = /[\s,.\!?\;:\(\)\[\]\{\}"'`]/;

  // Ensure we're within bounds
  startChar = Math.max(0, Math.min(startChar, text.length));
  endChar = Math.max(0, Math.min(endChar, text.length));

  // Snap start backward to word start
  while (startChar > 0 && !wordBoundaryRegex.test(text[startChar - 1])) {
    startChar--;
  }

  // Snap end forward to word end
  while (endChar < text.length && !wordBoundaryRegex.test(text[endChar])) {
    endChar++;
  }

  // Trim leading/trailing whitespace from indices
  while (startChar < text.length && /\s/.test(text[startChar])) {
    startChar++;
  }
  while (endChar > 0 && /\s/.test(text[endChar - 1])) {
    endChar--;
  }

  return { startChar, endChar };
}

/**
 * Detect columns in block layout
 */
export function detectColumns(blocks: Block[]): number[] {
  if (blocks.length === 0) return [];

  // Group blocks by approximate Y position (rows)
  const rows = groupBlocksByRow(blocks, 10);

  // Find gaps between blocks in each row
  const gapCandidates = new Map<number, number>();

  for (const row of rows) {
    const sorted = row.sort((a, b) => a.bbox.x0 - b.bbox.x0);

    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1].bbox.x0 - sorted[i].bbox.x1;

      // Large gap might be column boundary
      if (gap > 30) {
        const gapCenter = (sorted[i].bbox.x1 + sorted[i + 1].bbox.x0) / 2;
        const rounded = Math.round(gapCenter / 10) * 10; // Round to nearest 10

        gapCandidates.set(rounded, (gapCandidates.get(rounded) || 0) + 1);
      }
    }
  }

  // Find gaps that appear in multiple rows (consistent column boundaries)
  const minOccurrences = Math.max(2, Math.floor(rows.length * 0.3));
  const columnBoundaries = Array.from(gapCandidates.entries())
    .filter(([_, count]) => count >= minOccurrences)
    .map(([gap, _]) => gap)
    .sort((a, b) => a - b);

  return columnBoundaries;
}

/**
 * Group blocks by row (similar Y position)
 */
export function groupBlocksByRow(blocks: Block[], tolerance = 10): Block[][] {
  if (blocks.length === 0) return [];

  const rows: Block[][] = [];
  const sorted = [...blocks].sort((a, b) => a.bbox.y0 - b.bbox.y0);

  let currentRow: Block[] = [sorted[0]];
  let currentY = sorted[0].bbox.y0;

  for (let i = 1; i < sorted.length; i++) {
    const block = sorted[i];

    if (Math.abs(block.bbox.y0 - currentY) <= tolerance) {
      // Same row
      currentRow.push(block);
    } else {
      // New row
      rows.push(currentRow);
      currentRow = [block];
      currentY = block.bbox.y0;
    }
  }

  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Get column index for a block
 */
export function getColumnIndex(block: Block, columnBoundaries: number[]): number {
  const blockCenter = (block.bbox.x0 + block.bbox.x1) / 2;

  for (let i = 0; i < columnBoundaries.length; i++) {
    if (blockCenter < columnBoundaries[i]) {
      return i;
    }
  }

  return columnBoundaries.length;
}

/**
 * Sort blocks in reading order (column-aware)
 */
export function sortBlocksInReadingOrder(blocks: Block[]): Block[] {
  const columnBoundaries = detectColumns(blocks);

  return [...blocks].sort((a, b) => {
    const colA = getColumnIndex(a, columnBoundaries);
    const colB = getColumnIndex(b, columnBoundaries);

    if (colA !== colB) {
      return colA - colB; // Different columns
    }

    // Same column: sort by vertical position
    const yDiff = a.bbox.y0 - b.bbox.y0;
    if (Math.abs(yDiff) > 5) {
      return yDiff;
    }

    // Same line: sort by horizontal position
    return a.bbox.x0 - b.bbox.x0;
  });
}

/**
 * Remove overlapping blocks (keep highest confidence)
 */
export function resolveOverlappingBlocks(blocks: Block[]): Block[] {
  if (blocks.length === 0) return [];

  // Sort by confidence (highest first)
  const sorted = [...blocks].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

  const result: Block[] = [];

  for (const block of sorted) {
    // Check if significantly overlaps with already selected block
    const hasSignificantOverlap = result.some((existing) => {
      const overlapX = Math.min(block.bbox.x1, existing.bbox.x1) - Math.max(block.bbox.x0, existing.bbox.x0);
      const overlapY = Math.min(block.bbox.y1, existing.bbox.y1) - Math.max(block.bbox.y0, existing.bbox.y0);

      if (overlapX <= 0 || overlapY <= 0) return false;

      const overlapArea = overlapX * overlapY;
      const blockArea = (block.bbox.x1 - block.bbox.x0) * (block.bbox.y1 - block.bbox.y0);

      return overlapArea / blockArea > 0.8; // 80% overlap threshold
    });

    if (!hasSignificantOverlap) {
      result.push(block);
    }
  }

  return result;
}

/**
 * Extract text from block based on selection (with mode support)
 */
export function extractTextFromBlock(
  block: Block,
  selRect: SelectionRect,
  mode: SelectionMode = 'word'
): string {
  const ratio = getIntersectionRatio(selRect, block.bbox);

  // Decide if block should be included
  if (mode === 'block') {
    // Block mode: include if any overlap
    return ratio > 0 ? block.text : '';
  }

  if (mode === 'line') {
    // Line mode: include if >50% overlap
    return ratio > 0.5 ? block.text : '';
  }

  // For other modes, use threshold
  if (ratio < 0.15) {
    return ''; // Too little overlap
  }

  if (ratio >= 0.85) {
    return block.text; // Almost entire block
  }

  // Partial selection - extract substring
  const blockWidth = block.bbox.x1 - block.bbox.x0;
  const intersectLeft = Math.max(selRect.left, block.bbox.x0);
  const intersectRight = Math.min(selRect.right, block.bbox.x1);

  const startRatio = Math.max(0, (intersectLeft - block.bbox.x0) / blockWidth);
  const endRatio = Math.min(1, (intersectRight - block.bbox.x0) / blockWidth);

  const textLength = block.text.length;
  let startChar = Math.floor(startRatio * textLength);
  let endChar = Math.ceil(endRatio * textLength);

  // Apply word snapping for word mode
  if (mode === 'word' || mode === 'precise') {
    const snapped = snapToWordBoundaries(block.text, startChar, endChar);
    startChar = snapped.startChar;
    endChar = snapped.endChar;
  }

  return block.text.substring(startChar, endChar).trim();
}

/**
 * Normalize whitespace in combined text
 */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\s+/g, ' ') // Multiple spaces → single space
    .trim();
}

/**
 * Preserve line breaks between blocks from different rows
 */
export function combineTextWithLineBreaks(blocks: Block[]): string {
  const rows = groupBlocksByRow(blocks, 10);

  return rows
    .map((rowBlocks) => {
      const sorted = rowBlocks.sort((a, b) => a.bbox.x0 - b.bbox.x0);
      return sorted
        .map((b) => b.text)
        .join(' ')
        .trim();
    })
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * Calculate selection statistics
 */
export function getSelectionStats(blocks: Block[], text: string) {
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
  const charCount = text.length;
  const avgConfidence = blocks.reduce((sum, b) => sum + (b.confidence || 0), 0) / (blocks.length || 1);

  return {
    blockCount: blocks.length,
    wordCount,
    charCount,
    avgConfidence,
  };
}

/**
 * Filter out empty or whitespace-only blocks
 */
export function filterValidBlocks(blocks: Block[]): Block[] {
  return blocks.filter((block) => {
    const text = block.text.trim();
    return text.length > 0;
  });
}
