// app.js: 台灣手語學習遊戲 Web 版
// 使用 ONNX Transformer 模型進行手語辨識

// 全局错误处理 - 防止页面当机
window.addEventListener('error', (e) => {
  console.error('Global error:', e.message, e.filename, e.lineno);
  statusEl.textContent = `狀態: 錯誤 - ${e.message}`;
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
  statusEl.textContent = `狀態: 異步錯誤 - ${e.reason}`;
});

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const scoreEl = document.getElementById('score');
const lifeEl = document.getElementById('life');
const video = document.getElementById('video');
const gestureEl = document.getElementById('gesture');
const progressEl = document.getElementById('progress');
const startBtn = document.getElementById('start-btn');
const pauseBtn = document.getElementById('pause-btn');

let WIDTH = 600;
let HEIGHT = 800;

function resizeCanvasToWindow() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  WIDTH = canvas.width;
  HEIGHT = canvas.height;
}
window.addEventListener('resize', resizeCanvasToWindow);
resizeCanvasToWindow();

// -----------------------
// 遊戲狀態
// -----------------------
let score = 0;
let bombs = [];
let frameCounter = 0;

const HOUSE_COUNT = 10;
const HOUSE_WIDTH = 120;
const HOUSE_HEIGHT = 80;
const HOUSE_MARGIN_BOTTOM = 20;
let houses = [];

let plane = null;
let totalBombsDropped = 0;
const MIN_ACTIVE_BOMBS = 2;
const TARGET_BOMBS = 15;
let minBombReplenishDelay = 150;
let minBombReplenishCounter = 100;

let gameOver = false;
let win = false;
let gameStarted = false;
let gamePaused = false;

let isProcessingFrame = false;

// -----------------------
// ONNX 模型辨識系統
// -----------------------
let ortSession = null;
let labelMap = null;
let predictionBuffer = [];
const PREDICTION_BUFFER_SIZE = 5;   // 隊友規格：紀錄最近 5 次預測
const STABLE_COUNT = 4;             // 隊友規格：5 次中至少 4 次一致
const CONFIDENCE_THRESHOLD = 0.75;  // 置信度門檻 (現在是 Softmax 機率)
const MODEL_FRAMES = 30;
const FEATURE_DIM = 138;
let modelLoaded = false;

// Debug: 儲存最近一次推論的完整結果供畫面顯示
let lastDebugInfo = null;

// 詞彙難度對照表（可自由調整）
const WORD_DIFFICULTY = {
  '棒': 1, '謝謝': 1, '高興': 1, '喜歡': 1,
  '名字': 2, '對不起': 2, '生氣': 2, '沒關係': 2,
  '不客氣': 3, '飛機': 3,
};

let fullVocabulary = [];
let currentVocabulary = [{ text: '載入中...', difficulty: 1 }];
let gesturesLoaded = false;

function updateDifficultySelection() {
  const diffSelect = document.getElementById('difficulty-select');
  const selectedDifficulty = diffSelect ? diffSelect.value : 'all';

  if (selectedDifficulty === 'all') {
    currentVocabulary = fullVocabulary.length > 0 ? [...fullVocabulary] : [{ text: '無資料', difficulty: 1 }];
  } else {
    const diffInt = parseInt(selectedDifficulty, 10);
    const filtered = fullVocabulary.filter(v => v.difficulty === diffInt);
    currentVocabulary = filtered.length > 0 ? filtered : (fullVocabulary.length > 0 ? [...fullVocabulary] : [{ text: '無資料', difficulty: 1 }]);
  }
}

const difficultySelect = document.getElementById('difficulty-select');
if (difficultySelect) {
  difficultySelect.addEventListener('change', updateDifficultySelection);
}

async function initModel() {
  try {
    statusEl.textContent = '狀態: 正在載入 AI 模型...';
    console.log('Starting model load...');
    const startTime = performance.now();
    
    ortSession = await ort.InferenceSession.create('./tsl_model.onnx?v=20260413');
    const modelLoadTime = (performance.now() - startTime) / 1000;
    console.log(`✓ ONNX model loaded in ${modelLoadTime.toFixed(2)}s`);
    
    const response = await fetch('./10_label_map.json?v=20260413');
    labelMap = await response.json();
    console.log('✓ Label map loaded', labelMap);

    fullVocabulary = Object.entries(labelMap).map(([idx, text]) => ({
      text,
      difficulty: WORD_DIFFICULTY[text] || 1,
    }));
    currentVocabulary = [...fullVocabulary];
    modelLoaded = true;
    gesturesLoaded = true;
    updateDifficultySelection();
    statusEl.textContent = '狀態: AI 模型載入完成';
  } catch (e) {
    console.error('Model init failed:', e);
    statusEl.textContent = '狀態: AI 模型載入失敗 - ' + e.message;
  }
}

