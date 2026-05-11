// server.js - Tài Xỉu Prediction API (v3 - Anti-streak + More Cầu)

const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

const SOURCE_API =
  "https://jakpotgwab.geightdors.net/glms/v1/notify/taixiu?platform_id=g8&gid=vgmn_101";

// ==================== LƯU LỊCH SỬ ====================
let history = [];
const MAX_HISTORY = 300;

// ==================== CHẶN DỰ ĐOÁN 1 PHÍA QUÁ 3 LẦN ====================
let predictionLog = []; // [{prediction, sid, forced, actual, win}]
const MAX_SAME_PREDICTION = 3;

/**
 * Kiểm tra xem có đang dự đoán 1 phía liên tục >= MAX_SAME_PREDICTION không.
 * Nếu có → buộc đổi chiều.
 */
function applyAntiRepeat(prediction) {
  if (predictionLog.length < MAX_SAME_PREDICTION) return prediction;

  const lastN = predictionLog.slice(-MAX_SAME_PREDICTION);
  const allSame = lastN.every((p) => p.prediction === prediction);

  if (allSame) {
    // Buộc đổi
    return prediction === "Tài" ? "Xỉu" : "Tài";
  }
  return prediction;
}

// ==================== HÀM LẤY DỮ LIỆU NGUỒN ====================
async function fetchSource() {
  const res = await fetch(SOURCE_API);
  const json = await res.json();

  if (json.status !== "OK" || !json.data?.length) return null;

  const d = json.data[0];
  const d1 = d.d1, d2 = d.d2, d3 = d.d3;

  if (
    typeof d1 !== "number" || typeof d2 !== "number" || typeof d3 !== "number" ||
    d1 < 1 || d1 > 6 || d2 < 1 || d2 > 6 || d3 < 1 || d3 > 6
  ) return null;

  const total  = d1 + d2 + d3;
  const result = total >= 11 ? "Tài" : "Xỉu";

  return { sid: d.sid, total, result, dices: [d1, d2, d3] };
}

// ==================== HELPER ====================
const R  = (h) => h.result;   // "Tài" | "Xỉu"
const T  = (h) => h.total;    // 3-18
const R0 = (h) => R(h)[0];    // "T" | "X"

// ==================== THUẬT TOÁN DỰ ĐOÁN (v3) ====================

// 1. Streak — cầu bệt
function algoStreak(hist) {
  if (hist.length < 2) return null;
  const last = R(hist[hist.length - 1]);
  let streak = 1;
  for (let i = hist.length - 2; i >= 0; i--) {
    if (R(hist[i]) === last) streak++;
    else break;
  }
  if (streak >= 6) return last === "Tài" ? "Xỉu" : "Tài"; // bệt rất dài → đảo mạnh
  if (streak >= 4) return last === "Tài" ? "Xỉu" : "Tài"; // bệt dài → đảo
  if (streak >= 2) return last;                             // bệt ngắn → theo
  return null;
}

// 2. Zigzag 1-1
function algoZigzag(hist) {
  if (hist.length < 5) return null;
  const last5 = hist.slice(-5).map(R);
  const isZig = last5.every((v, i) => i === 0 || v !== last5[i - 1]);
  if (isZig) return last5[4] === "Tài" ? "Xỉu" : "Tài";
  return null;
}

// 3. Cầu 2-2 (AABB pattern)
function algoCau22(hist) {
  if (hist.length < 4) return null;
  const s = hist.slice(-4).map(R);
  if (s[0] === s[1] && s[2] === s[3] && s[0] !== s[2]) {
    // Đang bắt đầu cặp mới — tiếp tục theo bên hiện tại
    return s[2]; // theo bên mới nhất
  }
  // Kiểm tra xem có đang trong pattern 2-2 không (đã vào phiên 2 của cặp thứ 2)
  if (hist.length >= 6) {
    const s6 = hist.slice(-6).map(R);
    if (
      s6[0] === s6[1] && s6[2] === s6[3] && s6[0] !== s6[2] &&
      s6[4] === s6[5] && s6[4] === s6[0]
    ) {
      return s6[5] === "Tài" ? "Xỉu" : "Tài"; // chuẩn bị đổi cặp
    }
  }
  return null;
}

