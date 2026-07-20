import { createBlochScene } from "./scene.js";
import { createCircuitController, MAX_COLUMNS, involvedQubits } from "./circuit.js";
import { GATE_INFO } from "./quantum.js";
import { initResizableLayout } from "./layout.js";
import { parseShareHash, buildShareUrl, toQASM, toQiskit } from "./export.js";
import { createCityscapeScene } from "./cityscape.js";

initResizableLayout();

// 팔레트 표시 계층 전용 카테고리 정의 (시뮬레이션/게이트 로직과 무관).
// 색상은 style.css의 --cat-* 변수 한 곳에서 정의하고, 여기서는 카테고리 id만 참조한다.
// 색상만으로는 색각 이상 사용자가 구분하기 어려우므로 카테고리마다 이름 라벨을 붙인다.
const PALETTE_CATEGORIES = [
  { id: "pauli", label: "Pauli & Clifford", gates: ["H", "X", "Y", "Z", "I", "S", "Sdg", "SX", "SXdg"] },
  { id: "phase", label: "Phase / T", gates: ["T", "Tdg", "P"] },
  { id: "rotation", label: "Rotations", gates: ["RX", "RY", "RZ", "U"] },
  { id: "multi", label: "Multi-qubit", gates: ["CNOT", "CCX", "SWAP", "CTRL", "RCCX", "RC3X"] },
  { id: "interaction", label: "Interaction", gates: ["RXX", "RZZ"] },
  { id: "structural", label: "Non-unitary", gates: ["MEASURE", "RESET", "BARRIER", "IF"] },
];

// 미구현 게이트는 피처 플래그로 렌더링에서만 제외한다 (정의/엔진 코드는 그대로 유지).
const GATE_ENABLED = { IF: false };

// gate → 카테고리 id (색상 클래스 cat-* 용). 위 정의에서 파생한다.
const GATE_CATEGORY = {};
for (const cat of PALETTE_CATEGORIES) for (const g of cat.gates) GATE_CATEGORY[g] = cat.id;
GATE_CATEGORY.CZ = "multi"; // 팔레트엔 없지만 공유 회로로 캔버스에 올 수 있어 색을 부여

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
  CNOT: stackGlyph(1, "⊕"),
  CCX: stackGlyph(2, "⊕"),
  SWAP: '<span class="glyph-stack"><span class="glyph-sym">×</span><span class="glyph-line"></span><span class="glyph-sym">×</span></span>',
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
const resetBtn = document.getElementById("reset-btn");
const stepBackBtn = document.getElementById("step-back-btn");
const playBtn = document.getElementById("play-btn");
const stepFwdBtn = document.getElementById("step-fwd-btn");
const playbackStatus = document.getElementById("playback-status");
const resetViewBtn = document.getElementById("reset-view-btn");
const placePopover = document.getElementById("place-popover");
const modeToggle = document.getElementById("mode-toggle");
const modeToggleLabel = document.getElementById("mode-toggle-label");
const entangleWarning = document.getElementById("entangle-warning");
const sphereModeTitle = document.getElementById("sphere-mode-title");
const qsphereLegend = document.getElementById("qsphere-legend");
const menuBtn = document.getElementById("menu-btn");
const menuPanel = document.getElementById("menu-panel");
const probPanelTitle = document.getElementById("prob-panel-title");
const probEndian = document.getElementById("prob-endian");
const probModeToggle = document.getElementById("prob-mode-toggle");

// 비트 순서(엔디언) 라벨: little-endian(q0이 오른쪽 끝) 표기를 명시한다.
const ENDIAN_TOOLTIP = "Little-endian: q0 is the rightmost bit (Qiskit convention)";
function endianLabelText(n) {
  const parts = [];
  for (let i = n - 1; i >= 0; i--) parts.push(`q${i}`);
  return `|${parts.join(" ")}⟩`;
}
probEndian.addEventListener("mouseenter", () => showTooltip(probEndian, ENDIAN_TOOLTIP));
probEndian.addEventListener("mouseleave", hideTooltip);
const probChart = document.getElementById("prob-list");
const cityscapeContainer = document.getElementById("cityscape-container");
const dmPartToggle = document.getElementById("dm-part-toggle");

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

