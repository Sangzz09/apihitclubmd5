// server.js - Tài Xỉu Prediction API

const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

const SOURCE_API =
  "https://jakpotgwab.geightdors.net/glms/v1/notify/taixiu?platform_id=g8&gid=vgmn_101";

const SERVICE_URL = "https://apihitclubmd5-x6r3.onrender.com/";

// ==================== LƯU LỊCH SỬ ====================
let history = [];
const MAX_HISTORY = 200;

// ==================== HÀM LẤY DỮ LIỆU NGUỒN ====================
async function fetchSource() {
  const res = await fetch(SOURCE_API);
  const json = await res.json();
  if (json.status !== "OK" || !json.data?.length) return null;
  const d = json.data[0];
  const totalEntry = d.bs.find((b) => b.eid === 2);
  const diceEntry = d.bs.find((b) => b.eid === 1);
  if (!totalEntry) return null;

  const total = totalEntry.bc;
  const result = total >= 11 ? "Tài" : "Xỉu";
  const dices = parseDices(diceEntry?.v, total);

  return { sid: d.sid, total, result, dices };
}

function parseDices(seed, total) {
  if (seed) {
    const d1 = ((seed >> 16) & 0xff) % 6 + 1;
    const d2 = ((seed >> 8) & 0xff) % 6 + 1;
    const d3 = (seed & 0xff) % 6 + 1;
    if (d1 + d2 + d3 === total) return [d1, d2, d3];
  }
  for (let i = 0; i < 500; i++) {
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const d3 = total - d1 - d2;
    if (d3 >= 1 && d3 <= 6) return [d1, d2, d3];
  }
  return [1, 1, total - 2 < 1 ? 1 : total - 2];
}

// ==================== CÁC THUẬT TOÁN DỰ ĐOÁN ====================

function algoStreak(hist) {
  if (hist.length < 2) return null;
  const last = hist[hist.length - 1].result;
  let streak = 1;
  for (let i = hist.length - 2; i >= 0; i--) {
    if (hist[i].result === last) streak++;
    else break;
  }
  if (streak >= 4) return last === "Tài" ? "Xỉu" : "Tài";
  if (streak >= 2) return last;
  return null;
}

function algoZigzag(hist) {
  if (hist.length < 4) return null;
  const last4 = hist.slice(-4).map((h) => h.result);
  const isZigzag = last4.every((v, i) =>
    i === 0 ? true : v !== last4[i - 1]
  );
  if (isZigzag) return last4[last4.length - 1] === "Tài" ? "Xỉu" : "Tài";
  return null;
}

function algoMarkov(hist) {
  if (hist.length < 10) return null;
  const counts = { TT: 0, TX: 0, XT: 0, XX: 0 };
  for (let i = 1; i < hist.length; i++) {
    const key = hist[i - 1].result[0] + hist[i].result[0];
    counts[key]++;
  }
  const last = hist[hist.length - 1].result[0];
  const toT = counts[last + "T"] || 0;
  const toX = counts[last + "X"] || 0;
  if (toT + toX === 0) return null;
  return toT > toX ? "Tài" : "Xỉu";
}

function algoFrequency(hist, window = 20) {
  if (hist.length < window) return null;
  const recent = hist.slice(-window);
  const taiCount = recent.filter((h) => h.result === "Tài").length;
  const xiuCount = window - taiCount;
  if (taiCount > xiuCount * 1.5) return "Xỉu";
  if (xiuCount > taiCount * 1.5) return "Tài";
  return taiCount > xiuCount ? "Tài" : "Xỉu";
}

function algoDouble(hist) {
  if (hist.length < 6) return null;
  const last6 = hist.slice(-6).map((h) => h.result);
  if (
    last6[0] === last6[1] &&
    last6[2] === last6[3] &&
    last6[0] !== last6[2] &&
    last6[4] === last6[5] &&
    last6[4] === last6[0]
  ) {
    return last6[5] === "Tài" ? "Xỉu" : "Tài";
  }
  return null;
}

function algoBayesian(hist) {
  if (hist.length < 5) return null;
  let taiScore = 0,
    totalWeight = 0;
  for (let i = 0; i < hist.length; i++) {
    const w = i + 1;
    taiScore += hist[i].result === "Tài" ? w : 0;
    totalWeight += w;
  }
  const prob = taiScore / totalWeight;
  return prob > 0.5 ? "Tài" : "Xỉu";
}

