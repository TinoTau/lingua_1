# Auto-install cuDNN for ONNX Runtime CUDA Support
# This script helps automatically install cuDNN from downloaded archive

Write-Host "cuDNN Auto-Installation Script" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Stop"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

# Check for CUDA installation
$cudaPaths = @(
    "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4",
    "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.1",
    "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v11.8"
)

$cudaPath = $null
$cudaVersion = $null

foreach ($path in $cudaPaths) {
    if (Test-Path $path) {
        $cudaPath = $path
        if ($path -match "v(\d+\.\d+)") {
            $cudaVersion = $matches[1]
        }
        break
    }
}

if (-not $cudaPath) {
    Write-Host "Error: CUDA not found. Please install CUDA first." -ForegroundColor Red
    Write-Host "Download: https://developer.nvidia.com/cuda-downloads" -ForegroundColor Yellow
    exit 1
}

Write-Host "Found CUDA: $cudaPath (Version: $cudaVersion)" -ForegroundColor Green
Write-Host ""

# Check if cuDNN is already installed
$cudnnDlls = Get-ChildItem -Path (Join-Path $cudaPath "bin") -Filter "cudnn64_*.dll" -ErrorAction SilentlyContinue
if ($cudnnDlls) {
    Write-Host "cuDNN is already installed in CUDA directory." -ForegroundColor Green
    Write-Host "  Found DLLs:" -ForegroundColor Gray
    foreach ($dll in $cudnnDlls) {
        Write-Host "    - $($dll.Name)" -ForegroundColor Gray
    }
    Write-Host ""
    Write-Host "Running verification..." -ForegroundColor Cyan
    & "$scriptDir\install_cudnn.ps1"
    exit 0
}

Write-Host "cuDNN is not installed." -ForegroundColor Yellow
Write-Host ""

# Try to find cuDNN archive in common locations
$searchPaths = @(
    "$env:USERPROFILE\Downloads",
    "$env:USERPROFILE\Desktop",
    "C:\Downloads",
    "D:\Downloads",
    "D:\Programs",
    "D:\installer"
)

Write-Host "Searching for cuDNN archive in common locations..." -ForegroundColor Cyan
$foundArchives = @()

$foundFolders = @()

foreach ($searchPath in $searchPaths) {
    if (Test-Path $searchPath) {
        # Search for ZIP archives
        $archives = Get-ChildItem -Path $searchPath -Filter "*cudnn*.zip" -ErrorAction SilentlyContinue
        foreach ($archive in $archives) {
            $foundArchives += $archive
        }
        
        # Search for extracted folders (Windows cuDNN)
        $folders = Get-ChildItem -Path $searchPath -Directory -ErrorAction SilentlyContinue | Where-Object {
            $_.Name -like "*cudnn*" -and 
            (Test-Path (Join-Path $_.FullName "bin")) -and
            (Test-Path (Join-Path $_.FullName "lib")) -and
            (Test-Path (Join-Path $_.FullName "include"))
        }
        foreach ($folder in $folders) {
            $foundFolders += $folder
        }
    }
}

