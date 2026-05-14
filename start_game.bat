@echo off
REM 啟動手語辨識遊戲
REM 同時啟動前端服務器 (5000) 和後端 Ensemble 服務器 (5001)

echo.
echo ======================================
echo 🎮 手語辨識遊戲系統啟動
echo ======================================
echo.

REM 檢查 Python 是否已安裝
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ 錯誤: 找不到 Python
    echo 請確保已安裝 Python 3.8+
    pause
    exit /b 1
)

echo ✅ Python 已安裝
echo.

REM 在新視窗中啟動後端 Ensemble 服務器 (port 5001)
echo 🚀 啟動後端 Ensemble 服務器 (port 5001)...
start "Ensemble Server (Port 5001)" cmd /k python ensemble_server.py

REM 等待後端服務器啟動
timeout /t 3 /nobreak

REM 在新視窗中啟動前端服務器 (port 5000)
echo 🚀 啟動前端服務器 (port 5000)...
start "Game Server (Port 5000)" cmd /k python server.py

echo.
echo ======================================
echo ✅ 系統已啟動
echo ======================================
echo.
echo 📊 前端服務器: http://localhost:5000
echo 🤖 後端 Ensemble: http://localhost:5001
echo.
echo 💡 提示: 打開瀏覽器造訪 http://localhost:5000
echo.
pause
