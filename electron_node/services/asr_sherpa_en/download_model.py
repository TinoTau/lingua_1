# Download sherpa-onnx NeMo CTC En Conformer small int8（决策推荐，16k 友好）到 models/nemo_ctc_en_conformer_small/
# Usage: python download_model.py
import os
import shutil
import sys
import tarfile
import urllib.request

URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-ctc-en-conformer-small.tar.bz2"
EXTRACTED_NAME = "sherpa-onnx-nemo-ctc-en-conformer-small"
TARGET_DIR_NAME = "nemo_ctc_en_conformer_small"


def download_file(url: str, path: str, force: bool = False):
    if os.path.isfile(path) and not force:
        print("Skip (exists):", path)
        return
    tmp_path = path + ".tmp"
    print("Downloading", url, "->", path)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=300) as resp:
        with open(tmp_path, "wb") as f:
            while True:
                chunk = resp.read(8192)
                if not chunk:
                    break
                f.write(chunk)
    if os.path.isfile(path):
        os.remove(path)
    os.rename(tmp_path, path)
    print("OK", os.path.getsize(path) // (1024 * 1024), "MB")


def main():
    service_dir = os.path.dirname(os.path.abspath(__file__))
    models_dir = os.path.join(service_dir, "models")
    target_dir = os.path.join(models_dir, TARGET_DIR_NAME)
    archive_path = os.path.join(models_dir, os.path.basename(URL))

    if os.path.isdir(target_dir) and os.path.isfile(os.path.join(target_dir, "model.int8.onnx")):
        print("Model already present at", target_dir)
        return

    download_file(URL, archive_path)

    extracted_path = os.path.join(models_dir, EXTRACTED_NAME)
    print("Extracting to", extracted_path)
    with tarfile.open(archive_path, "r:bz2") as tf:
        tf.extractall(models_dir)

    if os.path.isdir(target_dir):
        shutil.rmtree(target_dir)
    os.rename(extracted_path, target_dir)
    if os.path.isfile(archive_path):
        os.remove(archive_path)

    print("Done. Model dir:", os.path.abspath(target_dir))


if __name__ == "__main__":
    main()
    sys.exit(0)
