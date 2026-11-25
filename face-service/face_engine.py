"""Face detection + embedding. Default engine: OpenCV YuNet (detector) + SFace
(recognizer). The ONNX weights are downloaded once with download_models.py."""
import os
import threading
from dataclasses import dataclass
from typing import Any, Optional

import cv2
import numpy as np

DETECTOR_FILE = "face_detection_yunet_2023mar.onnx"
RECOGNIZER_FILE = "face_recognition_sface_2021dec.onnx"


class EngineUnavailable(RuntimeError):
    pass


@dataclass
class Face:
    bbox: tuple                 # x, y, w, h (pixels of the prepared image)
    landmarks: np.ndarray       # 5 x 2: two eyes, nose tip, two mouth corners
    score: float = 1.0
    raw: Optional[Any] = None   # detector row, needed for alignment


def prepare(img, max_side=640):
    """Downscale large camera frames so detection stays fast and consistent."""
    h, w = img.shape[:2]
    scale = max_side / float(max(h, w))
    if scale < 1.0:
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return img


def normalize(v):
    v = np.asarray(v, dtype=np.float64).flatten()
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


def cosine(a, b):
    return float(np.dot(normalize(a), normalize(b)))


class OpenCVFaceEngine:
    name = "opencv-yunet-sface"

    def __init__(self, model_dir, score_threshold=0.85):
        det = os.path.join(model_dir, DETECTOR_FILE)
        rec = os.path.join(model_dir, RECOGNIZER_FILE)
        if not (os.path.isfile(det) and os.path.isfile(rec)):
            raise EngineUnavailable(f"Face model files not found in '{model_dir}'. Run: python download_models.py")
        self._detector = cv2.FaceDetectorYN.create(det, "", (320, 320), score_threshold, 0.3, 5000)
        self._recognizer = cv2.FaceRecognizerSF.create(rec, "")
        self._lock = threading.Lock()   # the OpenCV objects are stateful

    def detect(self, img):
        h, w = img.shape[:2]
        with self._lock:
            self._detector.setInputSize((w, h))
            _, rows = self._detector.detect(img)
        if rows is None:
            return []
        faces = [
            Face(bbox=(int(r[0]), int(r[1]), int(r[2]), int(r[3])),
                 landmarks=np.array(r[4:14], dtype=float).reshape(5, 2),
                 score=float(r[14]), raw=r)
            for r in rows
        ]
        faces.sort(key=lambda f: f.bbox[2] * f.bbox[3], reverse=True)
        return faces

    def embed(self, img, face):
        with self._lock:
            aligned = self._recognizer.alignCrop(img, face.raw)
            feature = self._recognizer.feature(aligned)
        return normalize(feature)


def load_engine(cfg):
    return OpenCVFaceEngine(cfg.model_dir)
