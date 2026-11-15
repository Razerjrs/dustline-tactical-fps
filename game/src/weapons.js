// The arsenal. Each weapon owns its numbers: damage (body/head), fire rate, spread
// standing still vs moving, magazine, reload, price. Accuracy counts more than speed:
// spread grows with movement and with sustained fire, and the sniper is nearly useless
// on the move. main.js owns the ray and the damage; this module owns the feel.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0, slot: 1,
    damage: 26, headMult: 3, fireGap: 0.16, auto: false,
    spreadStill: 0.004, spreadMove: 0.02, bloom: 0.004,
    mag: 12, reserve: 24, reloadTime: 1.3, sound: 'pistol',
    range: 60, kick: 0.006,
  },
  smg: {
    id: 'smg', name: 'VK-9 Ripper', price: 1500, slot: 2,
    damage: 22, headMult: 3, fireGap: 0.075, auto: true,
    spreadStill: 0.006, spreadMove: 0.03, bloom: 0.005,
    mag: 30, reserve: 90, reloadTime: 1.8, sound: 'smg',
    range: 50, kick: 0.005,
  },
  rifle: {
    id: 'rifle', name: 'AR-77 Longshot', price: 2700, slot: 3,
    damage: 34, headMult: 4, fireGap: 0.1, auto: true,
    spreadStill: 0.0022, spreadMove: 0.028, bloom: 0.0035,
    mag: 30, reserve: 90, reloadTime: 2.1, sound: 'rifle',
    range: 80, kick: 0.009,
  },
  sniper: {
    id: 'sniper', name: 'LW-50 Hawkeye', price: 4750, slot: 4,
    damage: 92, headMult: 4, fireGap: 1.25, auto: false,
    spreadStill: 0.0004, spreadMove: 0.09, bloom: 0.02,
    mag: 5, reserve: 15, reloadTime: 3.0, sound: 'sniper',
    range: 120, kick: 0.03, scoped: true,
  },
};

export const GRENADES = {
  he: { id: 'he', name: 'HE Grenade', price: 300, slot: 5, radius: 6.5, damage: 110 },
  smoke: { id: 'smoke', name: 'Smoke Grenade', price: 300, slot: 6, radius: 4.5, duration: 13 },
};

const MUZZLE_TIME = 0.06;

export function createWeaponView(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#20242a'), roughness: 0.55, metalness: 0.4 });

  // One viewmodel rebuilt per weapon: a receiver, a barrel, a stock, a sight.
  const model = new THREE.Group();
  model.scale.set(0.65, 0.65, 0.65);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  model.position.set(0.27, -0.25, -0.5);
  camera.add(model);
  flash.position.set(0.27, -0.23, -1.0);
  flash.visible = false;
  camera.add(flash);
  flashLight.position.set(0.27, -0.21, -0.7);
  camera.add(flashLight);

  const state = {
    def: WEAPONS.pistol,
    mag: WEAPONS.pistol.mag,
    reserve: WEAPONS.pistol.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    bloom: 0,
    scoping: false,
  };
  let builtFor = null;

  function buildModel(def) {
    while (model.children.length) model.remove(model.children[0]);
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), grip);
    barrel.position.set(0, 0.025, -0.38);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
    stock.position.set(0, -0.02, 0.3);
    model.add(receiver, barrel, stock);
    if (def.id === 'sniper') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10), dark);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.09, -0.05);
      const longBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.62), grip);
      longBarrel.position.set(0, 0.025, -0.5);
      model.add(scope, longBarrel);
    } else if (def.id === 'smg') {
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.07), dark);
      mag.position.set(0, -0.14, -0.08);
      model.add(mag);
    } else if (def.id === 'pistol') {
      const slide = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.3), dark);
      slide.position.set(0, 0.04, -0.1);
      model.add(slide);
    }
    builtFor = def.id;
  }

  function equip(def, mag = null, reserve = null) {
    state.def = def;
    state.mag = mag === null ? def.mag : mag;
    state.reserve = reserve === null ? def.reserve : reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.flash = 0;
    state.kick = 0;
    state.bloom = 0;
    buildModel(def);
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.bloom = Math.max(0, state.bloom - dt * 0.02);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const scoped = state.scoping && state.def.scoped;
    model.position.z = -0.5 + state.kick;
    model.position.x = scoped ? 0 : 0.27;
    model.position.y = scoped ? -0.19 : -0.25;
    model.rotation.x = state.kick * 2.2;
    model.visible = !scoped;
    flash.visible = state.flash > 0 && !scoped;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (state.def.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = state.def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    step,
    equip,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = state.def.fireGap;
      state.flash = MUZZLE_TIME;
      state.kick = 0.05 + state.def.kick;
      state.bloom = Math.min(0.03, state.bloom + state.def.bloom);
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === state.def.mag || state.reserve === 0) return false;
      state.reloadLeft = state.def.reloadTime;
      return true;
    },
    spread(speed) {
      const moving = Math.min(1, speed / 5.4);
      const base = state.def.spreadStill + moving * state.def.spreadMove;
      const scoped = state.scoping && state.def.scoped;
      return (base + state.bloom) * (scoped ? 0.25 : 1);
    },
    refillAmmo() {
      state.mag = state.def.mag;
      state.reserve = state.def.reserve;
    },
  };
}
