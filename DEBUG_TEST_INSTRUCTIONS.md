# Debug Test Instructions - Spacing Issue

**Date**: 2025-10-21
**Status**: Debug logging added - ready to test

---

## 🎯 Purpose

We've added comprehensive debug logging to trace exactly where spaces are being lost.

---

## 📋 Testing Steps

### Step 1: Refresh Frontend

```bash
# Just refresh your browser (Ctrl+R or Cmd+R)
# Or if needed:
cd frontend
npm run dev
```

### Step 2: Open Browser Console

1. Open Developer Tools (F12 or Cmd+Option+I)
2. Go to **Console** tab
3. Clear console (trash icon or Ctrl+L)

### Step 3: Select Text Using CANVAS (Mouse Drag)

**Important**: Use mouse drag selection on the PDF, NOT the invisible text layer

1. Click and drag across multiple words
2. Release mouse
3. **Immediately check console**

---

## 🔍 What To Look For in Console

### Expected Output (3 log groups):

#### Group 1: Smart Selection (from smartSelectionEngine.ts)
```
[JOIN] Same line: "The" + " " + "Note"
[JOIN] Same line: "Note" + " " + "is"
[JOIN] Same line: "is" + " " + "secured"
[JOIN] Final result: "The Note is secured..."
```

#### Group 2: Canvas Selection (from PDFViewer.tsx)
```
[CANVAS SELECTION] Combined text: The Note is secured by a Security Agreement...
[CANVAS SELECTION] Has spaces? true
[CANVAS SELECTION] First 100 chars: The Note is secured by a Security Agreement between Assignor, microHelix and Moore...
```

#### Group 3: Text Layer (if using text layer selection)
```
Text Selection Debug: {
  selectedText: "The Note is secured..."
  textLength: 150
  bbox: {...}
}
```

---

## 📊 Diagnosis Based on Console Output

### Scenario A: Lots of `[JOIN]` logs + spaces in combined text ✅

**Console shows:**
```
[JOIN] Same line: "The" + " " + "Note"
...
[CANVAS SELECTION] Has spaces? true
```

**Diagnosis**: Frontend is working correctly!

**But annotation still has no spaces?**
→ Problem is in backend or API call

**Next step**: Check network tab for the API request body

---

### Scenario B: `[JOIN]` logs show "New line" instead of "Same line" ❌

**Console shows:**
```
[JOIN] New line: "The" + "\n" + "Note"
[JOIN] New line: "Note" + "\n" + "is"
```

**Diagnosis**: `areOnSameLine()` is failing - words not detected as same line

**Solution**: Increase tolerance in `smartSelectionEngine.ts`

---

### Scenario C: NO `[JOIN]` logs at all ❌

**Console shows:**
```
Text Selection Debug: {...}
(No [JOIN] logs)
```

**Diagnosis**: You're using TextLayer selection, NOT canvas selection!

**This is the most likely issue!**

**Why**: TextLayer uses browser's native selection, which bypasses `smartTextSelection`

**Solution**: We need to fix TextLayer selection OR ensure canvas selection is used

---

### Scenario D: `[JOIN]` logs look good, but `[CANVAS SELECTION]` shows no spaces ❌

**Console shows:**
```
[JOIN] Same line: "The" + " " + "Note"
[JOIN] Final result: "The Note is secured..."
BUT
[CANVAS SELECTION] Has spaces? false
[CANVAS SELECTION] Combined text: TheNoteissecured...
```

**Diagnosis**: Something is stripping spaces AFTER `joinBlocksWithSpacing()`

**Solution**: Check `smartTextSelection` return value

---

## 🎯 Most Likely Problem

Based on your annotation showing no spaces, I suspect:

**You're using TextLayer selection (invisible text overlay)**, which:
1. Uses browser's native `window.getSelection()`
2. Gets text directly from DOM
3. Bypasses `smartTextSelection` entirely
4. Each block is a separate `<div>` with NO space between them!

---

## 🔧 How TextLayer Works (The Problem)

### TextLayerOverlay.tsx renders:

```html
<div>The</div>
<div>Note</div>
<div>is</div>
<div>secured</div>
```

### When you select across these divs:

```javascript
window.getSelection().toString()
// Returns: "TheNoteissecured"  ❌ NO SPACES!
```

### Why?

**Divs don't have spaces between them in HTML!**

---

## ✅ The Fix (If TextLayer is the issue)

### Option 1: Add spaces in TextLayer rendering

**File**: `frontend/src/components/TextLayerOverlay.tsx` (Line 273-312)

**Add whitespace between blocks:**

```typescript
{styledBlocks.map(({ index, block, x, y, width, height, metrics }) => (
  <>
    <div
      key={index}
      className="text-block-overlay"
      // ... existing props
    >
      {block.text}
    </div>
    {/* Add space after each block */}
    <span key={`space-${index}`} style={{position: 'absolute', left: `${x + width}px`, top: `${y}px`}}>
      {' '}
    </span>
  </>
))}
```

**OR better**: Join blocks on same line

---

### Option 2: Disable TextLayer, use only canvas selection

Simplest fix - just use canvas selection which works correctly!

---

## 📋 What To Do Now

1. ✅ **Refresh browser**
2. ✅ **Open console**
3. ✅ **Select text (drag with mouse)**
4. ✅ **Copy console output and send to me**

I'll then tell you the exact fix based on what the console shows!

---

## 🚨 Quick Test

**Copy this text and send it to me:**

After selecting text, paste the console output here:
```
[Paste console output here]
```

Then I'll know exactly what's wrong and provide the precise fix!

