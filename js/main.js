import { createBlochScene } from "./scene.js";
import { createCircuitController, MAX_COLUMNS } from "./circuit.js";
import { GATE_INFO } from "./quantum.js";
import { initResizableLayout } from "./layout.js";

initResizableLayout();

const PALETTE_ORDER = [
  "H", "CNOT", "CZ", "SWAP", "CTRL", "I",
  "T", "S", "Z", "Tdg", "Sdg", "P",
  "RZ", "MEASURE", "RESET", "BARRIER", "X", "Y",
  "SX", "SXdg", "RX", "RY", "RXX", "RZZ",
  "U", "RCCX", "RC3X",
];

const sphereContainer = document.getElementById("sphere-container");
const scene = createBlochScene(sphereContainer);

const gatePalette = document.getElementById("gate-palette");
const circuitGrid = document.getElementById("circuit-grid");
const qubitTabs = document.getElementById("qubit-tabs");
const probList = document.getElementById("prob-list");
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

const anglePopover = document.getElementById("angle-popover");
const anglePopoverTitle = document.getElementById("angle-popover-title");
const angleSlider = document.getElementById("angle-slider");
const angleValue = document.getElementById("angle-value");
const angleCancelBtn = document.getElementById("angle-cancel");
const angleConfirmBtn = document.getElementById("angle-confirm");

let pendingPlacement = null;

function closeAnglePopover() {
  anglePopover.classList.add("hidden");
  pendingPlacement = null;
}

function openAnglePopover(column, qubit, gateName, clientX, clientY) {
  pendingPlacement = { column, qubit, gateName };
  anglePopoverTitle.textContent = GATE_INFO[gateName].label;
  const defaultDeg = Math.round(((GATE_INFO[gateName].defaultTheta ?? Math.PI / 2) * 180) / Math.PI);
  angleSlider.value = String(defaultDeg);
  angleValue.textContent = String(defaultDeg);
  anglePopover.classList.remove("hidden");
  const popoverWidth = 200;
  const left = Math.min(clientX, window.innerWidth - popoverWidth - 16);
  const top = Math.min(clientY, window.innerHeight - 180);
  anglePopover.style.left = `${Math.max(8, left)}px`;
  anglePopover.style.top = `${Math.max(8, top)}px`;
}

angleSlider.addEventListener("input", () => {
  angleValue.textContent = angleSlider.value;
});

angleCancelBtn.addEventListener("click", closeAnglePopover);

angleConfirmBtn.addEventListener("click", () => {
  if (!pendingPlacement) return;
  const thetaRad = (Number(angleSlider.value) * Math.PI) / 180;
  scene.clearTrail();
  circuit.placeGate(pendingPlacement.column, pendingPlacement.qubit, pendingPlacement.gateName, thetaRad);
  closeAnglePopover();
});

function buildPalette() {
  gatePalette.innerHTML = "";
  for (const gateName of PALETTE_ORDER) {
    const info = GATE_INFO[gateName];
    if (!info) continue;
    const btn = document.createElement("button");
    btn.className = `gate-chip group-${info.group}`;
    btn.textContent = info.label;
    btn.dataset.gate = gateName;
    btn.dataset.ready = String(info.ready);
    btn.draggable = info.ready;
    btn.title = info.ready ? info.label : `${info.label} (다음 단계에서 지원 예정)`;
    if (info.ready) {
      btn.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", gateName);
        e.dataTransfer.effectAllowed = "copy";
      });
    }
    gatePalette.appendChild(btn);
  }
}

function buildCircuitGrid(snapshot) {
  circuitGrid.innerHTML = "";
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

      const placement = snapshot.grid[col]?.[q];
      if (placement) {
        const info = GATE_INFO[placement.gate];
        const chip = document.createElement("div");
        chip.className = `placed-gate group-${info.group}`;
        chip.textContent = info.label;
        chip.title = "클릭해서 삭제";
        cell.appendChild(chip);
      }
      wire.appendChild(cell);
    }
    row.appendChild(wire);
    circuitGrid.appendChild(row);
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
  if (!info || !info.ready) return;
  const column = Number(cell.dataset.col);
  const qubit = Number(cell.dataset.qubit);
  if (info.kind === "param") {
    openAnglePopover(column, qubit, gateName, e.clientX, e.clientY);
  } else {
    scene.clearTrail();
    circuit.placeGate(column, qubit, gateName);
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

function render(snapshot) {
  scene.setVectorInstant(snapshot.bloch);

  qubitCountLabel.textContent = String(snapshot.qubitCount);
  qubitMinusBtn.disabled = !snapshot.canRemoveQubit;
  qubitPlusBtn.disabled = !snapshot.canAddQubit;

  buildCircuitGrid(snapshot);
  buildQubitTabs(snapshot);
  renderProbabilities(snapshot);

  const busy = snapshot.isAnimating || snapshot.isPlaying;
  clearBtn.disabled = busy;
  qubitMinusBtn.disabled = busy || !snapshot.canRemoveQubit;
  qubitPlusBtn.disabled = busy || !snapshot.canAddQubit;

  resetBtn.disabled = busy || snapshot.stepIndex === 0;
  stepBackBtn.disabled = busy || snapshot.stepIndex === 0;
  stepFwdBtn.disabled = busy || snapshot.stepIndex >= snapshot.totalSteps;

  playBtn.disabled = snapshot.totalSteps === 0 || (snapshot.isAnimating && !snapshot.isPlaying);
  playBtn.textContent = snapshot.isPlaying ? "⏸" : "▶";
  playBtn.title = snapshot.isPlaying ? "일시정지" : "재생";

  playbackStatus.textContent = `${snapshot.stepIndex} / ${snapshot.totalSteps} 단계`;
}

const circuit = createCircuitController({
  onChange: render,
  onAnimateStep: (from, to) => scene.animateVectorTo(from, to, 500),
});

buildPalette();

qubitMinusBtn.addEventListener("click", () => {
  scene.clearTrail();
  circuit.setQubitCount(circuit.getSnapshot().qubitCount - 1);
});
qubitPlusBtn.addEventListener("click", () => {
  scene.clearTrail();
  circuit.setQubitCount(circuit.getSnapshot().qubitCount + 1);
});
clearBtn.addEventListener("click", () => {
  scene.clearTrail();
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
