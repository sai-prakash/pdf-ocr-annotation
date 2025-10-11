import cv2
import numpy as np
from typing import Tuple
import logging

logger = logging.getLogger(__name__)


class ImagePreprocessor:
    """
    Advanced image preprocessing for OCR optimization
    """

    @staticmethod
    def detect_skew(image: np.ndarray) -> float:
        """
        Detect document skew angle using Hough transform
        """
        # Convert to binary if not already
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image

        # Threshold
        thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]

        # Find coordinates of non-zero pixels
        coords = np.column_stack(np.where(thresh > 0))

        # Calculate minimum area rectangle
        if len(coords) > 0:
            angle = cv2.minAreaRect(coords)[-1]

            # Normalize angle
            if angle < -45:
                angle = -(90 + angle)
            else:
                angle = -angle

            return angle

        return 0.0

    @staticmethod
    def deskew(image: np.ndarray, angle: float) -> np.ndarray:
        """
        Rotate image to correct skew
        """
        if abs(angle) < 0.5:  # Skip if angle is negligible
            return image

        (h, w) = image.shape[:2]
        center = (w // 2, h // 2)

        # Rotation matrix
        M = cv2.getRotationMatrix2D(center, angle, 1.0)

        # Rotate
        rotated = cv2.warpAffine(
            image, M, (w, h),
            flags=cv2.INTER_CUBIC,
            borderMode=cv2.BORDER_REPLICATE
        )

        return rotated

    @staticmethod
    def remove_noise(image: np.ndarray) -> np.ndarray:
        """
        Remove noise using morphological operations and filtering
        """
        # Median filter (removes salt-and-pepper noise)
        denoised = cv2.medianBlur(image, 3)

        # Morphological opening (removes small bright spots)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
        opened = cv2.morphologyEx(denoised, cv2.MORPH_OPEN, kernel)

        return opened

    @staticmethod
    def binarize(image: np.ndarray, method='adaptive') -> np.ndarray:
        """
        Convert to binary (black & white) using various methods
        """
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image

        if method == 'otsu':
            # Otsu's method - automatic threshold
            _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

        elif method == 'adaptive':
            # Adaptive thresholding - better for varied lighting
            binary = cv2.adaptiveThreshold(
                gray, 255,
                cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY,
                blockSize=11,
                C=2
            )

        elif method == 'sauvola':
            # Sauvola binarization - best for degraded documents
            # Requires scikit-image
            try:
                from skimage.filters import threshold_sauvola
                thresh_sauvola = threshold_sauvola(gray, window_size=25)
                binary = (gray > thresh_sauvola).astype(np.uint8) * 255
            except ImportError:
                logger.warning("scikit-image not available, falling back to adaptive threshold")
                binary = cv2.adaptiveThreshold(
                    gray, 255,
                    cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                    cv2.THRESH_BINARY,
                    blockSize=11, C=2
                )

        else:
            # Simple threshold
            _, binary = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)

        return binary

    @staticmethod
    def enhance_contrast(image: np.ndarray) -> np.ndarray:
        """
        Enhance contrast using CLAHE
        """
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image

        # CLAHE (Contrast Limited Adaptive Histogram Equalization)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(gray)

        return enhanced

    @staticmethod
    def sharpen(image: np.ndarray) -> np.ndarray:
        """
        Sharpen image to improve blurry text
        """
        # Unsharp masking
        gaussian = cv2.GaussianBlur(image, (0, 0), 2.0)
        sharpened = cv2.addWeighted(image, 1.5, gaussian, -0.5, 0)

        return sharpened

    @staticmethod
    def resize_to_optimal_dpi(image: np.ndarray, target_dpi=300, current_dpi=72) -> np.ndarray:
        """
        Resize image to optimal DPI for OCR
        """
        scale = target_dpi / current_dpi

        if abs(scale - 1.0) < 0.1:  # Already close to target
            return image

        width = int(image.shape[1] * scale)
        height = int(image.shape[0] * scale)

        # Use INTER_CUBIC for upscaling, INTER_AREA for downscaling
        interpolation = cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA

        resized = cv2.resize(image, (width, height), interpolation=interpolation)

        return resized

    def preprocess_for_ocr(
        self,
        image: np.ndarray,
        deskew: bool = True,
        denoise: bool = True,
        binarize_method: str = 'adaptive',
        enhance_contrast: bool = True,
        sharpen: bool = False
    ) -> np.ndarray:
        """
        Complete preprocessing pipeline for maximum OCR accuracy

        Parameters:
        -----------
        image: Input image as numpy array
        deskew: Fix rotation/skew (recommended)
        denoise: Remove noise and artifacts (recommended)
        binarize_method: 'adaptive', 'otsu', 'sauvola', or None
        enhance_contrast: Improve faded text visibility (recommended)
        sharpen: Improve blurry text (use only if needed)

        Returns:
        --------
        Preprocessed image optimized for OCR
        """
        logger.info(f"[PREPROCESS] Starting preprocessing pipeline...")

        # 1. Convert to grayscale if needed
        if len(image.shape) == 3:
            processed = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            processed = image.copy()

        # 2. Enhance contrast (helps with faded text)
        if enhance_contrast:
            logger.info(f"[PREPROCESS] Enhancing contrast...")
            processed = self.enhance_contrast(processed)

        # 3. Sharpen (helps with blurry text)
        if sharpen:
            logger.info(f"[PREPROCESS] Sharpening image...")
            processed = self.sharpen(processed)

        # 4. Deskew (fix rotation)
        if deskew:
            angle = self.detect_skew(processed)
            if abs(angle) > 0.5:
                logger.info(f"[PREPROCESS] Deskewing by {angle:.2f} degrees...")
                processed = self.deskew(processed, angle)
            else:
                logger.info(f"[PREPROCESS] No deskewing needed (angle: {angle:.2f}°)")

        # 5. Remove noise
        if denoise:
            logger.info(f"[PREPROCESS] Removing noise...")
            processed = self.remove_noise(processed)

        # 6. Binarize (convert to pure B&W)
        if binarize_method:
            logger.info(f"[PREPROCESS] Binarizing with {binarize_method} method...")
            processed = self.binarize(processed, method=binarize_method)

        logger.info(f"[PREPROCESS] Preprocessing complete")

        return processed
