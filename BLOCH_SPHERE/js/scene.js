// Three.js 기반 Bloch sphere 3D 렌더링, Slerp 상태 벡터 애니메이션, 시점 리셋.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const SPHERE_RADIUS = 1;
const AXIS_COLOR = 0xc7cdd4;
const LABEL_COLOR = "#8b95a1";
const VECTOR_COLOR = 0x3182f6;

// 초기/리셋 시점: 왼쪽 X축, 오른쪽 Y축, 위쪽 Z축이 보이는 구도.
const INITIAL_CAMERA_POS = new THREE.Vector3(-2.6, 1.9, -2.6);

// bloch 좌표(x,y,z) -> three.js 좌표. three.js는 Y가 위쪽이므로
// bloch Z(위)를 three Y에, bloch Y를 three Z에 대응시킨다.
function blochToThree(v, out = new THREE.Vector3()) {
  return out.set(v.x, v.z, v.y);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
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

  // 은은한 와이어프레임 구
  const sphereGeo = new THREE.SphereGeometry(SPHERE_RADIUS, 28, 18);
  const sphereMat = new THREE.MeshBasicMaterial({
    color: AXIS_COLOR,
    wireframe: true,
    transparent: true,
    opacity: 0.16,
  });
  scene.add(new THREE.Mesh(sphereGeo, sphereMat));

  // 얇고 은은한 X, Y, Z 축
  const axisMat = new THREE.LineBasicMaterial({
    color: AXIS_COLOR,
    transparent: true,
    opacity: 0.55,
  });
  const axisEnds = [
    [new THREE.Vector3(-1.2, 0, 0), new THREE.Vector3(1.2, 0, 0)], // bloch X
    [new THREE.Vector3(0, 0, -1.2), new THREE.Vector3(0, 0, 1.2)], // bloch Y
    [new THREE.Vector3(0, -1.2, 0), new THREE.Vector3(0, 1.2, 0)], // bloch Z
  ];
  for (const [from, to] of axisEnds) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    scene.add(new THREE.Line(geo, axisMat));
  }

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

  function setVectorInstant(bloch) {
    const dir = blochToThree(bloch).normalize();
    arrow.setDirection(dir);
  }

  function animateVectorTo(fromBloch, toBloch, duration = 500) {
    return new Promise((resolve) => {
      const fromV = blochToThree(fromBloch).normalize();
      const toV = blochToThree(toBloch).normalize();
      const qTotal = new THREE.Quaternion().setFromUnitVectors(fromV, toV);
      const identity = new THREE.Quaternion();
      const start = performance.now();

      function frame(now) {
        const t = Math.min(1, (now - start) / duration);
        const eased = easeOutCubic(t);
        const qStep = identity.clone().slerp(qTotal, eased);
        const dir = fromV.clone().applyQuaternion(qStep).normalize();
        arrow.setDirection(dir);
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

  return { setVectorInstant, animateVectorTo, resetView };
}