// -----------------------
// 圖片資源
// -----------------------
const backgroundImg = new Image();
backgroundImg.src = 'background.png';
const houseImg = new Image();
houseImg.src = 'house.png';
const planeImg = new Image();
planeImg.src = 'plane.png';
const bombImg = new Image();
bombImg.src = 'bomb.png';
const explosionImg = new Image();
explosionImg.src = 'explosion.png';

function randomVocab() {
  return currentVocabulary[Math.floor(Math.random() * currentVocabulary.length)];
}

// -----------------------
// 飛機與炸彈
// -----------------------
class Plane {
  constructor() {
    this.width = 120; this.height = 50;
    this.x = 0; this.y = 50;
    this.speed = 3; this.direction = 1;
    this.dropCooldown = 150;
  }
  move() {
    this.x += this.speed * this.direction;
    // 飛機碰到右上角的攝像頭區域時回頭 (320×180 尺寸，位於右上角)
    const cameraWidth = 320;
    const videoAreaLeft = WIDTH - cameraWidth - 10;
    if (this.x + this.width >= videoAreaLeft) { this.x = videoAreaLeft - this.width; this.direction = -1; }
    else if (this.x <= 0) { this.x = 0; this.direction = 1; }
    if (this.dropCooldown > 0) this.dropCooldown -= 1;
  }
  maybeDropBomb() {
    if (this.dropCooldown <= 0) {
      this.dropCooldown = Math.floor(180 + Math.random() * 120);
      const baseX = this.x + this.width / 2 - Bomb.WIDTH / 2;
      const offset = (Math.random() * 60) - 30;
      return new Bomb(Math.max(0, Math.min(WIDTH - Bomb.WIDTH, baseX + offset)), this.y + this.height - 30);
    }
    return null;
  }
  render(ctx) {
    try {
      if (planeImg.complete && planeImg.naturalWidth > 0) {
        const imgH = this.height;
        const imgW = (planeImg.naturalWidth / planeImg.naturalHeight) * imgH;
        const drawX = this.x + (this.width - imgW) / 2;
        
        // 防價：確保所有座標有效
        if (isNaN(drawX) || isNaN(imgW) || isNaN(imgH)) {
          console.warn('Plane render: 無效座標計算', {drawX, imgW, imgH});
          return;
        }
        
        ctx.save();
        if (this.direction === -1) { 
          ctx.translate(drawX + imgW / 2, 0); 
          ctx.scale(-1, 1); 
          ctx.translate(-(drawX + imgW / 2), 0); 
        }
        ctx.drawImage(planeImg, drawX, this.y, imgW, imgH);
        ctx.restore();
      } else {
        ctx.fillStyle = '#999';
        ctx.fillRect(this.x, this.y, this.width, this.height);
      }
    } catch (e) {
      console.error('Plane render error:', e);
      // 備用：畫一個簡單的矩形
      try {
        ctx.fillStyle = '#999';
        ctx.fillRect(this.x, this.y, this.width, this.height);
      } catch (e2) {
        console.error('Plane fallback render error:', e2);
      }
    }
  }
}

class Bomb {
  static WIDTH = 100; static HEIGHT = 100;
  static SPEED = 1.5; static MAX_SHRINK_TIME = 15;

  constructor(x, y) {
    this.x = x ?? Math.random() * (WIDTH - Bomb.WIDTH);
    this.y = y ?? -Bomb.HEIGHT;
    this.word = randomVocab().text;
    this.shrinking = false; this.shrinkTimer = 0;
    this.exploding = false; this.explosionTimer = 0;
    this.shouldExplode = false; this.finished = false; this.impactResolved = false;
    this.houseDamageApplied = false;  // 標記房子傷害是否已應用
  }
  fall() { if (!this.shrinking && !this.exploding) this.y += Bomb.SPEED; }
  startShrink(shouldExplode = false) {
    if (this.exploding) return;
    this.shrinking = true; this.shrinkTimer = 0;
    this.shouldExplode = shouldExplode; this.impactResolved = true;
  }
  render(ctx) {
    if (this.finished) return;
    let drawX = this.x, drawY = this.y, drawW = Bomb.WIDTH, drawH = Bomb.HEIGHT;

    if (this.shrinking) {
      this.shrinkTimer += 1;
      const ratio = 1 - this.shrinkTimer / Bomb.MAX_SHRINK_TIME;
      if (ratio > 0) {
        drawW = Bomb.WIDTH * ratio; drawH = Bomb.HEIGHT * ratio;
        drawX = this.x + (Bomb.WIDTH - drawW) / 2; drawY = this.y + (Bomb.HEIGHT - drawH) / 2;
      } else {
        this.shrinking = false;
        if (this.shouldExplode) { this.exploding = true; this.explosionTimer = 0; }
        else { this.finished = true; }
      }
    }
    if (this.exploding) {
      this.explosionTimer += 1;
      const size = Bomb.WIDTH * 1.3;
      const ex = this.x + (Bomb.WIDTH - size) / 2, ey = this.y + (Bomb.HEIGHT - size) / 2;
      
      // 防價：確保所有座標都有效
      if (isNaN(ex) || isNaN(ey) || isNaN(size)) {
        console.warn('Bomb explosion: 無效座標', {ex, ey, size});
        this.exploding = false; this.finished = true; return;
      }
      
      try {
        if (explosionImg.complete && explosionImg.naturalWidth > 0) ctx.drawImage(explosionImg, ex, ey, size, size);
        else { ctx.fillStyle = 'orange'; ctx.beginPath(); ctx.arc(this.x + Bomb.WIDTH / 2, this.y + Bomb.HEIGHT / 2, size / 2, 0, Math.PI * 2); ctx.fill(); }
      } catch (e) {
        console.error('Bomb explosion draw error:', e);
      }
      
      if (this.explosionTimer >= 10) { this.exploding = false; this.finished = true; }
      return;
    }
    
    // 防價：確保炸彈座標有效
    if (isNaN(drawX) || isNaN(drawY) || isNaN(drawW) || isNaN(drawH)) {
      console.warn('Bomb render: 無效座標', {drawX, drawY, drawW, drawH});
      return;
    }
    
    try {
      if (bombImg.complete && bombImg.naturalWidth > 0) ctx.drawImage(bombImg, drawX, drawY, drawW, drawH);
      else { ctx.fillStyle = '#CC0000'; ctx.fillRect(drawX, drawY, drawW, drawH); }
      ctx.fillStyle = '#FFF'; ctx.font = '24px Arial'; ctx.textAlign = 'center';
      ctx.fillText(this.word, this.x + Bomb.WIDTH / 2, this.y + Bomb.HEIGHT / 2 + 10);
    } catch (e) {
      console.error('Bomb render draw error:', e);
    }
  }
}

