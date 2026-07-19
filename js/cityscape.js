// Density Matrix Cityscape: ρ = |ψ⟩⟨ψ| 의 실수부 또는 허수부를 2ⁿ×2ⁿ 3D 막대그래프
// (바둑판 격자 위 빌딩 숲)로 렌더링. Re/Im 은 한 번에 하나만 크게 보여준다.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// index.html의 html,body font-family와 일치시켜 캔버스 텍스트가 DOM과 다른 폰트로
// 그려지지 않게 한다.
const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Segoe UI", Roboto, sans-serif';

const POS_COLOR = 0x3182f6; // 토스 블루 (양수)
const NEG_COLOR = 0xe5484d; // 레드 (음수)
const GRID_LINE_COLOR = 0xc7cdd4;
const MAX_BAR_HEIGHT = 1.3;
const GRID_SPAN = 2.0; // 격자가 차지하는 가로/세로 폭
const GRID_Y = -0.004; // 격자선을 막대 밑면(y=0)보다 살짝 아래로 내려 z-fighting 방지
const LABEL_MAX_DIM = 16; // 이 이하(n≤4)에서만 축에 기저 라벨 표시

function makeLabelSprite(text, worldW, worldH, color = "#4e5968", weight = 600) {
  const cw = 256;
  const ch = 128;
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  ctx.font = `${weight} 54px ${FONT_STACK}`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cw / 2, ch / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(worldW, worldH, 1);
  return sprite;
}

export function createCityscapeScene(container) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(3.0, 2.7, 3.0);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0.25, 0);
  controls.update();

  const barGeo = new THREE.BoxGeometry(1, 1, 1);

  // 성분 제목(Re(ρ)/Im(ρ)) 스프라이트 — setData에서 텍스트 갱신
  const title = makeLabelSprite("Re(ρ)", 0.9, 0.45, "#3182f6", 700);
  title.position.set(0, MAX_BAR_HEIGHT + 0.4, 0);
  scene.add(title);

  // 바둑판 격자선 (dim 바뀔 때만 재생성)
  let gridLines = null;
  let gridDim = -1;
  function rebuildGrid(dim) {
    if (dim === gridDim) return;
    gridDim = dim;
    if (gridLines) {
      scene.remove(gridLines);
      gridLines.geometry.dispose();
      gridLines.material.dispose();
    }
    const half = GRID_SPAN / 2;
    const pts = [];
    for (let i = 0; i <= dim; i++) {
      const t = -half + (GRID_SPAN * i) / dim;
      pts.push(new THREE.Vector3(t, GRID_Y, -half), new THREE.Vector3(t, GRID_Y, half));
      pts.push(new THREE.Vector3(-half, GRID_Y, t), new THREE.Vector3(half, GRID_Y, t));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: GRID_LINE_COLOR, transparent: true, opacity: 0.6 });
    gridLines = new THREE.LineSegments(geo, mat);
    scene.add(gridLines);
  }

  // 축 기저 라벨 (dim 바뀔 때만 재생성, n≤4에서만)
  let axisLabels = [];
  let labelDim = -1;
  function rebuildAxisLabels(dim, qubitCount) {
    if (dim === labelDim) return;
    labelDim = dim;
    for (const s of axisLabels) {
      scene.remove(s);
      s.material.map.dispose();
      s.material.dispose();
    }
    axisLabels = [];
    if (dim > LABEL_MAX_DIM) return;
    const half = GRID_SPAN / 2;
    const cell = GRID_SPAN / dim;
    const labelW = Math.min(0.5, cell * 2.4);
    for (let i = 0; i < dim; i++) {
      const ket = "|" + i.toString(2).padStart(qubitCount, "0") + "⟩";
      const along = -half + cell * (i + 0.5);
      // 열 라벨(앞쪽 모서리), 행 라벨(왼쪽 모서리)
      const colLabel = makeLabelSprite(ket, labelW, labelW * 0.5, "#8b95a1");
      colLabel.position.set(along, GRID_Y + 0.02, half + cell * 0.7);
      const rowLabel = makeLabelSprite(ket, labelW, labelW * 0.5, "#8b95a1");
      rowLabel.position.set(-half - cell * 0.7, GRID_Y + 0.02, along);
      scene.add(colLabel, rowLabel);
      axisLabels.push(colLabel, rowLabel);
    }
  }

  let bars = [];
  function clearBars() {
    for (const mesh of bars) {
      scene.remove(mesh);
      mesh.material.dispose();
    }
    bars = [];
  }

  // matrix: 복소 2ⁿ×2ⁿ 배열({re,im}), part: "re" | "im"
  function setData(matrix, part = "re") {
    const dim = matrix.length;
    const qubitCount = Math.round(Math.log2(dim));
    rebuildGrid(dim);
    rebuildAxisLabels(dim, qubitCount);
    clearBars();

    title.material.map.dispose();
    const newTitle = makeLabelSprite(part === "re" ? "Re(ρ)" : "Im(ρ)", 0.9, 0.45, "#3182f6", 700);
    title.material = newTitle.material;

    // Re/Im 높이 스케일 일관성을 위해 |ρ| 전체 최대 절댓값 기준으로 정규화
    let maxAbs = 1e-6;
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        maxAbs = Math.max(maxAbs, Math.abs(matrix[i][j].re), Math.abs(matrix[i][j].im));
      }
    }

    const half = GRID_SPAN / 2;
    const cell = GRID_SPAN / dim;
    const barSize = cell * 0.72;
    const SKIP = maxAbs * 0.01; // 바닥에 붙는 미세 막대 제거

    for (let row = 0; row < dim; row++) {
      for (let col = 0; col < dim; col++) {
        const value = part === "re" ? matrix[row][col].re : matrix[row][col].im;
        if (Math.abs(value) < SKIP) continue;
        const height = (Math.abs(value) / maxAbs) * MAX_BAR_HEIGHT;
        const mesh = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: value >= 0 ? POS_COLOR : NEG_COLOR }));
        mesh.scale.set(barSize, height, barSize);
        mesh.position.set(
          -half + cell * (col + 0.5),
          height / 2,
          -half + cell * (row + 0.5)
        );
        scene.add(mesh);
        bars.push(mesh);
      }
    }
  }

  function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  function renderLoop() {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(renderLoop);
  }
  renderLoop();

  return { setData };
}
