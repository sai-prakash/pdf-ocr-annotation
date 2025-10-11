import json
from pathlib import Path
from typing import List, Dict, Optional
import uuid
from datetime import datetime


class AnnotationService:
    def __init__(self):
        self.annotations_dir = Path("data/annotations")
        self.annotations_dir.mkdir(parents=True, exist_ok=True)

    def _get_annotations_file(self, pdf_id: str) -> Path:
        """Get the annotations file path for a PDF"""
        return self.annotations_dir / f"{pdf_id}.json"

    async def create_annotation(self, annotation_data: Dict) -> Dict:
        """Create a new annotation"""
        pdf_id = annotation_data["pdf_id"]
        annotation_id = str(uuid.uuid4())

        annotation = {
            "id": annotation_id,
            "pdf_id": pdf_id,
            "page_number": annotation_data["page_number"],
            "text": annotation_data["text"],
            "bounding_box": annotation_data["bounding_box"],
            "color": annotation_data.get("color", "#ffff00"),
            "note": annotation_data.get("note", ""),
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }

        # Load existing annotations
        annotations_file = self._get_annotations_file(pdf_id)
        annotations = []

        if annotations_file.exists():
            with open(annotations_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                annotations = data.get("annotations", [])

        # Add new annotation
        annotations.append(annotation)

        # Save
        with open(annotations_file, 'w', encoding='utf-8') as f:
            json.dump({"annotations": annotations}, f, ensure_ascii=False, indent=2)

        return annotation

    async def get_annotations(self, pdf_id: str, page_number: Optional[int] = None) -> List[Dict]:
        """Get annotations for a PDF or specific page"""
        annotations_file = self._get_annotations_file(pdf_id)

        if not annotations_file.exists():
            return []

        with open(annotations_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            annotations = data.get("annotations", [])

        # Filter by page if specified
        if page_number is not None:
            annotations = [a for a in annotations if a["page_number"] == page_number]

        return annotations

    async def update_annotation(self, annotation_id: str, annotation_data: Dict) -> Dict:
        """Update an existing annotation"""
        pdf_id = annotation_data["pdf_id"]
        annotations_file = self._get_annotations_file(pdf_id)

        if not annotations_file.exists():
            raise ValueError("Annotation not found")

        with open(annotations_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            annotations = data.get("annotations", [])

        # Find and update annotation
        updated = False
        for i, ann in enumerate(annotations):
            if ann["id"] == annotation_id:
                annotations[i].update({
                    "text": annotation_data.get("text", ann["text"]),
                    "bounding_box": annotation_data.get("bounding_box", ann["bounding_box"]),
                    "color": annotation_data.get("color", ann["color"]),
                    "note": annotation_data.get("note", ann["note"]),
                    "updated_at": datetime.utcnow().isoformat()
                })
                updated = True
                break

        if not updated:
            raise ValueError("Annotation not found")

        # Save
        with open(annotations_file, 'w', encoding='utf-8') as f:
            json.dump({"annotations": annotations}, f, ensure_ascii=False, indent=2)

        return annotations[i]

    async def delete_annotation(self, annotation_id: str):
        """Delete an annotation"""
        # Search through all annotation files
        for annotations_file in self.annotations_dir.glob("*.json"):
            with open(annotations_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                annotations = data.get("annotations", [])

            # Filter out the annotation
            new_annotations = [a for a in annotations if a["id"] != annotation_id]

            if len(new_annotations) < len(annotations):
                # Save updated list
                with open(annotations_file, 'w', encoding='utf-8') as f:
                    json.dump({"annotations": new_annotations}, f, ensure_ascii=False, indent=2)
                return

        raise ValueError("Annotation not found")
