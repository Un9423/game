// dtw_worker.js - 在背景執行緒執行 DTW 比對，不阻塞主執行緒

let referenceGestures = null;
let dtwMatrix = null;

// 統一取樣幀數
const FIXED_FRAMES = 30;

// 新的特徵格式：頭部(1點) + 左手(21點) + 右手(21點) = 43點 = 86 floats per frame
// 將 flat 陣列線性重新取樣到 targetFrames 幀
function resampleFlat(flat, srcFrames, numPoints, targetFrames) {
  if (srcFrames === targetFrames) return flat;
  const fpf = numPoints * 2;  // 每幀的值數量（座標*2）
  const out = new Float32Array(targetFrames * fpf);
  for (let i = 0; i < targetFrames; i++) {
    const t  = i / (targetFrames - 1) * (srcFrames - 1);
    const f0 = Math.floor(t);
    const f1 = Math.min(f0 + 1, srcFrames - 1);
    const a  = t - f0;
    for (let k = 0; k < fpf; k++) {
      out[i * fpf + k] = flat[f0 * fpf + k] * (1 - a) + flat[f1 * fpf + k] * a;
    }
  }
  return out;
}

// 提取特徵：手指形狀 + 手腕軌跡 + 手相對於頭部的位置
// 新格式：頭部(0-1) + 左手(2-43) + 右手(44-85) = 86 floats
function extractFeatures(resampledRaw, frames) {
  const features = new Float32Array(frames * 86);
  
  for (let f = 0; f < frames; f++) {
    // 頭部位置（鼻子）
    const head_x = resampledRaw[f * 86 + 0];
    const head_y = resampledRaw[f * 86 + 1];
    
    // 複製頭部特徵
    features[f * 86 + 0] = head_x;
    features[f * 86 + 1] = head_y;
    
    // 處理左手和右手
    for (let h = 0; h < 2; h++) {
      const h_idx = h;  // 0 for left, 1 for right
      const raw_base = 2 + h * 42;  // 原始數據索引基點
      const feat_base = 2 + h * 42;  // 特徵索引基點
      
      const w_x = resampledRaw[f * 86 + raw_base];      // 手腕 x
      const w_y = resampledRaw[f * 86 + raw_base + 1];  // 手腕 y
      const mcp_x = resampledRaw[f * 86 + raw_base + 18];
      const mcp_y = resampledRaw[f * 86 + raw_base + 19];
      
      if (w_x === 0 && w_y === 0 && mcp_x === 0 && mcp_y === 0) {
        // 沒有檢測到手
        for (let k = 0; k < 42; k++) features[f * 86 + feat_base + k] = 0;
        continue;
      }
      
      let scale = Math.sqrt((mcp_x - w_x) ** 2 + (mcp_y - w_y) ** 2);
      // 極度調降 scale 最小值保障，確保玩家站得遠(手看起來很小)時，依然能正確依比例放大特徵。
      // 之前設 0.05 導致遠處的手比例失真，距離被錯誤放大而判定失敗。
      if (scale < 0.001) scale = 0.001;
      
      // Shape: 0~39 (手指相對於手腕，用當前幀 scale 正規化)
      for (let i = 1; i <= 20; i++) {
        const pt_x = resampledRaw[f * 86 + raw_base + i * 2];
        const pt_y = resampledRaw[f * 86 + raw_base + i * 2 + 1];
        features[f * 86 + feat_base + (i-1)*2]     = (pt_x - w_x) / scale;
        features[f * 86 + feat_base + (i-1)*2 + 1] = (pt_y - w_y) / scale;
      }
      
      // Head-relative position: 40~41 (手腕相對於頭部鼻子的位置)
      // 核心修復：絕對不能除以 scale！因為手腕如果往前指著鏡頭，掌心看起來會變積極小 (scale 趨近 0)
      // 這會導致位置分數直接爆炸幾千倍，造成所有包含空間要求的詞彙全部被誤殺！
      // 改為使用最純粹的畫面絕對相對座標，這樣才能真正穩定測量「鼻子到胸口的距離差」
      if (head_x === 0 && head_y === 0 || w_x === 0 && w_y === 0) {
        features[f * 86 + feat_base + 40] = 0;
        features[f * 86 + feat_base + 41] = 0;
      } else {
        features[f * 86 + feat_base + 40] = (w_x - head_x);
        features[f * 86 + feat_base + 41] = (w_y - head_y);
      }
    }
  }
  return features;
}

