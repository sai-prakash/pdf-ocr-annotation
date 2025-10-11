import axios from 'axios';
import type { Annotation, PageData, SearchResult } from '../store/pdfStore';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 600000, // 10 minutes for large scanned PDFs (increased from 5 minutes)
});

export const uploadPdf = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await api.post('/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data;
};

export const getPdfData = async (pdfId: string) => {
  const response = await api.get(`/pdf/${pdfId}`);
  return response.data;
};

export const getPageData = async (pdfId: string, pageNumber: number) => {
  const response = await api.get<PageData>(`/pdf/${pdfId}/page/${pageNumber}`);
  return response.data;
};

export const searchPdf = async (pdfId: string, query: string) => {
  const response = await api.post<{ results: SearchResult[] }>('/search', null, {
    params: { pdf_id: pdfId, query },
  });
  return response.data.results;
};

export const createAnnotation = async (annotation: Omit<Annotation, 'id'>) => {
  const response = await api.post<Annotation>('/annotations', annotation);
  return response.data;
};

export const getAnnotations = async (pdfId: string, pageNumber?: number) => {
  const params = pageNumber ? { page_number: pageNumber } : {};
  const response = await api.get<{ annotations: Annotation[] }>(
    `/annotations/${pdfId}`,
    { params }
  );
  return response.data.annotations;
};

export const updateAnnotation = async (
  annotationId: string,
  annotation: Partial<Annotation>
) => {
  const response = await api.put<Annotation>(
    `/annotations/${annotationId}`,
    annotation
  );
  return response.data;
};

export const deleteAnnotation = async (annotationId: string) => {
  await api.delete(`/annotations/${annotationId}`);
};
