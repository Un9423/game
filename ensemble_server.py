"""
ensemble_server.py
==================
5-Fold 集成推理服务器
加载 5 个 Fold 模型，使用投票集成进行预测
"""

import torch
import torch.nn as nn
import numpy as np
import json
import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from pathlib import Path

# ============================================
# 1. 模型架构（与 train_transformer.py 一致）
# ============================================
class CNNTransformerTSL(nn.Module):
    def __init__(self, input_dim=66, num_classes=50, hidden_dim=128, num_layers=2, dropout=0.5):
        super().__init__()
        
        # CNN 層
        self.cnn = nn.Sequential(
            nn.Conv1d(input_dim, 128, kernel_size=3, stride=1, padding=1),
            nn.BatchNorm1d(128),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Conv1d(128, hidden_dim, kernel_size=3, stride=1, padding=1),
            nn.BatchNorm1d(hidden_dim),
            nn.ReLU(),
            nn.Dropout(dropout)
        )
        
        # 位置編碼
        self.pos_encoder = nn.Parameter(torch.randn(1, 30, hidden_dim))
        
        # Transformer 编码层
        encoder_layers = nn.TransformerEncoderLayer(
            d_model=hidden_dim, 
            nhead=8,
            dim_feedforward=hidden_dim * 2,
            dropout=dropout,
            batch_first=True
        )
        self.transformer = nn.TransformerEncoder(encoder_layers, num_layers=num_layers)
        
        # 全連接層
        self.fc = nn.Sequential(
            nn.Linear(hidden_dim, 128), 
            nn.ReLU(),
            nn.Dropout(0.5),
            nn.Linear(128, num_classes)
        )

    def forward(self, x):
        # CNN: (Batch, Frames, Dim) -> (Batch, Dim, Frames)
        x = self.cnn(x.transpose(1, 2)).transpose(1, 2)
        
        # 加入 Positional Encoding
        if x.size(1) <= self.pos_encoder.size(1):
            x = x + self.pos_encoder[:, :x.size(1), :]
        
        # Transformer: (Batch, Frames, hidden_dim)
        x = self.transformer(x)
        
        # 結合 Mean 與 Max Pooling
        avg_pool = x.mean(dim=1)
        max_pool, _ = x.max(dim=1)
        return self.fc(avg_pool + max_pool)

# ============================================
# 2. 初始化 Flask 應用
# ============================================
app = Flask(__name__)
CORS(app)  # 允許跨域請求

DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
print(f"使用設備: {DEVICE}")

# ============================================
# 3. 加載 5 個 Fold 模型
# ============================================
OUTPUT_DIR = "train_V21_Transformer_66(with asl weight + new video + sliding window + K-fold)"

# 標籤映射和超參數優先從根目錄讀取
LABEL_MAP_PATH = "label_map.json"  # 項目根目錄
BEST_PARAMS_PATH = "best_params.json"  # 或從訓練文件夾讀取

# 如果根目錄沒有，退而求其次從訓練文件夾讀取
if not os.path.exists(LABEL_MAP_PATH):
    LABEL_MAP_PATH = os.path.join(OUTPUT_DIR, "label_map.json")

# 讀取超參數
with open(BEST_PARAMS_PATH, 'r', encoding='utf-8') as f:
    best_params = json.load(f)

print(f"✅ 加載超參數: {best_params}")

# 讀取標籤映射
with open(LABEL_MAP_PATH, 'r', encoding='utf-8') as f:
    label_map = json.load(f)

num_classes = len(label_map)
print(f"✅ 加載標籤映射: {num_classes} 個詞彙")