// 4. Cầu 1-2 (A BB A BB …)
function algoCau12(hist) {
  if (hist.length < 6) return null;
  const s = hist.slice(-6).map(R0);
  // Pattern: X T T X T T hoặc T X X T X X
  if (
    s[0] !== s[1] && s[1] === s[2] &&
    s[3] !== s[4] && s[4] === s[5] &&
    s[0] === s[3]
  ) {
    // Kỳ tiếp: đơn
    return s[5] === "T" ? "Xỉu" : "Tài"; // đổi sau cặp đôi
  }
  return null;
}

// 5. Cầu 2-1 (AA B AA B …)
function algoCau21(hist) {
  if (hist.length < 6) return null;
  const s = hist.slice(-6).map(R0);
  if (
    s[0] === s[1] && s[1] !== s[2] &&
    s[3] === s[4] && s[4] !== s[5] &&
    s[0] === s[3] && s[2] === s[5]
  ) {
    // Pattern AA-B lặp → kỳ tới là AA
    return s[4] === "T" ? "Tài" : "Xỉu";
  }
  return null;
}

// 6. Cầu 3-1 (AAA B AAA B …)
function algoCau31(hist) {
  if (hist.length < 8) return null;
  const s = hist.slice(-8).map(R0);
  if (
    s[0] === s[1] && s[1] === s[2] && s[2] !== s[3] &&
    s[4] === s[5] && s[5] === s[6] && s[6] !== s[7] &&
    s[0] === s[4] && s[3] === s[7]
  ) {
    return s[6] === "T" ? "Tài" : "Xỉu"; // theo chuỗi 3
  }
  return null;
}

// 7. Cầu 1-3 (A BBB A BBB …)
function algoCau13(hist) {
  if (hist.length < 8) return null;
  const s = hist.slice(-8).map(R0);
  if (
    s[0] !== s[1] && s[1] === s[2] && s[2] === s[3] &&
    s[4] !== s[5] && s[5] === s[6] && s[6] === s[7] &&
    s[0] === s[4]
  ) {
    return s[7] === "T" ? "Tài" : "Xỉu"; // theo chuỗi 3 tiếp
  }
  return null;
}

// 8. Cầu gãy (phát hiện pattern bị phá vỡ → theo chiều mới)
function algoCauGay(hist) {
  if (hist.length < 5) return null;
  const s = hist.slice(-5).map(R);
  // Cầu bệt bị gãy: AAAB → theo B
  const dominant = s[0];
  const breakAt  = s.findIndex((v) => v !== dominant);
  if (breakAt === 3 && s[4] === s[3]) {
    return s[4]; // theo chiều gãy
  }
  return null;
}

// 9. Cầu xen kẽ ngắn (2 lần zigzag → đảo)
function algoCauXenKe(hist) {
  if (hist.length < 6) return null;
  const s = hist.slice(-6).map(R);
  const zigCount = s.filter((v, i) => i > 0 && v !== s[i - 1]).length;
  if (zigCount >= 4) return s[5] === "Tài" ? "Xỉu" : "Tài";
  return null;
}

// 10. Markov bậc 1
function algoMarkov1(hist) {
  if (hist.length < 10) return null;
  const counts = { TT: 0, TX: 0, XT: 0, XX: 0 };
  for (let i = 1; i < hist.length; i++) {
    const key = R0(hist[i - 1]) + R0(hist[i]);
    counts[key]++;
  }
  const last = R0(hist[hist.length - 1]);
  const toT  = counts[last + "T"] || 0;
  const toX  = counts[last + "X"] || 0;
  if (toT + toX === 0) return null;
  return toT > toX ? "Tài" : "Xỉu";
}

// 11. Markov bậc 2
function algoMarkov2(hist) {
  if (hist.length < 15) return null;
  const counts = {};
  for (let i = 2; i < hist.length; i++) {
    const key  = R0(hist[i - 2]) + R0(hist[i - 1]);
    const next = R0(hist[i]);
    if (!counts[key]) counts[key] = { T: 0, X: 0 };
    counts[key][next]++;
  }
  const last2 = R0(hist[hist.length - 2]) + R0(hist[hist.length - 1]);
  const c = counts[last2];
  if (!c || c.T + c.X === 0) return null;
  return c.T >= c.X ? "Tài" : "Xỉu";
}

