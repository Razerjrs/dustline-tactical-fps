// The match: buy phase, live round, round end, next round. First to 7, at most 12
// rounds. Money is the player's alone — bots are paid by the fiction, not the ledger.
// The bomb is the objective: plant it and hold the site for 30 seconds, or defuse it.
// One place owns the clock, the score and the economy, so the round can never end
// two different ways at once.
import { WEAPONS, GRENADES } from './weapons.js';
import { SITES } from './world.js';

const WIN_SCORE = 7;
const MAX_ROUNDS = 12;
const BUY_SECONDS = 12;
const ROUND_SECONDS = 100;
const PLANT_SECONDS = 3;
const DEFUSE_SECONDS = 5;
const DETONATE_SECONDS = 30;
const WIN_MONEY = 3250;
const LOSS_MONEY = 1900;
const LOSS_STREAK_BONUS = 500;
const KILL_MONEY = 300;
const PLANT_MONEY = 300;

export function createMatch(deps) {
  const { hud, audio, bots, hooks } = deps;

  const state = {
    phase: 'menu', // menu | buy | live | end | over
    round: 1,
    scoreVan: 0,
    scoreEmb: 0,
    money: 800,
    owned: new Set(['pistol']),
    armour: 0,
    lossStreak: 0,
    roundTimeLeft: ROUND_SECONDS,
    buyTimeLeft: BUY_SECONDS,
    endTimeLeft: 0,
    bombPlanted: false,
    bombPos: null,
    bombSite: null,
    detonateIn: 0,
    beepAt: 0,
    playerKills: 0,
    playerDeaths: 0,
  };

  function pushHud() {
    hud.setScore(state.scoreVan, state.scoreEmb, state.round);
    hud.setMoney(state.money);
    hud.setPips(bots.aliveCount('van') + (hooks.playerAlive() ? 1 : 0), bots.aliveCount('emb'));
    hud.setBombStatus(state.bombPlanted ? `Bomb planted — ${Math.ceil(state.detonateIn)}s` : '');
  }

  function startMatch() {
    state.phase = 'buy';
    state.round = 1;
    state.scoreVan = 0;
    state.scoreEmb = 0;
    state.money = 800;
    state.owned = new Set(['pistol']);
    state.armour = 0;
    state.lossStreak = 0;
    state.playerKills = 0;
    state.playerDeaths = 0;
    startRound();
  }

  function startRound() {
    state.phase = 'buy';
    state.buyTimeLeft = BUY_SECONDS;
    state.roundTimeLeft = ROUND_SECONDS;
    state.bombPlanted = false;
    state.bombPos = null;
    state.bombSite = null;
    state.detonateIn = 0;
    hooks.resetRound(state.round);
    hud.banner(null);
    hud.progress(null);
    hud.prompt(null);
    hud.showBuy(state.money, state.owned);
    pushHud();
  }

  function beginLive() {
    if (state.phase !== 'buy') return;
    state.phase = 'live';
    hud.hideBuy();
    hud.prompt(null);
    pushHud();
  }

  function buy(itemId) {
    if (state.phase !== 'buy') return false;
    const def = WEAPONS[itemId] || GRENADES[itemId] || (itemId === 'armour' ? { id: 'armour', price: 650 } : null);
    if (!def) return false;
    if (state.owned.has(itemId)) return false;
    if (state.money < def.price) {
      audio.denied();
      return false;
    }
    state.money -= def.price;
    state.owned.add(itemId);
    if (itemId === 'armour') state.armour = 100;
    audio.buy();
    hooks.onBought(itemId);
    hud.showBuy(state.money, state.owned);
    hud.setMoney(state.money);
    return true;
  }

  function awardKill() {
    state.money += KILL_MONEY;
    state.playerKills += 1;
    hud.setMoney(state.money);
  }

  function plantBomb(by, pos, site) {
    if (state.bombPlanted || state.phase !== 'live') return false;
    state.bombPlanted = true;
    state.bombPos = pos.clone();
    state.bombSite = site;
    state.detonateIn = DETONATE_SECONDS;
    state.beepAt = 0;
    if (by === 'player') {
      state.money += PLANT_MONEY;
      hud.setMoney(state.money);
    }
    audio.plant();
    hud.setBombStatus(`Bomb planted — ${DETONATE_SECONDS}s`);
    hooks.onPlant(site);
    return true;
  }

  function defuseBomb() {
    if (!state.bombPlanted) return;
    state.bombPlanted = false;
    state.bombPos = null;
    audio.defuse();
    endRound('emb', 'Bomb defused');
  }

  function endRound(winner, reason) {
    if (state.phase === 'end' || state.phase === 'over') return;
    state.phase = 'end';
    state.endTimeLeft = 4.5;
    if (winner === 'van') {
      state.scoreVan += 1;
      state.money += WIN_MONEY;
      state.lossStreak = 0;
      audio.roundWin();
    } else {
      state.scoreEmb += 1;
      state.money += LOSS_MONEY + Math.min(1500, state.lossStreak * LOSS_STREAK_BONUS);
      state.lossStreak += 1;
      audio.roundLose();
    }
    hud.hideBuy();
    hud.progress(null);
    hud.prompt(null);
    pushHud();
    hooks.onRoundEnd(winner, reason, state.scoreVan, state.scoreEmb);
  }

  function nextRound() {
    if (state.scoreVan >= WIN_SCORE || state.scoreEmb >= WIN_SCORE || state.round >= MAX_ROUNDS) {
      state.phase = 'over';
      const result = state.scoreVan > state.scoreEmb ? 'van' : state.scoreEmb > state.scoreVan ? 'emb' : 'draw';
      hooks.onMatchEnd(result, state.scoreVan, state.scoreEmb);
      return;
    }
    state.round += 1;
    startRound();
  }

  function step(dt, time) {
    if (state.phase === 'buy') {
      state.buyTimeLeft -= dt;
      hud.setTimer(state.buyTimeLeft);
      if (state.buyTimeLeft <= 0) beginLive();
      return;
    }
    if (state.phase === 'live') {
      if (!state.bombPlanted) {
        state.roundTimeLeft -= dt;
        hud.setTimer(state.roundTimeLeft);
        if (state.roundTimeLeft <= 0) {
          endRound('emb', 'Time expired — site held');
          return;
        }
      } else {
        state.detonateIn -= dt;
        hud.setTimer(state.detonateIn);
        hud.setBombStatus(`Bomb planted — ${Math.ceil(state.detonateIn)}s`);
        state.beepAt -= dt;
        if (state.beepAt <= 0) {
          state.beepAt = state.detonateIn < 10 ? 0.5 : 1;
          audio.beep(state.detonateIn < 5);
        }
        if (state.detonateIn <= 0) {
          hooks.onDetonate(state.bombPos);
          endRound('van', 'Bomb detonated');
          return;
        }
      }
      // Elimination decides the round — unless the bomb is planted and the
      // attackers are all dead, in which case the defuse clock decides it.
      const vanAlive = bots.aliveCount('van') + (hooks.playerAlive() ? 1 : 0);
      const embAlive = bots.aliveCount('emb');
      if (vanAlive === 0 && !state.bombPlanted) endRound('emb', 'Vanguard eliminated');
      else if (embAlive === 0 && !state.bombPlanted) endRound('van', 'Ember eliminated');
      else if (embAlive === 0 && state.bombPlanted) {
        // Nobody left to defuse: the bomb will decide it.
      }
      pushHud();
      return;
    }
    if (state.phase === 'end') {
      state.endTimeLeft -= dt;
      if (state.endTimeLeft <= 0) nextRound();
    }
  }

  return {
    state,
    startMatch,
    startRound,
    beginLive,
    buy,
    awardKill,
    plantBomb,
    defuseBomb,
    endRound,
    step,
    plantSeconds: PLANT_SECONDS,
    defuseSeconds: DEFUSE_SECONDS,
    inSite(pos) {
      for (const key of ['A', 'B']) {
        const site = SITES[key];
        const dx = pos.x - site.center.x;
        const dz = pos.z - site.center.z;
        if (dx * dx + dz * dz < site.radius * site.radius) return key;
      }
      return null;
    },
    playerHasBomb() {
      return hooks.playerAlive() && !state.bombPlanted && !bots.carrier();
    },
  };
}
