# Quick Start Guide

Get the PDF Annotation App running in minutes!

## Prerequisites Check

```bash
# Check Python version (need 3.9+)
python --version

# Check Node.js version (need 18+)
node --version
```

## 5-Minute Setup

### Step 1: Backend Setup (2 minutes)

```bash
# Navigate to backend
cd pdf-annotation-app/backend

# Create virtual environment
python -m venv venv

# Activate it
# macOS/Linux:
source venv/bin/activate
# Windows:
# venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start the server
./start.sh
# OR manually:
# python3.9 -m uvicorn main:app --reload
```

Backend will run on: **http://localhost:8000**

### Step 2: Frontend Setup (2 minutes)

Open a **new terminal** window:

```bash
# Navigate to frontend
cd pdf-annotation-app/frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

Frontend will run on: **http://localhost:5173**

### Step 3: Use the App (1 minute)

1. Open **http://localhost:5173** in your browser
2. Click "Upload PDF" button
3. Select any PDF file
4. Wait for processing (first time takes longer for OCR model download)
5. Start annotating!

## First Use Tips

### Uploading PDFs
- Try both regular PDFs and scanned documents
- First upload will download EasyOCR language models (~500MB)
- Scanned PDFs take longer to process

### Creating Annotations
1. Click and drag to select text
2. Click "Create Annotation" button
3. Choose highlight color in right panel
4. Add notes by clicking the edit icon

### Searching
1. Type search term in toolbar
2. Press Enter
3. Results highlight in yellow/orange
4. Navigate with page buttons

## Troubleshooting

### Backend won't start
```bash
# Make sure you're in the venv
which python  # Should show path inside venv folder

# Try reinstalling dependencies
pip install --upgrade -r requirements.txt
```

### Frontend won't start
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### PDF won't upload
- Check backend is running on port 8000
- Check browser console for errors
- Ensure PDF file is valid and not corrupted

### Annotations not appearing
- Refresh the page
- Check backend logs for errors
- Ensure data directory exists and is writable

## What to Try

### Test Files
- Upload a regular PDF with text
- Upload a scanned document or image-based PDF
- Try PDFs with different layouts (columns, tables, etc.)

### Features to Explore
- Multiple highlight colors
- Add detailed notes to annotations
- Search across entire document
- Navigate between pages while maintaining annotations
- Edit and delete annotations

## Performance Notes

### First Time Setup
- EasyOCR downloads language models on first run
- This is a one-time ~500MB download
- Subsequent runs will be much faster

### Processing Times
- **Native PDFs**: Very fast (< 1 second per page)
- **Scanned PDFs**: Slower (5-15 seconds per page)
- Depends on image quality and text density

## Next Steps

Once everything is working:

1. Read the full [README.md](README.md) for detailed features
2. Explore the codebase structure
3. Customize colors, UI, or add features
4. Consider deploying to production

## Getting Help

If you encounter issues:

1. Check the console for error messages
2. Review the [README.md](README.md) troubleshooting section
3. Ensure all dependencies are correctly installed
4. Verify Python and Node.js versions

## Development Workflow

### Backend Development
```bash
# Backend runs with auto-reload
python main.py
# Edit files in backend/ and server reloads automatically
```

### Frontend Development
```bash
# Vite dev server with HMR
npm run dev
# Edit files in frontend/src/ and see instant updates
```

Happy annotating!
