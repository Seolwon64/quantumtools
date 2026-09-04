// 확률 패널: SVG 막대 차트 렌더링과 측정 샘플링·궤적 집계. 집계·샘플 상태를 이 모듈이 소유한다.
//
// **컨트롤러보다 먼저** 초기화해야 한다 — render 가 scheduleAggregate 와 renderProbabilities 를
// 부르는데, 그 render 는 createCircuitController 가 반환 직전에 호출하는 notify() 안에서
// 이미 한 번 돈다. 그래서 circuit 을 값으로 받으면 TDZ 로 로드 즉시 죽는다(2단계에서 겪었다).
// probView·hideZeroProb 는 진입점이 소유하는 사용자 설정이라 역시 getter 로 받는다.
import {
  runTrajectory, makeRng, randomSeed, needsTrajectorySampling,
  aggregateTrajectories,
} from "./trajectory.js";
import { computeVisibleProbabilities, sampleCounts } from "./quantum.js";
import { pickLabelMode, niceTickStep } from "./chart.js";
import { probDisplay, barTooltipHTML } from "./probmodel.js";
import { token } from "./tokens.js";

// 주입되는 의존. initProbView 전에는 undefined 다.
let getSnapshot, getProbView, getHideZeroProb, render;
let probList, probFooter, runBtn, resetShotsBtn, shotsInput;
// 최상위에서 DOM 을 만들지 않는다(위험 2번) — 엘리먼트는 init 에서 만든다.
let chartTooltip;

/** 의존을 주입하고 공개 API 를 돌려준다. **컨트롤러를 만들기 전에** 부른다. */
export function initProbView({ getSnapshot: gs, getProbView: gv, getHideZeroProb: gh, render: r, els }) {
  getSnapshot = gs;
  getProbView = gv;
  getHideZeroProb = gh;
  render = r;
  probList = els.probList;
  probFooter = els.probFooter;
  runBtn = els.runBtn;
  resetShotsBtn = els.resetShotsBtn;
  shotsInput = els.shotsInput;

  // 리치 툴팁 (기저·이론확률·관측·진폭·위상)
  chartTooltip = document.createElement("div");
  chartTooltip.className = "chart-tooltip hidden";
  document.body.appendChild(chartTooltip);

  runBtn.addEventListener("click", runSampling);
  resetShotsBtn.addEventListener("click", resetSampling);
  shotsInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); runSampling(); }
  });

  return {
    renderProbabilities, scheduleAggregate, buildProbTween,
    getAggregate, isSampling, invalidateStaleSample, clearSample,
  };
}

/** 궤적 집계 결과. render 가 probDisplay 에 넘긴다. */
export function getAggregate() { return aggregate; }
/** 샘플링 중인지. render 가 Run 버튼을 잠그는 데 쓴다. */
export function isSampling() { return sampling; }
/** 표시 분포가 바뀌었으면 이전 샘플을 버린다. render 가 맨 앞에서 부른다. */
export function invalidateStaleSample(snapshot) {
  if (sampleResult && sampleResult.signature !== probSignature(snapshot)) sampleResult = null;
}
/** 축(큐비트↔고전)이 바뀔 때처럼 샘플을 통째로 버려야 할 때. */
export function clearSample() { sampleResult = null; }

// 궤적 집계 결과 캐시. 같은 (회로, shots, 배치 시드) 조합은 다시 돌리지 않는다.
let aggregate = null;       // { qubitProbs, classical, shots, signature }
let aggregateBatch = 0;     // Resample statistics 를 누를 때만 증가 → 새 난수 배치
let aggregateTimer = null;
let probShowAll = false; // 큐비트 많을 때 상위 N개 제한을 사용자가 펼쳤는지
const PROB_TOP_N = 32; // 6큐비트 이상에서 기본으로 표시하는 상위 상태 개수
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
/** 집계 결과가 유효한지 판정하는 서명. 회로·shots·배치가 같으면 재계산하지 않는다. */
function aggregateSignature(snapshot, shots) {
  return `${snapshot.qubitCount}|${snapshot.clbitCount}|${shots}|${aggregateBatch}|` +
    JSON.stringify(snapshot.grid);
}

