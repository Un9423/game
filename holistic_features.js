// holistic_features.js
// 從 features_holistic.py 轉換而來的正規化與特徵提取程式碼
// 產生 138 維特徵向量：左手局部正規化(63) + 右手局部正規化(63) + 全局位置(12)

/**
 * 局部手勢歸一化：以掌心中心為原點
 * 掌心中心取：手腕(0), 食指根(5), 中指根(9), 無名指根(13), 小指根(17) 的平均
 * @param {Array|null} landmarks - 21 個手部 landmarks [{x,y,z}, ...]
 * @returns {Float32Array} 63 維向量
 */
function normalizeHandLocal(landmarks) {
  if (!landmarks || landmarks.length === 0) {
    return new Float32Array(63);
  }

  // 轉為 [x, y, z] 陣列
  const points = landmarks.map(lm => [lm.x, lm.y, lm.z]);

  // 計算掌心中心 (幾何中心)
  const palmIndices = [0, 5, 9, 13, 17];
  const palmCenter = [0, 0, 0];
  for (const idx of palmIndices) {
    palmCenter[0] += points[idx][0];
    palmCenter[1] += points[idx][1];
    palmCenter[2] += points[idx][2];
  }
  palmCenter[0] /= palmIndices.length;
  palmCenter[1] /= palmIndices.length;
  palmCenter[2] /= palmIndices.length;

  // 減去中心點 (局部歸一化)
  for (let i = 0; i < points.length; i++) {
    points[i][0] -= palmCenter[0];
    points[i][1] -= palmCenter[1];
    points[i][2] -= palmCenter[2];
  }

  // 以手腕(0)到中指根部(9)的距離進行縮放
  const dx = points[0][0] - points[9][0];
  const dy = points[0][1] - points[9][1];
  const dz = points[0][2] - points[9][2];
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (dist > 1e-6) {
    for (let i = 0; i < points.length; i++) {
      points[i][0] /= dist;
      points[i][1] /= dist;
      points[i][2] /= dist;
    }
  }

  // 展平為 63 維
  const result = new Float32Array(63);
  for (let i = 0; i < 21; i++) {
    result[i * 3]     = points[i][0];
    result[i * 3 + 1] = points[i][1];
    result[i * 3 + 2] = points[i][2];
  }
  return result;
}

/**
 * 提取全局點位原始座標
 * 順序：鼻子(Pose 0), 下巴(Face 152), 左肩(Pose 11), 右肩(Pose 12)
 * @param {Array|null} poseLandmarks
 * @param {Array|null} faceLandmarks
 * @returns {Array} 4×3 矩陣
 */
function getExtraFeaturesRaw(poseLandmarks, faceLandmarks) {
  const pts = [];
  const targets = [
    [poseLandmarks, 0],    // 鼻子
    [faceLandmarks, 152],  // 下巴
    [poseLandmarks, 11],   // 左肩
    [poseLandmarks, 12],   // 右肩
  ];

  for (const [lmSet, idx] of targets) {
    if (lmSet && lmSet.length > idx) {
      pts.push([lmSet[idx].x, lmSet[idx].y, lmSet[idx].z]);
    } else {
      pts.push([0.0, 0.0, 0.0]);
    }
  }
  return pts;
}

/**
 * 從 MediaPipe Holistic 結果提取 138 維特徵向量
 * @param {Object} results - MediaPipe Holistic 的完整結果
 * @returns {Float32Array} 138 維特徵向量
 */
