# Quick OCR Engine Switch Guide

**Current Status**: Using Tesseract (with light preprocessing)

---

## 🔄 How to Switch OCR Engines

### Option 1: Back to EasyOCR (Simple Rollback)

If EasyOCR was giving better results, restore it:

```bash
cd /Users/veesu/test-claude-code/pdf-annotation-app/backend/services

# Backup current Tesseract version
cp pdf_processor.py pdf_processor_tesseract.py

# Restore EasyOCR version
cp pdf_processor.py.backup pdf_processor.py

# Restart backend
cd ..
python main.py
```

Done! Back to EasyOCR.

---

### Option 2: Test Current Fix First

**Try the improved Tesseract settings:**

```bash
# Just restart backend
cd /Users/veesu/test-claude-code/pdf-annotation-app/backend
python main.py
```

Upload the same PDF and compare results.

**Look for in logs:**
```
[OCR] Page 1: Light preprocessing...
[OCR] Page 1: Running Tesseract OCR...
[OCR] Page 1: Completed in X.XXs, XXX blocks, avg confidence: XX.X%
```

**Good signs:**
- Confidence > 85%
- Readable text in JSON output
- Similar or more blocks than EasyOCR

**Bad signs:**
- Confidence < 70%
- Garbled text
- Fewer blocks than EasyOCR

---

### Option 3: Try Different Tesseract PSM Modes

Edit `pdf_processor.py` line 135:

**Current (PSM 6 - Uniform block):**
```python
config='--oem 1 --psm 6'
```

**Try PSM 3 (Automatic):**
```python
config='--oem 1 --psm 3'
```

**Try PSM 4 (Single column):**
```python
config='--oem 1 --psm 4'
```

**Try PSM 11 (Sparse text):**
```python
config='--oem 1 --psm 11'
```

**Try PSM 1 (Auto with OSD):**
```python
config='--oem 1 --psm 1'
```

---

### Option 4: Remove All Preprocessing

Edit `pdf_processor.py` lines 117-126:

**Replace with:**
```python
# NO preprocessing - use raw grayscale image
if len(img_array.shape) == 3:
    preprocessed = cv2.cvtColor(img_array, cv2.COLOR_BGR2GRAY)
else:
    preprocessed = img_array
```

This gives Tesseract the cleanest possible image.

---

## 🎯 My Recommendation

### Test in This Order:

**1. Current Fix (Light Preprocessing + PSM 6)**
- Already applied
- Should work better than aggressive preprocessing
- **Test now**

**2. If still bad → Try PSM 3**
```python
config='--oem 1 --psm 3'  # More automatic
```

**3. If still bad → No preprocessing**
```python
# Just grayscale, nothing else
preprocessed = cv2.cvtColor(img_array, cv2.COLOR_BGR2GRAY)
```

**4. If still bad → Back to EasyOCR**
```bash
cp pdf_processor.py.backup pdf_processor.py
```

**5. Best long-term → Hybrid (see below)**

---

## 🚀 Hybrid Approach (Best Solution)

Would you like me to implement a system that:
1. **Tries Tesseract first** (3-6 sec, fast)
2. **Checks confidence**
3. **Falls back to EasyOCR** if confidence < 75% (12-15 sec, accurate)

This gives you:
- ✅ Speed of Tesseract for 80-90% of pages
- ✅ Accuracy of EasyOCR for difficult 10-20%
- ✅ Automatic selection (no manual tuning)

Let me know if you want this!

---

## 📊 Quick Comparison

| Engine | Speed | Accuracy | Best For |
|--------|-------|----------|----------|
| **Tesseract** | 3-6 sec | 95-99% | Clean printed docs |
| **EasyOCR** | 12-15 sec | 85-95% | Scene text, varied fonts |
| **Hybrid** | 3-15 sec | Best of both | Everything! |

---

## ⚡ Quick Commands Reference

**Test current version:**
```bash
cd backend && python main.py
```

**Rollback to EasyOCR:**
```bash
cd backend/services
cp pdf_processor.py.backup pdf_processor.py
cd .. && python main.py
```

**Check which version is running:**
```bash
grep -n "pytesseract\|easyocr" backend/services/pdf_processor.py | head -5
```

Output:
- If shows `pytesseract` → Using Tesseract
- If shows `easyocr` → Using EasyOCR

---

## 💡 Debugging Tips

**Check OCR output quality:**
```bash
# Look at the JSON file
cat backend/data/YOUR_PDF_ID.json | jq '.pages[0].blocks[] | .text' | head -20
```

**Compare confidence scores:**
- **Tesseract**: Look for `avg confidence: XX.X%` in logs
- **EasyOCR**: Look for `avg confidence: 0.XX` in logs

**Check processing time:**
- **Tesseract**: Should be 3-6 seconds per page
- **EasyOCR**: Should be 12-15 seconds per page

---

## ✅ Current Status

**Applied Changes:**
- ✅ Light preprocessing (grayscale + light CLAHE)
- ✅ Tesseract PSM 6 (uniform block)
- ✅ Low confidence threshold (accept most text)
- ✅ 300 DPI resolution

**Next Step:**
**→ Test with your PDF and see if output is better!**

If not, we have 4 more options to try above.

