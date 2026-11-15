// The map: Kestrel Yard, a dusk container port, 40 x 32 m. Two bombsites — A in the
// north-west warehouse corner, B in the north-east container stack — reached by three
// lanes: west, mid and east. Every box is a collider for movement and a surface a
// bullet stops on. Waypoints below are the graph the bots navigate.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoint nodes [x, z] and the edges between them. Attackers spawn south (z ~ +13),
// defenders hold north. Sites: A around node 17, B around node 21.
export const WAYPOINTS = [
  [-2, 13], [2, 13], [-8, 12], [8, 12],           // 0-3  attacker spawn
  [-14, 8], [-15, 2], [-15, -4], [-14, -8],       // 4-7  west lane to A
  [14, 8], [15, 2], [15, -4], [14, -8],           // 8-11 east lane to B
  [0, 8], [0, 3], [0, -2], [-4, -6], [4, -6],     // 12-16 mid + split
  [-14, -11], [-10, -12], [-17, -12], [-11, -8],  // 17-20 site A
  [14, -11], [10, -12], [17, -12], [11, -8],      // 21-24 site B
  [-8, -10], [8, -10], [0, -11], [-6, -4], [6, -4], // 25-29 defender holds
  [-8, 6], [8, 6],                                // 30-31 cross connectors
];
export const WAY_EDGES = [
  [0, 1], [0, 2], [1, 3], [2, 4], [3, 8], [2, 30], [3, 31],
  [4, 5], [5, 6], [6, 7], [7, 17], [7, 19], [8, 9], [9, 10], [10, 11],
  [11, 21], [11, 23], [0, 12], [1, 12], [12, 13], [13, 14], [14, 15],
  [14, 16], [15, 17], [16, 21], [15, 25], [16, 26], [13, 30], [13, 31],
  [30, 5], [31, 9], [17, 18], [17, 19], [17, 20], [21, 22], [21, 23],
  [21, 24], [25, 18], [26, 22], [27, 15], [27, 16], [28, 15], [29, 16],
  [25, 28], [26, 29], [20, 25], [24, 26], [6, 28], [10, 29],
];

