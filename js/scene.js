// Three.js 기반 Bloch sphere 3D 렌더링, Slerp 상태 벡터 애니메이션, 시점 리셋.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// index.html의 html,body font-family와 반드시 일치시켜야 한다. 다르면 캔버스 텍스트가
// DOM 폰트와 다른 대체 글꼴로 그려져 ⟩, π 같은 글리프가 어긋나 보인다("깨져 보임").
const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Segoe UI", Roboto, sans-serif';

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

function popcount(n) {
  let count = 0;
  while (n) {
    count += n & 1;
    n >>= 1;
  }
  return count;
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

function drawLabelCanvas(ctx, size, text) {
  ctx.clearRect(0, 0, size, size);
  const fontSize = text.length > 3 ? 34 : 56;
  ctx.font = `600 ${fontSize}px ${FONT_STACK}`;
  ctx.fillStyle = LABEL_COLOR;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, size / 2);
}

// updateLabelSprite(sprite, text)로 나중에 텍스트를 바꿀 수 있도록 canvas/ctx를 보관한다
// (Bloch <-> Q-sphere 모드 전환 시 극 라벨이 |0>/|1> <-> |00..0>/|11..1>로 바뀌어야 함).
function makeLabelSprite(text) {
  const size = 160;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  drawLabelCanvas(ctx, size, text);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.32, 0.32, 1);
  sprite.userData.canvas = canvas;
  sprite.userData.ctx = ctx;
  sprite.userData.texture = texture;
  return sprite;
}

function updateLabelSprite(sprite, text) {
  const { ctx, texture } = sprite.userData;
  drawLabelCanvas(ctx, sprite.userData.canvas.width, text);
  texture.needsUpdate = true;
}

