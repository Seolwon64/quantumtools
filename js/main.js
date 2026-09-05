// 앱 진입점. DOM 배선과 이벤트 핸들러 — 컨트롤러 콜백을 받아 화면 전체를 갱신한다.
import { createBlochScene } from "./scene.js";
import { icon, hydrateIcons } from "./icons.js";
import { initMenu } from "./menu.js";
import { initCodePanel } from "./codepanel.js";
import { createCircuitController } from "./circuit.js";
import { GATE_INFO } from "./quantum.js";
import { probDisplay, endianLabelText } from "./probmodel.js";
import { reducedDensityInfo } from "./density.js";
import { initResizableLayout } from "./layout.js";
import { parseShareHash, buildShareUrl, toQASM, toQiskit, decodeCircuit } from "./export.js";
import { PRESETS, PRESET_CATEGORIES } from "./presets.js";
import { accentAlpha } from "./tokens.js";
import { hasMeasurement, measurementColumns, DEFERRED_NOTE } from "./classical.js";
import { initPopover } from "./popover.js";
import { initPlayback } from "./playback.js";
import { initProbView } from "./probview.js";
import { initGateMenu } from "./gatemenu.js";
import { initGrid } from "./grid.js";

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
// **UI 아이콘이 아니라 게이트 표기다** — ⊕(CNOT)·×(SWAP)와 같은 층이라
// Lucide 세트(16px/1.5)가 아니라 게이트 칩 크기를 따른다. 이름은 칩의 aria-label이 준다.
const MEASURE_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
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
const probEndian = document.getElementById("prob-endian");
const dmQubitTabs = document.getElementById("dm-qubit-tabs");
const dmMatrix = document.getElementById("dm-matrix");
const dmMetrics = document.getElementById("dm-metrics");

// 비트 순서(엔디언) 라벨: little-endian(q0이 오른쪽 끝) 표기를 명시한다.
// 궤적으로 계산되는 회로에서 상태 표시 아래에 붙는 설명. Inspect 켜짐 여부와 무관하다 —
// 중간 측정이 있으면 언제나 궤적으로 계산하기 때문이다.
const INSPECT_NOTE =
  "This circuit is simulated with real measurement collapse, so the state shown is " +
  "one of several possible outcomes. Press Resample for a different one. " +
  "The Probabilities panel aggregates many independent runs.";
const ENDIAN_TOOLTIP = "Little-endian: q0 is the rightmost bit (Qiskit convention)";
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

// render() 는 컨트롤러가 만들어질 때 곧바로 한 번 불린다. 아래쪽에서 const 로 선언하면
// 그 시점에 TDZ 에러가 난다(?. 로도 못 막는다) — DOM 참조는 여기서 미리 잡아 둔다.
const inspectBtn = document.getElementById("inspect-btn");
const resampleBtn = document.getElementById("resample-btn");
const trajBadge = document.getElementById("traj-badge");
const probViewToggle = document.getElementById("prob-view-toggle");
const playbackControls = document.querySelector(".playback-controls");

// 확률 패널이 무엇의 분포를 보여주는가. 측정이 있을 때만 고를 수 있고 기본은 Classical.
// 엔디언 라벨(|c1 c0⟩ / |q1 q0⟩)이 항상 이 값을 드러내므로 패널 의미가 모호해지지 않는다.
const PROB_VIEW_KEY = "bloch-prob-view-v1";
let probView = (() => {
  try { const v = localStorage.getItem(PROB_VIEW_KEY); if (v === "qubits" || v === "classical") return v; }
  catch { /* localStorage 사용 불가 */ }
  return "classical";
})();

// 코드 패널은 아래쪽에서 초기화된다. 그런데 render() 는 컨트롤러가 만들어질 때
// 곧바로 한 번 불리므로, const 로 두면 그 시점에 TDZ 에러가 난다(?. 로도 못 막는다).
let codePanel = null;

