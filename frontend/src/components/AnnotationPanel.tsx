import React, { useState, useEffect } from 'react';
import { Trash2, Edit2, MessageSquare } from 'lucide-react';
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

export const AnnotationPanel: React.FC = () => {
  const {
    pdfId,
    currentPage,
    annotations,
    addAnnotation,
    updateAnnotation: updateAnnotationStore,
    deleteAnnotation: deleteAnnotationStore,
  } = usePdfStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState('');
  const [selectedColor, setSelectedColor] = useState('#ffff00');

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

  const currentPageAnnotations = annotations.filter(
    (ann) => ann.page_number === currentPage
  );

  return (
    <div className="annotation-panel">
      <div className="annotation-panel-header">
        <h3>Annotations</h3>
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
        {currentPageAnnotations.length === 0 ? (
          <p className="no-annotations">
            No annotations on this page. Select text to create one.
          </p>
        ) : (
          currentPageAnnotations.map((annotation) => (
            <div key={annotation.id} className="annotation-item">
              <div
                className="annotation-highlight"
                style={{ backgroundColor: annotation.color }}
              />
              <div className="annotation-content">
                <p className="annotation-text">
                  {annotation.text.length > 100
                    ? annotation.text.substring(0, 100) + '...'
                    : annotation.text}
                </p>

                {editingId === annotation.id ? (
                  <div className="annotation-edit">
                    <textarea
                      value={editNote}
                      onChange={(e) => setEditNote(e.target.value)}
                      placeholder="Add a note..."
                      rows={3}
                    />
                    <div className="annotation-edit-actions">
                      <button
                        className="btn-save"
                        onClick={() => handleUpdateAnnotation(annotation.id)}
                      >
                        Save
                      </button>
                      <button
                        className="btn-cancel"
                        onClick={() => {
                          setEditingId(null);
                          setEditNote('');
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
                        onClick={() => {
                          setEditingId(annotation.id);
                          setEditNote(annotation.note || '');
                        }}
                        title="Edit note"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        className="btn-icon btn-delete"
                        onClick={() => handleDeleteAnnotation(annotation.id)}
                        title="Delete annotation"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="annotation-stats">
        <p>
          {currentPageAnnotations.length} annotation
          {currentPageAnnotations.length !== 1 ? 's' : ''} on this page
        </p>
        <p>
          {annotations.length} total annotation
          {annotations.length !== 1 ? 's' : ''}
        </p>
      </div>
    </div>
  );
};