// -----------------------
// 手勢偵測系統（ONNX 模型）
// -----------------------
let lastHandLandmarks = null;
let lastVideoFrame = null;
let handMissFrameCount = 0;  // 計數連續缺失的幀數
const HAND_PERSISTENCE_FRAMES = 30;  // 手部節點持續顯示 30 幀（約 0.5 秒）後才清除

let featureBuffer = [];
const FEATURE_BUFFER_MAX = 30;
const MIN_FRAMES_FOR_INFERENCE = 30;
let inferenceCooldown = 0;
let isInferring = false;
let handMissCount = 0;
let handWasPresent = false;

function resetGestureSequence() {
  featureBuffer = [];
  predictionBuffer = [];
  inferenceCooldown = 0;
  isInferring = false;
  handWasPresent = false;
  handMissCount = 0;
  handMissFrameCount = 0;  // 重置手部節點持久化計數
  if (progressEl) progressEl.textContent = '進度: 等待手勢...';
}

async function runInference() {
  if (!ortSession || isInferring || featureBuffer.length < MIN_FRAMES_FOR_INFERENCE) return null;
  if (!labelMap) {
    console.warn('runInference: labelMap 尚未加載');
    return null;
  }
  
  isInferring = true;
  try {
    const inputData = prepareModelInput(featureBuffer, MODEL_FRAMES);
    
    // 防價：驗證輸入數據
    if (!inputData || inputData.length === 0) {
      console.warn('runInference: 無效的輸入數據');
      isInferring = false;
      return null;
    }
    
    const tensor = new ort.Tensor('float32', inputData, [1, MODEL_FRAMES, FEATURE_DIM]);
    const results = await ortSession.run({ input: tensor });
    const output = Array.from(results.output.data);

    // 防價：檢查輸出長度
    if (!output || output.length !== 10) {
      console.warn('runInference: 無效的模型輸出', output);
      isInferring = false;
      return null;
    }

    // 計算 Softmax 以獲得真實信心度 (機率)
    const expOut = output.map(x => Math.exp(x - Math.max(...output)));  // 減去max以防止溢出
    const sumExp = expOut.reduce((a, b) => a + b, 0);
    
    // 防價：驗證 Softmax 計算
    if (sumExp <= 0 || !isFinite(sumExp)) {
      console.warn('runInference: Softmax 計算失敗，sumExp=', sumExp);
      isInferring = false;
      return null;
    }
    
    const probabilities = expOut.map(x => {
      const prob = x / sumExp;
      // 確保機率是有效的數字 (0-1)
      if (!isFinite(prob)) {
        console.warn('runInference: 無限或 NaN 的機率值，設為0', {expOut: x, sumExp, prob});
        return 0;
      }
      return Math.max(0, Math.min(1, prob));  // 夾到 [0, 1]
    });

    // 取得當前難度允許的詞彙清單
    const activeWords = new Set(currentVocabulary.map(v => v.text));

    // 找最高機率（只在允許的類別中）
    let maxProb = -1;  // 改用 -1 作為無效標記，而不是 -Infinity
    let predIdx = -1;
    for (let i = 0; i < probabilities.length; i++) {
      const word = labelMap[String(i)];
      if (word && activeWords.has(word) && probabilities[i] > maxProb) {
        maxProb = probabilities[i];
        predIdx = i;
      }
    }
    
    const predLabel = (predIdx >= 0) ? labelMap[String(predIdx)] : null;
    
    // 防價：確保 maxProb 是有效數字
    if (!isFinite(maxProb) || maxProb < 0) {
      console.warn('runInference: 無效的最大機率', maxProb);
      isInferring = false;
      return null;
    }

    // Debug: 記錄所有類別的機率
    const allPreds = [];
    for (let i = 0; i < probabilities.length; i++) {
      const word = labelMap[String(i)] || `?${i}`;
      const active = activeWords.has(word);
      const prob = probabilities[i];
      // 防價：確保 prob 是有效數字
      if (!isFinite(prob)) {
        console.warn(`runInference: 類別 ${i} 的機率無效:`, prob);
        allPreds.push({ label: word, prob: 0, active });
      } else {
        allPreds.push({ label: word, prob: prob, active });
      }
    }
    allPreds.sort((a, b) => b.prob - a.prob);
    
    // 防價：在構建 lastDebugInfo 前驗證所有值
    const top5Preds = allPreds.filter(p => p.active).slice(0, 5);
    lastDebugInfo = {
      top5: top5Preds.map(p => ({
        label: p.label, 
        prob: p.prob  // 保留原始數字，不要轉換為字符串
      })),
      bufferLen: featureBuffer.length,
      rawProbs: probabilities,  // 保留原始機率陣列，不要轉換為字符串
    };
    const topActive = allPreds.filter(p => p.active).slice(0, 3);
    const topStr = topActive.map(p => {
      const prob = isFinite(p.prob * 100) ? (p.prob * 100).toFixed(1) : '無效';
      return `${p.label}(${prob}%)`;
    }).join(', ');
    console.log(`[推論] 緩衝=${featureBuffer.length}幀 | Top(該難度): ${topStr}`);

    isInferring = false;
    return predLabel ? { label: predLabel, confidence: maxProb } : null;
  } catch (e) {
    console.error('Inference error:', e);
    isInferring = false;
    return null;
  }
}

