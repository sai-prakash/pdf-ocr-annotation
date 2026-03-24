# PDF Annotation Application

A full-stack PDF annotation application built with FastAPI (Python) and React + Vite (TypeScript). This application supports both readable and scanned PDFs, with advanced text extraction, intelligent annotation, and powerful search capabilities.

## Features

### Core Capabilities
- **PDF Upload & Processing**: Upload PDF files for processing
- **Smart Text Extraction**:
  - PyMuPDF for native text-based PDFs
  - EasyOCR for scanned/image-based PDFs
  - Automatic detection of page type
- **Advanced PDF Viewer**:
  - Built with react-pdf
  - Custom canvas overlay for annotations
  - Text selection with bounding boxes
  - Coordinate transformation for accurate positioning
- **Annotation System**:
  - Text selection with mouse dragging
  - Customizable highlight colors
  - Add notes to annotations
  - Edit and delete annotations
  - Persistent storage
- **Search Functionality**:
  - Full-text search across entire PDF
  - Visual highlighting of search results
  - Navigate to search matches
- **Scanned PDF Support**:
  - OCR text extraction with confidence scores
  - Exact text overlay on scanned pages
  - Bounding box superimposition for accurate selection

## Technology Stack

### Backend
- **FastAPI**: Modern, fast web framework
- **PyMuPDF (fitz)**: PDF text extraction
- **EasyOCR**: Optical character recognition
- **Pillow**: Image processing
- **OpenCV**: Advanced image manipulation
- **Uvicorn**: ASGI server

### Frontend
- **React 18**: UI framework
- **TypeScript**: Type-safe JavaScript
- **Vite**: Build tool and dev server
- **react-pdf**: PDF rendering
- **Zustand**: State management
- **Axios**: HTTP client
- **Lucide React**: Icons

## Project Structure

```
pdf-annotation-app/
├── backend/
│   ├── main.py                 # FastAPI application
│   ├── services/
│   │   ├── pdf_processor.py    # PDF extraction & OCR
│   │   └── annotation_service.py  # Annotation management
│   ├── requirements.txt
│   ├── uploads/                # Uploaded PDFs
│   └── data/                   # Extracted data & annotations
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── PDFViewer.tsx   # PDF viewer with overlay
│   │   │   ├── AnnotationPanel.tsx  # Annotation sidebar
│   │   │   └── Toolbar.tsx     # Top toolbar
│   │   ├── store/
│   │   │   └── pdfStore.ts     # Zustand state management
│   │   ├── services/
│   │   │   └── api.ts          # API service
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
└── README.md
```

## Installation & Setup

### Prerequisites
- Python 3.9+
- Node.js 18+
- npm or yarn

### Backend Setup

1. Navigate to the backend directory:
```bash
cd pdf-annotation-app/backend
```

2. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Run the backend server:
```bash
python main.py
```

The backend will start on `http://localhost:8000`

### Frontend Setup

1. Navigate to the frontend directory:
```bash
cd pdf-annotation-app/frontend
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

The frontend will start on `http://localhost:5173`

## Usage Guide

### 1. Upload a PDF
- Click the "Upload PDF" button in the toolbar
- Select a PDF file (supports both readable and scanned PDFs)
- The application will automatically process and extract text

### 2. View PDF
- PDF renders in the center panel
- Navigate pages using the arrow buttons
- Page number displays in the toolbar

### 3. Create Annotations
- **Select text** by clicking and dragging on the PDF
- For scanned PDFs, the OCR text overlay allows precise selection
- Click "Create Annotation" in the popup
- Choose a highlight color from the annotation panel
- The annotation appears on the PDF and in the sidebar

### 4. Manage Annotations
- View all annotations in the right sidebar
- Click the edit icon to add/modify notes
- Click the delete icon to remove annotations
- Annotations persist across sessions

### 5. Search PDF
- Enter search terms in the search bar
- Press Enter or click the search button
- Results highlight in yellow/orange
- Navigate to first match automatically
- Click "Clear" to remove search highlights

## Technical Highlights

### Intelligent Page Detection
The application automatically detects whether a PDF page contains:
- **Native text**: Extracted using PyMuPDF's built-in text extraction
- **Scanned images**: Processed with EasyOCR for text recognition

### Bounding Box Precision
- All text blocks include precise bounding box coordinates
- Coordinates scale properly with PDF zoom levels
- Scanned PDFs have text overlaid at exact positions
- Enables accurate text selection and annotation

### Coordinate Transformation
- PDF coordinates → Canvas coordinates
- Handles different page sizes and orientations
- Maintains accuracy across zoom levels
- Supports rotation and scaling

### Advanced Text Selection
- Mouse-based selection with visual feedback
- Combines multiple text blocks in selection area
- Calculates combined bounding box for selections
- Works identically for native and scanned PDFs

## API Endpoints

### PDF Operations
- `POST /api/upload` - Upload and process PDF
- `GET /api/pdf/{pdf_id}` - Get PDF data
- `GET /api/pdf/{pdf_id}/page/{page_number}` - Get page data
- `POST /api/search` - Search within PDF

### Annotation Operations
- `POST /api/annotations` - Create annotation
- `GET /api/annotations/{pdf_id}` - Get annotations
- `PUT /api/annotations/{annotation_id}` - Update annotation
- `DELETE /api/annotations/{annotation_id}` - Delete annotation

## Performance Considerations

### OCR Performance
- EasyOCR is CPU-intensive (GPU support available)
- First-time initialization downloads language models
- Scanned pages take longer to process
- Consider batch processing for large documents

### Optimization Tips
- Use native PDFs when possible for faster processing
- Limit concurrent uploads
- Cache processed PDF data
- Consider implementing lazy loading for large documents

## Future Enhancements

- [ ] Multi-user support with authentication
- [ ] Export annotations to PDF
- [ ] Annotation categories/tags
- [ ] Drawing tools (rectangles, arrows, freehand)
- [ ] Collaborative annotations
- [ ] PDF comparison mode
- [ ] Mobile-responsive design
- [ ] Keyboard shortcuts
- [ ] Batch PDF processing
- [ ] Advanced search (regex, case-sensitive)

## Troubleshooting

### Backend Issues
- **EasyOCR fails to initialize**: Ensure sufficient disk space for model downloads
- **PyMuPDF import error**: Reinstall with `pip install --upgrade PyMuPDF`
- **CORS errors**: Check CORS middleware configuration in `main.py`

### Frontend Issues
- **PDF not rendering**: Check browser console for PDF.js worker errors
- **Annotations not saving**: Verify backend API is running
- **Text selection not working**: Ensure canvas overlay is properly positioned

## License

MIT License - feel free to use this project for personal or commercial purposes.

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Acknowledgments

Inspired by tools like Unstract, PDF.js Viewer, and modern PDF annotation platforms.

Built with modern web technologies and best practices for document processing.
