import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BOT_ROOT = path.join(ROOT, "bots");
const SESSION_ROOT = path.join(ROOT, "data", "multibot-sessions");
const running = new Map();

const BOTS = Object.freeze({
  "alson": { label: "Alson", dir: path.join(BOT_ROOT, "ALSON-TOXIC"), entry: "index.js" },
  "alson-xmd": { label: "Alson XMD", dir: path.join(BOT_ROOT, "ALSON-XMD"), entry: "alson.js" },
  "alson-bot": { label: "Alson bot", dir: path.join(BOT_ROOT, "ALSON-BOT"), entry: "index.js" }
});

export function listAvailableBots() {
  return Object.entries(BOTS).map(([id, bot]) => ({ id, name: bot.label }));
}

function userHashFor(userId) {
  return crypto.createHash("sha256").update(String(userId)).digest("hex").slice(0, 24);
}

function processKey(userHash, botId, phone) {
  return `${userHash}:${botId}:${phone}`;
}

function pairingCodeFrom(output, botId) {
  const clean = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  const pattern = botId === "alson-xmd"
    ? /Alsonxmd Pair Code for \+\d+:\s*([A-Z0-9-]{6,20})/i
    : /PAIRING CODE\s*(?:\[[^\]]+\])?\s*:\s*([A-Z0-9-]{6,20})/i;
  return clean.match(pattern)?.[1] || null;
}

function terminate(entry) {
  if (!entry || entry.child.exitCode !== null || entry.stopping) return;
  entry.stopping = true;

  try {
    if (process.platform !== "win32" && entry.child.pid) {
      process.kill(-entry.child.pid, "SIGTERM");
    } else {
      entry.child.kill("SIGTERM");
    }
  } catch {
    try { entry.child.kill("SIGTERM"); } catch {}
  }
}

export function listUserBotProcesses(userId) {
  const userHash = userHashFor(userId);
  const result = [];

  for (const [key, entry] of running) {
    if (entry.userHash !== userHash) continue;
    if (entry.child.exitCode !== null) continue;

    result.push({
      bot: entry.botId,
      name: BOTS[entry.botId].label,
      phone: entry.phone,
      state: entry.stopping ? "stopping" : entry.code ? "running" : "requesting-code",
      startedAt: entry.startedAt
    });
  }

  return result;
}

export function stopUserBotProcess({ userId, botId, phone }) {
  if (!BOTS[botId]) throw new Error("Select one of the supported bots.");
  if (!/^\d{8,15}$/.test(phone)) throw new Error("Enter a valid international phone number.");

  const userHash = userHashFor(userId);
  const key = processKey(userHash, botId, phone);
  const entry = running.get(key);

  if (!entry || entry.child.exitCode !== null) {
    if (entry) running.delete(key);
    return { stopped: false, message: "No active integration process was found for that bot and number." };
  }

  terminate(entry);
  return { stopped: true, message: "Stop requested. Saved session files were not deleted." };
}

export function requestBotPairing({ userId, botId, phone }) {
  const bot = BOTS[botId];
  if (!bot) throw new Error("Select one of the supported bots.");
  if (!/^\d{8,15}$/.test(phone)) throw new Error("Enter a valid international phone number using digits only.");
  if (userId === undefined || userId === null || String(userId).trim() === "") {
    throw new Error("Your account could not be identified. Sign in again.");
  }

  const userHash = userHashFor(userId);
  const key = processKey(userHash, botId, phone);
  const previous = running.get(key);

  if (previous && previous.child.exitCode === null) {
    if (previous.stopping) {
      throw new Error("This integration is stopping. Wait a moment and try again.");
    }
    if (previous.code) {
      throw new Error(
        "This bot already generated a pairing code for this number. " +
        "Use the current code if it is still displayed, or stop this integration " +
        "before requesting a fresh code. Saved session files have not been changed."
      );
    }
    if (previous.promise) return previous.promise;
  }

  if (!fs.existsSync(path.join(bot.dir, bot.entry))) {
    throw new Error(`${bot.label} files are missing. Check the bots folder.`);
  }

  const sessionDir = path.join(SESSION_ROOT, botId, `${userHash}-${phone}`);
  fs.mkdirSync(sessionDir, { recursive: true });

  const env = {
    ...process.env,
    PORT: "0",
    PAIRING_NUMBER: phone,
    OWNER_NUMBER: phone,
    SESSION_ID: "",
    ALSON_SESSION_DIR: sessionDir,
    ALSON_SESSION_ROOT: sessionDir
  };

  const child = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["start"],
    {
      cwd: bot.dir,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  const entry = {
    child, userHash, botId, phone,
    code: null, promise: null, stopping: false,
    startedAt: new Date().toISOString()
  };
  running.set(key, entry);

  entry.promise = new Promise((resolve, reject) => {
    let settled = false;
    let output = "";
    let stdoutTail = "";
    let stderrTail = "";

    const finish = (error, code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (error) {
        if (running.get(key) === entry) running.delete(key);
        terminate(entry);
        reject(error);
        return;
      }

      entry.code = code;
      resolve(code);
    };

    const timer = setTimeout(() => {
      const detail = [
        stdoutTail.trim() && `STDOUT: ${stdoutTail.trim()}`,
        stderrTail.trim() && `STDERR: ${stderrTail.trim()}`
      ].filter(Boolean).join("\\n").slice(-2400);

      finish(new Error(
        `No pairing code was received from ${bot.label} within 45 seconds.` +
        (detail ? ` Startup detail:\\n${detail}` : " No startup output was captured.")
      ));
    }, 45000);

    const inspectOutput = chunk => {
      output = (output + chunk).slice(-16000);
      const code = pairingCodeFrom(output, botId);
      if (code) finish(null, code);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdoutTail = (stdoutTail + chunk).slice(-4000);
      inspectOutput(chunk);
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => {
      stderrTail = (stderrTail + chunk).slice(-3000);
      inspectOutput(chunk);
    });

    child.on("error", () => {
      finish(new Error(`Could not launch ${bot.label}. Check Node.js and its installed dependencies.`));
    });

    child.on("exit", (code, signal) => {
      if (!settled) {
        const detail = stderrTail.trim().slice(-800);
        finish(new Error(
          `${bot.label} stopped before returning a pairing code (exit ${code ?? signal ?? "unknown"}).` +
          (detail ? ` Startup detail: ${detail}` : " Check its dependencies and startup logs.")
        ));
      }
      if (running.get(key) === entry) running.delete(key);
    });
  });

  return entry.promise;
}
