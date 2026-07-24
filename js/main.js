import { createBlochScene } from "./scene.js";
import { createCircuitController, MAX_COLUMNS, involvedQubits } from "./circuit.js";
import { GATE_INFO, computeVisibleProbabilities, sampleCounts } from "./quantum.js";
import { pickLabelMode, niceTickStep, phaseInfo } from "./chart.js";
import { reducedDensityInfo } from "./density.js";
import { initResizableLayout } from "./layout.js";
import { parseShareHash, buildShareUrl, toQASM, toQiskit } from "./export.js";

initResizableLayout();

// 팔레트 표시 계층 전용 카테고리 정의 (시뮬레이션/게이트 로직과 무관).
// 색상은 style.css의 --cat-* 변수 한 곳에서 정의하고, 여기서는 카테고리 id만 참조한다.
// 색상만으로는 색각 이상 사용자가 구분하기 어려우므로 카테고리마다 이름 라벨을 붙인다.
const PALETTE_CATEGORIES = [
  { id: "pauli", label: "Pauli & Clifford", gates: ["H", "X", "Y", "Z", "I", "S", "Sdg", "SX", "SXdg"] },
  { id: "phase", label: "Phase / T", gates: ["T", "Tdg", "P"] },
  { id: "rotation", label: "Rotations", gates: ["RX", "RY", "RZ", "U"] },
  { id: "multi", label: "Multi-qubit", gates: ["CTRL", "CNOT", "CCX", "SWAP", "CSWAP"] },
  { id: "interaction", label: "Interaction", gates: ["RXX", "RYY", "RZZ"] },
  { id: "structural", label: "Non-unitary", gates: ["MEASURE", "RESET", "BARRIER", "IF"] },
  // 상대위상 Toffoli 변형(Margolus). CCX와 동일하지 않으므로 초심자가 혼동하지 않게 분리.
  { id: "advanced", label: "Advanced · relative phase", gates: ["RCCX", "RC3X"] },
];

// 미구현 게이트는 피처 플래그로 렌더링에서만 제외한다 (정의/엔진 코드는 그대로 유지).
const GATE_ENABLED = { IF: false };

// gate → 카테고리 id (색상 클래스 cat-* 용). 위 정의에서 파생한다.
const GATE_CATEGORY = {};
for (const cat of PALETTE_CATEGORIES) for (const g of cat.gates) GATE_CATEGORY[g] = cat.id;
GATE_CATEGORY.CZ = "multi"; // 팔레트엔 없지만 공유 회로로 캔버스에 올 수 있어 색을 부여

// 제어가 붙은 게이트의 표준 이름 (hover 표시용). 매핑에 없으면 Controlled-<gate>.
const CONTROLLED_NAMES = {
  "X+1": "CX (CNOT)",
  "Z+1": "CZ",
  "X+2": "CCX (Toffoli)",
  "SWAP+1": "CSWAP (Fredkin)",
  "P+1": "CP",
  "RZ+1": "CRZ",
};
function standardGateName(cell) {
  const g = cell.gate;
  const info = GATE_INFO[g];
  // RCCX/RC3X: 상대위상 경고 전문을 hover로 노출 (CCX와 혼동 방지).
  if (info?.kind === "decomposed") return info.desc;
  const nc = cell.controls?.length ?? 0;
  const label = info?.label ?? g;
  if (nc === 0) return label;
  const named = CONTROLLED_NAMES[`${g}+${nc}`];
  if (named) return named;
  if (g === "X" && nc >= 3) return "MCX";
  if (g === "Z" && nc >= 3) return "MCZ";
  return `Controlled-${label}`;
}

// Qiskit 스타일 측정 게이지 아이콘
const MEASURE_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
  '<path d="M5 16a7 7 0 0 1 14 0" />' +
  '<line x1="12" y1="16" x2="16.5" y2="9.5" />' +
  '<text x="17.5" y="8" font-size="8" fill="currentColor" stroke="none">z</text>' +
  "</svg>";

function stackGlyph(dots, symbol) {
  const dot = '<span class="glyph-dot"></span>';
  const line = '<span class="glyph-line"></span>';
  return `<span class="glyph-stack">${(dot + line).repeat(dots)}<span class="glyph-sym">${symbol}</span></span>`;
}

// 팔레트 칩 전용 글리프 (없으면 label 텍스트 사용).
// 주의: X는 여기서 제외해 팔레트 버튼이 문자 "X"(= info.label)로 렌더링되게 한다.
// ⊕는 CNOT/CCX 팔레트 버튼의 controlled-NOT 타깃 표시로만 남기며,
// 회로 캔버스의 CNOT 타깃(⊕)은 quantum.js의 targetLabel이 담당하므로 여기서 건드리지 않는다.
const PALETTE_GLYPHS = {
  CTRL: '<span class="glyph-ctrl"><span class="glyph-ctrl-dot"></span><span class="glyph-ctrl-text">Control</span></span>',
  CNOT: stackGlyph(1, "⊕"),
  CCX: stackGlyph(2, "⊕"),
  SWAP: '<span class="glyph-stack"><span class="glyph-sym">×</span><span class="glyph-line"></span><span class="glyph-sym">×</span></span>',
  CSWAP: '<span class="glyph-stack"><span class="glyph-dot"></span><span class="glyph-line"></span><span class="glyph-sym">×</span><span class="glyph-line"></span><span class="glyph-sym">×</span></span>',
  MEASURE: MEASURE_SVG,
};

// .circuit-grid 좌표 상수 (style.css의 셀/행 치수와 일치해야 함)
const GRID_PAD_TOP = 4;
const GRID_PAD_LEFT = 2;
const LABEL_WIDTH = 38;
const ROW_PITCH = 52; // 행 높이 46 + gap 6
const COL_PITCH = 46; // 셀 42 + margin 4
const CELL_CENTER = 21;

const sphereContainer = document.getElementById("sphere-container");
const scene = createBlochScene(sphereContainer);