function loadGestures(rawData) {
  referenceGestures = {};
  for (const [word, entry] of Object.entries(rawData)) {
    const seqList = entry.sequences || (entry.sequence ? [entry.sequence] : null) || [entry];
    if (!seqList || seqList.length === 0) continue;

    const difficulty = entry.difficulty || 1;
    const refs = [];
    
    for (const seq of seqList) {
      if (!seq || seq.length === 0) continue;
      const frames = seq.length;
      // 新格式：頭部(1) + 左手(21) + 右手(21) = 43 點 = 86 floats
      const rawFlat = new Float32Array(frames * 86);
      for (let f = 0; f < frames; f++) {
        // 頭部資訊（第0個點）
        rawFlat[f * 86 + 0] = seq[f][0].x;
        rawFlat[f * 86 + 1] = seq[f][0].y;
        
        // 左手（第1-21個點）
        for (let p = 0; p < 21; p++) {
          rawFlat[f * 86 + 2 + p * 2]     = seq[f][1 + p].x;
          rawFlat[f * 86 + 2 + p * 2 + 1] = seq[f][1 + p].y;
        }
        // 右手（第22-42個點）
        for (let p = 0; p < 21; p++) {
          rawFlat[f * 86 + 44 + p * 2]     = seq[f][22 + p].x;
          rawFlat[f * 86 + 44 + p * 2 + 1] = seq[f][22 + p].y;
        }
      }
      
      const resampledRaw = resampleFlat(rawFlat, frames, 43, FIXED_FRAMES);
      const featFlat = extractFeatures(resampledRaw, FIXED_FRAMES);
      const speedArray = new Float32Array(FIXED_FRAMES);
      speedArray[0] = 0; // 第一幀沒速度

      // 活動權重 (只看軌跡特徵的變異) 以及「平均高度 (y軸)」
      let move_L = 0;
      let move_R = 0;
      let mean_y_L = 0, valid_L = 0;
      let mean_y_R = 0, valid_R = 0;
      
      for (let f = 1; f < FIXED_FRAMES; f++) {
        // L (left hand at feat: 2~43)
        const in_idx_L = f * 86 + 2;
        const prev_idx_L = (f - 1) * 86 + 2;
        let wy_L = resampledRaw[in_idx_L + 1];
        let vL = 0;
        if (wy_L !== 0) { mean_y_L += wy_L; valid_L++; }
        if (wy_L !== 0 && resampledRaw[prev_idx_L + 1] !== 0) {
          vL = Math.sqrt((resampledRaw[in_idx_L] - resampledRaw[prev_idx_L])**2 + (resampledRaw[in_idx_L + 1] - resampledRaw[prev_idx_L + 1])**2);
          move_L += vL;
        }
        
        // R (right hand at feat: 44~85)
        const in_idx_R = f * 86 + 44;
        const prev_idx_R = (f - 1) * 86 + 44;
        let wy_R = resampledRaw[in_idx_R + 1];
        let vR = 0;
        if (wy_R !== 0) { mean_y_R += wy_R; valid_R++; }
        if (wy_R !== 0 && resampledRaw[prev_idx_R + 1] !== 0) {
          vR = Math.sqrt((resampledRaw[in_idx_R] - resampledRaw[prev_idx_R])**2 + (resampledRaw[in_idx_R + 1] - resampledRaw[prev_idx_R + 1])**2);
          move_R += vR;
        }
        
        // 紀錄每一幀的移動速度，用於動態懲罰
        speedArray[f] = vL + vR;
      }
      
      if (valid_L > 0) mean_y_L /= valid_L; else mean_y_L = Infinity;
      if (valid_R > 0) mean_y_R /= valid_R; else mean_y_R = Infinity;

      if (move_L === 0 && move_R === 0) {
        move_L = 1; move_R = 1;
      }

      const w_total = move_L + move_R;
      const ratio_L = move_L / w_total;
      const ratio_R = move_R / w_total;
      
      let weight_L, weight_R;
      
      if (difficulty === 1) {
        // 若雙手皆存在或運動量難分上下，判定「位置較高的 (y 較小)」絕對是主動手！
        if (valid_L === 0 || (mean_y_R < mean_y_L - 0.1)) {
          weight_L = 0.0; weight_R = 1.0;
        } else if (valid_R === 0 || (mean_y_L < mean_y_R - 0.1)) {
          weight_L = 1.0; weight_R = 0.0;
        } else if (move_L >= move_R) {
          weight_L = 1.0; weight_R = 0.0;
        } else {
          weight_L = 0.0; weight_R = 1.0;
        }
      } else {
        if (ratio_L < 0.25) { weight_L = 0; weight_R = 1.0; }
        else if (ratio_R < 0.25) { weight_L = 1.0; weight_R = 0; }
        else {
          weight_L = 0.9 * ratio_L + 0.1 * 0.5;
          weight_R = 0.9 * ratio_R + 0.1 * 0.5;
        }
      }
      
      const factor_L = weight_L * 2.0;
      const factor_R = weight_R * 2.0;

      refs.push({ feat: featFlat, frames: FIXED_FRAMES, factor_L, factor_R });
    }

    if (refs.length > 0) {
      referenceGestures[word] = refs;
    }
  }
  dtwMatrix = new Float32Array((FIXED_FRAMES + 1) * (FIXED_FRAMES + 1));
}

