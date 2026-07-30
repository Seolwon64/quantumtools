import { createBlochScene } from "./scene.js";
import { createCircuitController, MAX_COLUMNS, involvedQubits } from "./circuit.js";
import { GATE_INFO, computeVisibleProbabilities, sampleCounts } from "./quantum.js";
import { pickLabelMode, niceTickStep, phaseInfo } from "./chart.js";
import { reducedDensityInfo } from "./density.js";
import { initResizableLayout } from "./layout.js";
import { parseShareHash, buildShareUrl, toQASM, toQiskit, decodeCircuit } from "./export.js";
import { PRESETS, PRESET_CATEGORIES } from "./presets.js";
import { gateMatrix, formatComplex, symbolicComplex, gateDescription, decompositionSteps } from "./gatematrix.js";
import { hasMeasurement, measurementColumns, DEFERRED_NOTE } from "./classical.js";
import { phaseWheelGradient } from "./phase.js";

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
const GATE_ENABLED = {}; // IF는 고전 레지스터가 생기며 활성화되었다
// 고전 조건을 붙일 수 없는 게이트(비유니터리 마커 + 분해가 고정된 상대위상 게이트)
const NON_CONDITIONABLE = new Set(["MEASURE", "RESET", "BARRIER", "CTRL", "IF", "RCCX", "RC3X"]);

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
const ROW_PITCH = 56; // 행 높이 50 + gap 6 (세로는 조여 4~5큐비트 세로 스크롤 방지)
const COL_PITCH = 54; // 셀 50 + margin 4
const CELL_CENTER = 25; // 셀(50) 중심. 셀 높이=행 높이라 세로 오프셋 0
// 회로 패널에서 캔버스 말고 나머지가 쓰는 세로 공간(툴바 + 재생 컨트롤 + 패딩)
const CIRCUIT_CHROME = 132;

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
const workspace = document.getElementById("workspace");
const circuitPanel = document.querySelector(".panel-circuit");
const clbitCountLabel = document.getElementById("clbit-count");
const clbitMinusBtn = document.getElementById("clbit-minus");
const clbitPlusBtn = document.getElementById("clbit-plus");
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
const gateInfoEl = document.getElementById("gate-info");
const gateInfoClose = document.getElementById("gate-info-close");
const paletteTitle = document.getElementById("palette-title");
const gateMenu = document.getElementById("gate-menu");
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

// Esc / 바깥 클릭으로 취소. 취소 경로는 컨트롤러를 전혀 호출하지 않으므로 회로도 undo 스택도 그대로다.
const popoverOpen = () => !placePopover.classList.contains("hidden");
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && popoverOpen()) closePlacePopover();
});
document.addEventListener("click", (e) => {
  if (popoverOpen() && !placePopover.contains(e.target)) closePlacePopover();
});

function radToDegRound(rad) {
  return Math.round((rad * 180) / Math.PI);
}

// θ/φ/λ 각도 슬라이더 행을 팝오버에 붙이고 input 요소들을 돌려준다.
// 배치 팝오버와 "Edit parameters" 편집 팝오버가 같은 UI를 쓰도록 공용화한 부분.
function buildSliderRows(names, initialDegrees) {
  const inputs = [];
  names.forEach((name, i) => {
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
    const deg = ((initialDegrees[i] ?? 0) % 360 + 360) % 360;
    slider.value = String(deg);
    label.textContent = name;
    valueSpan.textContent = `${deg}°`;
    slider.addEventListener("input", () => { valueSpan.textContent = `${slider.value}°`; });
    row.append(label, slider, valueSpan);
    placePopover.appendChild(row);
    inputs.push(slider);
  });
  return inputs;
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

  const sliderInputs = buildSliderRows(
    sliderNames,
    sliderNames.map((name) => (name === "θ" ? radToDegRound(info.defaultTheta ?? Math.PI / 2) : 0))
  );

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
  showPopoverAt(clientX, clientY);
}

// 팝오버를 포인터 위치에 띄우되 화면 밖으로 나가지 않게 보정한다(배치/컨트롤 팝오버 공용).
function showPopoverAt(clientX, clientY) {
  placePopover.classList.remove("hidden");
  const rect = placePopover.getBoundingClientRect();
  const left = Math.min(clientX, window.innerWidth - rect.width - 16);
  const top = Math.min(clientY, window.innerHeight - rect.height - 16);
  placePopover.style.left = `${Math.max(8, left)}px`;
  placePopover.style.top = `${Math.max(8, top)}px`;
}

// 게이트 위 "•" 드롭: 제어로 쓸 큐비트를 고른다. 후보가 2개 이상일 때만 열린다(1개면 호출부가 즉시 배치).
// 기존 배치 팝오버의 DOM/스타일(.place-popover-*, .qpick-row/.qpick-btn)을 그대로 재사용한다.
function openControlPopover(column, qubit, candidates, clientX, clientY) {
  closePlacePopover();
  placePopover.innerHTML = "";

  const title = document.createElement("div");
  title.className = "place-popover-title";
  title.textContent = `• → q[${qubit}]`;
  const hint = document.createElement("div");
  hint.className = "place-popover-hint";
  hint.textContent = "Select control qubit(s)";
  placePopover.append(title, hint);

  const chosen = new Set([candidates[0]]); // 첫 후보를 기본 선택(가장 흔한 단일 선택을 한 번에)
  const row = document.createElement("div");
  row.className = "qpick-row";
  let index = 0;
  const buttons = candidates.map((q, i) => {
    const btn = document.createElement("button");
    btn.className = "qpick-btn" + (chosen.has(q) ? " selected" : "");
    btn.textContent = `q[${q}]`;
    btn.tabIndex = i === 0 ? 0 : -1; // roving tabindex: 방향키로 이동, Tab은 그룹 단위
    btn.addEventListener("click", () => { focusAt(i); toggle(i); });
    row.appendChild(btn);
    return btn;
  });
  placePopover.appendChild(row);

  function focusAt(i) {
    index = i;
    buttons.forEach((b, j) => { b.tabIndex = j === i ? 0 : -1; });
    buttons[i].focus();
  }
  // 다중 선택: 후보를 토글한다(최소 1개는 선택돼 있어야 Apply 활성).
  function toggle(i) {
    const q = candidates[i];
    if (chosen.has(q)) chosen.delete(q); else chosen.add(q);
    buttons[i].classList.toggle("selected", chosen.has(q));
    applyBtn.disabled = chosen.size === 0;
  }
  // 확정: 취소 경로와 달리 여기서만 컨트롤러를 호출한다. 여러 개라도 undo 한 단계.
  function apply() {
    if (chosen.size === 0) return;
    const res = circuit.addControlToGate(column, qubit, [...chosen]);
    closePlacePopover();
    if (!res.ok) showToast(res.reason);
  }
  // 방향키로 이동, Space로 토글(버튼 기본 동작), Enter로 확정.
  row.addEventListener("keydown", (e) => {
    const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
    const fwd = e.key === "ArrowRight" || e.key === "ArrowDown";
    if (back || fwd) {
      e.preventDefault();
      focusAt((index + (fwd ? 1 : buttons.length - 1)) % buttons.length);
    } else if (e.key === "Enter") {
      e.preventDefault(); // 포커스된 버튼의 click(=토글)으로 새지 않게 하고 확정으로 쓴다
      apply();
    }
  });

  const actions = document.createElement("div");
  actions.className = "place-popover-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "icon-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", closePlacePopover);
  const applyBtn = document.createElement("button");
  applyBtn.className = "pill-btn-primary";
  applyBtn.textContent = "Apply";
  applyBtn.addEventListener("click", apply);
  actions.append(cancelBtn, applyBtn);
  placePopover.appendChild(actions);

  showPopoverAt(clientX, clientY);
  buttons[0].focus();
}

// ---------- [2] 선택한 게이트 정보 (상태벡터 아래 패널) ----------

// 선택은 셀의 홈 좌표로 들고 있는다. 회로가 바뀌면 render에서 유효성을 다시 확인한다.
let selectedGate = null; // { column, home }

function cellAtHome(snapshot, sel) {
  if (!sel) return null;
  return snapshot.grid[sel.column]?.[sel.home] ?? null;
}

// "Show info"로 정보를 열 때만 설정된다. null이면 Operations 패널은 팔레트를 보여준다.
let infoTarget = null; // { column, home }

