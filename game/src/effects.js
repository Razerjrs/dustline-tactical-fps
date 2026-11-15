// Transient battle effects: tracer lines, impact sparks, smoke puffs. Everything is
// pooled and reused — no new objects in the hot loop — and every effect fades out on
// its own so the simulation never has to clean up after it.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const MAX_TRACERS = 24;
const MAX_SPARKS = 10;

export function createEffects(scene) {
  const tracers = [];
  const sparks = [];
  const smokes = [];
  const tracerMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.85,
  });
  const sparkMaterial = new THREE.PointsMaterial({
    color: new THREE.Color(PALETTE.accent), size: 0.09, transparent: true, opacity: 1,
    sizeAttenuation: true,
  });
  const smokeMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#b8bec4'), transparent: true, opacity: 0.55,
    roughness: 1, depthWrite: false,
  });

  for (let i = 0; i < MAX_TRACERS; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, tracerMaterial.clone());
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  for (let i = 0; i < MAX_SPARKS; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(36), 3));
    const points = new THREE.Points(geometry, sparkMaterial.clone());
    points.visible = false;
    points.frustumCulled = false;
    scene.add(points);
    sparks.push({ points, life: 0, velocities: new Float32Array(36) });
  }

  const tmp = new THREE.Vector3();

  return {
    tracer(from, to, color = null) {
      const slot = tracers.find((t) => t.life <= 0) || tracers[0];
      const positions = slot.line.geometry.attributes.position.array;
      positions[0] = from.x; positions[1] = from.y; positions[2] = from.z;
      positions[3] = to.x; positions[4] = to.y; positions[5] = to.z;
      slot.line.geometry.attributes.position.needsUpdate = true;
      if (color) slot.line.material.color.set(color);
      else slot.line.material.color.set(PALETTE.accent);
      slot.line.material.opacity = 0.85;
      slot.line.visible = true;
      slot.life = 0.09;
    },
    sparks(point, normal) {
      const slot = sparks.find((s) => s.life <= 0) || sparks[0];
      const positions = slot.points.geometry.attributes.position.array;
      for (let i = 0; i < 12; i += 1) {
        positions[i * 3] = point.x;
        positions[i * 3 + 1] = point.y;
        positions[i * 3 + 2] = point.z;
        tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        tmp.addScaledVector(normal, 1.2);
        slot.velocities[i * 3] = tmp.x * 3;
        slot.velocities[i * 3 + 1] = tmp.y * 3;
        slot.velocities[i * 3 + 2] = tmp.z * 3;
      }
      slot.points.geometry.attributes.position.needsUpdate = true;
      slot.points.material.opacity = 1;
      slot.points.visible = true;
      slot.life = 0.35;
    },
    smokePuff(center, radius) {
      const group = new THREE.Group();
      for (let i = 0; i < 7; i += 1) {
        const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius * (0.5 + Math.random() * 0.4), 10, 8), smokeMaterial.clone());
        sphere.position.set(
          center.x + (Math.random() - 0.5) * radius,
          center.y + Math.random() * radius * 0.7,
          center.z + (Math.random() - 0.5) * radius,
        );
        group.add(sphere);
      }
      group.userData.life = 13;
      scene.add(group);
      smokes.push(group);
      return group;
    },
    step(dt) {
      for (const tracer of tracers) {
        if (tracer.life <= 0) continue;
        tracer.life -= dt;
        tracer.line.material.opacity = Math.max(0, tracer.life / 0.09) * 0.85;
        if (tracer.life <= 0) tracer.line.visible = false;
      }
      for (const spark of sparks) {
        if (spark.life <= 0) continue;
        spark.life -= dt;
        const positions = spark.points.geometry.attributes.position.array;
        for (let i = 0; i < 12; i += 1) {
          positions[i * 3] += spark.velocities[i * 3] * dt;
          positions[i * 3 + 1] += spark.velocities[i * 3 + 1] * dt - 4 * dt * dt;
          positions[i * 3 + 2] += spark.velocities[i * 3 + 2] * dt;
        }
        spark.points.geometry.attributes.position.needsUpdate = true;
        spark.points.material.opacity = Math.max(0, spark.life / 0.35);
        if (spark.life <= 0) spark.points.visible = false;
      }
      for (let i = smokes.length - 1; i >= 0; i -= 1) {
        const group = smokes[i];
        group.userData.life -= dt;
        const fade = Math.min(1, group.userData.life / 3);
        group.children.forEach((sphere) => { sphere.material.opacity = 0.55 * fade; });
        if (group.userData.life <= 0) {
          scene.remove(group);
          smokes.splice(i, 1);
        }
      }
    },
  };
}
