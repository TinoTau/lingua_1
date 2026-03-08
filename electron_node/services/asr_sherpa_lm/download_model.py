"""
下载 Omnilingual CTC 300M int8 模型（1600+ 语言）到 models/omnilingual_ctc_300m_int8/。
用法: python download_model.py
"""
import os
import shutil
import sys
import tarfile
import urllib.request

# https://k2-fsa.github.io/sherpa/onnx/omnilingual-asr/models.html
URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-omnilingual-asr-1600-languages-300M-ctc-int8-2025-11-12.tar.bz2"
EXTRACTED_NAME = "sherpa-onnx-omnilingual-asr-1600-languages-300M-ctc-int8-2025-11-12"
TARGET_DIR_NAME = "omnilingual_ctc_300m_int8"


def download_file(url: str, path: str, force: bool = False):
    if os.path.isfile(path) and not force:
        sz_mb = os.path.getsize(path) // (1024 * 1024)
        print(f"Skip (exists, {sz_mb}MB): {path}")
        return
    tmp_path = path + ".tmp"
    print(f"Downloading {url} -> {path}")
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=300) as resp:
        total = int(resp.headers.get("content-length", 0) or 0)
        chunk_size = 8192
        with open(tmp_path, "wb") as f:
            done = 0
            while True:
                chunk = resp.read(chunk_size)
                if not chunk:
                    break
                f.write(chunk)
                done += len(chunk)
                if total > 0 and done % (10 * 1024 * 1024) < chunk_size:
                    print(f"  {done // (1024*1024)} MB / {total // (1024*1024)} MB")
    if os.path.isfile(path):
        os.remove(path)
    os.rename(tmp_path, path)
    print(f"  OK ({os.path.getsize(path) // (1024 * 1024)} MB)")


def main():
    service_dir = os.path.dirname(os.path.abspath(__file__))
    models_dir = os.path.join(service_dir, "models")
    target_dir = os.path.join(models_dir, TARGET_DIR_NAME)
    archive_path = os.path.join(models_dir, os.path.basename(URL))

    if os.path.isdir(target_dir) and os.path.isfile(os.path.join(target_dir, "model.int8.onnx")):
        print(f"Model already present at {target_dir}")
        return

    download_file(URL, archive_path)

    extracted_path = os.path.join(models_dir, EXTRACTED_NAME)
    print(f"Extracting to {extracted_path} ...")
    with tarfile.open(archive_path, "r:bz2") as tf:
        tf.extractall(models_dir)

    if os.path.isdir(target_dir):
        shutil.rmtree(target_dir)
    os.rename(extracted_path, target_dir)
    if os.path.isfile(archive_path):
        os.remove(archive_path)

    print(f"Done. Model dir: {os.path.abspath(target_dir)}")


if __name__ == "__main__":
    main()
    sys.exit(0)
