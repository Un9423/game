// app.js: 台灣手語學習遊戲 Web 版
// 使用 ONNX Transformer 模型進行手語辨識

// 綁定到 window 上，方便我們在 Console 直接手動呼叫測試
window.testUpload = saveScoreToCloud;
window.testGet = getTop10Scores;

// 🔧 【診斷工具】直接在 Console 呼叫這些函數測試
window.testWebcam = async function() {
  console.log("🔧 [診斷] 開始測試摄像頭...");
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    console.log(`📹 找到 ${videoDevices.length} 個攝影機:`, videoDevices);
    
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false
    });
    console.log("✅ 摄像头可以訪問！分辨率:", stream.getVideoTracks()[0].getSettings());
    stream.getTracks().forEach(t => t.stop());
  } catch (e) {
    console.error("❌ 摄像头錯誤:", e.name, "-", e.message);
    if (e.name === "NotAllowedError") {
      console.warn("💡 解决方案: 點擊瀏覽器地址欄的攝影機圖標，選擇\"允許\"");
    } else if (e.name === "NotFoundError") {
      console.warn("💡 解决方案: 沒有可用的攝影機，檢查設備");
    } else if (e.name === "NotReadableError") {
      console.warn("💡 解决方案: 攝影機被其他應用占用，關閉 Teams/Zoom/OBS");
    }
  }
};
console.log("💡 在 Console 輸入 testWebcam() 來測試摄像頭");

// 🔧 【調試工具】顯示手部檢測信息
window.toggleHandDebug = function() {
  window.SHOW_HAND_DEBUG = !window.SHOW_HAND_DEBUG;
  console.log(window.SHOW_HAND_DEBUG ? "✅ 手部調試已啟用" : "❌ 手部調試已禁用");
};
console.log("💡 在 Console 輸入 toggleHandDebug() 來顯示手部檢測日誌");

//****************************************************
//*************************
// ☁️ Firebase 排行榜系統初始化 (升級至 12.12.0 最新版)

