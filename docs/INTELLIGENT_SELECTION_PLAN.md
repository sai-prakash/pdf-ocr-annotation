# Intelligent Text Selection & Manual Text Addition - Implementation Plan

## Overview
Comprehensive upgrade to handle all text selection scenarios, bad OCR, and manual text addition.

---

## 1. Intelligent Text Selection Algorithm

### Current Issues:
- Rectangle selection often captures unwanted blocks
- Multi-column text gets mixed up
- Can't follow text flow in complex layouts

### Solution: Smart Block Grouping
```typescript
Algorithm: Intelligent Text Block Selection
1. User drags selection rectangle
2. Find all blocks with >30% overlap
3. Analyze block relationships:
   - Check vertical alignment (same column?)
   - Check reading order (left-to-right, top-to-bottom)
   - Detect column boundaries
   - Group by proximity and alignment
4. Sort blocks intelligently:
   - Detect columns by X-coordinate clustering
   - Within column: sort top-to-bottom
   - Between columns: left-to-right
5. Join text with smart spacing:
   - Same line: space
   - New line: \n
   - New paragraph: \n\n
```

### Features:
- ✅ Detect multi-column layouts automatically
- ✅ Follow reading order (not just top-to-bottom)
- ✅ Smart text joining with proper spacing
- ✅ Ignore decorative elements (lines, shapes)

---

## 2. Freeform Selection (Lasso/Polygon Tool)

### Use Cases:
- Selecting text in tables
- Curved/diagonal text
- Excluding unwanted elements
- Precise irregular shapes

### Implementation:
```typescript
Tool Modes:
1. Lasso (Free drawing)
   - User draws freeform closed path
   - Use canvas mouse events
   - Create polygon from path points
   - Select blocks inside polygon

2. Polygon (Point-to-point)
   - Click to add points
   - Double-click or Enter to close
   - Precise angular selections
```

### Algorithm: Point-in-Polygon
```typescript
function isBlockInPolygon(block: TextBlock, polygon: Point[]): boolean {
  // Check if block center or corners are inside polygon
  // Use ray casting algorithm
  const blockCenter = {
    x: (block.bbox.x0 + block.bbox.x1) / 2,
    y: (block.bbox.y0 + block.bbox.y1) / 2
  };

  return pointInPolygon(blockCenter, polygon);
}
```

### UI/UX:
- **Keyboard shortcut**: `L` for Lasso, `P` for Polygon
- **Visual feedback**: Show path as user draws
- **Close indication**: Highlight when near start point
- **Undo points**: Right-click or Backspace

---

## 3. Manual Text Addition (Bounding Box Drawing)

### Use Cases:
- OCR completely missed text
- Add notes/annotations manually
- Replace bad OCR with correct text
- Add text to images/diagrams

### Implementation:
```typescript
Mode: "Add Text"
1. User clicks "Add Text" button
2. Draw bounding box on page
3. Modal appears: "Enter text for this region"
4. User types correct text
5. Save as manual annotation with type="manual"
```

### Features:
- ✅ Draw new bounding box anywhere
- ✅ Enter text via modal dialog
- ✅ Edit text later
- ✅ Visual indicator (different color for manual text)
- ✅ Export includes manual text

### Data Structure:
```typescript
interface ManualTextBlock {
  text: string;
  bbox: BoundingBox;
  pageNumber: number;
  type: "manual";
  createdAt: string;
  editedAt?: string;
}
```

---

## 4. OCR Re-run Capability

### Use Cases:
- Initial OCR failed
- Want to try different OCR settings
- Improve quality with preprocessing

### Implementation:
```typescript
Feature: "Re-run OCR on Selection"
1. User selects region with bad OCR
2. Right-click → "Re-run OCR"
3. Backend runs OCR with enhanced settings:
   - Higher resolution (3x instead of 2x)
   - Image preprocessing (deskew, denoise)
   - Different language model if needed
4. Replace old blocks with new results
```

### Backend Enhancement:
```python
def rerun_ocr_on_region(
    page: fitz.Page,
    bbox: BoundingBox,
    settings: OCRSettings
) -> List[TextBlock]:
    # Crop to region
    clip = fitz.Rect(bbox.x0, bbox.y0, bbox.x1, bbox.y1)
    pix = page.get_pixmap(matrix=fitz.Matrix(3.0, 3.0), clip=clip)

    # Preprocess image
    img = preprocess_image(pix)

    # Run OCR with enhanced settings
    results = reader.readtext(img, ...)

    return convert_to_blocks(results)
```

---

## 5. Smart Text Merge (Multi-Column Detection)

### Problem:
Current algorithm selects left column top, then right column top, creating:
"Header Left Header Right Body Left Body Right"

Should be:
"Header Left Body Left" and "Header Right Body Right"

### Solution: Column Detection
```typescript
Algorithm: Detect Columns
1. Analyze all blocks on page
2. Cluster by X-coordinate:
   - Blocks with similar X0 are in same column
   - Use DBSCAN or K-means clustering
3. Create column boundaries
4. When selecting:
   - Determine which columns are included
   - Sort within each column separately
   - Join columns left-to-right
```

### Visual Indicator:
- Show detected column boundaries (dotted lines)
- Highlight which columns are in selection

