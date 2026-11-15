// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's
// rate. This file wires the modules together: it owns the player shooting ray, the
// plant/defuse interaction, weapon switching, and the deterministic ?shot= poses
// for the screenshots. The match owns the clock and the money; the bots own their
// own decisions; this file owns the player's hands.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, WAYPOINTS, SITES, ATTACK_SPAWNS, DEFEND_SPAWNS } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeaponView, WEAPONS, GRENADES } from './weapons.js';
import { createBots } from './bots.js';
import { createGrenades } from './grenades.js';
import { createEffects } from './effects.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createMatch } from './match.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#252d38');
scene.fog = new THREE.Fog(new THREE.Color('#252d38'), 22, 58);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const effects = createEffects(scene);
const audio = createAudio();
const hud = createHud();
const player = createPlayer(world.colliders);
const weaponView = createWeaponView(camera);
const grenades = createGrenades(scene, world, effects, audio);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 120;

// Loadout: ammo per weapon id and grenade counts. Weapons persist while the player
// lives; dying loses everything but the sidearm.
const loadout = {
  ammo: {},
  grenades: { he: 0, smoke: 0 },
  selected: 'pistol',
};
function resetLoadout() {
  loadout.ammo = { pistol: { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve } };
  loadout.grenades = { he: 0, smoke: 0 };
  loadout.selected = 'pistol';
}
resetLoadout();

function saveAmmo() {
  const id = weaponView.state.def.id;
  if (WEAPONS[id]) loadout.ammo[id] = { mag: weaponView.state.mag, reserve: weaponView.state.reserve };
}
function equipSelection(id) {
  saveAmmo();
  loadout.selected = id;
  const def = WEAPONS[id];
  if (def) {
    const ammo = loadout.ammo[id] || { mag: def.mag, reserve: def.reserve };
    loadout.ammo[id] = ammo;
    weaponView.equip(def, ammo.mag, ammo.reserve);
    hud.setAmmo(ammo.mag, ammo.reserve, def.name);
  } else {
    const name = id === 'he' ? 'HE Grenade' : 'Smoke Grenade';
    hud.setAmmo(loadout.grenades[id], 0, name);
  }
}

const playerState = player.state;
let match = null;
let bots = null;
let started = false;
let frozen = false;
let elapsed = 0;
let accumulator = 0;
let lastTime = performance.now();
let plantProgress = 0;
let spectateTarget = null;
const direction = new THREE.Vector3();
const eyePos = new THREE.Vector3();
const muzzlePos = new THREE.Vector3();

