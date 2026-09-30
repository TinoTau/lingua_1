# -*- coding: utf-8 -*-
import json
import os
import subprocess
import time
from pathlib import Path

REPO = Path(r"D:/Programs/github/lingua_1")
H = REPO / "training/model3_dataset/offline_harness/stage2_materialize.cjs"
E = REPO / "electron_node/electron-node/node_modules/electron/dist/electron.exe"
req = REPO / "training/model3_dataset/offline_harness/_bench_req.jsonl"
rows = [
    {
        "id": f"b{i}",
        "currentText": "麻烦你帮我看看附近有没有停车位",
        "referenceText": "麻烦你帮我看看附近有没有停车位",
        "corruptions": [],
    }
    for i in range(5)
]
req.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
env = os.environ.copy()
env["ELECTRON_RUN_AS_NODE"] = "1"
env["PROJECT_ROOT"] = str(REPO)
out = REPO / "training/model3_dataset/offline_harness/_bench_out.txt"
err = REPO / "training/model3_dataset/offline_harness/_bench_err.txt"
cmd = f'type "{req}" | "{E}" "{H}" > "{out}" 2> "{err}"'
t0 = time.time()
subprocess.run(cmd, shell=True, cwd=str(REPO / "electron_node/electron-node"), env=env)
print("elapsed", round(time.time() - t0, 2))
lines = [l for l in out.read_text(encoding="utf-8", errors="replace").splitlines() if l.startswith("{")]
print("n", len(lines), "ok", sum(1 for l in lines if '"ok":true' in l.replace(" ", "")))
