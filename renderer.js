// renderer.js
const $ = (id) => document.getElementById(id);

let inPath = null;
let defaultOut = null;
let previewSeq = 0;

// MODE TOGGLE
const simplePanel = $("simplePanel");
const advancedPanel = $("advancedPanel");
const tabSimple = $("tabSimple");
const tabAdvanced = $("tabAdvanced");

function setMode(mode) {
  const isSimple = mode === "simple";
  tabSimple.classList.toggle("active", isSimple);
  tabAdvanced.classList.toggle("active", !isSimple);
  simplePanel.classList.toggle("hidden", !isSimple);
  advancedPanel.classList.toggle("hidden", isSimple);
}
tabSimple.onclick = () => setMode("simple");
tabAdvanced.onclick = () => setMode("advanced");
setMode("simple");

// SIMPLE MODE state
const macroIds = ["macroConfidence", "macroWarmth", "macroClarity"];
const macroValIds = ["macroConfidenceVal", "macroWarmthVal", "macroClarityVal"];
const presetButtons = [...document.querySelectorAll(".chip[data-preset]")];

macroIds.forEach((id, i) => {
  $(id).addEventListener("input", () => {
    $(macroValIds[i]).innerText = $(id).value;
  });
});

// ──────────────────────────────────────────
// Option builders
// ──────────────────────────────────────────

// Simple-mode preset seeds
const PRESET_SEEDS = {
  yt_pro: {
    conf: 65,
    warm: 35,
    clar: 60,
    denoise: "afftdn",
    nf: -25,
    hp: 80,
    dehum: true,
  },
  warm_storyteller: {
    conf: 45,
    warm: 70,
    clar: 45,
    denoise: "anlmdn",
    nf: -22,
    hp: 90,
    dehum: true,
  },
  ad_power: {
    conf: 80,
    warm: 40,
    clar: 65,
    denoise: "afftdn",
    nf: -26,
    hp: 80,
    dehum: true,
  },
  audiobook_calm: {
    conf: 40,
    warm: 60,
    clar: 40,
    denoise: "anlmdn",
    nf: -21,
    hp: 90,
    dehum: false,
  },
  podcast_radio: {
    conf: 55,
    warm: 55,
    clar: 50,
    denoise: "afftdn",
    nf: -24,
    hp: 85,
    dehum: true,
  },
};

// Map macros → processing params
function simpleMacrosToOptions({ conf, warm, clar, seed }) {
  // Normalize 0..1
  const C = conf / 100,
    W = warm / 100,
    K = clar / 100;

  // Presence & Air from clarity
  const presence = +(1 + 3 * K).toFixed(1); // ~ +1 to +4 dB
  const air = +(0 + 2 * Math.max(0, K - 0.5)).toFixed(1); // add Air after mid clarity

  // De-esser intensity from clarity (more clarity = slightly more sibilance control)
  const deess = +(0.35 + 0.35 * K).toFixed(2); // 0.35..0.70

  // Warmth → low tilt (simulate via less highpass + subtle body; we’ll avoid low-shelf and just lower HPF)
  const highpassHz = Math.round(70 + 60 * (1 - W)); // 70..130 (more warmth = lower HPF)

  // Confidence → comp amount + makeup; limiter fixed
  const compRatio = +(2.6 + 1.2 * C).toFixed(1); // 2.6..3.8
  const compThreshold = Math.round(-20 + 6 * (1 - C)); // -20..-14 (more confidence = higher threshold? flip for natural; keep -18 default-like)
  const compMakeup = +(5 + 2 * C).toFixed(1); // 5..7 dB

  // Denoise choice from seed; NF from seed
  const denoise = seed?.denoise || "afftdn";
  const denoiseAmount = seed?.nf ?? -25;
  const dehum = !!seed?.dehum;

  // Loudness target mono VO
  const loudnormI = -19,
    loudnormLRA = 7,
    loudnormTP = -1;

  return {
    highpassHz,
    denoise,
    denoiseAmount,
    dehum,
    deesserIntensity: deess,
    addPresence: presence,
    addAir: air,
    compThreshold,
    compRatio,
    compMakeup,
    limiterCeiling: 0.95,
    loudnormI,
    loudnormLRA,
    loudnormTP,
  };
}

// Advanced-mode direct read
function advancedOptions() {
  return {
    highpassHz: Number($("hp").value),
    denoise: $("denoise").value,
    denoiseAmount: Number($("nf").value),
    dehum: $("dehum").checked,
    deesserIntensity: Number($("deess").value),
    addPresence: Number($("presence").value),
    addAir: Number($("air").value),
    compThreshold: Number($("cth").value),
    compRatio: Number($("cr").value),
    compMakeup: Number($("cm").value),
    limiterCeiling: Number($("lim").value),
    loudnormI: Number($("lufs").value),
    loudnormLRA: Number($("lra").value),
    loudnormTP: Number($("tp").value),
  };
}

// Decide which options to use
function currentOptions() {
  const simpleActive = !simplePanel.classList.contains("hidden");
  if (simpleActive) {
    const conf = Number($("macroConfidence").value);
    const warm = Number($("macroWarmth").value);
    const clar = Number($("macroClarity").value);
    const seed = currentSeedPreset || PRESET_SEEDS.yt_pro;
    return simpleMacrosToOptions({ conf, warm, clar, seed });
  }
  return advancedOptions();
}

