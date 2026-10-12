import { handleWhatsAppMessage, setPairingRequester } from "./whatsappBot.js";

setPairingRequester(requestPairingCode);
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers
} from "@whiskeysockets/baileys";

import pino from "pino";
import path from "node:path";
import fs from "node:fs/promises";

const ROOT = path.resolve("data/whatsapp-sessions");
const sessions = new Map();
const pending = new Map();
const logger = pino({ level: "silent" });

await fs.mkdir(ROOT, { recursive: true, mode: 0o700 });

function validPhone(phone) {
  return typeof phone === "string" &&
    /^\d{8,15}$/.test(phone);
}

function publicSession(phone, s) {
  return {
    phone,
    status: s.status,
    connected: s.status === "connected",
    updatedAt: s.updatedAt
  };
}

function finishPending(phone, error, value) {
  const waiting = pending.get(phone);
  if (!waiting) return;

  clearTimeout(waiting.timer);
  pending.delete(phone);

  if (error) waiting.reject(error);
  else waiting.resolve(value);
}

async function requestCodeFromSocket(phone, session) {
  const waiting = pending.get(phone);

  if (!waiting || waiting.requested ||
      !session?.socket || sessions.get(phone) !== session) return;

  waiting.requested = true;
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (pending.get(phone) !== waiting ||
        sessions.get(phone) !== session) return;

    try {
      const code = await session.socket.requestPairingCode(phone);
      if (!code) throw new Error("WhatsApp returned an empty pairing code.");
      finishPending(phone, null, String(code));
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 1800));
      }
    }
  }

  finishPending(
    phone,
    lastError || new Error("Could not generate a pairing code.")
  );
}

async function startSession(phone, { pairing = false } = {}) {
  const folder = path.join(ROOT, phone);
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });

  const { state, saveCreds } = await useMultiFileAuthState(folder);

  if (pairing && state.creds.registered) {
    throw new Error(
      "This number already has saved login credentials. Restore its session instead of pairing again."
    );
  }

  const s = {
    phone,
    status: state.creds.registered ? "connecting" : "pairing",
    updatedAt: new Date().toISOString(),
    socket: null,
    state,
    intentionalClose: false,
    reconnectTimer: null
  };

  sessions.set(phone, s);

  const sock = makeWASocket({
    auth: state,
    logger,
    browser: Browsers.ubuntu("Chrome"),
    printQRInTerminal: false,
    markOnlineOnConnect: false
  });

  s.socket = sock;
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    console.log("[WA RX EVENT]", { phone, type, count: messages?.length || 0 });
    if (type !== "notify") return;
    for (const message of messages || []) {
      const jid = message.key?.remoteJid || "";
      console.log("[WA RX MESSAGE]", {
        phone,
        fromMe: Boolean(message.key?.fromMe),
        chatType: jid.endsWith("@g.us") ? "group" :
          jid.endsWith("@newsletter") ? "newsletter" : "direct",
        hasMessage: Boolean(message.message)
      });
      void handleWhatsAppMessage(sock, phone, message).catch(error => {
        console.error("[ALSON AI bot handler]", error?.message || error);
      });
    }
  });

  sock.ev.on("connection.update", async update => {
    if (sessions.get(phone) !== s) return;

    s.updatedAt = new Date().toISOString();

    // Internal readiness signal only. Never expose QR data.
    if (pairing && update.qr) {
      void requestCodeFromSocket(phone, s);
    }

    if (update.connection === "open") {
      s.status = "connected";
      finishPending(phone, null, null);
    }

    if (update.connection === "close") {
      const disconnectError = update.lastDisconnect?.error;
      const statusCode = disconnectError?.output?.statusCode;

      console.error("[WhatsApp] Disconnect details:", {
        phone,
        statusCode: statusCode ?? null,
        message: disconnectError?.message ?? "No error message",
        reason: update.lastDisconnect?.error?.output?.payload?.message ?? null
      });

      s.status =
        statusCode === DisconnectReason.loggedOut
          ? "logged_out"
          : "disconnected";

      const waiting = pending.get(phone);
      if (waiting) {
        finishPending(
          phone,
          new Error("WhatsApp disconnected before pairing completed.")
        );
      }

      if (
        !s.intentionalClose &&
        statusCode !== DisconnectReason.loggedOut
      ) {
        clearTimeout(s.reconnectTimer);
        s.reconnectTimer = setTimeout(async () => {
          if (sessions.get(phone) !== s) return;

          console.log("[WhatsApp] Reconnect starting", { phone });

          try {
            // Retire the disconnected socket before replacing its session.
            try { s.socket?.end(undefined); } catch {}
            await startSession(phone);
          } catch (error) {
            if (sessions.get(phone) === s) {
              s.status = "error";
              s.updatedAt = new Date().toISOString();
            }
            console.error("[WhatsApp] Reconnect failed", {
              phone,
              error: error?.message || String(error)
            });
          }
        }, 3000);
      }
    }


  });

  return s;
}

