// server.js - Tài Xỉu Prediction API (Nâng cấp thuật toán)

const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

const SOURCE_API =
  "https://jakpotgwab.geightdors.net/glms/v1/notify/taixiu?platform_id=g8&gid=vgmn_101";

// ==================== LƯU LỊCH SỬ ====================
let history = [];
const MAX_HISTORY = 300;

// ==================== HÀM LẤY DỮ LIỆU NGUỒN ====================
async function fetchSource() {
  const res = await fetch(SOURCE_API);
  const json = await res.json();

  // Chỉ xử lý khi status OK và có data
  if (json.status !== "OK" || !json.data?.length) return null;

  const d = json.data[0];

  // d1, d2, d3 là giá trị xúc xắc trực tiếp từ API
  const d1 = d.d1;
  const d2 = d.d2;
  const d3 = d.d3;

  // Validate: phải là số 1-6
  if (
    typeof d1 !== "number" || typeof d2 !== "number" || typeof d3 !== "number" ||
    d1 < 1 || d1 > 6 || d2 < 1 || d2 > 6 || d3 < 1 || d3 > 6
  ) return null;

  const total  = d1 + d2 + d3;           // 3–18
  const result = total >= 11 ? "Tài" : "Xỉu";

  return {
    sid:   d.sid,
    total,
    result,
    dices: [d1, d2, d3],
  };
}

// ==================== HELPER ====================
const R = (h) => h.result; // "Tài" | "Xỉu"
const T = (h) => h.total;  // số 3-18

// ==================== THUẬT TOÁN DỰ ĐOÁN (v2) ====================

// 1. Streak: cầu bệt dài → đổi; cầu ngắn → theo
function algoStreak(hist) {
  if (hist.length < 2) return null;
  const last = R(hist[hist.length - 1]);
  let streak = 1;
  for (let i = hist.length - 2; i >= 0; i--) {
    if (R(hist[i]) === last) streak++;
    else break;
  }
  if (streak >= 5) return last === "Tài" ? "Xỉu" : "Tài"; // cầu bệt dài → đảo
  if (streak >= 2) return last;                             // cầu ngắn → theo
  return null;
}

// 2. Zigzag: nếu 5 phiên xen kẽ → tiếp tục xen kẽ
function algoZigzag(hist) {
  if (hist.length < 5) return null;
  const last5 = hist.slice(-5).map(R);
  const isZig = last5.every((v, i) => i === 0 || v !== last5[i - 1]);
  if (isZig) return last5[4] === "Tài" ? "Xỉu" : "Tài";
  return null;
}

// 3. Markov bậc 1
function algoMarkov1(hist) {
  if (hist.length < 10) return null;
  const counts = { TT: 0, TX: 0, XT: 0, XX: 0 };
  for (let i = 1; i < hist.length; i++) {
    const key = R(hist[i - 1])[0] + R(hist[i])[0];
    counts[key]++;
  }
  const last = R(hist[hist.length - 1])[0];
  const toT = counts[last + "T"] || 0;
  const toX = counts[last + "X"] || 0;
  if (toT + toX === 0) return null;
  return toT > toX ? "Tài" : "Xỉu";
}

// 4. Markov bậc 2 (xem 2 phiên trước)
function algoMarkov2(hist) {
  if (hist.length < 15) return null;
  const counts = {};
  for (let i = 2; i < hist.length; i++) {
    const key = R(hist[i - 2])[0] + R(hist[i - 1])[0];
    const next = R(hist[i])[0];
    if (!counts[key]) counts[key] = { T: 0, X: 0 };
    counts[key][next]++;
  }
  const last2 = R(hist[hist.length - 2])[0] + R(hist[hist.length - 1])[0];
  const c = counts[last2];
  if (!c || c.T + c.X === 0) return null;
  return c.T >= c.X ? "Tài" : "Xỉu";
}

// 5. Tần suất cửa sổ trượt
function algoFrequency(hist, win = 30) {
  if (hist.length < win) return null;
  const recent = hist.slice(-win);
  const taiCount = recent.filter((h) => R(h) === "Tài").length;
  const xiuCount = win - taiCount;
  // Nếu lệch > 60% → kỳ vọng bù
  if (taiCount / win > 0.62) return "Xỉu";
  if (xiuCount / win > 0.62) return "Tài";
  return taiCount >= xiuCount ? "Tài" : "Xỉu";
}