function openGateInfo(column, home) {
  infoTarget = { column, home };
  renderGateInfo(circuit.getSnapshot());
}

function closeGateInfo() {
  infoTarget = null;
  expandedInfo = null;
  renderGateInfo(circuit.getSnapshot());
}

// 열에서 qubit을 점유한 placement의 홈 행 (컨트롤러 밖에서도 필요해 여기서 다시 계산)
function homeOf(snapshot, column, qubit) {
  for (let t = 0; t < snapshot.qubitCount; t++) {
    const cell = snapshot.grid[column]?.[t];
    if (cell && involvedQubits(cell).includes(qubit)) return t;
  }
  return -1;
}

function markSelection() {
  for (const el of circuitGrid.querySelectorAll(".selected")) el.classList.remove("selected");
  if (!selectedGate) return;
  const { column, home } = selectedGate;
  const snapshot = circuit.getSnapshot();
  const cell = snapshot.grid[column]?.[home];
  if (!cell) return;
  for (const q of involvedQubits(cell)) {
    const el = circuitGrid.querySelector(`.grid-cell[data-col="${column}"][data-qubit="${q}"] > *`);
    if (el) el.classList.add("selected");
  }
}

const radToDeg = (rad) => (rad * 180) / Math.PI;
// θ/φ/λ를 "π/2 (90°)" 처럼 라디안+도로 함께 보여준다.
const PI_FRACTIONS = [
  [Math.PI, "π"], [Math.PI / 2, "π/2"], [Math.PI / 3, "π/3"], [Math.PI / 4, "π/4"],
  [Math.PI / 6, "π/6"], [Math.PI * 2, "2π"], [Math.PI * 1.5, "3π/2"], [Math.PI * 0.75, "3π/4"],
];
function formatAngle(rad) {
  const hit = PI_FRACTIONS.find(([v]) => Math.abs(Math.abs(rad) - v) < 1e-6);
  const sym = hit ? `${rad < 0 ? "−" : ""}${hit[1]}` : `${rad.toFixed(3)} rad`;
  return `${sym} (${Math.round(radToDeg(rad))}°)`;
}

// 라벨(위/왼쪽 기저 켓)이 붙은 행렬 그리드. 대각 성분은 옅은 배경으로 구분한다.
function buildMatrixGrid(m) {
  const grid = document.createElement("div");
  grid.className = "mx-grid";
  grid.style.gridTemplateColumns = `auto repeat(${m.size}, auto)`;
  const add = (cls, text) => {
    const el = document.createElement("div");
    el.className = cls;
    el.textContent = text;
    grid.appendChild(el);
    return el;
  };
  add("mx-corner", "");
  for (const label of m.basisLabels) add("mx-collabel", label); // 열 라벨(위)
  for (let r = 0; r < m.size; r++) {
    add("mx-rowlabel", m.basisLabels[r]); // 행 라벨(왼쪽)
    for (let c2 = 0; c2 < m.size; c2++) {
      const z = m.rows[r][c2];
      const cell = add("mx-cell" + (r === c2 ? " mx-diag" : ""), formatComplex(z));
      if (Math.abs(z.re) < 5e-4 && Math.abs(z.im) < 5e-4) cell.classList.add("mx-zero");
      const sym = symbolicComplex(z);
      if (sym) {
        cell.title = sym; // 알려진 값이면 기호 표기를 병기(툴팁)
        cell.addEventListener("mouseenter", () => showTooltip(cell, sym));
        cell.addEventListener("mouseleave", hideTooltip);
      }
    }
  }
  return grid;
}

// 파라미터 게이트의 **기호 행렬**(표시용 문자열). 팔레트에서는 각도가 정해지지 않았으므로
// 대표값(π/2)으로 수치 행렬을 보여주면 거짓이 된다 — 기호로 보여주고 배치하라고 안내한다.
// (행렬 계산 모듈은 건드리지 않는다. 이건 순수 표시 텍스트다.)
const SYMBOLIC_MATRICES = {
  RX: [["cos(θ/2)", "−i·sin(θ/2)"], ["−i·sin(θ/2)", "cos(θ/2)"]],
  RY: [["cos(θ/2)", "−sin(θ/2)"], ["sin(θ/2)", "cos(θ/2)"]],
  RZ: [["e^(−iθ/2)", "0"], ["0", "e^(iθ/2)"]],
  P: [["1", "0"], ["0", "e^(iθ)"]],
  U: [["cos(θ/2)", "−e^(iλ)·sin(θ/2)"], ["e^(iφ)·sin(θ/2)", "e^(i(φ+λ))·cos(θ/2)"]],
};

// 기호 행렬을 라벨 붙은 그리드로 (수치 행렬과 같은 시각 언어)
function buildSymbolicGrid(rows) {
  const labels = ["|0⟩", "|1⟩"];
  const grid = document.createElement("div");
  grid.className = "mx-grid mx-symbolic";
  grid.style.gridTemplateColumns = `auto repeat(${rows.length}, auto)`;
  const add = (cls, text) => {
    const el = document.createElement("div");
    el.className = cls;
    el.textContent = text;
    grid.appendChild(el);
  };
  add("mx-corner", "");
  for (const l of labels) add("mx-collabel", l);
  rows.forEach((row, r) => {
    add("mx-rowlabel", labels[r]);
    row.forEach((v, c) => add("mx-cell" + (r === c ? " mx-diag" : ""), v));
  });
  return grid;
}

// Operations 패널의 팔레트 ↔ 게이트 정보 전환. infoTarget이 있을 때만 정보가 보인다.
// infoTarget = { column, home }(배치된 셀) 또는 { palette: gateName }(팔레트 게이트).
function renderGateInfo(snapshot) {
  if (infoTarget?.palette) return renderPaletteInfo(infoTarget.palette);
  const cell = cellAtHome(snapshot, infoTarget);
  if (!cell) {
    infoTarget = null;
    gateInfoEl.classList.add("hidden");
    gateInfoEl.innerHTML = "";
    gatePalette.classList.remove("hidden");
    gateInfoClose.classList.add("hidden");
    paletteTitle.textContent = "Operations";
    return;
  }
  gateInfoEl.classList.remove("hidden");
  gatePalette.classList.add("hidden"); // 표시 중에는 팔레트 대신 정보가 보인다
  gateInfoClose.classList.remove("hidden");
  paletteTitle.textContent = "Gate info";
  gateInfoEl.innerHTML = "";
  const row = (html) => {
    const d = document.createElement("div");
    d.className = "gate-info-row";
    d.innerHTML = html;
    gateInfoEl.appendChild(d);
    return d;
  };

  const title = document.createElement("div");
  title.className = "gate-info-title";
  title.textContent = standardGateName(cell);
  gateInfoEl.appendChild(title);

  row(gateDescription(cell));

  // 적용 대상
  const targets = cell.targets ?? [];
  const controls = cell.controls ?? [];
  const qList = (arr) => arr.map((q) => `q[${q}]`).join(", ");
  if (GATE_INFO[cell.gate]?.kind === "decomposed") {
    row(`<b>Controls</b> ${qList(targets.slice(0, -1))} · <b>Target</b> ${qList(targets.slice(-1))}`);
  } else {
    row(`<b>Target</b> ${qList(targets)}${controls.length ? ` · <b>Controls</b> ${qList(controls)}` : ""}`);
  }

  // 파라미터(라디안 + 도)
  const params = cell.params ?? {};
  const names = [["theta", "θ"], ["phi", "φ"], ["lambda", "λ"]];
  const shown = names.filter(([k]) => params[k] !== undefined);
  if (shown.length) row(shown.map(([k, sym]) => `<b>${sym}</b> ${formatAngle(params[k])}`).join(" · "));

  // 행렬
  const m = gateMatrix(cell);
  if (m.ok) {
    gateInfoEl.appendChild(buildMatrixGrid(m));
    const note = document.createElement("div");
    note.className = "gate-info-note";
    note.textContent = m.localOrder; // 예: local |c t⟩ = |q0 q1⟩
    gateInfoEl.appendChild(note);
  } else if (m.tooLarge) {
    row(`Matrix is ${m.size}x${m.size} (too large to display)`);
    const note = document.createElement("div");
    note.className = "gate-info-note";
    note.textContent = m.localOrder;
    gateInfoEl.appendChild(note);
  } else {
    row(m.reason);
  }

  // [4] 분해 표시 + Apply expansion
  if (expandedInfo && expandedInfo.column === infoTarget.column && expandedInfo.home === infoTarget.home) {
    const steps = decompositionSteps(cell);
    if (steps) {
      const hint = document.createElement("div");
      hint.className = "gate-info-note";
      hint.textContent = "Definition (read-only)";
      gateInfoEl.appendChild(hint);
      const list = document.createElement("div");
      list.className = "gate-info-steps";
      for (const s of steps) {
        const chip = document.createElement("span");
        chip.className = "gate-info-step";
        chip.textContent = s.text;
        list.appendChild(chip);
      }
      gateInfoEl.appendChild(list);
      const apply = document.createElement("button");
      apply.className = "pill-btn-primary";
      apply.textContent = "Apply expansion";
      apply.addEventListener("click", () => {
        const { column, home } = infoTarget;
        const res = circuit.expandGate(column, home);
        expandedInfo = null;
        if (!res.ok) { showToast(res.reason); return; }
        infoTarget = null; // 원래 게이트가 사라졌으니 정보를 닫고 팔레트로 돌아간다
        selectedGate = null;
        showToast(`Expanded into ${res.columns} steps — Undo (Ctrl+Z) to revert`);
      });
      gateInfoEl.appendChild(apply);
    }
  }
}
let expandedInfo = null; // { column, home } — "Expand definition"을 누른 셀