// 1. 核心大腦 (12.12.0 版)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
// 2. 雲端資料庫 (12.12.0 版) - 這是我們為了排行榜自己加上去的！
import { getFirestore, collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// 3. 你的專屬金鑰
const firebaseConfig = {
  apiKey: "AIzaSyCPcZUYi5Q47iE3UpXaM4Zkw90RtD61-tk",
  authDomain: "tsl-rhythm-game.firebaseapp.com",
  projectId: "tsl-rhythm-game",
  storageBucket: "tsl-rhythm-game.firebasestorage.app",
  messagingSenderId: "837614444705",
  appId: "1:837614444705:web:4e11bd9f0b1e7b987dd0e0",
  measurementId: "G-XGHRTP4C43"
};

// 4. 啟動 Firebase 與資料庫
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ==========================================
// 📌 功能一：上傳分數到雲端
export async function saveScoreToCloud(playerName, finalScore) {
    try {
        await addDoc(collection(db, "leaderboard"), {
            name: playerName,
            score: finalScore,
            timestamp: serverTimestamp()
        });
        console.log("分數上傳成功！");
    } catch (e) {
        console.error("上傳分數失敗: ", e);
    }
}

// 📌 功能二：抓取全球前 10 名
export async function getTop10Scores() {
    try {
        const q = query(collection(db, "leaderboard"), orderBy("score", "desc"), limit(10));
        const querySnapshot = await getDocs(q);
        
        let leaderboardData = [];
        querySnapshot.forEach((doc) => {
            leaderboardData.push(doc.data());
        });
        return leaderboardData;
    } catch (e) {
        console.error("抓取排行榜失敗: ", e);
        return [];
    }
}
//*************************
//****************************************************

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const scoreEl = document.getElementById('score');
const lifeEl = document.getElementById('life');
const video = document.getElementById('video');
// 🎥 保留 video 元素的原始 CSS 让其正常初始化摄像头流
// video 的 CSS 已在 index.html 中定义（右上角 320×180）
// 不使用 JavaScript 隐藏它，而是在 Canvas 上重新绘制镜像
const gestureEl = document.getElementById('gesture');
const progressEl = document.getElementById('progress');
const startBtn = document.getElementById('start-btn');
const pauseBtn = document.getElementById('pause-btn');

// 🎵 【音樂系統】：初始化按鈕狀態 - 未選音樂前灰色顯示"請先選音樂"
if (startBtn) {
  startBtn.disabled = true;
  startBtn.textContent = '請先選音樂';
  startBtn.style.display = 'block';
}

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


// ****************************************************************************
// ****************************************************************************
// 🎵🎵🎵🎵🎵 【音樂對拍系統：變數宣告與檔案防呆解析】 🎵🎵🎵🎵🎵
let musicBeats = [];
let currentBeatIndex = 0;
let isAnalyzing = false;
const AUDIO_OFFSET = 0.08; // 🌟 為了教授要求的 <150ms 誤差校正值
const bgmPlayer = document.getElementById('bgmPlayer');
const audioUpload = document.getElementById('audioUpload');

if (audioUpload) {
    audioUpload.addEventListener('change', async function(e) {
        const file = e.target.files[0];
        if (!file) return;

        // 🛑 音樂系統防線一：限制檔案大小 (15 MB)
        const maxSize = 15 * 1024 * 1024; 
        if (file.size > maxSize) {
            alert("請上傳 15MB 以下的音樂檔。");
            e.target.value = ''; return; 
        }

        // 🛑 音樂系統防線二：開始解析時鎖死按鈕
        audioUpload.disabled = true;
        if (startBtn) startBtn.disabled = true; 

        if (statusEl) statusEl.textContent = '狀態: 🎵 音樂解析中...';
        isAnalyzing = true;

        try {
            const fileURL = URL.createObjectURL(file);
            bgmPlayer.src = fileURL;
            const arrayBuffer = await file.arrayBuffer();
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            musicBeats = await analyzeBeatsSmartJS(audioBuffer);
            if (statusEl) statusEl.textContent = `狀態: ✅ 解析完成！載入 ${TARGET_BOMBS} 顆炸彈`;
            
            // 🎵 【音樂系統】：音樂解析成功後，按鈕變綠色並顯示"開始遊戲"
            if (startBtn) {
              startBtn.disabled = false;
              startBtn.textContent = '開始遊戲';
            }
        } catch (error) {
            console.error("音樂解析失敗:", error);
            alert("這首音樂無法解析，請換一首歌！");
            if (statusEl) statusEl.textContent = '狀態: 音樂解析失敗';
        } finally {
            isAnalyzing = false;
            audioUpload.disabled = false;
            // 若解析失敗，按鈕保持灰色；解析成功則上面已更新
        }
    });
}

async function analyzeBeatsSmartJS(audioBuffer) {
    const duration = audioBuffer.duration;
    const sampleRate = audioBuffer.sampleRate;
    const offlineCtx = new OfflineAudioContext(3, audioBuffer.length, sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;

    const lowPass = offlineCtx.createBiquadFilter(); lowPass.type = 'lowpass'; lowPass.frequency.value = 150;
    const bandPass = offlineCtx.createBiquadFilter(); bandPass.type = 'bandpass'; bandPass.frequency.value = 1000;
    const highPass = offlineCtx.createBiquadFilter(); highPass.type = 'highpass'; highPass.frequency.value = 3000;

    const merger = offlineCtx.createChannelMerger(3);
    source.connect(lowPass).connect(merger, 0, 0);
    source.connect(bandPass).connect(merger, 0, 1);
    source.connect(highPass).connect(merger, 0, 2);
    merger.connect(offlineCtx.destination);
    source.start(0);
    const renderedBuffer = await offlineCtx.startRendering(); 

    function getOnsetEvents(channelData, lane, targetMin, targetMax) {
        const windowSize = Math.floor(sampleRate * 0.05); 
        const stepSize = Math.floor(sampleRate * 0.01);   
        let energy = [];
        for (let i = 0; i < channelData.length - windowSize; i += stepSize) {
            let sum = 0;
            for (let j = 0; j < windowSize; j++) sum += channelData[i+j] * channelData[i+j];
            energy.push(Math.sqrt(sum / windowSize));
        }
        const maxE = Math.max(...energy); const minE = Math.min(...energy);
        const normEnergy = energy.map(e => (e - minE) / (maxE - minE + 1e-6));
        let threshold = 0.35; let events = [];
        for (let attempt = 0; attempt < 6; attempt++) {
            events = [];
            for (let i = 1; i < normEnergy.length - 1; i++) {
                if (normEnergy[i] > threshold && normEnergy[i] > normEnergy[i-1] && normEnergy[i] > normEnergy[i+1]) {
                    events.push({ time: i * (0.01), lane: lane });
                }
            }
            let bps = events.length / duration;
            if (bps < targetMin) threshold -= 0.08;
            else if (bps > targetMax) threshold += 0.06;
            else break;
            threshold = Math.max(0.05, Math.min(threshold, 0.8));
        }
        return events;
    }

    const eventsLow = getOnsetEvents(renderedBuffer.getChannelData(0), 0, 0.5, 1.0);
    const eventsMid = getOnsetEvents(renderedBuffer.getChannelData(1), 1, 0.5, 1.0);
    const eventsHigh = getOnsetEvents(renderedBuffer.getChannelData(2), 2, 0.5, 1.0);
    let allEvents = [...eventsLow, ...eventsMid, ...eventsHigh];
    allEvents.sort((a, b) => a.time - b.time);

    let filteredEvents = []; let lastBombTime = -999.0;
    for (let ev of allEvents) {
        if (ev.time - lastBombTime >= 3.0) {
            filteredEvents.push(ev); lastBombTime = ev.time;
        }
    }
    
    let finalEvents = [];
    if (filteredEvents.length > 0) {
        finalEvents.push(filteredEvents[0]);
        for (let i = 1; i < filteredEvents.length; i++) {
            let prevTime = finalEvents[finalEvents.length - 1].time;
            let curr = filteredEvents[i];
            while (curr.time - prevTime > 5.0) {
                let fillerTime = prevTime + 3.0;
                if (curr.time - fillerTime < 1.0) break;
                finalEvents.push({ time: fillerTime, lane: Math.floor(Math.random() * 3) });
                prevTime = fillerTime;
            }
            finalEvents.push(curr);
        }
    }
    TARGET_BOMBS = finalEvents.length; 
    return finalEvents;
}
// 🎵🎵🎵🎵🎵 【音樂對拍系統：解析引擎結束】 🎵🎵🎵🎵🎵
// ****************************************************************************
// ****************************************************************************


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
// ****************************************************************************
// ****************************************************************************
// 💥 【音樂系統更動】：把 const 改成了 let，因為音樂會動態改變炸彈總數
let TARGET_BOMBS = 15; 
// ****************************************************************************
// ****************************************************************************
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
const CONFIDENCE_THRESHOLD = 0.75;  // 隊友規格：原始 logit 門檻
const MODEL_FRAMES = 30;
const FEATURE_DIM = 74;             // 新模型：74 維 (左手37 + 右手37)
let modelLoaded = false;

// Debug: 儲存最近一次推論的完整結果供畫面顯示
let lastDebugInfo = null;

// 🔍 身體節點檢測狀態（用於黑框顯示）
let lastPoseDetected = false;      // 是否檢測到身體節點
let lastPosePointCount = 0;        // 檢測到的身體節點數量

// 詞彙難度對照表 - 三級制 (根據 gesture_difficulty_classification.md)
// 一級(1): 簡單, 二級(2): 中級, 三級(3): 高級
const WORD_DIFFICULTY = {
  // ⭐ 一級（初級） - 20個
  '不可以': 1, '中午': 1, '公車': 1, '去': 1, '可以': 1,
  '好吃': 1, '有': 1, '有沒有': 1, '你好': 1, '我': 1, 
  '明天': 1, '是': 1, '飛機': 1, '記得': 1, '喜歡': 1, 
  '棒': 1, '說話': 1, '檢查': 1, '謝謝': 1, '還沒': 1,
  
  // ⭐⭐ 二級（中級） - 15個
  '不客氣': 2, '不是': 2, '不喜歡': 2, '今天(現在)': 2, '生氣': 2, 
  '休息': 2, '再見': 2, '忘記': 2, '朋友': 2, '爸爸': 2, 
  '要': 2, '高興': 2, '會': 2, '認真': 2, '機車': 2,
  
  // ⭐⭐⭐ 三級（高級） - 15個
  '火車': 3, '名字': 3, '告訴': 3, '我們': 3, '找': 3,
  '沒關係': 3, '放學': 3, '計程車': 3, '高鐵': 3, '幾點': 3, 
  '飲料': 3, '媽媽': 3, '對不起': 3, '幫忙': 3, '蘋果': 3,
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
    console.log('🔄 開始加載 ONNX 模型...');
    
    if (typeof ort !== 'undefined' && ort.env) {
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
      ort.env.wasm.numThreads = 1;
    }
    
    const options = {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    };
    
    ortSession = await ort.InferenceSession.create('./tsl_model_fold4.onnx', options);
    console.log('✅ ONNX 推理會話創建成功');
  } catch (onnxError) {
    console.warn('⚠️ ONNX 加載失敗:', onnxError.message);
    ortSession = null;
  }
  
  try {
    const response = await fetch('./label_map.json');
    labelMap = await response.json();
    console.log('✅ Label map loaded');

    fullVocabulary = Object.entries(labelMap).map(([idx, text]) => ({
      text,
      difficulty: WORD_DIFFICULTY[text] || 1,
    }));
    currentVocabulary = [...fullVocabulary];
    modelLoaded = true;
    gesturesLoaded = true;
    updateDifficultySelection();

    if (!isAnalyzing) statusEl.textContent = '狀態: AI 模型載入完成';
  } catch (e) {
    console.error('載入失敗:', e);
    statusEl.textContent = '狀態: 模型載入失敗';
  }
}

// -----------------------
// 🔥 【能量偵測系統】動作活躍度驗證 (新模型 66 維專用)
// -----------------------
/**
 * 計算單幀的能量值（以手部重心的標準差）
 * 新模型 66 維特徵專用
 * @param {Float32Array} frame - 特徵向量 (66 維)
 * @returns {number} 能量值
 */
function computeFrameEnergy(frame) {
  if (!frame || frame.length !== 74) return 0;
  
  let lh_pts, rh_pts;
  
  // 新模型：74 維 [左手座標33 + 左手幾何4 + 右手座標33 + 右手幾何4]
  lh_pts = [];
  for (let i = 0; i < 11; i++) {
    lh_pts.push([frame[i*3], frame[i*3+1], frame[i*3+2]]);
  }
  
  rh_pts = [];
  for (let i = 0; i < 11; i++) {
    rh_pts.push([frame[37 + i*3], frame[37 + i*3+1], frame[37 + i*3+2]]);
  }
  
  // 計算兩手重心
  let lh_center = [0, 0, 0];
  let rh_center = [0, 0, 0];
  const pointCount = lh_pts.length;
  
  for (let i = 0; i < 3; i++) {
    for (let p of lh_pts) lh_center[i] += p[i];
    for (let p of rh_pts) rh_center[i] += p[i];
    lh_center[i] /= pointCount;
    rh_center[i] /= pointCount;
  }
  
  // 計算標準差 (能量)
  let lh_var = [0, 0, 0];
  let rh_var = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    for (let p of lh_pts) lh_var[i] += (p[i] - lh_center[i]) ** 2;
    for (let p of rh_pts) rh_var[i] += (p[i] - rh_center[i]) ** 2;
    lh_var[i] = Math.sqrt(lh_var[i] / pointCount);
    rh_var[i] = Math.sqrt(rh_var[i] / pointCount);
  }
  
  // 返回能量 = 三軸標準差平均
  let energy = (lh_var[0] + lh_var[1] + lh_var[2] + rh_var[0] + rh_var[1] + rh_var[2]) / 6;
  return energy;
}

