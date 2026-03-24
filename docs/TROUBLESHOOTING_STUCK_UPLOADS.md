# Troubleshooting Stuck Uploads

## Problem: Upload Appears Stuck or Not Responding

### Symptoms
- Upload button clicked but UI shows loading spinner indefinitely
- No error message appears
- Frontend seems frozen
- Browser tab shows "waiting for response"

### Root Causes & Solutions

---

## 1. Large Scanned PDF Processing (Most Common)

### Explanation
Scanned PDFs require OCR (Optical Character Recognition) which is **extremely CPU-intensive**. A 4.8 MB scanned PDF with 10 pages takes **2-3 minutes** to process on CPU mode.

### How to Verify
Open your backend console and look for these logs:

```
[UPLOAD] Received file: document.pdf
[UPLOAD] File saved: 4.80 MB
[PDF] Starting processing: 10 pages, 4.80 MB
[PDF] Processing page 1/10 (SCANNED)  ← If you see SCANNED, OCR is running
[OCR] Page 1: Converting to image...
[OCR] Page 1: Image size (1800, 2400, 3), starting OCR...
```

### Solution
**✅ This is NORMAL behavior - just wait!**

- **Do NOT refresh the browser**
- **Do NOT click upload again**
- Watch backend console for progress
- Expected times:
  - 10-page scanned PDF: 2-3 minutes
  - 20-page scanned PDF: 4-6 minutes
  - 50-page scanned PDF: 10-15 minutes

### Current Optimizations
- Timeout: 10 minutes (enough for most PDFs)
- Resolution: 1.5x (balanced speed/accuracy)
- Real-time logging for progress tracking

---

## 2. First-Time OCR Model Download

### Explanation
On the **very first scanned PDF upload**, EasyOCR downloads ~590MB of machine learning models. This happens **once** and models are cached forever.

### How to Verify
Backend console shows:
```
Using CPU. Note: This module is much faster with a GPU.
Downloading detection model, please wait...
Downloading recognition model, please wait...
```

### Solution
**✅ Wait 3-10 minutes for model download**

- Models are saved to `~/.EasyOCR/model/`
- This only happens once
- Subsequent uploads use cached models
- If timeout occurs, retry - models may already be downloaded

### Check if Models Downloaded
```bash
ls -lh ~/.EasyOCR/model/
# Should show:
# craft_mlt_25k.pth (~90MB)
# english_g2.pth (~500MB)
```

---

## 3. Timeout Errors

### Symptoms
After 10 minutes, you see error:
```
Error processing PDF: timeout of 600000ms exceeded
```

### Causes
- PDF has 50+ pages (all scanned)
- OCR model download is extremely slow
- Server is under heavy load

### Solutions

#### Option A: Increase Timeout (for very large PDFs)
Edit `frontend/src/services/api.ts`:
```typescript
timeout: 900000, // 15 minutes (instead of 10)
```

#### Option B: Pre-download Models
```bash
cd backend
source venv/bin/activate
python3.9 -c "import easyocr; easyocr.Reader(['en'], gpu=False)"
# Wait for download to complete
```

#### Option C: Process in Smaller Batches
- Split large PDF into smaller files (10-20 pages each)
- Upload separately
- Faster processing and better error recovery

---

## 4. Browser/Network Issues

### Symptoms
- Upload fails immediately
- Network error in browser console
- Backend doesn't receive file

### How to Verify
- Check browser console (F12 → Console tab)
- Look for network errors
- Check backend logs - if no `[UPLOAD] Received file`, request didn't arrive

### Solutions

1. **Check Backend is Running**
   ```bash
   # Backend should be running on http://localhost:8000
   curl http://localhost:8000
   # Should return: {"message":"PDF Annotation API","version":"1.0.0"}
   ```

2. **Check Frontend Proxy**
   - Frontend runs on `http://localhost:5173`
   - API requests proxy to `http://localhost:8000`
   - Verify in `frontend/vite.config.ts`

3. **Restart Both Services**
   ```bash
   # Terminal 1: Backend
   cd backend
   ./start.sh

   # Terminal 2: Frontend
   cd frontend
   npm run dev
   ```

4. **Check CORS Settings**
   Backend `main.py` should have:
   ```python
   allow_origins=["http://localhost:5173", "http://localhost:3000"]
   ```

---

## 5. Memory Issues (Server Crashes)

### Symptoms
- Backend console shows "Killed" or crashes
- Process terminates during OCR
- No response from server

### Causes
- Insufficient RAM (OCR requires 2-4 GB per page)
- Processing very high-resolution scans

### Solutions

1. **Check Available Memory**
   ```bash
   free -h  # Linux
   vm_stat  # macOS
   ```