const gatePalette = document.getElementById("gate-palette");
const circuitGrid = document.getElementById("circuit-grid");
const qubitTabs = document.getElementById("qubit-tabs");
const probList = document.getElementById("prob-list");
const stateFormula = document.getElementById("state-formula");
const qubitCountLabel = document.getElementById("qubit-count");
const qubitMinusBtn = document.getElementById("qubit-minus");
const qubitPlusBtn = document.getElementById("qubit-plus");
const clearBtn = document.getElementById("clear-btn");
const undoBtn = document.getElementById("undo-btn");
const redoBtn = document.getElementById("redo-btn");
const resetBtn = document.getElementById("reset-btn");
const stepBackBtn = document.getElementById("step-back-btn");
const playBtn = document.getElementById("play-btn");
const stepFwdBtn = document.getElementById("step-fwd-btn");
const playbackStatus = document.getElementById("playback-status");
const resetViewBtn = document.getElementById("reset-view-btn");
const placePopover = document.getElementById("place-popover");
const viewToggle = document.getElementById("view-toggle");
const sphereModeTitle = document.getElementById("sphere-mode-title");
const qsphereLegend = document.getElementById("qsphere-legend");
const blochInfo = document.getElementById("bloch-info");
const blochPurity = document.getElementById("bloch-purity");
const blochMixedFill = document.getElementById("bloch-mixed-fill");
const blochMixedPct = document.getElementById("bloch-mixed-pct");
const sphereCaption = document.getElementById("sphere-caption");
const menuBtn = document.getElementById("menu-btn");
const menuPanel = document.getElementById("menu-panel");
const probEndian = document.getElementById("prob-endian");
const dmQubitTabs = document.getElementById("dm-qubit-tabs");
const dmMatrix = document.getElementById("dm-matrix");
const dmMetrics = document.getElementById("dm-metrics");

// 비트 순서(엔디언) 라벨: little-endian(q0이 오른쪽 끝) 표기를 명시한다.
const ENDIAN_TOOLTIP = "Little-endian: q0 is the rightmost bit (Qiskit convention)";
function endianLabelText(n) {
  const parts = [];
  for (let i = n - 1; i >= 0; i--) parts.push(`q${i}`);
  return `|${parts.join(" ")}⟩`;
}
probEndian.addEventListener("mouseenter", () => showTooltip(probEndian, ENDIAN_TOOLTIP));
probEndian.addEventListener("mouseleave", hideTooltip);
const probHideToggle = document.getElementById("prob-hide-toggle");
const probHideZeros = document.getElementById("prob-hide-zeros");
const probFooter = document.getElementById("prob-footer");
const probSampling = document.getElementById("prob-sampling");
const shotsInput = document.getElementById("shots-input");
const runBtn = document.getElementById("run-btn");
const resetShotsBtn = document.getElementById("reset-shots-btn");

const gateButtons = [];

// ---------- 햄버거 메뉴 (열림/닫힘만 구현 — 내용은 추후 확장 예정) ----------
menuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const willOpen = menuPanel.classList.contains("hidden");
  menuPanel.classList.toggle("hidden", !willOpen);
  menuBtn.setAttribute("aria-expanded", String(willOpen));
});

document.addEventListener("click", (e) => {
  if (!menuPanel.classList.contains("hidden") && !menuPanel.contains(e.target) && e.target !== menuBtn) {
    menuPanel.classList.add("hidden");
    menuBtn.setAttribute("aria-expanded", "false");
  }
});

// ---------- Bloch / Q-sphere 뷰 ----------
// Bloch 뷰는 선택한 큐비트의 축약 밀도행렬(부분대각합)로 블로흐 벡터를 그린다. 다체계에서
// |r|<1이면 화살표가 구 안쪽으로 줄고, Purity/Mixedness를 함께 표시한다. Q-sphere는 전체 상태 뷰.
// 기본값: 큐비트 1개면 Bloch, 2개 이상이면 Q-sphere.
let sphereMode = "bloch";

function setSphereMode(mode) {
  sphereMode = mode;
  const snap = circuit.getSnapshot();
  scene.setMode(sphereMode);
  if (sphereMode === "qsphere") scene.setQSphereData(snap.probabilities, snap.qubitCount);
  applySphereModeUI(snap);
}

viewToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".segmented-btn");
  if (!btn || btn.dataset.view === sphereMode) return;
  setSphereMode(btn.dataset.view);
});

function applySphereModeUI(snapshot) {
  const isQSphere = sphereMode === "qsphere";
  for (const b of viewToggle.querySelectorAll(".segmented-btn")) {
    b.classList.toggle("active", b.dataset.view === sphereMode);
  }
  qubitTabs.classList.toggle("hidden", isQSphere);
  sphereModeTitle.classList.toggle("hidden", !isQSphere);
  qsphereLegend.classList.toggle("hidden", !isQSphere);
  blochInfo.classList.toggle("hidden", isQSphere);
  updateBlochInfo(snapshot);
}

// Purity = (1+|r|²)/2, Local mixedness = 1−|r|. |r|≈0이면 완전혼합 캡션.
// "얽힘"이 아니라 "mixedness"로 표기 — 다체계에서 |r|<1의 원인이 얽힘만은 아니다.
function updateBlochInfo(snapshot) {
  const r = Math.min(1, Math.hypot(snapshot.bloch.x, snapshot.bloch.y, snapshot.bloch.z));
  const purity = (1 + r * r) / 2;
  const mixedness = 1 - r;
  blochPurity.textContent = purity.toFixed(2);
  blochMixedFill.style.width = `${mixedness * 100}%`;
  blochMixedPct.textContent = `${Math.round(mixedness * 100)}%`;
  const maximallyMixed = sphereMode === "bloch" && r < 0.02;
  sphereCaption.classList.toggle("hidden", !maximallyMixed);
}

// ---------- Probabilities (좌: 차트 / 우: 축소 밀도행렬) ----------
let hideZeroProb = true; // "Hide 0%" 토글 (기본 켜짐)
let probShowAll = false; // 큐비트 많을 때 상위 N개 제한을 사용자가 펼쳤는지
const PROB_TOP_N = 32; // 6큐비트 이상에서 기본으로 표시하는 상위 상태 개수

// "Hide 0%" 체크박스: 영확률 상태 숨김 토글
probHideZeros.addEventListener("change", () => {
  hideZeroProb = probHideZeros.checked;
  renderProbabilities(circuit.getSnapshot());
});

// ---------- 측정 샘플링 ----------
// 현재 표시 분포에서 shots번 샘플링한 결과. { counts:number[], shots, signature } | null.
let sampleResult = null;
let sampling = false; // 실행 중 플래그
const SAMPLE_CHUNK = 10000; // 이 이상이면 청크로 나눠 비동기 처리(UI 프리즈 방지)