// [1] 팔레트 게이트(아직 배치되지 않음)의 정보. 제어도 파라미터도 없으므로 기본 2×2를 보여준다.
function renderPaletteInfo(gateName) {
  const info = GATE_INFO[gateName];
  gateInfoEl.classList.remove("hidden");
  gatePalette.classList.add("hidden");
  gateInfoClose.classList.remove("hidden");
  paletteTitle.textContent = "Gate info";
  gateInfoEl.innerHTML = "";

  const title = document.createElement("div");
  title.className = "gate-info-title";
  title.textContent = info?.label ?? gateName;
  gateInfoEl.appendChild(title);

  const row = (html) => {
    const d = document.createElement("div");
    d.className = "gate-info-row";
    d.innerHTML = html;
    gateInfoEl.appendChild(d);
    return d;
  };
  row(info?.desc ?? gateName);

  const symbolic = SYMBOLIC_MATRICES[gateName];
  if (symbolic) {
    // 각도가 정해지지 않았으므로 대표값을 쓰지 않고 기호로 보여준다.
    gateInfoEl.appendChild(buildSymbolicGrid(symbolic));
    const note = document.createElement("div");
    note.className = "gate-info-note";
    note.textContent = "Place this gate to see its matrix with the chosen angle.";
    gateInfoEl.appendChild(note);
  } else {
    const m = gateMatrix({ gate: gateName, targets: [0], controls: [], params: {} });
    if (m.ok) {
      gateInfoEl.appendChild(buildMatrixGrid(m));
    } else if (m.tooLarge) {
      row(`Matrix is ${m.size}x${m.size} (too large to display)`);
    } else {
      row(m.reason);
    }
  }

  const hint = document.createElement("div");
  hint.className = "gate-info-note";
  hint.textContent = "From the palette — drop it on the circuit to add controls or set parameters.";
  gateInfoEl.appendChild(hint);
}

// ---------- [3] 컨텍스트 메뉴 (가로 아이콘 바) ----------

// 아이콘은 인라인 SVG로만 넣는다 — 이모지는 플랫폼마다 렌더링이 다르고 크기 제어가 안 된다.
// 한 세트로 보이도록 24 뷰박스 · stroke-width 1.9 · round 캡으로 통일한다.
const svgIcon = (body) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const MENU_ICONS = {
  // ⓘ 원 안 i
  info: svgIcon('<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16.5"/><circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none"/>'),
  // ✎ 연필
  edit: svgIcon('<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><line x1="14.5" y1="6.5" x2="17.5" y2="9.5"/>'),
  // 상자에서 펼쳐지는 형태(⤢): 점선 상자 + 바깥으로 향하는 화살표
  expand: svgIcon('<path d="M4 9V5h4"/><path d="M20 15v4h-4"/><line x1="5" y1="5.6" x2="10.5" y2="11"/><line x1="19" y1="18.4" x2="13.5" y2="13"/><path d="M15 4.5h4.5V9"/><path d="M9 19.5H4.5V15"/>'),
  // 제어점(•)—타깃(◯) 연결 + 오른쪽 위 "+" 배지 (회로 표기 그대로 읽히게)
  ctrlAdd: svgIcon('<circle cx="7.5" cy="5.5" r="2.4" fill="currentColor" stroke="none"/><line x1="7.5" y1="7.9" x2="7.5" y2="15.4"/><circle cx="7.5" cy="18" r="2.6"/><line x1="14.5" y1="6" x2="20.5" y2="6"/><line x1="17.5" y1="3" x2="17.5" y2="9"/>'),
  // 같은 표기 + "−" 배지
  ctrlRemove: svgIcon('<circle cx="7.5" cy="5.5" r="2.4" fill="currentColor" stroke="none"/><line x1="7.5" y1="7.9" x2="7.5" y2="15.4"/><circle cx="7.5" cy="18" r="2.6"/><line x1="14.5" y1="6" x2="20.5" y2="6"/>'),
  // 고전 비트: 게이트에서 이중선이 아래로 내려가는 형태
  clbit: svgIcon('<rect x="6.5" y="3.5" width="11" height="7" rx="1.6"/><line x1="10.2" y1="10.5" x2="10.2" y2="19"/><line x1="13.8" y1="10.5" x2="13.8" y2="19"/><line x1="5" y1="19" x2="19" y2="19"/>'),
  // 🗑 휴지통
  trash: svgIcon('<path d="M4.5 6.5h15"/><path d="M9.5 6.5V4.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.7"/><path d="M6.5 6.5 7.4 19a1.3 1.3 0 0 0 1.3 1.2h6.6a1.3 1.3 0 0 0 1.3-1.2l.9-12.5"/><line x1="10.4" y1="10" x2="10.7" y2="16.8"/><line x1="13.6" y1="10" x2="13.3" y2="16.8"/>'),
};

let menuIndex = 0;
function closeGateMenu() {
  gateMenu.classList.add("hidden");
  gateMenu.innerHTML = "";
  hideTooltip(); // 아이콘 툴팁이 남아 떠 있지 않게
}
const gateMenuOpen = () => !gateMenu.classList.contains("hidden");