# Check if we found extracted folders first (prefer over archives)
if ($foundFolders.Count -gt 0) {
    Write-Host "Found $($foundFolders.Count) extracted cuDNN folder(s):" -ForegroundColor Green
    for ($i = 0; $i -lt $foundFolders.Count; $i++) {
        $folder = $foundFolders[$i]
        $binFiles = Get-ChildItem -Path (Join-Path $folder.FullName "bin") -Filter "*.dll" -ErrorAction SilentlyContinue
        Write-Host "  [$i] $($folder.Name) ($($binFiles.Count) DLLs)" -ForegroundColor Gray
        Write-Host "      Path: $($folder.FullName)" -ForegroundColor DarkGray
    }
    
    $selectedFolder = $null
    if ($foundFolders.Count -eq 1) {
        $selectedFolder = $foundFolders[0]
        Write-Host ""
        Write-Host "Using extracted folder: $($selectedFolder.FullName)" -ForegroundColor Green
    }
    else {
        Write-Host ""
        $choice = Read-Host "Select folder number (0-$($foundFolders.Count - 1))"
        try {
            $index = [int]$choice
            if ($index -ge 0 -and $index -lt $foundFolders.Count) {
                $selectedFolder = $foundFolders[$index]
            }
            else {
                Write-Host "Invalid selection." -ForegroundColor Red
                exit 1
            }
        }
        catch {
            Write-Host "Invalid input." -ForegroundColor Red
            exit 1
        }
    }
    
    # Use the extracted folder directly
    $cudnnFolder = $selectedFolder.FullName
    $skipExtraction = $true
}
elseif ($foundArchives.Count -gt 0) {
    Write-Host "Found $($foundArchives.Count) cuDNN archive(s):" -ForegroundColor Green
    for ($i = 0; $i -lt $foundArchives.Count; $i++) {
        Write-Host "  [$i] $($foundArchives[$i].Name) ($([math]::Round($foundArchives[$i].Length / 1MB, 2)) MB)" -ForegroundColor Gray
    }
    
    $selectedArchive = $null
    if ($foundArchives.Count -eq 1) {
        $selectedArchive = $foundArchives[0]
        Write-Host ""
        Write-Host "Using: $($selectedArchive.FullName)" -ForegroundColor Green
    }
    else {
        Write-Host ""
        $choice = Read-Host "Select archive number (0-$($foundArchives.Count - 1))"
        try {
            $index = [int]$choice
            if ($index -ge 0 -and $index -lt $foundArchives.Count) {
                $selectedArchive = $foundArchives[$index]
            }
            else {
                Write-Host "Invalid selection." -ForegroundColor Red
                exit 1
            }
        }
        catch {
            Write-Host "Invalid input." -ForegroundColor Red
            exit 1
        }
    }
    $skipExtraction = $false
}
else {
    Write-Host ""
    Write-Host "No cuDNN archive or extracted folder found in common locations." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Please download cuDNN first:" -ForegroundColor Cyan
    Write-Host "  1. Visit: https://developer.nvidia.com/cudnn" -ForegroundColor White
    Write-Host "  2. Login/Register (free)" -ForegroundColor White
    Write-Host "  3. Download: cuDNN 8.9.x for CUDA 12.x (Windows version)" -ForegroundColor White
    Write-Host "  4. Save to: $env:USERPROFILE\Downloads or D:\Programs" -ForegroundColor White
    Write-Host ""
    exit 1
}

# Check administrator privileges
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host ""
    Write-Host "Warning: Administrator privileges may be required." -ForegroundColor Yellow
    Write-Host "If installation fails, please run PowerShell as Administrator." -ForegroundColor Yellow
    Write-Host ""
    # Try to prompt user, but continue automatically if in non-interactive mode
    try {
        $continue = Read-Host "Continue anyway? (Y/N)"
        if ($continue -ne "Y" -and $continue -ne "y") {
            exit 0
        }
    }
    catch {
        Write-Host "Non-interactive mode: Continuing automatically..." -ForegroundColor Cyan
    }
}

