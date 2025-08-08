// ------- helpers -------
const $ = (id) => document.getElementById(id);
const fmtJPY = (n) => n.toLocaleString("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });

// ------- defaults（従来値を少し上げる／未請求回収率=1%） -------
const defaults = {
  headcount: 50,
  invoice: 20,
  wage: 1800,
  paper: 8000,
  permRate: 60,
  daysPerm: 21,
  daysTemp: 12,
  unitPrice: 14437,
  leakage: 1.0, // %
  // 分/単位（従来→新）
  t1_old: 16.3, t1_new: 4.8, // 勤務管理（分）
  t2_old: 19.8, t2_new: 4.8, // 請求作成（分）
  t3_old: 17.9, t3_new: 3.0, // 給与作成（分）
  t4_old: 27.4, t4_new: 1.8, // 書類作成（分）
  t5_old: 18.7, t5_new: 1.2, // 連絡業務（分）
  // 再投資
  paperReductionRate: 70, // %
  salesRate: 50, // %
  eduRate: 50,   // %
  hoursPerDeal: 20, // h/件
  avgMonthlyRevenue: 600000, // 円/件
  grossMarginRate: 25, // %
  recruitTrainCost: 250000, // 円/人
  attritionImprovementPct: 5, // %
  complaintsReduction: 5, // 件/月
  complaintCost: 5000 // 円/件
};

// ------- init -------
function setDefaults() {
  Object.entries(defaults).forEach(([k, v]) => { if ($(k)) $(k).value = v; });
  syncPerm(defaults.permRate);
  calc();
}

window.addEventListener("DOMContentLoaded", () => {
  // live calc
  document.querySelectorAll("input").forEach((el) => el.addEventListener("input", calc));

  // modals
  $("btn-advanced").addEventListener("click", () => openModal("modal-advanced"));
  $("btn-sources").addEventListener("click", () => openModal("modal-sources"));
  document.querySelectorAll("[data-close]").forEach(btn => btn.addEventListener("click", closeModal));
  document.querySelectorAll(".modal").forEach(m =>
    m.addEventListener("click", (e) => { if (e.target === m) closeModal(); })
  );
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  // 配分率の自動補正
  const syncRates = () => {
    const s = Math.max(0, Math.min(100, val("salesRate")));
    const e = 100 - s;
    if ($("salesRate")) $("salesRate").value = s;
    if ($("eduRate"))   $("eduRate").value = e;
  };
  if ($("salesRate") && $("eduRate")){
    $("salesRate").addEventListener("input", () => { syncRates(); calc(); });
    $("eduRate").addEventListener("input", () => {
      const e = Math.max(0, Math.min(100, val("eduRate")));
      const s = 100 - e;
      if ($("eduRate"))   $("eduRate").value = e;
      if ($("salesRate")) $("salesRate").value = s;
      calc();
    });
    syncRates();
  }

  $("resetBtn").addEventListener("click", setDefaults);
  window.addEventListener("resize", calc);

  setDefaults();
});

// ------- modal helpers -------
function openModal(id){ $(id).hidden = false; }
function closeModal(){ document.querySelectorAll(".modal").forEach(m => m.hidden = true); }

// ------- sync -------
function syncPerm(v) {
  const p = Number(v);
  if ($("permView")) $("permView").textContent = `常用 ${p}% / 臨時 ${100 - p}%`;
}

// ------- core calc -------
function val(id) { return Number($(id).value || 0); }

function calc() {
  if ($("permRate")) syncPerm($("permRate").value);

  const headcount = val("headcount");
  const invoice   = val("invoice");
  const wage      = val("wage");
  const paper     = val("paper");

  const permRate  = val("permRate")/100;
  const daysPerm  = val("daysPerm");
  const daysTemp  = val("daysTemp");
  const unitPrice = val("unitPrice");
  const leakage   = val("leakage")/100;

  // 再投資（パラメータ）
  // 配分率（相互補正）
  let salesRate = $("salesRate") ? val("salesRate")/100 : 0.5;
  let eduRate   = $("eduRate")   ? val("eduRate")/100   : 0.5;
  if ($("salesRate") && $("eduRate")){
    const s = Math.max(0, Math.min(1, salesRate));
    const e = 1 - s;
    salesRate = s; eduRate = e;
    $("salesRate").value = Math.round(s*100);
    $("eduRate").value   = Math.round(e*100);
  }
  const hoursPerDeal = Math.max(1, $("hoursPerDeal") ? val("hoursPerDeal") : 20);
  const avgMonthlyRevenue = $("avgMonthlyRevenue") ? val("avgMonthlyRevenue") : 600000;
  const grossMarginRate = $("grossMarginRate") ? val("grossMarginRate")/100 : 0.25;
  const recruitTrainCost = $("recruitTrainCost") ? val("recruitTrainCost") : 250000;
  const attritionImprovementPct = $("attritionImprovementPct") ? val("attritionImprovementPct")/100 : 0.05;
  const complaintsReduction = $("complaintsReduction") ? val("complaintsReduction") : 5;
  const complaintCost = $("complaintCost") ? val("complaintCost") : 5000;
  const paperReductionRate = $("paperReductionRate") ? val("paperReductionRate")/100 : 0.7;

  // task time deltas（分→h）
  const d1 = ((val("t1_old") - val("t1_new")) / 60) * headcount; // 勤務管理
  const d2 = ((val("t2_old") - val("t2_new")) / 60) * invoice;   // 請求作成
  const d3 = ((val("t3_old") - val("t3_new")) / 60) * headcount; // 給与作成
  const d4 = ((val("t4_old") - val("t4_new")) / 60) * headcount; // 書類作成
  const d5 = ((val("t5_old") - val("t5_new")) / 60) * headcount; // 連絡業務
  const sumH = Math.max(0, d1 + d2 + d3 + d4 + d5);

  const saveAmount = sumH * wage;

  // 売上モデル：常用/臨時×勤務日×係数
  const sales = unitPrice * ((headcount * permRate) * daysPerm + (headcount * (1 - permRate)) * daysTemp);

  // 未請求回収
  const recovery = sales * leakage;

  // 月間純メリット（基礎）＝ 時間削減×時給 + 未請求回収 + 紙等×削減率
  const baseNet = Math.max(0, saveAmount + recovery + paper * paperReductionRate);

  // 営業効果
  const salesAllocatedHours = sumH * salesRate;
  const profitPerDeal = avgMonthlyRevenue * grossMarginRate;
  const salesEffect = Math.max(0, (salesAllocatedHours / hoursPerDeal) * profitPerDeal);

  // 教育効果（人数比例）
  const attritionEffect = (headcount * attritionImprovementPct * recruitTrainCost) / 12;
  const complaintsEffect = complaintsReduction * complaintCost;
  const eduEffect = Math.max(0, attritionEffect + complaintsEffect);

  // 再投資合計
  const reinvestTotal = salesEffect + eduEffect;

  // 年間換算（再投資込み）
  const year = (baseNet + reinvestTotal) * 12;

  // KPI
  $("kpiNet").textContent   = fmtJPY(baseNet);
  $("kpiHours").textContent = `${sumH.toFixed(1)} h/月`;
  $("kpiYear").textContent  = fmtJPY(year);

  // chart
  drawBar([d1,d2,d3,d4,d5], ["勤務管理","請求作成","給与作成","書類作成","連絡業務"]);

  // formulas
  const f = [
    `時間削減（h）＝ Σ(工程差分×単位数) ＝ ${sumH.toFixed(1)}`,
    `削減額（円）＝ 時間削減 × 時給 ＝ ${fmtJPY(saveAmount)}`,
    `売上モデル（円）＝ 係数 × (常用人数×勤務日 + 臨時人数×勤務日) ＝ ${fmtJPY(sales)}`,
    `未請求回収（円）＝ 売上 × 回収率 ＝ ${fmtJPY(recovery)}`,
    `紙・通信・雑費 削減（円）＝ 金額 × 削減率 ＝ ${fmtJPY(paper * paperReductionRate)}`,
    `月間純メリット（基礎）（円）＝ 削減額 + 未請求回収 + 紙削減 ＝ ${fmtJPY(baseNet)}`,
    `営業効果（円/月）＝ (削減時間×営業配分 ÷ 1契約必要時間) × (平均月間売上×粗利率) ＝ ${fmtJPY(salesEffect)}`,
    `教育効果（円/月）＝ (人数×離職率改善×採用研修÷12) + (クレーム減×対応単価) ＝ ${fmtJPY(eduEffect)}`,
    `再投資効果合計（円/月）＝ 営業効果 + 教育効果 ＝ ${fmtJPY(reinvestTotal)}`,
    `年間換算（円/年）＝ （月間純メリット + 再投資効果合計） × 12 ＝ ${fmtJPY(year)}`
  ];
  $("formula").innerHTML = f.map(x => `<li>${x}</li>`).join("");
}

// ------- bar chart (vanilla canvas) -------
function drawBar(data, labels){
  const c = $("bar");
  const ctx = c.getContext("2d");
  const W = c.width = c.clientWidth * devicePixelRatio;
  const H = c.height = 260 * devicePixelRatio;
  ctx.clearRect(0,0,W,H);

  const pad = 36*devicePixelRatio;
  const max = Math.max(1, ...data);
  const cols = data.length;
  const gap = (W - pad*2) / cols;
  const bw = gap * 0.6;

  // axes (light)
  ctx.strokeStyle = "#e7eaf0"; ctx.lineWidth = 1*devicePixelRatio;
  ctx.beginPath();
  ctx.moveTo(pad, H - pad); ctx.lineTo(W - pad, H - pad);
  ctx.moveTo(pad, pad); ctx.lineTo(pad, H - pad);
  ctx.stroke();

  data.forEach((v,i)=>{
    const x = pad + i*gap + (gap - bw)/2;
    const h = (H - pad*2) * (v / max);
    const y = H - pad - h;

    ctx.fillStyle = i%2 ? "#93c5fd" : "#67e8f9";
    roundRect(ctx, x, y, bw, h, 10*devicePixelRatio, true);

    // value
    ctx.fillStyle = "#0f172a"; ctx.font = `${13*devicePixelRatio}px system-ui`;
    ctx.fillText(v.toFixed(1), x, y - 6*devicePixelRatio);

    // label
    ctx.fillStyle = "#586074"; ctx.font = `${12*devicePixelRatio}px system-ui`;
    wrapText(ctx, labels[i], x, H - pad + 14*devicePixelRatio, bw, 14*devicePixelRatio);
  });
}
function roundRect(ctx,x,y,w,h,r,fill=true){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
  if(fill) ctx.fill();
}
function wrapText(ctx, text, x, y, maxWidth, lineHeight){
  const chars = text.split(''); let line=''; let yy=y;
  for(let i=0;i<chars.length;i++){
    const test = line + chars[i];
    if(ctx.measureText(test).width > maxWidth && i>0){
      ctx.fillText(line, x, yy); line = chars[i]; yy += lineHeight;
    }else{
      line = test;
    }
  }
  ctx.fillText(line, x, yy);
}
