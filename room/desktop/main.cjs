// TalkBack desktop shell.
// Runs the app's self-contained Nitro node-server as a child process (using
// Electron's bundled Node via ELECTRON_RUN_AS_NODE, so no system Node is
// required on the user's machine), then loads it in a window. Data (PGLite)
// lives under the per-user app-data dir so team state survives restarts.
//
// Two LAN modes, no cloud:
//   HOST — this PC runs the room server bound to 0.0.0.0 on a fixed port;
//          other PCs on the same network join by this PC's address.
//   JOIN — this PC runs no server; it points at a host's address.
// Mode is chosen at first run (picker), remembered in talkback.config.json,
// and overridable with --host / --join <url> / TALKBACK_JOIN_URL / TALKBACK_PORT.
const { app, BrowserWindow, shell, Menu, ipcMain, clipboard, dialog } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");

app.setName("TalkBack");

const isPackaged = app.isPackaged;
const appRoot = isPackaged ? path.join(process.resourcesPath, "app") : path.join(__dirname, "..");
const serverEntry = path.join(appRoot, ".output", "server", "index.mjs");
const DEFAULT_HOST_PORT = 8422;

let serverProc = null;
let mainWindow = null;
let pickerWindow = null;

function configPath() {
  return path.join(app.getPath("userData"), "talkback.config.json");
}
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    return {};
  }
}
function writeConfig(cfg) {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
  } catch (err) {
    console.error("[desktop] could not save config:", err?.message || err);
  }
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === "IPv4" && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

function portFree(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}
async function resolvePort(preferred, host) {
  if (await portFree(preferred, host)) return preferred;
  // Fall back to an ephemeral free port.
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, host, () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

function waitForServer(port, host, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host, port, path: "/", timeout: 3000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => (Date.now() > deadline ? reject(new Error("server start timeout")) : setTimeout(tick, 400)));
      req.on("timeout", () => {
        req.destroy();
        Date.now() > deadline ? reject(new Error("server start timeout")) : setTimeout(tick, 400);
      });
    };
    tick();
  });
}

function startServer(port, bindHost) {
  const dataDir = path.join(app.getPath("userData"), "db");
  fs.mkdirSync(dataDir, { recursive: true });
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    HOST: bindHost,
    PORT: String(port),
    NITRO_HOST: bindHost,
    NITRO_PORT: String(port),
    PGLITE_DATA_DIR: dataDir,
    DATABASE_URL: "",
  };
  serverProc = spawn(process.execPath, [serverEntry], { env, cwd: appRoot, stdio: ["ignore", "pipe", "pipe"] });
  serverProc.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
  serverProc.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  serverProc.on("exit", (code) => {
    console.error(`[desktop] server exited with code ${code}`);
    if (!app.isQuiting) app.quit();
  });
}

function buildMenu(joinLinks) {
  const template = [
    {
      label: "TalkBack",
      submenu: [
        joinLinks && joinLinks.length
          ? {
              label: "Copy this PC's join link",
              click: () => clipboard.writeText(joinLinks[0]),
            }
          : { label: "Join link unavailable (not hosting)", enabled: false },
        { type: "separator" },
        {
          label: "Switch mode (Host / Join)…",
          click: () => {
            writeConfig({});
            app.relaunch();
            app.exit(0);
          },
        },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function newWindow() {
  return new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0a0a0a",
    title: "TalkBack",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "build", "icon.ico"),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
}

async function runHost() {
  const bindHost = "0.0.0.0";
  const preferred = Number(process.env.TALKBACK_PORT) || DEFAULT_HOST_PORT;
  const port = await resolvePort(preferred, bindHost);
  startServer(port, bindHost);
  await waitForServer(port, "127.0.0.1");
  const links = lanAddresses().map((ip) => `http://${ip}:${port}/`);
  buildMenu(links);
  mainWindow = newWindow();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  if (links.length) {
    mainWindow.setTitle(`TalkBack — hosting · others join at ${links[0]}`);
    console.log(`[desktop] LAN join links: ${links.join(", ")}`);
  }
  mainWindow.on("closed", () => (mainWindow = null));
}

async function runJoin(url) {
  buildMenu(null);
  mainWindow = newWindow();
  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => {
    shell.openExternal(u);
    return { action: "deny" };
  });
  mainWindow.setTitle(`TalkBack — joined ${url}`);
  await mainWindow.loadURL(url);
  mainWindow.on("closed", () => (mainWindow = null));
}

function showPicker() {
  pickerWindow = new BrowserWindow({
    width: 560,
    height: 460,
    backgroundColor: "#0a0a0a",
    title: "TalkBack",
    resizable: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "build", "icon.ico"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true },
  });
  Menu.setApplicationMenu(null);
  pickerWindow.loadFile(path.join(__dirname, "picker.html"));
  pickerWindow.on("closed", () => (pickerWindow = null));
}

ipcMain.handle("talkback:choose", async (_e, choice) => {
  if (!choice || (choice.mode !== "host" && choice.mode !== "join")) return { ok: false };
  if (choice.mode === "join") {
    let url = String(choice.url || "").trim();
    if (!url) return { ok: false, error: "Enter the host address." };
    if (!/^https?:\/\//i.test(url)) url = "http://" + url;
    try {
      new URL(url);
    } catch {
      return { ok: false, error: "That address doesn't look right." };
    }
    writeConfig({ mode: "join", joinUrl: url });
  } else {
    writeConfig({ mode: "host" });
  }
  if (pickerWindow) pickerWindow.close();
  const cfg = readConfig();
  cfg.mode === "join" ? await runJoin(cfg.joinUrl) : await runHost();
  return { ok: true };
});

function cliOverride() {
  const args = process.argv.slice(1);
  const joinIdx = args.findIndex((a) => a === "--join");
  if (joinIdx >= 0 && args[joinIdx + 1]) return { mode: "join", joinUrl: args[joinIdx + 1] };
  if (args.includes("--host")) return { mode: "host" };
  if (process.env.TALKBACK_JOIN_URL) return { mode: "join", joinUrl: process.env.TALKBACK_JOIN_URL };
  return null;
}

async function boot() {
  const override = cliOverride();
  const cfg = override || readConfig();
  if (cfg.mode === "join" && cfg.joinUrl) return runJoin(cfg.joinUrl);
  if (cfg.mode === "host") return runHost();
  showPicker();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const w = mainWindow || pickerWindow;
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });
  app.whenReady().then(() => {
    boot().catch((err) => {
      console.error("[desktop] failed to start:", err);
      dialog.showErrorBox("TalkBack", String(err?.message || err));
      app.quit();
    });
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) boot();
    });
  });
}

app.on("before-quit", () => {
  app.isQuiting = true;
  if (serverProc) {
    try {
      serverProc.kill();
    } catch {
      /* ignore */
    }
  }
});
app.on("window-all-closed", () => app.quit());
