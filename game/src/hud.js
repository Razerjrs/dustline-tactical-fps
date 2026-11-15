// The DOM HUD: health, ammo, money, timer, score, kill feed, buy menu, banners.
// It never touches the simulation; main.js and match.js push numbers in and read
// button clicks out. Every setter caches its last value so the DOM is only touched
// when something actually changes.
import { WEAPONS, GRENADES } from './weapons.js';

const COPY = {
  start: {
    title: 'DUSTLINE',
    copy: 'A tactical strike on Kestrel Yard. Five on five, two bombsites, one bomb. Plant it, or stop them planting it.',
    action: 'Click to play',
  },
  paused: {
    title: 'DUSTLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  end: {
    title: 'Match over',
    copy: 'The yard is quiet again.',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammo = $('ammo');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const hpNum = $('hp-num');
  const hpFill = $('hp-fill');
  const armorEl = $('armor');
  const moneyValue = $('money-value');
  const timerEl = $('timer');
  const scoreVan = $('score-van');
  const scoreEmb = $('score-emb');
  const pipsVan = $('pips-van');
  const pipsEmb = $('pips-emb');
  const roundLabel = $('round-label');
  const bombStatus = $('bomb-status');
  const feed = $('feed');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const damageEl = $('damage');
  const scopeEl = $('scope');
  const promptEl = $('prompt');
  const progressEl = $('progress');
  const progressFill = $('progress-fill');
  const bannerEl = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const buyEl = $('buy');
  const buyGrid = $('buy-grid');
  const buyMoney = $('buy-money');
  const damageFlash = $('damage');

  let lastMag = -1;
  let lastReserve = -1;
  let lastHp = -1;
  let lastMoney = -1;
  let lastTimer = '';
  let lastScore = '';
  let lastPips = '';
  let lastWeapon = '';
  let hitTimer = 0;
  let damageTimer = 0;

  const BUYABLES = [
    { key: '2', def: WEAPONS.smg, desc: 'Fast, close quarters' },
    { key: '3', def: WEAPONS.rifle, desc: 'Accurate, all ranges' },
    { key: '4', def: WEAPONS.sniper, desc: 'One shot, long range' },
    { key: '5', def: GRENADES.he, desc: 'Blast damage, 6.5 m' },
    { key: '6', def: GRENADES.smoke, desc: 'Blocks sight, 13 s' },
    { key: '0', def: { id: 'armour', name: 'Kevlar Armour', price: 650, desc: 'Halves bullet damage' }, desc: 'Halves bullet damage' },
  ];

  let buyHandler = null;
  for (const item of BUYABLES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'buy-item';
    button.dataset.id = item.def.id;
    button.innerHTML = `<span class="key">${item.key}</span><span class="nm"><b></b><span></span></span><span class="price"></span>`;
    button.querySelector('b').textContent = item.def.name;
    button.querySelector('.nm span').textContent = item.desc;
    button.querySelector('.price').textContent = `$${item.def.price}`;
    button.addEventListener('click', () => { if (buyHandler) buyHandler(item.def.id); });
    buyGrid.appendChild(button);
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return {
    setAmmo(mag, reserve, name) {
      if (mag !== lastMag || reserve !== lastReserve) {
        lastMag = mag;
        lastReserve = reserve;
        ammoMag.textContent = String(mag);
        ammoReserve.textContent = `/ ${reserve}`;
        ammo.classList.toggle('empty', mag === 0);
      }
      if (name && name !== lastWeapon) {
        lastWeapon = name;
        weaponName.textContent = name;
      }
    },
    setHealth(hp, armour) {
      const shown = Math.max(0, Math.ceil(hp));
      if (shown !== lastHp) {
        lastHp = shown;
        hpNum.textContent = String(shown);
        hpNum.classList.toggle('low', shown <= 30);
        hpFill.style.width = `${Math.max(0, Math.min(100, shown))}%`;
        hpFill.classList.toggle('low', shown <= 30);
        damageEl.classList.toggle('low', shown <= 30 && shown > 0);
      }
      armorEl.textContent = `Armour ${armour}`;
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyValue.textContent = `$${value}`;
      buyMoney.textContent = `$${value}`;
    },
    setTimer(seconds) {
      const text = formatTime(seconds);
      if (text === lastTimer) return;
      lastTimer = text;
      timerEl.textContent = text;
      timerEl.classList.toggle('low', seconds <= 15 && seconds > 0);
    },
    setScore(van, emb, round) {
      const key = `${van}-${emb}-${round}`;
      if (key === lastScore) return;
      lastScore = key;
      scoreVan.textContent = String(van);
      scoreEmb.textContent = String(emb);
      roundLabel.textContent = `ROUND ${round}`;
    },
    setPips(van, emb) {
      const key = `${van}|${emb}`;
      if (key === lastPips) return;
      lastPips = key;
      pipsVan.textContent = String(van);
      pipsEmb.textContent = String(emb);
    },
    setBombStatus(text) {
      bombStatus.textContent = text;
    },
    setCrosshairSpread(px) {
      crosshair.style.setProperty('--gap', `${Math.round(px)}px`);
    },
    setScope(on) {
      scopeEl.classList.toggle('on', on);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.3)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    damageFlash() {
      damageFlash.style.opacity = '1';
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => { damageFlash.style.opacity = '0'; }, 130);
    },
    killfeed(killerName, killerTeam, victimName, victimTeam, weaponName) {
      const div = document.createElement('div');
      div.innerHTML = `<span class="${killerTeam}"></span> <span class="w">▸</span> <span class="${victimTeam}"></span> <span class="w"></span>`;
      div.children[0].textContent = killerName;
      div.children[2].textContent = victimName;
      div.children[3].textContent = weaponName ? `[${weaponName}]` : '';
      feed.prepend(div);
      while (feed.children.length > 5) feed.removeChild(feed.lastChild);
      setTimeout(() => { if (div.parentNode) div.remove(); }, 6000);
    },
    prompt(text) {
      if (text) {
        promptEl.innerHTML = '';
        promptEl.textContent = text;
        promptEl.classList.add('on');
      } else {
        promptEl.classList.remove('on');
      }
    },
    progress(frac) {
      if (frac === null) {
        progressEl.classList.remove('on');
        return;
      }
      progressEl.classList.add('on');
      progressFill.style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
    },
    banner(text, sub, win) {
      if (!text) {
        bannerEl.classList.remove('on');
        return;
      }
      bannerTitle.textContent = text;
      bannerTitle.className = win === true ? 'win' : win === false ? 'lose' : '';
      bannerSub.textContent = sub || '';
      bannerEl.classList.add('on');
    },
    showBuy(money, owned) {
      buyMoney.textContent = `$${money}`;
      for (const button of buyGrid.children) {
        const id = button.dataset.id;
        const item = BUYABLES.find((b) => b.def.id === id);
        const isOwned = owned.has(id);
        const afford = money >= item.def.price;
        button.disabled = isOwned || !afford;
        button.classList.toggle('owned', isOwned);
      }
      buyEl.classList.add('on');
    },
    hideBuy() {
      buyEl.classList.remove('on');
    },
    onBuy(handler) {
      buyHandler = handler;
    },
    showOverlay(mode, score) {
      const text = COPY[mode];
      title.innerHTML = mode === 'start' ? 'DUST<span class="amber">LINE</span>' : text.title;
      copy.textContent = mode === 'end' ? `${text.copy} Final score ${score}.` : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
