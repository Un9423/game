#!/bin/bash
# 啟動手語辨識遊戲
# 同時啟動前端服務器 (5000) 和後端 Ensemble 服務器 (5001)

echo ""
echo "======================================"
echo "🎮 手語辨識遊戲系統啟動"
echo "======================================"
echo ""

# 檢查 Python 是否已安裝
if ! command -v python3 &> /dev/null; then
    echo "❌ 錯誤: 找不到 Python3"
    echo "請確保已安裝 Python 3.8+"
    exit 1
fi

echo "✅ Python 已安裝"
echo ""

# 啟動後端 Ensemble 服務器 (port 5001)
echo "🚀 啟動後端 Ensemble 服務器 (port 5001)..."
python3 ensemble_server.py &
ENSEMBLE_PID=$!

# 等待後端服務器啟動
sleep 3

# 啟動前端服務器 (port 5000)
echo "🚀 啟動前端服務器 (port 5000)..."
python3 server.py &
SERVER_PID=$!

echo ""
echo "======================================"
echo "✅ 系統已啟動"
echo "======================================"
echo ""
echo "📊 前端服務器: http://localhost:5000"
echo "🤖 後端 Ensemble: http://localhost:5001"
echo ""
echo "💡 提示: 打開瀏覽器造訪 http://localhost:5000"
echo ""

# 等待用戶中斷
trap "kill $ENSEMBLE_PID $SERVER_PID 2>/dev/null; exit" INT TERM

wait
