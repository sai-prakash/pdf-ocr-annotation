# Bug Fix: ReferenceError in PDFViewer Component

## Issue
```
ReferenceError: Cannot access uninitialized variable.
PDFViewer component at line 64
```

## Root Cause
The `currentPageData` variable was being referenced in a `useMemo` hook before it was declared, creating a JavaScript temporal dead zone (TDZ) error.

**Problematic Code Order:**
```typescript
// Line 62-66: useMemo trying to access currentPageData
const spatialIndex = useMemo(() => {
  if (!currentPageData || !currentPageData.blocks) return null;
  return new SpatialIndex(currentPageData.blocks);
}, [currentPageData]);

// Line 88: currentPageData declared AFTER useMemo
const currentPageData = pages.find((p) => p.page_number === currentPage);
```

## Fix
Moved the `currentPageData` declaration **before** the `useMemo` hook that depends on it.

**Fixed Code:**
```typescript
// Line 63: Declare currentPageData FIRST
const currentPageData = pages.find((p) => p.page_number === currentPage);

// Line 66-69: Now useMemo can safely access it
const spatialIndex = useMemo(() => {
  if (!currentPageData || !currentPageData.blocks) return null;
  return new SpatialIndex(currentPageData.blocks);
}, [currentPageData]);
```

## Additional Cleanup
Also fixed TypeScript warnings:
- Removed unused `React` import in App.tsx
- Removed unused `numPages` state in PDFViewer.tsx
- Removed unused `totalPages` and `searchQuery` from store destructuring
- Removed unused parameters in event handlers
- Removed unused `getCellKey` method in SpatialIndex class
- Removed unused `updated` variable in AnnotationPanel.tsx

## Build Status
✅ **Build successful** - No TypeScript errors
✅ **Advanced selection system ready for testing**

## Files Modified
1. `frontend/src/components/PDFViewer.tsx` - Fixed variable order, removed unused code
2. `frontend/src/App.tsx` - Fixed unused import
3. `frontend/src/components/AnnotationPanel.tsx` - Removed unused variable
4. `frontend/src/utils/selectionUtils.ts` - Removed unused method

## Test Instructions
1. Start the frontend: `npm run dev`
2. Upload a PDF (scanned or native)
3. Test text selection with different modes:
   - **Default (Word mode)**: Normal click and drag
   - **Line mode**: Hold Shift + drag
   - **Block mode**: Hold Ctrl/Cmd + drag
   - **Precise mode**: Hold Alt + drag
4. Verify:
   - No console errors
   - Selection works smoothly
   - Preview tooltip appears during selection
   - Statistics show after selection complete
