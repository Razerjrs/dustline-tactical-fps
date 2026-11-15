// The bots: nine of them, four Vanguard teammates and five Ember enemies. Each bot
// is a small state machine — move along the waypoint graph, hold a position, engage
// what it sees, plant or defuse the bomb — with reaction times, burst fire and aim
// error so fights feel like people, not turrets. They hear gunshots and investigate.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WAYPOINTS, WAY_EDGES, SITES } from './world.js';

const CALLSIGNS = {
  van: ['Falcon', 'Ibis', 'Kite', 'Heron'],
  emb: ['Viper', 'Cobra', 'Asp', 'Mamba', 'Adder'],
};
const BOT_SPEED = 4.0;
const BOT_RADIUS = 0.34;
const BOT_HEIGHT = 1.72;
const PERCEIVE_EVERY = 0.15;
const LOSE_SIGHT_AFTER = 2.0;

// Adjacency list for the waypoint graph, built once.
const ADJ = WAYPOINTS.map(() => []);
for (const [a, b] of WAY_EDGES) {
  ADJ[a].push(b);
  ADJ[b].push(a);
}

function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i += 1) {
    const dx = WAYPOINTS[i][0] - x;
    const dz = WAYPOINTS[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function findPath(from, to) {
  if (from === to) return [to];
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const node = queue.shift();
    for (const next of ADJ[node]) {
      if (prev[next] !== -1) continue;
      prev[next] = node;
      if (next === to) {
        const path = [to];
        let cur = to;
        while (cur !== from) {
          cur = prev[cur];
          path.unshift(cur);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [to];
}

export function createBots(scene, world, host) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 80;
  const probe = new THREE.Box3();
  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();

  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2a2f36'), roughness: 0.85 });
  const limbMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1d2126'), roughness: 0.9 });
  const vanMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.blue), roughness: 0.6, metalness: 0.15 });
  const embMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.red), roughness: 0.6, metalness: 0.15 });
  const visorMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#0c0e11'), roughness: 0.25, metalness: 0.6 });
  const gunMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#15181c'), roughness: 0.5, metalness: 0.4 });

  const torsoGeo = new THREE.BoxGeometry(0.52, 0.62, 0.3);
  const headGeo = new THREE.BoxGeometry(0.3, 0.28, 0.3);
  const legGeo = new THREE.BoxGeometry(0.18, 0.78, 0.2);
  const armGeo = new THREE.BoxGeometry(0.12, 0.5, 0.14);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.1, 0.62);

  const bots = [];
  const hitMeshes = [];

  function buildBot(team, name, weapon) {
    const group = new THREE.Group();
    const teamMat = team === 'van' ? vanMat : embMat;

    const legL = new THREE.Mesh(legGeo, limbMat);
    legL.position.set(-0.14, 0.39, 0);
    const legR = new THREE.Mesh(legGeo, limbMat);
    legR.position.set(0.14, 0.39, 0);
    const torso = new THREE.Mesh(torsoGeo, teamMat);
    torso.position.y = 1.1;
    torso.userData.part = 'torso';
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.3, 0.32), bodyMat);
    vest.position.y = 1.14;
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.y = 1.58;
    head.userData.part = 'head';
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.05), visorMat);
    visor.position.set(0, 1.6, -0.16);
    const arm = new THREE.Mesh(armGeo, limbMat);
    arm.position.set(0.28, 1.15, -0.12);
    arm.rotation.x = -1.1;
    const gun = new THREE.Mesh(gunGeo, gunMat);
    gun.position.set(0.24, 1.18, -0.42);
    group.add(legL, legR, torso, vest, head, visor, arm, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    scene.add(group);

    const bot = {
      group, torso, head, team, name, weapon,
      pos: group.position,
      yaw: 0,
      hp: 100,
      alive: true,
      fall: 0,
      mode: 'move',
      path: [],
      pathIndex: 0,
      goalNode: 0,
      holdUntil: 0,
      target: null,          // { kind: 'player' | 'bot', ref, pos }
      lastSeen: null,        // Vector3 of last seen enemy
      lastSeenAt: -99,
      reactAt: 0,
      burstLeft: 0,
      burstPause: 0,
      cooldown: 0,
      strafeDir: 1,
      strafeUntil: 0,
      skill: 0.65 + Math.random() * 0.3,
      perceiveAt: 0,
      plantProgress: 0,
      defuseProgress: 0,
      grenadeAt: 0,
      carrier: false,
      frozen: false,
      speed: BOT_SPEED * (0.92 + Math.random() * 0.16),
      stepPhase: Math.random() * 0.5,
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    hitMeshes.push(torso, head);
    bots.push(bot);
    return bot;
  }

  function spawnRound(assignments) {
    for (const bot of bots) {
      bot.hp = 100;
      bot.alive = true;
      bot.fall = 0;
      bot.group.rotation.set(0, 0, 0);
      bot.group.visible = true;
      bot.mode = 'move';
      bot.target = null;
      bot.lastSeen = null;
      bot.plantProgress = 0;
      bot.defuseProgress = 0;
      bot.carrier = false;
      const spawn = assignments[bot.name];
      bot.pos.set(spawn.x, 0, spawn.z);
      bot.yaw = spawn.yaw;
      bot.goalNode = nearestNode(spawn.x, spawn.z);
      bot.path = [];
      bot.pathIndex = 0;
    }
  }

  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - BOT_RADIUS, y + lift, z - BOT_RADIUS);
    probe.max.set(x + BOT_RADIUS, y + height - lift, z + BOT_RADIUS);
    for (const collider of world.colliders) if (probe.intersectsBox(collider)) return true;
    return false;
  }

  function moveToward(bot, tx, tz, dt) {
    const dx = tx - bot.pos.x;
    const dz = tz - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return true;
    const stepLen = bot.speed * dt;
    const nx = bot.pos.x + (dx / dist) * stepLen;
    const nz = bot.pos.z + (dz / dist) * stepLen;
    if (!overlaps(nx, bot.pos.y, bot.pos.z, BOT_HEIGHT, 0.04)) bot.pos.x = nx;
    if (!overlaps(bot.pos.x, bot.pos.y, nz, BOT_HEIGHT, 0.04)) bot.pos.z = nz;
    bot.yaw = Math.atan2(-dx, -dz);
    return dist < 0.4;
  }

  function setGoal(bot, node) {
    bot.goalNode = node;
    const from = nearestNode(bot.pos.x, bot.pos.z);
    bot.path = findPath(from, node);
    bot.pathIndex = 0;
    bot.mode = 'move';
  }

  // Line of sight: the world blocks it, smoke blocks it, nothing else does.
  function losClear(a, b) {
    tmpDir.copy(b).sub(a);
    const dist = tmpDir.length();
    if (dist < 0.01) return true;
    tmpDir.normalize();
    raycaster.set(a, tmpDir);
    raycaster.far = dist;
    if (raycaster.intersectObjects(world.shootables, false).length > 0) return false;
    if (host.smokeBlocked(a, b)) return false;
    return true;
  }

  function botEye(bot) {
    return tmpV.set(bot.pos.x, bot.pos.y + 1.55, bot.pos.z);
  }

  function targetChest(target) {
    if (target.kind === 'player') return host.playerChest(tmpV2);
    return tmpV2.set(target.ref.pos.x, target.ref.pos.y + 1.15, target.ref.pos.z);
  }

  // Perceive: the nearest visible enemy, within range and roughly in front — unless
  // it just fired, in which case the bot turns to the sound.
  function perceive(bot, time) {
    if (time < bot.perceiveAt) return;
    bot.perceiveAt = time + PERCEIVE_EVERY;
    const eye = botEye(bot);
    let best = null;
    let bestD = 46;
    const candidates = [];
    if (host.playerAlive()) candidates.push({ kind: 'player', ref: null });
    for (const other of bots) {
      if (other.alive && other.team !== bot.team) candidates.push({ kind: 'bot', ref: other });
    }
    for (const candidate of candidates) {
      const chest = targetChest(candidate);
      const dx = chest.x - bot.pos.x;
      const dz = chest.z - bot.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > bestD) continue;
      const facingX = -Math.sin(bot.yaw);
      const facingZ = -Math.cos(bot.yaw);
      const dot = (dx * facingX + dz * facingZ) / (dist || 1);
      const heard = bot.lastSeen && time - bot.lastSeenAt < 1.2;
      if (dot < 0.25 && !heard && dist > 4) continue;
      if (!losClear(eye, chest)) continue;
      best = candidate;
      bestD = dist;
    }
    if (best) {
      if (bot.target !== best) {
        bot.target = best;
        bot.reactAt = time + 0.3 + (1 - bot.skill) * 0.5 + Math.random() * 0.2;
        bot.burstLeft = 0;
      }
      bot.lastSeen = targetChest(best).clone();
      bot.lastSeenAt = time;
    } else if (bot.target && time - bot.lastSeenAt > LOSE_SIGHT_AFTER) {
      bot.target = null;
    }
  }

  function aimError(bot, target, dist) {
    const speedFactor = target.kind === 'player' ? host.playerSpeed() / 5.4 : 0.25;
    const base = bot.weapon.spreadStill + dist * 0.0011 + speedFactor * 0.02;
    return base * (1.35 - bot.skill);
  }

  // One bot round downrange. The ray is checked against the world first, then the
  // intended target: the player as a vertical segment, a bot as its two hit meshes.
  function fireRound(bot, time) {
    const target = bot.target;
    if (!target) return;
    const chest = targetChest(target).clone();
    const muzzle = tmpV.set(bot.pos.x, bot.pos.y + 1.35, bot.pos.z);
    const dist = muzzle.distanceTo(chest);
    const error = aimError(bot, target, dist);
    const headAim = Math.random() < 0.14;
    const aimPoint = chest.clone();
    if (headAim) aimPoint.y += 0.42;
    aimPoint.x += (Math.random() * 2 - 1) * error * dist;
    aimPoint.y += (Math.random() * 2 - 1) * error * dist;
    aimPoint.z += (Math.random() * 2 - 1) * error * dist;
    tmpDir.copy(aimPoint).sub(muzzle).normalize();
    raycaster.set(muzzle, tmpDir);
    raycaster.far = 90;
    const worldHit = raycaster.intersectObjects(world.shootables, false)[0];
    const worldDist = worldHit ? worldHit.distance : 90;
    let end = null;
    let hitPart = null;
    if (target.kind === 'player') {
      const px = host.playerChest(tmpV2);
      const toPlayer = tmpV2.clone().sub(muzzle);
      const along = toPlayer.dot(tmpDir);
      if (along > 0 && along < worldDist) {
        const closest = muzzle.clone().addScaledVector(tmpDir, along);
        const dx = closest.x - px.x;
        const dz = closest.z - px.z;
        const radial = Math.hypot(dx, dz);
        const vertical = closest.y - (px.y - 0.55);
        if (radial < 0.42 && vertical > -0.1 && vertical < 1.15) {
          end = px.clone();
          hitPart = vertical > 0.85 ? 'head' : 'torso';
        }
      }
    } else {
      const hits = raycaster.intersectObjects([target.ref.torso, target.ref.head], false);
      if (hits.length && hits[0].distance < worldDist) {
        end = hits[0].point.clone();
        hitPart = hits[0].object.userData.part;
      }
    }
    if (!end) {
      end = worldHit ? worldHit.point.clone() : muzzle.clone().addScaledVector(tmpDir, 60);
      if (worldHit) host.sparks(worldHit.point, worldHit.face ? worldHit.face.normal : new THREE.Vector3(0, 1, 0));
    }
    host.tracer(muzzle.clone(), end, bot.team === 'van' ? PALETTE.blue : PALETTE.red);
    host.shotSound(bot.pos, bot.weapon.sound);
    if (hitPart) {
      const falloff = Math.max(0.55, 1 - dist / 160);
      const damage = bot.weapon.damage * (hitPart === 'head' ? bot.weapon.headMult : 1) * falloff;
      if (target.kind === 'player') host.damagePlayer(damage, bot.pos, bot.name);
      else damageBot(target.ref, damage, hitPart, bot);
    }
  }

  function damageBot(bot, amount, part, attacker) {
    if (!bot.alive) return;
    bot.hp -= amount;
    if (bot.hp > 0) return;
    bot.hp = 0;
    bot.alive = false;
    bot.mode = 'dead';
    bot.fall = 0;
    host.onKill(attacker, bot);
  }

  function stepBot(bot, dt, time) {
    if (!bot.alive) {
      if (bot.fall < 1) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.group.rotation.x = -bot.fall * 1.5;
        bot.group.position.y = -bot.fall * 0.1;
      }
      return;
    }
    bot.cooldown = Math.max(0, bot.cooldown - dt);
    if (bot.frozen) return;
    perceive(bot, time);

    // Plant / defuse channels: stand still, count up, finish the objective.
    if (bot.mode === 'plant') {
      bot.plantProgress += dt;
      host.plantProgress(bot, bot.plantProgress / 3);
      if (bot.plantProgress >= 3) {
        host.bombPlanted(bot);
        bot.mode = 'hold';
        bot.holdUntil = time + 999;
      }
      return;
    }
    if (bot.mode === 'defuse') {
      bot.defuseProgress += dt;
      host.defuseProgress(bot, bot.defuseProgress / 5);
      if (bot.defuseProgress >= 5) {
        host.bombDefused(bot);
        bot.mode = 'hold';
      }
      return;
    }

    // A carrier that reaches its site with no enemy close starts planting.
    const bomb = host.bombState();
    const arrived = bot.pathIndex >= bot.path.length;
    if (bot.carrier && !bomb.planted && arrived && (bot.mode === 'move' || bot.mode === 'hold')) {
      const site = bot.goalSite === 'B' ? SITES.B : SITES.A;
      const dx = bot.pos.x - site.center.x;
      const dz = bot.pos.z - site.center.z;
      if (dx * dx + dz * dz < site.radius * site.radius && time - bot.lastSeenAt > 1) {
        bot.mode = 'plant';
        bot.plantProgress = 0;
        host.plantStarted(bot);
        return;
      }
    }
    // A defender that reaches the planted bomb starts defusing.
    if (bot.team === 'emb' && bomb.planted && arrived && (bot.mode === 'move' || bot.mode === 'hold')) {
      if (bot.pos.distanceTo(bomb.pos) < 1.6) {
        bot.mode = 'defuse';
        bot.defuseProgress = 0;
        host.defuseStarted(bot);
        return;
      }
    }

    // Combat: face the target, strafe, fire in bursts.
    if (bot.target) {
      const chest = targetChest(bot.target);
      bot.yaw = Math.atan2(-(chest.x - bot.pos.x), -(chest.z - bot.pos.z));
      if (time > bot.strafeUntil) {
        bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
        bot.strafeUntil = time + 0.5 + Math.random() * 0.7;
      }
      const sideX = Math.cos(bot.yaw) * bot.strafeDir;
      const sideZ = -Math.sin(bot.yaw) * bot.strafeDir;
      const nx = bot.pos.x + sideX * bot.speed * 0.45 * dt;
      const nz = bot.pos.z + sideZ * bot.speed * 0.45 * dt;
      if (!overlaps(nx, bot.pos.y, bot.pos.z, BOT_HEIGHT, 0.04)) bot.pos.x = nx;
      if (!overlaps(bot.pos.x, bot.pos.y, nz, BOT_HEIGHT, 0.04)) bot.pos.z = nz;
      if (time >= bot.reactAt) {
        if (bot.burstLeft <= 0) {
          if (bot.burstPause <= 0) {
            bot.burstLeft = 3 + Math.floor(Math.random() * 3);
            bot.burstPause = 0.45 + Math.random() * 0.5;
          } else {
            bot.burstPause -= dt;
          }
        }
        if (bot.burstLeft > 0 && bot.cooldown <= 0) {
          fireRound(bot, time);
          bot.burstLeft -= 1;
          bot.cooldown = bot.weapon.fireGap;
          // Lob an HE at a dug-in defender now and then.
          if (bot.team === 'van' && time > bot.grenadeAt && Math.random() < 0.06) {
            bot.grenadeAt = time + 22;
            host.throwGrenade(bot, chest);
          }
        }
      }
      return;
    }

    // Move along the path, or hold.
    if (bot.mode === 'hold') {
      if (time < bot.holdUntil) return;
      bot.mode = 'move';
    }
    if (bot.mode === 'move' && bot.path.length) {
      if (bot.pathIndex < bot.path.length) {
        const node = WAYPOINTS[bot.path[bot.pathIndex]];
        if (moveToward(bot, node[0], node[1], dt)) bot.pathIndex += 1;
      } else {
        // Arrived: defenders hold, attackers wait for a rotate or a plant.
        bot.mode = 'hold';
        bot.holdUntil = time + (bot.team === 'emb' ? 999 : 6);
      }
    }
    // Investigate a heard shot: walk to the nearest node to the sound.
    if (bot.investigate && time < bot.investigateUntil) {
      if (bot.mode !== 'move' || bot.pathIndex >= bot.path.length) {
        setGoal(bot, nearestNode(bot.investigate.x, bot.investigate.z));
        bot.investigate = null;
      }
    }
  }

  return {
    bots,
    hitMeshes,
    buildBot,
    spawnRound,
    setGoal,
    nearestNode,
    losClear,
    damageBot,
    step(dt, time) {
      for (const bot of bots) stepBot(bot, dt, time);
    },
    aliveCount(team) {
      return bots.filter((b) => b.alive && b.team === team).length;
    },
    carrier() {
      return bots.find((b) => b.carrier && b.alive) || null;
    },
    hearShot(pos, time) {
      for (const bot of bots) {
        if (!bot.alive || bot.target) continue;
        const dx = bot.pos.x - pos.x;
        const dz = bot.pos.z - pos.z;
        if (dx * dx + dz * dz < 26 * 26) {
          bot.investigate = { x: pos.x, z: pos.z };
          bot.investigateUntil = time + 4;
          bot.lastSeen = { x: pos.x, y: 1.2, z: pos.z };
          bot.lastSeenAt = time;
        }
      }
    },
    reset() {
      for (const bot of bots) {
        bot.alive = true;
        bot.hp = 100;
        bot.fall = 0;
        bot.group.rotation.set(0, 0, 0);
        bot.group.visible = true;
      }
    },
  };
}