function openGateMenu(column, home, clientX, clientY) {
  closeGateMenu();
  const snapshot = circuit.getSnapshot();
  const cell = snapshot.grid[column]?.[home];
  if (!cell) return;
  const info = GATE_INFO[cell.gate];
  const params = cell.params ?? {};
  const hasParams = ["theta", "phi", "lambda"].some((k) => params[k] !== undefined);
  const controls = cell.controls ?? [];
  const steps = decompositionSteps(cell);
  // 분해가 없는 이유: 진짜 기본 게이트인지, 이 앱에 정의가 없을 뿐인지 구분해 안내한다.
  const primitive = info?.kind === "fixed" || info?.kind === "param" || info?.kind === "param3";
  const opts = circuit.controlOptions(column, home);

  // group: 관련 항목끼리 묶어 구분선을 넣는다 — [정보/편집] | [제어] | [삭제]
  const items = [
    { label: "Show info", icon: "info", group: 0, run: () => { expandedInfo = null; openGateInfo(column, home); } },
    {
      label: "Edit parameters", icon: "edit", group: 0, enabled: hasParams,
      why: "No parameters (only RX, RY, RZ, P, U have parameters)",
      run: () => openParamEditor(column, home, cell, clientX, clientY),
    },
    {
      label: "Expand definition", icon: "expand", group: 0, enabled: !!steps,
      why: primitive ? "Primitive gate — no decomposition" : "No decomposition defined for this gate",
      run: () => { expandedInfo = { column, home }; openGateInfo(column, home); },
    },
    {
      label: "Add control", icon: "ctrlAdd", group: 1, enabled: opts.ok,
      why: opts.ok ? null : (opts.reason === "No free wire in this column for a control" ? "No free wire in this column" : opts.reason),
      run: () => {
        if (opts.candidates.length === 1) {
          const res = circuit.addControlToGate(column, home, opts.candidates[0]);
          if (!res.ok) showToast(res.reason);
        } else openControlPopover(column, home, opts.candidates, clientX, clientY);
      },
    },
    {
      label: "Remove control", icon: "ctrlRemove", group: 1, enabled: controls.length > 0,
      why: "This gate has no controls",
      run: () => {
        if (controls.length === 1) circuit.removeControl(column, controls[0]);
        else openRemoveControlPopover(column, controls, clientX, clientY);
      },
    },
    // 고전 레지스터: Measure는 기록 대상 비트를, 그 밖의 게이트는 조건 비트를 고른다.
    cell.gate === "MEASURE"
      ? {
          label: "Set classical bit", icon: "clbit", group: 1, enabled: snapshot.clbitCount > 0,
          why: "There are no classical bits",
          run: () => openMeasureBitPopover(column, home, snapshot.clbitCount, clientX, clientY),
        }
      : {
          label: params.cif === undefined ? "Add condition (if)" : "Change / remove condition",
          icon: "clbit", group: 1,
          enabled: snapshot.clbitCount > 0 && !NON_CONDITIONABLE.has(cell.gate),
          why: snapshot.clbitCount === 0 ? "There are no classical bits" : `${cell.gate} cannot be conditioned`,
          run: () => openConditionPopover(column, home, snapshot.clbitCount, clientX, clientY),
        },
    // 파괴적 동작은 맨 오른쪽에 구분선으로 분리한다
    { label: "Delete", icon: "trash", group: 2, danger: true, run: () => { circuit.removeGate(column, home); selectedGate = null; infoTarget = null; } },
  ];

  const buttons = [];
  items.forEach((item, i) => {
    if (i > 0 && item.group !== items[i - 1].group) {
      const sep = document.createElement("div");
      sep.className = "gate-menu-sep";
      gateMenu.appendChild(sep);
    }
    const btn = document.createElement("button");
    btn.className = "gate-menu-item" + (item.danger ? " is-danger" : "");
    btn.innerHTML = MENU_ICONS[item.icon];
    const off = item.enabled === false;
    // `disabled` 속성을 쓰지 않는다 — 브라우저가 disabled 요소의 마우스 이벤트를 막아
    // "왜 못 쓰는지" 툴팁이 아예 뜨지 않기 때문. aria-disabled로 표현하고 클릭만 막는다.
    // 라벨이 아이콘으로 바뀌어 사유 툴팁이 더 중요해졌다.
    if (off) {
      btn.classList.add("is-disabled");
      btn.setAttribute("aria-disabled", "true");
    }
    // 아이콘만으로는 의미를 알 수 없으므로 이름(또는 비활성 사유)을 반드시 노출한다.
    const tip = off ? (item.why ?? item.label) : item.label;
    btn.setAttribute("aria-label", off && item.why ? `${item.label} — ${item.why}` : item.label);
    btn.tabIndex = -1; // roving tabindex: 방향키로 이동(비활성도 포커스는 받는다)
    btn.addEventListener("mouseenter", () => showTooltip(btn, tip));
    btn.addEventListener("mouseleave", hideTooltip);
    btn.addEventListener("focus", () => showTooltip(btn, tip));
    btn.addEventListener("click", (e) => {
      e.stopPropagation(); // document로 가면 "바깥 클릭"이 방금 연 팝오버/메뉴를 즉시 닫는다
      if (off) return;
      closeGateMenu();
      scene.clearTrail();
      item.run();
    });
    gateMenu.appendChild(btn);
    buttons.push(btn);
  });

  gateMenu.classList.remove("hidden");
  // 선택한 게이트 근처에 띄우되 화면 밖으로 나가지 않게 보정한다(오른쪽 끝 게이트도 잘리지 않게).
  const rect = gateMenu.getBoundingClientRect();
  const left = Math.min(Math.max(8, clientX - rect.width / 2), window.innerWidth - rect.width - 8);
  const above = clientY - rect.height - 12;
  gateMenu.style.left = `${left}px`;
  gateMenu.style.top = `${above >= 8 ? above : Math.min(clientY + 16, window.innerHeight - rect.height - 8)}px`;

  // 좌우 방향키로 이동, Enter/Space로 실행. 비활성 항목도 **건너뛰지 않고** 포커스를 받아
  // 사유 툴팁을 볼 수 있게 한다(실행만 막힌다).
  menuIndex = 0;
  const focusAt = (i) => {
    menuIndex = (i + buttons.length) % buttons.length;
    buttons.forEach((b, j) => {
      b.classList.toggle("active", j === menuIndex);
      b.tabIndex = j === menuIndex ? 0 : -1;
    });
    buttons[menuIndex].focus();
  };
  if (buttons.length) focusAt(0);
  gateMenu.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); focusAt(menuIndex + 1); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); focusAt(menuIndex - 1); }
  });
}

gateInfoClose.addEventListener("click", closeGateInfo);

// Esc: 메뉴가 열려 있으면 메뉴부터, 아니면 게이트 정보를 닫는다(팔레트로 복귀).
// 회로는 어느 쪽도 바뀌지 않는다.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (gateMenuOpen()) closeGateMenu();
  else if (infoTarget) closeGateInfo();
});
document.addEventListener("click", (e) => {
  if (gateMenuOpen() && !gateMenu.contains(e.target)) closeGateMenu();
});

// 고전 비트 하나를 고르는 팝오버(조건 지정 / 측정 대상 지정 공용).
// 기존 배치 팝오버의 DOM·스타일(.qpick-row/.qpick-btn)을 그대로 재사용한다.
function openBitPopover({ title, hint, count, current, clientX, clientY, onPick, allowNone }) {
  closePlacePopover();
  placePopover.innerHTML = "";
  const t = document.createElement("div");
  t.className = "place-popover-title";
  t.textContent = title;
  const h = document.createElement("div");
  h.className = "place-popover-hint";
  h.textContent = hint;
  placePopover.append(t, h);

  const row = document.createElement("div");
  row.className = "qpick-row";
  for (let k = 0; k < count; k++) {
    const btn = document.createElement("button");
    btn.className = "qpick-btn" + (k === current ? " selected" : "");
    btn.textContent = `c[${k}]`;
    btn.addEventListener("click", () => {
      const res = onPick(k);
      closePlacePopover();
      if (res && !res.ok) showToast(res.reason);
    });
    row.appendChild(btn);
  }
  placePopover.appendChild(row);

  const actions = document.createElement("div");
  actions.className = "place-popover-actions";
  const cancel = document.createElement("button");
  cancel.className = "icon-btn";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", closePlacePopover);
  actions.appendChild(cancel);
  if (allowNone) {
    const none = document.createElement("button");
    none.className = "icon-btn";
    none.textContent = allowNone;
    none.addEventListener("click", () => {
      const res = onPick(null);
      closePlacePopover();
      if (res && !res.ok) showToast(res.reason);
    });
    actions.appendChild(none);
  }
  placePopover.appendChild(actions);
  showPopoverAt(clientX, clientY);
  row.querySelector(".qpick-btn")?.focus();
}

function openConditionPopover(column, qubit, clbitCount, clientX, clientY) {
  const snap = circuit.getSnapshot();
  const home = homeOf(snap, column, qubit);
  const current = home === -1 ? undefined : snap.grid[column][home]?.params?.cif;
  openBitPopover({
    title: "Conditional (if)",
    hint: "Apply this gate only when the bit is 1",
    count: clbitCount,
    current,
    clientX, clientY,
    allowNone: current !== undefined ? "Remove condition" : null,
    onPick: (k) => circuit.setCondition(column, qubit, k),
  });
}

function openMeasureBitPopover(column, qubit, clbitCount, clientX, clientY) {
  const snap = circuit.getSnapshot();
  const home = homeOf(snap, column, qubit);
  const current = home === -1 ? undefined : snap.grid[column][home]?.params?.cbit;
  openBitPopover({
    title: "Measure → classical bit",
    hint: "Where to write the measurement result",
    count: clbitCount,
    current,
    clientX, clientY,
    onPick: (k) => circuit.setClassicalBit(column, qubit, k),
  });
}

