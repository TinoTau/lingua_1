@echo off
REM 下载 Faster Whisper Large-v3 模型到本地
REM 使用当前目录的虚拟环境

echo ========================================
echo 下载 Faster Whisper Large-v3 模型
echo ========================================
echo.

REM 检查虚拟环境是否存在
if not exist "venv\Scripts\activate.bat" (
    echo 错误: 虚拟环境不存在，请先创建虚拟环境
    echo 运行: python -m venv venv
    pause
    exit /b 1
)

REM 激活虚拟环境并运行下载脚本
call venv\Scripts\activate.bat
python download_model.py --model Systran/faster-whisper-large-v3 --output models/asr/faster-whisper-large-v3

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo 模型下载完成！
    echo ========================================
) else (
    echo.
    echo ========================================
    echo 模型下载失败！
    echo ========================================
)

pause