// 12. Tần suất cửa sổ trượt (cân bằng hơn — tránh thiên vị)
function algoFrequency(hist, win = 30) {
  if (hist.length < win) return null;
  const recent   = hist.slice(-win);
  const taiCount = recent.filter((h) => R(h) === "Tài").length;
  const xiuCount = win - taiCount;
  // Chỉ kết luận khi lệch đáng kể (>= 65%)
  if (taiCount / win > 0.65) return "Xỉu"; // quá nhiều Tài → bù Xỉu
  if (xiuCount / win > 0.65) return "Tài";  // quá nhiều Xỉu → bù Tài
  return null; // cân bằng → không vote
}

// 13. Bayesian có trọng số thời gian
function algoBayesian(hist) {
  if (hist.length < 5) return null;
  let taiScore = 0, totalWeight = 0;
  for (let i = 0; i < hist.length; i++) {
    const w = Math.pow(1.05, i);
    if (R(hist[i]) === "Tài") taiScore += w;
    totalWeight += w;
  }
  const prob = taiScore / totalWeight;
  // Chỉ vote khi xác suất lệch rõ (>55%)
  if (prob > 0.55) return "Tài";
  if (prob < 0.45) return "Xỉu";
  return null;
}

// 14. Pattern 3 phiên (lookup)
function algoPattern3(hist) {
  if (hist.length < 6) return null;
  const last3 = hist.slice(-3).map(R0).join("");
  const pattern = { T: 0, X: 0 };
  for (let i = 0; i < hist.length - 3; i++) {
    const p = hist.slice(i, i + 3).map(R0).join("");
    if (p === last3) {
      const next = hist[i + 3]?.result[0];
      if (next === "T" || next === "X") pattern[next]++;
    }
  }
  if (pattern.T + pattern.X === 0) return null;
  return pattern.T >= pattern.X ? "Tài" : "Xỉu";
}

// 15. Pattern 4 phiên (mạnh hơn)
function algoPattern4(hist) {
  if (hist.length < 8) return null;
  const last4 = hist.slice(-4).map(R0).join("");
  const pattern = { T: 0, X: 0 };
  for (let i = 0; i < hist.length - 4; i++) {
    const p = hist.slice(i, i + 4).map(R0).join("");
    if (p === last4) {
      const next = hist[i + 4]?.result[0];
      if (next === "T" || next === "X") pattern[next]++;
    }
  }
  if (pattern.T + pattern.X === 0) return null;
  return pattern.T >= pattern.X ? "Tài" : "Xỉu";
}

// 16. Tổng điểm xu hướng
function algoTotalTrend(hist) {
  if (hist.length < 10) return null;
  const recent   = hist.slice(-10);
  const avgTotal = recent.reduce((s, h) => s + T(h), 0) / recent.length;
  if (avgTotal < 9.5)  return "Tài";
  if (avgTotal > 14.5) return "Xỉu";
  return null;
}

// 17. Momentum ngắn hạn
function algoMomentum(hist) {
  if (hist.length < 5) return null;
  const last5    = hist.slice(-5);
  const taiCount = last5.filter((h) => R(h) === "Tài").length;
  if (taiCount >= 4) return "Tài";
  if (taiCount <= 1) return "Xỉu";
  return null;
}

// 18. Entropy / chaos detector
function algoEntropy(hist) {
  if (hist.length < 20) return null;
  const last20 = hist.slice(-20).map(R);
  let changes = 0;
  for (let i = 1; i < last20.length; i++) {
    if (last20[i] !== last20[i - 1]) changes++;
  }
  const entropy  = changes / 19;
  const taiCount = last20.filter((r) => r === "Tài").length;
  if (entropy > 0.4 && entropy < 0.6) {
    return taiCount >= 10 ? "Tài" : "Xỉu";
  }
  return null;
}

// 19. Cầu tuyến tính (phát hiện xu hướng đơn điệu)
function algoCauTuyenTinh(hist) {
  if (hist.length < 8) return null;
  // Đếm lần đổi trong 8 phiên gần nhất
  const last8 = hist.slice(-8).map(R);
  let changes = 0;
  for (let i = 1; i < last8.length; i++) {
    if (last8[i] !== last8[i - 1]) changes++;
  }
  if (changes <= 1) {
    // Bệt rất dài → chuẩn bị đảo
    return last8[7] === "Tài" ? "Xỉu" : "Tài";
  }
  return null;
}

