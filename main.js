// main.js — Electron main process (ESM), wired to preload.cjs
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import Store from "electron-store";
import ffmpegStatic from "ffmpeg-static";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const store = new Store({ name: "vo-fixer-prefs" });

let win;

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
// Helpers
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

  // For very fast previews, you can skip loudnorm:
  if (!fastPreview) {
    chain.push(`loudnorm=I=${loudnormI}:LRA=${loudnormLRA}:TP=${loudnormTP}`);
  }

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
      "-af",
      filter,
      "-ar",
      String(reSampleHz),
      "-ac",
      String(channels),
      // Choose codec by extension
      ...(/\.(mp3)$/i.test(output)
        ? ["-c:a", "libmp3lame", "-b:a", "192k"]
        : /\.(m4a|aac)$/i.test(output)
        ? ["-c:a", "aac", "-b:a", "192k"]
        : ["-c:a", "pcm_s16le"]), // s16 for speed, good enough
      output,
    ];

    win?.webContents.send("ffmpeg-log", `Using filter: ${filter}\n`);

    const proc = spawn(ffmpegStatic, args);

    proc.stderr.on("data", (d) => {
      win?.webContents.send("ffmpeg-log", d.toString());
    });

    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve({ ok: true, output });
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// IPC
// ──────────────────────────────────────────────────────────────────────────────

// Choose input file
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

// Compute default output path (same folder)
ipcMain.handle("get-default-output", async (_evt, inputPath) => {
  if (!inputPath) return null;
  return defaultOutputFor(inputPath);
});

// Process full audio and save (no output dialog)
ipcMain.handle("process-audio", async (_evt, payload) => {
  const { inputPath, options } = payload || {};
  if (!inputPath) throw new Error("Missing input path");

  const outputPath = defaultOutputFor(inputPath);
  const filter = buildFfmpegFilter(options, { fastPreview: false });
  const res = await runFfmpeg({
    input: inputPath,
    output: outputPath,
    filter,
    reSampleHz: 48000,
    channels: 2,
    durationSec: null,
  });
  return res;
});

// Process short preview and return temp file path (fast)
ipcMain.handle("process-preview", async (_evt, payload) => {
  const { inputPath, options, durationSec = 8 } = payload || {};
  if (!inputPath) throw new Error("Missing input path");

  const tmpDir = app.getPath("temp");
  const tmpOut = path.join(tmpDir, `vofix-preview-${randomUUID()}.wav`);

  // Fast settings: mono + 32 kHz + (optionally) skip loudnorm in filter
  const filter = buildFfmpegFilter(options, { fastPreview: true });
  await runFfmpeg({
    input: inputPath,
    output: tmpOut,
    filter,
    reSampleHz: 32000,
    channels: 1,
    durationSec,
  });

  // Best-effort cleanup of older previews
  // Best-effort cleanup: delete older preview files by mtime, never the current one
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
        return { f, full, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime); // newest first

    const keep = new Set([tmpOut]); // keep current for sure
    const toDelete = entries.filter((e) => !keep.has(e.full)).slice(5); // keep 5 newest previews in total (plus current)

    for (const e of toDelete) {
      try {
        fs.rmSync(e.full, { force: true });
      } catch {}
    }
  } catch {}

  return { ok: true, previewPath: tmpOut };
});
