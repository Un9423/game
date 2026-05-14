// holistic_features.js
// ✅ 74維特徵提取（與 features_72.py 一致）
// 特徵結構：左手(33座標+4幾何) + 右手(33座標+4幾何) = 74維

const KEEP_INDICES = [0, 3, 4, 7, 8, 11, 12, 15, 16, 19, 20];

/**
 * 將特徵緩衝區線性重新取樣到指定幀數
 * @param {Array<Float32Array>} buffer - 每幀特徵的陣列
 * @param {number} targetFrames - 目標幀數 (預設 30)
 * @returns {Float32Array} 展平後的 [targetFrames × 74] 陣列
 */
function prepareModelInput(buffer, targetFrames) {
  targetFrames = targetFrames || 30;
  const dim = 74;  // ✅ 與新模型輸入維度一致

  const flat = new Float32Array(targetFrames * dim);

  if (!buffer || buffer.length === 0) {
    console.warn(`prepareModelInput: 空的特徵緩衝區，返回 ${targetFrames}×${dim} 全0陣列`);
    return flat;
  }

  const srcFrames = buffer.length;

  for (let i = 0; i < targetFrames; i++) {
    const t = (srcFrames === 1) ? 0 : (i / (targetFrames - 1) * (srcFrames - 1));
    const f0 = Math.floor(t);
    const f1 = Math.min(f0 + 1, srcFrames - 1);
    const alpha = t - f0;

    for (let k = 0; k < dim; k++) {
      const val = buffer[f0][k] * (1 - alpha) + buffer[f1][k] * alpha;
      flat[i * dim + k] = isNaN(val) ? 0 : val;
    }
  }

  for (let i = 0; i < flat.length; i++) {
    if (isNaN(flat[i])) { flat[i] = 0; }
  }

  console.log(`✅ prepareModelInput: ${srcFrames}幀 × ${dim}維 → ${targetFrames}幀 × ${dim}維`);
  return flat;
}

/**
 * 歸一化手部 (完整 63 維，21 點 × 3 軸)
 * 與 Python features_72.py 的 normalize_hand_local 一致
 */
function normalizeHandFull(lm_list, shoulderCenter, shoulderDist) {
  if (!lm_list || lm_list.length === 0) {
    return new Float32Array(63);
  }

  const points = lm_list.map(lm => [lm.x, lm.y, lm.z]);
  if (points.every(p => p.every(v => v === 0))) {
    return new Float32Array(63);
  }

  const res = new Float32Array(63);

  // 手腕相對於肩膀中心
  res[0] = (points[0][0] - shoulderCenter[0]) / shoulderDist;
  res[1] = (points[0][1] - shoulderCenter[1]) / shoulderDist;
  res[2] = (points[0][2] - shoulderCenter[2]) / shoulderDist;

  // 計算手部縮放 (手腕到中指根部)
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

  return res;
}

/**
 * 從完整 63 維歸一化手部中提取 4 維幾何特徵
 * 與 Python features_72.py 的 extract_geometric_features 一致
 *
 * 1. 拇指-食指尖距離 (TI-ED)
 * 2. 指尖開合角 (Inter-finger Angle)
 * 3. 指尖到掌面距離 (Tip-to-Plane)
 * 4. 大拇指曲率 (Thumb Curvature)
 */