function processInferenceResult(result) {
  if (!result || !isFinite(result.confidence)) {
    console.warn('processInferenceResult: 無效的結果', result);
    return;
  }
  
  const confidencePercent = isFinite(result.confidence * 100) ? (result.confidence * 100).toFixed(1) : '無效';
  if (gestureEl) gestureEl.textContent = `偵測: ${result.label} (${confidencePercent}%)`;

  // Softmax 機率門檻 0.75
  if (result.confidence < CONFIDENCE_THRESHOLD) {
    const thresholdPercent = (CONFIDENCE_THRESHOLD * 100).toFixed(0);
    console.log(`[過濾] ${result.label} 機率=${confidencePercent}% < 門檻 ${thresholdPercent}%`);
    return;
  }

  // 連續判定邏輯 (5 次中至少 4 次一致)
  predictionBuffer.push(result.label);
  if (predictionBuffer.length > PREDICTION_BUFFER_SIZE) predictionBuffer.shift();

  const counts = {};
  predictionBuffer.forEach(x => counts[x] = (counts[x] || 0) + 1);
  const stableLabel = Object.keys(counts).find(key => counts[key] >= STABLE_COUNT);
  console.log(`[緩衝] ${predictionBuffer.join(',')} | 穩定=${stableLabel || '無'}`);

  if (stableLabel && gameStarted && !gameOver) {
    for (let b of bombs) {
      if (b.word === stableLabel && !b.shrinking && !b.exploding) {
        console.log(`[成功] 消除炸彈: ${stableLabel}`);
        b.startShrink(false);
        inferenceCooldown = 30;
        featureBuffer = [];
        predictionBuffer = [];
        if (progressEl) progressEl.textContent = `進度: 辨識成功 (${stableLabel})`;
        break;
      }
    }
  }
}

function updateDynamicGesture(results) {
  if (inferenceCooldown > 0) inferenceCooldown--;
  const hasHand = results && (results.leftHandLandmarks || results.rightHandLandmarks);

  if (!hasHand) {
    handMissCount++;
    handMissFrameCount++;  // 累加缺失幀數
    // 只有在連續缺失超過設定幀數才清除手部節點
    if (handMissFrameCount > HAND_PERSISTENCE_FRAMES) {
      lastHandLandmarks = null;  // 只現在才真正清除
      featureBuffer = [];
    }
    if (handMissCount < 5) return;
    if (handWasPresent && featureBuffer.length >= MIN_FRAMES_FOR_INFERENCE &&
      !isInferring && inferenceCooldown <= 0 && bombs.length > 0) {
      runInference().then(r => processInferenceResult(r));
    }
    handWasPresent = false;
    if (progressEl && inferenceCooldown <= 0) progressEl.textContent = '進度: 等待手勢...';
    return;
  }

  // 檢測到手時重置計數
  handMissCount = 0;
  handMissFrameCount = 0;  // 重置缺失計數
  handWasPresent = true;
  const frame = extractFrame138(results);
  featureBuffer.push(frame);
  if (featureBuffer.length > FEATURE_BUFFER_MAX) featureBuffer.shift();
  if (progressEl) progressEl.textContent = `進度: 錄製動作 (${featureBuffer.length}/${FEATURE_BUFFER_MAX})`;

  if (featureBuffer.length >= MIN_FRAMES_FOR_INFERENCE &&
    !isInferring && inferenceCooldown <= 0 && bombs.length > 0) {
    if (featureBuffer.length % 10 === 0 || featureBuffer.length >= FEATURE_BUFFER_MAX) {
      runInference().then(r => processInferenceResult(r));
    }
  }
}