// Preset handling
let currentSeedPreset = PRESET_SEEDS.yt_pro; // default
presetButtons.forEach((btn) => {
  btn.onclick = () => {
    const key = btn.dataset.preset;
    currentSeedPreset = PRESET_SEEDS[key] || PRESET_SEEDS.yt_pro;
    // Snap macros to preset then let user tweak
    $("macroConfidence").value = currentSeedPreset.conf;
    $("macroWarmth").value = currentSeedPreset.warm;
    $("macroClarity").value = currentSeedPreset.clar;
    $("macroConfidenceVal").innerText = currentSeedPreset.conf;
    $("macroWarmthVal").innerText = currentSeedPreset.warm;
    $("macroClarityVal").innerText = currentSeedPreset.clar;
  };
});

// Make It Pro → set YT Pro and macros defaults
$("makeProBtn").onclick = () => {
  currentSeedPreset = PRESET_SEEDS.yt_pro;
  $("macroConfidence").value = PRESET_SEEDS.yt_pro.conf;
  $("macroWarmth").value = PRESET_SEEDS.yt_pro.warm;
  $("macroClarity").value = PRESET_SEEDS.yt_pro.clar;
  $("macroConfidenceVal").innerText = PRESET_SEEDS.yt_pro.conf;
  $("macroWarmthVal").innerText = PRESET_SEEDS.yt_pro.warm;
  $("macroClarityVal").innerText = PRESET_SEEDS.yt_pro.clar;
};

// ──────────────────────────────────────────
// Existing preview & process functions (robust loader version)
// ─────────────────────────────────────────-
function setOriginalPlayer() {
  const orig = $("origPlayer");
  orig.src = window.vofix.toFileUrl(inPath);
  orig.load();
}
function setDefaultOutputText() {
  $("outPath").innerText = defaultOut || "";
  $("outPathDup").innerText = defaultOut || "";
}
function showLoader() {
  $("previewLoader").classList.remove("hidden");
}
function hideLoader() {
  $("previewLoader").classList.add("hidden");
}

function waitForPlayable(audio, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      audio.removeEventListener("loadeddata", onOk);
      audio.removeEventListener("canplay", onOk);
      audio.removeEventListener("canplaythrough", onOk);
      audio.removeEventListener("error", onErr);
      clearTimeout(t);
    };
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = (e) => {
      cleanup();
      reject(e?.error || new Error("Audio load error"));
    };
    const t = setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);
    audio.addEventListener("loadeddata", onOk, { once: true });
    audio.addEventListener("canplay", onOk, { once: true });
    audio.addEventListener("canplaythrough", onOk, { once: true });
    audio.addEventListener("error", onErr, { once: true });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function renderPreview() {
  if (!inPath) return alert("Pick an input file first.");

  const btn = $("renderPreviewBtn");
  const prev = $("prevPlayer");
  const log = $("log");

  const mySeq = ++previewSeq;
  btn.disabled = true;
  showLoader();

  try {
    log.textContent += "Rendering preview...\n";
    const { previewPath } = await window.vofix.processPreview({
      inputPath: inPath,
      options: currentOptions(),
      durationSec: 8,
    });
    if (mySeq !== previewSeq) return;

    try {
      prev.pause();
    } catch {}
    prev.removeAttribute("src");
    prev.load();
    await sleep(60);

    const url =
      window.vofix.toFileUrl(previewPath) + `?v=${Date.now()}&seq=${mySeq}`;
    prev.src = url;
    prev.load();

    try {
      await waitForPlayable(prev, 12000);
    } catch {
      log.textContent += "Preview load retry...\n";
      await sleep(120);
      prev.src = url + "&try=2";
      prev.load();
      await waitForPlayable(prev, 12000);
    }
    try {
      await prev.play();
    } catch {}
    log.textContent += "Preview ready.\n";
  } catch (e) {
    log.textContent += "Preview error: " + (e?.message || e) + "\n";
  } finally {
    if (mySeq === previewSeq) {
      hideLoader();
      btn.disabled = false;
    }
  }
}

async function pickInput() {
  inPath = await window.vofix.pickInput();
  $("inPath").innerText = inPath || "";
  if (inPath) {
    setOriginalPlayer();
    defaultOut = await window.vofix.getDefaultOutput(inPath);
    setDefaultOutputText();
  }
}

$("pickIn").onclick = pickInput;
$("renderPreviewBtn").onclick = renderPreview;

$("go").onclick = async () => {
  if (!inPath) return alert("Pick an input file first.");
  const log = $("log");
  try {
    log.textContent += "Processing full file...\n";
    await window.vofix.processAudio({
      inputPath: inPath,
      options: currentOptions(),
    });
    log.textContent += `\n✓ Saved to: ${defaultOut}\n`;
  } catch (e) {
    log.textContent += "\n✗ Error: " + (e?.message || e) + "\n";
  }
};

// Log hook + preload guard
window.vofix.onLog((msg) => {
  const log = $("log");
  log.textContent += msg;
  log.scrollTop = log.scrollHeight;
});
if (!window.vofix) alert("Preload failed: window.vofix undefined.");
