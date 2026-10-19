(() => {
  "use strict";

  const MAX_DICE = 6;
  const STORAGE_KEY = "roll-club-v1";
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");

  const FACE_ROTATIONS = {
    1: { x: 0, y: 0 },
    2: { x: -90, y: 0 },
    3: { x: 0, y: -90 },
    4: { x: 0, y: 90 },
    5: { x: 90, y: 0 },
    6: { x: 0, y: 180 }
  };

  /*
   * This must stay in sync with .die-camera in styles.css.
   * The outer camera angle shows the selected face plus the top and right
   * faces, like a die photographed on a table.
   */
  const VIEW_ROTATION = { x: -20, y: -18, z: 0 };

  const FACE_NORMALS = {
    front: [0, 0, 1],
    back: [0, 0, -1],
    right: [1, 0, 0],
    left: [-1, 0, 0],
    top: [0, -1, 0],
    bottom: [0, 1, 0]
  };

  const LIGHT_DIRECTION = normalizeVector([-0.35, -0.65, 0.72]);

  const FACE_LAYOUT = [
    ["front", 1],
    ["back", 6],
    ["right", 3],
    ["left", 4],
    ["top", 2],
    ["bottom", 5]
  ];

  const PIPS = {
    1: [[2, 2]],
    2: [[1, 1], [3, 3]],
    3: [[1, 1], [2, 2], [3, 3]],
    4: [[1, 1], [1, 3], [3, 1], [3, 3]],
    5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
    6: [[1, 1], [1, 3], [2, 1], [2, 3], [3, 1], [3, 3]]
  };

  const SINGLE_DIE_QUIPS = {
    1: "A humble start. The only way is up.",
    2: "A cautious little roll.",
    3: "Things are looking up.",
    4: "A solid four. Nicely done.",
    5: "So close to perfection.",
    6: "Maximum luck. Take a bow."
  };

  const elements = {
    tableCard: document.querySelector(".table-card"),
    fullscreenBtn: document.getElementById("fullscreenBtn"),
    diceStage: document.getElementById("diceStage"),
    diceSet: document.getElementById("diceSet"),
    total: document.getElementById("total"),
    breakdown: document.getElementById("breakdown"),
    status: document.getElementById("status"),
    statusText: document.getElementById("statusText"),
    rollBtn: document.getElementById("rollBtn"),
    rollLabel: document.getElementById("rollLabel"),
    decreaseBtn: document.getElementById("decreaseBtn"),
    increaseBtn: document.getElementById("increaseBtn"),
    diceNumber: document.getElementById("diceNumber"),
    diceWord: document.getElementById("diceWord"),
    soundToggle: document.getElementById("soundToggle"),
    resetBtn: document.getElementById("resetBtn"),
    history: document.getElementById("history"),
    historyCount: document.getElementById("historyCount"),
    statRolls: document.getElementById("statRolls"),
    statAverage: document.getElementById("statAverage"),
    statHigh: document.getElementById("statHigh"),
    toast: document.getElementById("toast"),
    liveRegion: document.getElementById("liveRegion")
  };

  const state = {
    dice: 1,
    history: [],
    sound: true,
    rolling: false,
    rollSerial: 0,
    fauxFullscreen: false,
    fullscreenAttempt: 0
  };

  let enterTimer = null;
  let statusTimer = null;
  let toastTimer = null;
  let fullscreenTimer = null;
  let audioContext = null;
  const randomBuffer = new Uint32Array(1);

  /* Storage */

  function loadSession() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") return;

      if (Number.isInteger(saved.dice)) {
        state.dice = clamp(saved.dice, 1, MAX_DICE);
      }

      if (typeof saved.sound === "boolean") {
        state.sound = saved.sound;
      }

      if (Array.isArray(saved.history)) {
        state.history = saved.history
          .map(normalizeRoll)
          .filter(Boolean)
          .slice(0, 100);
      }
    } catch (error) {
      // A blocked or unavailable storage API should never stop the dice.
    }
  }

  function normalizeRoll(roll) {
    if (!roll || !Array.isArray(roll.values)) return null;

    const values = roll.values
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 6)
      .slice(0, MAX_DICE);

    if (values.length === 0) return null;

    return {
      values,
      total: values.reduce((sum, value) => sum + value, 0),
      time: Number.isFinite(roll.time) ? roll.time : Date.now()
    };
  }

  function saveSession() {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          dice: state.dice,
          sound: state.sound,
          history: state.history
        })
      );
    } catch (error) {
      // The app still works perfectly well without persistence.
    }
  }

  /* Utilities */

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function randomInt(maxExclusive) {
    if (
      window.crypto &&
      typeof window.crypto.getRandomValues === "function"
    ) {
      const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
      do {
        window.crypto.getRandomValues(randomBuffer);
      } while (randomBuffer[0] >= limit);

      return randomBuffer[0] % maxExclusive;
    }

    return Math.floor(Math.random() * maxExclusive);
  }

  function rollOne() {
    return randomInt(6) + 1;
  }

  function randomTilt() {
    return randomInt(13) - 6;
  }

  function dieTransform(value, spins, tilt) {
    const target = FACE_ROTATIONS[value];
    const rotateX = target.x + spins.x * 360;
    const rotateY = target.y + spins.y * 360;
    const rotateZ = spins.z * 360 + tilt;

    return `rotateX(${rotateX}deg) rotateY(${rotateY}deg) rotateZ(${rotateZ}deg)`;
  }

  function normalizeVector([x, y, z]) {
    const length = Math.hypot(x, y, z) || 1;
    return [x / length, y / length, z / length];
  }

  /*
   * CSS applies transform functions from right to left to the local vector,
   * so rotateZ is applied first, then rotateY, then rotateX.
   */
  function rotateVector([x, y, z], rotations) {
    const rad = Math.PI / 180;
    const cx = Math.cos(rotations.x * rad);
    const sx = Math.sin(rotations.x * rad);
    const cy = Math.cos(rotations.y * rad);
    const sy = Math.sin(rotations.y * rad);
    const cz = Math.cos(rotations.z * rad);
    const sz = Math.sin(rotations.z * rad);

    let rotatedX = x * cz - y * sz;
    let rotatedY = x * sz + y * cz;
    let rotatedZ = z;

    const yawedX = rotatedX * cy + rotatedZ * sy;
    rotatedZ = -rotatedX * sy + rotatedZ * cy;
    rotatedX = yawedX;

    const pitchedY = rotatedY * cx - rotatedZ * sx;
    rotatedZ = rotatedY * sx + rotatedZ * cx;
    rotatedY = pitchedY;

    return [rotatedX, rotatedY, rotatedZ];
  }

  function updateFaceShading(die, value) {
    const tilt = Number(die.dataset.tiltZ) || 0;
    const target = FACE_ROTATIONS[value];

    die.querySelectorAll(".die-face").forEach((face) => {
      const normal = FACE_NORMALS[face.dataset.position];
      if (!normal) return;

      const cubeNormal = rotateVector(normal, {
        x: target.x,
        y: target.y,
        z: tilt
      });
      const viewNormal = rotateVector(cubeNormal, VIEW_ROTATION);
      const light =
        viewNormal[0] * LIGHT_DIRECTION[0] +
        viewNormal[1] * LIGHT_DIRECTION[1] +
        viewNormal[2] * LIGHT_DIRECTION[2];

      const shade = clamp(0.2 - Math.max(0, light) * 0.19, 0.015, 0.2);
      face.style.setProperty("--face-shade", shade.toFixed(3));
    });
  }

  /* Dice rendering */

  function createDie(index) {
    const slot = document.createElement("div");
    slot.className = "die-slot";
    slot.style.setProperty("--i", String(index));

    const shadow = document.createElement("div");
    shadow.className = "die-shadow";

    const hop = document.createElement("div");
    hop.className = "die-hop";

    const camera = document.createElement("div");
    camera.className = "die-camera";

    const die = document.createElement("div");
    die.className = "die";

    FACE_LAYOUT.forEach(([position, value]) => {
      const face = document.createElement("div");
      face.className = `die-face face-${position}`;
      face.dataset.value = String(value);
      face.dataset.position = position;

      PIPS[value].forEach(([row, column]) => {
        const pip = document.createElement("span");
        pip.className = "pip";
        pip.style.gridRow = String(row);
        pip.style.gridColumn = String(column);
        face.appendChild(pip);
      });

      die.appendChild(face);
    });

    const tilt = randomTilt();
    die.dataset.tiltZ = String(tilt);
    die.style.transform = dieTransform(1, { x: 0, y: 0, z: 0 }, tilt);
    updateFaceShading(die, 1);

    camera.appendChild(die);
    hop.appendChild(camera);
    slot.append(shadow, hop);

    return { slot, die };
  }

  function renderDice(count) {
    window.clearTimeout(enterTimer);
    elements.diceStage.classList.remove("is-entering");
    elements.diceStage.dataset.count = String(count);
    elements.diceSet.replaceChildren();

    const fragment = document.createDocumentFragment();

    for (let index = 0; index < count; index += 1) {
      const { slot } = createDie(index);
      fragment.appendChild(slot);
    }

    elements.diceSet.appendChild(fragment);

    // Force a style read so the entrance animation reliably restarts.
    void elements.diceStage.offsetWidth;
    elements.diceStage.classList.add("is-entering");

    enterTimer = window.setTimeout(() => {
      elements.diceStage.classList.remove("is-entering");
    }, 920);
  }

  /* Interface updates */

  function updateCountUI() {
    elements.diceNumber.textContent = String(state.dice);
    elements.diceWord.textContent = state.dice === 1 ? "die" : "dice";
    elements.decreaseBtn.disabled = state.rolling || state.dice <= 1;
    elements.increaseBtn.disabled = state.rolling || state.dice >= MAX_DICE;
  }

  function updateSoundUI() {
    elements.soundToggle.classList.toggle("is-muted", !state.sound);
    elements.soundToggle.setAttribute("aria-pressed", String(state.sound));
    elements.soundToggle.setAttribute(
      "aria-label",
      state.sound ? "Mute sound effects" : "Enable sound effects"
    );
  }

  function setStatus(kind, label) {
    elements.status.dataset.state = kind;
    elements.statusText.textContent = label;
  }

  function resetReadout(message) {
    elements.total.classList.remove("pop");
    elements.total.textContent = "\u2014";
    elements.breakdown.textContent = message || "Your roll will land here.";
  }

  function setControlsLocked(locked) {
    elements.rollBtn.disabled = locked;
    elements.resetBtn.disabled = locked;
    elements.decreaseBtn.disabled = locked || state.dice <= 1;
    elements.increaseBtn.disabled = locked || state.dice >= MAX_DICE;
  }

  function bumpStats() {
    [elements.statRolls, elements.statAverage, elements.statHigh].forEach((stat) => {
      stat.classList.remove("bump");
      void stat.offsetWidth;
      stat.classList.add("bump");
    });
  }

  /* Stats + history */

  function updateStats(animate) {
    const count = state.history.length;

    if (count === 0) {
      elements.statRolls.textContent = "0";
      elements.statAverage.textContent = "\u2014";
      elements.statHigh.textContent = "\u2014";
    } else {
      let sum = 0;
      let high = 0;

      state.history.forEach((roll) => {
        sum += roll.total;
        high = Math.max(high, roll.total);
      });

      const average = sum / count;
      elements.statRolls.textContent = String(count);
      elements.statAverage.textContent = Number.isInteger(average)
        ? String(average)
        : average.toFixed(1);
      elements.statHigh.textContent = String(high);
    }

    if (animate) bumpStats();
  }

  function renderHistory(animateNewest) {
    elements.historyCount.textContent = String(state.history.length);

    if (state.history.length === 0) {
      elements.history.innerHTML = `
        <div class="empty-history">
          <span class="empty-die" aria-hidden="true"><span></span><span></span><span></span></span>
          <p>Nothing yet.</p>
          <span>Your rolls will land here.</span>
        </div>
      `;
      return;
    }

    const list = document.createElement("ol");
    list.className = "roll-list";

    state.history.forEach((roll, index) => {
      const item = document.createElement("li");
      item.className = "roll-item";

      if (animateNewest && index === 0) {
        item.classList.add("is-new");
      }

      if (roll.time) {
        item.title = `Rolled at ${new Date(roll.time).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit"
        })}`;
      }

      const number = document.createElement("span");
      number.className = "roll-index";
      number.textContent = String(state.history.length - index).padStart(2, "0");

      const values = document.createElement("span");
      values.className = "roll-values";

      roll.values.forEach((value) => {
        const miniDie = document.createElement("span");
        miniDie.className = "mini-die";
        miniDie.dataset.value = String(value);
        miniDie.textContent = String(value);
        values.appendChild(miniDie);
      });

      const total = document.createElement("span");
      total.className = "roll-total";
      total.textContent = String(roll.total);

      item.append(number, values, total);
      list.appendChild(item);
    });

    elements.history.replaceChildren(list);
  }

  function addRoll(values, total) {
    state.history.unshift({
      values,
      total,
      time: Date.now()
    });

    state.history = state.history.slice(0, 100);
    saveSession();
    renderHistory(true);
    updateStats(true);
  }

  /* Sound */

  function getAudioContext() {
    if (audioContext) {
      if (audioContext.state === "suspended") {
        audioContext.resume().catch(() => {});
      }
      return audioContext;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    try {
      audioContext = new AudioContextClass();
      if (audioContext.state === "suspended") {
        audioContext.resume().catch(() => {});
      }
      return audioContext;
    } catch (error) {
      return null;
    }
  }

  function playRollSound() {
    if (!state.sound) return;

    const context = getAudioContext();
    if (!context) return;

    const now = context.currentTime;
    const tapLength = 0.085;
    const frameCount = Math.max(1, Math.floor(context.sampleRate * tapLength));
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const data = buffer.getChannelData(0);

    for (let index = 0; index < frameCount; index += 1) {
      const envelope = Math.pow(1 - index / frameCount, 2.4);
      data[index] = (Math.random() * 2 - 1) * envelope;
    }

    const tapCount = REDUCED_MOTION.matches ? 3 : 7;
    const tapSpacing = REDUCED_MOTION.matches ? 0.06 : 0.085;

    for (let index = 0; index < tapCount; index += 1) {
      const startAt = now + 0.01 + index * tapSpacing + Math.random() * 0.025;
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();

      source.buffer = buffer;
      filter.type = "bandpass";
      filter.frequency.value = 650 + Math.random() * 850;
      filter.Q.value = 1.15;

      const level = 0.045 + Math.random() * 0.04;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(level, startAt + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + tapLength);

      source.connect(filter).connect(gain).connect(context.destination);
      source.start(startAt);
      source.stop(startAt + tapLength + 0.02);
    }

    if (!REDUCED_MOTION.matches) {
      const landAt = now + 1.02;
      const thump = context.createOscillator();
      const thumpGain = context.createGain();

      thump.type = "sine";
      thump.frequency.setValueAtTime(145, landAt);
      thump.frequency.exponentialRampToValueAtTime(62, landAt + 0.11);

      thumpGain.gain.setValueAtTime(0.0001, landAt);
      thumpGain.gain.exponentialRampToValueAtTime(0.055, landAt + 0.008);
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, landAt + 0.16);

      thump.connect(thumpGain).connect(context.destination);
      thump.start(landAt);
      thump.stop(landAt + 0.18);
    }
  }

  function playToggleTick() {
    const context = getAudioContext();
    if (!context) return;

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(540, now);
    oscillator.frequency.exponentialRampToValueAtTime(760, now + 0.05);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.035, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);

    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.08);
  }

  /* Toast */

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");

    toastTimer = window.setTimeout(() => {
      elements.toast.classList.remove("is-visible");
    }, 2400);
  }

  /* Actions */

  function setDiceCount(count) {
    if (state.rolling) return;

    state.dice = clamp(count, 1, MAX_DICE);
    updateCountUI();
    renderDice(state.dice);
    resetReadout(
      state.history.length > 0 ? "Ready for another roll." : "Your roll will land here."
    );
    setStatus("ready", "Ready");
    elements.rollLabel.textContent = "Roll dice";
    saveSession();
  }

  function rollDice() {
    if (state.rolling) return;

    state.rolling = true;
    window.clearTimeout(statusTimer);
    state.rollSerial += 1;
    const currentRoll = state.rollSerial;

    const values = Array.from({ length: state.dice }, rollOne);
    const total = values.reduce((sum, value) => sum + value, 0);

    setControlsLocked(true);
    elements.rollBtn.classList.add("is-rolling");
    elements.rollLabel.textContent = "Rolling\u2026";
    elements.diceStage.classList.remove("is-entering");
    elements.diceStage.classList.add("is-rolling");
    setStatus("rolling", "Rolling");
    elements.total.classList.remove("pop");
    elements.total.textContent = "\u2026";
    elements.breakdown.textContent = "The dice are in the air.";
    elements.liveRegion.textContent = "Rolling the dice.";

    playRollSound();

    const dice = Array.from(elements.diceSet.querySelectorAll(".die"));

    dice.forEach((die, index) => {
      const spins = {
        x: 2 + randomInt(2),
        y: 2 + randomInt(2),
        z: 1 + randomInt(2)
      };
      const tilt = randomTilt();

      die.dataset.tiltZ = String(tilt);
      die.style.transitionDelay = REDUCED_MOTION.matches
        ? "0ms"
        : `${index * 45}ms`;
      die.style.transform = dieTransform(values[index], spins, tilt);
    });

    const settleTime = REDUCED_MOTION.matches
      ? 140
      : 1040 + (state.dice - 1) * 45;

    window.setTimeout(() => {
      if (currentRoll !== state.rollSerial || !state.rolling) return;
      finishRoll(values, total);
    }, settleTime);
  }

  function finishRoll(values, total) {
    state.rolling = false;
    elements.diceStage.classList.remove("is-rolling");
    elements.rollBtn.classList.remove("is-rolling");
    elements.rollLabel.textContent = "Roll again";
    setControlsLocked(false);

    Array.from(elements.diceSet.querySelectorAll(".die")).forEach((die, index) => {
      updateFaceShading(die, values[index]);
    });

    elements.total.textContent = String(total);
    void elements.total.offsetWidth;
    elements.total.classList.add("pop");
    elements.breakdown.textContent =
      values.length === 1
        ? SINGLE_DIE_QUIPS[total]
        : `${values.join(" + ")} = ${total}`;

    setStatus("landed", "Landed");
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      if (!state.rolling) setStatus("ready", "Ready");
    }, 1500);

    elements.liveRegion.textContent =
      values.length === 1
        ? `You rolled a ${total}.`
        : `You rolled ${values.join(", ")}. Total ${total}.`;

    addRoll(values, total);
  }

  function resetSession() {
    if (state.rolling) return;

    state.history = [];
    state.dice = 1;
    state.rollSerial += 1;
    saveSession();

    updateCountUI();
    renderDice(state.dice);
    resetReadout("Your roll will land here.");
    setStatus("ready", "Ready");
    elements.rollLabel.textContent = "Roll dice";
    elements.liveRegion.textContent = "Session cleared.";
    renderHistory(false);
    updateStats(false);
    showToast("Session cleared. Roll away.");
  }

  function toggleSound() {
    state.sound = !state.sound;
    updateSoundUI();
    saveSession();

    if (state.sound) {
      playToggleTick();
    }
  }

  /* Full screen */

  function isNativeFullscreen() {
    return (
      document.fullscreenElement === elements.tableCard ||
      document.webkitFullscreenElement === elements.tableCard
    );
  }

  function updateFullscreenUI(active) {
    elements.tableCard.classList.toggle("is-fullscreen", active);
    elements.fullscreenBtn.classList.toggle("is-active", active);
    elements.fullscreenBtn.setAttribute("aria-pressed", String(active));
    elements.fullscreenBtn.setAttribute(
      "aria-label",
      active ? "Exit full screen" : "Enter full screen"
    );
    elements.fullscreenBtn.title = active ? "Exit full screen" : "Full screen";
  }

  function enterFallbackFullscreen() {
    window.clearTimeout(fullscreenTimer);
    fullscreenTimer = null;
    state.fauxFullscreen = true;
    elements.tableCard.classList.add("is-faux-fullscreen");
    document.body.classList.add("fullscreen-open");
    updateFullscreenUI(true);
  }

  function exitFallbackFullscreen() {
    window.clearTimeout(fullscreenTimer);
    fullscreenTimer = null;
    state.fauxFullscreen = false;
    elements.tableCard.classList.remove("is-faux-fullscreen");
    document.body.classList.remove("fullscreen-open");
    updateFullscreenUI(false);
  }

  function exitNativeFullscreen() {
    const exit =
      document.exitFullscreen || document.webkitExitFullscreen;

    if (typeof exit !== "function") return;

    try {
      const result = exit.call(document);
      if (result && typeof result.catch === "function") {
        result.catch(() => {});
      }
    } catch (error) {
      // The browser will update the UI if the exit completes.
    }
  }

  function toggleFullscreen() {
    if (state.fauxFullscreen) {
      exitFallbackFullscreen();
      return;
    }

    if (isNativeFullscreen()) {
      exitNativeFullscreen();
      return;
    }

    const request =
      elements.tableCard.requestFullscreen ||
      elements.tableCard.webkitRequestFullscreen;

    if (typeof request !== "function") {
      enterFallbackFullscreen();
      return;
    }

    window.clearTimeout(fullscreenTimer);
    state.fullscreenAttempt += 1;
    const currentAttempt = state.fullscreenAttempt;

    try {
      const result = request.call(elements.tableCard);
      if (result && typeof result.catch === "function") {
        result.catch(() => {
          if (currentAttempt === state.fullscreenAttempt) {
            enterFallbackFullscreen();
          }
        });
      }
    } catch (error) {
      enterFallbackFullscreen();
      return;
    }

    // Some browsers expose the API but silently ignore the request. If the
    // viewport never becomes full screen, use the CSS overlay instead.
    fullscreenTimer = window.setTimeout(() => {
      if (
        currentAttempt === state.fullscreenAttempt &&
        !isNativeFullscreen() &&
        !state.fauxFullscreen
      ) {
        enterFallbackFullscreen();
      }
    }, 650);
  }

  function syncFullscreenState() {
    if (isNativeFullscreen()) {
      window.clearTimeout(fullscreenTimer);
      fullscreenTimer = null;
      state.fullscreenAttempt += 1;
      state.fauxFullscreen = false;
      elements.tableCard.classList.remove("is-faux-fullscreen");
      document.body.classList.remove("fullscreen-open");
      updateFullscreenUI(true);
      return;
    }

    if (!state.fauxFullscreen) {
      updateFullscreenUI(false);
    }
  }

  /* Events */

  elements.rollBtn.addEventListener("click", rollDice);
  elements.decreaseBtn.addEventListener("click", () => {
    setDiceCount(state.dice - 1);
  });
  elements.increaseBtn.addEventListener("click", () => {
    setDiceCount(state.dice + 1);
  });
  elements.soundToggle.addEventListener("click", toggleSound);
  elements.resetBtn.addEventListener("click", resetSession);
  elements.fullscreenBtn.addEventListener("click", toggleFullscreen);

  document.addEventListener("fullscreenchange", syncFullscreenState);
  document.addEventListener("webkitfullscreenchange", syncFullscreenState);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.fauxFullscreen) {
      event.preventDefault();
      exitFallbackFullscreen();
      elements.fullscreenBtn.focus({ preventScroll: true });
    }
  });

  document.addEventListener("keydown", (event) => {
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    ) {
      return;
    }

    const target = event.target;
    const isInteractive =
      target instanceof HTMLElement &&
      (target.matches("button, a, input, textarea, select") ||
        target.isContentEditable);

    if (isInteractive) return;

    if (event.code === "Space" || event.key.toLowerCase() === "r") {
      event.preventDefault();
      rollDice();
    }
  });

  /* Boot */

  loadSession();
  updateSoundUI();
  updateCountUI();
  renderDice(state.dice);
  resetReadout();
  updateStats(false);
  renderHistory(false);
})();
