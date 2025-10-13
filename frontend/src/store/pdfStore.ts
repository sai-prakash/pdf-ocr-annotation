import { create } from 'zustand';

export interface BoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface TextBlock {
  text: string;
  bbox: BoundingBox;
  confidence: number;
  type: 'native' | 'ocr';
}

export interface PageData {
  page_number: number;
  is_scanned: boolean;
  width: number;
  height: number;
  blocks: TextBlock[];
  full_text: string;
  block_count: number;
}

export interface Annotation {
  id: string;
  pdf_id: string;
  page_number: number;
  text: string;
  bounding_box: BoundingBox;
  color: string;
  note: string;
  created_at?: string;
  updated_at?: string;
}

export interface SearchResult {
  page_number: number;
  text: string;
  matched_text: string;
  bbox: BoundingBox;
  context_start: number;
  context_end: number;
  match_index: number;
}

export type ViewMode = 'pdf' | 'text-only';

interface PDFState {
  pdfId: string | null;
  filename: string | null;
  fileUrl: string | null;
  totalPages: number;
  currentPage: number;
  zoomLevel: number;
  viewMode: ViewMode;
  pages: PageData[];
  annotations: Annotation[];
  searchResults: SearchResult[];
  searchQuery: string;
  currentSearchIndex: number;
  selectedAnnotation: Annotation | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setPdfData: (data: {
    pdf_id: string;
    filename: string;
    file_url: string;
    pages: PageData[];
  }) => void;
  setCurrentPage: (page: number) => void;
  setZoomLevel: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setViewMode: (mode: ViewMode) => void;
  setAnnotations: (annotations: Annotation[]) => void;
  addAnnotation: (annotation: Annotation) => void;
  updateAnnotation: (id: string, annotation: Partial<Annotation>) => void;
  deleteAnnotation: (id: string) => void;
  setSearchResults: (results: SearchResult[]) => void;
  setSearchQuery: (query: string) => void;
  setCurrentSearchIndex: (index: number) => void;
  nextSearchResult: () => void;
  previousSearchResult: () => void;
  setSelectedAnnotation: (annotation: Annotation | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  pdfId: null,
  filename: null,
  fileUrl: null,
  totalPages: 0,
  currentPage: 1,
  zoomLevel: 1,
  viewMode: 'pdf' as ViewMode,
  pages: [],
  annotations: [],
  searchResults: [],
  searchQuery: '',
  currentSearchIndex: -1,
  selectedAnnotation: null,
  isLoading: false,
  error: null,
};

export const usePdfStore = create<PDFState>((set) => ({
  ...initialState,

  setPdfData: (data) =>
    set({
      pdfId: data.pdf_id,
      filename: data.filename,
      fileUrl: data.file_url,
      pages: data.pages,
      totalPages: data.pages.length,
      currentPage: 1,
    }),

  setCurrentPage: (page) => set({ currentPage: page }),

  setZoomLevel: (zoom) => set({ zoomLevel: Math.max(0.5, Math.min(3, zoom)) }),

  zoomIn: () =>
    set((state) => ({
      zoomLevel: Math.min(3, state.zoomLevel + 0.25),
    })),

  zoomOut: () =>
    set((state) => ({
      zoomLevel: Math.max(0.5, state.zoomLevel - 0.25),
    })),

  resetZoom: () => set({ zoomLevel: 1 }),

  setViewMode: (mode) => set({ viewMode: mode }),

  setAnnotations: (annotations) => set({ annotations }),

  addAnnotation: (annotation) =>
    set((state) => ({
      annotations: [...state.annotations, annotation],
    })),

  updateAnnotation: (id, updatedData) =>
    set((state) => ({
      annotations: state.annotations.map((ann) =>
        ann.id === id ? { ...ann, ...updatedData } : ann
      ),
    })),

  deleteAnnotation: (id) =>
    set((state) => ({
      annotations: state.annotations.filter((ann) => ann.id !== id),
    })),

  setSearchResults: (results) => set({ searchResults: results, currentSearchIndex: results.length > 0 ? 0 : -1 }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  setCurrentSearchIndex: (index) => set({ currentSearchIndex: index }),

  nextSearchResult: () =>
    set((state) => {
      if (state.searchResults.length === 0) return {};
      const nextIndex = (state.currentSearchIndex + 1) % state.searchResults.length;
      const nextResult = state.searchResults[nextIndex];
      return {
        currentSearchIndex: nextIndex,
        currentPage: nextResult.page_number,
      };
    }),

  previousSearchResult: () =>
    set((state) => {
      if (state.searchResults.length === 0) return {};
      const prevIndex = state.currentSearchIndex === 0
        ? state.searchResults.length - 1
        : state.currentSearchIndex - 1;
      const prevResult = state.searchResults[prevIndex];
      return {
        currentSearchIndex: prevIndex,
        currentPage: prevResult.page_number,
      };
    }),

  setSelectedAnnotation: (annotation) => set({ selectedAnnotation: annotation }),

  setLoading: (loading) => set({ isLoading: loading }),

  setError: (error) => set({ error }),

  reset: () => set(initialState),
}));