/**
 * 從特徵緩衝區分析總體能量
 * @param {Array} buffer - featureBuffer (特徵列表)
 * @returns {Object} { energy: 能量值, isValid: 是否足夠動態, reason: 原因 }
 */
function analyzeBufferEnergy(buffer) {
  if (!buffer || buffer.length < 5) {
    return { energy: 0, isValid: false, reason: '幀數太少' };
  }
  
  // 1. 計算每幀能量
  let energyList = [];
  for (let frame of buffer) {
    energyList.push(computeFrameEnergy(frame));
  }
  
  // 2. 滾動標準差平滑 (視窗大小 5)
  let smoothedEnergy = [];
  const winSize = 5;
  for (let i = 0; i < energyList.length; i++) {
    const start = Math.max(0, i - Math.floor(winSize / 2));
    const end = Math.min(energyList.length, i + Math.floor(winSize / 2) + 1);
    const window = energyList.slice(start, end);
    const avg = window.reduce((a, b) => a + b, 0) / window.length;
    smoothedEnergy.push(avg);
  }
  
  // 3. 卷積平滑 (進一步平滑，視窗 11)
  let finalEnergy = smoothedEnergy;
  const kernelSize = Math.min(11, smoothedEnergy.length);
  const kernel = Array(kernelSize).fill(1 / kernelSize);
  let convolvedEnergy = [];
  for (let i = 0; i < smoothedEnergy.length; i++) {
    let sum = 0;
    for (let k = 0; k < kernelSize; k++) {
      const idx = Math.max(0, Math.min(smoothedEnergy.length - 1, i - Math.floor(kernelSize / 2) + k));
      sum += smoothedEnergy[idx] * kernel[k];
    }
    convolvedEnergy.push(sum);
  }
  finalEnergy = convolvedEnergy;
  
  // 4. 計算最大能量與平均能量
  const maxEnergy = Math.max(...finalEnergy);
  const meanEnergy = finalEnergy.reduce((a, b) => a + b, 0) / finalEnergy.length;
  
  // 5. 峰值檢測：找出能量 > 40% 峰值的幀數
  const peakThreshold = Math.max(0.01, maxEnergy * 0.40);
  let peakFrames = finalEnergy.filter(e => e > peakThreshold).length;
  const peakRatio = peakFrames / buffer.length;
  
  // 6. 判定標準：平均能量 > 0.03 且有 15% 以上的動態幀（降低阈值以支持细微动作）
  const isValid = meanEnergy > 0.03 && peakRatio > 0.15;
  
  return {
    energy: meanEnergy,
    maxEnergy: maxEnergy,
    peakRatio: peakRatio,
    isValid: isValid,
    reason: !isValid ? (meanEnergy <= 0.05 ? '動作過靜態' : '動態幀數不足') : '✅ 動作足夠動態'
  };
}

// 存儲最近一次的能量分析結果供顯示
let lastEnergyAnalysis = null;

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
    this.x = WIDTH / 2; this.y = 50;  // 初始位置在中央
    this.speed = 2.5; // 🌟 等速飛行速度（像素/幀）
    this.direction = 1;  // 1 = 向右, -1 = 向左
    this.dropCooldown = 150;
  }
  //---------------------------------------------------------------------------------------------------
  //---------------------------------------------------
  // 🌟 【改進】等速直線飛行 + 邊界折返（遇到攝像頭框折返）
  move() {
    // 等速移動
    this.x += this.speed * this.direction;

    // 計算攝像頭框的邊界（與 renderCamera 一致）
    const camMaxW = 320;
    const camMaxH = 180;
    let camW = camMaxW;
    let camH = camW / 16 * 9;  // 16:9 比例
    if (camH > camMaxH) {
      camH = camMaxH;
      camW = camH * 16 / 9;
    }
    const camX = WIDTH - camW - 10;  // 攝像頭在右上角
    
    // 邊界檢測，遇到邊緣折返
    const leftBound = 0;
    const rightBound = camX - 10;  // 遇到攝像頭框的左邊就折返
    
    if (this.x <= leftBound) {
      this.x = leftBound;
      this.direction = 1;  // 轉向右邊
    } else if (this.x + this.width >= rightBound) {
      this.x = rightBound - this.width;
      this.direction = -1;  // 轉向左邊
    }
  }
  //---------------------------------------------------
  //---------------------------------------------------------------------------------------------------
  
    // ****************************************************************************
    // delete maybeDropBomb()
    // ****************************************************************************
  render(ctx) {
    if (planeImg.complete && planeImg.naturalWidth > 0) {
      const imgH = this.height;
      const imgW = (planeImg.naturalWidth / planeImg.naturalHeight) * imgH;
      const drawX = this.x + (this.width - imgW) / 2;
      ctx.save();
      if (this.direction === -1) { ctx.translate(drawX + imgW / 2, 0); ctx.scale(-1, 1); ctx.translate(-(drawX + imgW / 2), 0); }
      ctx.drawImage(planeImg, drawX, this.y, imgW, imgH);
      ctx.restore();
    } else {
      ctx.fillStyle = '#999';
      ctx.fillRect(this.x, this.y, this.width, this.height);
    }
  }
}