// 20. Cầu nhịp đôi (ABABAB → tiếp tục hoặc đảo nếu có 3 cặp liên tiếp)
function algoCauNhipDoi(hist) {
  if (hist.length < 8) return null;
  const s = hist.slice(-8).map(R);
  // Kiểm tra xen kẽ hoàn toàn 8 phiên
  const allZig = s.every((v, i) => i === 0 || v !== s[i - 1]);
  if (allZig) {
    // Zigzag kéo dài → có thể gãy → đảo khả năng gãy
    return s[7] === "Tài" ? "Xỉu" : "Tài";
  }
  return null;
}

// ==================== TỔNG HỢP DỰ ĐOÁN ====================
function predict(hist) {
  const algos = [
    { name: "Streak",       fn: () => algoStreak(hist),       weight: 2.5 },
    { name: "Zigzag",       fn: () => algoZigzag(hist),       weight: 2.0 },
    { name: "Cầu2-2",      fn: () => algoCau22(hist),         weight: 2.5 },
    { name: "Cầu1-2",      fn: () => algoCau12(hist),         weight: 2.0 },
    { name: "Cầu2-1",      fn: () => algoCau21(hist),         weight: 2.0 },
    { name: "Cầu3-1",      fn: () => algoCau31(hist),         weight: 2.0 },
    { name: "Cầu1-3",      fn: () => algoCau13(hist),         weight: 2.0 },
    { name: "CầuGãy",      fn: () => algoCauGay(hist),        weight: 2.5 },
    { name: "CầuXenKẽ",   fn: () => algoCauXenKe(hist),      weight: 2.0 },
    { name: "CầuTuyến",   fn: () => algoCauTuyenTinh(hist),  weight: 2.0 },
    { name: "CầuNhịp",    fn: () => algoCauNhipDoi(hist),    weight: 1.5 },
    { name: "Markov1",      fn: () => algoMarkov1(hist),      weight: 3.0 },
    { name: "Markov2",      fn: () => algoMarkov2(hist),      weight: 3.5 },
    { name: "Frequency",    fn: () => algoFrequency(hist),    weight: 2.0 },
    { name: "Bayesian",     fn: () => algoBayesian(hist),     weight: 2.0 },
    { name: "Pattern3",     fn: () => algoPattern3(hist),     weight: 3.0 },
    { name: "Pattern4",     fn: () => algoPattern4(hist),     weight: 3.5 },
    { name: "TotalTrend",   fn: () => algoTotalTrend(hist),   weight: 1.5 },
    { name: "Momentum",     fn: () => algoMomentum(hist),     weight: 2.5 },
    { name: "Entropy",      fn: () => algoEntropy(hist),      weight: 1.5 },
  ];

  let taiScore = 0, xiuScore = 0;
  const breakdown = [];

  for (const algo of algos) {
    const res = algo.fn();
    if (res === "Tài") {
      taiScore += algo.weight;
      breakdown.push({ name: algo.name, vote: "Tài", w: algo.weight });
    } else if (res === "Xỉu") {
      xiuScore += algo.weight;
      breakdown.push({ name: algo.name, vote: "Xỉu", w: algo.weight });
    }
  }

  let rawPrediction = taiScore >= xiuScore ? "Tài" : "Xỉu";

  // ===== CHẶN DỰ ĐOÁN 1 PHÍA QUÁ 3 LẦN =====
  const finalPrediction = applyAntiRepeat(rawPrediction);
  const wasForced = finalPrediction !== rawPrediction;

  const total      = taiScore + xiuScore || 1;
  const confidence = Math.round((Math.max(taiScore, xiuScore) / total) * 100);
  const pattern    = detectPattern(hist);

  return {
    prediction: finalPrediction,
    rawPrediction,
    wasForced,
    confidence,
    pattern,
    breakdown,
    taiScore,
    xiuScore,
  };
}

