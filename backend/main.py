from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn
import os
import logging
from pathlib import Path
from typing import List, Optional
from pydantic import BaseModel
import shutil

from services.pdf_processor import PDFProcessor
from services.annotation_service import AnnotationService

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('pdf_processing.log')
    ]
)
logger = logging.getLogger(__name__)

app = FastAPI(title="PDF Annotation API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create necessary directories
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

# Initialize services
pdf_processor = PDFProcessor()
annotation_service = AnnotationService()

# Mount static files
app.mount("/files", StaticFiles(directory=str(UPLOAD_DIR)), name="files")


class Annotation(BaseModel):
    id: Optional[str] = None
    pdf_id: str
    page_number: int
    text: str
    bounding_box: dict
    color: Optional[str] = "#ffff00"
    note: Optional[str] = None


@app.get("/")
async def root():
    return {"message": "PDF Annotation API", "version": "1.0.0"}


@app.post("/api/upload")
async def upload_pdf(file: UploadFile = File(...)):
    """Upload a PDF file and extract text with bounding boxes"""
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    try:
        logger.info(f"[UPLOAD] Received file: {file.filename}")

        # Save uploaded file
        file_path = UPLOAD_DIR / file.filename
        with file_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        file_size_mb = file_path.stat().st_size / (1024 * 1024)
        logger.info(f"[UPLOAD] File saved: {file_size_mb:.2f} MB")

        # Process PDF
        logger.info(f"[UPLOAD] Starting PDF processing...")
        result = await pdf_processor.process_pdf(str(file_path))
        logger.info(f"[UPLOAD] Processing complete: {result['total_pages']} pages")

        return JSONResponse(content={
            "success": True,
            "pdf_id": result["pdf_id"],
            "filename": file.filename,
            "pages": result["pages"],
            "file_url": f"/files/{file.filename}"
        })

    except Exception as e:
        logger.error(f"[UPLOAD] Error processing PDF: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error processing PDF: {str(e)}")


@app.get("/api/pdf/{pdf_id}")
async def get_pdf_data(pdf_id: str):
    """Get extracted text and bounding boxes for a PDF"""
    try:
        data = await pdf_processor.get_pdf_data(pdf_id)
        if not data:
            raise HTTPException(status_code=404, detail="PDF not found")
        return JSONResponse(content=data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/pdf/{pdf_id}/page/{page_number}")
async def get_page_data(pdf_id: str, page_number: int):
    """Get text and bounding boxes for a specific page"""
    try:
        data = await pdf_processor.get_page_data(pdf_id, page_number)
        if not data:
            raise HTTPException(status_code=404, detail="Page not found")
        return JSONResponse(content=data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/search")
async def search_pdf(pdf_id: str, query: str):
    """Search for text in PDF and return matching locations"""
    try:
        results = await pdf_processor.search_text(pdf_id, query)
        return JSONResponse(content={"results": results})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/annotations")
async def create_annotation(annotation: Annotation):
    """Create a new annotation"""
    try:
        result = await annotation_service.create_annotation(annotation.dict())
        return JSONResponse(content=result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/annotations/{pdf_id}")
async def get_annotations(pdf_id: str, page_number: Optional[int] = None):
    """Get annotations for a PDF or specific page"""
    try:
        annotations = await annotation_service.get_annotations(pdf_id, page_number)
        return JSONResponse(content={"annotations": annotations})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/annotations/{annotation_id}")
async def update_annotation(annotation_id: str, annotation: Annotation):
    """Update an existing annotation"""
    try:
        result = await annotation_service.update_annotation(annotation_id, annotation.dict())
        return JSONResponse(content=result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/annotations/{annotation_id}")
async def delete_annotation(annotation_id: str):
    """Delete an annotation"""
    try:
        await annotation_service.delete_annotation(annotation_id)
        return JSONResponse(content={"success": True})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