2. **Reduce OCR Resolution**
   Edit `backend/services/pdf_processor.py`:
   ```python
   # Line 86: Reduce from 1.5x to 1.2x
   pix = page.get_pixmap(matrix=fitz.Matrix(1.2, 1.2))
   ```

3. **Increase System Swap**
   ```bash
   # Linux: Add swap space
   sudo fallocate -l 4G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   ```

4. **Use GPU if Available**
   Edit `backend/services/pdf_processor.py`:
   ```python
   # Line 23: Enable GPU
   self.reader = easyocr.Reader(['en'], gpu=True)
   ```

---

## 6. Python/Dependencies Issues

### Symptoms
- Backend crashes with import errors
- OCR doesn't work
- "Module not found" errors

### Solution: Reinstall Dependencies
```bash
cd backend
source venv/bin/activate
pip uninstall -y fitz PyMuPDF easyocr
pip install -r requirements.txt
```

### Verify Installation
```bash
python3.9 -c "import fitz; print(fitz.__doc__)"
python3.9 -c "import easyocr; print('EasyOCR OK')"
```

---

## Debugging Checklist

When upload is stuck, check in this order:

- [ ] **Backend console is open** - Are you seeing logs?
- [ ] **Look for `[PDF] Processing page X/Y`** - Is processing happening?
- [ ] **Check page type** - Does it say `(SCANNED)` or `(NATIVE)`?
- [ ] **Wait 2-3 minutes** - Give OCR time to work
- [ ] **Check for errors** - Any Python exceptions in console?
- [ ] **Verify models downloaded** - Check `~/.EasyOCR/model/`
- [ ] **Check browser console** - Any JavaScript errors?
- [ ] **Test with small PDF** - Does a 1-page PDF work?
- [ ] **Check disk space** - Is `/tmp` or `uploads/` folder full?

---

## Performance Expectations

### Normal Processing Times (CPU Mode, After Model Download)

| PDF Type | Pages | Size | Expected Time |
|----------|-------|------|---------------|
| Native (text) | 10 | 2 MB | 3-5 seconds |
| Native (text) | 100 | 20 MB | 30-45 seconds |
| **Scanned (images)** | **10** | **4.8 MB** | **2-3 minutes** |
| Scanned (images) | 20 | 9 MB | 4-6 minutes |
| Scanned (images) | 50 | 20 MB | 10-15 minutes |
| Mixed (50/50) | 20 | 10 MB | 3-4 minutes |

### With GPU Acceleration (if available)
- **50-70% faster** than CPU mode
- 10-page scanned PDF: ~1 minute
- 50-page scanned PDF: ~5 minutes

---

## Quick Fixes Summary

### Upload seems stuck for < 3 minutes
→ **WAIT** - This is normal for scanned PDFs

### Upload stuck for > 3 minutes (10 pages)
→ **Check backend logs** for progress

### Upload stuck for > 10 minutes
→ **Timeout error likely** - Check solutions in section 3

### Backend crashes during upload
→ **Memory issue** - See section 5

### Upload fails immediately
→ **Network/connection issue** - See section 4

---

## Still Having Issues?

1. **Collect Logs**
   ```bash
   # Backend logs
   cat backend/pdf_processing.log

   # Last 50 lines of console
   tail -50 backend/pdf_processing.log
   ```

2. **Test with Sample PDF**
   - Try a simple 1-page PDF
   - Try a native (text-based) PDF
   - Compare results

3. **Check System Resources**
   ```bash
   # CPU usage
   top

   # Memory usage
   free -h

   # Disk space
   df -h
   ```

4. **Create Minimal Reproduction**
   - Note: PDF size, page count, scanned or native
   - Note: Exact error message
   - Note: Time taken before failure
   - Share backend logs

---

## Preventive Measures

### For Developers

1. **Always monitor backend console** when uploading
2. **Test with small PDFs first** before large ones
3. **Pre-download OCR models** in development:
   ```bash
   python3.9 -c "import easyocr; easyocr.Reader(['en'])"
   ```
4. **Use GPU in production** if available

### For Users

1. **Be patient with scanned PDFs** - they take time
2. **Don't click upload multiple times** - creates duplicate jobs
3. **Use native PDFs when possible** - 100x faster
4. **Consider OCR pre-processing** - use external tools to OCR first

---

## Future Improvements

These features could address stuck upload issues:

1. **Async Processing with Queue**
   - Upload returns immediately
   - Processing happens in background
   - Frontend polls for status

2. **Progress Bar with SSE**
   - Server-Sent Events for real-time progress
   - Show "Processing page 3/10..."
   - Estimated time remaining

3. **Chunked Processing**
   - Process 5 pages at a time
   - Return partial results
   - Continue processing

4. **Client-Side OCR**
   - Use Tesseract.js in browser
   - Offload processing to client
   - Better for privacy too

See `ENHANCEMENT_ROADMAP.md` for implementation details.