class Bomb {
  static WIDTH = 100; static HEIGHT = 100;
  static SPEED = 1.5; static MAX_SHRINK_TIME = 15;
// ****************************************************************************
// ****************************************************************************
// 【音樂對拍系統：為炸彈加入完美掉落時間參數】 + targetTime
  constructor(x, y, targetTime, spawnTime) { 
    this.x = x ?? Math.random() * (WIDTH - Bomb.WIDTH);
    this.startY = y ?? -Bomb.HEIGHT;
    this.y = this.startY;//0420 
    // ****************************************************************************
    // ****************************************************************************
    this.targetTime = targetTime; // 🌟 為了誤差測量儲存目標時間
    this.spawnTime = spawnTime;//0420
    // ****************************************************************************
    // ****************************************************************************
    this.word = randomVocab().text;
    this.shrinking = false; this.shrinkTimer = 0;
    this.exploding = false; this.explosionTimer = 0;
    this.shouldExplode = false; this.finished = false; this.impactResolved = false;
    this.houseDamageApplied = false;  // 標記房子傷害是否已應用
  }
  // ****************************************************************************
  // ***************************************
  fall(currentTime) {
    if (!this.shrinking && !this.exploding){
      // 絕對時間同步公式：經過的時間 * 每秒應掉落的像素 (SPEED * 60幀)
        const elapsedTime = currentTime - this.spawnTime;
        this.y = this.startY + elapsedTime * (Bomb.SPEED * 60);
    }
  }
  // ***************************************
  // ****************************************************************************
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
      if (explosionImg.complete && explosionImg.naturalWidth > 0) ctx.drawImage(explosionImg, ex, ey, size, size);
      else { ctx.fillStyle = 'orange'; ctx.beginPath(); ctx.arc(this.x + Bomb.WIDTH / 2, this.y + Bomb.HEIGHT / 2, size / 2, 0, Math.PI * 2); ctx.fill(); }
      if (this.explosionTimer >= 10) { this.exploding = false; this.finished = true; }
      return;
    }
    if (bombImg.complete && bombImg.naturalWidth > 0) ctx.drawImage(bombImg, drawX, drawY, drawW, drawH);
    else { ctx.fillStyle = '#CC0000'; ctx.fillRect(drawX, drawY, drawW, drawH); }
    ctx.fillStyle = '#FFF'; ctx.font = '24px Arial'; ctx.textAlign = 'center';
    ctx.fillText(this.word, this.x + Bomb.WIDTH / 2, this.y + Bomb.HEIGHT / 2 + 10);
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

// 🔥 【動態重疊窗口】改進系統
let windowQueue = [];                    // 存儲最近的推理結果
const WINDOW_STRIDE = 5;               // 每 5 幀推理一次 (而非 10 幀)，增加重疊度
const MAX_CONCURRENT_WINDOWS = 6;      // 最多保留 6 個推理結果進行投票
const WINDOW_STABLE_COUNT = 3;         // 需要 3/6 或更多一致 (更寬鬆，因為有更多數據)

function resetGestureSequence() {
  featureBuffer = [];
  predictionBuffer = [];
  windowQueue = [];  // 清除窗口隊列
  inferenceCooldown = 0;
  isInferring = false;
  handWasPresent = false;
  handMissCount = 0;
  handMissFrameCount = 0;  // 重置手部節點持久化計數
  if (progressEl) progressEl.textContent = '進度: 等待手勢...';
}

async function runInference() {
  if (isInferring || featureBuffer.length < MIN_FRAMES_FOR_INFERENCE) return null;
  
  isInferring = true;
  try {
    const inputData = prepareModelInput(featureBuffer, MODEL_FRAMES);
    
    // ✅ 【集成方式】只用 5-Fold 投票集成
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      const ensembleResult = await fetch('http://localhost:5001/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          features: Array.from(inputData).reduce((acc, val, i) => {
            const frameIdx = Math.floor(i / FEATURE_DIM);
            const dimIdx = i % FEATURE_DIM;
            if (!acc[frameIdx]) acc[frameIdx] = [];
            acc[frameIdx][dimIdx] = val;
            return acc;
          }, [])
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (ensembleResult.ok) {
        const ensembleData = await ensembleResult.json();
        if (ensembleData.status === 'success') {
          // 取得當前難度允許的詞彙清單（難度過濾）
          const activeWords = new Set(currentVocabulary.map(v => v.text));
          
          // 【修正】只從當前難度的詞彙中取前4高
          const topPredictions = ensembleData.all_logits
            .map((logit, i) => ({
              label: labelMap[String(i)] || `?${i}`,
              prob: logit,
              idx: i
            }))
            .filter(p => activeWords.has(p.label))  // ✅ 只保留難度內的詞彙
            .sort((a, b) => b.prob - a.prob)
            .slice(0, 4);  // ✅ 從過濾後的詞彙中取前4
          
          lastDebugInfo = {
            top4: topPredictions,  // 改名為 top4 以符合實際
            rawLogits: ensembleData.all_logits.slice(0, 10).map(x => x.toFixed(2))
          };
          
          // 如果預測詞彙不在當前難度中，尋找該難度內最高的
          if (!activeWords.has(ensembleData.label)) {
            console.log(`[集成] 預測詞彙 "${ensembleData.label}" 不在當前難度，尋找備選...`);
            
            const maskedLogits = ensembleData.all_logits.map((logit, i) => {
              const word = labelMap[String(i)] || `?${i}`;
              return activeWords.has(word) ? logit : -Infinity;
            });
            
            const maxLogit = Math.max(...maskedLogits);
            const predIdx = maskedLogits.indexOf(maxLogit);
            const predLabel = labelMap[String(predIdx)];
            
            console.log(`[集成] ✅ 5-Fold 集成推理成功 | 預測: ${predLabel} | 置信度: ${maxLogit.toFixed(3)}`);
            isInferring = false;
            return { label: predLabel, confidence: maxLogit };
          }
          
          console.log(`[集成] ✅ 5-Fold 集成推理成功 | 預測: ${ensembleData.label} | 置信度: ${ensembleData.confidence.toFixed(3)} | 模型數: ${ensembleData.models_used}`);
          isInferring = false;
          return { label: ensembleData.label, confidence: ensembleData.confidence };
        }
      }
    } catch (ensembleError) {
      console.error(`[集成] ❌ Ensemble 推理失敗（後端未運行？）:`, ensembleError.message);
    }
    
    // ⚠️ 集成推理失敗 → 放棄本次推理，不降級
    isInferring = false;
    return null;
    
  } catch (e) {
    console.error('[推理] 異常:', e);
    isInferring = false;
    return null;
  }
}

