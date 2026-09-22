// 확률 패널이 **무엇의** 분포를 그리는지 정하는 표시 정책과, 진폭·계수의 표시 형식.
// DOM 을 몰라 Node 에서 그대로 검증된다.
//
// main.js 에서 떼어내며 최상위 가변 상태를 읽던 자리(probView · aggregate · sampleResult)를
// 전부 인자로 바꿨다. 하나라도 남으면 이 파일이 Node 에서 import 되지 않아, 떼어낸 이유가
// 사라진다. quantum-spec §6 이 이 파일의 계약이다.
import { phaseInfo } from "./chart.js";
import { marginalClassical } from "./trajectory.js";

// ---------- 숫자 표시 형식 (밀도행렬 · 상태벡터 공용) ----------

/** 부호는 U+2212. ASCII 하이픈은 폭도 위치도 달라 숫자 옆에서 어긋난다. */
const MINUS = "−";

/**
 * 소수 2자리 고정. 두 가지를 동시에 한다:
 *  - 5e-4 미만은 **수치 오차**로 보고 0 으로 뭉갠다(gatematrix.js 의 EPS 와 같은 값·같은 뜻)
 *  - 반올림 **뒤** -0 을 0 으로 정규화한다. -0.003 은 오차 필터를 통과한 뒤 "-0.00" 이 되는데,
 *    3자리와 달리 2자리에서는 반올림 경계(5e-3)가 오차 임계값보다 커서 앞에서 못 거른다.
 * 자릿수를 고정하는 것이 핵심이다 — 뒤 0 을 지우면 0.5 와 0.71 의 소수점이 한 칸 어긋나
 * 어떤 정렬 방법으로도 열을 맞출 수 없다.
 */
export function fmt2(v) {
  const squashed = Math.abs(v) < 5e-4 ? 0 : v;
  const rounded = Number(squashed.toFixed(2));
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(2);
}

/**
 * 계수가 화면에 0.00 으로 찍히는 경계. 표시 자릿수(2)와 짝이다 — 자릿수를 바꾸면 같이 바꾼다.
 * fmt2 안의 5e-4(수치 오차 뭉개기)와는 **다른 개념**이라 하나로 합치지 않는다.
 */
export const AMP_DISPLAY_EPS = 0.005;

/** 화면에 0.00 으로만 찍힐 항인가 — 상태벡터 "Hide 0.00" 의 기준. */
export function amplitudeShowsAsZero(re, im) {
  return Math.abs(re) < AMP_DISPLAY_EPS && Math.abs(im) < AMP_DISPLAY_EPS;
}

const signOf = (v, magnitude) => (v < 0 && magnitude !== "0.00" ? MINUS : "");
const omitOne = (magnitude) => (magnitude === "1.00" ? "" : magnitude);

/**
 * 진폭을 표시 **조각**으로 쪼갠다. 문자열 하나로 합치지 않는 이유: 상태벡터 패널이
 * 조각마다 자기 열에 넣어 소수점을 세로로 맞추기 때문이다. 합친 문자열을 오른쪽
 * 정렬하면 i 접미사·괄호·부호 때문에 열이 어긋난다(오른쪽 정렬은 오른쪽 끝을 맞출 뿐이다).
 *
 * 반환은 전부 문자열이고 빈 문자열은 "그 칸은 비운다"는 뜻이다.
 *   { sign, re, imSign, im, hasI }
 */
export function amplitudeParts(re, im) {
  // 실수: 허수부가 표시 정밀도 아래라 아예 없는 것으로 쓴다.
  if (Math.abs(im) < AMP_DISPLAY_EPS) {
    const magnitude = fmt2(Math.abs(re));
    return { sign: signOf(re, magnitude), re: omitOne(magnitude), imSign: "", im: "", hasI: false };
  }
  // 순허수
  if (Math.abs(re) < AMP_DISPLAY_EPS) {
    const magnitude = fmt2(Math.abs(im));
    return { sign: signOf(im, magnitude), re: "", imSign: "", im: omitOne(magnitude), hasI: true };
  }
  // 복소: 두 부분이 다 있으므로 **크기 1 을 생략하지 않는다.** 실수부 0.995 는 1.00 으로
  // 반올림되는데 그걸 지우면 "+0.05i" 로 읽혀 실수부가 통째로 사라진다.
  return {
    sign: re < 0 ? MINUS : "",
    re: fmt2(Math.abs(re)),
    imSign: im < 0 ? MINUS : "+",
    im: fmt2(Math.abs(im)),
    hasI: true,
  };
}

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