/**
 * 중간 측정이 있는 회로의 분포를 궤적으로 집계한다.
 * 편집 중 매번 돌리면 버벅이므로 디바운스를 건다(최악 6큐비트 12열 1024샷 = 46ms).
 */
function scheduleAggregate(snapshot) {
  if (!snapshot.usesTrajectory) { aggregate = null; return; }
  const shots = clampShots(parseInt(shotsInput.value, 10));
  const signature = aggregateSignature(snapshot, shots);
  if (aggregate?.signature === signature) return; // 이미 같은 조건으로 계산해 뒀다

  clearTimeout(aggregateTimer);
  aggregateTimer = setTimeout(() => {
    const snap = getSnapshot();
    if (!snap.usesTrajectory) { aggregate = null; return; }
    const sig = aggregateSignature(snap, shots);
    const seeds = () => randomSeed();
    const { qubitProbs, classical } = aggregateTrajectories(
      snap.qubitCount, snap.clbitCount, snap.grid, shots, seeds
    );
    aggregate = { qubitProbs, classical, shots, signature: sig };
    renderProbabilities(getSnapshot());
  }, 150);
}

// 중간 측정이 있는 회로는 최종 상태벡터에서 뽑으면 **틀린다** — 붕괴가 이후 게이트에
// 영향을 주기 때문이다. 그럴 때만 shot 마다 독립 궤적으로 회로를 처음부터 돌린다.
// 표시용 궤적과 무관한 난수를 쓴다(1024개가 전부 같은 궤적이면 통계가 아니다).
async function sampleTrajectories(snapshot, shots) {
  const { qubitCount, clbitCount, grid } = snapshot;
  const counts = new Array(1 << qubitCount).fill(0);
  let done = 0;
  while (done < shots) {
    const chunk = Math.min(SAMPLE_CHUNK, shots - done);
    for (let i = 0; i < chunk; i++) {
      const rng = makeRng(randomSeed());
      const { state } = runTrajectory(qubitCount, clbitCount, grid, undefined, rng);
      // 최종 상태에서 기저를 하나 뽑는다(측정으로 이미 확정됐다면 그 하나가 확률 1이다).
      let r = rng();
      let idx = state.length - 1;
      for (let k = 0; k < state.length; k++) {
        r -= state[k].re * state[k].re + state[k].im * state[k].im;
        if (r <= 0) { idx = k; break; }
      }
      counts[idx]++;
    }
    done += chunk;
    if (done < shots) await new Promise((r) => setTimeout(r, 0)); // UI 프리즈 방지
  }
  return counts;
}