function processInferenceResult(result, frameIndex) {
  if (!result) {
    // 🔥 【新增】：檢查是否因為能量不足而被拒絕
    if (lastEnergyAnalysis && !lastEnergyAnalysis.isValid) {
      if (progressEl) {
        progressEl.textContent = `進度: ⚠️ ${lastEnergyAnalysis.reason} (繼續擺動手部)`;
      }
    }
    return;
  }
  if (gestureEl) gestureEl.textContent = `偵測: ${result.label} (logit: ${result.confidence.toFixed(2)})`;

  // 原始 logit 門檻 0.75（跟隊友的 checkGesture 一致）
  if (result.confidence < CONFIDENCE_THRESHOLD) {
    return;
  }

  // 🔥 【改進】：多窗口加權投票（動態重疊窗口）
  // 添加到窗口隊列
  windowQueue.push({
    timestamp: frameIndex,
    label: result.label,
    confidence: result.confidence,
  });
  
  // 保持隊列大小
  if (windowQueue.length > MAX_CONCURRENT_WINDOWS) {
    windowQueue.shift();
  }
  
  // 基於多個窗口的加權投票
  const weights = windowQueue.map((_, i) => 0.5 + (i / MAX_CONCURRENT_WINDOWS) * 0.5); // 最近的權重更高
  const scores = {};
  let totalWeight = 0;
  
  windowQueue.forEach((w, i) => {
    const labelScore = (scores[w.label] || 0) + weights[i];
    scores[w.label] = labelScore;
    totalWeight += weights[i];
  });
  
  // 找出得分最高的標籤
  const stableLabel = Object.keys(scores).reduce((a, b) => 
    scores[a] > scores[b] ? a : b, Object.keys(scores)[0]
  );
  const stableScore = scores[stableLabel] / totalWeight;
  
  // 判定標準：至少 3/6 一致（或加權分數 > 0.4）
  const isStable = stableScore > 0.40;
  
  
  // 🔥 【新增】：實時顯示推理進度到黑框
  if (progressEl) {
    if (isStable) {
      progressEl.textContent = `進度: 穩定判定 ${stableLabel} (${(stableScore*100).toFixed(0)}%) ✓`;
    } else {
      progressEl.textContent = `進度: 推理中 ${stableLabel}(${(stableScore*100).toFixed(0)}%)... (${windowQueue.length}/${MAX_CONCURRENT_WINDOWS})`;
    }
  }
  
  // 同時保持舊的 predictionBuffer 用於相容性
  predictionBuffer.push(result.label);
  if (predictionBuffer.length > PREDICTION_BUFFER_SIZE) predictionBuffer.shift();

  if (isStable && gameStarted && !gameOver) {
    for (let b of bombs) {
      if (b.word === stableLabel && !b.shrinking && !b.exploding) {
        b.startShrink(false);
        inferenceCooldown = 30;
        featureBuffer = [];
        predictionBuffer = [];
        windowQueue = [];  // 清除窗口隊列
        if (progressEl) progressEl.textContent = `進度: 辨識成功 (${stableLabel})`;
        break;
      }
    }
  }
}