// 표시 분포를 결정하는 서명. 이게 바뀌면(회로 편집/스텝/큐비트수) 기존 샘플은 무효.
function probSignature(snapshot) {
  return snapshot.qubitCount + "|" + snapshot.probabilities.map((p) => Math.round(p.probability * 1000)).join(",");
}
function clampShots(v) {
  if (!Number.isFinite(v)) return 1024;
  return Math.max(1, Math.min(100000, Math.floor(v)));
}
// shots가 크면 청크 단위로 나눠 사이에 이벤트 루프에 양보(비동기).
async function sampleAsync(probabilities, shots) {
  if (shots <= SAMPLE_CHUNK) return sampleCounts(probabilities, shots);
  const total = new Array(probabilities.length).fill(0);
  let done = 0;
  while (done < shots) {
    const c = Math.min(SAMPLE_CHUNK, shots - done);
    const partial = sampleCounts(probabilities, c);
    for (let i = 0; i < total.length; i++) total[i] += partial[i];
    done += c;
    if (done < shots) await new Promise((r) => setTimeout(r, 0));
  }
  return total;
}
async function runSampling() {
  if (sampling) return;
  const snap = circuit.getSnapshot();
  const shots = clampShots(parseInt(shotsInput.value, 10));
  shotsInput.value = String(shots);
  sampling = true;
  runBtn.disabled = true;
  runBtn.textContent = "Running…";
  try {
    const counts = await sampleAsync(snap.probabilities, shots);
    // 샘플링 도중 회로가 바뀌지 않았을 때만 반영(경합 방지)
    if (probSignature(circuit.getSnapshot()) === probSignature(snap)) {
      sampleResult = { counts, shots, signature: probSignature(snap) };
    }
  } finally {
    sampling = false;
    runBtn.disabled = false;
    runBtn.textContent = "Run";
    renderProbabilities(circuit.getSnapshot());
  }
}
function resetSampling() {
  sampleResult = null;
  renderProbabilities(circuit.getSnapshot());
}
runBtn.addEventListener("click", runSampling);
resetShotsBtn.addEventListener("click", resetSampling);
shotsInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); runSampling(); }
});

// ---------- 배치 팝오버 (각도/컨트롤/파트너 선택) ----------

let pendingPlacement = null;

function closePlacePopover() {
  placePopover.classList.add("hidden");
  placePopover.innerHTML = "";
  pendingPlacement = null;
}

function radToDegRound(rad) {
  return Math.round((rad * 180) / Math.PI);
}

function openPlacePopover(column, qubit, gateName, clientX, clientY, qubitCount) {
  const info = GATE_INFO[gateName];
  // controlled(CNOT/CCX/…)·decomposed(RCCX/RC3X)·cswap는 컨트롤을 고른다.
  const needControls = info.kind === "controlled" || info.kind === "decomposed" || info.kind === "cswap" ? (info.controls ?? 0) : 0;
  // swap/pair-param/cswap는 파트너(두 번째 타깃)를 고른다. CSWAP는 파트너+컨트롤 둘 다.
  const needPartner = info.kind === "swap" || info.kind === "pair-param" || info.kind === "cswap" ? 1 : 0;
  const sliderNames =
    info.kind === "param" || info.kind === "pair-param" ? ["θ"]
    : info.kind === "param3" ? ["θ", "φ", "λ"]
    : [];

  pendingPlacement = { column, qubit, gateName, partner: [], control: [] };
  placePopover.innerHTML = "";

  const title = document.createElement("div");
  title.className = "place-popover-title";
  title.textContent = `${info.label} → q[${qubit}]`;
  placePopover.appendChild(title);

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "pill-btn-primary";
  confirmBtn.textContent = "Apply";

  function updateConfirm() {
    confirmBtn.disabled =
      pendingPlacement.partner.length !== needPartner || pendingPlacement.control.length !== needControls;
  }

  const selectedElsewhere = (role, q) =>
    (role === "partner" ? pendingPlacement.control : pendingPlacement.partner).includes(q);

  // role별 독립 선택 행. CSWAP는 파트너 행 + 컨트롤 행 둘 다 렌더된다(서로 겹치지 않게).
  function buildPicker(role, count, labelText) {
    const pickLabel = document.createElement("div");
    pickLabel.className = "place-popover-hint";
    pickLabel.textContent = labelText;
    placePopover.appendChild(pickLabel);

    const pickRow = document.createElement("div");
    pickRow.className = "qpick-row";
    for (let q = 0; q < qubitCount; q++) {
      if (q === qubit) continue;
      const btn = document.createElement("button");
      btn.className = "qpick-btn";
      btn.textContent = `q[${q}]`;
      btn.addEventListener("click", () => {
        const list = pendingPlacement[role];
        const idx = list.indexOf(q);
        if (idx >= 0) {
          list.splice(idx, 1);
          btn.classList.remove("selected");
        } else if (!selectedElsewhere(role, q) && list.length < count) {
          list.push(q);
          btn.classList.add("selected");
        }
        updateConfirm();
      });
      pickRow.appendChild(btn);
    }
    placePopover.appendChild(pickRow);
  }

  if (needPartner > 0) {
    buildPicker("partner", needPartner, needControls > 0 ? "Select swap target qubit" : "Select partner qubit");
  }
  if (needControls > 0) {
    buildPicker("control", needControls, `Select ${needControls} control qubit${needControls > 1 ? "s" : ""}`);
  }

  const sliderInputs = [];
  for (const name of sliderNames) {
    const row = document.createElement("div");
    row.className = "slider-row";
    const label = document.createElement("span");
    label.className = "slider-label";
    const valueSpan = document.createElement("span");
    valueSpan.className = "slider-value";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "360";
    slider.step = "1";
    const defaultDeg = name === "θ" ? radToDegRound(info.defaultTheta ?? Math.PI / 2) : 0;
    slider.value = String(defaultDeg);
    label.textContent = name;
    valueSpan.textContent = `${defaultDeg}°`;
    slider.addEventListener("input", () => {
      valueSpan.textContent = `${slider.value}°`;
    });
    row.append(label, slider, valueSpan);
    placePopover.appendChild(row);
    sliderInputs.push(slider);
  }

  const actions = document.createElement("div");
  actions.className = "place-popover-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "icon-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", closePlacePopover);

  confirmBtn.addEventListener("click", () => {
    if (!pendingPlacement) return;
    const params = {};
    const toRad = (v) => (Number(v) * Math.PI) / 180;
    if (sliderNames.length === 1) params.theta = toRad(sliderInputs[0].value);
    if (sliderNames.length === 3) {
      params.theta = toRad(sliderInputs[0].value);
      params.phi = toRad(sliderInputs[1].value);
      params.lambda = toRad(sliderInputs[2].value);
    }
    if (needControls > 0) params.controls = pendingPlacement.control.slice();
    if (needPartner > 0) params.partner = pendingPlacement.partner[0];
    scene.clearTrail();
    circuit.placeGate(pendingPlacement.column, pendingPlacement.qubit, pendingPlacement.gateName, params);
    closePlacePopover();
  });

  actions.append(cancelBtn, confirmBtn);
  placePopover.appendChild(actions);
  updateConfirm();

  placePopover.classList.remove("hidden");
  const rect = placePopover.getBoundingClientRect();
  const left = Math.min(clientX, window.innerWidth - rect.width - 16);
  const top = Math.min(clientY, window.innerHeight - rect.height - 16);
  placePopover.style.left = `${Math.max(8, left)}px`;
  placePopover.style.top = `${Math.max(8, top)}px`;
}

// ---------- 팔레트 ----------