async function runSampling() {
  if (sampling) return;
  const snap = getSnapshot();
  const shots = clampShots(parseInt(shotsInput.value, 10));
  shotsInput.value = String(shots);
  // 궤적 회로: 화면의 막대가 이미 집계 결과다. 새 난수 배치로 다시 집계한다
  // (표시용 궤적은 건드리지 않는다 — 그건 Resample 버튼의 몫이다).
  if (snap.usesTrajectory) {
    aggregateBatch++;
    aggregate = null;
    scheduleAggregate(snap);
    return;
  }
  sampling = true;
  runBtn.disabled = true;
  runBtn.textContent = "Running…";
  try {
    const counts = needsTrajectorySampling(snap.qubitCount, snap.grid)
      ? await sampleTrajectories(snap, shots)
      : await sampleAsync(snap.probabilities, shots);
    // 샘플링 도중 회로가 바뀌지 않았을 때만 반영(경합 방지)
    if (probSignature(getSnapshot()) === probSignature(snap)) {
      sampleResult = { counts, shots, signature: probSignature(snap) };
    }
  } finally {
    sampling = false;
    runBtn.disabled = false;
    render(getSnapshot()); // 버튼 라벨은 render 가 회로에 맞춰 정한다
  }
}
function resetSampling() {
  sampleResult = null;
  renderProbabilities(getSnapshot());
}
// ---------- 확률 SVG 막대 차트 ----------
const SVGNS = "http://www.w3.org/2000/svg";
// [4] 데이터 영역: 축·격자는 중립 램프로 최대한 옅게, 막대(데이터)만 액센트를 갖는다.
// getter로 두어 CSS 램프가 바뀌면 함께 따라간다.
const CHART = {
  get grid() { return token("--gray-6"); },
  get axis() { return token("--gray-7"); },
  get tick() { return token("--gray-10"); },
  get label() { return token("--gray-11"); },
  get theorySolid() { return token("--accent-9"); },
  get theoryLight() { return token("--accent-6"); },
  get observed() { return token("--accent-9"); },
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

function renderProbabilities(snapshot) {
  probFooter.innerHTML = "";
  hideChartTooltip();

  const view = probDisplay(snapshot, { probView: getProbView(), aggregate });
  // 궤적 회로에서는 Run 자리가 Resample statistics 라 샘플 병기가 없다.
  // 고전 비트 차트에 큐비트 기저 샘플을 겹치면 인덱스가 서로 다른 것을 가리킨다.
  const sampled = sampleResult !== null && !snapshot.usesTrajectory && view.kind === "qubits";
  // 관측된 기저(count>0)는 어떤 필터로도 숨기지 않는다.
  const observed = new Set();
  if (sampled) {
    for (let i = 0; i < sampleResult.counts.length; i++) if (sampleResult.counts[i] > 0) observed.add(i);
  }

  const { visible, hiddenZeroCount, hiddenZeroProb, capActive } = computeVisibleProbabilities(
    view.entries,
    { hideZero: getHideZeroProb(), qubitCount: view.bits, topN: PROB_TOP_N, showAll: probShowAll, observed }
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
  // Inspect 모드에서는 막대(이 궤적)와 샘플(여러 궤적)이 정면으로 어긋난다 —
  // 예: 막대 100%, 샘플 50/50. 그게 측정의 본질이므로 가리지 않고 무엇이 무엇인지 밝힌다.
  if (snapshot.usesTrajectory && aggregate) {
    const note = document.createElement("span");
    note.className = "prob-inspect-note";
    note.textContent = view.kind === "classical"
      ? `Classical outcomes counted over ${aggregate.shots} independent runs.`
      : `Averaged state probabilities over ${aggregate.shots} independent runs.`;
    probFooter.appendChild(note);
  }
  if (capActive) {
    probFooter.appendChild(makeShowAllButton(`Show all ${view.entries.length} states`, true));
  } else if (probShowAll && view.bits >= 6 && visible.length > PROB_TOP_N) {
    probFooter.appendChild(makeShowAllButton(`Show top ${PROB_TOP_N}`, false));
  }

  // 숨김/미측정(크기 0)이면 SVG 생략 — 다시 보일 때 ResizeObserver가 그린다.
  const W = probList.clientWidth;
  const H = probList.clientHeight;
  probList.innerHTML = "";
  if (W < 40 || H < 40 || visible.length === 0) return;
  probList.appendChild(buildProbChart(visible, view, sampled, W, H));
}

function buildProbChart(visible, view, sampled, W, H) {
  const n = visible.length;
  const M = { top: 12, right: 10, left: 42 };
  const plotW = W - M.left - M.right;
  const bandW = plotW / n;
  const labelChars = view.bits + 2; // "|" + bits + "⟩"
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
  yTitle.textContent = view.axis;
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
    hit.addEventListener("mouseenter", () => showChartTooltip(hit, barTooltipHTML(entry, sampled ? sampleResult : null, view)));
    hit.addEventListener("mouseleave", hideChartTooltip);
    svg.appendChild(hit);
  });

  return svg;
}


// [2] 확률 막대 트윈용 차트: from/to에서 보이는 상태의 합집합을 한 번 그리고, 매 프레임
// 막대 높이(path d)만 갱신한다(재구성 없음 → 성능). 0%↔값 막대도 자연스럽게 생성/소멸.
function buildProbTween(fromProbs, toProbs, qubitCount, W, H) {
  const opts = { hideZero: getHideZeroProb(), qubitCount, topN: PROB_TOP_N, showAll: probShowAll, observed: new Set() };
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


// Show all / 접기 토글 버튼 생성
function makeShowAllButton(text, expand) {
  const btn = document.createElement("button");
  btn.className = "prob-showall-btn";
  btn.textContent = text;
  btn.addEventListener("click", () => {
    probShowAll = expand;
    renderProbabilities(getSnapshot());
  });
  return btn;
}
