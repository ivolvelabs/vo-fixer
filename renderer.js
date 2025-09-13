// renderer.js
const $ = (id) => document.getElementById(id);

let inPath = null;
let defaultOut = null;

// Preview sequencing guard (only latest render applies)
let previewSeq = 0;

const controls = [
  "hp",
  "denoise",
  "nf",
  "dehum",
  "deess",
  "presence",
  "air",
  "cth",
  "cr",
  "cm",
  "lim",
  "lufs",
  "lra",
  "tp",
];

function currentOptions() {
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

function setOriginalPlayer() {
  const orig = $("origPlayer");
  orig.src = window.vofix.toFileUrl(inPath);
  orig.load();
}

function setDefaultOutputText() {
  $("outPath").innerText = defaultOut || "";
  $("outPathDup").innerText = defaultOut || "";
}

// Loader helpers
function showLoader() {
  $("previewLoader").classList.remove("hidden");
}
function hideLoader() {
  $("previewLoader").classList.add("hidden");
}

// // Wait for media readiness with timeout + fallback
// function waitForCanPlayThrough(audio, timeoutMs = 12000) {
//   return new Promise((resolve, reject) => {
//     let done = false;
//     const clean = () => {
//       done = true;
//       audio.removeEventListener("canplaythrough", onOk);
//       audio.removeEventListener("canplay", onOk);
//       audio.removeEventListener("loadedmetadata", onOk);
//       audio.removeEventListener("error", onErr);
//       clearTimeout(t);
//     };
//     const onOk = () => {
//       if (!done) {
//         clean();
//         resolve();
//       }
//     };
//     const onErr = (e) => {
//       if (!done) {
//         clean();
//         reject(e.error || new Error("Audio error"));
//       }
//     };
//     const t = setTimeout(() => {
//       if (!done) {
//         clean();
//         resolve();
//       }
//     }, timeoutMs);

//     // Try the strongest readiness first, then fall back
//     audio.addEventListener("canplaythrough", onOk, { once: true });
//     audio.addEventListener("canplay", onOk, { once: true });
//     audio.addEventListener("loadedmetadata", onOk, { once: true });
//     audio.addEventListener("error", onErr, { once: true });
//   });
// }

// // Manual preview trigger (absolute w/ loader & sequencing)
// async function renderPreview() {
//   if (!inPath) return alert("Pick an input file first.");

//   const btn = $("renderPreviewBtn");
//   const prev = $("prevPlayer");
//   const log = $("log");

//   // Sequence id so only the latest result is used
//   const mySeq = ++previewSeq;

//   // UI: block interactions & show loader
//   btn.disabled = true;
//   showLoader();

//   try {
//     log.textContent += "Rendering preview...\n";
//     const { previewPath } = await window.vofix.processPreview({
//       inputPath: inPath,
//       options: currentOptions(),
//       durationSec: 8,
//     });

//     // If another preview started after this one, ignore this result
//     if (mySeq !== previewSeq) return;

//     // Reset the element completely to avoid stale playback state
//     try {
//       prev.pause();
//     } catch {}
//     prev.removeAttribute("src");
//     prev.load();

//     // Cache-bust AND include seq in the query to avoid any reuse
//     const url =
//       window.vofix.toFileUrl(previewPath) + `?v=${Date.now()}&seq=${mySeq}`;
//     prev.src = url;

//     // Force a fresh load and wait for it to be truly ready
//     prev.load();
//     await waitForCanPlayThrough(prev, 12000);

//     // Autoplay should be allowed because this follows a button click (user gesture)
//     try {
//       await prev.play();
//     } catch {}

//     log.textContent += "Preview ready.\n";
//   } catch (e) {
//     log.textContent += "Preview error: " + (e?.message || e) + "\n";
//   } finally {
//     // Only the latest call should re-enable/hide loader
//     if (mySeq === previewSeq) {
//       hideLoader();
//       btn.disabled = false;
//     }
//   }
// }

// Wait until audio is playable (with timeout)
function waitForPlayable(audio, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      audio.removeEventListener('loadeddata', onOk);
      audio.removeEventListener('canplay', onOk);
      audio.removeEventListener('canplaythrough', onOk);
      audio.removeEventListener('error', onErr);
      clearTimeout(t);
    };
    const onOk = () => { cleanup(); resolve(); };
    const onErr = (e) => { cleanup(); reject(e?.error || new Error('Audio load error')); };
    const t = setTimeout(() => { cleanup(); resolve(); }, timeoutMs);

    audio.addEventListener('loadeddata', onOk, { once: true });
    audio.addEventListener('canplay', onOk, { once: true });
    audio.addEventListener('canplaythrough', onOk, { once: true });
    audio.addEventListener('error', onErr, { once: true });
  });
}

// Small helper to sleep
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Manual preview trigger (absolute w/ loader, disable button, retry on error)
async function renderPreview() {
  if (!inPath) return alert('Pick an input file first.');

  const btn = $('renderPreviewBtn');
  const prev = $('prevPlayer');
  const log = $('log');

  const mySeq = ++previewSeq;
  btn.disabled = true;
  showLoader();

  try {
    log.textContent += 'Rendering preview...\n';
    const { previewPath } = await window.vofix.processPreview({
      inputPath: inPath,
      options: currentOptions(),
      durationSec: 8,
    });

    if (mySeq !== previewSeq) return;

    // Fully reset element
    try { prev.pause(); } catch {}
    prev.removeAttribute('src');
    prev.load();

    // Give the OS a tick to flush the new file (Windows can be picky)
    await sleep(60);

    // Try to load; retry once with a fresh cache-buster if it errors
    const tryLoad = async (attempt) => {
      const url = window.vofix.toFileUrl(previewPath) + `?v=${Date.now()}&seq=${mySeq}&try=${attempt}`;
      prev.src = url;
      prev.load();
      await waitForPlayable(prev, 12000);
    };

    try {
      await tryLoad(1);
    } catch (e1) {
      log.textContent += 'Preview load retry...\n';
      await sleep(120);
      await tryLoad(2);
    }

    // Autoplay after user click (should be allowed)
    try { await prev.play(); } catch {}

    log.textContent += 'Preview ready.\n';
  } catch (e) {
    log.textContent += 'Preview error: ' + (e?.message || e) + '\n';
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
    // No auto-render. User will click "Render Preview".
  }
}

// Init
$("pickIn").onclick = pickInput;
$("renderPreviewBtn").onclick = renderPreview;

// Process & Save (full file)
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

// Guard preload
if (!window.vofix) alert("Preload failed: window.vofix undefined.");