// 6. Double pattern (AABB → đảo)
function algoDouble(hist) {
  if (hist.length < 6) return null;
  const s = hist.slice(-6).map(R);
  if (
    s[0] === s[1] &&
    s[2] === s[3] &&
    s[0] !== s[2] &&
    s[4] === s[5] &&
    s[4] === s[0]
  ) {
    return s[5] === "Tài" ? "Xỉu" : "Tài";
  }
  return null;
}

// 7. Bayesian có trọng số thời gian (phiên gần hơn quan trọng hơn)
function algoBayesian(hist) {
  if (hist.length < 5) return null;
  let taiScore = 0, totalWeight = 0;
  for (let i = 0; i < hist.length; i++) {
    const w = Math.pow(1.05, i); // tăng theo hàm mũ, phiên mới nặng hơn
    if (R(hist[i]) === "Tài") taiScore += w;
    totalWeight += w;
  }
  const prob = taiScore / totalWeight;
  return prob > 0.5 ? "Tài" : "Xỉu";
}

// 8. Pattern 3 phiên liên tiếp (lookup table)
function algoPattern3(hist) {
  if (hist.length < 6) return null;
  const last3 = hist.slice(-3).map((h) => R(h)[0]).join("");
  const pattern = { T: 0, X: 0 };
  for (let i = 0; i < hist.length - 3; i++) {
    const p = hist.slice(i, i + 3).map((h) => R(h)[0]).join("");
    if (p === last3) {
      const next = hist[i + 3]?.result[0];
      if (next === "T" || next === "X") pattern[next]++;
    }
  }
  if (pattern.T + pattern.X === 0) return null;
  return pattern.T >= pattern.X ? "Tài" : "Xỉu";
}

// 9. Pattern 4 phiên (mạnh hơn pattern3)
function algoPattern4(hist) {
  if (hist.length < 8) return null;
  const last4 = hist.slice(-4).map((h) => R(h)[0]).join("");
  const pattern = { T: 0, X: 0 };
  for (let i = 0; i < hist.length - 4; i++) {
    const p = hist.slice(i, i + 4).map((h) => R(h)[0]).join("");
    if (p === last4) {
      const next = hist[i + 4]?.result[0];
      if (next === "T" || next === "X") pattern[next]++;
    }
  }
  if (pattern.T + pattern.X === 0) return null;
  return pattern.T >= pattern.X ? "Tài" : "Xỉu";
}

// 10. Phân tích tổng điểm (total score trend)
function algoTotalTrend(hist) {
  if (hist.length < 10) return null;
  const recent = hist.slice(-10);
  const avgTotal = recent.reduce((s, h) => s + T(h), 0) / recent.length;
  // Nếu trung bình tổng thấp → khả năng Tài nhiều hơn kỳ tới (bù trừ)
  if (avgTotal < 10) return "Tài";
  if (avgTotal > 14) return "Xỉu";
  return null;
}

// 11. Momentum (xu hướng ngắn hạn 5 phiên gần nhất)
function algoMomentum(hist) {
  if (hist.length < 5) return null;
  const last5 = hist.slice(-5);
  const taiCount = last5.filter((h) => R(h) === "Tài").length;
  if (taiCount >= 4) return "Tài"; // đà Tài mạnh
  if (taiCount <= 1) return "Xỉu"; // đà Xỉu mạnh
  return null;
}

// 12. Entropy / chaos detector — nếu quá hỗn loạn, tin vào tần suất
function algoEntropy(hist) {
  if (hist.length < 20) return null;
  const last20 = hist.slice(-20).map(R);
  let changes = 0;
  for (let i = 1; i < last20.length; i++) {
    if (last20[i] !== last20[i - 1]) changes++;
  }
  const entropy = changes / 19; // 0=bệt hoàn toàn, 1=xen kẽ hoàn toàn
  // Entropy trung bình (0.4-0.6) → dùng tần suất
  const taiCount = last20.filter((r) => r === "Tài").length;
  if (entropy > 0.4 && entropy < 0.6) {
    return taiCount >= 10 ? "Tài" : "Xỉu";
  }
  return null;
}