// ---------- 햄버거 메뉴 드로어 ----------
// 열기/닫기·포커스 트랩·방향키는 js/menu.js 가 전부 갖고 있다.
const menu = initMenu({
  menuBtn,
  overlay: document.getElementById("menu-overlay"),
  drawer: document.getElementById("menu-drawer"),
  body: document.getElementById("menu-drawer-body"),
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

// "Hide 0%" 체크박스: 영확률 상태 숨김 토글
probHideZeros.addEventListener("change", () => {
  hideZeroProb = probHideZeros.checked;
  renderProbabilities(circuit.getSnapshot());
});


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
    // 글리프 칩은 읽을 텍스트가 없다 — 아이콘만 있는 요소는 이름을 명시해야 한다.
    btn.setAttribute("aria-label", info.desc ?? info.label ?? gateName);
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
      cell.style.background = accentAlpha((mag(z) / maxMag) * 0.5);
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
    `<div class="dm-caption">${caption}</div>` +
    // 궤적 하나는 **순수 상태**라 Purity 가 늘 1.000 으로 나온다. 실제 앙상블은 혼합
    // 상태인데도 그렇다 — 라벨이 없으면 "측정했는데 순수하다"는 잘못된 결론으로 이어진다.
    (snapshot.usesTrajectory
      ? `<div class="dm-caption dm-traj-note">One trajectory — the ensemble is mixed</div>`
      : "");
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
    // 중간 측정은 이제 궤적으로 계산되므로 여기 오는 사유는 **재생 중 예외**뿐이다.
    // Inspect 를 켜라는 옛 안내는 더는 맞지 않는다.
    const hint = document.createElement("div");
    hint.className = "state-error-hint";
    hint.textContent = "Step back or edit the circuit to continue.";
    err.appendChild(hint);
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

  // 궤적으로 계산 중이면 화면의 상태는 **여러 결과 중 하나**다. 실행마다 달라진다는 걸
  // 밝혀야 사용자가 "왜 아까와 다르지?"에서 멈추지 않는다. 옛 `Deferred measurement`
  // 경고는 없앴다 — 이제 지연 계산으로 틀린 값을 보여주지 않으므로 경고할 일이 아니다.
  if (snapshot.usesTrajectory) {
    const note = document.createElement("div");
    note.className = "deferred-note inspect-note";
    note.innerHTML = `<b>${icon("triangle-alert")} One trajectory</b> <span class="deferred-now">measurement collapse is simulated</span>`;
    const full = document.createElement("div");
    full.className = "deferred-note-text";
    full.textContent = INSPECT_NOTE;
    note.title = INSPECT_NOTE;
    note.addEventListener("mouseenter", () => showTooltip(note, INSPECT_NOTE));
    note.addEventListener("mouseleave", hideTooltip);
    stateFormula.append(note, full);
    return;
  }

  // 측정은 있지만 그 뒤에 아무 조작도 없는 회로: 지연 측정이 **정확**하다.
  // 다만 화면의 상태는 붕괴 전 상태이므로 그 사실만 짧게 밝힌다.
  if (hasMeasurement(snapshot.qubitCount, snapshot.grid)) {
    const note = document.createElement("div");
    note.className = "deferred-note";
    const atMeasure = measurementColumns(snapshot.qubitCount, snapshot.grid).has(snapshot.stepIndex - 1);
    note.innerHTML =
      `<b>${icon("triangle-alert")} Pre-measurement state</b>${atMeasure ? ' <span class="deferred-now">measured here — the state shown is NOT collapsed</span>' : ""}`;
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
  invalidateStaleSample(snapshot);

  scene.setVectorInstant(snapshot.bloch);
  if (sphereMode === "qsphere") scene.setQSphereData(snapshot.probabilities, snapshot.qubitCount);
  applySphereModeUI(snapshot);

  qubitCountLabel.textContent = String(snapshot.qubitCount);
  clbitCountLabel.textContent = String(snapshot.clbitCount);
  clbitMinusBtn.disabled = !snapshot.canRemoveClbit;
  clbitPlusBtn.disabled = !snapshot.canAddClbit;
  const view = probDisplay(snapshot, { probView, aggregate: getAggregate() });
  probEndian.textContent = view.endian;
  // 토글은 **선택지가 있을 때만** 보인다. 측정이 없으면 고전 비트 분포라는 개념 자체가 없다.
  probViewToggle.classList.toggle("hidden", !snapshot.hasMeasurement);
  for (const b of probViewToggle.querySelectorAll(".segmented-btn")) {
    b.classList.toggle("active", b.dataset.view === view.kind);
  }
  scheduleAggregate(snapshot);
  updatePaletteAvailability(snapshot.qubitCount);

  buildCircuitGrid(snapshot);
  buildQubitTabs(snapshot);
  renderProbabilities(snapshot);
  renderDensityMatrix(snapshot);
  renderStateFormula(snapshot);
  // 선택/정보 대상 게이트가 회로 변경으로 사라졌으면 해제한다(정보 패널은 팔레트로 돌아간다)
  invalidateSelection(snapshot);
  renderGateInfo(snapshot);
  markSelection();
  // [2] Inspect 는 "계산을 가능하게 하는 스위치"가 아니라 **단계별로 들여다보는 모드**다.
  // 측정이 없으면 모든 중간 상태가 결정론적이라 감출 이유가 없다 → 토글 자체를 숨기고
  // 스텝 컨트롤은 늘 보인다. 측정이 있을 때만 Inspect 가 스텝 컨트롤을 여닫는다.
  inspectBtn.classList.toggle("hidden", !snapshot.hasMeasurement);
  inspectBtn.classList.toggle("is-on", snapshot.inspectMode);
  inspectBtn.setAttribute("aria-pressed", String(snapshot.inspectMode));
  playbackControls?.classList.toggle("hidden", snapshot.hasMeasurement && !snapshot.inspectMode);
  // 상태 표시 영역이 **하나의 궤적**임을 밝히는 배지. Inspect 와 무관하다 —
  // 궤적으로 계산하는 순간 화면의 상태벡터는 여러 결과 중 하나이기 때문이다.
  trajBadge.classList.toggle("hidden", !snapshot.usesTrajectory);

  // 코드 패널이 열려 있으면 코드를 갱신한다(편집 중이면 덮어쓰지 않고 배너를 띄운다).
  codePanel?.onCircuitChanged();

  const busy = snapshot.isAnimating || snapshot.isPlaying;
  clearBtn.disabled = busy;
  runBtn.disabled = busy || isSampling(); // 재생/애니메이션 중엔 샘플링 비활성
  // 궤적 회로는 이미 집계 결과를 보고 있다 — Run 은 같은 일을 두 번 하는 셈이다.
  // 대신 **새 난수 배치로 다시 집계**해 집계 자체에도 통계 오차가 있음을 보여준다.
  if (!isSampling()) {
    runBtn.textContent = snapshot.usesTrajectory ? "Resample statistics" : "Run";
    runBtn.title = snapshot.usesTrajectory
      ? "Re-run the aggregation with a fresh batch of random numbers"
      : "Sample the theoretical distribution";
  }
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
  // ▶/⏸ 문자를 쓰지 않는다 — 플랫폼마다 글리프가 달라 크기·정렬이 흔들린다.
  playBtn.innerHTML = icon(snapshot.isPlaying ? "pause" : "play");
  playBtn.setAttribute("aria-label", snapshot.isPlaying ? "Pause" : "Play");
  playBtn.title = snapshot.isPlaying ? "Pause" : "Play";

  playbackStatus.textContent = `${snapshot.stepIndex} / ${snapshot.totalSteps} steps`;

  // [4] 고전 와이어까지 들어가도록 회로 패널 최소 높이를 내용에 맞춘다.
  // (패널 높이가 워크스페이스 비율 고정이라 행이 늘면 마지막 와이어가 화면 밖으로 밀렸다)
  // buildCircuitGrid가 위에서 이미 돌았으므로 그리드의 실제 높이를 그대로 쓴다
  // (행 높이·gap을 JS에서 다시 계산하지 않는다 — 그게 어긋남의 원인이었다).
  const needed = circuitGrid.scrollHeight + CIRCUIT_CHROME;
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

buildPalette();

// 공유 URL(#c=...)이 있으면 저장된 회로보다 우선 적용하고, 이후 편집이
// 오래된 해시로 되돌아가지 않도록 주소창에서 해시를 제거한다.
const sharedCircuit = parseShareHash(location.hash);
if (sharedCircuit) {
  history.replaceState(null, "", location.pathname + location.search);
}

// 게이트 메뉴도 컨트롤러보다 **먼저** 배선한다 — render 가 invalidateSelection ·
// renderGateInfo · markSelection 을 부르고, 그 render 가 컨트롤러 생성 도중에 이미 돈다.
const { openMenuForCell, markSelection, renderGateInfo, clearSelection, invalidateSelection } = initGateMenu({
  getCircuit: () => circuit,
  scene, showToast, showTooltip, hideTooltip, standardGateName,
  // 팝오버는 컨트롤러 **뒤**에 배선되므로 화살표로 감싼다 — 호출 시점에 이름이 풀린다.
  popover: {
    openControlPopover: (...a) => openControlPopover(...a),
    openConditionPopover: (...a) => openConditionPopover(...a),
    openMeasureBitPopover: (...a) => openMeasureBitPopover(...a),
    openRemoveControlPopover: (...a) => openRemoveControlPopover(...a),
    openParamEditor: (...a) => openParamEditor(...a),
  },
  els: { gatePalette, gateInfoEl, gateInfoClose, paletteTitle, gateMenu, circuitGrid },
});

// 확률 패널도 컨트롤러보다 **먼저** 배선한다 — render 가 scheduleAggregate 와
// renderProbabilities 를 부르고, 그 render 가 컨트롤러 생성 도중에 이미 한 번 돈다.
// 재생 모듈이 buildProbTween 과 getAggregate 를 받으므로 initPlayback 보다도 앞이다.
const {
  renderProbabilities, scheduleAggregate, buildProbTween,
  getAggregate, isSampling, invalidateStaleSample, clearSample,
} = initProbView({
  getSnapshot: () => circuit.getSnapshot(),
  getProbView: () => probView,
  getHideZeroProb: () => hideZeroProb,
  render,
  els: { probList, probFooter, runBtn, resetShotsBtn, shotsInput },
});

// 재생 모듈은 컨트롤러보다 **먼저** 배선한다 — createCircuitController 가 반환 직전에
// notify() 를 부르므로 render → buildCircuitGrid → stepIndicatorX 가 그 안에서 이미 돈다.
const { runStepTransition, delay, stepPause, stepIndicatorX, attachIndicator } = initPlayback({
  getSnapshot: () => circuit.getSnapshot(),
  getSphereMode: () => sphereMode,
  scene,
  // probView 는 main, aggregate 는 probview 소유 — 둘 다 호출 시점에 읽는다.
  probDisplay: (s) => probDisplay(s, { probView, aggregate: getAggregate() }),
  buildProbTween,
  els: { circuitGrid, probList },
});

// 그리드도 컨트롤러보다 **먼저** 배선한다 — render 가 buildCircuitGrid 를 부르고,
// 그 render 가 컨트롤러 생성 도중에 이미 한 번 돈다. 다만 initPlayback 보다는 **뒤**다 —
// 그리드를 다시 지을 때마다 attachIndicator 로 새 인디케이터를 등록해야 하기 때문이다.
const { buildCircuitGrid } = initGrid({
  getCircuit: () => circuit,
  scene,
  gateCategory: GATE_CATEGORY,
  measureSvg: MEASURE_SVG,
  showTransientTip, attachGateHover,
  attachIndicator, stepIndicatorX,
  openMenuForCell, clearSelection,
  // 팝오버는 컨트롤러 **뒤**에 배선되므로 화살표로 감싼다 — 호출 시점에 이름이 풀린다.
  popover: {
    openPlacePopover: (...a) => openPlacePopover(...a),
    openControlPopover: (...a) => openControlPopover(...a),
    openConditionPopover: (...a) => openConditionPopover(...a),
  },
  els: { circuitGrid },
});

const circuit = createCircuitController({
  onChange: render,
  onAnimateStep: (transition) => runStepTransition(transition),
  onStepPause: () => delay(stepPause()),
  initial: sharedCircuit ?? undefined,
});

// 팝오버는 circuit 이 만들어진 뒤에 배선한다 — 주입받은 circuit 을 클로저로 잡기 때문이다.
// showToast 는 아래(약 100줄 뒤)에 있지만 function 선언이라 호이스팅되어 여기서 참조된다.
// const showToast = ... 로 바꾸면 로드 시 TDZ 에러가 난다.
const {
  closePlacePopover,
  openPlacePopover,
  openControlPopover,
  openConditionPopover,
  openMeasureBitPopover,
  openRemoveControlPopover,
  openParamEditor,
} = initPopover({ circuit, scene, showToast, standardGateName, els: { placePopover } });

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


// ---------- Inspect 모드 ----------
// 기본 경로(지연 측정)와 궤적 경로는 **서로 다른 것을 보여주며 둘 다 옳다.**
// 어느 쪽을 보고 있는지 항상 알 수 있어야 해서 토글에 활성 표시를 준다.
let inspectOn = false;

inspectBtn.addEventListener("click", () => {
  inspectOn = !inspectOn;
  scene.clearTrail();
  circuit.setInspectMode(inspectOn);
});
// Resample 은 **표시용 궤적 하나만** 다시 뽑는다. 확률 집계(1024회)는 그대로 둔다 —
// 집계는 시드에 둔감해 다시 돌려도 값이 거의 같고 비용만 든다.
resampleBtn.addEventListener("click", () => {
  scene.clearTrail();
  circuit.resample();
});

probViewToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".segmented-btn");
  if (!btn || btn.dataset.view === probView) return;
  probView = btn.dataset.view;
  try { localStorage.setItem(PROB_VIEW_KEY, probView); } catch { /* 저장 불가 — 세션 한정으로 동작 */ }
  clearSample(); // 축이 바뀌면 이전 샘플의 인덱스는 다른 것을 가리킨다
  render(circuit.getSnapshot());
});

