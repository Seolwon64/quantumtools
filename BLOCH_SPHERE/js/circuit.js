// 회로(게이트 배치) 상태 관리: 추가/되돌리기/초기화, 스텝 재생, localStorage 지속성.
import { blochVector, computeStates, probabilities } from "./quantum.js";

export const MAX_GATES = 8;
const STORAGE_KEY = "bloch-sphere-circuit-v1";
const VALID_GATES = new Set(["H", "X", "Y", "Z", "S", "T"]);

function loadStoredGates() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((g) => VALID_GATES.has(g)).slice(0, MAX_GATES);
  } catch {
    return [];
  }
}

function saveGates(gates) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gates));
  } catch {
    // localStorage 사용 불가 - 무시
  }
}

// onChange(snapshot): 상태가 바뀔 때마다 호출, 항상 즉시 반영해야 하는 최신 상태를 담음.
// onAnimateStep(fromBloch, toBloch): 스텝 이동/재생 시 애니메이션을 실행하고 완료되면 resolve하는 Promise 반환.
export function createCircuitController({ onChange, onAnimateStep }) {
  let gates = loadStoredGates();
  let states = computeStates(gates);
  let stepIndex = gates.length; // 저장된 회로는 완성된 최종 상태로 즉시 표시
  let isPlaying = false;
  let isAnimating = false;

  function getSnapshot() {
    return {
      gates: gates.slice(),
      stepIndex,
      totalSteps: gates.length,
      isPlaying,
      isAnimating,
      isFull: gates.length >= MAX_GATES,
      currentBloch: blochVector(states[stepIndex]),
      probabilities: probabilities(states[stepIndex]),
    };
  }

  function notify() {
    onChange(getSnapshot());
  }

  function recompute() {
    states = computeStates(gates);
    saveGates(gates);
  }

  function addGate(name) {
    if (isAnimating || isPlaying || gates.length >= MAX_GATES) return;
    gates.push(name);
    recompute();
    stepIndex = gates.length;
    notify();
  }

  function undo() {
    if (isAnimating || isPlaying || gates.length === 0) return;
    gates.pop();
    recompute();
    stepIndex = gates.length;
    notify();
  }

  function clear() {
    if (isAnimating || isPlaying || gates.length === 0) return;
    gates = [];
    recompute();
    stepIndex = 0;
    notify();
  }

  function reset() {
    if (isAnimating || isPlaying) return;
    stepIndex = 0;
    notify();
  }

  async function stepForward() {
    if (isAnimating || isPlaying || stepIndex >= gates.length) return;
    isAnimating = true;
    notify();
    const from = blochVector(states[stepIndex]);
    const to = blochVector(states[stepIndex + 1]);
    await onAnimateStep(from, to);
    stepIndex += 1;
    isAnimating = false;
    notify();
  }

  async function stepBackward() {
    if (isAnimating || isPlaying || stepIndex <= 0) return;
    isAnimating = true;
    notify();
    const from = blochVector(states[stepIndex]);
    const to = blochVector(states[stepIndex - 1]);
    await onAnimateStep(from, to);
    stepIndex -= 1;
    isAnimating = false;
    notify();
  }

  async function play() {
    if (isAnimating || isPlaying || gates.length === 0) return;
    if (stepIndex >= gates.length) stepIndex = 0; // 끝에 도달했으면 처음부터 다시 재생
    isPlaying = true;
    notify();
    while (stepIndex < gates.length) {
      if (!isPlaying) break; // pause() 호출됨 - 다음 스텝은 시작하지 않음
      isAnimating = true;
      notify();
      const from = blochVector(states[stepIndex]);
      const to = blochVector(states[stepIndex + 1]);
      await onAnimateStep(from, to);
      stepIndex += 1;
      isAnimating = false;
      notify();
    }
    isPlaying = false;
    notify();
  }

  function pause() {
    // 진행 중인 스텝 애니메이션은 끝까지 재생되고, 다음 스텝 시작 전에 멈춘다.
    isPlaying = false;
  }

  notify();

  return {
    MAX_GATES,
    getSnapshot,
    addGate,
    undo,
    clear,
    reset,
    stepForward,
    stepBackward,
    play,
    pause,
  };
}
