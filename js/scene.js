// Three.js 기반 Bloch sphere 3D 렌더링, Slerp 상태 벡터 애니메이션, 시점 리셋.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const SPHERE_RADIUS = 1;
const WIREFRAME_COLOR = 0xb0b8c1;
const AXIS_COLOR = 0x98a2ad;
const LABEL_COLOR = "#4e5968";
const VECTOR_COLOR = 0x3182f6;
const TRAIL_COLOR = 0x3182f6; // 확률 막대그래프와 동일한 토스 블루
const TRAIL_RADIUS = 0.012;

// 초기/리셋 시점: 오른쪽 X축, 왼쪽 Y축, 위쪽 Z축이 보이는 구도.
const INITIAL_CAMERA_POS = new THREE.Vector3(2.6, 1.9, 2.6);

// bloch 좌표(x,y,z) -> three.js 좌표. three.js는 Y가 위쪽이므로
// bloch Z(위)를 three Y에, bloch Y를 three Z에 대응시킨다.
function blochToThree(v, out = new THREE.Vector3()) {
  return out.set(v.x, v.z, v.y);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// WebGL은 대부분의 브라우저/GPU에서 Line의 linewidth를 무시하고 항상 1px로 그리므로,
// 두께가 실제로 보이는 축을 그리려면 얇은 원기둥 메쉬를 써야 한다.
function makeAxisMesh(direction, length = 2.4, radius = 0.008) {
  const geo = new THREE.CylinderGeometry(radius, radius, length, 8);
  const mat = new THREE.MeshBasicMaterial({
    color: AXIS_COLOR,
    transparent: true,
    opacity: 0.85,
  });
  const mesh = new THREE.Mesh(geo, mat);
  if (direction === "x") mesh.rotation.z = Math.PI / 2;
  if (direction === "z") mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function makeLabelSprite(text) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.font = "600 56px -apple-system, sans-serif";
  ctx.fillStyle = LABEL_COLOR;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, size / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.32, 0.32, 1);
  return sprite;
}

