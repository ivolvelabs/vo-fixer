// main.js — Electron main process (ESM) with Rubber Band override + detailed logs
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Store from "electron-store";
import ffmpegStatic from "ffmpeg-static";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const store = new Store({ name: "vo-fixer-prefs" });

let win;

// ──────────────────────────────────────────────────────────────────────────────
// Window
// ──────────────────────────────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    webPreferences: {
      preload: path.resolve(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.removeMenu();
  win.loadFile(path.join(__dirname, "renderer.html"));
  // win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ──────────────────────────────────────────────────────────────────────────────
/** Log helper: send messages to renderer log pane */
function logToRenderer(msg) {
  try {
    win?.webContents.send("ffmpeg-log", String(msg) + "\n");
  } catch {}
}

// ──────────────────────────────────────────────────────────────────────────────
// Rubber Band path management + diagnostics
// ──────────────────────────────────────────────────────────────────────────────
function getRubberbandPath() {
  const p = store.get("rbPath");
  if (typeof p === "string" && p.trim()) return p.trim();
  // Fall back to PATH lookup name
  return process.platform === "win32" ? "rubberband.exe" : "rubberband";
}
function setRubberbandPath(p) {
  if (!p) {
    store.delete("rbPath");
    return;
  }
  store.set("rbPath", p);
}
function isExecutableFile(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return false;
    if (process.platform === "win32") return /\.exe$/i.test(p);
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
/** Detailed availability check: returns { available:boolean, reason:string } */
function checkRubberbandAvailableDetailed() {
  const exe = getRubberbandPath();
  try {
    if (path.isAbsolute(exe) && !isExecutableFile(exe)) {
      return {
        available: false,
        reason: "Selected file is not an executable.",
      };
    }

    // 1) Best check: version (should exit 0)
    let r = spawnSync(exe, ["-V"], { encoding: "utf8" });
    if (
      r.status === 0 &&
      /Rubber Band/i.test((r.stdout || "") + (r.stderr || ""))
    ) {
      const ver = (r.stdout || r.stderr || "").trim();
      return { available: true, reason: ver };
    }

    // 2) Fallback: help (may exit 1 or 2 on Windows builds but still proves availability)
    r = spawnSync(exe, ["-h"], { encoding: "utf8" });
    const text = (r.stdout || "") + (r.stderr || "");
    const looksLikeHelp =
      /Usage:\s.*rubberband(\.exe)?\b/i.test(text) ||
      /An audio time-stretching and pitch-shifting/i.test(text);
    if (looksLikeHelp) {
      return {
        available: true,
        reason: `help shown (exit ${r.status ?? "unknown"})`,
      };
    }

    // 3) No luck: report details
    return {
      available: false,
      reason: `Exit code ${r.status ?? "unknown"}.\nstdout:\n${
        r.stdout || ""
      }\nstderr:\n${r.stderr || ""}`,
    };
  } catch (e) {
    return { available: false, reason: String((e && e.message) || e) };
  }
}


// ──────────────────────────────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────────────────────────────
function defaultOutputFor(inputPath) {
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath).replace(/\.[^.]+$/, "");
  return path.join(dir, `${base}.vofix.wav`);
}

// Build FFmpeg filter chain (clean + tone + dynamics + loudness)
function buildFfmpegFilter(opts, { fastPreview = false } = {}) {
  const {
    highpassHz = 80,
    denoise = "afftdn", // 'afftdn' | 'anlmdn'
    denoiseAmount = -25, // for afftdn: noise floor (nf)
    dehum = true, // notch 50/100/150 Hz
    deesserIntensity = 0.5, // 0..1
    compThreshold = -18, // dBFS
    compRatio = 3,
    compAttack = 15, // ms
    compRelease = 100, // ms
    compMakeup = 6, // dB
    limiterCeiling = 0.95, // 0..1
    loudnormI = -19, // LUFS (mono VO)
    loudnormLRA = 7,
    loudnormTP = -1.0,
    addAir = 0, // dB @ 11k
    addPresence = 2, // dB @ 3.5k
  } = opts || {};

  const chain = [];
  chain.push(`highpass=f=${highpassHz}`);

  if (denoise === "afftdn") chain.push(`afftdn=nf=${denoiseAmount}`);
  else if (denoise === "anlmdn") chain.push("anlmdn");

  if (dehum) {
    chain.push("equalizer=f=50:width_type=h:width=50:g=-20");
    chain.push("equalizer=f=100:width_type=h:width=50:g=-15");
    chain.push("equalizer=f=150:width_type=h:width=50:g=-10");
  }

  if (addPresence)
    chain.push(`equalizer=f=3500:width_type=q:w=1.0:g=${addPresence}`);
  if (addAir) chain.push(`equalizer=f=11000:width_type=q:w=0.7:g=${addAir}`);

  const deess = Math.max(0, Math.min(1, Number(deesserIntensity)));
  chain.push(`deesser=i=${deess}`);

  chain.push(
    `acompressor=threshold=${compThreshold}dB:ratio=${compRatio}:attack=${compAttack}:release=${compRelease}:makeup=${compMakeup}`
  );

  chain.push(`alimiter=limit=${limiterCeiling}`);

  // Skip loudnorm in fast previews to speed them up
  if (!fastPreview)
    chain.push(`loudnorm=I=${loudnormI}:LRA=${loudnormLRA}:TP=${loudnormTP}`);

  return chain.join(",");
}

function runFfmpeg({
  input,
  output,
  filter,
  reSampleHz = 48000,
  channels = 2,
  durationSec = null,
}) {
  return new Promise((resolve, reject) => {
    if (!ffmpegStatic) return reject(new Error("ffmpeg binary not found"));

    const args = [
      "-y",
      "-hide_banner",
      "-i",
      input,
      ...(durationSec ? ["-t", String(durationSec)] : []),
      ...(filter ? ["-af", filter] : []),
      "-ar",
      String(reSampleHz),
      "-ac",
      String(channels),
      ...(/\.(mp3)$/i.test(output)
        ? ["-c:a", "libmp3lame", "-b:a", "192k"]
        : /\.(m4a|aac)$/i.test(output)
        ? ["-c:a", "aac", "-b:a", "192k"]
        : ["-c:a", "pcm_s16le"]), // s16 for speed
      output,
    ];

    if (filter) logToRenderer(`Using filter: ${filter}`);

    const proc = spawn(ffmpegStatic, args);

    proc.stderr.on("data", (d) => {
      logToRenderer(d.toString());
    });

    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve({ ok: true, output });
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

// Stage: decode to WAV (utility)
async function decodeToWav({
  input,
  output,
  ar = 48000,
  ac = 2,
  durationSec = null,
}) {
  return runFfmpeg({
    input,
    output,
    filter: null,
    reSampleHz: ar,
    channels: ac,
    durationSec,
  });
}

// Stage: Rubber Band (pitch/tempo/formant preserve) → WAV
// Stage: Rubber Band (pitch/tempo/formant preserve) → WAV
async function runRubberband({ inputWav, outputWav, pitchSemi = 0, tempo = 1.0, preserveFormants = true }) {
  return new Promise((resolve, reject) => {
    const exe = getRubberbandPath();
    const args = [];

    // Tempo: use -T (tempo multiple). 1.20 = 120% tempo (faster)
    if (tempo && tempo !== 1.0) args.push('-T', String(tempo));

    // Pitch in semitones
    if (pitchSemi && pitchSemi !== 0) args.push('-p', String(pitchSemi));

    // Preserve timbre (only meaningful when pitch shifting)
    if (preserveFormants && pitchSemi !== 0) args.push('--formant');

    // Prefer the finer engine when available (quality > speed)
    // -3 selects R3 engine on builds that support it; harmless otherwise
    args.push('-3');

    // IMPORTANT: remove '--detect' (not supported on some Windows builds)
    // args.push('--detect'); // ← removed

    args.push(inputWav, outputWav);

    const proc = spawn(exe, args);
    proc.stderr.on('data', (d) => logToRenderer('[rubberband] ' + d.toString()));
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve({ ok: true });
      else reject(new Error(`rubberband exited with code ${code}`));
    });
  });
}


// High-level pipeline: (optional) Rubber Band → Master chain
async function processPipeline({
  inputPath,
  outputPath,
  options,
  isPreview = false,
}) {
  const tmpDir = app.getPath("temp");
  const fastPreview = isPreview;

  const {
    useRubberband = false,
    pitchSemi = 0,
    tempoPct = 100,
    preserveFormants = true,
  } = options?.voiceShape || {};

  const det = checkRubberbandAvailableDetailed();
  const rbRequested = pitchSemi !== 0 || tempoPct !== 100; // only run when audible change requested
  // const wantRb = useRubberband && det.available && rbRequested;
  const wantRb = det.available && rbRequested; // ignore renderer flag to avoid races

  logToRenderer(
    `[voice-shape] requested: pitch=${pitchSemi} semitones, tempo=${tempoPct}%, formant=${!!preserveFormants}, rbAvail=${!!det.available}, runRB=${wantRb}`
  );

  let sourceForMaster = inputPath;
  const intermediates = [];

  try {
    if (wantRb) {
      // 1) decode input to WAV (preview: short mono; final: full/stereo)
      const ar = 48000;
      const ac = isPreview ? 1 : 2;
      const decWav = path.join(tmpDir, `vofix-dec-${randomUUID()}.wav`);
      await decodeToWav({
        input: inputPath,
        output: decWav,
        ar,
        ac,
        durationSec: isPreview ? 8 : null,
      });
      intermediates.push(decWav);

      // 2) rubberband to WAV
      const rbOut = path.join(tmpDir, `vofix-rb-${randomUUID()}.wav`);
      const tempoRatio = Math.max(0.8, Math.min(1.25, tempoPct / 100)); // clamp a bit
      const clampedPitch = Math.max(-6, Math.min(6, pitchSemi));
      logToRenderer(
        `[rubberband] running with pitch=${clampedPitch} st, tempo=${tempoRatio}, formant=${!!preserveFormants}`
      );
      await runRubberband({
        inputWav: decWav,
        outputWav: rbOut,
        pitchSemi: clampedPitch,
        tempo: tempoRatio,
        preserveFormants: !!preserveFormants,
      });
      intermediates.push(rbOut);

      sourceForMaster = rbOut;
    } else if (isPreview) {
      logToRenderer(
        "[rubberband] bypassed (no audible pitch/tempo change requested)"
      );
      // No rubberband: decode short mono WAV for faster preview
      const decWav = path.join(tmpDir, `vofix-dec-${randomUUID()}.wav`);
      await decodeToWav({
        input: inputPath,
        output: decWav,
        ar: 32000,
        ac: 1,
        durationSec: 8,
      });
      intermediates.push(decWav);
      sourceForMaster = decWav;
    }

    // 3) Master chain (clean, tone, dynamics, loudness)
    const filter = buildFfmpegFilter(options, { fastPreview });
    const reSampleHz = isPreview
      ? sourceForMaster === inputPath
        ? 32000
        : 48000
      : 48000;
    const channels = isPreview ? 1 : 2;

    const res = await runFfmpeg({
      input: sourceForMaster,
      output: outputPath,
      filter,
      reSampleHz,
      channels,
      durationSec: null,
    });

    return res;
  } finally {
    // Clean up intermediates
    for (const f of intermediates) {
      try {
        fs.rmSync(f, { force: true });
      } catch {}
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
/** Temp previews cleanup: keep newest 5, never delete the current one */
function cleanupOldPreviewsKeepCurrent(currentPath) {
  const tmpDir = app.getPath("temp");
  try {
    const entries = fs
      .readdirSync(tmpDir)
      .filter((f) => f.startsWith("vofix-preview-") && f.endsWith(".wav"))
      .map((f) => {
        const full = path.join(tmpDir, f);
        let mtime = 0;
        try {
          mtime = fs.statSync(full).mtimeMs;
        } catch {}
        return { full, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime); // newest first

    const keep = new Set([currentPath]);
    for (const e of entries.filter((x) => !keep.has(x.full)).slice(5)) {
      try {
        fs.rmSync(e.full, { force: true });
      } catch {}
    }
  } catch {}
}

// ──────────────────────────────────────────────────────────────────────────────
/** IPC */
// Rubber Band helpers
ipcMain.handle("rb-get", async () => {
  const exe = getRubberbandPath();
  const det = checkRubberbandAvailableDetailed();
  return {
    available: det.available,
    reason: det.reason,
    path: path.isAbsolute(exe) ? exe : store.get("rbPath") || "",
    viaPath: !store.get("rbPath"),
  };
});

ipcMain.handle("rb-set", async (_evt, newPath) => {
  if (!newPath) {
    setRubberbandPath(null);
    const det = checkRubberbandAvailableDetailed();
    return { ok: true, available: det.available, reason: det.reason, path: "" };
  }
  setRubberbandPath(newPath);
  const det = checkRubberbandAvailableDetailed();
  return {
    ok: true,
    available: det.available,
    reason: det.reason,
    path: newPath,
  };
});

ipcMain.handle("rb-pick", async () => {
  const res = await dialog.showOpenDialog(win, {
    title: "Locate rubberband executable",
    filters: [
      ...(process.platform === "win32"
        ? [{ name: "Executable", extensions: ["exe"] }]
        : [{ name: "Executable", extensions: ["*"] }]),
    ],
    properties: ["openFile"],
  });
  if (res.canceled || !res.filePaths?.[0]) return { canceled: true };
  const p = res.filePaths[0];
  setRubberbandPath(p);
  const det = checkRubberbandAvailableDetailed();
  return {
    canceled: false,
    path: p,
    available: det.available,
    reason: det.reason,
  };
});

// File picking
ipcMain.handle("pick-input", async () => {
  const startDir = store.get("lastDir") || app.getPath("home");
  const res = await dialog.showOpenDialog(win, {
    title: "Choose audio file",
    defaultPath: startDir,
    properties: ["openFile"],
    filters: [
      {
        name: "Audio",
        extensions: ["wav", "mp3", "m4a", "aac", "flac", "ogg"],
      },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (res.canceled || !res.filePaths?.[0]) return null;
  const file = res.filePaths[0];
  store.set("lastDir", path.dirname(file));
  return file;
});

// Default output path
ipcMain.handle("get-default-output", async (_evt, inputPath) => {
  if (!inputPath) return null;
  return defaultOutputFor(inputPath);
});

// Full processing (export)
ipcMain.handle("process-audio", async (_evt, payload) => {
  const { inputPath, options } = payload || {};
  if (!inputPath) throw new Error("Missing input path");

  const outputPath = defaultOutputFor(inputPath);
  const res = await processPipeline({
    inputPath,
    outputPath,
    options: { ...options },
    isPreview: false,
  });
  return res;
});

// Preview processing (fast)
ipcMain.handle("process-preview", async (_evt, payload) => {
  const { inputPath, options } = payload || {};
  if (!inputPath) throw new Error("Missing input path");

  const tmpOut = path.join(
    app.getPath("temp"),
    `vofix-preview-${randomUUID()}.wav`
  );

  await processPipeline({
    inputPath,
    outputPath: tmpOut,
    options,
    isPreview: true,
  });

  // Best-effort cleanup (keep newest 5, never current)
  cleanupOldPreviewsKeepCurrent(tmpOut);

  return { ok: true, previewPath: tmpOut };
});
