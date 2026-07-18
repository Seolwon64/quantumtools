import { createBlochScene } from "./scene.js";
import { createCircuitController } from "./circuit.js";

const sphereContainer = document.getElementById("sphere-container");
const scene = createBlochScene(sphereContainer);

const gateButtons = Array.from(document.querySelectorAll(".gate-btn"));
const undoBtn = document.getElementById("undo-btn");
const clearBtn = document.getElementById("clear-btn");
const circuitTrack = document.getElementById("circuit-track");
const circuitEmpty = document.getElementById("circuit-empty");
const resetBtn = document.getElementById("reset-btn");
const stepBackBtn = document.getElementById("step-back-btn");
const playBtn = document.getElementById("play-btn");
const stepFwdBtn = document.getElementById("step-fwd-btn");
const playbackStatus = document.getElementById("playback-status");
const resetViewBtn = document.getElementById("reset-view-btn");
const probBar0 = document.getElementById("prob-bar-0");
const probBar1 = document.getElementById("prob-bar-1");
const probValue0 = document.getElementById("prob-value-0");
const probValue1 = document.getElementById("prob-value-1");

function renderCircuitTrack(snapshot) {
  circuitTrack.innerHTML = "";
  if (snapshot.gates.length === 0) {
    circuitTrack.appendChild(circuitEmpty);
    return;
  }
  snapshot.gates.forEach((gate, i) => {
    const chip = document.createElement("span");
    chip.className = "circuit-chip";
    chip.textContent = gate;
    if (i < snapshot.stepIndex - 1) chip.classList.add("is-done");
    if (i === snapshot.stepIndex - 1) chip.classList.add("is-active");
    circuitTrack.appendChild(chip);
    if (i < snapshot.gates.length - 1) {
      const arrow = document.createElement("span");
      arrow.className = "circuit-arrow";
      arrow.textContent = "›";
      circuitTrack.appendChild(arrow);
    }
  });
}

function render(snapshot) {
  scene.setVectorInstant(snapshot.currentBloch);

  const { p0, p1 } = snapshot.probabilities;
  probBar0.style.width = `${p0}%`;
  probBar1.style.width = `${p1}%`;
  probValue0.textContent = `${Math.round(p0)}%`;
  probValue1.textContent = `${Math.round(p1)}%`;

  const busy = snapshot.isAnimating || snapshot.isPlaying;

  for (const btn of gateButtons) {
    btn.disabled = busy || snapshot.isFull;
  }

  renderCircuitTrack(snapshot);

  undoBtn.disabled = busy || snapshot.gates.length === 0;
  clearBtn.disabled = busy || snapshot.gates.length === 0;

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

gateButtons.forEach((btn) => {
  btn.addEventListener("click", () => circuit.addGate(btn.dataset.gate));
});

undoBtn.addEventListener("click", () => circuit.undo());
clearBtn.addEventListener("click", () => circuit.clear());
resetBtn.addEventListener("click", () => circuit.reset());
stepBackBtn.addEventListener("click", () => circuit.stepBackward());
stepFwdBtn.addEventListener("click", () => circuit.stepForward());

playBtn.addEventListener("click", () => {
  if (circuit.getSnapshot().isPlaying) {
    circuit.pause();
  } else {
    circuit.play();
  }
});

resetViewBtn.addEventListener("click", () => scene.resetView());