function updateDynamicGesture(results) {
  if (inferenceCooldown > 0) inferenceCooldown--;
  
  // 🔍 更新身體節點檢測狀態
  lastPoseDetected = !!(results && results.poseLandmarks && results.poseLandmarks.length > 12);
  lastPosePointCount = results && results.poseLandmarks ? results.poseLandmarks.length : 0;
  
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
      runInference().then(r => processInferenceResult(r, featureBuffer.length));
    }
    handWasPresent = false;
    if (progressEl && inferenceCooldown <= 0) {
      progressEl.textContent = `進度: 等待手勢...`;
    }
    return;
  }

  // 檢測到手時重置計數
  handMissCount = 0;
  handMissFrameCount = 0;  // 重置缺失計數
  handWasPresent = true;
  
  // 改為使用新的 66 維特徵提取
  if (typeof extractFrame74 === 'function') {
      const frame = extractFrame74(results);
      
      // 诊断：检查特征是否全为0或其他异常值
      const nonZeroCount = frame.filter(v => Math.abs(v) > 1e-6).length;
      
      featureBuffer.push(frame);
      if (featureBuffer.length > FEATURE_BUFFER_MAX) featureBuffer.shift();
      
      // 🔥 【簡化】：只顯示緩衝進度，不計算能量（太耗資源）
      let progressText = `進度: 錄製動作 (${featureBuffer.length}/${FEATURE_BUFFER_MAX})`;
      if (progressEl) progressEl.textContent = progressText;

      // 🔥 【改進】：每 5 幀推理一次（而非 10 幀），增加重疊度
      if (featureBuffer.length >= MIN_FRAMES_FOR_INFERENCE &&
        !isInferring && inferenceCooldown <= 0 && bombs.length > 0) {
        if (featureBuffer.length % WINDOW_STRIDE === 0 || featureBuffer.length >= FEATURE_BUFFER_MAX) {
          runInference().then(r => processInferenceResult(r, featureBuffer.length));
        }
      }
  } else {
      console.error("特徵提取失敗：extractFrame74 找不到");
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

// ****************************************************************************
// ***************************************
  if (isAnalyzing) {
    statusEl.textContent = '狀態: 🎵 音樂解析中，請稍候...';
  } else if (!gameStarted) {
    if (musicBeats.length > 0) {
      statusEl.textContent = `狀態: ✅ 載入 ${TARGET_BOMBS} 顆炸彈 (按開始遊戲)`;
    } else {
      statusEl.textContent = modelLoaded ? '狀態: 準備中 (請先上傳音樂)' : '狀態: 正在載入模型...';
    }
// ***************************************
// ****************************************************************************
    
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
  const camMaxW = 320;  // 原本大小
  const camMaxH = 180;
  let camW = camMaxW;
  let camH = camW / camVideoAspect;
  if (camH > camMaxH) {
    camH = camMaxH;
    camW = camH * camVideoAspect;
  }
  // 放在右上角
  const camX = WIDTH - camW - 10, camY = 10;

  // 【第一步】繪製視頻（鏡像）
  if (lastVideoFrame && lastVideoFrame.videoWidth > 0) {
    ctx.save();
    // 使用 Canvas 變換進行鏡像
    ctx.translate(camX + camW, camY);   // 移到右上角
    ctx.scale(-1, 1);                   // 水平翻轉（鏡像）
    ctx.drawImage(lastVideoFrame, 0, 0, camW, camH);
    ctx.restore();
  } else {
    // 播放中但無視頻 - 顯示占位符
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(camX, camY, camW, camH);
    ctx.fillStyle = '#666';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('攝像頭加載中...', camX + camW/2, camY + camH/2);
    console.warn('[renderCamera] lastVideoFrame 為 null 或無視頻寬度');
  }

  // 【第二步】繪製手部節點
  if (lastHandLandmarks && lastHandLandmarks.length > 0) {
    ctx.fillStyle = '#0f0';
    ctx.strokeStyle = '#0f0';
    ctx.lineWidth = 2;
    
    for (let handIdx = 0; handIdx < lastHandLandmarks.length; handIdx++) {
      const hand = lastHandLandmarks[handIdx];
      
      // 繪製節點網絡（骨骼連接）
      const connections = [
        [0,1],[1,2],[2,3],[3,4],  // 大拇指
        [0,5],[5,6],[6,7],[7,8],  // 食指
        [0,9],[9,10],[10,11],[11,12],  // 中指
        [0,13],[13,14],[14,15],[15,16],  // 無名指
        [0,17],[17,18],[18,19],[19,20]   // 小指
      ];
      
      // 繪製骨骼
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 1;
      for (const [start, end] of connections) {
        const lmStart = hand[start];
        const lmEnd = hand[end];
        const x1 = camX + (1 - lmStart.x) * camW;  // 鏡像：1-x
        const y1 = camY + lmStart.y * camH;
        const x2 = camX + (1 - lmEnd.x) * camW;
        const y2 = camY + lmEnd.y * camH;
        
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      
      // 繪製節點點圓
      ctx.fillStyle = '#0f0';
      for (let ptIdx = 0; ptIdx < hand.length; ptIdx++) {
        const lm = hand[ptIdx];
        // 鏡像坐標計算：(1 - lm.x) 反轉 X 軸
        const x = camX + (1 - lm.x) * camW;
        const y = camY + lm.y * camH;
        
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // 【第三步】繪製綠色邊框
  ctx.strokeStyle = '#0f0';
  ctx.lineWidth = 2;
  ctx.strokeRect(camX, camY, camW, camH);
}

// -----------------------
// Debug 資訊疊加層（顯示模型推論 + 特徵診斷）
// -----------------------
// 儲存最近一次的特徵診斷
let lastFeatureDiag = null;

function renderDebugOverlay() {
  const x = 10, y = HEIGHT - 210;  // 黑框位置往上移，給新行留空間
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(x, y, 420, 200);  // 黑框高度增加到 200
  ctx.fillStyle = '#0f0';
  ctx.font = '13px monospace';
  ctx.textAlign = 'left';

  let ly = y + 18;
  // 第一行：Buffer、手部、冷卻時間、身體節點
  const poseIndicator = lastPoseDetected ? `✓(${lastPosePointCount})` : '✗';
  ctx.fillText(`[Buffer] ${featureBuffer.length}/${FEATURE_BUFFER_MAX} | [Hand] ${handWasPresent ? 'YES' : 'NO'} | [Pose] ${poseIndicator} | [CD] ${inferenceCooldown}`, x + 8, ly);
  ly += 18;
  ctx.fillText(`[Smooth] ${predictionBuffer.join(',') || '(空)'} (需${STABLE_COUNT}/${PREDICTION_BUFFER_SIZE}次)`, x + 8, ly);

  // 模型預測區
  ly += 20;
  if (lastDebugInfo) {
    ctx.fillStyle = '#ff0';
    ctx.font = '13px monospace';
    ctx.fillText(`=== 預測 (門檻${CONFIDENCE_THRESHOLD}) ===`, x + 8, ly);
    lastDebugInfo.top4.forEach((p, i) => {
      ly += 16;
      const barW = Math.max(0, (p.prob + 3) * 20);
      ctx.fillStyle = (i === 0 && p.prob >= CONFIDENCE_THRESHOLD) ? '#0f0' : '#555';
      ctx.fillRect(x + 140, ly - 12, barW, 12);
      ctx.fillStyle = '#fff';
      ctx.fillText(`${p.label}: ${p.prob.toFixed(1)}`, x + 8, ly);
    });
    ly += 12;
    ctx.fillStyle = '#666';
    ctx.font = '10px monospace';
    ctx.fillText(`logits: ${lastDebugInfo.rawLogits.join(',')}`, x + 8, ly);
  } else {
    ctx.fillStyle = '#888';
    ctx.fillText('尚未進行推論', x + 8, ly);
  }
}

// ********************************************************************************
//*****************************************
// 🎮 遊戲結束處理函數
// ==========================================
// 🎮 遊戲結束處理函數 (加強版)
// ==========================================
// ==========================================
// 🎮 遊戲結束處理函數 (加強版 + 華麗排行榜 UI)
// ==========================================
function handleGameOver(isWin) {
    console.log("🚨 成功觸發結算函數！準備停止音樂與上傳分數..."); 

    // 1. 停止背景音樂
    try {
        const bgm = document.getElementById('bgmPlayer');
        if (bgm && !bgm.paused) {
            bgm.pause();
            bgm.currentTime = 0;
        }
    } catch (e) {
        console.log("音樂停止失敗，但沒關係繼續結算：", e);
    }

    // 2. 計算最後分數
    const finalScore = isWin ? 9999 : 10; // 👈 這裡記得換成你真正的分數變數喔！
    
    // 3. 延遲 0.5 秒後跳出輸入名字視窗
    setTimeout(() => {
        const message = isWin ? "🎉 恭喜過關！" : "💥 遊戲失敗！";
        const playerName = prompt(`${message} 你的分數是 ${finalScore}，請輸入大名登入排行榜：`, "神秘玩家");
        
        // 4. 如果有輸入名字，就上傳並顯示華麗排行榜
        if (playerName) {
            console.log(`準備上傳 -> 玩家: ${playerName}, 分數: ${finalScore}`);
            
            // 呼叫 Firebase 上傳分數
            saveScoreToCloud(playerName, finalScore).then(() => {
                
                // 上傳完畢後，抓取最新前 10 名
                getTop10Scores().then(top10 => {
                    
                    // --- 👇 這裡就是把 Console 變成畫面的魔法 👇 ---
                    const modal = document.getElementById('leaderboard-modal');
                    const listContainer = document.getElementById('leaderboard-list');
                    listContainer.innerHTML = ''; // 先清空舊名單
                    
                    // 跑迴圈把前 10 名塞進 HTML 裡
                    top10.forEach((player, index) => {
                        // 給前三名加個超炫獎牌
                        let medal = '';
                        if (index === 0) medal = '🥇';
                        else if (index === 1) medal = '🥈';
                        else if (index === 2) medal = '🥉';
                        else medal = `<span style="display:inline-block; width:25px;">${index + 1}.</span>`;

                        // 塞入 HTML 條目
                        listContainer.innerHTML += `
                            <li style="display: flex; justify-content: space-between; padding: 10px 5px; border-bottom: 1px dashed #444; font-size: 18px;">
                                <span style="font-weight: bold;">${medal} ${player.name}</span>
                                <span style="color: #ff0;">${player.score} 分</span>
                            </li>
                        `;
                    });

                    // 把隱藏的排行榜視窗顯示出來 (flex 可以讓它置中)
                    modal.style.display = 'flex';
                    // --- 👆 魔法結束 👆 ---

                });
            });
        } else {
            console.log("玩家取消輸入名字，不上傳分數。");
        }
    }, 500);
}
//******************************************
//***************************************************************************************
// -----------------------
// 主迴圈
// -----------------------
function gameLoop() {
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
    // ****************************************************************************
    // ***************************************
    } else if (musicBeats.length === 0) {
      // 💥 【音樂系統提示】
      ctx.fillText('請先在左上角上傳音樂', WIDTH / 2, Math.max(HEIGHT / 2, 50));
    // ***************************************
    // ****************************************************************************
    }
    updateHud();  // 恢復以顯示按鈕
    requestAnimationFrame(gameLoop);
    return;
  }

  frameCounter += 1;

  if (backgroundImg.complete && backgroundImg.naturalWidth > 0) ctx.drawImage(backgroundImg, 0, 0, WIDTH, HEIGHT);
  else { ctx.fillStyle = '#003366'; ctx.fillRect(0, 0, WIDTH, HEIGHT); }

  // ★ 遊戲中也顯示攝影機 (但不畫骨骼)
  renderCamera();

  if (!gameOver && !gamePaused) {
    plane.move();


    // ****************************************************************************
    // ***************************************
    // 【音樂對拍系統：未來視精準掉落邏輯】
    let currentTime = bgmPlayer.currentTime + AUDIO_OFFSET; 
    // 🌟 修正重點：精準計算真實的起點(飛機肚子)與終點(地板)距離0420
    const baseY = plane.y + plane.height - 30; // 炸彈起點 (70)
    let dropDistance = HEIGHT - Bomb.HEIGHT - baseY; // 真實掉落距離 (630)
    
    let travelTime = dropDistance / (Bomb.SPEED * 60); 
    let lookAheadTime = currentTime + travelTime;

    // 只要時間到了，就把對應的炸彈全部生出來
    while (currentBeatIndex < musicBeats.length && lookAheadTime >= musicBeats[currentBeatIndex].time) {
        let targetTime = musicBeats[currentBeatIndex].time;
        let spawnTime = targetTime - travelTime;
        
        // 🌟 【改進】炸彈直接在飛機當前位置下方落下
        // 使用飛機的實時x位置，而不是預計算的lane位置
        let bombX = plane.x + (plane.width - Bomb.WIDTH) / 2;  // 讓炸彈在飛機正下方
        
        // 生成炸彈
        bombs.push(new Bomb(bombX, baseY, targetTime, spawnTime)); 
        
        totalBombsDropped += 1;
        currentBeatIndex += 1; 
    }
    //【音樂掉落系統結束】
    // ***************************************
    // ****************************************************************************
  }

  // 房子
  for (const h of houses) {
    if (houseImg.complete && houseImg.naturalWidth > 0) ctx.drawImage(houseImg, h.x, h.y, h.width, h.height);
    else { ctx.fillStyle = '#ffaa00'; ctx.fillRect(h.x, h.y, h.width, h.height); }
  }

  // 炸彈
  if (!gameOver) {
    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i];
      if (!gamePaused) b.fall(bgmPlayer.currentTime + AUDIO_OFFSET);//0420
      b.render(ctx);
      const bombBottom = b.y + Bomb.HEIGHT;
      // 只有碰到地面才爆炸，忽略房子碰撞
      const hitGround = bombBottom >= HEIGHT;
      
      if (!b.impactResolved && !b.shrinking && !b.exploding && hitGround) {
        
        // ****************************************************************************
        // ***************************************
        // 【我的音樂對拍系統：150ms 誤差測量雷達】
        if (b.targetTime !== undefined) {
              // 取得炸彈碰到地面瞬間的「真實音樂時間」
              let currentRealTime = bgmPlayer.currentTime + AUDIO_OFFSET;
              // 計算誤差 (絕對值)
              let error = Math.abs(currentRealTime - b.targetTime);
              
              // 印出華麗的報表，如果有大於 0.5 秒的就亮紅燈，不然就亮綠燈
              if (error > 0.5) {
                  console.log(`🔴 [嚴重延遲] 目標: ${b.targetTime.toFixed(3)}s | 實際: ${currentRealTime.toFixed(3)}s | 誤差: ${error.toFixed(3)} 秒`);
              } else {
                  console.log(`🟢 [完美對拍] 目標: ${b.targetTime.toFixed(3)}s | 實際: ${currentRealTime.toFixed(3)}s | 誤差: ${error.toFixed(3)} 秒`);
              }
          }
        // ***************************************
        // ****************************************************************************

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
          if (houses.length === 0) { gameOver = true; win = false; handleGameOver(false); }
        }
      }
      if (!b.shrinking && !b.exploding && (b.finished || b.shrinkTimer > Bomb.MAX_SHRINK_TIME)) bombs.splice(i, 1);
    }
    // 🏆 判定勝利的條件
    if (!gameOver && totalBombsDropped >= TARGET_BOMBS && bombs.length === 0 && houses.length > 0) { 
        gameOver = true; 
        win = true; 
        handleGameOver(true); // 呼叫結算函數，傳入 true 代表勝利
    }
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
  // updateHud();  // 🔥 禁用右下角 CD 以優化性能
  requestAnimationFrame(gameLoop);
}

// -----------------------
// MediaPipe 双模型检测引擎 (Tasks Vision API)
// -----------------------
let handLandmarker = null;      // 手部检测
let poseLandmarker = null;      // 身体检测
let lastVideoTime = -1;

async function initWebcam() {
  statusEl.textContent = '狀態: 正在載入 Tasks Vision 引擎...';

  try {
    // 使用 ES Module Dynamic Import 載入 @mediapipe/tasks-vision
    const visionModule = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs");
    const { FilesetResolver: FR, HandLandmarker: HL, PoseLandmarker: PL } = visionModule;
    
    // 🔍 檢查導入是否成功
    console.log("[✅ initWebcam] 模組導入完成");
    console.log("[🔍 診斷] FR (FilesetResolver):", typeof FR);
    console.log("[🔍 診斷] HL (HandLandmarker):", typeof HL);
    console.log("[🔍 診斷] PL (PoseLandmarker):", typeof PL);
    
    if (!PL) {
      console.error("[❌] PoseLandmarker 在 vision_bundle 中不存在！");
      console.log("[📦 vision_bundle 包含的exports]:", Object.keys(visionModule));
    }

    statusEl.textContent = '狀態: 正在載入模型...'

    const filesetResolver = await FR.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
    );

    // 🔥 加载 HandLandmarker（手部检测）
    console.log("[🔥 initWebcam] 創建 HandLandmarker...");
    handLandmarker = await HL.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
        delegate: "CPU"  // ✅ 改為 CPU（WASM）穩定性更好，避免 GPU 競爭
      },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
    console.log("[✅ initWebcam] HandLandmarker 創建成功");

    // 🔥 加载 PoseLandmarker（身体检测）- 用于获得肩膀位置
    console.log("[🔥 initWebcam] 創建 PoseLandmarker...");
    
    try {
      // 嘗試多個可能的 URL
      const poseUrls = [
        // 方案 1: 標準版本 (float16) - Google Storage
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker/float16/latest/pose_landmarker.task",
        // 方案 2: 標準版本 (int8) - Google Storage
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker/int8/latest/pose_landmarker.task",
        // 方案 3: Full 版本 - Google Storage
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
        // 方案 4: Heavy 版本 - Google Storage
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task",
      ];
      
      let poseModelUrl = null;
      let lastError = null;
      
      for (const url of poseUrls) {
        try {
          console.log(`[🔥 嘗試] ${url}`);
          const poseOptions = {
            baseOptions: { modelAssetPath: url },
            runningMode: "VIDEO"
          };
          
          poseLandmarker = await PL.createFromOptions(filesetResolver, poseOptions);
          poseModelUrl = url;
          console.log(`[✅ 成功] PoseLandmarker 已加載`);
          break;
        } catch (err) {
          lastError = err;
          console.warn(`[⚠️ 失敗] ${err.message.substring(0, 60)}...`);
        }
      }
      
      if (!poseLandmarker && lastError) {
        console.error("[❌ 所有 PoseLandmarker URL 都失敗]", lastError.message);
        console.warn("[⚠️ 特徵歸一化將使用預設肩膀 [0.5,0.5,0.0]，識別準確度會降低");
        poseLandmarker = null;
      } else if (poseLandmarker) {
        console.log("[✅ 身體節點已就緒，特徵歸一化使用真實肩膀位置 ✓✓✓");
      }
    } catch (poseError) {
      console.error("[❌ PoseLandmarker 異常]", poseError.message);
      poseLandmarker = null;
    }

    console.log("[Holistic] ✅ 模型已就緒");

    // 開啟攝影機 (使用 ideal 而不是精確要求，讓瀏覽器自動選擇可用分辨率)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          width: { ideal: 640 },  // ✅ 降低分辨率 1280→640，減少檢測開銷
          height: { ideal: 360 },
          facingMode: "user"
        },
        audio: false
      });
      video.srcObject = stream;
      
      // 等待 video 可以播放
      await new Promise((resolve) => {
        video.onloadedmetadata = () => resolve();
      });
      
      await video.play().catch(err => console.warn("Video play error:", err));
      
      // 🔥 立即设置 lastVideoFrame，让 renderCamera 能立即开始渲染
      lastVideoFrame = video;
      console.log("[Webcam] ✅ 攝照頭已連線");
      statusEl.textContent = '狀態: 已連線攝像頭（可進行手勢偵測）';
      console.log(`[Webcam] 分辨率: ${video.videoWidth}×${video.videoHeight}`);
      
      // 🔥 啟動手勢檢測（10 FPS，獨立於遊戲迴圈，不搶主線程）
      setInterval(predictWebcam, PREDICT_FRAME_INTERVAL);
    } catch (mediaError) {
      console.error("[Webcam] ❌ 攝影機啟動失敗:", mediaError.name, "-", mediaError.message);
      console.warn("[Webcam] 解决方案: 检查浏览器权限、关闭占用摄像头的应用、或使用不同浏览器");
      // ⚠️ 攝影機失敗但遊戲仍可繼續（沒有手勢識別）
      statusEl.textContent = '⚠️ 無法存取攝影機（仍可遊玩，但無手勢識別）';
    }

  } catch (error) {
    console.error("[Init] Holistic 模型初始化失敗:", error);
    statusEl.textContent = '狀態: Holistic 模型載入失敗 - ' + error.message;
  }
}

