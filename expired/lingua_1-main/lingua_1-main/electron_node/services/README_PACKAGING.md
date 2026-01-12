# Service Packaging Guide

## Overview

Service packages now **MUST include model files** to enable "unpack and run" workflow:
1. Package services with code + models
2. Upload to Model Hub
3. Users download complete packages
4. Auto-extract and use immediately

## Quick Start

### Option 1: Automated Script (Recommended)

```powershell
cd electron_node\services
.\package_services_with_models.ps1
```

This script will:
- Package all services with models included
- Create service.json for each service
- Deploy to Model Hub automatically
- Show progress and summary

**Warning:** Packaging node-inference with models (~11GB) will take a LONG time!

### Option 2: Manual Packaging

See `MANUAL_PACKAGING_GUIDE.md` for step-by-step commands for each service.

## Package Structure

Each service package contains:
```
service.zip
├── service.json          # Service metadata
├── {service_code}.py     # Service code (Python services)
├── inference-service.exe  # Executable (Rust services)
├── src/                  # Source files (Rust services)
├── models/               # Model files (if applicable)
│   ├── asr/
│   ├── nmt/
│   ├── tts/
│   └── ...
├── requirements.txt      # Python dependencies
└── README.md            # Documentation
```

## Service-Specific Notes

### Python Services (nmt-m2m100, piper-tts, your-tts)
- Models are typically downloaded at runtime from HuggingFace
- If local models exist, they will be included
- Package size: ~0.01 MB (code only)

### Node Inference (Rust)
- **MUST include models directory** (~11GB)
- Contains all ASR, NMT, TTS, VAD models
- Package size: ~11GB (code + executable + models)
- Packaging will take 30+ minutes

## Deployment

After packaging, services are automatically deployed to:
```
central_server/model-hub/models/services/
├── {service_id}/
│   └── 1.0.0/
│       └── windows-x64/
│           └── service.zip
```

## Verification

Check Model Hub API:
```powershell
# List all services
curl http://localhost:5000/api/services

# Get specific service
curl http://localhost:5000/api/services/node-inference/1.0.0/windows-x64
```

## Troubleshooting

### Issue: Packaging takes too long
- **Solution:** This is normal for node-inference (~11GB models)
- Be patient, it may take 30+ minutes

### Issue: Out of disk space
- **Solution:** Ensure at least 15GB free space
- Models are ~11GB, ZIP may be ~8-10GB compressed

### Issue: Models not found
- **Solution:** Check that `node-inference/models/` directory exists
- Models should be in `electron_node/services/node-inference/models/`

## Next Steps

After packaging:
1. Verify packages in Model Hub
2. Test download and extraction
3. Update node service package manager to handle extraction
4. Test service startup after extraction