// ==================== TỔNG HỢP DỰ ĐOÁN ====================
function predict(hist) {
  const algos = [
    { name: "Streak",      fn: () => algoStreak(hist),      weight: 2.0 },
    { name: "Zigzag",      fn: () => algoZigzag(hist),      weight: 2.0 },
    { name: "Markov1",     fn: () => algoMarkov1(hist),     weight: 3.0 },
    { name: "Markov2",     fn: () => algoMarkov2(hist),     weight: 3.5 },
    { name: "Frequency",   fn: () => algoFrequency(hist),   weight: 2.0 },
    { name: "Double",      fn: () => algoDouble(hist),      weight: 1.5 },
    { name: "Bayesian",    fn: () => algoBayesian(hist),    weight: 2.5 },
    { name: "Pattern3",    fn: () => algoPattern3(hist),    weight: 3.0 },
    { name: "Pattern4",    fn: () => algoPattern4(hist),    weight: 4.0 },
    { name: "TotalTrend",  fn: () => algoTotalTrend(hist),  weight: 1.5 },
    { name: "Momentum",    fn: () => algoMomentum(hist),    weight: 2.5 },
    { name: "Entropy",     fn: () => algoEntropy(hist),     weight: 1.5 },
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
    // null = không đủ dữ liệu, bỏ qua
  }

  const prediction = taiScore >= xiuScore ? "Tài" : "Xỉu";
  const total = taiScore + xiuScore || 1;
  const confidence = Math.round((Math.max(taiScore, xiuScore) / total) * 100);
  const pattern = detectPattern(hist);

  return { prediction, confidence, pattern, breakdown, taiScore, xiuScore };
}

function detectPattern(hist) {
  if (hist.length < 4) return "Chưa đủ dữ liệu";
  const last = R(hist[hist.length - 1])[0];
  let streak = 1;
  for (let i = hist.length - 2; i >= 0; i--) {
    if (R(hist[i])[0] === last) streak++;
    else break;
  }
  const label = last === "T" ? "Tài" : "Xỉu";
  if (streak >= 5) return `Cầu bệt ${label} ${streak} phiên (dài)`;
  if (streak >= 4) return `Cầu bệt ${label} ${streak} phiên`;
  if (streak === 1) {
    const last4 = hist.slice(-4).map((h) => R(h)[0]);
    const isZig = last4.every((v, i) => i === 0 || v !== last4[i - 1]);
    if (isZig) return "Cầu 1-1 (zigzag)";
    if (
      last4[0] === last4[1] &&
      last4[2] === last4[3] &&
      last4[0] !== last4[2]
    )
      return "Cầu 2-2";
  }
  if (streak === 2) return `Cầu 2 ${label}`;
  if (streak === 3) return `Cầu 3 ${label}`;
  return "Không rõ cầu";
}

// ==================== THỐNG KÊ ====================
function getStats(hist, win = 50) {
  if (hist.length === 0) return null;
  const recent = hist.slice(-win);
  const taiCount = recent.filter((h) => R(h) === "Tài").length;
  const xiuCount = recent.length - taiCount;
  const avgTotal = recent.reduce((s, h) => s + T(h), 0) / recent.length;
  return {
    window: recent.length,
    tai: taiCount,
    xiu: xiuCount,
    ty_le_tai: `${Math.round((taiCount / recent.length) * 100)}%`,
    ty_le_xiu: `${Math.round((xiuCount / recent.length) * 100)}%`,
    avg_total: Math.round(avgTotal * 10) / 10,
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
    history.push({
      sid: data.sid,
      result: data.result,
      dices: data.dices,
      total: data.total,
    });
    if (history.length > MAX_HISTORY) history.shift();
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
  const { prediction, confidence, pattern, breakdown, taiScore, xiuScore } =
    predict(history);
  const nextSid = last.sid + 1;

  res.json({
    id: "@sewdangcap",
    phien: last.sid,
    ket_qua: last.result,
    xuc_xac: last.dices,
    tong_diem: last.total,
    phien_du_doan: nextSid,
    du_doan: prediction,
    do_tin_cay: `${confidence}%`,
    pattern: pattern,
    thong_ke: getStats(history),
    // chi tiết vote từng thuật toán (bỏ comment nếu muốn debug)
    // debug: { breakdown, taiScore, xiuScore },
  });
});

// GET /history — Lịch sử các phiên
app.get("/history", (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  res.json({
    id: "@sewdangcap",
    lich_su: history.slice(-limit).reverse(),
    tong_phien: history.length,
  });
});

// GET /debug — Xem chi tiết vote từng thuật toán
app.get("/debug", (req, res) => {
  if (history.length === 0) {
    return res.json({ status: "loading" });
  }
  const { prediction, confidence, pattern, breakdown, taiScore, xiuScore } =
    predict(history);
  res.json({
    id: "@sewdangcap",
    prediction,
    confidence: `${confidence}%`,
    pattern,
    taiScore,
    xiuScore,
    breakdown,
    thong_ke: getStats(history),
  });
});

// GET /raw — Xem raw data từ API nguồn (debug parse)
app.get("/raw", async (req, res) => {
  try {
    const r = await fetch(SOURCE_API);
    const json = await r.json();
    res.json(json);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`🚀 API running on port ${PORT}`));
