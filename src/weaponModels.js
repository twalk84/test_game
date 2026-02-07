import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";

export function createTacticalRifleModel(options = {}) {
  const {
    color = 0x2a313d,
    accent = 0x10151d,
    emissive = 0x000000,
    scale = 1,
  } = options;

  const root = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({
    color,
    emissive,
    roughness: 0.45,
    metalness: 0.7,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accent,
    roughness: 0.55,
    metalness: 0.6,
  });

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.9), bodyMat);
  receiver.castShadow = true;
  receiver.receiveShadow = true;

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.36), accentMat);
  stock.position.set(0, 0.02, -0.58);
  stock.castShadow = true;

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.74, 12), bodyMat);
  barrel.rotation.x = Math.PI * 0.5;
  barrel.position.set(0, 0.02, 0.72);
  barrel.castShadow = true;

  const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.44), accentMat);
  handguard.position.set(0, 0.01, 0.42);
  handguard.castShadow = true;

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.12), accentMat);
  grip.position.set(0, -0.17, -0.06);
  grip.rotation.x = -0.24;
  grip.castShadow = true;

  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.16), bodyMat);
  mag.position.set(0, -0.18, 0.06);
  mag.rotation.x = 0.2;
  mag.castShadow = true;

  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.16), accentMat);
  sight.position.set(0, 0.14, 0.12);
  sight.castShadow = true;

  root.add(receiver, stock, barrel, handguard, grip, mag, sight);
  root.scale.setScalar(scale);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, 1.08);
  root.add(muzzle);

  return {
    root,
    muzzle,
    materials: [bodyMat, accentMat],
  };
}