function computeDTWEuclidean(liveFeat, n, refData) {
  const m = refData.frames || FIXED_FRAMES;
  const cols = m + 1;
  const dtwMatrix = new Float32Array((n + 1) * cols);

  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= m; j++)
      dtwMatrix[i * cols + j] = Infinity;
      
  // Open-Begin: 允許在 live 的任意幀啟動比對
  for (let i = 0; i <= n; i++) dtwMatrix[i * cols + 0] = 0;

  for (let i = 1; i <= n; i++) {
    const s1_offset = (i - 1) * 86;  // 86 floats per frame

    // 取消 windowOffset，允許完美擷取動作區段
    for (let j = 1; j <= m; j++) {
      const ref_offset = (j - 1) * 86;
      
      const dist_head = 0;
      
      let dist_L = 0;
      let dist_R = 0;
      // 1. 各手指輪廓形狀誤差平方和 (Shape)
      for (let k = 2; k < 42; k++) {
        dist_L += (liveFeat[s1_offset + k] - refData.feat[ref_offset + k]) ** 2;
      }
      for (let k = 44; k < 84; k++) {
        dist_R += (liveFeat[s1_offset + k] - refData.feat[ref_offset + k]) ** 2;
      }
      
      // 2. 加入手腕相對於頭部的位置歐氏誤差 (Head-relative)
      // 因為我們剛才移除了除以 scale 會亂爆炸的問題，現在的坐標是純粹的 [0, 1] 百分比單位。
      // 所以這權重要調得非常高 (50.0)，才能讓「胸口打」跟「頭頂打」產生極大的懲罰分距！
      const W_HEAD_REL = 50.0;
      let dx_L = liveFeat[s1_offset + 42] - refData.feat[ref_offset + 42];
      let dy_L = liveFeat[s1_offset + 43] - refData.feat[ref_offset + 43];
      dist_L += (dx_L ** 2 + dy_L ** 2) * W_HEAD_REL;
      
      let dx_R = liveFeat[s1_offset + 84] - refData.feat[ref_offset + 84];
      let dy_R = liveFeat[s1_offset + 85] - refData.feat[ref_offset + 85];
      dist_R += (dx_R ** 2 + dy_R ** 2) * W_HEAD_REL;

      // 總合計算 (乘以活躍手權重)
      const sum = dist_head + dist_L * refData.factor_L + dist_R * refData.factor_R;
      
      // 神級核心：動態懲罰機制 (Motion-Weighted DTW)
      // 如果老師的這一幀動作非常大（核心精華動作），就設下極重懲罰(15.0)！你絕對不能跳過這幀！
      // 如果老師的這一幀是不動的（發呆、休息），懲罰極小(2.0)，你可以隨意跳過！
      // 這保證了你「可以比得很快」，而且系統「絕對不會跳過重要動作去跟老師的休息畫面作弊配對」！
      const isMoving = refData.speed[j - 1] > 0.01;
      const skipRefPenalty = isMoving ? 15.0 : 2.0;
      const skipLivePenalty = 2.0;

      const prev_match  = dtwMatrix[(i - 1) * cols + (j - 1)];
      const prev_insert = dtwMatrix[(i - 1) * cols + j] + skipLivePenalty;
      const prev_del    = dtwMatrix[i * cols + (j - 1)] + skipRefPenalty;
      let minPrev = prev_match;
      if (prev_insert < minPrev) minPrev = prev_insert;
      if (prev_del    < minPrev) minPrev = prev_del;
      dtwMatrix[i * cols + j] = sum + minPrev;
    }
  }
  
  // Open-End: 尋找結束點 (i) 最小的組合
  let minDistance = Infinity;
  for (let i = 1; i <= n; i++) {
    if (dtwMatrix[i * cols + m] < minDistance) {
      minDistance = dtwMatrix[i * cols + m];
    }
  }
  
  return minDistance / m;
}