// ==================== PHÁT HIỆN CẦU ====================
function detectPattern(hist) {
  if (hist.length < 4) return "Chưa đủ dữ liệu";

  const n = hist.length;

  // --- Cầu bệt ---
  const last = R(hist[n - 1]);
  let streak = 1;
  for (let i = n - 2; i >= 0; i--) {
    if (R(hist[i]) === last) streak++;
    else break;
  }
  if (streak >= 7) return `🔴 Cầu bệt ${last} ${streak} phiên (siêu dài)`;
  if (streak >= 5) return `🔴 Cầu bệt ${last} ${streak} phiên (dài)`;
  if (streak >= 4) return `🟡 Cầu bệt ${last} ${streak} phiên`;

  // --- Cầu 1-1 zigzag ---
  if (hist.length >= 6) {
    const s6 = hist.slice(-6).map(R);
    const isZig6 = s6.every((v, i) => i === 0 || v !== s6[i - 1]);
    if (isZig6) return "🔵 Cầu 1-1 (zigzag 6 phiên)";
    const s4 = hist.slice(-4).map(R);
    const isZig4 = s4.every((v, i) => i === 0 || v !== s4[i - 1]);
    if (isZig4) return "🔵 Cầu 1-1 (zigzag 4 phiên)";
  }

  // --- Cầu 2-2 ---
  if (hist.length >= 4) {
    const s4 = hist.slice(-4).map(R);
    if (s4[0] === s4[1] && s4[2] === s4[3] && s4[0] !== s4[2]) {
      return `🟢 Cầu 2-2 (${s4[0][0]}${s4[0][0]}${s4[2][0]}${s4[2][0]})`;
    }
  }

  // --- Cầu 3-1 ---
  if (hist.length >= 4) {
    const s4 = hist.slice(-4).map(R);
    if (s4[0] === s4[1] && s4[1] === s4[2] && s4[2] !== s4[3]) {
      return `🟢 Cầu 3-1 (${s4[0]} x3 → gãy)`;
    }
  }

  // --- Cầu 1-3 ---
  if (hist.length >= 4) {
    const s4 = hist.slice(-4).map(R);
    if (s4[0] !== s4[1] && s4[1] === s4[2] && s4[2] === s4[3]) {
      return `🟢 Cầu 1-3 (đơn → ${s4[1]} x3)`;
    }
  }

  // --- Cầu 2-1 ---
  if (hist.length >= 6) {
    const s6 = hist.slice(-6).map(R);
    if (
      s6[0] === s6[1] && s6[1] !== s6[2] &&
      s6[3] === s6[4] && s6[4] !== s6[5] &&
      s6[0] === s6[3]
    ) {
      return `🟢 Cầu 2-1 (${s6[0][0]}${s6[0][0]}${s6[2][0]} lặp)`;
    }
  }

  // --- Cầu 1-2 ---
  if (hist.length >= 6) {
    const s6 = hist.slice(-6).map(R);
    if (
      s6[0] !== s6[1] && s6[1] === s6[2] &&
      s6[3] !== s6[4] && s6[4] === s6[5] &&
      s6[0] === s6[3]
    ) {
      return `🟢 Cầu 1-2 (${s6[0][0]}${s6[1][0]}${s6[1][0]} lặp)`;
    }
  }

  // --- Cầu gãy sau bệt ---
  if (streak === 1 && hist.length >= 5) {
    const prev = hist.slice(-5, -1).map(R);
    const allSame = prev.every((v) => v === prev[0]);
    if (allSame && prev[0] !== last) {
      return `⚡ Cầu gãy (${prev[0]} x4 → ${last})`;
    }
  }

  // --- Cầu 2 ---
  if (streak === 2) return `🟡 Cầu 2 ${last}`;
  if (streak === 3) return `🟡 Cầu 3 ${last}`;

  // --- Fallback: nhận diện từ chuỗi ngắn ---
  if (hist.length >= 4) {
    const s4 = hist.slice(-4).map((h) => R(h)[0]);
    return `Chuỗi gần: ${s4.join("-")}`;
  }

  return "Không rõ cầu";
}