function extractGeometricFeatures(hand_norm_63) {
  // 檢查全零
  let allZero = true;
  for (let i = 0; i < 63; i++) {
    if (Math.abs(hand_norm_63[i]) > 1e-6) { allZero = false; break; }
  }
  if (allZero) return new Float32Array(4);

  // 重塑為 21 點 × 3 軸
  const pts = [];
  for (let i = 0; i < 21; i++) {
    pts.push([hand_norm_63[i*3], hand_norm_63[i*3+1], hand_norm_63[i*3+2]]);
  }

  // 1. 拇指-食指尖距離 (TI-ED)
  const ti_ed = Math.sqrt(
    (pts[4][0]-pts[8][0])**2 + (pts[4][1]-pts[8][1])**2 + (pts[4][2]-pts[8][2])**2
  );

  // 2. 指尖開合角 (食指 vs 中指方向向量)
  const v1 = pts[8];
  const v2 = pts[12];
  const norm1 = Math.sqrt(v1[0]**2 + v1[1]**2 + v1[2]**2);
  const norm2 = Math.sqrt(v2[0]**2 + v2[1]**2 + v2[2]**2);
  const dot12 = v1[0]*v2[0] + v1[1]*v2[1] + v1[2]*v2[2];
  const cos_theta = dot12 / (norm1 * norm2 + 1e-6);
  const angle = Math.acos(Math.max(-1.0, Math.min(1.0, cos_theta)));

  // 3. 指尖到掌面距離 (Tip-to-Plane)
  // p0 = [0,0,0] (手腕在局部座標系為原點)
  const p1 = pts[5];   // 食指根
  const p2 = pts[17];  // 小指根
  // 法向量 = cross(p1, p2)
  const nx = p1[1]*p2[2] - p1[2]*p2[1];
  const ny = p1[2]*p2[0] - p1[0]*p2[2];
  const nz = p1[0]*p2[1] - p1[1]*p2[0];
  const nlen = Math.sqrt(nx*nx + ny*ny + nz*nz) + 1e-6;
  const dist_to_plane = Math.abs(pts[8][0]*(nx/nlen) + pts[8][1]*(ny/nlen) + pts[8][2]*(nz/nlen));

  // 4. 大拇指曲率
  const vta = [pts[2][0]-pts[3][0], pts[2][1]-pts[3][1], pts[2][2]-pts[3][2]];
  const vtb = [pts[4][0]-pts[3][0], pts[4][1]-pts[3][1], pts[4][2]-pts[3][2]];
  const dot_t = vta[0]*vtb[0] + vta[1]*vtb[1] + vta[2]*vtb[2];
  const norm_ta = Math.sqrt(vta[0]**2 + vta[1]**2 + vta[2]**2);
  const norm_tb = Math.sqrt(vtb[0]**2 + vtb[1]**2 + vtb[2]**2);
  const cos_t = dot_t / (norm_ta * norm_tb + 1e-6);
  const thumb_curv = Math.acos(Math.max(-1.0, Math.min(1.0, cos_t)));

  return new Float32Array([ti_ed, angle, dist_to_plane, thumb_curv]);
}

/**
 * 將 63 維精簡為 33 維 (11 個關鍵點 × 3 軸)
 */
function pruneHand(full_63) {
  const pruned = new Float32Array(33);
  for (let i = 0; i < KEEP_INDICES.length; i++) {
    const srcIdx = KEEP_INDICES[i];
    pruned[i*3]     = full_63[srcIdx*3];
    pruned[i*3 + 1] = full_63[srcIdx*3 + 1];
    pruned[i*3 + 2] = full_63[srcIdx*3 + 2];
  }
  return pruned;
}

/**
 * 提取 74 維特徵
 * 結構：左手(33座標+4幾何) + 右手(33座標+4幾何) = 74維
 * @param {Object} results - MediaPipe Holistic 檢測結果
 * @returns {Float32Array} 74 維向量
 */
function extractFrame74(results) {
  const poseLm  = results.poseLandmarks  || null;
  const leftLm  = results.leftHandLandmarks  || null;
  const rightLm = results.rightHandLandmarks || null;

  // 計算肩膀中心
  let shoulderCenter = [0.5, 0.5, 0.0];
  if (poseLm && poseLm.length > 12) {
    shoulderCenter = [
      (poseLm[11].x + poseLm[12].x) / 2,
      (poseLm[11].y + poseLm[12].y) / 2,
      (poseLm[11].z + poseLm[12].z) / 2,
    ];
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

  // 歸一化 → 幾何特徵 → 精簡
  const lhFull = normalizeHandFull(leftLm, shoulderCenter, shoulderDist);
  const rhFull = normalizeHandFull(rightLm, shoulderCenter, shoulderDist);

  const lhPruned = pruneHand(lhFull);
  const lhGeo    = extractGeometricFeatures(lhFull);
  const rhPruned = pruneHand(rhFull);
  const rhGeo    = extractGeometricFeatures(rhFull);

  // 串接：[LH座標(33), LH幾何(4), RH座標(33), RH幾何(4)] = 74
  const feature74 = new Float32Array(74);
  feature74.set(lhPruned, 0);    // 0~32
  feature74.set(lhGeo, 33);      // 33~36
  feature74.set(rhPruned, 37);   // 37~69
  feature74.set(rhGeo, 70);      // 70~73

  return feature74;
}

// 🔧 綁定到全局 window 物件
window.extractFrame74 = extractFrame74;
window.prepareModelInput = prepareModelInput;
