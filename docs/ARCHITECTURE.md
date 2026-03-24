# Architecture Documentation

## System Overview

The PDF Annotation Application is a full-stack web application designed to handle both native and scanned PDF documents with intelligent text extraction, annotation, and search capabilities.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (React)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │   Toolbar    │  │  PDF Viewer  │  │ Annotation Panel│   │
│  └──────────────┘  └──────────────┘  └─────────────────┘   │
│         │                  │                    │            │
│         └──────────────────┴────────────────────┘            │
│                            │                                 │
│                     ┌──────▼──────┐                         │
│                     │ Zustand Store│                         │
│                     └──────┬──────┘                         │
│                            │                                 │
│                     ┌──────▼──────┐                         │
│                     │  API Service │                         │
│                     └──────┬──────┘                         │
└────────────────────────────┼────────────────────────────────┘
                             │ HTTP/REST
┌────────────────────────────▼────────────────────────────────┐
│                     Backend (FastAPI)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │   API Routes │──│ PDF Processor│──│ Annotation Svc  │   │
│  └──────────────┘  └──────────────┘  └─────────────────┘   │
│         │                  │                    │            │
│         │           ┌──────▼──────┐      ┌─────▼─────┐     │
│         │           │   PyMuPDF   │      │   JSON DB │     │
│         │           │   EasyOCR   │      └───────────┘     │
│         │           └─────────────┘                         │
│         │                                                    │
│  ┌──────▼────────┐                                          │
│  │ File Storage  │                                          │
│  └───────────────┘                                          │
└─────────────────────────────────────────────────────────────┘
```

## Backend Architecture

### Main Components

#### 1. FastAPI Application (`main.py`)
- **Purpose**: HTTP server and API endpoint definitions
- **Key Features**:
  - CORS middleware for cross-origin requests
  - Static file serving for uploaded PDFs
  - RESTful API endpoints
  - Request/response validation with Pydantic

#### 2. PDF Processor Service (`pdf_processor.py`)
- **Purpose**: Extract text and bounding boxes from PDFs
- **Key Functions**:
  - `process_pdf()`: Main processing pipeline
  - `_is_page_scanned()`: Detect page type
  - `_extract_text_pymupdf()`: Extract native text
  - `_extract_text_ocr()`: OCR for scanned pages
  - `search_text()`: Full-text search

**Processing Pipeline**:
```
PDF Upload → Page Analysis → Text Extraction → Bounding Box Generation → JSON Storage
                ↓                    ↓
         Is Scanned?          PyMuPDF / EasyOCR
                ↓                    ↓
         Yes/No Decision      Text + Coordinates
```

**Coordinate System**:
- PDF coordinates: Origin at bottom-left
- Canvas coordinates: Origin at top-left
- Scaling factor: Maintains aspect ratio
- Transformation: Applied during rendering

#### 3. Annotation Service (`annotation_service.py`)
- **Purpose**: CRUD operations for annotations
- **Storage**: JSON files per PDF
- **Key Functions**:
  - `create_annotation()`: Add new annotation
  - `get_annotations()`: Retrieve by PDF/page
  - `update_annotation()`: Modify existing
  - `delete_annotation()`: Remove annotation

### Data Flow

#### Upload & Processing
```
1. Client uploads PDF file
2. Server saves to uploads/ directory
3. PDF Processor:
   a. Generate unique PDF ID (MD5 hash)
   b. Iterate through pages
   c. Detect if scanned or native
   d. Extract text + bounding boxes
   e. Save to data/{pdf_id}.json
4. Return processed data to client
```

#### Annotation Creation
```
1. User selects text in frontend
2. Frontend calculates bounding box
3. POST /api/annotations with:
   - pdf_id
   - page_number
   - text
   - bounding_box
   - color
   - note
4. Backend saves to data/annotations/{pdf_id}.json
5. Returns annotation with ID
6. Frontend updates local state
```

#### Search
```
1. User enters search query
2. POST /api/search with pdf_id and query
3. Backend:
   a. Load PDF data from JSON
   b. Search full_text in each page
   c. Find matching text blocks
   d. Return block + bounding box
4. Frontend highlights results on canvas
```

## Frontend Architecture

### Component Hierarchy

```
App
├── Toolbar
│   ├── Upload Button
│   ├── Search Input
│   └── Page Navigation
├── PDFViewer
│   ├── react-pdf Document/Page
│   ├── Canvas Overlay
│   │   ├── Annotation Highlights
│   │   ├── Search Result Highlights
│   │   └── Selection Overlay
│   └── Text Selection Handler
└── AnnotationPanel
    ├── Color Picker
    ├── Annotation List
    │   └── Annotation Item
    │       ├── Text Preview
    │       ├── Note Editor
    │       └── Actions (Edit/Delete)
    └── Statistics
```

### State Management (Zustand)

**Store Structure**:
```typescript
{
  pdfId: string | null,
  filename: string | null,
  fileUrl: string | null,
  totalPages: number,
  currentPage: number,
  pages: PageData[],          // Extracted text + bounding boxes
  annotations: Annotation[],   // User annotations
  searchResults: SearchResult[], // Search matches
  searchQuery: string,
  selectedAnnotation: Annotation | null,
  isLoading: boolean,
  error: string | null
}
```

**State Flow**:
```
User Action → Component Event → Store Update → Component Re-render
     ↓                                ↓
  API Call                      Update Canvas
     ↓                                ↓
  Backend                     Visual Feedback