// 스크롤 컨테이너에 잘리지 않도록 body에 고정 위치로 띄우는 커스텀 툴팁
const gateTooltip = document.createElement("div");
gateTooltip.className = "gate-tooltip hidden";
document.body.appendChild(gateTooltip);

function showTooltip(anchor, text) {
  gateTooltip.textContent = text;
  gateTooltip.classList.remove("hidden");
  const rect = anchor.getBoundingClientRect();
  const tipRect = gateTooltip.getBoundingClientRect();
  const left = Math.min(
    Math.max(8, rect.left + rect.width / 2 - tipRect.width / 2),
    window.innerWidth - tipRect.width - 8
  );
  const top = rect.top - tipRect.height - 8;
  gateTooltip.style.left = `${left}px`;
  gateTooltip.style.top = `${top < 8 ? rect.bottom + 8 : top}px`;
}

function hideTooltip() {
  gateTooltip.classList.add("hidden");
}

// 드롭 거부 등 일시적 안내: 잠깐 보여주고 자동으로 사라진다.
let transientTipTimer = null;
function showTransientTip(anchor, text) {
  showTooltip(anchor, text);
  clearTimeout(transientTipTimer);
  transientTipTimer = setTimeout(hideTooltip, 1700);
}

// 배치된 게이트/제어점에 hover하면 표준 이름(CX, CZ, CCX …)을 툴팁으로 보여준다.
function attachGateHover(el, cell) {
  el.addEventListener("mouseenter", () => showTooltip(el, standardGateName(cell)));
  el.addEventListener("mouseleave", hideTooltip);
}

function makeGateChip(gateName, categoryId) {
  const info = GATE_INFO[gateName];
  const btn = document.createElement("button");
  btn.className = `gate-chip cat-${categoryId}`;
  if (PALETTE_GLYPHS[gateName]) {
    btn.innerHTML = PALETTE_GLYPHS[gateName];
  } else {
    btn.textContent = info.label;
  }
  btn.dataset.gate = gateName;
  btn.dataset.tip = info.desc ?? info.label;
  btn.draggable = true;
  btn.addEventListener("dragstart", (e) => {
    if (btn.dataset.ready === "false") {
      e.preventDefault();
      return;
    }
    hideTooltip();
    e.dataTransfer.setData("text/plain", gateName);
    e.dataTransfer.effectAllowed = "copy";
  });
  btn.addEventListener("mouseenter", () => showTooltip(btn, btn.dataset.tip));
  btn.addEventListener("mouseleave", hideTooltip);
  gateButtons.push(btn);
  return btn;
}

function buildPalette() {
  gatePalette.innerHTML = "";
  for (const cat of PALETTE_CATEGORIES) {
    // 존재하고 피처 플래그가 꺼지지 않은 게이트만 노출 (예: IF는 enabled:false로 숨김)
    const gates = cat.gates.filter((g) => GATE_INFO[g] && GATE_ENABLED[g] !== false);
    if (gates.length === 0) continue;

    const section = document.createElement("div");
    section.className = "palette-section";

    const label = document.createElement("div");
    label.className = "palette-cat-label";
    label.textContent = cat.label;

    const grid = document.createElement("div");
    grid.className = "palette-grid";
    for (const gateName of gates) grid.appendChild(makeGateChip(gateName, cat.id));

    section.append(label, grid);
    gatePalette.appendChild(section);
  }
}

function updatePaletteAvailability(qubitCount) {
  for (const btn of gateButtons) {
    const info = GATE_INFO[btn.dataset.gate];
    const supported = info.ready !== false;
    const available = supported && qubitCount >= (info.minQubits ?? 1);
    btn.dataset.ready = String(available);
    btn.dataset.tip = !supported
      ? info.desc
      : available
        ? info.desc ?? info.label
        : `${info.desc ?? info.label} — requires ≥${info.minQubits} qubits`;
  }
}

// ---------- 회로 그리드 ----------

function buildCircuitGrid(snapshot) {
  circuitGrid.innerHTML = "";

  // 칼럼별 역할 맵: qubit -> { type: "target"|"control", cell, primary }
  // canonical 셀은 홈 행(targets[0])에만 저장되며, 관여 큐비트는 targets/controls로 표시.
  const roleMaps = [];
  for (let col = 0; col < MAX_COLUMNS; col++) {
    const roles = new Map();
    for (let t = 0; t < snapshot.qubitCount; t++) {
      const cell = snapshot.grid[col]?.[t];
      if (!cell) continue;
      const decomposed = GATE_INFO[cell.gate]?.kind === "decomposed";
      cell.targets.forEach((tq, i) => {
        // RCCX/RC3X: targets의 마지막 = ⊕ 타깃, 앞쪽 = 컨트롤 점으로 그린다.
        if (decomposed && i < cell.targets.length - 1) {
          roles.set(tq, { type: "control", cell, primary: false });
        } else {
          roles.set(tq, { type: "target", cell, primary: decomposed || i === 0 });
        }
      });
      for (const q of cell.controls ?? []) roles.set(q, { type: "control", cell, primary: false });
    }
    roleMaps.push(roles);
  }

  for (let q = 0; q < snapshot.qubitCount; q++) {
    const row = document.createElement("div");
    row.className = "qubit-row";

    const label = document.createElement("span");
    label.className = "qubit-label";
    label.textContent = `q[${q}]`;
    row.appendChild(label);

    const wire = document.createElement("div");
    wire.className = "qubit-wire";
    for (let col = 0; col < MAX_COLUMNS; col++) {
      const cell = document.createElement("div");
      cell.className = "grid-cell";
      cell.dataset.col = String(col);
      cell.dataset.qubit = String(q);

      const role = roleMaps[col].get(q);
      if (role) {
        const info = GATE_INFO[role.cell.gate];
        // controlled-Z는 CZ 표준 표기(•—•)라 타깃도 채운 점으로 그린다.
        const controlledZ = role.cell.gate === "Z" && (role.cell.controls?.length ?? 0) > 0;
        if (role.type === "control" || (role.type === "target" && controlledZ)) {
          const dot = document.createElement("div");
          dot.className = "ctrl-dot";
          attachGateHover(dot, role.cell);
          cell.appendChild(dot);
        } else {
          const chip = document.createElement("div");
          chip.className = `placed-gate cat-${GATE_CATEGORY[role.cell.gate] ?? "structural"}`;
          if (info?.kind === "decomposed") chip.classList.add("placed-advanced"); // RCCX/RC3X 시각 구분
          if (!role.primary) chip.classList.add("placed-partner"); // 두 번째 타깃은 살짝 흐리게(기존과 동일)
          if (role.cell.gate === "MEASURE") {
            chip.innerHTML = MEASURE_SVG;
          } else {
            chip.textContent =
              role.cell.gate === "SWAP" ? "×" : (info.targetLabel ?? info.label);
          }
          attachGateHover(chip, role.cell);
          cell.appendChild(chip);
        }
      }
      wire.appendChild(cell);
    }
    row.appendChild(wire);
    circuitGrid.appendChild(row);
  }

  // 다중 큐비트 게이트의 세로 연결선
  for (let col = 0; col < MAX_COLUMNS; col++) {
    for (let t = 0; t < snapshot.qubitCount; t++) {
      const cell = snapshot.grid[col]?.[t];
      if (!cell) continue;
      const qubits = involvedQubits(cell);
      if (qubits.length < 2) continue;
      const minQ = Math.min(...qubits);
      const maxQ = Math.max(...qubits);
      const line = document.createElement("div");
      line.className = "gate-connector";
      line.style.left = `${GRID_PAD_LEFT + LABEL_WIDTH + col * COL_PITCH + CELL_CENTER - 1}px`;
      line.style.top = `${GRID_PAD_TOP + minQ * ROW_PITCH + CELL_CENTER + 2}px`;
      line.style.height = `${(maxQ - minQ) * ROW_PITCH}px`;
      circuitGrid.appendChild(line);
    }
  }
}