---

## 6. Manual Text Correction

### Use Cases:
- Fix OCR mistakes ("rn" → "m")
- Correct spelling
- Fix formatting

### Implementation:
```typescript
Feature: "Edit Text Block"
1. Right-click on any text block
2. "Edit Text" option
3. Inline editor appears
4. User corrects text
5. Update block.text and mark as edited
```

### UI:
```typescript
interface EditableTextBlock {
  originalText: string;      // Keep original OCR
  correctedText?: string;    // User's correction
  isEdited: boolean;
  editedBy?: string;
  editedAt?: string;
}
```

---

## 7. Additional Features

### 7.1. Selection History
- Undo/Redo selections
- Save selection templates

### 7.2. Selection Modes (Keyboard Shortcuts)
- `R` - Rectangle (default)
- `L` - Lasso (freeform)
- `P` - Polygon (point-to-point)
- `A` - Add manual text
- `T` - Text editing mode
- `Shift` - Add to selection
- `Alt` - Subtract from selection

### 7.3. Smart Selection Suggestions
- "Did you mean to select this column?"
- "Include header in selection?"
- Auto-complete paragraphs

### 7.4. Text Block Visualization Modes
- Show confidence heatmap (red=low, green=high)
- Show block boundaries
- Show reading order numbers
- Highlight manual vs OCR blocks

### 7.5. Bulk Operations
- Select multiple regions
- Run OCR on all
- Export all selections as CSV

---

## Implementation Priority

### Phase 1: Core Improvements (Immediate)
1. ✅ Smart block grouping algorithm
2. ✅ Column detection
3. ✅ Intelligent text joining

### Phase 2: Selection Tools (Week 1)
1. 🔲 Lasso selection tool
2. 🔲 Polygon selection tool
3. 🔲 Selection mode toolbar

### Phase 3: Manual Text (Week 1)
1. 🔲 Add text mode
2. 🔲 Edit text inline
3. 🔲 Manual text storage

### Phase 4: Advanced Features (Week 2)
1. 🔲 OCR re-run
2. 🔲 Selection history
3. 🔲 Visualization modes

---

## Technical Architecture

### Frontend Components
```
SelectionToolbar.tsx         # Mode switching UI
LassoTool.tsx                # Freeform drawing
PolygonTool.tsx              # Point-to-point
ManualTextModal.tsx          # Text input dialog
TextBlockEditor.tsx          # Inline editing
ColumnDetector.ts            # Column detection logic
SmartSelectionEngine.ts      # Intelligent grouping
```

### Backend Endpoints
```python
POST /api/rerun-ocr           # Re-run OCR on region
POST /api/manual-text         # Add manual text block
PUT  /api/text-block/{id}     # Edit text block
POST /api/detect-columns      # Analyze page layout
```

### Database Schema
```sql
-- Add columns to text_blocks table
ALTER TABLE text_blocks ADD COLUMN is_manual BOOLEAN DEFAULT FALSE;
ALTER TABLE text_blocks ADD COLUMN original_text TEXT;
ALTER TABLE text_blocks ADD COLUMN corrected_text TEXT;
ALTER TABLE text_blocks ADD COLUMN edited_at TIMESTAMP;
ALTER TABLE text_blocks ADD COLUMN confidence FLOAT;
```

---

## UI/UX Design

### Selection Toolbar (Top of PDF Viewer)
```
[ Rectangle ] [ Lasso ] [ Polygon ] [ Add Text ] [ Edit Text ]
     (R)         (L)        (P)         (A)          (T)

[Column Detection: Auto ▼] [Show: Boundaries ▼]
```

### Right-Click Context Menu
```
✂️ Copy Text
📝 Create Annotation
🔄 Re-run OCR
✏️ Edit Text
🗑️ Delete Block
📊 Show Confidence
```

### Status Bar (Bottom)
```
Mode: Rectangle | Selected: 12 blocks (450 words) | Confidence: 94%
```

---

## Testing Scenarios

1. **Multi-column newspaper**
   - Select left column only
   - Select both columns
   - Verify reading order

2. **Table with cells**
   - Use polygon to select specific cells
   - Verify no text bleeding

3. **Bad OCR page**
   - Re-run OCR on failed region
   - Add manual text for missed areas
   - Edit incorrect characters

4. **Complex layout**
   - Flowchart with rotated text
   - Use lasso to select curved text
   - Manual annotations on diagrams

5. **Mixed content**
   - Native text + OCR text
   - Manual additions
   - Edited blocks
   - Verify export includes all

---

## Success Metrics

- ✅ 95%+ accurate text selection in multi-column layouts
- ✅ <3 seconds for freeform selection of 50+ blocks
- ✅ Manual text addition works on 100% of pages
- ✅ OCR re-run improves confidence by 20%+ average
- ✅ Users can correct text in <5 seconds
- ✅ Export includes 100% of content (OCR + manual)

---

## Next Steps

1. Review this plan
2. Prioritize features based on user needs
3. Create detailed wireframes for new UI
4. Implement Phase 1 (Core Improvements)
5. User testing and iteration
6. Deploy incrementally

---

*Document Version: 1.0*
*Last Updated: 2025-10-13*
