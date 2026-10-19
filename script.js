(() => {
  "use strict";

  const MAX_DICE = 6;
  const STORAGE_KEY = "roll-club-v1";
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");

  /*
   * Each rotation brings the rolled face onto the top of the cube.
   * The camera then looks down at the table so the result is always the
   * face staring back at the player.
   */
  const FACE_ROTATIONS = {
    1: { x: 90, y: 0, z: 0 },
    2: { x: 0, y: 0, z: 0 },
    3: { x: 0, y: 0, z: -90 },
    4: { x: 0, y: 0, z: 90 },
    5: { x: 180, y: 0, z: 0 },
    6: { x: -90, y: 0, z: 0 }
  };

  /*
   * This must stay in sync with .die-camera in styles.css.
   * The camera looks down from above, making the top face the largest
   * visible plane while the front and side planes provide depth.
   */
  const VIEW_ROTATION = { x: -62, y: -20, z: 0 };

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

  const D20_QUIPS = {
    naturalOne: "A natural one. The dice are cruel.",
    low: "A rough roll. Better luck next time.",
    middling: "A middling roll. Onward.",
    solid: "A respectable roll.",
    high: "The dice are smiling at you.",
    naturalTwenty: "Natural twenty. Legendary."
  };

  const elements = {
    tableCard: document.querySelector(".table-card"),
    fullscreenBtn: document.getElementById("fullscreenBtn"),
    diceStage: document.getElementById("diceStage"),
    diceSet: document.getElementById("diceSet"),
    stageStamp: document.getElementById("stageStamp"),
    typeButtons: Array.from(document.querySelectorAll(".type-option")),
    factNumber: document.getElementById("factNumber"),
    factText: document.getElementById("factText"),
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
    sides: 6,
    history: [],
    sound: true,
    rolling: false,
    rollSerial: 0,
    fauxFullscreen: false,
    fullscreenAttempt: 0,
    d20Renderers: []
  };

  let enterTimer = null;
  let statusTimer = null;
  let toastTimer = null;
  let fullscreenTimer = null;
  let d20Frame = null;
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

      if (saved.sides === 6 || saved.sides === 20) {
        state.sides = saved.sides;
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

    const sides = roll.sides === 20 ? 20 : 6;
    const values = roll.values
      .filter(
        (value) =>
          Number.isInteger(value) && value >= 1 && value <= sides
      )
      .slice(0, MAX_DICE);

    if (values.length === 0) return null;

    return {
      values,
      total: values.reduce((sum, value) => sum + value, 0),
      sides,
      time: Number.isFinite(roll.time) ? roll.time : Date.now()
    };
  }

  function saveSession() {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          dice: state.dice,
          sides: state.sides,
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

  function rollOne(sides = 6) {
    return randomInt(sides) + 1;
  }

  function randomTilt() {
    return randomInt(13) - 6;
  }

  function dieTransform(value, spins, tilt) {
    const target = FACE_ROTATIONS[value];
    const rotateX = target.x + spins.x * 360;
    const rotateY = target.y + spins.y * 360;
    const rotateZ = target.z + spins.z * 360 + tilt;

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

  /* D20 geometry */

  function subtractVectors(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }

  function dotProduct(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  function crossProduct(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }

  function vectorLength(vector) {
    return Math.hypot(vector[0], vector[1], vector[2]);
  }

  function buildD20Geometry() {
    const phi = (1 + Math.sqrt(5)) / 2;
    const rawVertices = [
      [-1, phi, 0],
      [1, phi, 0],
      [-1, -phi, 0],
      [1, -phi, 0],
      [0, -1, phi],
      [0, 1, phi],
      [0, -1, -phi],
      [0, 1, -phi],
      [phi, 0, -1],
      [phi, 0, 1],
      [-phi, 0, -1],
      [-phi, 0, 1]
    ];

    const vertices = rawVertices.map(normalizeVector);
    let edgeLength = Infinity;

    for (let a = 0; a < vertices.length; a += 1) {
      for (let b = a + 1; b < vertices.length; b += 1) {
        const distance = vectorLength(subtractVectors(vertices[a], vertices[b]));
        edgeLength = Math.min(edgeLength, distance);
      }
    }

    const faces = [];
    const tolerance = 1e-7;

    for (let a = 0; a < vertices.length - 2; a += 1) {
      for (let b = a + 1; b < vertices.length - 1; b += 1) {
        for (let c = b + 1; c < vertices.length; c += 1) {
          const ab = vectorLength(subtractVectors(vertices[a], vertices[b]));
          const bc = vectorLength(subtractVectors(vertices[b], vertices[c]));
          const ca = vectorLength(subtractVectors(vertices[c], vertices[a]));

          if (
            Math.abs(ab - edgeLength) > tolerance ||
            Math.abs(bc - edgeLength) > tolerance ||
            Math.abs(ca - edgeLength) > tolerance
          ) {
            continue;
          }

          let indices = [a, b, c];
          let normal = normalizeVector(
            crossProduct(
              subtractVectors(vertices[b], vertices[a]),
              subtractVectors(vertices[c], vertices[a])
            )
          );
          const centroid = [
            (vertices[a][0] + vertices[b][0] + vertices[c][0]) / 3,
            (vertices[a][1] + vertices[b][1] + vertices[c][1]) / 3,
            (vertices[a][2] + vertices[b][2] + vertices[c][2]) / 3
          ];

          if (dotProduct(normal, centroid) < 0) {
            indices = [a, c, b];
            normal = [-normal[0], -normal[1], -normal[2]];
          }

          faces.push({ indices, normal, number: 0 });
        }
      }
    }

    // Pair opposite faces so they always add up to 21, as on a real D20.
    const paired = new Set();
    const pairs = [];

    for (let index = 0; index < faces.length; index += 1) {
      if (paired.has(index)) continue;

      for (let other = index + 1; other < faces.length; other += 1) {
        if (paired.has(other)) continue;

        if (dotProduct(faces[index].normal, faces[other].normal) < -0.999) {
          paired.add(index);
          paired.add(other);
          pairs.push([index, other]);
          break;
        }
      }
    }

    pairs.forEach(([first, second], index) => {
      faces[first].number = index + 1;
      faces[second].number = 20 - index;
    });

    return {
      vertices,
      faces,
      byNumber: new Map(faces.map((face) => [face.number, face]))
    };
  }

  const D20_GEOMETRY = buildD20Geometry();
  const D20_SCALE = 56;

  function radToDeg(value) {
    return (value * 180) / Math.PI;
  }

  /*
   * Find an Euler rotation that puts a face normal on top. A small random
   * roll around Z keeps successive throws from looking identical.
   */
  function getFaceUpAngles(normal, rollDegrees) {
    const [nx, ny, nz] = rotateVector(normal, {
      x: 0,
      y: 0,
      z: rollDegrees
    });

    const yaw = Math.atan2(-nx, nz);
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const zAfterYaw = -nx * sinYaw + nz * cosYaw;
    const pitch = Math.PI - Math.atan2(zAfterYaw, ny);

    return {
      x: radToDeg(pitch),
      y: radToDeg(yaw),
      z: rollDegrees
    };
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
        z: target.z + tilt
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

  function markResultFace(die, value) {
    die.querySelectorAll(".die-face").forEach((face) => {
      face.classList.toggle(
        "is-result",
        Number(face.dataset.value) === value
      );
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
    markResultFace(die, 1);

    camera.appendChild(die);
    hop.appendChild(camera);
    slot.append(shadow, hop);

    return { slot, die };
  }

  /* D20 SVG renderer */

  function svgNode(name) {
    return document.createElementNS("http://www.w3.org/2000/svg", name);
  }

  function mixColor(start, end, amount) {
    const t = clamp(amount, 0, 1);
    return `rgb(${Math.round(start[0] + (end[0] - start[0]) * t)}, ${Math.round(
      start[1] + (end[1] - start[1]) * t
    )}, ${Math.round(start[2] + (end[2] - start[2]) * t)})`;
  }

  function normalizeAngle(degrees) {
    let value = degrees % 360;
    if (value > 180) value -= 360;
    if (value < -180) value += 360;
    return value;
  }

  function createD20Renderer() {
    const svg = svgNode("svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("class", "die20-svg");

    const faceLayer = svgNode("g");
    faceLayer.classList.add("d20-faces");
    const labelLayer = svgNode("g");
    labelLayer.classList.add("d20-labels");
    svg.append(faceLayer, labelLayer);

    const groups = D20_GEOMETRY.faces.map((face) => {
      const group = svgNode("g");
      group.classList.add("d20-face");

      const rim = svgNode("polygon");
      rim.classList.add("d20-face-rim");

      const panel = svgNode("polygon");
      panel.classList.add("d20-face-panel");

      const label = svgNode("text");
      label.classList.add("d20-label");
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("dominant-baseline", "central");
      label.textContent = String(face.number);

      group.append(rim, panel);
      faceLayer.appendChild(group);
      labelLayer.appendChild(label);

      return { face, group, rim, panel, label };
    });

    const wrapper = document.createElement("div");
    wrapper.className = "die20";
    wrapper.appendChild(svg);

    const initialFace = D20_GEOMETRY.byNumber.get(1);
    const initialAngles = getFaceUpAngles(
      initialFace.normal,
      randomInt(25) - 12
    );

    const renderer = {
      el: wrapper,
      angles: {
        x: normalizeAngle(initialAngles.x),
        y: normalizeAngle(initialAngles.y),
        z: normalizeAngle(initialAngles.z)
      },
      resultNumber: 1,

      render() {
        const { angles, resultNumber } = renderer;
        const transformedVertices = D20_GEOMETRY.vertices.map((vertex) =>
          rotateVector(rotateVector(vertex, angles), VIEW_ROTATION)
        );
        const projected = transformedVertices.map((vertex) => [
          50 + vertex[0] * D20_SCALE,
          50 + vertex[1] * D20_SCALE
        ]);

        groups.forEach(({ face, group, rim, panel, label }) => {
          const normal = rotateVector(
            rotateVector(face.normal, angles),
            VIEW_ROTATION
          );

          if (normal[2] <= 0.015) {
            group.style.display = "none";
            label.style.display = "none";
            return;
          }

          const points = face.indices.map((index) => projected[index]);
          const [first, second, third] = points;
          const area = Math.abs(
            (second[0] - first[0]) * (third[1] - first[1]) -
              (third[0] - first[0]) * (second[1] - first[1])
          ) / 2;

          if (area < 0.02) {
            group.style.display = "none";
            label.style.display = "none";
            return;
          }

          group.style.display = "";
          const center = [
            (first[0] + second[0] + third[0]) / 3,
            (first[1] + second[1] + third[1]) / 3
          ];
          const inner = points.map((point) => [
            center[0] + (point[0] - center[0]) * 0.86,
            center[1] + (point[1] - center[1]) * 0.86
          ]);

          const pointString = (list) =>
            list.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");

          rim.setAttribute("points", pointString(points));
          panel.setAttribute("points", pointString(inner));

          const light = Math.max(0, dotProduct(normal, LIGHT_DIRECTION));
          const facing = Math.max(0, normal[2]);
          const luminance = clamp(
            0.42 + light * 0.4 + facing * 0.18,
            0,
            1
          );
          const darkening = 0.04 + (1 - luminance) * 0.48;

          panel.setAttribute(
            "fill",
            mixColor([255, 250, 240], [190, 172, 149], darkening)
          );
          rim.setAttribute(
            "fill",
            mixColor([226, 209, 187], [141, 118, 89], 0.08 + (1 - luminance) * 0.55)
          );

          const sideAb = Math.hypot(
            second[0] - first[0],
            second[1] - first[1]
          );
          const sideBc = Math.hypot(
            third[0] - second[0],
            third[1] - second[1]
          );
          const sideCa = Math.hypot(
            first[0] - third[0],
            first[1] - third[1]
          );
          const inradius = area / ((sideAb + sideBc + sideCa) / 2);
          const fontSize =
            Math.min(14.5, inradius * (face.number === resultNumber ? 1.18 : 1.06));

          label.setAttribute("x", center[0].toFixed(2));
          label.setAttribute("y", center[1].toFixed(2));
          label.setAttribute("font-size", Math.max(0.1, fontSize).toFixed(2));
          label.classList.toggle(
            "is-result",
            face.number === resultNumber
          );
          label.style.display =
            face.number === resultNumber || inradius >= 4 ? "" : "none";
        });
      },

      createTargetAngles(value) {
        const face = D20_GEOMETRY.byNumber.get(value);
        const base = getFaceUpAngles(face.normal, randomInt(360));

        return {
          x: base.x + (2 + randomInt(2)) * 360,
          y: base.y + (2 + randomInt(2)) * 360,
          z: base.z + (1 + randomInt(2)) * 360
        };
      },

      normalizeAngles() {
        renderer.angles = {
          x: normalizeAngle(renderer.angles.x),
          y: normalizeAngle(renderer.angles.y),
          z: normalizeAngle(renderer.angles.z)
        };
      },

      markResult(value) {
        renderer.resultNumber = value;
        groups.forEach(({ face, label }) => {
          label.classList.toggle(
            "is-result",
            face.number === value
          );
        });
      }
    };

    renderer.render();
    renderer.markResult(1);
    return renderer;
  }

  function createD20Die(index) {
    const slot = document.createElement("div");
    slot.className = "die-slot die-slot--d20";
    slot.style.setProperty("--i", String(index));

    const shadow = document.createElement("div");
    shadow.className = "die-shadow";

    const hop = document.createElement("div");
    hop.className = "die-hop";

    const renderer = createD20Renderer();
    hop.appendChild(renderer.el);
    slot.append(shadow, hop);

    return { slot, renderer };
  }

  function renderDice(count) {
    window.clearTimeout(enterTimer);
    if (d20Frame) {
      window.cancelAnimationFrame(d20Frame);
      d20Frame = null;
    }
    elements.diceStage.classList.remove("is-entering");
    elements.diceStage.dataset.count = String(count);
    elements.diceStage.dataset.sides = String(state.sides);
    elements.diceSet.replaceChildren();
    state.d20Renderers = [];

    const fragment = document.createDocumentFragment();

    for (let index = 0; index < count; index += 1) {
      if (state.sides === 20) {
        const { slot, renderer } = createD20Die(index);
        state.d20Renderers.push(renderer);
        fragment.appendChild(slot);
      } else {
        const { slot } = createDie(index);
        fragment.appendChild(slot);
      }
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

  function updateTypeUI() {
    elements.typeButtons.forEach((button) => {
      const active = Number(button.dataset.sides) === state.sides;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      button.disabled = state.rolling;
    });

    elements.stageStamp.textContent = `D${state.sides}`;
    elements.diceStage.dataset.sides = String(state.sides);

    if (state.sides === 20) {
      elements.factNumber.textContent = "21";
      elements.factText.innerHTML =
        "Opposite faces of a twenty-sided die always add up to <strong>twenty-one</strong>.";
    } else {
      elements.factNumber.textContent = "07";
      elements.factText.innerHTML =
        "Opposite faces of a standard die always add up to <strong>seven</strong>.";
    }
  }

  function getResultQuip(value) {
    if (state.sides === 6) return SINGLE_DIE_QUIPS[value];
    if (value === 1) return D20_QUIPS.naturalOne;
    if (value === 20) return D20_QUIPS.naturalTwenty;
    if (value >= 16) return D20_QUIPS.high;
    if (value >= 11) return D20_QUIPS.solid;
    if (value >= 6) return D20_QUIPS.middling;
    return D20_QUIPS.low;
  }

  function getSessionHistory() {
    return state.history.filter((roll) => roll.sides === state.sides);
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
    elements.typeButtons.forEach((button) => {
      button.disabled = locked;
    });
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
    const session = getSessionHistory();
    const count = session.length;

    if (count === 0) {
      elements.statRolls.textContent = "0";
      elements.statAverage.textContent = "\u2014";
      elements.statHigh.textContent = "\u2014";
    } else {
      let sum = 0;
      let high = 0;

      session.forEach((roll) => {
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
    const session = getSessionHistory();
    elements.historyCount.textContent = String(session.length);

    if (session.length === 0) {
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

    session.forEach((roll, index) => {
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
      number.textContent = String(session.length - index).padStart(2, "0");

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
      sides: state.sides,
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
      getSessionHistory().length > 0
        ? "Ready for another roll."
        : "Your roll will land here."
    );
    setStatus("ready", "Ready");
    elements.rollLabel.textContent = "Roll dice";
    saveSession();
  }

  function setDieType(sides) {
    if (state.rolling || sides === state.sides) return;

    state.sides = sides;
    saveSession();
    updateTypeUI();
    renderDice(state.dice);
    resetReadout(
      getSessionHistory().length > 0
        ? "Ready for another roll."
        : "Your roll will land here."
    );
    setStatus("ready", "Ready");
    elements.rollLabel.textContent = "Roll dice";
    updateStats(false);
    renderHistory(false);
    elements.liveRegion.textContent = `D${sides} selected.`;
  }

  function animateD20Roll(values, total, currentRoll) {
    const renderers = state.d20Renderers;

    if (renderers.length === 0) {
      finishRoll(values, total);
      return;
    }

    renderers.forEach((renderer) => renderer.markResult(null));

    const starts = renderers.map((renderer) => ({ ...renderer.angles }));
    const targets = renderers.map((renderer, index) =>
      renderer.createTargetAngles(values[index])
    );

    if (REDUCED_MOTION.matches) {
      renderers.forEach((renderer, index) => {
        renderer.angles = { ...targets[index] };
        renderer.render();
      });

      window.setTimeout(() => {
        if (currentRoll !== state.rollSerial || !state.rolling) return;
        finishRoll(values, total);
      }, 140);
      return;
    }

    const startTime = performance.now();
    const duration = 1000;
    const stagger = 45;
    const totalDuration = duration + (renderers.length - 1) * stagger + 20;

    const frame = (now) => {
      if (currentRoll !== state.rollSerial || !state.rolling) return;

      const elapsed = now - startTime;

      renderers.forEach((renderer, index) => {
        const progress = clamp(
          (elapsed - index * stagger) / duration,
          0,
          1
        );
        const eased = 1 - Math.pow(1 - progress, 3);

        renderer.angles = {
          x:
            starts[index].x +
            (targets[index].x - starts[index].x) * eased,
          y:
            starts[index].y +
            (targets[index].y - starts[index].y) * eased,
          z:
            starts[index].z +
            (targets[index].z - starts[index].z) * eased
        };
        renderer.render();
      });

      if (elapsed < totalDuration) {
        d20Frame = window.requestAnimationFrame(frame);
      } else {
        renderers.forEach((renderer) => renderer.normalizeAngles());
        finishRoll(values, total);
      }
    };

    d20Frame = window.requestAnimationFrame(frame);
  }

  function rollDice() {
    if (state.rolling) return;

    state.rolling = true;
    window.clearTimeout(statusTimer);
    state.rollSerial += 1;
    const currentRoll = state.rollSerial;

    const values = Array.from(
      { length: state.dice },
      () => rollOne(state.sides)
    );
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

    if (state.sides === 20) {
      animateD20Roll(values, total, currentRoll);
      return;
    }

    const dice = Array.from(elements.diceSet.querySelectorAll(".die"));

    dice.forEach((die, index) => {
      markResultFace(die, null);
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
    d20Frame = null;
    elements.diceStage.classList.remove("is-rolling");
    elements.rollBtn.classList.remove("is-rolling");
    elements.rollLabel.textContent = "Roll again";
    setControlsLocked(false);

    if (state.sides === 20) {
      state.d20Renderers.forEach((renderer, index) => {
        renderer.normalizeAngles();
        renderer.markResult(values[index]);
        renderer.render();
      });
    } else {
      Array.from(elements.diceSet.querySelectorAll(".die")).forEach((die, index) => {
        updateFaceShading(die, values[index]);
        markResultFace(die, values[index]);
      });
    }

    elements.total.textContent = String(total);
    void elements.total.offsetWidth;
    elements.total.classList.add("pop");
    elements.breakdown.textContent =
      values.length === 1
        ? getResultQuip(total)
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

    state.history = state.history.filter(
      (roll) => roll.sides !== state.sides
    );
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
  elements.typeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setDieType(Number(button.dataset.sides));
    });
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
  updateTypeUI();
  renderDice(state.dice);
  resetReadout();
  updateStats(false);
  renderHistory(false);
})();