// ---------- Bloch / Q-sphere 모드 ----------
// Bloch sphere는 얽힌 상태를 정확히 표현할 수 없다. 얽힘이 감지되면 경고 아이콘을
// 보여주고, 사용자는 언제든 토글을 눌러 IBM 스타일 Q-sphere(전체 상태) 뷰로 전환할 수 있다.
let sphereMode = "bloch";

modeToggle.addEventListener("click", () => {
  sphereMode = sphereMode === "bloch" ? "qsphere" : "bloch";
  const snap = circuit.getSnapshot();
  scene.setMode(sphereMode);
  if (sphereMode === "qsphere") scene.setQSphereData(snap.probabilities, snap.qubitCount);
  applySphereModeUI(snap);
});

function applySphereModeUI(snapshot) {
  const isQSphere = sphereMode === "qsphere";
  modeToggle.setAttribute("aria-pressed", String(isQSphere));
  modeToggle.title = isQSphere ? "Switch to Bloch sphere view" : "Switch to Q-sphere view";
  modeToggleLabel.textContent = isQSphere ? "Q-sphere" : "Bloch";
  qubitTabs.classList.toggle("hidden", isQSphere);
  sphereModeTitle.classList.toggle("hidden", !isQSphere);
  qsphereLegend.classList.toggle("hidden", !isQSphere);

  const entangled = Math.hypot(snapshot.bloch.x, snapshot.bloch.y, snapshot.bloch.z) < 0.99;
  const showWarning = sphereMode === "bloch" && entangled;
  entangleWarning.classList.toggle("hidden", !showWarning);
}

entangleWarning.addEventListener("mouseenter", () => showTooltip(entangleWarning, "Detected entanglement"));
entangleWarning.addEventListener("mouseleave", hideTooltip);

// ---------- Probabilities / Density Matrix Cityscape ----------
let probMode = "chart";
let dmPart = "re"; // 밀도행렬 Re/Im 성분 선택
let cityscape = null; // 처음 전환할 때 생성 (숨겨진 컨테이너는 크기가 0이라 미리 만들면 카메라 비율이 깨짐)

probModeToggle.addEventListener("click", () => {
  probMode = probMode === "chart" ? "cityscape" : "chart";
  const isCityscape = probMode === "cityscape";
  probModeToggle.setAttribute("aria-pressed", String(isCityscape));
  probModeToggle.title = isCityscape ? "Switch to probability chart" : "Switch to Density Matrix Cityscape";
  probPanelTitle.textContent = isCityscape ? "Density Matrix" : "Probabilities";
  probChart.classList.toggle("hidden", isCityscape);
  cityscapeContainer.classList.toggle("hidden", !isCityscape);
  dmPartToggle.classList.toggle("hidden", !isCityscape);
  if (isCityscape) {
    if (!cityscape) cityscape = createCityscapeScene(cityscapeContainer);
    cityscape.setData(circuit.getSnapshot().densityMatrix, dmPart);
  }
});

dmPartToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".segmented-btn");
  if (!btn) return;
  dmPart = btn.dataset.part;
  for (const b of dmPartToggle.querySelectorAll(".segmented-btn")) {
    b.classList.toggle("active", b === btn);
  }
  if (cityscape) cityscape.setData(circuit.getSnapshot().densityMatrix, dmPart);
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
  const needControls = info.kind === "controlled" ? info.controls : 0;
  const needPartner = info.kind === "swap" || info.kind === "pair-param" ? 1 : 0;
  const sliderNames =
    info.kind === "param" || info.kind === "pair-param" ? ["θ"]
    : info.kind === "param3" ? ["θ", "φ", "λ"]
    : [];

  pendingPlacement = { column, qubit, gateName, selected: [] };
  placePopover.innerHTML = "";

  const title = document.createElement("div");
  title.className = "place-popover-title";
  title.textContent = `${info.label} → q[${qubit}]`;
  placePopover.appendChild(title);

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "pill-btn-primary";
  confirmBtn.textContent = "Apply";

  function updateConfirm() {
    confirmBtn.disabled = pendingPlacement.selected.length !== needControls + needPartner;
  }

  if (needControls + needPartner > 0) {
    const pickLabel = document.createElement("div");
    pickLabel.className = "place-popover-hint";
    pickLabel.textContent =
      needPartner > 0
        ? "Select partner qubit"
        : `Select ${needControls} control qubit${needControls > 1 ? "s" : ""}`;
    placePopover.appendChild(pickLabel);

    const pickRow = document.createElement("div");
    pickRow.className = "qpick-row";
    for (let q = 0; q < qubitCount; q++) {
      if (q === qubit) continue;
      const btn = document.createElement("button");
      btn.className = "qpick-btn";
      btn.textContent = `q[${q}]`;
      btn.addEventListener("click", () => {
        const idx = pendingPlacement.selected.indexOf(q);
        if (idx >= 0) {
          pendingPlacement.selected.splice(idx, 1);
          btn.classList.remove("selected");
        } else if (pendingPlacement.selected.length < needControls + needPartner) {
          pendingPlacement.selected.push(q);
          btn.classList.add("selected");
        }
        updateConfirm();
      });
      pickRow.appendChild(btn);
    }
    placePopover.appendChild(pickRow);
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
    if (needControls > 0) params.controls = pendingPlacement.selected.slice();
    if (needPartner > 0) params.partner = pendingPlacement.selected[0];
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

  // 칼럼별 역할 맵: qubit -> { type: "target"|"control"|"partner", cell, targetQ }
  const roleMaps = [];
  for (let col = 0; col < MAX_COLUMNS; col++) {
    const roles = new Map();
    for (let t = 0; t < snapshot.qubitCount; t++) {
      const cell = snapshot.grid[col]?.[t];
      if (!cell) continue;
      roles.set(t, { type: "target", cell, targetQ: t });
      for (const q of cell.controls ?? []) roles.set(q, { type: "control", cell, targetQ: t });
      if (typeof cell.partner === "number") roles.set(cell.partner, { type: "partner", cell, targetQ: t });
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
        if (role.type === "control") {
          const dot = document.createElement("div");
          dot.className = "ctrl-dot";
          dot.title = "Click to remove";
          cell.appendChild(dot);
        } else {
          const chip = document.createElement("div");
          chip.className = `placed-gate cat-${GATE_CATEGORY[role.cell.gate] ?? "structural"}`;
          if (role.type === "partner") chip.classList.add("placed-partner");
          if (role.cell.gate === "MEASURE") {
            chip.innerHTML = MEASURE_SVG;
          } else {
            chip.textContent =
              role.type === "target" ? (info.targetLabel ?? info.label)
              : info.kind === "swap" ? "×"
              : info.label;
          }
          chip.title = "Click to remove";
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
      const qubits = involvedQubits(cell, t);
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

  const needsPopover =
    info.kind === "param" || info.kind === "param3" ||
    info.kind === "controlled" || info.kind === "swap" || info.kind === "pair-param";
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
  circuit.removeGate(column, qubit);
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

function renderProbabilities(snapshot) {
  probList.innerHTML = "";
  for (const entry of snapshot.probabilities) {
    const col = document.createElement("div");
    col.className = "prob-bar-col";

    const value = document.createElement("span");
    value.className = "prob-bar-value";
    value.textContent = `${Math.round(entry.probability)}%`;

    const track = document.createElement("div");
    track.className = "prob-bar-track-v";
    const fill = document.createElement("div");
    fill.className = "prob-bar-fill-v";
    fill.style.height = `${entry.probability}%`;
    track.appendChild(fill);

    const label = document.createElement("span");
    label.className = "prob-bar-label";
    label.textContent = `|${entry.label}⟩`;

    col.append(value, track, label);
    probList.appendChild(col);
  }
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
  scene.setVectorInstant(snapshot.bloch);
  if (sphereMode === "qsphere") scene.setQSphereData(snapshot.probabilities, snapshot.qubitCount);
  applySphereModeUI(snapshot);
  if (probMode === "cityscape" && cityscape) cityscape.setData(snapshot.densityMatrix, dmPart);

  qubitCountLabel.textContent = String(snapshot.qubitCount);
  probEndian.textContent = endianLabelText(snapshot.qubitCount);
  updatePaletteAvailability(snapshot.qubitCount);

  buildCircuitGrid(snapshot);
  buildQubitTabs(snapshot);
  renderProbabilities(snapshot);
  renderStateFormula(snapshot);

  const busy = snapshot.isAnimating || snapshot.isPlaying;
  clearBtn.disabled = busy;
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