function swapFeatHands(featFlat, frames) {
  const swapped = new Float32Array(featFlat.length);
  for (let f = 0; f < frames; f++) {
    const base = f * 86;
    // 保持頭部特徵不變
    swapped[base] = featFlat[base];
    swapped[base + 1] = featFlat[base + 1];
    
    // 真・鏡像交換：不但左右手值互換，X 座標也要加上負號 (反轉水平方向)
    for (let i = 0; i < 42; i += 2) {
      // 右手 -> 變成倒影的左手
      swapped[base + 2 + i] = -featFlat[base + 44 + i];            // X 座標負號反轉
      swapped[base + 2 + i + 1] = featFlat[base + 44 + i + 1];     // Y 座標不變
      
      // 左手 -> 變成倒影的右手
      swapped[base + 44 + i] = -featFlat[base + 2 + i];            // X 座標負號反轉
      swapped[base + 44 + i + 1] = featFlat[base + 2 + i + 1];     // Y 座標不變
    }
  }
  return swapped;
}

self.onmessage = function(e) {
  const { type, data } = e.data;

  if (type === 'LOAD_GESTURES') {
    fetch('gestures.json')
      .then(res => res.json())
      .then(rawData => {
        loadGestures(rawData);
        const vocab = [];
        for (const [word, entry] of Object.entries(rawData)) {
          vocab.push({ text: word, difficulty: entry.difficulty || 1 });
        }
        self.postMessage({ type: 'GESTURES_LOADED', vocab });
      })
      .catch(err => console.error('Worker failed to fetch gestures.json:', err));
    return;
  }

  if (type === 'MATCH') {
    if (!referenceGestures) {
      self.postMessage({ type: 'RESULT', match: null, score: Infinity });
      return;
    }

    const { liveFlat: rawLive, liveFrames, activeWords } = data;
    // FIX: 依玩家要求設定及格線 30.0
    // 這是一個兼顧「容忍微小失誤」與「防堵嚴重誤判」的黃金平衡點。
    const threshold = 30.0;
    // 🔴 核心修復：即時資料不要壓縮！保留真實影格長度。
    // 這允許 Subsequence DTW 在真實速度的動作中無縫攔截最佳片段。
    const liveFeat = extractFeatures(rawLive, liveFrames);
    const liveFeat_swapped = swapFeatHands(liveFeat, liveFrames);

    let bestWord  = null;
    let bestScore = Infinity;

    for (const word of activeWords) {
      const refs = referenceGestures[word];
      if (!refs || refs.length === 0) continue;

      let wordBestScore = Infinity;
      for (const ref of refs) {
        const s1 = computeDTWEuclidean(liveFeat, liveFrames, ref);
        const s2 = computeDTWEuclidean(liveFeat_swapped, liveFrames, ref);
        const s  = Math.min(s1, s2);
        if (s < wordBestScore) wordBestScore = s;
      }

      if (wordBestScore < bestScore) {
        bestScore = wordBestScore;
        bestWord  = word;
      }
    }

    if (bestScore < threshold) {
      self.postMessage({ type: 'RESULT', match: bestWord, score: bestScore });
    } else {
      self.postMessage({ type: 'RESULT', match: null, score: bestScore });
    }
  }
};