// 제어가 여럿일 때 어느 것을 제거할지 고른다 (컨트롤 선택 팝오버와 같은 UI).
function openRemoveControlPopover(column, controls, clientX, clientY) {
  closePlacePopover();
  placePopover.innerHTML = "";
  const title = document.createElement("div");
  title.className = "place-popover-title";
  title.textContent = "Remove control";
  const hint = document.createElement("div");
  hint.className = "place-popover-hint";
  hint.textContent = "Which control to remove?";
  placePopover.append(title, hint);

  const row = document.createElement("div");
  row.className = "qpick-row";
  controls.forEach((q) => {
    const btn = document.createElement("button");
    btn.className = "qpick-btn";
    btn.textContent = `q[${q}]`;
    btn.addEventListener("click", () => {
      circuit.removeControl(column, q);
      closePlacePopover();
    });
    row.appendChild(btn);
  });
  placePopover.appendChild(row);

  const actions = document.createElement("div");
  actions.className = "place-popover-actions";
  const cancel = document.createElement("button");
  cancel.className = "icon-btn";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", closePlacePopover);
  actions.appendChild(cancel);
  placePopover.appendChild(actions);
  showPopoverAt(clientX, clientY);
  row.querySelector(".qpick-btn")?.focus();
}

// 배치된 게이트의 파라미터 편집 — 배치 팝오버의 슬라이더를 그대로 재사용한다.
function openParamEditor(column, home, cell, clientX, clientY) {
  closePlacePopover();
  placePopover.innerHTML = "";
  const params = cell.params ?? {};
  const names = [["theta", "θ"], ["phi", "φ"], ["lambda", "λ"]].filter(([k]) => params[k] !== undefined);

  const title = document.createElement("div");
  title.className = "place-popover-title";
  title.textContent = `${standardGateName(cell)} — parameters`;
  placePopover.appendChild(title);

  const sliders = buildSliderRows(names.map(([, sym]) => sym), names.map(([k]) => radToDegRound(params[k])));

  const actions = document.createElement("div");
  actions.className = "place-popover-actions";
  const cancel = document.createElement("button");
  cancel.className = "icon-btn";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", closePlacePopover);
  const apply = document.createElement("button");
  apply.className = "pill-btn-primary";
  apply.textContent = "Apply";
  apply.addEventListener("click", () => {
    const next = { ...params };
    names.forEach(([k], i) => { next[k] = (Number(sliders[i].value) * Math.PI) / 180; });
    const res = circuit.setParams(column, home, next);
    closePlacePopover();
    if (!res.ok) showToast(res.reason);
  });
  actions.append(cancel, apply);
  placePopover.appendChild(actions);
  showPopoverAt(clientX, clientY);
}

// ---------- 팔레트 ----------

// 스크롤 컨테이너에 잘리지 않도록 body에 고정 위치로 띄우는 커스텀 툴팁
const gateTooltip = document.createElement("div");
gateTooltip.className = "gate-tooltip hidden";
document.body.appendChild(gateTooltip);

