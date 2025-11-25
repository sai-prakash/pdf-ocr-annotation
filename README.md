# DocHUb Intelligent Document Perception Engine

![Status](https://img.shields.io/badge/Status-Production%20Pilot-blue) ![Stack](https://img.shields.io/badge/Stack-FastAPI%20%7C%20React%20%7C%20Azure%20AI-blue) ![Focus](https://img.shields.io/badge/Focus-OCR%20%26%20RLHF-orange)

## 🚀 Overview

This repository contains the **Document Perception Module** of the **Document** platform.

In high-trust enterprise operations, standard RAG (Retrieval Augmented Generation) fails when source documents are scanned or poorly structured. This engine solves the **"Ground Truth" bottleneck** by converting unstructured PDFs (scanned & native) into a coordinate-mapped, machine-readable format that allows **Human-in-the-Loop (HITL)** agents to verify and correct data before it enters the LLM context window.

**Why this matters:** This tool reduced data annotation time by **~50%** for Operations teams by replacing manual data entry with a "Verify & Edit" workflow.

---

## 🏗 System Architecture

This module sits between the raw data ingestion and the Agentic UI.

![Architecture Diagram](https://github.com/sai-prakash/pdf-ocr-annotation/blob/pipeline/architecture-diagram.png)
*(Note: Replace the link above with the actual path to your uploaded diagram)*

### The Pipeline Flow:
1.  **Ingestion:** Auto-detection of PDF type (Native vs. Scanned/Rasterized).
2.  **Hybrid OCR Strategy:**
    * **Layer 1 (Fast):** PyMuPDF for native text extraction.
    * **Layer 2 (Deep):** EasyOCR/Tesseract for scanned regions, generating confidence scores.
3.  **Coordinate Mapping:** Normalizing PDF coordinates to React Canvas viewports to ensure 100% overlay precision across zoom levels.
4.  **Output:** Structured JSON payload used for LLM RAG context and downstream fine-tuning.

---

## 🛠 Tech Stack & Engineering Decisions

| Component | Technology | Reasoning |
| :--- | :--- | :--- |
| **Backend** | Python (FastAPI) | High-performance async handling for heavy OCR tasks; native integration with PyTorch/EasyOCR. |
| **Frontend** | React + TypeScript | Strict typing for complex coordinate logic; `zustand` for managing heavy local state (annotations). |
| **OCR Engine** | EasyOCR + PyMuPDF | A hybrid approach to balance speed vs. accuracy. Pure OCR is too slow; Pure extraction fails on scans. |
| **State** | Zustand | Redux was overkill; Context API causes too many re-renders for high-frequency canvas drawing. |

---

## ⚡ Key Engineering Challenges Solved

### 1. The "Coordinate Drift" Problem
* **Challenge:** Mapping text coordinates from a 300 DPI PDF backend to a responsive React Canvas frontend resulted in "drifting" highlights when zooming.
* **Solution:** Implemented a normalization layer that converts raw PDF points to percentage-based viewport coordinates, ensuring annotations stay locked to text regardless of screen size or zoom level.

### 2. Hybrid Text Selection
* **Challenge:** Users need to select text seamlessly across both "real" text layers and "OCR" overlay layers.
* **Solution:** Built a unified selection engine that detects the underlying data source and merges bounding boxes visually, creating a frictionless UX for the agent.

### 3. Large Document Performance
* **Challenge:** Loading 100+ page legal documents crashed the browser DOM.
* **Solution:** Implemented virtualization for the PDF viewer (rendering only visible pages) and lazy-loading for OCR results.

---

## 📦 Local Setup (Dev Mode)

### Backend (Python/FastAPI)
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py
# Server running on localhost:8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# UI running on localhost:5173
```



### 🔮 Future Roadmap (Scaling to Production)
Vector Integration: Pushing annotated chunks directly to Azure AI Search.

Multi-Modal Layout Analysis: Using LayoutLM to detect tables vs. paragraphs automatically.

Collaborative Sockets: Moving from REST to WebSockets for real-time collaborative annotation.

### 📜 Context
This code is a sanitized extraction from the internal "PromptForge" platform built for JPM Operations. Some proprietary business logic has been removed for demonstration purposes.