// ==================== THỐNG KÊ ====================
function getStats(hist, win = 50) {
  if (hist.length === 0) return null;
  const recent   = hist.slice(-win);
  const taiCount = recent.filter((h) => R(h) === "Tài").length;
  const xiuCount = recent.length - taiCount;
  const avgTotal = recent.reduce((s, h) => s + T(h), 0) / recent.length;
  return {
    window:    recent.length,
    tai:       taiCount,
    xiu:       xiuCount,
    ty_le_tai: `${Math.round((taiCount / recent.length) * 100)}%`,
    ty_le_xiu: `${Math.round((xiuCount / recent.length) * 100)}%`,
    avg_total: Math.round(avgTotal * 10) / 10,
  };
}

// ==================== THỐNG KÊ DỰ ĐOÁN (THẮNG/THUA) ====================
function getPredictionStats(limit = 20) {
  // Chỉ lấy những phiên đã có kết quả thực
  const resolved = predictionLog.filter((p) => p.actual !== undefined);
  if (resolved.length === 0) return null;

  const recent   = resolved.slice(-limit);
  const wins     = recent.filter((p) => p.win).length;
  const losses   = recent.length - wins;
  const winRate  = recent.length > 0 ? Math.round((wins / recent.length) * 100) : 0;

  // Streak hiện tại (W hoặc L)
  let curStreak = 0, curStreakType = null;
  for (let i = recent.length - 1; i >= 0; i--) {
    const t = recent[i].win ? "W" : "L";
    if (curStreakType === null) { curStreakType = t; curStreak = 1; }
    else if (t === curStreakType) curStreak++;
    else break;
  }

  // Streak thắng dài nhất
  let bestStreak = 0, tmp = 0;
  for (const p of resolved) {
    if (p.win) { tmp++; bestStreak = Math.max(bestStreak, tmp); }
    else tmp = 0;
  }

  // Forced flip accuracy
  const forcedResolved = resolved.filter((p) => p.forced);
  const forcedWins     = forcedResolved.filter((p) => p.win).length;

  return {
    tong_du_doan:    resolved.length,
    cua_so_gan_nhat: recent.length,
    thang:           wins,
    thua:            losses,
    ty_le_thang:     `${winRate}%`,
    streak_hien_tai: curStreakType === "W"
      ? `🔥 Thắng ${curStreak} liên tiếp`
      : `❄️ Thua ${curStreak} liên tiếp`,
    streak_thang_dai_nhat: `🏆 ${bestStreak} phiên`,
    forced_flip: {
      tong:      forcedResolved.length,
      thang:     forcedWins,
      ty_le:     forcedResolved.length
        ? `${Math.round((forcedWins / forcedResolved.length) * 100)}%`
        : "N/A",
    },
  };
}

// ==================== POLLING ====================
let lastSid = null;

async function poll() {
  try {
    const data = await fetchSource();
    if (!data) return;
    if (data.sid === lastSid) return;
    lastSid = data.sid;

    // ── Đánh dấu thắng/thua cho dự đoán của phiên này ──
    const prevPred = predictionLog.find((p) => p.sid === data.sid && p.actual === undefined);
    if (prevPred) {
      prevPred.actual = data.result;
      prevPred.win    = prevPred.prediction === data.result;
    }

    history.push({
      sid:    data.sid,
      result: data.result,
      dices:  data.dices,
      total:  data.total,
    });
    if (history.length > MAX_HISTORY) history.shift();

    // Sinh dự đoán cho phiên tiếp theo và lưu log
    if (history.length >= 3) {
      const { prediction, wasForced } = predict(history);
      predictionLog.push({
        prediction,
        sid:    data.sid + 1,
        forced: wasForced,
        actual: undefined,
        win:    undefined,
      });
      if (predictionLog.length > 200) predictionLog.shift();
    }

    console.log(
      `[${new Date().toISOString()}] Phiên ${data.sid} → ${data.result} (${data.total}) 🎲 [${data.dices.join(",")}]`
    );
  } catch (e) {
    console.error("Poll error:", e.message);
  }
}

setInterval(poll, 3000);
poll();

// ==================== ENDPOINTS ====================