// -----------------------
// 房子
// -----------------------
function initHouses() {
  houses = [];
  const attemptsLimit = 5000;
  let attempts = 0;
  while (houses.length < HOUSE_COUNT && attempts < attemptsLimit) {
    const x = Math.random() * (WIDTH - HOUSE_WIDTH);
    const y = HEIGHT - HOUSE_HEIGHT - HOUSE_MARGIN_BOTTOM;
    const rect = { x, y, width: HOUSE_WIDTH, height: HOUSE_HEIGHT };
    let dup = false;
    for (const h of houses) { if (Math.abs(h.x - rect.x) < 1 && Math.abs(h.y - rect.y) < 1) { dup = true; break; } }
    if (!dup) houses.push(rect);
    attempts++;
  }
  while (houses.length < HOUSE_COUNT) {
    houses.push({ x: 50 + houses.length * (HOUSE_WIDTH + 10), y: HEIGHT - HOUSE_HEIGHT - HOUSE_MARGIN_BOTTOM, width: HOUSE_WIDTH, height: HOUSE_HEIGHT });
  }
}

function updateHud() {
  scoreEl.textContent = `房子數: ${houses.length}`;
  lifeEl.textContent = `已掉落: ${totalBombsDropped}/${TARGET_BOMBS}`;
  
  if (!gameStarted) {
    statusEl.textContent = modelLoaded ? '狀態: 準備中' : '狀態: 正在載入模型...';
    if (startBtn) {
      startBtn.style.display = (modelLoaded && gesturesLoaded) ? 'block' : 'none';
      startBtn.textContent = '開始遊戲';
    }
    if (pauseBtn) pauseBtn.style.display = 'none';
  } else if (gameOver) {
    statusEl.textContent = win ? '狀態: 勝利！' : '狀態: 失敗';
    if (startBtn) {
      startBtn.style.display = 'block';
      startBtn.textContent = '重新開始';
    }
    if (pauseBtn) pauseBtn.style.display = 'none';
  } else if (gamePaused) {
    statusEl.textContent = '狀態: 暫停中';
    if (startBtn) startBtn.style.display = 'none';
    if (pauseBtn) {
      pauseBtn.style.display = 'block';
      pauseBtn.textContent = '繼續';
    }
  } else {
    statusEl.textContent = '狀態: 遊玩中';
    if (startBtn) startBtn.style.display = 'none';
    if (pauseBtn) {
      pauseBtn.style.display = 'block';
      pauseBtn.textContent = '暫停';
    }
  }
}

// -----------------------
// 繪製攝影機畫面與手部節點（所有狀態都顯示）
// -----------------------
let camVideoAspect = 16/9;  // 1280x720 的實際比例

function renderCamera() {
  // 計算正確的顯示尺寸（保持16:9比例）
  const camMaxW = 320;  // 回復為 320 像素
  const camMaxH = 180;
  let camW = camMaxW;
  let camH = camW / (camVideoAspect || 1.78);  // 防止除以0或undefined
  if (camH > camMaxH) {
    camH = camMaxH;
    camW = camH * (camVideoAspect || 1.78);
  }
  // 放在右上角
  const camX = WIDTH - camW - 10, camY = 10;

  // 鏡像繪製攝影機畫面
  if (lastVideoFrame) {
    try {
      ctx.save();
      ctx.translate(camX + camW, camY);
      ctx.scale(-1, 1);
      ctx.drawImage(lastVideoFrame, 0, 0, camW, camH);
      ctx.restore();
    } catch (e) {
      console.error('Camera render error:', e);
      ctx.restore();
    }
  }

  // 綠色邊框
  ctx.strokeStyle = '#0f0';
  ctx.lineWidth = 2;
  ctx.strokeRect(camX, camY, camW, camH);

  // 繪製手部節點（鏡像，使用實際顯示尺寸）
  if (lastHandLandmarks && lastHandLandmarks.length > 0) {
    ctx.fillStyle = '#0f0';
    for (const hand of lastHandLandmarks) {
      for (const lm of hand) {
        // 驗證坐標有效性，防止NaN導致當機
        if (!lm || typeof lm.x !== 'number' || typeof lm.y !== 'number') continue;
        if (isNaN(lm.x) || isNaN(lm.y) || isNaN(camW) || isNaN(camH)) continue;
        
        const x = camX + (1 - lm.x) * camW;
        const y = camY + lm.y * camH;
        
        // 再次驗證計算結果
        if (isNaN(x) || isNaN(y)) continue;
        
        try {
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
        } catch (e) {
          console.error('Hand landmark render error:', e);
        }
      }
    }
  }
}