let _extractCallCount = 0;
function extractFrame138(results) {
  const poseLm  = results.poseLandmarks  || null;
  const leftLm  = results.leftHandLandmarks  || null;
  const rightLm = results.rightHandLandmarks || null;
  const faceLm  = results.faceLandmarks  || null;

  // 計算肩膀中心 (作為全局原點)
  let shoulderCenter;
  if (poseLm && poseLm.length > 12) {
    shoulderCenter = [
      (poseLm[11].x + poseLm[12].x) / 2,
      (poseLm[11].y + poseLm[12].y) / 2,
      (poseLm[11].z + poseLm[12].z) / 2,
    ];
  } else {
    shoulderCenter = [0.5, 0.5, 0.0];
  }

  // (A) 局部歸一化 (掌心為原點)
  const lhArr = normalizeHandLocal(leftLm);   // 63 維
  const rhArr = normalizeHandLocal(rightLm);   // 63 維

  // (B) 全局位置 (減去肩膀中心)
  const extraPts = getExtraFeaturesRaw(poseLm, faceLm);
  const extraArr = new Float32Array(12);
  for (let i = 0; i < 4; i++) {
    extraArr[i * 3]     = extraPts[i][0] - shoulderCenter[0];
    extraArr[i * 3 + 1] = extraPts[i][1] - shoulderCenter[1];
    extraArr[i * 3 + 2] = extraPts[i][2] - shoulderCenter[2];
  }

  // 組合 138 維特徵: 左手(63) + 右手(63) + 全局(12)
  const feature = new Float32Array(138);
  feature.set(lhArr, 0);
  feature.set(rhArr, 63);
  feature.set(extraArr, 126);

  // 診斷：更新全局診斷物件（顯示在畫面上）
  _extractCallCount++;
  if (typeof lastFeatureDiag !== 'undefined') {
    const lhZeros = lhArr.filter(v => v === 0).length;
    const rhZeros = rhArr.filter(v => v === 0).length;
    lastFeatureDiag = {
      hasPose: !!poseLm, poseLen: poseLm ? poseLm.length : 0,
      hasFace: !!faceLm, faceLen: faceLm ? faceLm.length : 0,
      hasLeft: !!leftLm, hasRight: !!rightLm,
      lhZeros, rhZeros,
      shoulder: shoulderCenter.map(v => v.toFixed(3)).join(', '),
      extra: Array.from(extraArr).map(v => v.toFixed(3)).join(', '),
    };
  }

  return feature;
}

/**
 * 將特徵緩衝區線性重新取樣到指定幀數
 * 自動偵測特徵維度（支援 66 維和 138 維）
 * @param {Array<Float32Array>} buffer - 每幀特徵的陣列
 * @param {number} targetFrames - 目標幀數 (預設 90)
 * @returns {Float32Array} 展平後的 [targetFrames × dim] 陣列
 */
function prepareModelInput(buffer, targetFrames) {
  targetFrames = targetFrames || 30;  // 新模型只需 30 幀
  const srcFrames = buffer.length;
  
  // 自動偵測維度
  let dim = 66;  // 新模型預設
  if (srcFrames > 0 && buffer[0] && buffer[0].length > 0) {
    dim = buffer[0].length;  // 使用實際的維度
  }
  
  const flat = new Float32Array(targetFrames * dim);

  // 防護：如果buffer為空或過短，返回全0陣列
  if (srcFrames === 0) {
    console.warn(`prepareModelInput: 空的特徵緩衝區，返回 ${targetFrames}×${dim} 全0陣列`);
    return flat;
  }

  for (let i = 0; i < targetFrames; i++) {
    const t = (srcFrames === 1) ? 0 : (i / (targetFrames - 1) * (srcFrames - 1));
    const f0 = Math.floor(t);
    const f1 = Math.min(f0 + 1, srcFrames - 1);
    const alpha = t - f0;

    for (let k = 0; k < dim; k++) {
      const val = buffer[f0][k] * (1 - alpha) + buffer[f1][k] * alpha;
      // 防止NaN滲入
      flat[i * dim + k] = isNaN(val) ? 0 : val;
    }
  }
  
  // 驗證輸出，防止NaN值
  for (let i = 0; i < flat.length; i++) {
    if (isNaN(flat[i])) {
      console.warn(`prepareModelInput: 檢測到NaN在索引 ${i}，設為0`);
      flat[i] = 0;
    }
  }
  
  console.log(`✅ prepareModelInput: ${srcFrames}幀 × ${dim}維 → ${targetFrames}幀 × ${dim}維`);
  return flat;
}