circuitGrid.addEventListener("dragover", (e) => {
  const cell = e.target.closest(".grid-cell");
  if (!cell) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
  cell.classList.add("drag-over");
});

circuitGrid.addEventListener("dragleave", (e) => {
  const cell = e.target.closest(".grid-cell");
  if (cell) cell.classList.remove("drag-over");
});

circuitGrid.addEventListener("drop", (e) => {
  const cell = e.target.closest(".grid-cell");
  if (!cell) return;
  e.preventDefault();
  cell.classList.remove("drag-over");
  const gateName = e.dataTransfer.getData("text/plain");
  const info = GATE_INFO[gateName];
  if (!info || info.ready === false) return;
  const snapshot = circuit.getSnapshot();
  if (snapshot.qubitCount < (info.minQubits ?? 1)) return;
  const column = Number(cell.dataset.col);
  const qubit = Number(cell.dataset.qubit);

  // "•"(Control) 드롭: 같은 열 게이트의 controls에 이 큐비트를 부착한다.
  if (gateName === "CTRL") {
    scene.clearTrail();
    const res = circuit.addControl(column, qubit);
    if (!res.ok) showTransientTip(cell, res.reason);
    return;
  }

  const needsPopover =
    info.kind === "param" || info.kind === "param3" ||
    info.kind === "controlled" || info.kind === "swap" || info.kind === "pair-param" ||
    info.kind === "decomposed" || info.kind === "cswap";
  if (needsPopover) {
    openPlacePopover(column, qubit, gateName, e.clientX, e.clientY, snapshot.qubitCount);
  } else {
    scene.clearTrail();
    circuit.placeGate(column, qubit, gateName, {});
  }
});

circuitGrid.addEventListener("click", (e) => {
  const cell = e.target.closest(".grid-cell");
  if (!cell) return;
  const column = Number(cell.dataset.col);
  const qubit = Number(cell.dataset.qubit);
  scene.clearTrail();
  // 제어점을 클릭하면 그 제어만 제거, 타깃/일반 게이트면 게이트 전체 제거
  if (!circuit.removeControl(column, qubit)) {
    circuit.removeGate(column, qubit);
  }
});

// ---------- 큐비트 탭 / 확률 / 수식 ----------

function buildQubitTabs(snapshot) {
  qubitTabs.innerHTML = "";
  for (let q = 0; q < snapshot.qubitCount; q++) {
    const tab = document.createElement("button");
    tab.className = "qubit-tab" + (q === snapshot.selectedQubit ? " active" : "");
    tab.textContent = `q[${q}]`;
    tab.addEventListener("click", () => {
      scene.clearTrail();
      circuit.selectQubit(q);
    });
    qubitTabs.appendChild(tab);
  }
}

// ---------- 축소 밀도행렬 뷰 (확률 패널 오른쪽) ----------
const fmt3 = (v) => (Math.abs(v) < 5e-4 ? 0 : v).toFixed(3);
const fmtComplexCell = (z) => `${fmt3(z.re)} ${z.im >= 0 ? "+" : "−"} ${fmt3(Math.abs(z.im))}i`;

function buildDmQubitTabs(snapshot) {
  dmQubitTabs.innerHTML = "";
  for (let q = 0; q < snapshot.qubitCount; q++) {
    const tab = document.createElement("button");
    tab.className = "qubit-tab" + (q === snapshot.selectedQubit ? " active" : "");
    tab.textContent = `q[${q}]`;
    tab.addEventListener("click", () => {
      scene.clearTrail();
      circuit.selectQubit(q); // 선택은 전역(Bloch sphere와 공유)
    });
    dmQubitTabs.appendChild(tab);
  }
}

// 선택 큐비트의 2×2 축소 밀도행렬 + Purity/Mixedness/Bloch. density.js를 재사용(전체 행렬 안 만듦).
function renderDensityMatrix(snapshot) {
  buildDmQubitTabs(snapshot);
  const info = reducedDensityInfo(snapshot.state, snapshot.selectedQubit);
  const rho = info.rho;
  const mag = (z) => Math.hypot(z.re, z.im);
  let maxMag = 0;
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) maxMag = Math.max(maxMag, mag(rho[a][b]));
  if (maxMag < 1e-9) maxMag = 1;

  // 2×2 행렬 (셀 배경 = |값|/max 로 옅게 → 대각/비대각 구조가 보임)
  dmMatrix.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "dm-grid";
  const addLabel = (cls, text) => { const s = document.createElement("span"); s.className = cls; s.textContent = text; grid.appendChild(s); };
  addLabel("dm-corner", "ρ");
  addLabel("dm-collabel", "|0⟩");
  addLabel("dm-collabel", "|1⟩");
  for (let a = 0; a < 2; a++) {
    addLabel("dm-rowlabel", `⟨${a}|`);
    for (let b = 0; b < 2; b++) {
      const z = rho[a][b];
      const cell = document.createElement("div");
      cell.className = "dm-cell" + (a === b ? " dm-diag" : "");
      cell.style.background = `rgba(49, 130, 246, ${(mag(z) / maxMag) * 0.5})`;
      cell.textContent = a === b ? fmt3(z.re) : fmtComplexCell(z); // 대각=실수, 비대각=복소수
      grid.appendChild(cell);
    }
  }
  dmMatrix.appendChild(grid);

  // 지표 (부동소수점 오차로 순도가 살짝 1을 넘거나 mixedness가 음수가 될 수 있어 클램프)
  const b = info.bloch;
  const mixed = Math.max(0, Math.min(1, info.mixedness));
  const caption = info.purity >= 0.999 ? "Pure — not entangled with other qubits"
    : info.purity <= 0.501 ? "Maximally mixed — maximally entangled"
    : "Partially mixed — partially entangled";
  dmMetrics.innerHTML =
    `<div class="dm-stat">Purity <b>${info.purity.toFixed(3)}</b></div>` +
    `<div class="dm-stat dm-mixed"><span class="dm-mixed-label">Mixedness</span>` +
      `<span class="dm-mixed-bar"><span class="dm-mixed-fill" style="width:${mixed * 100}%"></span></span>` +
      `<b>${Math.round(mixed * 100)}%</b></div>` +
    `<div class="dm-stat dm-bloch">r = (<b>${b.x.toFixed(2)}</b>, <b>${b.y.toFixed(2)}</b>, <b>${b.z.toFixed(2)}</b>) &middot; |r| = <b>${info.r.toFixed(3)}</b></div>` +
    `<div class="dm-caption">${caption}</div>`;
}