let lastPredictTime = 0;
const PREDICT_FRAME_INTERVAL = 100;  // ✅ 改為 10 FPS（100ms），完全分離主線程
async function predictWebcam() {
  if (!handLandmarker) return;  // 只需要 handLandmarker，poseLandmarker 是可选的

  // 確認影片播放中
  if (video.currentTime === lastVideoTime) {
    return;
  }

  lastVideoTime = video.currentTime;

  try {
    const startTimeMs = performance.now();
    
    // 🔥 双模型并行检测（poseLandmarker 是可选的）
    const handResults = handLandmarker.detectForVideo(video, startTimeMs);
    const poseResults = poseLandmarker ? poseLandmarker.detectForVideo(video, startTimeMs) : null;
    
    // 🔍 診斷信息已禁用（性能優先）

    // 提取手部节点
    let leftHandLandmarks = null;
    let rightHandLandmarks = null;
    
    if (handResults && handResults.landmarks && handResults.landmarks.length > 0) {
      if (handResults.handedness && handResults.handedness.length > 0) {
        // 根据 handedness 的位置区分左手和右手
        for (let i = 0; i < handResults.landmarks.length; i++) {
          const handedness = handResults.handedness[i][0].categoryName; // 'Left' or 'Right'
          if (handedness === 'Left') {
            leftHandLandmarks = handResults.landmarks[i];
          } else if (handedness === 'Right') {
            rightHandLandmarks = handResults.landmarks[i];
          }
        }
      }
    }

    // 提取身体节点
    let poseLandmarks = null;
    if (poseResults && poseResults.landmarks && poseResults.landmarks.length > 0) {
      poseLandmarks = poseResults.landmarks[0];  // 第一个人的身体节点
    }

    // 格式转换以兼容特征提取
    const formattedResults = {
      poseLandmarks: poseLandmarks,        // ✅ 现在有真实的身体节点！
      faceLandmarks: null,
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

    // ****************************************************************************
    // ***************************************
    // 【我的音樂對拍系統：防呆控制與播放連動】
      if (musicBeats.length === 0 || isAnalyzing) {
        alert("請先上傳音樂並等待解析完成喔！");
        return; 
      }

      if (!gameStarted) {
        if (!gesturesLoaded || !modelLoaded) return;
        gameStarted = true;
        gamePaused = false;
        bgmPlayer.play(); // 🌟 音樂連動：播放*********************************
        updateHud();
      } else if (gameOver) {
        gameStarted = true; gameOver = false; win = false; gamePaused = false;
        bombs = []; totalBombsDropped = 0; currentBeatIndex = 0;
        initHouses(); plane = new Plane();
        resetGestureSequence();
        bgmPlayer.currentTime = 0; // 🌟 音樂連動：歸零***********************
        bgmPlayer.play();          // 🌟 音樂連動：播放***********************
        updateHud();
      }
    });
  }

  // 暫停按鈕
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      if (gameStarted && !gameOver) {
        gamePaused = !gamePaused;
        if (gamePaused) {
            bgmPlayer.pause(); // 🌟 音樂連動：暫停音樂***************************
        } else {
            bgmPlayer.play();  // 🌟 音樂連動：恢復音樂***************************
        }
        updateHud();
      }
    });
  }

  //**************************
  //********
  const closeBoardBtn = document.getElementById('close-leaderboard-btn');
  if (closeBoardBtn) {
      closeBoardBtn.addEventListener('click', () => {
          // 隱藏排行榜
          document.getElementById('leaderboard-modal').style.display = 'none';
          // 觸發重新開始的邏輯
          if (startBtn) startBtn.click(); 
      });
  }
  //********
  //**************************

  updateHud();
  requestAnimationFrame(gameLoop);
}

initModel();
initWebcam().catch(() => { statusEl.textContent = '狀態: 無法存取攝影機（仍可遊玩）'; });
initGame();