export async function requestPairingCode(phone) {
  if (!validPhone(phone)) {
    throw new Error(
      "Enter the phone number with country code, digits only."
    );
  }

  if (pending.has(phone)) {
    throw new Error("A pairing request is already running.");
  }

  const existing = sessions.get(phone);

  if (existing?.status === "connected") {
    throw new Error("This WhatsApp number is already connected.");
  }

  if (existing?.socket) {
    existing.intentionalClose = true;
    clearTimeout(existing.reconnectTimer);
    try { existing.socket.end(undefined); } catch {}
    sessions.delete(phone);
  }

  let resolveCode;
  let rejectCode;

  const result = new Promise((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  // Avoid an unhandled rejection if session startup fails before awaiting result.
  result.catch(() => {});

  const timer = setTimeout(() => {
    finishPending(
      phone,
      new Error("Pairing timed out. Please try again.")
    );

    const s = sessions.get(phone);
    if (s && s.status !== "connected") {
      s.intentionalClose = true;
      clearTimeout(s.reconnectTimer);
      try { s.socket?.end(undefined); } catch {}
      sessions.delete(phone);
    }
  }, 45000);

  pending.set(phone, {
    resolve: resolveCode,
    reject: rejectCode,
    timer,
    requested: false
  });

  try {
    await startSession(phone, { pairing: true });

    // Fallback: request a code after socket initialization even if no QR
    // update is emitted. The pending flag prevents duplicate requests.
    await new Promise(resolve => setTimeout(resolve, 2000));
    const current = sessions.get(phone);
    if (current) void requestCodeFromSocket(phone, current);

    return await result;
  } catch (error) {
    finishPending(phone, error);
    throw error;
  }
}

export function listSessions() {
  return [...sessions.entries()].map(([phone, s]) =>
    publicSession(phone, s)
  );
}

export async function disconnectSession(phone) {
  const s = sessions.get(phone);
  if (!s) return false;

  s.intentionalClose = true;
  clearTimeout(s.reconnectTimer);
  finishPending(phone, new Error("Pairing cancelled."));

  try { s.socket?.end(undefined); } catch {}

  s.status = "disconnected";
  s.updatedAt = new Date().toISOString();
  sessions.delete(phone);
  return true;
}

export async function restoreSessions() {
  const entries = await fs.readdir(ROOT, { withFileTypes: true });

  for (const entry of entries) {
    const phone = entry.name;

    if (!entry.isDirectory() || !validPhone(phone)) continue;
    if (sessions.has(phone)) continue;

    try {
      const folder = path.join(ROOT, phone);
      const { state } = await useMultiFileAuthState(folder);

      if (!state.creds.registered) continue;

      await startSession(phone);
    } catch (error) {
      console.error("[WhatsApp] Session restore failed for", phone, error);
    }
  }
}