// ---------- 확률 SVG 막대 차트 ----------
const SVGNS = "http://www.w3.org/2000/svg";
const CHART = {
  grid: "#e6e9ec", axis: "#c4c9d0", tick: "#8b95a1", label: "#4e5968",
  theorySolid: "#3182f6", theoryLight: "#7fb0f7", observed: "#3182f6",
};
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVGNS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}
// 윗변만 둥근 막대 path (밑변은 축에 붙음). x=좌, topY=상단, w/h=폭/높이.
function topRoundedRect(x, topY, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h));
  const b = topY + h;
  return `M${x},${b} L${x},${topY + r} Q${x},${topY} ${x + r},${topY} L${x + w - r},${topY} Q${x + w},${topY} ${x + w},${topY + r} L${x + w},${b} Z`;
}

// 리치 툴팁 (기저·이론확률·관측·진폭·위상)
const chartTooltip = document.createElement("div");
chartTooltip.className = "chart-tooltip hidden";
document.body.appendChild(chartTooltip);
function showChartTooltip(anchorEl, html) {
  chartTooltip.innerHTML = html;
  chartTooltip.classList.remove("hidden");
  const a = anchorEl.getBoundingClientRect();
  const t = chartTooltip.getBoundingClientRect();
  const left = Math.min(Math.max(8, a.left + a.width / 2 - t.width / 2), window.innerWidth - t.width - 8);
  const top = a.top - t.height - 8;
  chartTooltip.style.left = `${left}px`;
  chartTooltip.style.top = `${top < 8 ? a.bottom + 8 : top}px`;
}
function hideChartTooltip() {
  chartTooltip.classList.add("hidden");
}
function barTooltipHTML(entry, sampled) {
  const ph = phaseInfo(entry.re, entry.im);
  const amp = `${entry.re.toFixed(3)} ${entry.im >= 0 ? "+" : "−"} ${Math.abs(entry.im).toFixed(3)}i`;
  const rows = [`<div class="tt-title">|${entry.label}⟩ <span class="tt-dim">· index ${entry.index}</span></div>`];
  rows.push(`<div>Theoretical: <b>${entry.probability.toFixed(2)}%</b></div>`);
  if (sampled) {
    const c = sampleResult.counts[entry.index] ?? 0;
    rows.push(`<div>Observed: <b>${c} / ${sampleResult.shots}</b> (${((c / sampleResult.shots) * 100).toFixed(2)}%)</div>`);
  }
  rows.push(`<div>Amplitude: <b>${amp}</b></div>`);
  rows.push(`<div>Phase: <b>${ph.defined ? `${ph.deg.toFixed(1)}° (${ph.rad.toFixed(2)} rad)` : "—"}</b></div>`);
  return rows.join("");
}

function renderProbabilities(snapshot) {
  probFooter.innerHTML = "";
  hideChartTooltip();

  const sampled = sampleResult !== null;
  // 관측된 기저(count>0)는 어떤 필터로도 숨기지 않는다.
  const observed = new Set();
  if (sampled) {
    for (let i = 0; i < sampleResult.counts.length; i++) if (sampleResult.counts[i] > 0) observed.add(i);
  }

  const { visible, hiddenZeroCount, hiddenZeroProb, capActive } = computeVisibleProbabilities(
    snapshot.probabilities,
    { hideZero: hideZeroProb, qubitCount: snapshot.qubitCount, topN: PROB_TOP_N, showAll: probShowAll, observed }
  );

  resetShotsBtn.classList.toggle("hidden", !sampled);

  // [2] 범례 (샘플링 시), [4] 숨긴 개수, Show all/접기 — 모두 푸터에
  if (sampled) {
    const legend = document.createElement("div");
    legend.className = "prob-legend";
    legend.innerHTML =
      '<span class="lg-item"><span class="lg-sw lg-theory"></span>Theoretical</span>' +
      '<span class="lg-item"><span class="lg-sw lg-observed"></span>Sampled</span>';
    probFooter.appendChild(legend);
  }
  if (hiddenZeroCount > 0) {
    const note = document.createElement("span");
    note.className = "prob-hidden-note";
    note.textContent = `${hiddenZeroCount} state${hiddenZeroCount > 1 ? "s" : ""} hidden (${Math.round(hiddenZeroProb)}%)`;
    probFooter.appendChild(note);
  }
  if (capActive) {
    probFooter.appendChild(makeShowAllButton(`Show all ${snapshot.probabilities.length} states`, true));
  } else if (probShowAll && snapshot.qubitCount >= 6 && visible.length > PROB_TOP_N) {
    probFooter.appendChild(makeShowAllButton(`Show top ${PROB_TOP_N}`, false));
  }

  // 숨김/미측정(크기 0)이면 SVG 생략 — 다시 보일 때 ResizeObserver가 그린다.
  const W = probList.clientWidth;
  const H = probList.clientHeight;
  probList.innerHTML = "";
  if (W < 40 || H < 40 || visible.length === 0) return;
  probList.appendChild(buildProbChart(visible, snapshot, sampled, W, H));
}