export function createBlochScene(container) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 2.2;
  controls.maxDistance = 6;

  function resetView() {
    camera.position.copy(INITIAL_CAMERA_POS);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  // 와이어프레임 구
  const sphereGeo = new THREE.SphereGeometry(SPHERE_RADIUS, 28, 18);
  const sphereMat = new THREE.MeshBasicMaterial({
    color: WIREFRAME_COLOR,
    wireframe: true,
    transparent: true,
    opacity: 0.35,
  });
  scene.add(new THREE.Mesh(sphereGeo, sphereMat));

  // X, Y, Z 축 (bloch X -> three X, bloch Y -> three Z, bloch Z -> three Y)
  scene.add(makeAxisMesh("x"), makeAxisMesh("y"), makeAxisMesh("z"));

  // 은은한 회색 라벨: 극(|0>, |1>)과 X, Y 축 양의 방향
  const zeroLabel = makeLabelSprite("|0⟩");
  zeroLabel.position.set(0, 1.42, 0);
  const oneLabel = makeLabelSprite("|1⟩");
  oneLabel.position.set(0, -1.42, 0);
  const xLabel = makeLabelSprite("x");
  xLabel.position.set(1.38, 0, 0);
  const yLabel = makeLabelSprite("y");
  yLabel.position.set(0, 0, 1.38);
  scene.add(zeroLabel, oneLabel, xLabel, yLabel);

  // 상태 벡터 화살표 (토스 블루)
  const initialDir = blochToThree({ x: 0, y: 0, z: 1 }).normalize();
  const arrow = new THREE.ArrowHelper(
    initialDir,
    new THREE.Vector3(0, 0, 0),
    SPHERE_RADIUS,
    VECTOR_COLOR,
    0.22,
    0.12
  );
  scene.add(arrow);

  resetView();

  // 재생 중 벡터가 지나간 궤적 (토스 블루, 50% 불투명도). 재생을 다시 누르면 초기화된다.
  // Line은 대부분의 WebGL 환경에서 linewidth를 무시하므로(축과 동일한 문제),
  // 실제로 두껍게 보이도록 매 프레임 Tube 메쉬로 재생성한다.
  let trailPoints = [];
  let trailMesh = null;
  const trailMaterial = new THREE.MeshBasicMaterial({
    color: TRAIL_COLOR,
    transparent: true,
    opacity: 0.5,
  });

  function rebuildTrailMesh() {
    if (trailMesh) {
      scene.remove(trailMesh);
      trailMesh.geometry.dispose();
      trailMesh = null;
    }
    if (trailPoints.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(trailPoints);
    const tubularSegments = Math.max(8, trailPoints.length * 2);
    const geo = new THREE.TubeGeometry(curve, tubularSegments, TRAIL_RADIUS, 6, false);
    trailMesh = new THREE.Mesh(geo, trailMaterial);
    scene.add(trailMesh);
  }

  function clearTrail() {
    trailPoints = [];
    rebuildTrailMesh();
  }

  // tip: 화살표 끝점 위치 (방향 x 길이, three.js 좌표).
  // 벡터가 정지한 스텝(no-op, 다른 큐비트 게이트)에서는 같은 좌표가 매 프레임 쌓이는데,
  // CatmullRomCurve3가 중복 점에서 0-접선 -> TubeGeometry NaN을 만들어 궤적이 깜빡이므로
  // 마지막 점과 사실상 같은 위치면 추가하지 않는다.
  const TRAIL_MIN_DIST_SQ = 1e-6;

  function pushTrailPoint(tip) {
    const point = tip.clone().multiplyScalar(SPHERE_RADIUS);
    if (point.lengthSq() < TRAIL_MIN_DIST_SQ) return; // 화살표 숨김(길이~0) 구간
    const last = trailPoints[trailPoints.length - 1];
    if (last && last.distanceToSquared(point) < TRAIL_MIN_DIST_SQ) return;
    trailPoints.push(point);
    rebuildTrailMesh();
  }

  // 벡터 길이(순수도) 반영: 얽힘으로 축약상태가 혼합되면 화살표가 구 안쪽으로 줄어든다.
  function applyArrow(dir, length) {
    const len = Math.max(length, 0.001);
    arrow.setDirection(dir);
    arrow.setLength(len * SPHERE_RADIUS, Math.min(0.22, len * 0.5), Math.min(0.12, len * 0.3));
  }

  function safeDirection(v, fallback) {
    return v.lengthSq() < 1e-12 ? fallback.clone() : v.clone().normalize();
  }

  const UP = new THREE.Vector3(0, 1, 0);

  function setVectorInstant(bloch) {
    const v = blochToThree(bloch);
    applyArrow(safeDirection(v, UP), v.length());
  }

  function animateVectorTo(fromBloch, toBloch, duration = 500) {
    return new Promise((resolve) => {
      const fromRaw = blochToThree(fromBloch);
      const toRaw = blochToThree(toBloch);
      const fromLen = fromRaw.length();
      const toLen = toRaw.length();
      const fromV = safeDirection(fromRaw, UP);
      const toV = safeDirection(toRaw, fromV);
      const qTotal = new THREE.Quaternion().setFromUnitVectors(fromV, toV);
      const identity = new THREE.Quaternion();
      const start = performance.now();

      function frame(now) {
        const t = Math.min(1, (now - start) / duration);
        const eased = easeOutCubic(t);
        const qStep = identity.clone().slerp(qTotal, eased);
        const dir = fromV.clone().applyQuaternion(qStep).normalize();
        const len = fromLen + (toLen - fromLen) * eased;
        applyArrow(dir, len);
        pushTrailPoint(dir.clone().multiplyScalar(Math.max(len, 0.001)));
        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
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

  return { setVectorInstant, animateVectorTo, resetView, clearTrail };
}