// -----------------------
// Debug 資訊疊加層（顯示模型推論 + 特徵診斷）
// -----------------------
// 儲存最近一次的特徵診斷
let lastFeatureDiag = null;

function renderDebugOverlay() {
  const x = 10, y = HEIGHT - 320;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(x, y, 420, 310);
  ctx.fillStyle = '#0f0';
  ctx.font = '13px monospace';
  ctx.textAlign = 'left';

  let ly = y + 18;
  ctx.fillText(`[Buffer] ${featureBuffer.length}/${FEATURE_BUFFER_MAX} | [Hand] ${handWasPresent ? 'YES' : 'NO'} | [CD] ${inferenceCooldown}`, x + 8, ly);
  ly += 18;
  ctx.fillText(`[Smooth] ${predictionBuffer.join(',') || '(空)'} (需${STABLE_COUNT}/${PREDICTION_BUFFER_SIZE}次)`, x + 8, ly);

  // 特徵診斷區
  ly += 22;
  ctx.fillStyle = '#0ff';
  ctx.fillText('=== 特徵診斷 ===', x + 8, ly);
  if (lastFeatureDiag) {
    const d = lastFeatureDiag;
    ly += 16;
    ctx.fillStyle = d.hasPose ? '#0f0' : '#f00';
    ctx.fillText(`Pose: ${d.hasPose ? '✓' : '✗'}`, x + 8, ly);
    ctx.fillStyle = d.hasFace ? '#0f0' : '#f00';
    ctx.fillText(`Face: ${d.hasFace ? '✓' : '✗'}`, x + 80, ly);
    ctx.fillStyle = d.hasLeft ? '#0f0' : '#f88';
    ctx.fillText(`左手: ${d.hasLeft ? '✓' : '✗'}`, x + 150, ly);
    ctx.fillStyle = d.hasRight ? '#0f0' : '#f88';
    ctx.fillText(`右手: ${d.hasRight ? '✓' : '✗'}`, x + 230, ly);
    ly += 16;
    ctx.fillStyle = '#888';
    ctx.font = '11px monospace';
    ctx.fillText(`零值 L:${d.lhZeros}/63 R:${d.rhZeros}/63`, x + 8, ly);
  } else {
    ly += 16;
    ctx.fillStyle = '#888';
    ctx.fillText('等待偵測...', x + 8, ly);
    ly += 32;
  }

  // 模型預測區
  ly += 16;
  if (lastDebugInfo) {
    ctx.fillStyle = '#ff0';
    ctx.font = '13px monospace';
    ctx.fillText(`=== 預測 (門檻${CONFIDENCE_THRESHOLD}) ===`, x + 8, ly);
    lastDebugInfo.top5.slice(0, 3).forEach((p, i) => {
      ly += 16;
      // 防價：確保 p.prob 是有效的數字
      let probValue = p.prob;
      let probDisplay = '無效';
      if (isFinite(probValue)) {
        const barW = Math.max(0, (probValue * 100 + 3) * 0.2);
        ctx.fillStyle = (i === 0 && probValue >= CONFIDENCE_THRESHOLD) ? '#0f0' : '#555';
        ctx.fillRect(x + 140, ly - 12, barW, 12);
        probDisplay = (probValue * 100).toFixed(1) + '%';
      }
      ctx.fillStyle = '#fff';
      ctx.fillText(`${p.label}: ${probDisplay}`, x + 8, ly);
    });
    ly += 12;
    ctx.fillStyle = '#666';
    ctx.font = '10px monospace';
    // logits 資訊（改為顯示原始機率）
    const rawProbsStr = lastDebugInfo.rawProbs.slice(0, 3).map((x, i) => {
      if (isFinite(x)) return (x * 100).toFixed(1) + '%';
      return 'NaN';
    }).join(', ');
    ctx.fillText(`raw probs: ${rawProbsStr}`, x + 8, ly);
  } else {
    ctx.fillStyle = '#888';
    ctx.fillText('尚未進行推論', x + 8, ly);
  }
}