// The host object the bots talk to: everything they need from the rest of the game,
// and nothing they should not touch.
const host = {
  playerAlive() {
    return playerState.hp > 0 && (match.state.phase === 'live' || match.state.phase === 'buy');
  },
  playerChest(out) {
    out.set(playerState.position.x, playerState.position.y + (playerState.crouching ? 0.75 : 1.15), playerState.position.z);
    return out;
  },
  playerSpeed() {
    return player.groundSpeed();
  },
  smokeBlocked(a, b) {
    return grenades.blockedBySmoke(a, b);
  },
  tracer(from, to, color) {
    effects.tracer(from, to, color);
  },
  sparks(point, normal) {
    effects.sparks(point, normal);
  },
  shotSound(pos, kind) {
    const dx = pos.x - playerState.position.x;
    const dz = pos.z - playerState.position.z;
    if (dx * dx + dz * dz < 45 * 45) audio.shot(kind === 'sniper' ? 'sniper' : 'enemy');
  },
  damagePlayer(amount, fromPos, attackerName) {
    if (playerState.hp <= 0) return;
    const absorbed = Math.min(playerState.armour, amount * 0.5);
    playerState.armour -= absorbed;
    playerState.hp -= (amount - absorbed);
    hud.damageFlash();
    audio.hurt();
    hud.setHealth(playerState.hp, Math.round(playerState.armour));
    if (playerState.hp <= 0) {
      playerState.hp = 0;
      match.state.playerDeaths += 1;
      hud.setHealth(0, Math.round(playerState.armour));
      const attackerBot = bots.bots.find((b) => b.name === attackerName) || { name: attackerName, team: 'emb', weapon: WEAPONS.rifle };
      host.onKill(attackerBot, 'player');
      if (document.pointerLockElement) document.exitPointerLock();
      // The bomb passes to the nearest living Vanguard bot.
      const carrier = bots.bots.filter((b) => b.alive && b.team === 'van')
        .sort((a, b) => a.pos.distanceToSquared(playerState.position) - b.pos.distanceToSquared(playerState.position))[0];
      if (carrier) {
        carrier.carrier = true;
        carrier.goalSite = carrier.pos.x < 0 ? 'A' : 'B';
        bots.setGoal(carrier, carrier.goalSite === 'A' ? 17 : 21);
      }
      spectateTarget = bots.bots.find((b) => b.alive && b.team === 'van') || null;
    }
  },
  onKill(attacker, victim) {
    const attackerName = attacker === 'player' ? 'You' : attacker.name;
    const attackerTeam = attacker === 'player' ? 'van' : attacker.team;
    const victimName = victim === 'player' ? 'You' : victim.name;
    const victimTeam = victim === 'player' ? 'van' : victim.team;
    const weaponName = attacker === 'player' ? weaponView.state.def.name
      : attacker.weapon ? attacker.weapon.name : '';
    hud.killfeed(attackerName, attackerTeam, victimName, victimTeam, weaponName);
    if (attacker === 'player') {
      match.awardKill();
      audio.kill();
    }
  },
  bombState() {
    return { planted: match.state.bombPlanted, pos: match.state.bombPos };
  },
  plantStarted(bot) {
    hud.prompt(`${bot.name} is planting the bomb…`);
  },
  plantProgress(bot, frac) {
    hud.progress(frac);
  },
  bombPlanted(bot) {
    match.plantBomb(bot.name, bot.pos, bot.goalSite || 'A');
    hud.prompt(null);
    hud.progress(null);
  },
  defuseStarted(bot) {
    hud.prompt(`${bot.name} is defusing the bomb!`);
  },
  defuseProgress(bot, frac) {
    hud.progress(frac);
  },
  bombDefused(bot) {
    match.defuseBomb();
    hud.prompt(null);
    hud.progress(null);
  },
  throwGrenade(bot, targetPos) {
    const from = new THREE.Vector3(bot.pos.x, bot.pos.y + 1.4, bot.pos.z);
    const dir = targetPos.clone().sub(from).normalize();
    grenades.throwGrenade(from, dir, 'he', bot);
  },
};

bots = createBots(scene, world, host);

// Build the nine bots once: four Vanguard teammates, five Ember enemies.
const BOT_WEAPONS = { rifle: WEAPONS.rifle, smg: WEAPONS.smg, pistol: WEAPONS.pistol };
for (const name of ['Falcon', 'Ibis', 'Kite', 'Heron']) {
  bots.buildBot('van', name, BOT_WEAPONS.rifle);
}
for (const name of ['Viper', 'Cobra', 'Asp', 'Mamba', 'Adder']) {
  bots.buildBot('emb', name, BOT_WEAPONS.rifle);
}