function algoPattern3(hist) {
  if (hist.length < 6) return null;
  const last3 = hist
    .slice(-3)
    .map((h) => h.result[0])
    .join("");
  const pattern = {};
  for (let i = 0; i < hist.length - 3; i++) {
    const p = hist
      .slice(i, i + 3)
      .map((h) => h.result[0])
      .join("");
    if (p === last3) {
      const next = hist[i + 3]?.result[0];
      if (next) pattern[next] = (pattern[next] || 0) + 1;
    }
  }
  if (!pattern.T && !pattern.X) return null;
  return (pattern.T || 0) >= (pattern.X || 0) ? "Tài" : "Xỉu";
}

// ==================== TỔNG HỢP DỰ ĐOÁN ====================
function predict(hist) {
  const algos = [
    { name: "Streak",     fn: () => algoStreak(hist),    weight: 2   },
    { name: "Zigzag",    fn: () => algoZigzag(hist),    weight: 2   },
    { name: "Markov",    fn: () => algoMarkov(hist),    weight: 3   },
    { name: "Frequency", fn: () => algoFrequency(hist), weight: 2   },
    { name: "Double",    fn: () => algoDouble(hist),    weight: 1.5 },
    { name: "Bayesian",  fn: () => algoBayesian(hist),  weight: 2.5 },
    { name: "Pattern3",  fn: () => algoPattern3(hist),  weight: 3   },
  ];

  let taiScore = 0, xiuScore = 0;
  for (const algo of algos) {
    const res = algo.fn();
    if (res === "Tài") taiScore += algo.weight;
    else if (res === "Xỉu") xiuScore += algo.weight;
  }

  const prediction = taiScore >= xiuScore ? "Tài" : "Xỉu";
  const confidence = Math.round(
    (Math.max(taiScore, xiuScore) / (taiScore + xiuScore || 1)) * 100
  );
  const pattern = detectPattern(hist);

  return { prediction, confidence, pattern };
}

function detectPattern(hist) {
  if (hist.length < 4) return "Chưa đủ dữ liệu";
  const last = hist[hist.length - 1].result[0];
  let streak = 1;
  for (let i = hist.length - 2; i >= 0; i--) {
    if (hist[i].result[0] === last) streak++;
    else break;
  }
  if (streak >= 4) return `Cầu bệt ${last === "T" ? "Tài" : "Xỉu"} ${streak} phiên`;
  if (streak === 1) {
    const last4 = hist.slice(-4).map((h) => h.result[0]);
    const isZig = last4.every((v, i) => (i === 0 ? true : v !== last4[i - 1]));
    if (isZig) return "Cầu 1-1 (zigzag)";
    if (last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2])
      return "Cầu 2-2";
  }
  if (streak === 2) return `Cầu 2 ${last === "T" ? "Tài" : "Xỉu"}`;
  if (streak === 3) return `Cầu 3 ${last === "T" ? "Tài" : "Xỉu"}`;
  return "Không rõ cầu";
}

// ==================== POLLING ====================
let lastSid = null;

async function poll() {
  try {
    const data = await fetchSource();
    if (!data) return;
    if (data.sid === lastSid) return;
    lastSid = data.sid;
    history.push({ sid: data.sid, result: data.result, dices: data.dices, total: data.total });
    if (history.length > MAX_HISTORY) history.shift();
    console.log(`[${new Date().toISOString()}] Phiên ${data.sid} → ${data.result} (${data.total})`);
  } catch (e) {
    console.error("Poll error:", e.message);
  }
}

setInterval(poll, 3000);
poll();

// ==================== TỰ PING GIỮ SERVICE LUÔN SỐNG ====================
setInterval(async () => {
  try {
    await fetch(SERVICE_URL);
    console.log(`[PING] Keep-alive OK`);
  } catch (e) {
    console.error(`[PING] Lỗi:`, e.message);
  }
}, 5 * 60 * 1000); // ping mỗi 5 phút

// ==================== ENDPOINTS ====================
app.get("/", (req, res) => {
  if (history.length === 0) {
    return res.json({ status: "loading", message: "Đang tải dữ liệu..." });
  }

  const last = history[history.length - 1];
  const { prediction, confidence, pattern } = predict(history);
  const nextSid = last.sid + 1;

  res.json({
    id: "@sewdangcap",
    phien: last.sid,
    ket_qua: last.result,
    xuc_xac: last.dices,
    phien_du_doan: nextSid,
    du_doan: prediction,
    do_tin_cay: `${confidence}%`,
    pattern: pattern,
  });
});

app.get("/history", (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  res.json({
    id: "@sewdangcap",
    lich_su: history.slice(-limit).reverse(),
    tong_phien: history.length,
  });
});

app.listen(PORT, () => console.log(`API running on port ${PORT}`));