function buildProbChart(visible, snapshot, sampled, W, H) {
  const n = visible.length;
  const M = { top: 12, right: 10, left: 42 };
  const plotW = W - M.left - M.right;
  const bandW = plotW / n;
  const labelChars = snapshot.qubitCount + 2; // "|" + bits + "⟩"
  const mode = pickLabelMode(n, bandW, labelChars * 6.2);
  const bottom = mode === "rot45" ? 46 : 24;
  const plotH = H - M.top - bottom;
  const px0 = M.left;
  const px1 = W - M.right;
  const py0 = M.top;
  const py1 = M.top + plotH; // 0% 기준선
  const yFor = (pct) => py1 - (pct / 100) * plotH;

  const svg = svgEl("svg", { width: "100%", height: "100%", viewBox: `0 0 ${W} ${H}` });
  svg.classList.add("prob-svg");

  // 가로 그리드선 + Y 눈금 (0/20/40/60/80/100)
  for (let pct = 0; pct <= 100; pct += 20) {
    const y = yFor(pct);
    svg.appendChild(svgEl("line", {
      x1: px0, y1: y, x2: px1, y2: y,
      stroke: pct === 0 ? CHART.axis : CHART.grid, "stroke-width": pct === 0 ? 1.5 : 1,
    }));
    const t = svgEl("text", { x: px0 - 6, y: y + 3.5, "text-anchor": "end", class: "prob-axis-num" });
    t.textContent = String(pct);
    svg.appendChild(t);
  }
  // Y축 제목
  const yTitle = svgEl("text", {
    x: 12, y: (py0 + py1) / 2, "text-anchor": "middle",
    transform: `rotate(-90, 12, ${(py0 + py1) / 2})`, class: "prob-axis-title",
  });
  yTitle.textContent = "Probability (%)";
  svg.appendChild(yTitle);

  // 막대 + hover 히트영역 + 라벨
  const barW = Math.min(bandW - 2, 46);
  const tickStep = mode === "sparse" ? niceTickStep(bandW, 40) : 1;
  let lastLabelX = -Infinity; // sparse에서 상단 라벨 겹침 방지
  const labelPx = labelChars * 6.2;

  visible.forEach((entry, i) => {
    const bandX = px0 + i * bandW;
    const cx = bandX + bandW / 2;
    const bx = cx - barW / 2;
    const th = (entry.probability / 100) * plotH;

    // 이론값 막대(샘플링 시 연한색+테두리로 relief, 아니면 진한색)
    if (th > 0.5) {
      const p = { d: topRoundedRect(bx, py1 - th, barW, th, 4), fill: sampled ? CHART.theoryLight : CHART.theorySolid };
      if (sampled) { p.stroke = CHART.theorySolid; p["stroke-width"] = 1; p["stroke-opacity"] = 0.45; }
      svg.appendChild(svgEl("path", p));
    }
    // 관측값 막대(진한색, 좁게 겹침)
    if (sampled) {
      const obsCount = sampleResult.counts[entry.index] ?? 0;
      const obh = (obsCount / sampleResult.shots) * plotH;
      if (obh > 0.5) {
        const ow = Math.max(3, barW * 0.5);
        svg.appendChild(svgEl("path", {
          d: topRoundedRect(cx - ow / 2, py1 - obh, ow, obh, 3),
          fill: CHART.observed,
        }));
      }
    }

    // X 라벨
    if (mode === "horizontal") {
      const t = svgEl("text", { x: cx, y: py1 + 15, "text-anchor": "middle", class: "prob-xlabel" });
      t.textContent = `|${entry.label}⟩`;
      svg.appendChild(t);
    } else if (mode === "rot45") {
      const t = svgEl("text", {
        x: cx, y: py1 + 12, "text-anchor": "end",
        transform: `rotate(-45, ${cx}, ${py1 + 12})`, class: "prob-xlabel",
      });
      t.textContent = `|${entry.label}⟩`;
      svg.appendChild(t);
    } else {
      // sparse: 인덱스 눈금 + 임계값(1%) 이상 막대에 상단 라벨(겹치지 않게)
      if (i % tickStep === 0) {
        svg.appendChild(svgEl("line", { x1: cx, y1: py1, x2: cx, y2: py1 + 4, stroke: CHART.axis, "stroke-width": 1 }));
        const t = svgEl("text", { x: cx, y: py1 + 15, "text-anchor": "middle", class: "prob-xtick" });
        t.textContent = String(entry.index);
        svg.appendChild(t);
      }
      if (entry.probability >= 1 && cx - lastLabelX >= labelPx + 4) {
        const t = svgEl("text", { x: cx, y: py1 - th - 4, "text-anchor": "middle", class: "prob-xlabel" });
        t.textContent = `|${entry.label}⟩`;
        svg.appendChild(t);
        lastLabelX = cx;
      }
    }

    // hover 히트영역(밴드 전체 높이) — 마크보다 큰 타겟
    const hit = svgEl("rect", { x: bandX, y: py0, width: bandW, height: plotH, fill: "transparent", class: "prob-hit" });
    hit.addEventListener("mouseenter", () => showChartTooltip(hit, barTooltipHTML(entry, sampled)));
    hit.addEventListener("mouseleave", hideChartTooltip);
    svg.appendChild(hit);
  });

  return svg;
}

// Show all / 접기 토글 버튼 생성
function makeShowAllButton(text, expand) {
  const btn = document.createElement("button");
  btn.className = "prob-showall-btn";
  btn.textContent = text;
  btn.addEventListener("click", () => {
    probShowAll = expand;
    renderProbabilities(circuit.getSnapshot());
  });
  return btn;
}

// 진폭 계수를 표시 문자열로 변환. 음수 실계수의 부호는 항 연결부호로 흡수.
function formatAmplitude(re, im) {
  const EPS = 0.005;
  const fmt = (v) => {
    const rounded = Math.abs(v).toFixed(2).replace(/\.?0+$/, "") || "0";
    return rounded === "1" ? "" : rounded;
  };
  if (Math.abs(im) < EPS) {
    return { text: fmt(re), negative: re < 0 };
  }
  if (Math.abs(re) < EPS) {
    return { text: `${fmt(im)}i`, negative: im < 0 };
  }
  const sign = im < 0 ? "−" : "+";
  return { text: `(${re.toFixed(2)}${sign}${Math.abs(im).toFixed(2)}i)`, negative: false };
}

function renderStateFormula(snapshot) {
  stateFormula.innerHTML = "";
  const prefix = document.createElement("span");
  prefix.className = "formula-psi";
  prefix.textContent = "|ψ⟩ =";
  stateFormula.appendChild(prefix);

  const terms = snapshot.probabilities.filter((e) => e.probability > 0.5);
  terms.forEach((entry, i) => {
    const { text, negative } = formatAmplitude(entry.re, entry.im);
    const sep = document.createElement("span");
    sep.className = "formula-sep";
    sep.textContent = i === 0 ? (negative ? "−" : "") : negative ? "−" : "+";
    if (sep.textContent) stateFormula.appendChild(sep);

    const term = document.createElement("span");
    term.className = "formula-term";
    if (text) {
      const coef = document.createElement("span");
      coef.className = "formula-coef";
      coef.textContent = text;
      term.appendChild(coef);
    }
    const ket = document.createElement("span");
    ket.textContent = `|${entry.label}⟩`;
    term.appendChild(ket);
    stateFormula.appendChild(term);
  });

  if (terms.length === 0) {
    const zero = document.createElement("span");
    zero.textContent = "0";
    stateFormula.appendChild(zero);
  }

  // 비트 순서 라벨 (수식 아래 줄, 작고 회색)
  const endian = document.createElement("span");
  endian.className = "endian-label formula-endian";
  endian.textContent = endianLabelText(snapshot.qubitCount);
  endian.addEventListener("mouseenter", () => showTooltip(endian, ENDIAN_TOOLTIP));
  endian.addEventListener("mouseleave", hideTooltip);
  stateFormula.appendChild(endian);
}