function showTooltip(anchor, text) {
  gateTooltip.textContent = text;
  gateTooltip.classList.toggle("has-matrix", text.includes("\n")); // 행렬 미리보기는 등폭으로
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

// 배치된 게이트/제어점에 hover하면 표준 이름(CX, CZ, CCX …)만 툴팁으로 보여준다(식별용).
// 행렬은 hover가 아니라 컨텍스트 메뉴의 "Show info"로만 본다.
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
  // [1] 우클릭 → 정보 패널(배치된 게이트의 Show info와 같은 패널·표시 로직).
  // 좌클릭/드래그 경로는 건드리지 않는다.
  btn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    hideTooltip();
    expandedInfo = null;
    infoTarget = { palette: gateName };
    renderGateInfo(circuit.getSnapshot());
  });
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
        // 셀의 역할을 DOM에 기록: 드롭 분기(게이트 위 vs 빈 칸)와 제어점 드래그가 참조한다.
        cell.dataset.role = role.type;
        if (role.type === "control" || (role.type === "target" && controlledZ)) {
          const dot = document.createElement("div");
          dot.className = "ctrl-dot";
          attachGateHover(dot, role.cell);
          cell.appendChild(dot);
        } else {
          const chip = document.createElement("div");
          chip.className = `placed-gate cat-${GATE_CATEGORY[role.cell.gate] ?? "structural"}`;
          if (info?.kind === "decomposed") chip.classList.add("placed-advanced"); // RCCX/RC3X 시각 구분
          // 두 번째 타깃을 흐리게 하지 않는다 — RZZ/RXX처럼 한 게이트가 두 블록으로 그려질 때
          // 한쪽만 감광되면 서로 다른 게이트처럼 보였다. 하나의 게이트는 같은 색이어야 한다.
          if (role.cell.gate === "MEASURE") {
            chip.innerHTML = MEASURE_SVG;
          } else {
            const label = role.cell.gate === "SWAP" ? "×" : (info.targetLabel ?? info.label);
            chip.textContent = label;
            // ⊕(CNOT/Toffoli 타깃)·×(SWAP)는 박스가 아니라 와이어 위 기호 → 배경 없이 그려
            // 아래 레이어의 연결선이 기호 중심까지 이어져 보이게 한다([1] 표준 표기).
            if (label === "⊕" || label === "×") chip.classList.add("placed-symbol");
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

  // 고전 레지스터 와이어(이중선). 고전 비트가 0개면 아예 그리지 않는다.
  const clRow = snapshot.qubitCount; // 큐비트 행들 바로 아래
  if (snapshot.clbitCount > 0) {
    const row = document.createElement("div");
    row.className = "qubit-row clbit-row";
    const label = document.createElement("span");
    label.className = "qubit-label clbit-label";
    label.textContent = `c / ${snapshot.clbitCount}`; // IBM Composer식 묶음 표기
    label.title = `Classical register: ${snapshot.clbitCount} bit(s)`;
    row.appendChild(label);
    const wire = document.createElement("div");
    wire.className = "qubit-wire clbit-wire";
    for (let col = 0; col < MAX_COLUMNS; col++) {
      const cell = document.createElement("div");
      cell.className = "grid-cell";
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
      const x = GRID_PAD_LEFT + LABEL_WIDTH + col * COL_PITCH + CELL_CENTER;
      const qubits = involvedQubits(cell);
      if (qubits.length >= 2) {
        const minQ = Math.min(...qubits);
        const maxQ = Math.max(...qubits);
        const line = document.createElement("div");
        line.className = "gate-connector";
        line.style.left = `${x - 1}px`;
        line.style.top = `${GRID_PAD_TOP + minQ * ROW_PITCH + CELL_CENTER}px`;
        line.style.height = `${(maxQ - minQ) * ROW_PITCH}px`;
        circuitGrid.appendChild(line);
      }
    }
  }

  // 고전 와이어로 가는 이중선: Measure의 기록(cbit) / 조건부 연산의 조건(cif).
  // 한 열에 여러 개가 내려올 수 있으므로(예: 텔레포테이션의 두 측정) 좌우로 벌려 겹치지 않게 한다.
  if (snapshot.clbitCount > 0) {
    const clY = GRID_PAD_TOP + clRow * ROW_PITCH + CELL_CENTER;
    for (let col = 0; col < MAX_COLUMNS; col++) {
      const links = [];
      for (let t = 0; t < snapshot.qubitCount; t++) {
        const cell = snapshot.grid[col]?.[t];
        if (!cell) continue;
        const p = cell.params ?? {};
        const bit = cell.gate === "MEASURE" ? p.cbit : p.cif;
        if (bit === undefined) continue;
        const isMeasure = cell.gate === "MEASURE";
        const fromQ = isMeasure ? cell.targets[0] : Math.max(...involvedQubits(cell));
        links.push({ bit, isMeasure, fromQ });
      }
      if (!links.length) continue;
      const baseX = GRID_PAD_LEFT + LABEL_WIDTH + col * COL_PITCH + CELL_CENTER;
      links.forEach((l, i) => {
        const x = baseX + (i - (links.length - 1) / 2) * 15; // 여러 개면 나란히
        const top = GRID_PAD_TOP + l.fromQ * ROW_PITCH + CELL_CENTER;
        const link = document.createElement("div");
        link.className = "cl-connector";
        link.style.left = `${x - 2}px`;
        link.style.top = `${top}px`;
        link.style.height = `${(clRow - l.fromQ) * ROW_PITCH}px`;
        circuitGrid.appendChild(link);
        const badge = document.createElement("div");
        badge.className = "cl-bit-badge" + (l.isMeasure ? "" : " cl-bit-cond");
        badge.textContent = String(l.bit);
        badge.style.left = `${x}px`;
        badge.style.top = `${clY}px`;
        badge.title = l.isMeasure
          ? `Measurement result is written to c[${l.bit}]`
          : `Applied only when c[${l.bit}] is 1`;
        circuitGrid.appendChild(badge);
      });
    }
  }

  // [5] 스텝 인디케이터(현재 재생 위치). innerHTML 재구성으로 매번 새로 만들고 현재 스텝에 둔다.
  highlightedCol = -1; // 셀이 새로 만들어져 하이라이트 클래스는 사라짐
  const ind = document.createElement("div");
  ind.className = "step-indicator";
  ind.style.height = `${snapshot.qubitCount * ROW_PITCH - 8}px`;
  ind.style.transform = `translateX(${stepIndicatorX(snapshot.stepIndex)}px)`;
  ind.classList.toggle("hidden", snapshot.totalSteps === 0);
  circuitGrid.appendChild(ind);
  stepIndicatorEl = ind;
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

  // "•"(Control) 드롭. 두 경로 모두 컨트롤러의 같은 부착 로직을 거쳐 동일한 셀을 만든다:
  //  - 게이트가 있는 셀 위 → 그 게이트를 제어형으로 변환(제어 큐비트는 빈 와이어에 자동 배치)
  //  - 빈 셀 → 같은 열의 최근접 게이트에 그 큐비트를 제어로 부착(기존 경로)
  if (gateName === "CTRL") {
    scene.clearTrail();
    if (!cell.dataset.role) { // 빈 칸: 같은 열의 최근접 게이트에 부착(기존 경로)
      const res = circuit.addControl(column, qubit);
      if (!res.ok) showTransientTip(cell, res.reason);
      return;
    }
    const opt = circuit.controlOptions(column, qubit);
    if (!opt.ok) { showTransientTip(cell, opt.reason); return; } // 팝오버를 띄우기 전에 거부
    if (opt.candidates.length === 1) { // 선택지가 없는 선택은 불필요한 클릭 → 즉시 배치
      const res = circuit.addControlToGate(column, qubit, opt.candidates[0]);
      if (!res.ok) showTransientTip(cell, res.reason);
      return;
    }
    openControlPopover(column, qubit, opt.candidates, e.clientX, e.clientY);
    return;
  }

  // "if" 드롭: 이미 놓인 게이트에 고전 조건(c[k]==1)을 붙인다. •와 같은 조작 방식.
  if (gateName === "IF") {
    if (!cell.dataset.role) { showTransientTip(cell, "Drop “if” on a gate to make it conditional"); return; }
    const snap = circuit.getSnapshot();
    if (snap.clbitCount === 0) { showTransientTip(cell, "There are no classical bits — add one first"); return; }
    openConditionPopover(column, qubit, snap.clbitCount, e.clientX, e.clientY);
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

// [1] 게이트 좌클릭 → 컨텍스트 메뉴(우클릭과 동일). 게이트는 삭제되지 않고 정보 패널도
// 자동으로 뜨지 않는다 — 정보는 메뉴의 "Show info"로만 연다.
// 제어점(•) 클릭은 기존대로 그 제어만 제거한다.
circuitGrid.addEventListener("click", (e) => {
  const cell = e.target.closest(".grid-cell");
  if (!cell) return;
  const column = Number(cell.dataset.col);
  const qubit = Number(cell.dataset.qubit);
  scene.clearTrail();
  if (cell.dataset.role === "control") {
    circuit.removeControl(column, qubit);
    return;
  }
  if (cell.dataset.role) {
    e.stopPropagation(); // 이 클릭이 document로 가면 방금 연 메뉴가 바로 닫힌다
    openMenuForCell(column, qubit, e.clientX, e.clientY);
  } else {
    selectedGate = null; // 빈 칸 클릭 → 선택 해제
    markSelection();
  }
});

// 우클릭도 계속 동작한다
circuitGrid.addEventListener("contextmenu", (e) => {
  const cell = e.target.closest(".grid-cell");
  if (!cell || !cell.dataset.role) return; // 빈 칸은 브라우저 기본 메뉴를 그대로 둔다
  e.preventDefault();
  openMenuForCell(Number(cell.dataset.col), Number(cell.dataset.qubit), e.clientX, e.clientY);
});

// 게이트를 선택 상태로 만들고(= Delete 키의 대상) 메뉴를 연다. 정보 패널은 건드리지 않는다.
function openMenuForCell(column, qubit, clientX, clientY) {
  const snapshot = circuit.getSnapshot();
  const home = homeOf(snapshot, column, qubit);
  if (home === -1) return;
  hideTooltip();
  selectedGate = { column, home };
  markSelection();
  openGateMenu(column, home, clientX, clientY);
}

// [6] 삭제 빠른 경로: 선택된 게이트를 Delete/Backspace로 제거한다(메뉴가 열린 상태 포함 —
// 메뉴를 열면 그 게이트가 선택되므로 그대로 키를 눌러 지울 수 있다). 좌클릭 삭제가 없어진 대신의 경로.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Delete" && e.key !== "Backspace") return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  if (!selectedGate) return;
  e.preventDefault();
  scene.clearTrail();
  closeGateMenu();
  circuit.removeGate(selectedGate.column, selectedGate.home);
  selectedGate = null;
  infoTarget = null; // 지운 게이트의 정보가 남아 있지 않게
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

// ---------- 스텝 재생 전환 애니메이션 ([1] 시각적 트윈만, U^t 미사용) ----------
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// 스텝당 전환/정지 시간. 속도 선택 UI를 없애고 기존 "Normal" 값으로 고정한다
// (≈1초/스텝 — 예전 500ms보다 느린 이 값을 유지해야 한다).
const STEP_DURATION = 700;
const STEP_PAUSE = 300;
const stepDuration = () => (reducedMotion ? 0 : STEP_DURATION);
const stepPause = () => STEP_PAUSE;

// [2] 확률 막대 트윈용 차트: from/to에서 보이는 상태의 합집합을 한 번 그리고, 매 프레임
// 막대 높이(path d)만 갱신한다(재구성 없음 → 성능). 0%↔값 막대도 자연스럽게 생성/소멸.
function buildProbTween(fromProbs, toProbs, qubitCount, W, H) {
  const opts = { hideZero: hideZeroProb, qubitCount, topN: PROB_TOP_N, showAll: probShowAll, observed: new Set() };
  const fromVis = computeVisibleProbabilities(fromProbs, opts).visible;
  const toVis = computeVisibleProbabilities(toProbs, opts).visible;
  const idxSet = new Set();
  for (const e of fromVis) idxSet.add(e.index);
  for (const e of toVis) idxSet.add(e.index);
  const indices = [...idxSet].sort((a, b) => a - b);
  const n = indices.length;
  if (n === 0) return null;

  const M = { top: 12, right: 10, left: 42 };
  const plotW = W - M.left - M.right;
  const bandW = plotW / n;
  const labelChars = qubitCount + 2;
  const labelPx = labelChars * 6.2;
  const mode = pickLabelMode(n, bandW, labelPx);
  const bottom = mode === "rot45" ? 46 : 24;
  const plotH = H - M.top - bottom;
  const px0 = M.left, px1 = W - M.right, py0 = M.top, py1 = M.top + plotH;
  const barW = Math.min(bandW - 2, 46);

  const svg = svgEl("svg", { width: "100%", height: "100%", viewBox: `0 0 ${W} ${H}` });
  svg.classList.add("prob-svg");
  for (let pct = 0; pct <= 100; pct += 20) {
    const y = py1 - (pct / 100) * plotH;
    svg.appendChild(svgEl("line", { x1: px0, y1: y, x2: px1, y2: y, stroke: pct === 0 ? CHART.axis : CHART.grid, "stroke-width": pct === 0 ? 1.5 : 1 }));
    const t = svgEl("text", { x: px0 - 6, y: y + 3.5, "text-anchor": "end", class: "prob-axis-num" });
    t.textContent = String(pct); svg.appendChild(t);
  }
  const cyT = (py0 + py1) / 2;
  const yTitle = svgEl("text", { x: 12, y: cyT, "text-anchor": "middle", transform: `rotate(-90, 12, ${cyT})`, class: "prob-axis-title" });
  yTitle.textContent = "Probability (%)"; svg.appendChild(yTitle);

  const bars = [];
  const tickStep = mode === "sparse" ? niceTickStep(bandW, 40) : 1;
  let lastLabelX = -Infinity;
  indices.forEach((idx, i) => {
    const cx = px0 + i * bandW + bandW / 2;
    const bx = cx - barW / 2;
    const fromP = fromProbs[idx].probability;
    const toP = toProbs[idx].probability;
    const path = svgEl("path", { d: "", fill: CHART.theorySolid });
    svg.appendChild(path);
    bars.push({ path, bx, fromP, toP });
    const label = `|${fromProbs[idx].label}⟩`;
    if (mode === "horizontal") {
      const t = svgEl("text", { x: cx, y: py1 + 15, "text-anchor": "middle", class: "prob-xlabel" }); t.textContent = label; svg.appendChild(t);
    } else if (mode === "rot45") {
      const t = svgEl("text", { x: cx, y: py1 + 12, "text-anchor": "end", transform: `rotate(-45, ${cx}, ${py1 + 12})`, class: "prob-xlabel" }); t.textContent = label; svg.appendChild(t);
    } else {
      if (i % tickStep === 0) {
        svg.appendChild(svgEl("line", { x1: cx, y1: py1, x2: cx, y2: py1 + 4, stroke: CHART.axis, "stroke-width": 1 }));
        const t = svgEl("text", { x: cx, y: py1 + 15, "text-anchor": "middle", class: "prob-xtick" }); t.textContent = String(idx); svg.appendChild(t);
      }
      const peak = Math.max(fromP, toP);
      if (peak >= 1 && cx - lastLabelX >= labelPx + 4) {
        const t = svgEl("text", { x: cx, y: py1 - (peak / 100) * plotH - 4, "text-anchor": "middle", class: "prob-xlabel" }); t.textContent = label; svg.appendChild(t); lastLabelX = cx;
      }
    }
  });

  function update(e) {
    for (const b of bars) {
      const p = b.fromP + (b.toP - b.fromP) * e;
      const th = (p / 100) * plotH;
      b.path.setAttribute("d", th > 0.5 ? topRoundedRect(b.bx, py1 - th, barW, th, 4) : "");
    }
  }
  return { svg, update };
}

// [5] 스텝 인디케이터: 스텝 k = 적용된 열 k → 열 k의 왼쪽 경계 x.
let stepIndicatorEl = null;
let highlightedCol = -1;
function stepIndicatorX(step) {
  return GRID_PAD_LEFT + LABEL_WIDTH + step * COL_PITCH - 2;
}
function setStepIndicator(x) {
  if (stepIndicatorEl) stepIndicatorEl.style.transform = `translateX(${x}px)`;
}
function highlightColumn(col) {
  if (col === highlightedCol) return;
  if (highlightedCol >= 0) {
    for (const c of circuitGrid.querySelectorAll(`.grid-cell[data-col="${highlightedCol}"]`)) c.classList.remove("step-col-active");
  }
  if (col >= 0) {
    for (const c of circuitGrid.querySelectorAll(`.grid-cell[data-col="${col}"]`)) c.classList.add("step-col-active");
  }
  highlightedCol = col;
}

// 한 스텝 전환을 rAF로 트윈한다([6]). 확률 막대 + 스텝 인디케이터 + (모드에 따라) 블로흐/ Q-sphere.
function runStepTransition(tr) {
  const duration = stepDuration();
  const W = probList.clientWidth, H = probList.clientHeight;
  const tween = (W > 40 && H > 40) ? buildProbTween(tr.fromProbs, tr.toProbs, tr.qubitCount, W, H) : null;
  if (tween) { probList.innerHTML = ""; probList.appendChild(tween.svg); }

  // 구/노드: Bloch 모드는 화살표 트윈, Q-sphere 모드는 짧은 크로스페이드([3], 위치·색 보간 없음)
  if (sphereMode === "bloch") {
    if (duration <= 0) scene.setVectorInstant(tr.toBloch);
    else scene.animateVectorTo(tr.fromBloch, tr.toBloch, duration);
  } else {
    scene.crossfadeQSphere(tr.toProbs, tr.qubitCount, duration <= 0 ? 0 : Math.min(200, duration));
  }

  const fromX = stepIndicatorX(tr.fromStep);
  const toX = stepIndicatorX(tr.toStep);
  highlightColumn(Math.min(tr.fromStep, tr.toStep)); // 적용 중인 열 강조

  return new Promise((resolve) => {
    const finish = () => { if (tween) tween.update(1); setStepIndicator(toX); resolve(); };
    if (duration <= 0) { finish(); return; }
    const start = performance.now();
    function frame(now) {
      const raw = Math.min(1, (now - start) / duration);
      const e = easeInOutCubic(raw);
      if (tween) tween.update(e);
      setStepIndicator(fromX + (toX - fromX) * e);
      if (raw < 1) requestAnimationFrame(frame);
      else finish();
    }
    requestAnimationFrame(frame);
  });
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
  // 지연 측정으로 표현할 수 없는 회로: 숫자 대신 이유만 보여준다(조용히 틀린 결과 금지).
  if (snapshot.deferredError) {
    const err = document.createElement("div");
    err.className = "state-error";
    err.textContent = snapshot.deferredError;
    stateFormula.appendChild(err);
    return;
  }
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

  // [5] 정직성: 측정이 있는 회로는 화면의 중간 상태가 "붕괴 전" 상태임을 반드시 밝힌다.
  if (hasMeasurement(snapshot.qubitCount, snapshot.grid)) {
    const note = document.createElement("div");
    note.className = "deferred-note";
    const atMeasure = measurementColumns(snapshot.qubitCount, snapshot.grid).has(snapshot.stepIndex - 1);
    note.innerHTML =
      `<b>⚠ Deferred measurement</b>${atMeasure ? ' <span class="deferred-now">measured here — the state shown is NOT collapsed</span>' : ""}`;
    note.title = DEFERRED_NOTE;
    note.addEventListener("mouseenter", () => showTooltip(note, DEFERRED_NOTE));
    note.addEventListener("mouseleave", hideTooltip);
    const full = document.createElement("div");
    full.className = "deferred-note-text";
    full.textContent = DEFERRED_NOTE;
    stateFormula.append(note, full);
  }
}

// ---------- 메인 렌더 ----------

function render(snapshot) {
  // 표시 분포가 바뀌면(회로 편집/스텝/큐비트수) 이전 샘플링 결과는 무효화한다.
  if (sampleResult && sampleResult.signature !== probSignature(snapshot)) sampleResult = null;

  scene.setVectorInstant(snapshot.bloch);
  if (sphereMode === "qsphere") scene.setQSphereData(snapshot.probabilities, snapshot.qubitCount);
  applySphereModeUI(snapshot);

  qubitCountLabel.textContent = String(snapshot.qubitCount);
  clbitCountLabel.textContent = String(snapshot.clbitCount);
  clbitMinusBtn.disabled = !snapshot.canRemoveClbit;
  clbitPlusBtn.disabled = !snapshot.canAddClbit;
  probEndian.textContent = endianLabelText(snapshot.qubitCount);
  updatePaletteAvailability(snapshot.qubitCount);

  buildCircuitGrid(snapshot);
  buildQubitTabs(snapshot);
  renderProbabilities(snapshot);
  renderDensityMatrix(snapshot);
  renderStateFormula(snapshot);
  // 선택/정보 대상 게이트가 회로 변경으로 사라졌으면 해제한다(정보 패널은 팔레트로 돌아간다)
  if (selectedGate && !cellAtHome(snapshot, selectedGate)) selectedGate = null;
  if (infoTarget && !cellAtHome(snapshot, infoTarget)) { infoTarget = null; expandedInfo = null; }
  renderGateInfo(snapshot);
  markSelection();

  const busy = snapshot.isAnimating || snapshot.isPlaying;
  clearBtn.disabled = busy;
  runBtn.disabled = busy || sampling; // 재생/애니메이션 중엔 샘플링 비활성
  undoBtn.disabled = busy || !snapshot.canUndo;
  redoBtn.disabled = busy || !snapshot.canRedo;
  qubitMinusBtn.disabled = busy || !snapshot.canRemoveQubit;
  qubitPlusBtn.disabled = busy || !snapshot.canAddQubit;

  // [2] 시뮬레이션할 수 없는 회로는 재생·스텝을 아예 막고 사유를 알려준다.
  // 검증이 통과하면 deferredError가 사라지므로 다음 렌더에서 즉시 다시 활성화된다.
  const blocked = snapshot.deferredError;
  setPlaybackDisabled(resetBtn, busy || snapshot.stepIndex === 0, blocked);
  setPlaybackDisabled(stepBackBtn, busy || snapshot.stepIndex === 0, blocked);
  setPlaybackDisabled(stepFwdBtn, busy || snapshot.stepIndex >= snapshot.totalSteps, blocked);
  setPlaybackDisabled(
    playBtn,
    snapshot.totalSteps === 0 || (snapshot.isAnimating && !snapshot.isPlaying),
    blocked
  );
  playBtn.textContent = snapshot.isPlaying ? "⏸" : "▶";
  playBtn.title = snapshot.isPlaying ? "Pause" : "Play";

  playbackStatus.textContent = `${snapshot.stepIndex} / ${snapshot.totalSteps} steps`;

  // [4] 고전 와이어까지 들어가도록 회로 패널 최소 높이를 내용에 맞춘다.
  // (패널 높이가 워크스페이스 비율 고정이라 행이 늘면 마지막 와이어가 화면 밖으로 밀렸다)
  const rows = snapshot.qubitCount + (snapshot.clbitCount > 0 ? 1 : 0);
  const needed = rows * ROW_PITCH + CIRCUIT_CHROME;
  const cap = Math.round((workspace.clientHeight || 0) * 0.72);
  circuitPanel.style.minHeight = `${cap > 0 ? Math.min(needed, cap) : needed}px`;
}

// 재생 버튼 비활성 처리. 사유가 있을 때는 `disabled` 대신 aria-disabled를 쓴다 —
// 브라우저가 disabled 요소의 마우스 이벤트를 막아 사유 툴팁이 아예 뜨지 않기 때문이다.
function setPlaybackDisabled(btn, plainDisabled, reason) {
  if (reason) {
    btn.disabled = false;
    btn.classList.add("is-disabled");
    btn.setAttribute("aria-disabled", "true");
    btn.dataset.blockReason = reason;
  } else {
    btn.classList.remove("is-disabled");
    btn.removeAttribute("aria-disabled");
    delete btn.dataset.blockReason;
    btn.disabled = plainDisabled;
  }
}

// [4] 위상 색상환을 Q-sphere 노드와 **같은 함수**로 칠한다(범례가 노드 색과 어긋나지 않게).
document.getElementById("phase-wheel")
  ?.style.setProperty("--phase-wheel-gradient", phaseWheelGradient(48));

// [5] Q-sphere 노드 hover → 툴팁. showTooltip은 anchor의 getBoundingClientRect만 쓰므로
// 3D 좌표를 감싼 가짜 anchor를 넘겨 기존 툴팁 스타일(다중행 포함)을 그대로 재사용한다.
function nodeTooltipText(node) {
  const amp = formatComplex({ re: node.re, im: node.im });
  const rad = ((node.phaseRad % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return [
    `|${node.label}⟩`,
    `amplitude  ${amp}`,
    `probability  ${node.probability.toFixed(1)}%`,
    `phase  ${node.phaseText} = ${rad.toFixed(3)}`,
  ].join("\n");
}

scene.setNodeHoverHandler((node, pt) => {
  if (!node) { hideTooltip(); return; }
  // 포인터 위치를 감싼 가짜 anchor (showTooltip은 getBoundingClientRect만 호출한다)
  showTooltip({
    getBoundingClientRect: () => ({
      left: pt.x, right: pt.x, top: pt.y, bottom: pt.y, width: 0, height: 0, x: pt.x, y: pt.y,
    }),
  }, nodeTooltipText(node));
});

buildPalette();

// 공유 URL(#c=...)이 있으면 저장된 회로보다 우선 적용하고, 이후 편집이
// 오래된 해시로 되돌아가지 않도록 주소창에서 해시를 제거한다.
const sharedCircuit = parseShareHash(location.hash);
if (sharedCircuit) {
  history.replaceState(null, "", location.pathname + location.search);
}

const circuit = createCircuitController({
  onChange: render,
  onAnimateStep: (transition) => runStepTransition(transition),
  onStepPause: () => delay(stepPause()),
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
clbitMinusBtn.addEventListener("click", () => {
  closePlacePopover();
  circuit.setClbitCount(circuit.getSnapshot().clbitCount - 1);
});
clbitPlusBtn.addEventListener("click", () => {
  closePlacePopover();
  circuit.setClbitCount(circuit.getSnapshot().clbitCount + 1);
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
// aria-disabled로 막아둔 버튼은 클릭이 실제로 들어오므로 핸들러에서 걸러야 한다.
// 대신 hover/focus 시 사유를 툴팁으로 보여준다.
for (const btn of [resetBtn, stepBackBtn, stepFwdBtn, playBtn]) {
  btn.addEventListener("mouseenter", () => {
    if (btn.dataset.blockReason) showTooltip(btn, btn.dataset.blockReason);
  });
  btn.addEventListener("mouseleave", hideTooltip);
}
const playbackBlocked = (btn) => Boolean(btn.dataset.blockReason);

resetBtn.addEventListener("click", () => {
  if (playbackBlocked(resetBtn)) return;
  scene.clearTrail();
  circuit.reset();
});
stepBackBtn.addEventListener("click", () => {
  if (!playbackBlocked(stepBackBtn)) circuit.stepBackward();
});
stepFwdBtn.addEventListener("click", () => {
  if (!playbackBlocked(stepFwdBtn)) circuit.stepForward();
});

playBtn.addEventListener("click", () => {
  if (playbackBlocked(playBtn)) return;
  if (circuit.getSnapshot().isPlaying) {
    circuit.pause();
  } else {
    scene.clearTrail();
    // 예상치 못한 예외가 나도 unhandled rejection으로 새지 않게 한다(컨트롤러가 복구는 이미 보장).
    circuit.play()?.catch((err) => console.error("Playback failed:", err));
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
  copyText(buildShareUrl(snap.qubitCount, snap.grid, snap.clbitCount), "Share link");
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
  copyText(toQASM(snap.qubitCount, snap.grid, snap.clbitCount), "OpenQASM 2.0");
  exportMenu.classList.add("hidden");
});

document.getElementById("export-qiskit").addEventListener("click", () => {
  const snap = circuit.getSnapshot();
  copyText(toQiskit(snap.qubitCount, snap.grid, snap.clbitCount), "Qiskit code");
  exportMenu.classList.add("hidden");
});

// ---------- 회로 프리셋 드롭다운 ----------
const presetsBtn = document.getElementById("presets-btn");
const presetsMenu = document.getElementById("presets-menu");

function closePresetsMenu() {
  presetsMenu.classList.add("hidden");
  presetsBtn.setAttribute("aria-expanded", "false");
}

// Quirk 스타일 목록: 카테고리(Basics/Algorithms/Protocols) 헤더 아래 이름만 나열, hover 시 설명 툴팁.
// 클릭 시 문자열을 디코드해 회로를 통째 교체(loadCircuit이 Undo 스택에 기록 → 되돌리기 가능).
for (const category of PRESET_CATEGORIES) {
  const header = document.createElement("div");
  header.className = "preset-cat";
  header.textContent = category;
  presetsMenu.appendChild(header);
  for (const preset of PRESETS.filter((p) => p.category === category)) {
    const item = document.createElement("button");
    item.className = "preset-item";
    item.textContent = preset.name;
    item.addEventListener("mouseenter", () => showTooltip(item, preset.description));
    item.addEventListener("mouseleave", hideTooltip);
    item.addEventListener("click", () => {
      hideTooltip();
      const dec = decodeCircuit(preset.circuit);
      closePresetsMenu();
      if (!dec) { showToast("Preset failed to load"); return; }
      scene.clearTrail();
      closePlacePopover();
      circuit.loadCircuit(dec.qubitCount, dec.grid, dec.clbitCount);
      showToast(`Loaded "${preset.name}" — Undo (Ctrl+Z) to revert`);
    });
    presetsMenu.appendChild(item);
  }
}

presetsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const willOpen = presetsMenu.classList.contains("hidden");
  presetsMenu.classList.toggle("hidden", !willOpen);
  presetsBtn.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) {
    const rect = presetsBtn.getBoundingClientRect();
    const menuRect = presetsMenu.getBoundingClientRect();
    presetsMenu.style.left = `${Math.min(rect.left, window.innerWidth - menuRect.width - 8)}px`;
    presetsMenu.style.top = `${rect.bottom + 6}px`;
  }
});

document.addEventListener("click", (e) => {
  if (!presetsMenu.classList.contains("hidden") && !presetsMenu.contains(e.target) && e.target !== presetsBtn) {
    closePresetsMenu();
  }
});