match = createMatch({
  hud,
  audio,
  bots,
  hooks: {
    playerAlive() {
      return playerState.hp > 0;
    },
    resetRound(round) {
      // Player back at the south spawn, facing north up mid.
      player.reset(ATTACK_SPAWNS[2][0], ATTACK_SPAWNS[2][1], 0);
      spectateTarget = null;
      plantProgress = 0;
      grenades.reset();
      if (playerState.hp <= 0) resetLoadout();
      // Fresh ammo for the round's first weapon; other owned weapons refill too.
      for (const id of Object.keys(loadout.ammo)) {
        loadout.ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
      }
      equipSelection(loadout.selected in loadout.ammo || loadout.selected === 'pistol' ? loadout.selected : 'pistol');
      hud.setHealth(playerState.hp, Math.round(playerState.armour));

      // Bots: attackers split across the two sites, defenders hold them.
      const assignments = {};
      const vanBots = bots.bots.filter((b) => b.team === 'van');
      const embBots = bots.bots.filter((b) => b.team === 'emb');
      const siteSplit = round % 2 === 0 ? ['A', 'A', 'B', 'B'] : ['A', 'B', 'A', 'B'];
      vanBots.forEach((bot, i) => {
        const spawn = ATTACK_SPAWNS[i];
        assignments[bot.name] = { x: spawn[0], z: spawn[1], yaw: 0 };
        bot.goalSite = siteSplit[i];
        bot.weapon = round === 1 ? (i % 2 ? BOT_WEAPONS.smg : BOT_WEAPONS.pistol) : (i % 2 ? BOT_WEAPONS.smg : BOT_WEAPONS.rifle);
      });
      const defendNodes = [18, 25, 22, 26, 27];
      embBots.forEach((bot, i) => {
        const spawn = DEFEND_SPAWNS[i];
        assignments[bot.name] = { x: spawn[0], z: spawn[1], yaw: Math.PI };
        bot.goalSite = i < 2 ? 'A' : i < 4 ? 'B' : 'A';
        bot.weapon = round === 1 ? (i % 2 ? BOT_WEAPONS.pistol : BOT_WEAPONS.smg) : (i % 2 ? BOT_WEAPONS.smg : BOT_WEAPONS.rifle);
      });
      bots.spawnRound(assignments);
      vanBots.forEach((bot) => bots.setGoal(bot, bot.goalSite === 'A' ? 17 : 21));
      embBots.forEach((bot, i) => bots.setGoal(bot, defendNodes[i]));
    },
    onBought(itemId) {
      if (WEAPONS[itemId]) {
        loadout.ammo[itemId] = { mag: WEAPONS[itemId].mag, reserve: WEAPONS[itemId].reserve };
        equipSelection(itemId);
      } else if (GRENADES[itemId]) {
        loadout.grenades[itemId] = Math.min(2, loadout.grenades[itemId] + 1);
      }
    },
    onPlant(site) {
      // Defenders rotate to the planted site; attackers fall back to guard it.
      const node = site === 'A' ? 17 : 21;
      for (const bot of bots.bots) {
        if (!bot.alive) continue;
        if (bot.team === 'emb') bots.setGoal(bot, node);
        else if (!bot.carrier) bots.setGoal(bot, node);
      }
    },
    onDetonate(pos) {
      audio.explosion();
      effects.sparks(pos.clone().setY(1), new THREE.Vector3(0, 1, 0));
      hud.damageFlash();
    },
    onRoundEnd(winner, reason, scoreVan, scoreEmb) {
      const win = winner === 'van';
      hud.banner(win ? 'ROUND WON' : 'ROUND LOST', `${reason} — ${scoreVan} : ${scoreEmb}`, win);
      setTimeout(() => { if (match.state.phase === 'end') hud.banner(null); }, 3800);
    },
    onMatchEnd(result, scoreVan, scoreEmb) {
      const text = result === 'van' ? 'VICTORY' : result === 'emb' ? 'DEFEAT' : 'DRAW';
      hud.showOverlay('end', `${scoreVan} - ${scoreEmb}`);
      hud.banner(text, `Final score ${scoreVan} : ${scoreEmb}`, result === 'van');
      if (document.pointerLockElement) document.exitPointerLock();
    },
  },
});

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (match.state.phase === 'menu') {
    match.startMatch();
    hud.hideOverlay();
    input.requestLock();
  } else if (match.state.phase === 'over') {
    match.startMatch();
    hud.hideOverlay();
    input.requestLock();
  } else {
    input.requestLock();
  }
});

