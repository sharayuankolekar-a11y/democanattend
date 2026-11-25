"""Basic image-quality gates for face frames (lighting, size, blur)."""
import cv2
import numpy as np

ISSUE_MESSAGES = {
    "too_small": "Move closer so your face fills more of the frame.",
    "too_dark": "It is too dark. Face a light source and try again.",
    "too_bright": "The image is too bright or backlit. Avoid strong light behind you.",
    "blurry": "The image is blurry. Hold the device steady and try again.",
}


def assess(img_bgr, bbox, cfg):
    h, w = img_bgr.shape[:2]
    x, y, bw, bh = bbox
    x0, y0 = max(0, int(x)), max(0, int(y))
    x1, y1 = min(w, int(x + bw)), min(h, int(y + bh))
    issues = []
    if min(x1 - x0, y1 - y0) < cfg.min_face_px:
        issues.append("too_small")
    if x1 <= x0 or y1 <= y0:
        return issues or ["too_small"]
    roi = cv2.cvtColor(img_bgr[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
    mean = float(roi.mean())
    if mean < cfg.min_brightness:
        issues.append("too_dark")
    elif mean > cfg.max_brightness:
        issues.append("too_bright")
    small = cv2.resize(roi, (128, 128), interpolation=cv2.INTER_AREA)
    if float(cv2.Laplacian(small, cv2.CV_64F).var()) < cfg.min_sharpness:
        issues.append("blurry")
    return issues