// ---------- 메인 렌더 ----------

function render(snapshot) {
  // 표시 분포가 바뀌면(회로 편집/스텝/큐비트수) 이전 샘플링 결과는 무효화한다.
  if (sampleResult && sampleResult.signature !== probSignature(snapshot)) sampleResult = null;

  scene.setVectorInstant(snapshot.bloch);
  if (sphereMode === "qsphere") scene.setQSphereData(snapshot.probabilities, snapshot.qubitCount);
  applySphereModeUI(snapshot);

  qubitCountLabel.textContent = String(snapshot.qubitCount);
  probEndian.textContent = endianLabelText(snapshot.qubitCount);
  updatePaletteAvailability(snapshot.qubitCount);

  buildCircuitGrid(snapshot);
  buildQubitTabs(snapshot);
  renderProbabilities(snapshot);
  renderDensityMatrix(snapshot);
  renderStateFormula(snapshot);

  const busy = snapshot.isAnimating || snapshot.isPlaying;
  clearBtn.disabled = busy;
  runBtn.disabled = busy || sampling; // 재생/애니메이션 중엔 샘플링 비활성
  undoBtn.disabled = busy || !snapshot.canUndo;
  redoBtn.disabled = busy || !snapshot.canRedo;
  qubitMinusBtn.disabled = busy || !snapshot.canRemoveQubit;
  qubitPlusBtn.disabled = busy || !snapshot.canAddQubit;

  resetBtn.disabled = busy || snapshot.stepIndex === 0;
  stepBackBtn.disabled = busy || snapshot.stepIndex === 0;
  stepFwdBtn.disabled = busy || snapshot.stepIndex >= snapshot.totalSteps;

  playBtn.disabled = snapshot.totalSteps === 0 || (snapshot.isAnimating && !snapshot.isPlaying);
  playBtn.textContent = snapshot.isPlaying ? "⏸" : "▶";
  playBtn.title = snapshot.isPlaying ? "Pause" : "Play";

  playbackStatus.textContent = `${snapshot.stepIndex} / ${snapshot.totalSteps} steps`;
}

buildPalette();

// 공유 URL(#c=...)이 있으면 저장된 회로보다 우선 적용하고, 이후 편집이
// 오래된 해시로 되돌아가지 않도록 주소창에서 해시를 제거한다.
const sharedCircuit = parseShareHash(location.hash);
if (sharedCircuit) {
  history.replaceState(null, "", location.pathname + location.search);
}

const circuit = createCircuitController({
  onChange: render,
  onAnimateStep: (from, to) => scene.animateVectorTo(from, to, 500),
  initial: sharedCircuit ?? undefined,
});

// 기본 뷰: 큐비트 1개면 Bloch, 2개 이상이면 Q-sphere (컨트롤러 생성 후 최초 1회 적용).
setSphereMode(circuit.getSnapshot().qubitCount === 1 ? "bloch" : "qsphere");

// 확률 차트는 패널 크기에 맞춰 반응형으로 다시 그린다(레이아웃 리사이즈·숨김→표시 전환 포함).
new ResizeObserver(() => {
  renderProbabilities(circuit.getSnapshot());
}).observe(probList);

qubitMinusBtn.addEventListener("click", () => {
  scene.clearTrail();
  closePlacePopover();
  circuit.setQubitCount(circuit.getSnapshot().qubitCount - 1);
});
qubitPlusBtn.addEventListener("click", () => {
  scene.clearTrail();
  closePlacePopover();
  circuit.setQubitCount(circuit.getSnapshot().qubitCount + 1);
});
clearBtn.addEventListener("click", () => {
  scene.clearTrail();
  closePlacePopover();
  circuit.clear();
});
undoBtn.addEventListener("click", () => {
  scene.clearTrail();
  closePlacePopover();
  circuit.undo();
});
redoBtn.addEventListener("click", () => {
  scene.clearTrail();
  closePlacePopover();
  circuit.redo();
});

// 단축키: Ctrl+Z 실행취소 / Ctrl+Shift+Z 다시실행 (Mac은 Cmd).
// 입력 필드(텍스트 편집)에 포커스가 있을 때는 가로채지 않는다.
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  e.preventDefault();
  scene.clearTrail();
  closePlacePopover();
  if (e.shiftKey) circuit.redo();
  else circuit.undo();
});
resetBtn.addEventListener("click", () => {
  scene.clearTrail();
  circuit.reset();
});
stepBackBtn.addEventListener("click", () => circuit.stepBackward());
stepFwdBtn.addEventListener("click", () => circuit.stepForward());

playBtn.addEventListener("click", () => {
  if (circuit.getSnapshot().isPlaying) {
    circuit.pause();
  } else {
    scene.clearTrail();
    circuit.play();
  }
});

resetViewBtn.addEventListener("click", () => scene.resetView());

// ---------- 공유 / 내보내기 ----------

const shareBtn = document.getElementById("share-btn");
const exportBtn = document.getElementById("export-btn");
const exportMenu = document.getElementById("export-menu");
const toastEl = document.getElementById("toast");
let toastTimer = null;

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${label} copied to clipboard`);
  } catch {
    showToast("Copy failed");
  }
}

shareBtn.addEventListener("click", () => {
  const snap = circuit.getSnapshot();
  copyText(buildShareUrl(snap.qubitCount, snap.grid), "Share link");
});

exportBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!exportMenu.classList.contains("hidden")) {
    exportMenu.classList.add("hidden");
    return;
  }
  exportMenu.classList.remove("hidden");
  const rect = exportBtn.getBoundingClientRect();
  const menuRect = exportMenu.getBoundingClientRect();
  exportMenu.style.left = `${Math.min(rect.left, window.innerWidth - menuRect.width - 8)}px`;
  exportMenu.style.top = `${rect.bottom + 6}px`;
});

document.addEventListener("click", (e) => {
  if (!exportMenu.classList.contains("hidden") && !exportMenu.contains(e.target)) {
    exportMenu.classList.add("hidden");
  }
});

document.getElementById("export-qasm").addEventListener("click", () => {
  const snap = circuit.getSnapshot();
  copyText(toQASM(snap.qubitCount, snap.grid), "OpenQASM 2.0");
  exportMenu.classList.add("hidden");
});

document.getElementById("export-qiskit").addEventListener("click", () => {
  const snap = circuit.getSnapshot();
  copyText(toQiskit(snap.qubitCount, snap.grid), "Qiskit code");
  exportMenu.classList.add("hidden");
});
