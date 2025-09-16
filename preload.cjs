// preload.cjs — expose Rubber Band path helpers too
const { contextBridge, ipcRenderer } = require("electron");
const { pathToFileURL } = require("node:url");

contextBridge.exposeInMainWorld("vofix", {
  // file ops
  pickInput: () => ipcRenderer.invoke("pick-input"),
  getDefaultOutput: (inputPath) =>
    ipcRenderer.invoke("get-default-output", inputPath),

  // processing
  processAudio: (payload) => ipcRenderer.invoke("process-audio", payload),
  processPreview: (payload) => ipcRenderer.invoke("process-preview", payload),

  // logs
  onLog: (cb) => ipcRenderer.on("ffmpeg-log", (_evt, msg) => cb(msg)),
  toFileUrl: (fsPath) => pathToFileURL(fsPath).toString(),

  // rubber band
  rbGet: () => ipcRenderer.invoke("rb-get"),
  rbSet: (p) => ipcRenderer.invoke("rb-set", p),
  rbPick: () => ipcRenderer.invoke("rb-pick"),
});