# 加載 5 個 Fold 模型
models = []
for fold_idx in range(1, 6):
    fold_dir = os.path.join(OUTPUT_DIR, f"Fold_{fold_idx}")
    model_path = os.path.join(fold_dir, f"best_model.pth")
    
    if not os.path.exists(model_path):
        print(f"⚠️ 警告: 找不到 Fold {fold_idx} 模型: {model_path}")
        continue
    
    # 創建模型
    model = CNNTransformerTSL(
        input_dim=66,
        num_classes=num_classes,
        hidden_dim=best_params['hidden_dim'],
        num_layers=best_params['num_layers'],
        dropout=best_params['dropout']
    ).to(DEVICE)
    
    # 加載權重
    try:
        state_dict = torch.load(model_path, map_location=DEVICE, weights_only=True)
        model.load_state_dict(state_dict)
        model.eval()
        models.append(model)
        print(f"✅ 加載 Fold {fold_idx} 模型成功")
    except Exception as e:
        print(f"❌ Fold {fold_idx} 加載失敗: {e}")

if not models:
    print("❌ 錯誤: 沒有成功加載任何模型！")
    exit(1)

print(f"✅ 成功加載 {len(models)} 個 Fold 模型")

# ============================================
# 4. Ensemble 推理函數
# ============================================
def ensemble_predict(features_tensor):
    """
    使用 5 個 Fold 模型進行集成預測
    
    Args:
        features_tensor: [B, T, D] 的 PyTorch tensor
    
    Returns:
        pred_label, confidence, all_logits
    """
    with torch.no_grad():
        all_logits = []
        
        for model in models:
            logits = model(features_tensor)  # [B, num_classes]
            all_logits.append(logits.cpu().numpy())
        
        # 平均 logits（集成策略）
        avg_logits = np.mean(all_logits, axis=0)  # [B, num_classes]
        
        # 取最大值
        pred_idx = np.argmax(avg_logits[0])
        confidence = float(avg_logits[0, pred_idx])
        pred_label = label_map[str(pred_idx)]
        
        return pred_label, confidence, avg_logits[0]

# ============================================
# 5. API 端點
# ============================================

@app.route("/")
def index():
    """測試端點"""
    return {
        "status": "✅ Ensemble 服務器運行中",
        "models_loaded": len(models),
        "num_classes": num_classes,
        "endpoint": "/predict"
    }

@app.route("/predict", methods=["POST"])
def predict():
    """
    接收前端的特徵，使用集成模型進行預測
    
    期望的 JSON 格式:
    {
        "features": [[...], [...], ...],  // [30, 66] 的陣列
    }
    
    返回:
    {
        "label": "詞彙",
        "confidence": 0.95,
        "all_logits": [...],
        "status": "success"
    }
    """
    try:
        data = request.json
        
        if "features" not in data:
            return {"error": "缺少 features 欄位", "status": "error"}, 400
        
        features = np.array(data["features"], dtype=np.float32)
        
        # 驗證形狀
        if features.shape != (30, 66):
            return {
                "error": f"特徵形狀錯誤: {features.shape}，期望 (30, 66)",
                "status": "error"
            }, 400
        
        # 轉換為 tensor 並添加 batch 維度
        features_tensor = torch.from_numpy(features).unsqueeze(0).to(DEVICE)  # [1, 30, 66]
        
        # 集成推理
        pred_label, confidence, all_logits = ensemble_predict(features_tensor)
        
        return {
            "label": pred_label,
            "confidence": float(confidence),
            "all_logits": all_logits.tolist(),
            "models_used": len(models),
            "status": "success"
        }
    
    except Exception as e:
        print(f"❌ 推理錯誤: {e}")
        return {
            "error": str(e),
            "status": "error"
        }, 500

@app.route("/health")
def health():
    """健康檢查端點"""
    return {
        "status": "ok",
        "models_loaded": len(models),
        "device": str(DEVICE)
    }

# ============================================
# 6. 啟動服務器
# ============================================
if __name__ == "__main__":
    print("\n" + "="*50)
    print("🚀 5-Fold Ensemble 推理服務器啟動")
    print("="*50)
    print(f"📊 已加載 {len(models)} 個模型")
    print(f"🎯 支持 {num_classes} 個詞彙")
    print(f"⚙️ 推理服務: http://localhost:5001/predict")
    print("="*50 + "\n")
    
    # 運行 Flask 應用（端口 5001 以避免與主服務器衝突）
    app.run(host="0.0.0.0", port=5001, debug=False, threaded=True)