export const SITES = {
  A: { name: 'A', center: new THREE.Vector3(-14, 0, -11), radius: 4.6 },
  B: { name: 'B', center: new THREE.Vector3(14, 0, -11), radius: 4.6 },
};
export const ATTACK_SPAWNS = [
  [-4, 13.5], [-1, 14], [2, 13.5], [5, 14], [-7, 13],
];
export const DEFEND_SPAWNS = [
  [-13, -13], [-6, -13.5], [0, -14], [6, -13.5], [13, -13],
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'lamp' ? 0.5 : 0.92,
      metalness: name === 'teal' || name === 'rust' ? 0.25 : 0.03,
    });
  }
  // Containers read as painted steel: a little more metal, a little less rough.
  materials.rust.metalness = 0.35;
  materials.rust.roughness = 0.7;
  materials.teal.metalness = 0.35;
  materials.teal.roughness = 0.7;

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // Ground and outer walls: 40 x 32 m, 4.6 m walls, open dusk sky above.
  box(44, 0.4, 36, 0, -0.2, 0, 'asphalt');
  box(0.4, 4.6, 36, -20.2, 2.3, 0, 'surface');
  box(0.4, 4.6, 36, 20.2, 2.3, 0, 'surface');
  box(44, 4.6, 0.4, 0, 2.3, -16.2, 'surface');
  box(44, 4.6, 0.4, 0, 2.3, 16.2, 'surface');

  // Painted ground guides: faded lane lines leading to each site.
  box(0.35, 0.02, 24, -15, 0.01, 0, 'accent', false).material = materials.accent.clone();
  box(0.35, 0.02, 24, 15, 0.01, 0, 'accent', false).material = materials.accent.clone();
  box(0.35, 0.02, 20, 0, 0.01, 2, 'accent', false).material = materials.accent.clone();

  // --- Site A: warehouse corner, north-west. Crates, a platform, a tall stack. ---
  box(6, 2.6, 2.4, -17.5, 1.3, -13.5, 'rust');          // long container, west wall
  box(2.4, 2.6, 6, -11, 1.3, -14.5, 'teal');            // container, north wall
  box(1.2, 1.2, 1.2, -15.5, 0.6, -9, 'hairline');       // crate
  box(1.2, 1.2, 1.2, -14.2, 0.6, -9.2, 'hairline');     // crate
  box(1.2, 1.2, 1.2, -14.8, 1.8, -9.1, 'hairline');     // stacked crate
  box(3.6, 0.5, 2.4, -12, 0.25, -11.5, 'surface');      // low platform
  box(1.2, 0.9, 1.2, -17.5, 0.45, -9.5, 'hairline');    // low block
  box(1.2, 0.9, 1.2, -10.5, 0.45, -8.5, 'hairline');    // low block

  // --- Site B: container stack, north-east. ---
  box(6, 2.6, 2.4, 17.5, 1.3, -13.5, 'teal');           // long container, east wall
  box(2.4, 2.6, 6, 11, 1.3, -14.5, 'rust');             // container, north wall
  box(2.4, 2.6, 2.4, 15.5, 1.3, -11, 'rust');           // stack base
  box(2.4, 2.6, 2.4, 15.5, 3.9, -11, 'teal');           // stack top (climbable sightline)
  box(1.2, 1.2, 1.2, 12.5, 0.6, -9, 'hairline');        // crate
  box(1.2, 0.9, 1.2, 17.5, 0.45, -9, 'hairline');       // low block
  box(3.6, 0.5, 2.4, 12, 0.25, -11.5, 'surface');       // low platform

  // --- Mid plaza: the big block that splits the map. ---
  box(6, 2.6, 2.4, 0, 1.3, -2, 'rust');                 // mid container
  box(1.2, 1.2, 1.2, -3.6, 0.6, -2, 'hairline');
  box(1.2, 1.2, 1.2, 3.6, 0.6, -2, 'hairline');
  box(2.4, 0.9, 1.2, 0, 0.45, 3.5, 'hairline');         // mid low wall
  box(1.2, 0.9, 1.2, -6, 0.45, 6, 'hairline');
  box(1.2, 0.9, 1.2, 6, 0.45, 6, 'hairline');

  // --- Lane cover: containers and crates to fight around. ---
  box(2.4, 2.6, 2.4, -15, 1.3, 4, 'teal');              // west lane block
  box(1.2, 1.2, 1.2, -13.5, 0.6, 0, 'hairline');
  box(2.4, 2.6, 2.4, 15, 1.3, 4, 'rust');               // east lane block
  box(1.2, 1.2, 1.2, 13.5, 0.6, 0, 'hairline');
  box(1.2, 0.9, 1.2, -8, 0.45, 9, 'hairline');          // south-west crate
  box(1.2, 0.9, 1.2, 8, 0.45, 9, 'hairline');           // south-east crate
  box(2.4, 1.1, 1.2, -4, 0.55, -6, 'hairline');         // north-mid west crate
  box(2.4, 1.1, 1.2, 4, 0.55, -6, 'hairline');          // north-mid east crate
  box(1.6, 0.7, 1.6, -10, 0.35, -6, 'hairline');
  box(1.6, 0.7, 1.6, 10, 0.35, -6, 'hairline');

  // --- Site signs: canvas-texture boards so each site reads at a glance. ---
  function siteSign(letter, x, z) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const g = canvas.getContext('2d');
    g.fillStyle = '#232a33';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#f0a830';
    g.lineWidth = 6;
    g.strokeRect(6, 6, 116, 116);
    g.fillStyle = '#f0a830';
    g.font = 'bold 84px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, 64, 70);
    const texture = new THREE.CanvasTexture(canvas);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.MeshBasicMaterial({ map: texture }),
    );
    sign.position.set(x, 3.1, z);
    group.add(sign);
    return sign;
  }
  siteSign('A', -14, -15.9);
  siteSign('B', 14, -15.9);

  // --- Sodium lamps: warm pools of light over mid and both sites. ---
  function lamp(x, z) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.4, 8), materials.hairline);
    pole.position.set(x, 2.2, z);
    pole.castShadow = true;
    group.add(pole);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 12, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.lamp) }),
    );
    head.position.set(x, 4.5, z);
    group.add(head);
    const light = new THREE.PointLight(new THREE.Color(PALETTE.lamp), 22, 16, 1.8);
    light.position.set(x, 4.3, z);
    group.add(light);
    shootables.push(pole);
    colliders.push(new THREE.Box3().setFromObject(pole));
  }
  lamp(-6, -6);
  lamp(6, -6);
  lamp(0, 6);

  // Light: low dusk sun from the south-west, cool sky fill, warm hemisphere.
  const sky = new THREE.HemisphereLight(new THREE.Color('#8fa3b8'), new THREE.Color(PALETTE.canvas), 1.25);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb36b'), 2.4);
  sun.position.set(-14, 18, 16);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#5f7ea6'), 0.5);
  fill.position.set(10, 12, -14);
  scene.add(fill);

  return { colliders, shootables, group, materials };
}