# Extract cuDNN if needed
if (-not $skipExtraction) {
    Write-Host ""
    Write-Host "Extracting cuDNN archive..." -ForegroundColor Cyan
    $tempExtractPath = Join-Path $env:TEMP "cudnn_extract_$(Get-Date -Format 'yyyyMMddHHmmss')"

    try {
        Expand-Archive -Path $selectedArchive.FullName -DestinationPath $tempExtractPath -Force
        Write-Host "  ✓ Extracted to: $tempExtractPath" -ForegroundColor Green
    }
    catch {
        Write-Host "  ✗ Failed to extract archive: $_" -ForegroundColor Red
        exit 1
    }

    # Find the actual cuDNN folder (may be nested)
    $cudnnFolder = $null
    $possibleFolders = @(
        $tempExtractPath,
        (Get-ChildItem -Path $tempExtractPath -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*cudnn*" } | Select-Object -First 1)
    )

    foreach ($folder in $possibleFolders) {
        if ($null -eq $folder) { continue }
        $folderPath = if ($folder -is [System.IO.DirectoryInfo]) { $folder.FullName } else { $folder }
        $binPath = Join-Path $folderPath "bin"
        $libPath = Join-Path $folderPath "lib"
        $includePath = Join-Path $folderPath "include"
        
        if ((Test-Path $binPath) -and (Test-Path $libPath) -and (Test-Path $includePath)) {
            $cudnnFolder = $folderPath
            break
        }
    }

    if (-not $cudnnFolder) {
        Write-Host "  ✗ Could not find cuDNN folder structure in extracted archive." -ForegroundColor Red
        Write-Host "  Please extract manually and copy files." -ForegroundColor Yellow
        Remove-Item -Path $tempExtractPath -Recurse -Force -ErrorAction SilentlyContinue
        exit 1
    }

    Write-Host "  ✓ Found cuDNN folder: $cudnnFolder" -ForegroundColor Green
    $tempExtractPath = $tempExtractPath  # Keep for cleanup
}
else {
    $tempExtractPath = $null  # No temp folder to clean up
}

# Copy files to CUDA directory
Write-Host ""
Write-Host "Copying cuDNN files to CUDA directory..." -ForegroundColor Cyan
Write-Host "  Target: $cudaPath" -ForegroundColor Gray

try {
    # Copy DLL files
    $binSource = Join-Path $cudnnFolder "bin"
    $binDest = Join-Path $cudaPath "bin"
    if (Test-Path $binSource) {
        $dllFiles = Get-ChildItem -Path $binSource -Filter "*.dll"
        foreach ($dll in $dllFiles) {
            Copy-Item -Path $dll.FullName -Destination $binDest -Force
            Write-Host "    ✓ $($dll.Name)" -ForegroundColor Green
        }
    }
    else {
        throw "bin folder not found"
    }

    # Copy LIB files
    $libSource = Join-Path $cudnnFolder "lib\x64"
    $libDest = Join-Path $cudaPath "lib\x64"
    if (Test-Path $libSource) {
        $libFiles = Get-ChildItem -Path $libSource -Filter "*.lib"
        foreach ($lib in $libFiles) {
            Copy-Item -Path $lib.FullName -Destination $libDest -Force
            Write-Host "    ✓ $($lib.Name)" -ForegroundColor Green
        }
    }
    else {
        throw "lib\x64 folder not found"
    }

    # Copy header files
    $includeSource = Join-Path $cudnnFolder "include"
    $includeDest = Join-Path $cudaPath "include"
    if (Test-Path $includeSource) {
        $headerFiles = Get-ChildItem -Path $includeSource -Filter "*.h"
        foreach ($header in $headerFiles) {
            Copy-Item -Path $header.FullName -Destination $includeDest -Force
            Write-Host "    ✓ $($header.Name)" -ForegroundColor Green
        }
    }
    else {
        throw "include folder not found"
    }

    Write-Host ""
    Write-Host "✓ cuDNN files copied successfully!" -ForegroundColor Green

}
catch {
    Write-Host ""
    Write-Host "✗ Failed to copy files: $_" -ForegroundColor Red
    Write-Host "  You may need to run PowerShell as Administrator." -ForegroundColor Yellow
    if ($tempExtractPath -and (Test-Path $tempExtractPath)) {
        Remove-Item -Path $tempExtractPath -Recurse -Force -ErrorAction SilentlyContinue
    }
    exit 1
}
finally {
    # Cleanup temp folder if we extracted it
    if ($tempExtractPath -and (Test-Path $tempExtractPath)) {
        Remove-Item -Path $tempExtractPath -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Verify installation
Write-Host ""
Write-Host "Verifying installation..." -ForegroundColor Cyan
& "$scriptDir\install_cudnn.ps1"

Write-Host ""
Write-Host "Installation completed!" -ForegroundColor Green
Write-Host "You can now restart the Node Inference service to use GPU acceleration for VAD." -ForegroundColor Cyan