// Q-sphere 마커 라벨("|0000⟩ π" 등)처럼 가로로 긴 문자열 전용. 정사각 캔버스를
// 비균일 스케일로 늘리면 글자가 찌그러져 "깨진" 것처럼 보이므로, 캔버스 자체를
// 실제 필요한 가로세로 비율로 만들고 스프라이트는 그 비율 그대로 균일하게 스케일한다.
const WIDE_LABEL_W = 320;
const WIDE_LABEL_H = 120;
function makeWideLabelSprite(text, worldWidth = 0.6) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDE_LABEL_W;
  canvas.height = WIDE_LABEL_H;
  const ctx = canvas.getContext("2d");
  ctx.font = `600 44px ${FONT_STACK}`;
  ctx.fillStyle = LABEL_COLOR;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, WIDE_LABEL_W / 2, WIDE_LABEL_H / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(worldWidth, worldWidth * (WIDE_LABEL_H / WIDE_LABEL_W), 1);
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

  // Q-sphere 채움 구를 은은하게 음영지게(입체감) 보이려면 조명이 필요하다.
  // MeshBasicMaterial(와이어프레임/축/화살표/트레일)은 조명 영향을 받지 않으므로 안전하다.
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.7);
  keyLight.position.set(2, 3, 2);
  scene.add(keyLight);

  function resetView() {
    camera.position.copy(INITIAL_CAMERA_POS);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  // 와이어프레임 구 (Bloch 모드 전용)
  const sphereGeo = new THREE.SphereGeometry(SPHERE_RADIUS, 28, 18);
  const sphereMat = new THREE.MeshBasicMaterial({
    color: WIREFRAME_COLOR,
    wireframe: true,
    transparent: true,
    opacity: 0.35,
  });
  const wireframeSphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
  scene.add(wireframeSphereMesh);

  // X, Y, Z 축 (bloch X -> three X, bloch Y -> three Z, bloch Z -> three Y)
  const axisX = makeAxisMesh("x");
  const axisY = makeAxisMesh("y");
  const axisZ = makeAxisMesh("z");
  scene.add(axisX, axisY, axisZ);

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
  let sceneMode = "bloch"; // setMode()가 갱신. rebuildTrailMesh가 새 메쉬를 만들 때 참조.
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
    trailMesh.visible = sceneMode === "bloch";
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

  // renderLoop 정의만 하고 호출은 Q-sphere 요소(qsphereBgGroup, silhouette) 생성 후에 한다
  // (const TDZ 때문에 먼저 호출하면 "Cannot access before initialization" 발생).
  function renderLoop() {
    controls.update();
    // Q-sphere 외곽 실루엣 링을 항상 카메라를 향하게(billboard) 회전시켜 구 윤곽처럼 보이게 한다.
    if (qsphereBgGroup.visible) silhouette.quaternion.copy(camera.quaternion);
    renderer.render(scene, camera);
    requestAnimationFrame(renderLoop);
  }

  // ---------- Q-sphere (IBM 스타일 전체 상태 시각화) ----------
  // Bloch sphere는 얽힌 상태를 표현할 수 없으므로, 얽힌 회로에서는 대신 이 뷰로
  // 전환해 전체 2^n 계산기저를 위도(해밍 가중치)·경도(같은 가중치 내 균등 분산)로
  // 배치하고, 크기는 확률, 색상은 위상으로 표현한다.
  const qsphereBgGroup = new THREE.Group();
  qsphereBgGroup.visible = false;
  scene.add(qsphereBgGroup);

  // 조명을 받는 재질을 써서 IBM Q-sphere처럼 은은한 입체 음영이 보이게 한다
  // (MeshBasicMaterial은 항상 평평하게 렌더링되어 구가 잘 보이지 않았다).
  const qsphereFillMat = new THREE.MeshStandardMaterial({
    color: 0xe4e7eb,
    transparent: true,
    opacity: 0.35,
    roughness: 1,
    metalness: 0,
    depthWrite: false,
  });
  const qsphereFillMesh = new THREE.Mesh(new THREE.SphereGeometry(SPHERE_RADIUS, 48, 36), qsphereFillMat);
  qsphereBgGroup.add(qsphereFillMesh);

  // 극-극 수직 중심축 (IBM Q-sphere처럼 위/아래 극을 잇는 얇은 세로선)
  const poleAxisMat = new THREE.LineBasicMaterial({ color: AXIS_COLOR, transparent: true, opacity: 0.5 });
  const poleAxis = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -SPHERE_RADIUS, 0),
      new THREE.Vector3(0, SPHERE_RADIUS, 0),
    ]),
    poleAxisMat
  );
  qsphereBgGroup.add(poleAxis);

  // 바깥 실루엣 원 — 항상 카메라를 향하는 great-circle 링으로 구 윤곽을 또렷하게.
  const SILHOUETTE_SEGMENTS = 96;
  const silhouettePoints = [];
  for (let s = 0; s <= SILHOUETTE_SEGMENTS; s++) {
    const a = (2 * Math.PI * s) / SILHOUETTE_SEGMENTS;
    silhouettePoints.push(new THREE.Vector3(Math.cos(a) * SPHERE_RADIUS, Math.sin(a) * SPHERE_RADIUS, 0));
  }
  const silhouette = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(silhouettePoints),
    new THREE.LineBasicMaterial({ color: 0x8b95a1, transparent: true, opacity: 0.55 })
  );
  qsphereBgGroup.add(silhouette);

  let qsphereRingQubitCount = -1;
  function rebuildQSphereRings(qubitCount) {
    if (qubitCount === qsphereRingQubitCount) return;
    qsphereRingQubitCount = qubitCount;
    for (const child of qsphereBgGroup.children.slice()) {
      if (child === qsphereFillMesh) continue;
      qsphereBgGroup.remove(child);
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }
    const ringMat = new THREE.LineBasicMaterial({ color: AXIS_COLOR, transparent: true, opacity: 0.4 });
    const SEGMENTS = 64;
    for (let w = 1; w < qubitCount; w++) {
      const theta = (Math.PI * w) / qubitCount;
      const r = Math.sin(theta) * SPHERE_RADIUS;
      const y = Math.cos(theta) * SPHERE_RADIUS;
      const points = [];
      for (let s = 0; s <= SEGMENTS; s++) {
        const a = (2 * Math.PI * s) / SEGMENTS;
        points.push(new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a)));
      }
      qsphereBgGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), ringMat));
    }
  }

  const qsphereStateGroup = new THREE.Group(); // 마커(점) + |ket⟩ phase 라벨
  const qspherePhaseGroup = new THREE.Group(); // 위상 색 스템 라인
  scene.add(qsphereStateGroup, qspherePhaseGroup);
  const qsphereMarkerGeo = new THREE.SphereGeometry(1, 12, 10);

  // 위상(라디안)을 π의 간단한 분수로 표기 (0, π, π/2, 2π/3 ...), 아니면 소수 배수로 근사.
  const SIMPLE_FRACTIONS = [
    [1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [1, 6], [5, 6], [1, 8], [3, 8], [5, 8], [7, 8],
  ];
  function formatPhase(rad) {
    const EPS = 0.02;
    let a = rad % (2 * Math.PI);
    if (a > Math.PI) a -= 2 * Math.PI;
    if (a <= -Math.PI) a += 2 * Math.PI;
    if (Math.abs(a) < EPS) return "0";
    if (Math.abs(Math.abs(a) - Math.PI) < EPS) return "π";
    const sign = a < 0 ? "-" : "";
    const absFrac = Math.abs(a) / Math.PI;
    for (const [num, den] of SIMPLE_FRACTIONS) {
      if (Math.abs(absFrac - num / den) < EPS) {
        return `${sign}${num === 1 ? "" : num}π/${den}`;
      }
    }
    return `${(a / Math.PI).toFixed(2)}π`;
  }

  function clearGroup(group) {
    for (const child of group.children.slice()) {
      group.remove(child);
      // Line(stem)만 개별 지오메트리를 갖는다. 마커는 qsphereMarkerGeo를 공유하고,
      // Sprite(라벨)는 three.js가 내부적으로 공유하는 싱글턴 지오메트리를 쓰므로
      // 절대 dispose하면 안 된다 (다른 모든 스프라이트가 함께 깨진다).
      if (child.isLine) child.geometry?.dispose?.();
      child.material?.map?.dispose?.();
      child.material?.dispose?.();
    }
  }

  function setQSphereData(probabilities, qubitCount) {
    clearGroup(qsphereStateGroup);
    clearGroup(qspherePhaseGroup);
    rebuildQSphereRings(qubitCount);
    if (!qubitCount) return;
    const byWeight = new Map();
    for (const entry of probabilities) {
      const w = popcount(entry.index);
      if (!byWeight.has(w)) byWeight.set(w, []);
      byWeight.get(w).push(entry);
    }
    const PROB_EPS = 0.05; // %
    for (const [weight, entries] of byWeight) {
      const theta = (Math.PI * weight) / qubitCount;
      entries.forEach((entry, k) => {
        if (entry.probability < PROB_EPS) return;
        const phi = entries.length > 1 ? (2 * Math.PI * k) / entries.length : 0;
        const bx = Math.sin(theta) * Math.cos(phi);
        const by = Math.sin(theta) * Math.sin(phi);
        const bz = Math.cos(theta);
        const pos = blochToThree({ x: bx, y: by, z: bz }).multiplyScalar(SPHERE_RADIUS);
        const phaseRad = Math.atan2(entry.im, entry.re);
        const hue = ((phaseRad / (2 * Math.PI)) % 1 + 1) % 1;
        const color = new THREE.Color().setHSL(hue, 0.75, 0.55);

        const stemGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), pos]);
        const stemMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 });
        qspherePhaseGroup.add(new THREE.Line(stemGeo, stemMat));

        const radius = 0.035 + 0.09 * Math.sqrt(entry.probability / 100);
        const markerMat = new THREE.MeshBasicMaterial({ color });
        const marker = new THREE.Mesh(qsphereMarkerGeo, markerMat);
        marker.position.copy(pos);
        marker.scale.setScalar(radius);
        qsphereStateGroup.add(marker);

        const label = makeWideLabelSprite(`|${entry.label}⟩ ${formatPhase(phaseRad)}`);
        label.position.copy(pos).multiplyScalar(1.18);
        qsphereStateGroup.add(label);
      });
    }
  }

  function setMode(nextMode) {
    sceneMode = nextMode;
    const isBloch = sceneMode === "bloch";
    arrow.visible = isBloch;
    if (trailMesh) trailMesh.visible = isBloch;
    xLabel.visible = isBloch;
    yLabel.visible = isBloch;
    axisX.visible = isBloch;
    axisY.visible = isBloch;
    axisZ.visible = isBloch;
    wireframeSphereMesh.visible = isBloch;
    qsphereBgGroup.visible = !isBloch;
    qsphereStateGroup.visible = !isBloch;
    qspherePhaseGroup.visible = !isBloch;
    // Q-sphere 모드에서는 weight-0/weight-n 마커 라벨이 극에 동일한 정보(+위상)를
    // 이미 표시하므로, 고정 극 라벨은 숨겨서 겹침을 피한다.
    zeroLabel.visible = isBloch;
    oneLabel.visible = isBloch;
    if (isBloch) {
      updateLabelSprite(zeroLabel, "|0⟩");
      updateLabelSprite(oneLabel, "|1⟩");
    }
  }

  renderLoop();

  return {
    setVectorInstant,
    animateVectorTo,
    resetView,
    clearTrail,
    setMode,
    setQSphereData,
  };
}
