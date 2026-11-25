"""Downloads the two ONNX face models (YuNet detector + SFace recognizer) from the
OpenCV Model Zoo into ./models. Run once:  python download_models.py

If a download fails (offline / blocked), fetch the same two files manually from
https://github.com/opencv/opencv_zoo (models/face_detection_yunet and
models/face_recognition_sface) and put them in ./models with the same names."""
import os
import sys
import urllib.request

BASE = "https://github.com/opencv/opencv_zoo/raw/main/models"
FILES = {
    "face_detection_yunet_2023mar.onnx": f"{BASE}/face_detection_yunet/face_detection_yunet_2023mar.onnx",
    "face_recognition_sface_2021dec.onnx": f"{BASE}/face_recognition_sface/face_recognition_sface_2021dec.onnx",
}


def main():
    os.makedirs("models", exist_ok=True)
    ok = True
    for name, url in FILES.items():
        dest = os.path.join("models", name)
        if os.path.isfile(dest) and os.path.getsize(dest) > 100_000:
            print(f"✔ {name} already present")
            continue
        print(f"Downloading {name} ...")
        try:
            urllib.request.urlretrieve(url, dest)
        except Exception as exc:
            print(f"✘ failed: {exc}")
            ok = False
            continue
        size = os.path.getsize(dest)
        if size < 100_000:      # a Git-LFS pointer file is only ~130 bytes
            print(f"✘ {name} is only {size} bytes - not a real model file. Download it manually (see header).")
            os.remove(dest)
            ok = False
        else:
            print(f"✔ {name} ({size // 1024} KB)")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
