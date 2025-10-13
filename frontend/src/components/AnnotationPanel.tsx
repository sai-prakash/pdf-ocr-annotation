import React, { useState, useEffect, useMemo } from 'react';
import { Trash2, Edit2, MessageSquare, Filter, List, FileText } from 'lucide-react';
import { usePdfStore } from '../store/pdfStore';
import type { Annotation, BoundingBox } from '../store/pdfStore';
import { createAnnotation, updateAnnotation, deleteAnnotation } from '../services/api';
import './AnnotationPanel.css';

interface TextSelectionEvent extends CustomEvent {
  detail: {
    text: string;
    bbox: BoundingBox;
    pageNumber: number;
  };
}

type ViewMode = 'current' | 'all';

export const AnnotationPanel: React.FC = () => {
  const {
    pdfId,
    currentPage,
    totalPages,
    annotations,
    setCurrentPage,
    addAnnotation,
    updateAnnotation: updateAnnotationStore,
    deleteAnnotation: deleteAnnotationStore,
  } = usePdfStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState('');
  const [selectedColor, setSelectedColor] = useState('#ffff00');
  const [viewMode, setViewMode] = useState<ViewMode>('current');
  const [filterPage, setFilterPage] = useState<number | 'all'>('all');
  const [highlightedAnnotation, setHighlightedAnnotation] = useState<string | null>(null);

  const colors = [
    { name: 'Yellow', value: '#ffff00' },
    { name: 'Green', value: '#00ff00' },
    { name: 'Blue', value: '#00bfff' },
    { name: 'Pink', value: '#ff69b4' },
    { name: 'Orange', value: '#ffa500' },
  ];

  useEffect(() => {
    const handleCreateAnnotation = async (event: Event) => {
      const customEvent = event as TextSelectionEvent;
      const { text, bbox, pageNumber } = customEvent.detail;

      if (!pdfId) return;

      try {
        const newAnnotation = await createAnnotation({
          pdf_id: pdfId,
          page_number: pageNumber,
          text,
          bounding_box: bbox,
          color: selectedColor,
          note: '',
        });

        addAnnotation(newAnnotation);
      } catch (error) {
        console.error('Error creating annotation:', error);
      }
    };

    window.addEventListener('createAnnotation', handleCreateAnnotation);
    return () => window.removeEventListener('createAnnotation', handleCreateAnnotation);
  }, [pdfId, selectedColor, addAnnotation]);

  // Filtered annotations based on view mode and filter
  const filteredAnnotations = useMemo(() => {
    if (viewMode === 'current') {
      return annotations.filter((ann) => ann.page_number === currentPage);
    }

    if (filterPage !== 'all') {
      return annotations.filter((ann) => ann.page_number === filterPage);
    }

    return annotations;
  }, [annotations, viewMode, currentPage, filterPage]);

  // Group annotations by page for "all" view
  const groupedAnnotations = useMemo(() => {
    if (viewMode !== 'all') return {};

    return filteredAnnotations.reduce((acc, ann) => {
      if (!acc[ann.page_number]) {
        acc[ann.page_number] = [];
      }
      acc[ann.page_number].push(ann);
      return acc;
    }, {} as Record<number, Annotation[]>);
  }, [filteredAnnotations, viewMode]);

  const handleUpdateAnnotation = async (annotationId: string) => {
    if (!pdfId) return;

    try {
      await updateAnnotation(annotationId, {
        pdf_id: pdfId,
        note: editNote,
      } as Annotation);

      updateAnnotationStore(annotationId, { note: editNote });
      setEditingId(null);
      setEditNote('');
    } catch (error) {
      console.error('Error updating annotation:', error);
    }
  };

  const handleDeleteAnnotation = async (annotationId: string) => {
    try {
      await deleteAnnotation(annotationId);
      deleteAnnotationStore(annotationId);
    } catch (error) {
      console.error('Error deleting annotation:', error);
    }
  };

  // Click to highlight: Navigate to annotation and flash it
  const handleAnnotationClick = (annotation: Annotation) => {
    // 1. Navigate to the page
    if (annotation.page_number !== currentPage) {
      setCurrentPage(annotation.page_number);
    }

    // 2. Dispatch event to scroll to annotation
    const event = new CustomEvent('scrollToAnnotation', {
      detail: { annotation },
    });
    window.dispatchEvent(event);

    // 3. Highlight the annotation temporarily
    setHighlightedAnnotation(annotation.id);

    // 4. Remove highlight after 2 seconds
    setTimeout(() => {
      setHighlightedAnnotation(null);
    }, 2000);
  };

  // Broadcast highlighted annotation to PDFViewer
  useEffect(() => {
    const event = new CustomEvent('highlightAnnotation', {
      detail: { annotationId: highlightedAnnotation },
    });
    window.dispatchEvent(event);
  }, [highlightedAnnotation]);

  const currentPageCount = annotations.filter((a) => a.page_number === currentPage).length;

  return (
    <div className="annotation-panel">
      <div className="annotation-panel-header">
        <h3>Annotations</h3>

        {/* View Mode Toggle */}
        <div className="view-mode-toggle">
          <button
            className={`view-mode-btn ${viewMode === 'current' ? 'active' : ''}`}
            onClick={() => {
              setViewMode('current');
              setFilterPage('all');
            }}
            title="Show current page only"
          >
            <FileText size={16} />
            Current ({currentPageCount})
          </button>
          <button
            className={`view-mode-btn ${viewMode === 'all' ? 'active' : ''}`}
            onClick={() => setViewMode('all')}
            title="Show all pages"
          >
            <List size={16} />
            All ({annotations.length})
          </button>
        </div>

        {/* Filter by Page (only show in "all" mode) */}
        {viewMode === 'all' && (
          <div className="page-filter">
            <Filter size={14} />
            <select
              value={filterPage}
              onChange={(e) => {
                const value = e.target.value;
                setFilterPage(value === 'all' ? 'all' : parseInt(value));
              }}
            >
              <option value="all">All Pages</option>
              {Array.from({ length: totalPages }, (_, i) => {
                const page = i + 1;
                const count = annotations.filter((a) => a.page_number === page).length;
                return (
                  <option key={page} value={page}>
                    Page {page} ({count})
                  </option>
                );
              })}
            </select>
          </div>
        )}

        {/* Color Picker */}
        <div className="color-picker">
          <label>Highlight Color:</label>
          <div className="color-options">
            {colors.map((color) => (
              <button
                key={color.value}
                className={`color-button ${
                  selectedColor === color.value ? 'selected' : ''
                }`}
                style={{ backgroundColor: color.value }}
                onClick={() => setSelectedColor(color.value)}
                title={color.name}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="annotation-list">
        {filteredAnnotations.length === 0 ? (
          <p className="no-annotations">
            {viewMode === 'current'
              ? 'No annotations on this page. Select text to create one.'
              : 'No annotations found.'}
          </p>
        ) : viewMode === 'all' && filterPage === 'all' ? (
          // Grouped by page view
          Object.entries(groupedAnnotations)
            .sort(([a], [b]) => parseInt(a) - parseInt(b))
            .map(([page, pageAnnotations]) => (
              <div key={page} className="annotation-page-group">
                <h4 className="page-group-header">
                  Page {page} ({pageAnnotations.length})
                </h4>
                {pageAnnotations.map((annotation) => (
                  <AnnotationCard
                    key={annotation.id}
                    annotation={annotation}
                    isHighlighted={highlightedAnnotation === annotation.id}
                    isEditing={editingId === annotation.id}
                    editNote={editNote}
                    onEditNoteChange={setEditNote}
                    onClick={() => handleAnnotationClick(annotation)}
                    onEdit={() => {
                      setEditingId(annotation.id);
                      setEditNote(annotation.note || '');
                    }}
                    onSave={() => handleUpdateAnnotation(annotation.id)}
                    onCancelEdit={() => {
                      setEditingId(null);
                      setEditNote('');
                    }}
                    onDelete={() => handleDeleteAnnotation(annotation.id)}
                  />
                ))}
              </div>
            ))
        ) : (
          // Flat list view
          filteredAnnotations.map((annotation) => (
            <AnnotationCard
              key={annotation.id}
              annotation={annotation}
              isHighlighted={highlightedAnnotation === annotation.id}
              isEditing={editingId === annotation.id}
              editNote={editNote}
              onEditNoteChange={setEditNote}
              onClick={() => handleAnnotationClick(annotation)}
              onEdit={() => {
                setEditingId(annotation.id);
                setEditNote(annotation.note || '');
              }}
              onSave={() => handleUpdateAnnotation(annotation.id)}
              onCancelEdit={() => {
                setEditingId(null);
                setEditNote('');
              }}
              onDelete={() => handleDeleteAnnotation(annotation.id)}
              showPageNumber={viewMode === 'all'}
            />
          ))
        )}
      </div>

      <div className="annotation-stats">
        <p>
          {filteredAnnotations.length} annotation
          {filteredAnnotations.length !== 1 ? 's' : ''}{' '}
          {viewMode === 'current' ? 'on this page' : 'total'}
        </p>
      </div>
    </div>
  );
};

// Extracted Annotation Card Component
interface AnnotationCardProps {
  annotation: Annotation;
  isHighlighted: boolean;
  isEditing: boolean;
  editNote: string;
  onEditNoteChange: (note: string) => void;
  onClick: () => void;
  onEdit: () => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  showPageNumber?: boolean;
}

const AnnotationCard: React.FC<AnnotationCardProps> = ({
  annotation,
  isHighlighted,
  isEditing,
  editNote,
  onEditNoteChange,
  onClick,
  onEdit,
  onSave,
  onCancelEdit,
  onDelete,
  showPageNumber = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const MAX_PREVIEW_LENGTH = 150;
  const isLongText = annotation.text.length > MAX_PREVIEW_LENGTH;

  return (
    <div
      className={`annotation-item ${isHighlighted ? 'highlighted' : ''}`}
      onClick={onClick}
    >
      <div
        className="annotation-highlight"
        style={{ backgroundColor: annotation.color }}
      />
      <div className="annotation-content">
        {showPageNumber && (
          <div className="annotation-page-badge">Page {annotation.page_number}</div>
        )}

        <div className="annotation-text-container">
          <p className={`annotation-text ${isExpanded ? 'expanded' : 'collapsed'}`}>
            {isExpanded || !isLongText
              ? annotation.text
              : annotation.text.substring(0, MAX_PREVIEW_LENGTH) + '...'}
          </p>
          {isLongText && (
            <button
              className="btn-expand"
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              title={isExpanded ? 'Show less' : 'Show more'}
            >
              {isExpanded ? 'Show less' : 'Show more'}
            </button>
          )}
          {isLongText && (
            <div className="text-stats">
              {annotation.text.split(/\s+/).length} words • {annotation.text.length} characters
            </div>
          )}
        </div>

        {isEditing ? (
          <div className="annotation-edit">
            <textarea
              value={editNote}
              onChange={(e) => onEditNoteChange(e.target.value)}
              placeholder="Add a note..."
              rows={3}
              onClick={(e) => e.stopPropagation()}
            />
            <div className="annotation-edit-actions">
              <button
                className="btn-save"
                onClick={(e) => {
                  e.stopPropagation();
                  onSave();
                }}
              >
                Save
              </button>
              <button
                className="btn-cancel"
                onClick={(e) => {
                  e.stopPropagation();
                  onCancelEdit();
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            {annotation.note && (
              <div className="annotation-note">
                <MessageSquare size={14} />
                <span>{annotation.note}</span>
              </div>
            )}
            <div className="annotation-actions">
              <button
                className="btn-icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                title="Edit note"
              >
                <Edit2 size={16} />
              </button>
              <button
                className="btn-icon btn-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                title="Delete annotation"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