hud.onBuy((itemId) => {
  match.buy(itemId);
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (match.state.phase !== 'menu' && match.state.phase !== 'over') {
    hud.showOverlay('paused', 0);
  }
}

function syncCamera() {
  if (playerState.hp <= 0 && spectateTarget) {
    const target = spectateTarget;
    camera.position.set(target.pos.x, target.pos.y + 1.55, target.pos.z);
    camera.rotation.set(0, target.yaw, 0, 'YXZ');
    return;
  }
  camera.position.set(playerState.position.x, playerState.position.y + playerState.eye, playerState.position.z);
  camera.rotation.set(playerState.pitch, playerState.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - playerState.position.x;
  const dy = point.y - (playerState.position.y + playerState.eye);
  const dz = point.z - playerState.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  playerState.yaw = Math.atan2(-dx, -dz);
  playerState.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function muzzleWorld(out) {
  camera.getWorldPosition(out);
  camera.getWorldDirection(direction);
  out.addScaledVector(direction, 0.6);
  out.y -= 0.12;
  return out;
}

function shoot(spread) {
  if (!weaponView.takeRound()) {
    audio.dryFire();
    return false;
  }
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const shootables = world.shootables.concat(bots.hitMeshes);
  const hit = raycaster.intersectObjects(shootables, false)[0];
  const from = muzzleWorld(new THREE.Vector3());
  if (hit) {
    effects.tracer(from, hit.point.clone());
    const bot = hit.object.userData.bot;
    if (bot && bot.alive) {
      const part = hit.object.userData.part || 'torso';
      const dist = hit.distance;
      const falloff = Math.max(0.6, 1 - dist / 160);
      const damage = weaponView.state.def.damage * (part === 'head' ? weaponView.state.def.headMult : 1) * falloff;
      const wasAlive = bot.hp > 0;
      bots.damageBot(bot, damage, part, 'player');
      hud.hitMarker(wasAlive && bot.hp <= 0, shot ? 4000 : 90);
      if (wasAlive && bot.hp > 0) audio.hit();
    } else if (hit.object.userData.bot) {
      // A dead bot's mesh: the ray still stops there, no damage.
    } else {
      effects.sparks(hit.point, hit.face ? hit.face.normal : new THREE.Vector3(0, 1, 0));
    }
  } else {
    effects.tracer(from, camera.position.clone().addScaledVector(direction, 60));
  }
  weaponView.pullTrigger();
  audio.shot(weaponView.state.def.sound);
  player.recoil(0.009 + weaponView.state.def.kick * 0.5 + random() * 0.004, (random() * 2 - 1) * 0.004);
  hud.setAmmo(weaponView.state.mag, weaponView.state.reserve, weaponView.state.def.name);
  bots.hearShot(camera.position, elapsed);
  return true;
}

function throwSelectedGrenade() {
  const kind = loadout.selected;
  if (kind !== 'he' && kind !== 'smoke') return;
  if (loadout.grenades[kind] <= 0) {
    audio.dryFire();
    return;
  }
  loadout.grenades[kind] -= 1;
  camera.getWorldDirection(direction);
  const origin = camera.position.clone().addScaledVector(direction, 0.5);
  origin.y -= 0.1;
  grenades.throwGrenade(origin, direction.clone(), kind, 'player');
  hud.setAmmo(loadout.grenades[kind], 0, kind === 'he' ? 'HE Grenade' : 'Smoke Grenade');
}

function grenadeDamage(center, radius, maxDamage) {
  // The player takes falloff damage from any HE, including their own.
  const dx = playerState.position.x - center.x;
  const dz = playerState.position.z - center.z;
  const dy = (playerState.position.y + 1) - center.y;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < radius && playerState.hp > 0 && match.state.phase === 'live') {
    host.damagePlayer(maxDamage * (1 - dist / radius), center, 'Viper');
  }
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const bdx = bot.pos.x - center.x;
    const bdz = bot.pos.z - center.z;
    const bdy = (bot.pos.y + 1) - center.y;
    const bdist = Math.hypot(bdx, bdy, bdz);
    if (bdist < radius) bots.damageBot(bot, maxDamage * (1 - bdist / radius), 'torso', 'player');
  }
}

function step(dt) {
  elapsed += dt;
  const phase = match.state.phase;
  if (phase === 'live' || phase === 'buy') {
    player.step(dt, input.state.keys);
  }
  weaponView.step(dt);
  bots.step(dt, elapsed);
  grenades.step(dt, grenadeDamage);
  effects.step(dt);
  match.step(dt, elapsed);

  // Weapon switching and reload work in buy and live phases.
  if (playerState.hp > 0 && (phase === 'live' || phase === 'buy')) {
    const slotKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'];
    const slotIds = ['pistol', 'smg', 'rifle', 'sniper', 'he', 'smoke'];
    for (let i = 0; i < slotKeys.length; i += 1) {
      if (input.wasPressed(slotKeys[i])) {
        const id = slotIds[i];
        const owned = id === 'pistol' || match.state.owned.has(id);
        if (owned) equipSelection(id);
        else audio.denied();
      }
    }
    if (input.wasPressed('KeyB') && phase === 'buy') {
      hud.showBuy(match.state.money, match.state.owned);
    }
    if (input.wasPressed('KeyR')) {
      if (weaponView.reload()) audio.reload();
    }
  }

  if (phase !== 'live' || playerState.hp <= 0) return;

  // Sniper scope: narrow the field of view and hide the viewmodel.
  const scoping = input.state.scoping && weaponView.state.def.scoped && weaponView.state.reloadLeft === 0;
  weaponView.state.scoping = scoping;
  const targetFov = scoping ? 26 : 74;
  if (Math.abs(camera.fov - targetFov) > 0.5) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14);
    camera.updateProjectionMatrix();
  }
  hud.setScope(scoping);

  // Bomb plant: hold E inside a site while carrying the bomb.
  const site = match.inSite(playerState.position);
  if (match.playerHasBomb() && site) {
    if (input.state.keys.has('KeyE')) {
      plantProgress += dt;
      hud.progress(plantProgress / match.plantSeconds);
      hud.prompt(`Planting the bomb at site ${site}…`);
      if (plantProgress >= match.plantSeconds) {
        match.plantBomb('player', playerState.position, site);
        plantProgress = 0;
        hud.progress(null);
        hud.prompt(null);
      }
    } else {
      plantProgress = 0;
      hud.progress(null);
      hud.prompt(`Hold <b>E</b> to plant the bomb at site ${site}`);
    }
  } else {
    if (plantProgress > 0) {
      plantProgress = 0;
      hud.progress(null);
    }
    if (match.state.bombPlanted) hud.prompt(null);
    else if (match.playerHasBomb()) hud.prompt(null);
    else hud.prompt(null);
  }

  // Crosshair spread follows movement and bloom.
  const spreadPx = 5 + weaponView.spread(player.groundSpeed()) * 900;
  hud.setCrosshairSpread(spreadPx);
  hud.setHealth(playerState.hp, Math.round(playerState.armour));
  hud.setPips(
    bots.aliveCount('van') + (playerState.hp > 0 ? 1 : 0),
    bots.aliveCount('emb'),
  );
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    const sensitivity = weaponView.state.scoping ? 0.0009 : 0.0022;
    player.look(look.x, look.y, sensitivity);
    const isGrenade = loadout.selected === 'he' || loadout.selected === 'smoke';
    if (input.state.firing && match.state.phase === 'live' && playerState.hp > 0) {
      if (isGrenade) {
        if (input.state.firing) {
          throwSelectedGrenade();
          input.state.firing = false;
        }
      } else if (weaponView.ready()) {
        shoot(shot ? 0 : weaponView.spread(player.groundSpeed()));
      }
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  match.startMatch();
  playerState.pitch = 0;
  playerState.yaw = 0;
  const vanBots = bots.bots.filter((b) => b.team === 'van');
  const embBots = bots.bots.filter((b) => b.team === 'emb');
  // Posed bots must not walk away while the frame settles.
  function holdBots() {
    for (const bot of bots.bots) {
      bot.mode = 'hold';
      bot.holdUntil = 999;
      bot.target = null;
      bot.frozen = true;
    }
  }

  if (name === 'start') {
    // Buy phase: the player at spawn, teammates ahead, buy menu open.
    player.reset(ATTACK_SPAWNS[2][0], ATTACK_SPAWNS[2][1], 0);
    vanBots[0].pos.set(-4, 0, 10);
    vanBots[1].pos.set(2, 0, 10);
    vanBots[0].yaw = 0;
    vanBots[1].yaw = 0;
    holdBots();
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -6));
    hud.showBuy(2400, new Set(['pistol', 'smg']));
    hud.setMoney(2400);
  } else if (name === 'play') {
    // Mid-round firefight on mid: two Ember bots ahead; the first falls to a headshot.
    match.beginLive();
    equipSelection('rifle');
    player.reset(0, 8, 0);
    embBots[0].pos.set(-4.5, 0, -4);
    embBots[0].yaw = Math.PI;
    embBots[1].pos.set(8, 0, -4);
    embBots[1].yaw = Math.PI;
    vanBots[0].pos.set(-3, 0, 6);
    vanBots[0].yaw = 0;
    holdBots();
    settle(20);
    const aim1 = new THREE.Vector3(embBots[0].pos.x, 1.55, embBots[0].pos.z);
    aimAt(aim1);
    shoot(0);
    settle(10);
    aimAt(new THREE.Vector3(embBots[1].pos.x, 1.55, embBots[1].pos.z));
    hud.setScore(0, 0, 1);
    hud.setAmmo(weaponView.state.mag, weaponView.state.reserve, 'AR-77 Longshot');
  } else if (name === 'plant') {
    // The bomb is down at site A; the player holds the angle.
    match.beginLive();
    equipSelection('rifle');
    player.reset(-10, -6, 0);
    match.plantBomb('player', new THREE.Vector3(-14, 0, -11), 'A');
    embBots[0].pos.set(-11, 0, -8);
    embBots[0].yaw = Math.PI;
    embBots[1].pos.set(-17, 0, -12);
    embBots[1].yaw = Math.PI;
    vanBots[0].pos.set(-12, 0, -7);
    vanBots[0].yaw = 0;
    holdBots();
    settle(20);
    aimAt(new THREE.Vector3(-11, 1.2, -8));
    hud.setScore(0, 0, 1);
  } else {
    // Round won: two Ember bots down in the open lane, banner up, score 1-0.
    match.beginLive();
    equipSelection('rifle');
    player.reset(0, 6, 0);
    embBots[0].pos.set(-3, 0, 2);
    embBots[0].alive = false;
    embBots[0].fall = 1;
    embBots[0].group.rotation.x = -1.5;
    embBots[1].pos.set(3.5, 0, 1);
    embBots[1].alive = false;
    embBots[1].fall = 1;
    embBots[1].group.rotation.x = -1.5;
    match.state.scoreVan = 1;
    holdBots();
    settle(20);
    aimAt(new THREE.Vector3(0, 1.0, -2));
    hud.banner('ROUND WON', 'Bomb detonated — 1 : 0', true);
    hud.setScore(1, 0, 1);
    hud.setPips(5, 3);
  }
  hud.setHealth(playerState.hp, Math.round(playerState.armour));
  hud.setAmmo(weaponView.state.mag, weaponView.state.reserve, weaponView.state.def.name);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