// GET / — Dự đoán phiên tiếp theo
app.get("/", (req, res) => {
  if (history.length === 0) {
    return res.json({ status: "loading", message: "Đang tải dữ liệu..." });
  }

  const last = history[history.length - 1];
  const {
    prediction, rawPrediction, wasForced,
    confidence, pattern, breakdown, taiScore, xiuScore,
  } = predict(history);
  const nextSid = last.sid + 1;

  res.json({
    id:             "@sewdangcap",
    phien:          last.sid,
    ket_qua:        last.result,
    xuc_xac:        last.dices,
    tong_diem:      last.total,
    phien_du_doan:  nextSid,
    du_doan:        prediction,
    do_tin_cay:     `${confidence}%`,
    pattern:        pattern,
    anti_repeat:    wasForced ? "⚠️ Đã đảo chiều (chặn 3 lần liên tiếp)" : "OK",
    thong_ke:       getStats(history),
    thong_ke_du_doan: getPredictionStats(20),
    // debug: { breakdown, taiScore, xiuScore },
  });
});

// GET /history — Lịch sử các phiên
app.get("/history", (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  res.json({
    id:        "@sewdangcap",
    lich_su:   history.slice(-limit).reverse(),
    tong_phien: history.length,
  });
});

// GET /debug — Xem chi tiết vote từng thuật toán
app.get("/debug", (req, res) => {
  if (history.length === 0) {
    return res.json({ status: "loading" });
  }
  const {
    prediction, rawPrediction, wasForced,
    confidence, pattern, breakdown, taiScore, xiuScore,
  } = predict(history);
  res.json({
    id:           "@sewdangcap",
    prediction,
    raw_prediction: rawPrediction,
    was_forced:   wasForced,
    confidence:   `${confidence}%`,
    pattern,
    taiScore,
    xiuScore,
    breakdown,
    thong_ke:     getStats(history),
    thong_ke_du_doan: getPredictionStats(20),
  });
});

// GET /thongke — Thống kê thắng/thua chi tiết
app.get("/thongke", (req, res) => {
  const limit   = parseInt(req.query.limit) || 50;
  const stats   = getPredictionStats(limit);
  const resolved = predictionLog.filter((p) => p.actual !== undefined);

  if (!stats) {
    return res.json({
      id:      "@sewdangcap",
      status:  "⏳ Chưa đủ dữ liệu để thống kê",
      message: "Cần ít nhất 1 phiên đã có kết quả thực.",
    });
  }

  // Lịch sử gần nhất có kết quả (mới nhất đầu)
  const recentResolved = resolved.slice(-limit).reverse().map((p) => ({
    "📌 Phiên":    p.sid,
    "🔮 Dự đoán": p.prediction,
    "🎲 Thực tế": p.actual,
    "📊 Kết quả": p.win ? "✅ Thắng" : "❌ Thua",
    "⚡ Force":   p.forced ? "Có" : "—",
  }));

  // Bar tỉ lệ thắng (ASCII)
  const winPct = parseInt(stats.ty_le_thang);
  const bar    = "█".repeat(Math.round(winPct / 5)) + "░".repeat(20 - Math.round(winPct / 5));

  res.json({
    id:    "@sewdangcap",
    "═══════ 🏅 TỔNG QUAN ═══════": null,
    "📈 Tổng phiên đã dự đoán":     stats.tong_du_doan,
    "🔍 Cửa sổ phân tích":          `${stats.cua_so_gan_nhat} phiên gần nhất`,
    "✅ Thắng":                      stats.thang,
    "❌ Thua":                       stats.thua,
    "🎯 Tỉ lệ thắng":               stats.ty_le_thang,
    "📊 Biểu đồ":                   `[${bar}] ${stats.ty_le_thang}`,
    "═══════ 🔥 CHUỖI ═══════": null,
    "⚡ Streak hiện tại":           stats.streak_hien_tai,
    "🏆 Streak thắng dài nhất":    stats.streak_thang_dai_nhat,
    "═══════ ⚡ FORCE FLIP ═══════": null,
    "🔄 Tổng lần force đảo":        stats.forced_flip.tong,
    "✅ Thắng sau force":            stats.forced_flip.thang,
    "🎯 Tỉ lệ thắng khi force":    stats.forced_flip.ty_le,
    "═══════ 📜 LỊCH SỬ ═══════": null,
    lich_su: recentResolved,
  });
});


app.get("/raw", async (req, res) => {
  try {
    const r    = await fetch(SOURCE_API);
    const json = await r.json();
    res.json(json);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`🚀 API running on port ${PORT}`));