// -----------------------
// 主迴圈
// -----------------------
function gameLoop() {
  try {
    // 继续计数手部被检测到的时间，确保每帧都更新（即使 predictWebcam 延迟）
    if (handMissFrameCount > 0) {
      handMissFrameCount++;
      if (handMissFrameCount > HAND_PERSISTENCE_FRAMES) {
        lastHandLandmarks = null;
      }
    }

    ctx.clearRect(0, 0, WIDTH, HEIGHT);

  if (!gameStarted) {
    if (backgroundImg.complete && backgroundImg.naturalWidth > 0) ctx.drawImage(backgroundImg, 0, 0, WIDTH, HEIGHT);
    else { ctx.fillStyle = '#003366'; ctx.fillRect(0, 0, WIDTH, HEIGHT); }
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // ★ 遊戲開始前也顯示攝影機 + 手部節點
    renderCamera();
    renderDebugOverlay();

    ctx.fillStyle = '#FFF'; ctx.font = '48px Arial'; ctx.textAlign = 'center';
    if (!gesturesLoaded || !modelLoaded) {
      ctx.fillText('正在載入模型，請稍候...', WIDTH / 2, Math.max(HEIGHT / 2, 50));
    }
    updateHud();
    requestAnimationFrame(gameLoop);
    return;
  }

  frameCounter += 1;

  if (backgroundImg.complete && backgroundImg.naturalWidth > 0) ctx.drawImage(backgroundImg, 0, 0, WIDTH, HEIGHT);
  else { ctx.fillStyle = '#003366'; ctx.fillRect(0, 0, WIDTH, HEIGHT); }

  // ★ 遊戲中也顯示攝影機 + 手部節點
  renderCamera();

  if (!gameOver && !gamePaused) {
    plane.move();
    if (bombs.length < MIN_ACTIVE_BOMBS && totalBombsDropped < TARGET_BOMBS) {
      minBombReplenishCounter -= 1;
      if (minBombReplenishCounter <= 0) {
        bombs.push(new Bomb(plane.x + plane.width / 2 - Bomb.WIDTH / 2, plane.y + plane.height - 30));
        totalBombsDropped += 1;
        minBombReplenishCounter = minBombReplenishDelay;
      }
    }
    const newBomb = plane.maybeDropBomb();
    if (newBomb && totalBombsDropped < TARGET_BOMBS) { bombs.push(newBomb); totalBombsDropped += 1; }
  }

  // 房子
  for (const h of houses) {
    // 防價：確保房子座標有效
    if (isNaN(h.x) || isNaN(h.y) || isNaN(h.width) || isNaN(h.height)) {
      console.warn('House render: 無效座標', {x: h.x, y: h.y, width: h.width, height: h.height});
      continue;
    }
    
    try {
      if (houseImg.complete && houseImg.naturalWidth > 0) ctx.drawImage(houseImg, h.x, h.y, h.width, h.height);
      else { ctx.fillStyle = '#ffaa00'; ctx.fillRect(h.x, h.y, h.width, h.height); }
    } catch (e) {
      console.error('House render error:', e);
    }
  }

  // 炸彈
  if (!gameOver) {
    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i];
      if (!gamePaused) b.fall();
      b.render(ctx);
      const bombBottom = b.y + Bomb.HEIGHT;
      let hitAnyHouse = false;
      for (const h of houses) {
        if (b.x < h.x + h.width && b.x + Bomb.WIDTH > h.x && b.y < h.y + h.height && bombBottom > h.y) { hitAnyHouse = true; break; }
      }
      // 只有碰到地面才爆炸，忽略房子碰撞
      const hitGround = bombBottom >= HEIGHT;
      if (!b.impactResolved && !b.shrinking && !b.exploding && hitGround) {
        b.impactResolved = true;  // 標記已接觸
        b.shouldExplode = true;
        b.startShrink(true);  // 開始爆炸縮小動畫
      }
      // 爆炸動畫完成後再消除最近的房子
      if (b.finished && b.shouldExplode && !b.houseDamageApplied) {
        b.houseDamageApplied = true;
        if (houses.length > 0) {
          // 找到距離炸弹爆炸點最近的房子
          let closestIdx = 0;
          let closestDist = Infinity;
          const bombCenterX = b.x + Bomb.WIDTH / 2;
          const bombCenterY = b.y + Bomb.HEIGHT / 2;
          for (let i = 0; i < houses.length; i++) {
            const h = houses[i];
            const houseCenterX = h.x + h.width / 2;
            const houseCenterY = h.y + h.height / 2;
            const dist = Math.hypot(houseCenterX - bombCenterX, houseCenterY - bombCenterY);
            if (dist < closestDist) {
              closestDist = dist;
              closestIdx = i;
            }
          }
          houses.splice(closestIdx, 1);
          if (houses.length === 0) { gameOver = true; win = false; }
        }
      }
      if (!b.shrinking && !b.exploding && (b.finished || b.shrinkTimer > Bomb.MAX_SHRINK_TIME)) bombs.splice(i, 1);
    }
    if (!gameOver && totalBombsDropped >= TARGET_BOMBS && bombs.length === 0 && houses.length > 0) { gameOver = true; win = true; }
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = win ? '#00ff00' : '#ff0000'; ctx.font = '48px Arial'; ctx.textAlign = 'center';
    ctx.fillText(win ? '勝利！' : '失敗', WIDTH / 2, HEIGHT / 2 - 20);
  }

  // 顯示暫停畫面
  if (gamePaused) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#FFF'; ctx.font = '60px Arial'; ctx.textAlign = 'center';
    ctx.fillText('暫停', WIDTH / 2, HEIGHT / 2 - 40);
  }

  plane.render(ctx);
  renderDebugOverlay();
  updateHud();
  requestAnimationFrame(gameLoop);
  } catch (e) {
    console.error('Game loop error:', e);
    statusEl.textContent = `狀態: 遊戲循環錯誤 - ${e.message}`;
    requestAnimationFrame(gameLoop);  // 繼續运行，防止停止
  }
}

