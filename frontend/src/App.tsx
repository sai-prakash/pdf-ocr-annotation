import { useCallback } from 'react';
import { Toolbar } from './components/Toolbar';
import { PDFViewer } from './components/PDFViewer';
import { AnnotationPanel } from './components/AnnotationPanel';
import { usePdfStore } from './store/pdfStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import './App.css';

function App() {
  const {
    isLoading,
    error,
    currentPage,
    totalPages,
    setCurrentPage,
    zoomIn,
    zoomOut,
    resetZoom
  } = usePdfStore();

  // Keyboard shortcuts
  const shortcuts = useCallback(() => [
    {
      key: 'ArrowRight',
      callback: () => {
        if (currentPage < totalPages) setCurrentPage(currentPage + 1);
      },
      description: 'Next page'
    },
    {
      key: 'ArrowLeft',
      callback: () => {
        if (currentPage > 1) setCurrentPage(currentPage - 1);
      },
      description: 'Previous page'
    },
    {
      key: '=',
      ctrl: true,
      callback: zoomIn,
      description: 'Zoom in'
    },
    {
      key: '-',
      ctrl: true,
      callback: zoomOut,
      description: 'Zoom out'
    },
    {
      key: '0',
      ctrl: true,
      callback: resetZoom,
      description: 'Reset zoom'
    }
  ], [currentPage, totalPages, setCurrentPage, zoomIn, zoomOut, resetZoom]);

  useKeyboardShortcuts(shortcuts());

  return (
    <div className="app">
      <Toolbar />
      <div className="app-content">
        {isLoading && (
          <div className="loading-overlay">
            <div className="loading-spinner"></div>
            <p>Processing PDF... This may take a few minutes on first upload (downloading OCR models)</p>
          </div>
        )}
        {error && (
          <div className="error-banner">
            <p>{error}</p>
            <button onClick={() => usePdfStore.getState().setError(null)}>Dismiss</button>
          </div>
        )}
        <PDFViewer />
        <AnnotationPanel />
      </div>
    </div>
  );
}

export default App;