// ---------- 코드 패널 (QASM / Qiskit) ----------
// QASM 에 닿는 경로는 **메뉴 → Code editor 하나뿐**이다. 예전의 <> 버튼(복사 전용)은
// 없앴다 — 경로가 둘이면 어느 쪽이 편집 가능한지 알 수 없다.
codePanel = initCodePanel({
  circuit,
  scene,
  showToast,
  onOpen: () => menu.close({ restoreFocus: false }),
  els: {
    panel: document.getElementById("code-panel"),
    resizer: document.getElementById("code-resizer"),
    wsLeft: document.getElementById("ws-left"),
    workspace: document.getElementById("workspace"),
    tabQasm: document.getElementById("tab-qasm"),
    tabQiskit: document.getElementById("tab-qiskit"),
    apply: document.getElementById("code-apply"),
    copy: document.getElementById("code-copy"),
    close: document.getElementById("code-close"),
    text: document.getElementById("code-text"),
    gutter: document.getElementById("code-gutter"),
    errorLine: document.getElementById("code-errorline"),
    pre: document.getElementById("code-pre"),
    readonlyBox: document.getElementById("code-readonly"),
    editor: document.getElementById("code-editor"),
    banner: document.getElementById("code-banner"),
    conflict: document.getElementById("code-conflict"),
    reload: document.getElementById("code-reload"),
    keep: document.getElementById("code-keep"),
    badge: document.getElementById("code-modified"),
    status: document.getElementById("code-status"),
  },
});
menu.setAction("code", () => codePanel.open());

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

// index.html의 <span data-icon="..."> 자리표시자를 Lucide SVG로 채운다.
// 정적 마크업과 동적 렌더가 **같은 정의(js/icons.js)** 를 쓰게 하는 유일한 연결점이다.
hydrateIcons();