// -----------------------
// MediaPipe Hand 引擎 (Tasks Vision API)
// -----------------------
let handLandmarker = null;
let lastVideoTime = -1;

async function initWebcam() {
  statusEl.textContent = '狀態: 正在載入 Tasks Vision 引擎...';

  try {
    // 使用 ES Module Dynamic Import 載入 @mediapipe/tasks-vision
    const visionModule = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs");
    const { FilesetResolver: FR, HandLandmarker: HL } = visionModule;

    statusEl.textContent = '狀態: 正在載入 Hand 模型...';

    const filesetResolver = await FR.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
    );

    handLandmarker = await HL.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numHands: 2,  // 同時檢測二隻手
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    console.log("[Hand] HandLandmarker 建立成功 (Tasks Vision API)");

    // 開啟攝影機 (要求 16:9 以匹配訓練影片的比例，避免特徵變形)
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720 }
    });
    video.srcObject = stream;
    await video.play();
    lastVideoFrame = video;
    statusEl.textContent = '狀態: 已連線攝像頭（可進行手勢偵測）';
    predictWebcam();

  } catch (error) {
    console.error("Hand initialization failed:", error);
    statusEl.textContent = '狀態: Hand 載入失敗 - ' + error.message;
  }
}

let lastPredictTime = 0;
const PREDICT_FRAME_INTERVAL = 33;  // 30 FPS (改善手部同步)
async function predictWebcam() {
  if (!handLandmarker) return;

  // 確認影片播放中
  if (video.currentTime === lastVideoTime) {
    requestAnimationFrame(predictWebcam);
    return;
  }

  // 限制推論幀率約 30 FPS (每 33ms 執行一次) 改善手部節點同步
  const now = performance.now();
  if (now - lastPredictTime < PREDICT_FRAME_INTERVAL) {
    requestAnimationFrame(predictWebcam);
    return;
  }

  lastPredictTime = now;
  lastVideoTime = video.currentTime;

  try {
    const startTimeMs = performance.now();
    const results = handLandmarker.detectForVideo(video, startTimeMs);

    // Hand Landmarker 返回的是一個或兩個手的書蹟
    let leftHandLandmarks = null;
    let rightHandLandmarks = null;
    
    if (results.landmarks && results.landmarks.length > 0) {
      if (results.handedness && results.handedness.length > 0) {
        // 根據 handedness 的位置區分左手和右手
        for (let i = 0; i < results.landmarks.length; i++) {
          const handedness = results.handedness[i][0].categoryName; // 'Left' or 'Right'
          if (handedness === 'Left') {
            leftHandLandmarks = results.landmarks[i];
          } else if (handedness === 'Right') {
            rightHandLandmarks = results.landmarks[i];
          }
        }
      }
    }

    // 格式轉換以相容舊的 results 格式 (用於除錯顯示與特徵提取)
    const formattedResults = {
      poseLandmarks: null,  // Hand Landmarker 不會返回體態
      faceLandmarks: null,  // Hand Landmarker 不會返回臉部
      leftHandLandmarks: leftHandLandmarks,
      rightHandLandmarks: rightHandLandmarks,
    };

    const handList = [];
    if (formattedResults.leftHandLandmarks) handList.push(formattedResults.leftHandLandmarks);
    if (formattedResults.rightHandLandmarks) handList.push(formattedResults.rightHandLandmarks);
    lastHandLandmarks = handList.length > 0 ? handList : null;

    updateDynamicGesture(formattedResults);
    lastVideoFrame = video;
  } catch (e) {
    console.error("Detection error:", e);
  }

  requestAnimationFrame(predictWebcam);
}

// -----------------------
// 初始化
// -----------------------
function initGame() {
  initHouses();
  plane = new Plane();

  // 移除鍵盤事件，改用按鈕

  // 開始遊戲按鈕
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      if (!gameStarted) {
        if (!gesturesLoaded || !modelLoaded) return;
        gameStarted = true;
        gamePaused = false;
        updateHud();
      } else if (gameOver) {
        gameStarted = true; gameOver = false; win = false; gamePaused = false;
        bombs = []; totalBombsDropped = 0;
        initHouses(); plane = new Plane();
        resetGestureSequence();
        updateHud();
      }
    });
  }

  // 暫停按鈕
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      if (gameStarted && !gameOver) {
        gamePaused = !gamePaused;
        updateHud();
      }
    });
  }

  updateHud();
  requestAnimationFrame(gameLoop);
}

initModel();
initWebcam().catch(() => { statusEl.textContent = '狀態: 無法存取攝影機（仍可遊玩）'; });
initGame();