/**
 * 新模型專用：提取 66 維特徵 (精簡版)
 * 只保留關鍵關節：手腕(0) + 各指末端兩節 = 11 個點 × 3 維 = 33 維/手
 * @param {Object} results - MediaPipe Holistic 結果
 * @returns {Float32Array} 66 維向量 (左手33 + 右手33)
 */
function extractFrame66(results) {
  const poseLm  = results.poseLandmarks  || null;
  const leftLm  = results.leftHandLandmarks  || null;
  const rightLm = results.rightHandLandmarks || null;
  const faceLm  = results.faceLandmarks  || null;

  // 計算肩膀中心 (作為全局原點)
  let shoulderCenter;
  if (poseLm && poseLm.length > 12) {
    shoulderCenter = [
      (poseLm[11].x + poseLm[12].x) / 2,
      (poseLm[11].y + poseLm[12].y) / 2,
      (poseLm[11].z + poseLm[12].z) / 2,
    ];
  } else {
    shoulderCenter = [0.5, 0.5, 0.0];
  }

  // 計算肩膀距離
  let shoulderDist = 1.0;
  if (poseLm && poseLm.length > 12) {
    const dx = poseLm[11].x - poseLm[12].x;
    const dy = poseLm[11].y - poseLm[12].y;
    const dz = poseLm[11].z - poseLm[12].z;
    shoulderDist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (shoulderDist < 1e-6) shoulderDist = 1.0;
  }

  // 只保留關鍵關節索引 (手腕 + 各指末端兩節)
  const keepIndices = [0, 3, 4, 7, 8, 11, 12, 15, 16, 19, 20];
  
  // 歸一化手部函數 (與 Python features.py 一致)
  function normalizeHandForModel(lm_list) {
    if (!lm_list || lm_list.length === 0) {
      return new Float32Array(33); // 11 點 × 3 = 33 維
    }

    const points = lm_list.map(lm => [lm.x, lm.y, lm.z]);
    
    // 全為 0 的情況
    if (points.every(p => p.every(v => v === 0))) {
      return new Float32Array(33);
    }

    const res = new Float32Array(63);
    
    // 手腕相對於肩膀中心
    res[0] = (points[0][0] - shoulderCenter[0]) / shoulderDist;
    res[1] = (points[0][1] - shoulderCenter[1]) / shoulderDist;
    res[2] = (points[0][2] - shoulderCenter[2]) / shoulderDist;

    // 計算手部縮放 (手腕到中指根部的距離)
    const handScale = Math.sqrt(
      (points[0][0] - points[9][0])**2 +
      (points[0][1] - points[9][1])**2 +
      (points[0][2] - points[9][2])**2
    );
    const scale = handScale < 1e-6 ? 1.0 : handScale;

    // 其他點相對於手腕
    for (let i = 1; i < 21; i++) {
      res[i*3]     = (points[i][0] - points[0][0]) / scale;
      res[i*3 + 1] = (points[i][1] - points[0][1]) / scale;
      res[i*3 + 2] = (points[i][2] - points[0][2]) / scale;
    }

    // 只保留關鍵關節
    const pruned = new Float32Array(33);
    for (let i = 0; i < keepIndices.length; i++) {
      const srcIdx = keepIndices[i];
      pruned[i*3]     = res[srcIdx*3];
      pruned[i*3 + 1] = res[srcIdx*3 + 1];
      pruned[i*3 + 2] = res[srcIdx*3 + 2];
    }
    
    return pruned;
  }

  // 提取並歸一化雙手
  const lhPruned = normalizeHandForModel(leftLm);
  const rhPruned = normalizeHandForModel(rightLm);

  // 組合 66 維特徵: 左手(33) + 右手(33)
  const feature66 = new Float32Array(66);
  feature66.set(lhPruned, 0);
  feature66.set(rhPruned, 33);

  return feature66;
}

// 🔧 【關鍵！】綁定到全局 window 物件，讓 app.js 能找到
window.extractFrame138 = extractFrame138;
window.extractFrame66 = extractFrame66;
window.prepareModelInput = prepareModelInput;
