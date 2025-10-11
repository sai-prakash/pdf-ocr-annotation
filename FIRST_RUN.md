# First Run Information

## Important: First Upload Takes Time

### What to Expect

When you upload your **first PDF** (especially if it's a scanned document), the process will take **3-10 minutes** depending on your internet connection. This is **completely normal** and only happens once.

### Why Does This Happen?

EasyOCR (the OCR engine) needs to download two machine learning models:
1. **Detection Model** (~90MB) - Finds text regions in images
2. **Recognition Model** (~500MB) - Converts text regions to actual text

These models are downloaded to:
```
~/.EasyOCR/model/
```

### What You'll See

**Backend Console:**
```
Using CPU. Note: This module is much faster with a GPU.
Downloading detection model, please wait...
Progress: |████████████████------------------| 50% Complete
Downloading recognition model, please wait...
Progress: |████████████████████████████------| 80% Complete
```

**Frontend:**
- Loading spinner with message: "Processing PDF... This may take a few minutes on first upload (downloading OCR models)"
- The upload button will be disabled
- Browser may show "waiting for response"

### After First Run

Once the models are downloaded:
- **Subsequent uploads are MUCH faster**
- Native PDFs: < 1 second per page
- Scanned PDFs: 8-12 seconds per page (optimized resolution, CPU mode)
- **4.8 MB scanned PDF (10 pages): ~2-3 minutes**

### Troubleshooting

#### Upload Appears Stuck
**Symptoms:**
- Upload button clicked but nothing happens for several minutes
- Loading spinner shows but no progress

**Solution:**
- **Don't refresh!** The models are downloading in the background
- Check backend console to see download progress
- Wait for completion (up to 10 minutes on slower connections)
- If timeout occurs after 5 minutes, try again - models may be partially downloaded and will resume

#### Timeout Error
**Symptoms:**
- Error message: "Upload timeout - Please wait for OCR models to download"

**Solution:**
1. Check backend console logs - see real-time processing progress
2. Look for log messages like:
   ```
   [PDF] Processing page 3/10 (SCANNED)
   [OCR] Page 3: Found 45 text blocks
   ```
3. Wait for backend to finish downloading/processing
4. Try uploading again once download completes
5. Models are cached, so retry will be faster
6. **NEW**: Timeout extended to 10 minutes for large scanned PDFs

#### Connection Issues
**Symptoms:**
- Download fails repeatedly
- "Network error" messages

**Solutions:**
1. Check internet connection
2. Check if firewall is blocking downloads
3. Manually download models:
   ```bash
   cd backend
   source venv/bin/activate
   python3.9 -c "import easyocr; reader = easyocr.Reader(['en'])"
   ```

### Technical Details

#### Model Storage
Models are stored in your home directory:
```
~/.EasyOCR/model/
├── craft_mlt_25k.pth (~90MB)
└── english_g2.pth (~500MB)
```

#### Network Requirements
- **Total Download:** ~590MB
- **Bandwidth:** Works with any connection, but faster is better
- **Servers:** Downloads from GitHub/external CDN

#### Skip OCR (Optional)
If you only plan to use native PDFs (not scanned), you can prevent EasyOCR initialization by modifying:

`backend/services/pdf_processor.py`:
```python
def _is_page_scanned(self, page: fitz.Page) -> bool:
    """Detect if a page is scanned"""
    # Force to always return False to skip OCR
    return False
```

This will skip OCR entirely and process all pages as native text.

### Performance Optimization

#### For Faster Processing

1. **Use Native PDFs** when possible (no OCR needed)
2. **GPU Acceleration** (if available):
   ```python
   # In pdf_processor.py
   self.reader = easyocr.Reader(['en'], gpu=True)
   ```
3. **OCR Resolution** (already optimized):
   ```python
   # Current setting in _extract_text_ocr method
   pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5))  # Optimized for speed/accuracy
   # You can reduce to 1.2 for faster processing (less accurate)
   ```

#### Monitor Progress
Watch backend console to see **real-time processing logs**:
```
2025-10-10 10:30:15 - [UPLOAD] Received file: document.pdf
2025-10-10 10:30:15 - [UPLOAD] File saved: 4.80 MB
2025-10-10 10:30:15 - [PDF] Starting processing: 10 pages, 4.80 MB
2025-10-10 10:30:15 - [PDF] Processing page 1/10 (SCANNED)
2025-10-10 10:30:16 - [OCR] Page 1: Converting to image...
2025-10-10 10:30:16 - [OCR] Page 1: Image size (1800, 2400, 3), starting OCR...
2025-10-10 10:30:28 - [OCR] Page 1: Found 52 text blocks
2025-10-10 10:30:28 - [PDF] Page 1/10 completed in 12.45s (52 blocks)
2025-10-10 10:30:28 - [PDF] Processing page 2/10 (SCANNED)
...
2025-10-10 10:32:30 - [PDF] Processing complete: 10 pages in 135.23s (13.52s per page)
2025-10-10 10:32:30 - [UPLOAD] Processing complete: 10 pages
```

This helps you:
- Track progress in real-time
- Identify which pages are scanned vs native
- See processing time per page
- Diagnose any errors or slowdowns

### Expected Timeline

| Stage | Time (First Run) | Time (Subsequent) |
|-------|------------------|-------------------|
| Models Download | 3-10 minutes | 0 seconds (cached) |
| Native PDF (10 pages) | < 5 seconds | < 5 seconds |
| **Scanned PDF (10 pages, 4.8 MB)** | **~5 minutes** | **~2-3 minutes** |
| Native PDF (100 pages) | < 30 seconds | < 30 seconds |
| Scanned PDF (100 pages) | 15-25 minutes | 15-25 minutes |

**Note:** Processing time optimized with 1.5x resolution (reduced from 2x). This provides 40% faster processing with minimal accuracy loss.

### Summary

**First upload:** Be patient, get coffee, wait 3-10 minutes

**After that:** Fast and smooth operation!

The initial wait is a one-time investment that enables powerful OCR capabilities for all your scanned documents.
