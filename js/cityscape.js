// Density Matrix Cityscape: ρ의 실수부/허수부를 2ⁿ×2ⁿ 3D 막대그래프 두 개로 렌더링.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// index.html의 html,body font-family와 일치시켜 캔버스 텍스트가 DOM과 다른 폰트로
// 그려지지 않게 한다.
const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Segoe UI", Roboto, sans-serif';

const POS_COLOR = 0x3182f6; // 토스 블루 (양수)
const NEG_COLOR = 0xe5484d; // 레드 (음수)
const BASE_COLOR = 0xd8dde3;
const MAX_BAR_HEIGHT = 1.4;
const GRID_SPAN = 1.6; // 한 쪽 그리드가 차지하는 가로/세로 폭
const GRID_GAP = 0.9; // 두 그리드(Re/Im) 사이 간격

function makeLabelSprite(text, color = "#4e5968") {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.font = `700 48px ${FONT_STACK}`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, size / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.4, 0.4, 1);
  return sprite;
}

export function createCityscapeScene(container) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(2.6, 2.4, 3.2);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0.1, 0);
  controls.update();

  const barGeo = new THREE.BoxGeometry(1, 1, 1);
  const reGroup = new THREE.Group();
  const imGroup = new THREE.Group();
  reGroup.position.x = -GRID_GAP / 2;
  imGroup.position.x = GRID_GAP / 2;
  scene.add(reGroup, imGroup);

  const reTitle = makeLabelSprite("Re(ρ)", "#3182f6");
  reTitle.position.set(-GRID_GAP / 2, MAX_BAR_HEIGHT + 0.35, 0);
  const imTitle = makeLabelSprite("Im(ρ)", "#3182f6");
  imTitle.position.set(GRID_GAP / 2, MAX_BAR_HEIGHT + 0.35, 0);
  scene.add(reTitle, imTitle);

  function makeBasePlate(group) {
    const geo = new THREE.PlaneGeometry(GRID_SPAN, GRID_SPAN);
    const mat = new THREE.MeshBasicMaterial({
      color: BASE_COLOR,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    });
    const plate = new THREE.Mesh(geo, mat);
    plate.rotation.x = -Math.PI / 2;
    group.add(plate);
  }
  makeBasePlate(reGroup);
  makeBasePlate(imGroup);

  let bars = []; // { mesh } for disposal

  function clearBars() {
    for (const bar of bars) {
      bar.mesh.parent.remove(bar.mesh);
      bar.mesh.material.dispose();
    }
    bars = [];
  }

  function addGrid(group, matrix, dim, maxAbs) {
    const cell = GRID_SPAN / dim;
    for (let row = 0; row < dim; row++) {
      for (let col = 0; col < dim; col++) {
        const value = matrix[row][col];
        const magnitude = Math.abs(value);
        if (magnitude < 1e-4) continue;
        const height = Math.max(0.004, (magnitude / maxAbs) * MAX_BAR_HEIGHT);
        const mat = new THREE.MeshBasicMaterial({ color: value >= 0 ? POS_COLOR : NEG_COLOR });
        const mesh = new THREE.Mesh(barGeo, mat);
        const barSize = cell * 0.78;
        mesh.scale.set(barSize, height, barSize);
        mesh.position.set(
          -GRID_SPAN / 2 + cell * (col + 0.5),
          height / 2,
          -GRID_SPAN / 2 + cell * (row + 0.5)
        );
        group.add(mesh);
        bars.push({ mesh });
      }
    }
  }

  // matrix: 복소 2ⁿ×2ⁿ 배열 ({re, im} 원소)
  function setData(matrix) {
    clearBars();
    const dim = matrix.length;
    let maxAbs = 1e-6;
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        maxAbs = Math.max(maxAbs, Math.abs(matrix[i][j].re), Math.abs(matrix[i][j].im));
      }
    }
    const reMatrix = matrix.map((row) => row.map((c) => c.re));
    const imMatrix = matrix.map((row) => row.map((c) => c.im));
    addGrid(reGroup, reMatrix, dim, maxAbs);
    addGrid(imGroup, imMatrix, dim, maxAbs);
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
