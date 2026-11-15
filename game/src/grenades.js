// Throwable grenades: an HE charge and a smoke canister. A thrown grenade is a small
// physics body — gravity, a bounce off the world's boxes, a fuse — and then it does
// its job: the HE hurts everyone in radius with falloff, the smoke hangs a cloud that
// blocks sight for both teams. Bots throw them too, through the same code.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const GRAVITY = 14;

export function createGrenades(scene, world, effects, audio) {
  const live = [];
  const smokeClouds = [];
  const geometry = new THREE.SphereGeometry(0.09, 10, 8);
  const heMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.danger), roughness: 0.5, metalness: 0.3 });
  const smokeMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c8ccd0'), roughness: 0.8 });

  function throwGrenade(origin, direction, kind, owner) {
    const mesh = new THREE.Mesh(geometry, kind === 'he' ? heMaterial : smokeMaterial);
    mesh.position.copy(origin);
    scene.add(mesh);
    const velocity = direction.clone().multiplyScalar(13);
    velocity.y += 3.5;
    live.push({ mesh, velocity, kind, owner, fuse: 1.7, bounced: false });
  }

  function explode(item, onDamage) {
    const center = item.mesh.position;
    if (item.kind === 'he') {
      audio.explosion();
      effects.sparks(center, new THREE.Vector3(0, 1, 0));
      onDamage(center, 6.5, 110);
    } else {
      const cloud = effects.smokePuff(center, 3.2);
      smokeClouds.push({ group: cloud, center: center.clone(), radius: 3.4, life: 13 });
    }
    scene.remove(item.mesh);
  }

  function step(dt, onDamage) {
    for (let i = live.length - 1; i >= 0; i -= 1) {
      const item = live[i];
      item.fuse -= dt;
      item.velocity.y -= GRAVITY * dt;
      const next = item.mesh.position.clone().addScaledVector(item.velocity, dt);
      // Cheap bounce: test the next position against every collider box.
      let bounced = false;
      for (const box of world.colliders) {
        if (next.x > box.min.x - 0.09 && next.x < box.max.x + 0.09
          && next.y > box.min.y - 0.09 && next.y < box.max.y + 0.09
          && next.z > box.min.z - 0.09 && next.z < box.max.z + 0.09) {
          const dxMin = Math.min(Math.abs(next.x - box.min.x), Math.abs(next.x - box.max.x));
          const dyMin = Math.min(Math.abs(next.y - box.min.y), Math.abs(next.y - box.max.y));
          const dzMin = Math.min(Math.abs(next.z - box.min.z), Math.abs(next.z - box.max.z));
          if (dxMin <= dyMin && dxMin <= dzMin) item.velocity.x *= -0.45;
          else if (dyMin <= dzMin) item.velocity.y = Math.abs(item.velocity.y) * 0.45;
          else item.velocity.z *= -0.45;
          item.velocity.multiplyScalar(0.7);
          bounced = true;
          break;
        }
      }
      if (bounced) item.bounced = true;
      if (!bounced) item.mesh.position.copy(next);
      else item.mesh.position.y = Math.max(item.mesh.position.y, 0.1);
      if (item.fuse <= 0 || (item.bounced && item.fuse <= 0.9)) {
        explode(item, onDamage);
        live.splice(i, 1);
      }
    }
    for (let i = smokeClouds.length - 1; i >= 0; i -= 1) {
      smokeClouds[i].life -= dt;
      if (smokeClouds[i].life <= 0) smokeClouds.splice(i, 1);
    }
  }

  // A segment is blocked by smoke when its midpoint passes inside a live cloud.
  function blockedBySmoke(a, b) {
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const midZ = (a.z + b.z) / 2;
    for (const cloud of smokeClouds) {
      const dx = midX - cloud.center.x;
      const dy = midY - cloud.center.y;
      const dz = midZ - cloud.center.z;
      if (dx * dx + dy * dy + dz * dz < cloud.radius * cloud.radius) return true;
    }
    return false;
  }

  return {
    throwGrenade,
    step,
    blockedBySmoke,
    reset() {
      for (const item of live) scene.remove(item.mesh);
      live.length = 0;
      smokeClouds.length = 0;
    },
  };
}