```

### Key Algorithms

#### Text Selection Algorithm
```typescript
1. Mouse Down: Record start position (x, y)
2. Mouse Move: Show selection rectangle
3. Mouse Up:
   a. Calculate selection bounds
   b. Find all text blocks intersecting bounds
   c. Combine text from blocks
   d. Calculate combined bounding box
   e. Show annotation popup
```

#### Coordinate Transformation
```typescript
// PDF coordinates to Canvas coordinates
canvasX = pdfX * scale
canvasY = pdfY * scale

// Accounting for page dimensions
scale = canvasWidth / pdfPageWidth
```

#### Bounding Box Calculation for OCR
```typescript
// EasyOCR returns 4 corner points
points = [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]

// Convert to rectangle
x0 = min(x1, x2, x3, x4)
y0 = min(y1, y2, y3, y4)
x1 = max(x1, x2, x3, x4)
y1 = max(y1, y2, y3, y4)

// Scale from OCR image to PDF coordinates
scaledBox = {
  x0: x0 * (pdfWidth / ocrImageWidth),
  y0: y0 * (pdfHeight / ocrImageHeight),
  x1: x1 * (pdfWidth / ocrImageWidth),
  y1: y1 * (pdfHeight / ocrImageHeight)
}
```

## Data Models

### PageData
```typescript
{
  page_number: number,
  is_scanned: boolean,
  width: number,
  height: number,
  blocks: TextBlock[],
  full_text: string,
  block_count: number
}
```

### TextBlock
```typescript
{
  text: string,
  bbox: {
    x0: number,
    y0: number,
    x1: number,
    y1: number
  },
  confidence: number,  // 1.0 for native, 0-1 for OCR
  type: 'native' | 'ocr'
}
```

### Annotation
```typescript
{
  id: string,
  pdf_id: string,
  page_number: number,
  text: string,
  bounding_box: BoundingBox,
  color: string,
  note: string,
  created_at: string,
  updated_at: string
}
```

## Performance Optimizations

### Backend
1. **Lazy OCR Loading**: EasyOCR reader loaded only when needed
2. **Caching**: Processed PDF data stored as JSON
3. **Efficient Search**: Pre-computed full_text for each page
4. **Streaming**: Large files handled efficiently

### Frontend
1. **Canvas Overlay**: Separate layer for annotations (no PDF re-render)
2. **Zustand**: Minimal re-renders with selective subscriptions
3. **React PDF**: Built-in virtualization for large documents
4. **Event Delegation**: Efficient mouse event handling

### Rendering Pipeline
```
PDF Load → react-pdf renders page → Canvas overlay draws
    ↓            ↓                        ↓
One-time    On page change        On annotation/search update
```

## Security Considerations

### Current Implementation
- File upload validation (PDF only)
- CORS restrictions
- No authentication (single-user)

### Production Recommendations
- Add user authentication
- Implement file size limits
- Scan uploaded files for malware
- Rate limiting on API endpoints
- Secure file storage with encryption
- Input sanitization for search queries

## Scalability Considerations

### Current Limitations
- JSON file storage (not suitable for high concurrency)
- In-memory processing (memory-intensive for large PDFs)
- Single-server architecture

### Future Improvements
- Database backend (PostgreSQL/MongoDB)
- Queue system for PDF processing (Celery/Redis)
- Object storage (S3) for PDFs
- Horizontal scaling with load balancer
- Caching layer (Redis)
- WebSocket for real-time collaboration

## Extension Points

### Adding New Features

#### Custom Annotation Types
1. Add new type to `Annotation` model
2. Update `AnnotationPanel` UI
3. Extend canvas drawing logic in `PDFViewer`

#### Export to PDF
1. Add backend endpoint using PyMuPDF
2. Iterate annotations and draw on PDF
3. Return modified PDF

#### Collaborative Editing
1. Add WebSocket support
2. Implement OT/CRDT for conflict resolution
3. Real-time state synchronization

## Testing Strategy

### Backend Testing
```python
# Unit tests
- PDF processor for different PDF types
- Annotation CRUD operations
- Search functionality

# Integration tests
- End-to-end upload flow
- API endpoint validation
```

### Frontend Testing
```typescript
// Component tests
- User interactions
- State updates
- Canvas rendering

// E2E tests
- Full annotation workflow
- Search and navigation
```

## Deployment

### Development
```bash
Backend: uvicorn with --reload
Frontend: Vite dev server
```

### Production
```bash
Backend: Gunicorn + Uvicorn workers
Frontend: Static build served by Nginx
Database: PostgreSQL
File Storage: S3 or equivalent
```

## Monitoring & Logging

### Recommended Metrics
- PDF processing time
- OCR accuracy
- API response times
- Error rates
- Storage usage

### Logging Points
- File uploads
- Processing errors
- API requests
- Annotation operations

This architecture provides a solid foundation for a production-ready PDF annotation system while maintaining flexibility for future enhancements.
