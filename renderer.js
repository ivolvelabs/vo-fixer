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

// RUBBER BAND: browse + status
let RUBBERBAND_OK = false;
async function refreshRbStatus() {
  const { available, path, viaPath, reason } = await window.vofix.rbGet();
  window.RUBBERBAND_OK = !!available;

  const statusEl = $("rbStatus");
  const where = path ? `(${path})` : viaPath ? "(via PATH)" : "";
  if (available) {
    statusEl.textContent = `Found ✓ ${where}`;
  } else {
    statusEl.textContent = `Not working ✗ ${where}`;
    // Add a tooltip with the exact reason (error, missing DLLs, etc.)
    statusEl.title = reason || "Unknown error";
  }

  $("rbWarn").classList.toggle("hidden", available);
  $("rbWarnAdv").classList.toggle("hidden", available);
  // Disable pitch/timbre fields if not available
  $("vsPitch").disabled = !available;
  $("vsFormant").disabled = !available;
  $("advPitch").disabled = !available;
  $("advFormant").disabled = !available;
}

$("rbBrowse").onclick = async () => {
  const res = await window.vofix.rbPick();
  if (!res?.canceled) {
    // If not available, show reason prominently in the log as well
    if (!res.available && res.reason) {
      const log = $("log");
      log.textContent += `Rubber Band test failed:\n${res.reason}\n`;
    }
    await refreshRbStatus();
  }
};

refreshRbStatus();

// SIMPLE MODE state
["macroConfidence", "macroWarmth", "macroClarity"].forEach((id, i) => {
  const map = ["macroConfidenceVal", "macroWarmthVal", "macroClarityVal"];
  $(id).addEventListener("input", () => {
    $(map[i]).innerText = $(id).value;
  });
});
$("vsPitch").addEventListener(
  "input",
  () => ($("vsPitchVal").textContent = $("vsPitch").value)
);
$("vsTempo").addEventListener(
  "input",
  () => ($("vsTempoVal").textContent = $("vsTempo").value + "%")
);

// Presets
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
let currentSeedPreset = PRESET_SEEDS.yt_pro;
[...document.querySelectorAll(".chip[data-preset]")].forEach((btn) => {
  btn.onclick = () => {
    const k = btn.dataset.preset;
    currentSeedPreset = PRESET_SEEDS[k] || PRESET_SEEDS.yt_pro;
    $("macroConfidence").value = currentSeedPreset.conf;
    $("macroWarmth").value = currentSeedPreset.warm;
    $("macroClarity").value = currentSeedPreset.clar;
    $("macroConfidenceVal").innerText = currentSeedPreset.conf;
    $("macroWarmthVal").innerText = currentSeedPreset.warm;
    $("macroClarityVal").innerText = currentSeedPreset.clar;
  };
});
$("makeProBtn").onclick = () => {
  currentSeedPreset = PRESET_SEEDS.yt_pro;
  $("macroConfidence").value = PRESET_SEEDS.yt_pro.conf;
  $("macroWarmth").value = PRESET_SEEDS.yt_pro.warm;
  $("macroClarity").value = PRESET_SEEDS.yt_pro.clar;
  $("macroConfidenceVal").innerText = PRESET_SEEDS.yt_pro.conf;
  $("macroWarmthVal").innerText = PRESET_SEEDS.yt_pro.warm;
  $("macroClarityVal").innerText = PRESET_SEEDS.yt_pro.clar;
};

// Map Simple macros → detailed chain
function simpleMacrosToOptions({ conf, warm, clar, seed }) {
  const C = conf / 100,
    W = warm / 100,
    K = clar / 100;
  const presence = +(1 + 3 * K).toFixed(1);
  const air = +(0 + 2 * Math.max(0, K - 0.5)).toFixed(1);
  const deess = +(0.35 + 0.35 * K).toFixed(2);
  const highpassHz = Math.round(70 + 60 * (1 - W));
  const compRatio = +(2.6 + 1.2 * C).toFixed(1);
  const compThreshold = Math.round(-20 + 6 * (1 - C));
  const compMakeup = +(5 + 2 * C).toFixed(1);
  const denoise = seed?.denoise || "afftdn";
  const denoiseAmount = seed?.nf ?? -25;
  const dehum = !!seed?.dehum;
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
    loudnormI: -19,
    loudnormLRA: 7,
    loudnormTP: -1,
  };
}

// Advanced read
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

// Build current options (including Voice Shape)
function currentOptions() {
  const simpleActive = !simplePanel.classList.contains("hidden");
  const base = simpleActive
    ? simpleMacrosToOptions({
        conf: Number($("macroConfidence").value),
        warm: Number($("macroWarmth").value),
        clar: Number($("macroClarity").value),
        seed: currentSeedPreset,
      })
    : advancedOptions();

  let pitchSemi, tempoPct, preserveFormants;
  if (simpleActive) {
    pitchSemi = Number($("vsPitch").value);
    tempoPct = Number($("vsTempo").value);
    preserveFormants = !!$("vsFormant").checked;
  } else {
    pitchSemi = Number($("advPitch").value);
    tempoPct = Number($("advTempo").value);
    preserveFormants = !!$("advFormant").checked;
  }

  // Debug hint in log if user left defaults (no audible change)
  try {
    const log = $("log");
    if (pitchSemi === 0 && tempoPct === 100) {
      log.textContent +=
        "[ui] Voice Shape currently set to no change (0 st, 100%).\n";
    } else {
      log.textContent += `[ui] Voice Shape set: pitch=${pitchSemi} st, tempo=${tempoPct}%, formant=${preserveFormants}\n`;
    }
  } catch {}

  return {
    ...base,
    voiceShape: {
      useRubberband: RUBBERBAND_OK,
      pitchSemi,
      tempoPct,
      preserveFormants,
    },
  };
}

// Preview + processing (robust)
function setOriginalPlayer() {
  const orig = $("origPlayer");
  if (inPath) {
    orig.src = window.vofix.toFileUrl(inPath);
    orig.load();
  }
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

// Buttons
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

// Log hook
window.vofix.onLog((msg) => {
  const log = $("log");
  log.textContent += msg;
  log.scrollTop = log.scrollHeight;
});

// Preload guard
if (!window.vofix) alert("Preload failed: window.vofix undefined.");
