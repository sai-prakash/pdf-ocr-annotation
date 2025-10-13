import React, { useState } from 'react';
import {
  Upload,
  Search,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  FileText,
  Type,
} from 'lucide-react';
import { usePdfStore } from '../store/pdfStore';
import { uploadPdf, searchPdf, getAnnotations } from '../services/api';
import './Toolbar.css';

export const Toolbar: React.FC = () => {
  const {
    pdfId,
    filename,
    currentPage,
    totalPages,
    zoomLevel,
    viewMode,
    searchResults,
    currentSearchIndex,
    setCurrentPage,
    zoomIn,
    zoomOut,
    resetZoom,
    setViewMode,
    setPdfData,
    setAnnotations,
    setSearchResults,
    setSearchQuery,
    nextSearchResult,
    previousSearchResult,
    setLoading,
    setError,
  } = usePdfStore();

  const [searchInput, setSearchInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      console.log('Uploading PDF...', file.name);
      const result = await uploadPdf(file);
      console.log('PDF processed successfully:', result);
      setPdfData(result);

      // Load annotations for this PDF
      const annotations = await getAnnotations(result.pdf_id);
      setAnnotations(annotations);
    } catch (error: any) {
      console.error('Error uploading PDF:', error);
      const errorMessage = error.code === 'ECONNABORTED'
        ? 'Upload timeout - Please wait for OCR models to download (first time only)'
        : error.response?.data?.detail || 'Failed to upload PDF';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!pdfId || !searchInput.trim()) return;

    setIsSearching(true);
    setSearchQuery(searchInput);

    try {
      const results = await searchPdf(pdfId, searchInput);
      setSearchResults(results);

      // Navigate to first result
      if (results.length > 0) {
        setCurrentPage(results[0].page_number);
      }
    } catch (error) {
      console.error('Error searching PDF:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleClearSearch = () => {
    setSearchInput('');
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleNextSearchResult = () => {
    nextSearchResult();
  };

  const handlePreviousSearchResult = () => {
    previousSearchResult();
  };

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  return (
    <div className="toolbar">
      <div className="toolbar-section">
        <label className="upload-button">
          <Upload size={18} />
          <span>Upload PDF</span>
          <input
            type="file"
            accept=".pdf"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
        </label>

        {filename && <span className="filename">{filename}</span>}
      </div>

      {pdfId && (
        <>
          <div className="toolbar-section">
            <div className="search-container">
              <input
                type="text"
                placeholder="Search in PDF..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') handleSearch();
                }}
                className="search-input"
              />
              <button
                onClick={handleSearch}
                disabled={!searchInput.trim() || isSearching}
                className="search-button"
                title="Search"
              >
                <Search size={18} />
              </button>
              {searchResults.length > 0 && (
                <>
                  <div className="search-results-info">
                    {currentSearchIndex + 1} of {searchResults.length}
                  </div>
                  <button
                    onClick={handlePreviousSearchResult}
                    className="search-nav-button"
                    title="Previous result (Shift+Enter)"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={handleNextSearchResult}
                    className="search-nav-button"
                    title="Next result (Enter)"
                  >
                    <ChevronRight size={16} />
                  </button>
                </>
              )}
              {searchInput && (
                <button onClick={handleClearSearch} className="clear-button">
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="toolbar-section">
            <div className="page-controls">
              <button
                onClick={handlePreviousPage}
                disabled={currentPage === 1}
                className="nav-button"
                title="Previous page (←)"
              >
                <ChevronLeft size={18} />
              </button>

              <span className="page-info">
                Page {currentPage} of {totalPages}
              </span>

              <button
                onClick={handleNextPage}
                disabled={currentPage === totalPages}
                className="nav-button"
                title="Next page (→)"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>

          <div className="toolbar-section">
            <div className="zoom-controls">
              <button
                onClick={zoomOut}
                disabled={zoomLevel <= 0.5}
                className="zoom-button"
                title="Zoom out (Ctrl+-)"
              >
                <ZoomOut size={18} />
              </button>

              <span className="zoom-info" onClick={resetZoom} title="Reset zoom (Ctrl+0)">
                {Math.round(zoomLevel * 100)}%
              </span>

              <button
                onClick={zoomIn}
                disabled={zoomLevel >= 3}
                className="zoom-button"
                title="Zoom in (Ctrl++)"
              >
                <ZoomIn size={18} />
              </button>
            </div>
          </div>

          <div className="toolbar-section">
            <div className="view-mode-toggle">
              <button
                onClick={() => setViewMode('pdf')}
                className={`view-mode-button ${viewMode === 'pdf' ? 'active' : ''}`}
                title="PDF with text layer"
              >
                <FileText size={18} />
                <span>PDF</span>
              </button>
              <button
                onClick={() => setViewMode('text-only')}
                className={`view-mode-button ${viewMode === 'text-only' ? 'active' : ''}`}
                title="Text-only view"
              >
                <Type size={18} />
                <span>Text</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
