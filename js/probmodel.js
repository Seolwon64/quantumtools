// 확률 패널이 **무엇의** 분포를 그리는지 정하는 표시 정책. DOM 을 몰라 Node 에서 그대로 검증된다.
//
// main.js 에서 떼어내며 최상위 가변 상태를 읽던 자리(probView · aggregate · sampleResult)를
// 전부 인자로 바꿨다. 하나라도 남으면 이 파일이 Node 에서 import 되지 않아, 떼어낸 이유가
// 사라진다. quantum-spec §6 이 이 파일의 계약이다.
import { phaseInfo } from "./chart.js";
import { marginalClassical } from "./trajectory.js";

export function endianLabelText(n, prefix = "q") {
  const parts = [];
  for (let i = n - 1; i >= 0; i--) parts.push(`${prefix}${i}`);
  return `|${parts.join(" ")}⟩`;
}

export function barTooltipHTML(entry, sample, view) {
  const rows = [`<div class="tt-title">|${entry.label}⟩ <span class="tt-dim">· index ${entry.index}</span></div>`];
  const estimated = view.axis.includes("shots");
  rows.push(`<div>${estimated ? "Estimated" : "Theoretical"}: <b>${entry.probability.toFixed(2)}%</b></div>`);
  if (sample) {
    const c = sample.counts[entry.index] ?? 0;
    rows.push(`<div>Observed: <b>${c} / ${sample.shots}</b> (${((c / sample.shots) * 100).toFixed(2)}%)</div>`);
  }
  // 고전 비트열은 측정 **결과**다 — 진폭도 위상도 없다. 0 을 넣어 있는 척하지 않는다.
  if (entry.re !== null) {
    const ph = phaseInfo(entry.re, entry.im);
    const amp = `${entry.re.toFixed(3)} ${entry.im >= 0 ? "+" : "−"} ${Math.abs(entry.im).toFixed(3)}i`;
    rows.push(`<div>Amplitude: <b>${amp}</b></div>`);
    rows.push(`<div>Phase: <b>${ph.defined ? `${ph.deg.toFixed(1)}° (${ph.rad.toFixed(2)} rad)` : "—"}</b></div>`);
  }
  return rows.join("");
}

/**
 * 확률 패널이 **무엇의** 분포를 그리는지 한 곳에서 정한다.
 *
 * | 회로 | 모드 | 값 | 축 |
 * |---|---|---|---|
 * | 측정 없음 | (토글 숨김) | 이론 큐비트 확률 | `Probability (%)` |
 * | 측정 있음 | Classical | 궤적 집계 or 이론 주변화 | `% of N shots` / `Probability (%)` |
 * | 측정 있음 | Qubits | 궤적 확률벡터 **평균** or 이론 | 위와 같음 |
 *
 * 라벨(`|c1 c0⟩` / `|q1 q0⟩`)이 항상 이 표의 어느 줄인지 드러내므로 값의 의미가 모호해지지 않는다.
 */
export function probDisplay(snapshot, { probView, aggregate }) {
  const qubitsMode = !snapshot.hasMeasurement || probView === "qubits";
  const traj = snapshot.usesTrajectory && aggregate !== null;

  // 큐비트 기저: 궤적이 있으면 |ψ_i|² 평균(= 앙상블 밀도행렬 대각), 없으면 이론값 그대로.
  if (qubitsMode) {
    const entries = traj
      ? snapshot.probabilities.map((e, i) => ({ ...e, probability: aggregate.qubitProbs[i] * 100 }))
      : snapshot.probabilities;
    return {
      entries, bits: snapshot.qubitCount, kind: "qubits",
      endian: endianLabelText(snapshot.qubitCount, "q"),
      axis: traj ? `Probability (% of ${aggregate.shots} shots)` : "Probability (%)",
    };
  }

  // 고전 비트: 궤적이 있으면 clbits 를 세고, 중간 붕괴가 없으면 이론 확률을 주변화한다
  // (붕괴가 없을 때 주변화는 **정확**하고 비용이 0이다 — 궤적을 돌릴 이유가 없다).
  const probs = traj
    ? aggregate.classical
    : marginalClassical(snapshot.qubitCount, snapshot.clbitCount, snapshot.grid, snapshot.probabilities.map((e) => e.probability / 100));
  const entries = [];
  for (let i = 0; i < probs.length; i++) {
    let label = "";
    for (let k = snapshot.clbitCount - 1; k >= 0; k--) label += (i >> k) & 1;
    // re/im 은 없다 — 고전 비트열에는 진폭도 위상도 없다. 툴팁이 이 null 을 보고 행을 뺀다.
    entries.push({ index: i, label, re: null, im: null, probability: probs[i] * 100 });
  }
  return {
    entries, bits: snapshot.clbitCount, kind: "classical",
    endian: endianLabelText(snapshot.clbitCount, "c"),
    axis: traj ? `Probability (% of ${aggregate.shots} shots)` : "Probability (%)",
  };
}
