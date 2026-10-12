import { generateWAMessageFromContent } from "@whiskeysockets/baileys";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import * as statusBaileys from "gifted-baileys";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);


let pairingRequester = null;

export function setPairingRequester(fn) {
  pairingRequester = typeof fn === "function" ? fn : null;
}

const SETTINGS_FILE = path.resolve("data/whatsapp-bot-settings.json");
const CHANNEL = "https://whatsapp.com/channel/0029Vb7dL1LHltY3pgCvwR3B";
const NEWSLETTER_JID = "120363411442434414@newsletter";
const GROUP = "https://chat.whatsapp.com/LQMrievFuQW6GyqDRxuvRu?s=cl&p=a&mlu=4&ilr=4";
const OWNER_NUMBERS = new Set(
  (process.env.ALSON_OWNER_NUMBERS || "263786359833,263783549857")
    .split(",").map(x => x.replace(/\D/g, "")).filter(Boolean)
);

let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
} catch {}

const histories = new Map();

function saveSettings() {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  const temp = SETTINGS_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2), { mode: 0o600 });
  fs.renameSync(temp, SETTINGS_FILE);
}

function configFor(phone) {
  settings[phone] ||= { prefix: ".", chatbot: false };
  return settings[phone];
}

function unwrap(message) {
  while (message?.ephemeralMessage?.message ||
         message?.viewOnceMessage?.message ||
         message?.viewOnceMessageV2?.message ||
         message?.documentWithCaptionMessage?.message) {
    message = message.ephemeralMessage?.message ||
              message.viewOnceMessage?.message ||
              message.viewOnceMessageV2?.message ||
              message.documentWithCaptionMessage?.message;
  }
  return message || {};
}

function getText(message) {
  const m = unwrap(message?.message);
  return String(
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.templateButtonReplyMessage?.displayText ||
    ""
  ).trim();
}

function footer() {
  return `\n\n✦ ALSON AI 🇿🇼` +
    `\n📢 View Channel: ${CHANNEL}` +
    `\n📰 Newsletter JID: ${NEWSLETTER_JID}` +
    `\n👥 View Group: ${GROUP}`;
}

function fakeQuote(jid, phone) {
  return {
    key: {
      participant: "0@s.whatsapp.net",
      remoteJid: "0@s.whatsapp.net",
      fromMe: false,
      id: "OFFICIAL_VERIFIED_BADGE"
    },
    message: {
      conversation:
        "ALSON-XMD (Official Verification Badge)\\n" +
        String(phone || "")
    }
  };
}

async function reply(sock, jid, original, text) {
  const sessionPhone = socketPhones.get(sock);
  const body = String(text).slice(0, 3000) + footer();

  console.log("[WA TX TEXT ATTEMPT]", {
    phone: sessionPhone || "unknown",
    chatType: jid.endsWith("@g.us") ? "group" : "direct"
  });

  try {
    const result = await sock.sendMessage(jid, {
      text: body
    }, original?.key ? { quoted: original } : {});

    console.log("[WA TX TEXT ACCEPTED]", {
      phone: sessionPhone || "unknown",
      messageId: result?.key?.id || null
    });

    return result;
  } catch (error) {
    console.error("[WA TX TEXT FAILED]", {
      phone: sessionPhone || "unknown",
      error: error?.message || String(error)
    });
    throw error;
  }
}

function isOwner(jid) {
  return OWNER_NUMBERS.has(String(jid || "").split("@")[0].replace(/\D/g, ""));
}

async function askAI(text, jid) {
  if (!process.env.GEMINI_API_KEY) {
    return "The AI chatbot is unavailable because GEMINI_API_KEY is not configured.";
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const history = histories.get(jid) || [];
  const contents = [
    ...history.slice(-10),
    { role: "user", parts: [{ text }] }
  ];

  const result = await ai.models.generateContent({
    model: process.env.ALSON_AI_MODEL || "gemini-3.5-flash-lite",
    contents,
    config: {
      systemInstruction:
        "You are ALSON AI, created by Alson Machingauta 🇿🇼. " +
        "Be natural, helpful, concise, and conversational. " +
        "Help with programming and legitimate defensive cybersecurity. " +
        "Do not claim to be human or an official WhatsApp verified account.",
      temperature: 0.8,
      maxOutputTokens: 450
    }
  });

  const answer = String(result.text || "").trim() || "I couldn't generate a response.";
  histories.set(jid, [
    ...history.slice(-10),
    { role: "user", parts: [{ text }] },
    { role: "model", parts: [{ text: answer }] }
  ]);
  return answer;
}


async function downloadStatusMedia(source, type) {
  const stream = await downloadContentFromMessage(source, type);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function statusMediaFrom(message) {
  const m = unwrap(message || {});
  if (m.imageMessage) return { source: m.imageMessage, type: "image" };
  if (m.videoMessage) return { source: m.videoMessage, type: "video" };
  if (m.audioMessage) return { source: m.audioMessage, type: "audio" };
  return null;
}


const fakeQuotePatchedSockets = new WeakSet();
const socketPhones = new WeakMap();

function installGlobalFakeQuote(sock, phone) {
  if (!sock) return;
  socketPhones.set(sock, String(phone || "").replace(/\D/g, ""));
  if (fakeQuotePatchedSockets.has(sock)) return;
  if (typeof sock.sendMessage !== "function") return;

  const originalSend = sock.sendMessage.bind(sock);

  const globalFakeQuoted = {
    key: {
      participant: '0@s.whatsapp.net',
      remoteJid: '0@s.whatsapp.net',
      fromMe: false,
      id: 'OFFICIAL_VERIFIED_BADGE'
    },
    message: {
      conversation:
        'ALSON-XMD (Official Verification Badge)\n' +
        phone
    }
  };

  sock.sendMessage = async function (jid, content, options = {}) {
    const skip =
      content?.react ||
      content?.delete ||
      content?.edit ||
      content?.forward ||
      options?.statusJidList ||
      jid === 'status@broadcast' ||
      (jid === NEWSLETTER_JID || String(jid).endsWith('@newsletter'));

    if (!skip && !options?.noFake) {
      options = {
        ...options,
        quoted: globalFakeQuoted
      };
    }

    return originalSend(jid, content, options);
  };

  fakeQuotePatchedSockets.add(sock);
}


// Generate fresh content for each fun command; this does not alter chat history.
async function generateFunContent(kind, details = "") {
  if (!process.env.GEMINI_API_KEY) {
    return "AI generation needs GEMINI_API_KEY configured in your .env file.";
  }

  const prompts = {
    joke: "Create one fresh, genuinely funny joke. Avoid repeating stock jokes.",
    darkjoke: "Create one dark-humour joke. Keep it fictional and avoid hateful or cruel targeting.",
    roast: "Write one witty, playful roast. Keep it light and do not target protected traits.",
    riddle: "Invent one original riddle and put its answer on a separate final line.",
    truth: "Generate one interesting truth-question for a friendly group game.",
    dare: "Generate one fun, safe, non-humiliating dare.",
    fact: "Give one interesting factual claim. If uncertain, choose a well-established fact.",
    pickup: "Write one original, playful, respectful pickup line.",
    quote: "Write one original, memorable motivational quote. Do not attribute it to a real person.",
    story: "Write a short, entertaining original story with a twist ending.",
    novel: "Write the opening of an original mini-novel in a compelling style, maximum 350 words."
  };

  const prompt = prompts[kind];
  if (!prompt) throw new Error("Unknown content generator.");

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const result = await ai.models.generateContent({
    model: process.env.ALSON_AI_MODEL || "gemini-3.5-flash-lite",
    contents: [{
      role: "user",
      parts: [{
        text: "You are ALSON AI, created by Alson Machingauta in Zimbabwe. " +
          prompt + (details ? "\nUser's topic or names: " + details : "")
      }]
    }],
    config: { temperature: 0.95, maxOutputTokens: 500 }
  });

  return String(result.text || "").trim() || "I couldn't generate that just now.";
}


const OFFLINE_VOICE_BASES = [
  "en-us", "en-gb", "en-gb-scotland", "en-029", "en-us-nyc",
  "en-gb-x-rp", "en-gb-x-gbcwmd", "en-gb-x-gbclan", "en-shaw", "en"
];

function offlineVoicePreset(n) {
  const i = n - 1;
  return {
    voice: OFFLINE_VOICE_BASES[Math.floor(i / 10)],
    pitch: 35 + (i % 10) * 7,
    speed: 125 + (i % 10) * 15
  };
}

async function generateOfflineSpeech(sock, jid, message, number, text) {
  text = String(text || "").trim();
  if (!text) {
    return reply(sock, jid, message,
      "Usage: .say Hello there or .voice1 Hello there (presets .voice1 to .voice100).");
  }
  if (text.length > 700) {
    return reply(sock, jid, message, "Keep offline speech under 700 characters.");
  }

  const preset = offlineVoicePreset(number);
  const dir = path.join(os.tmpdir(), "alson-tts-" + randomBytes(6).toString("hex"));
  fs.mkdirSync(dir, { recursive: true });

  try {
    const wav = path.join(dir, "speech.wav");
    const mp3 = path.join(dir, "speech.mp3");

    await execFileAsync("espeak", [
      "-v", preset.voice, "-p", String(preset.pitch),
      "-s", String(preset.speed), "-a", "160", "-w", wav, text
    ], { timeout: 60000 });

    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-i", wav,
      "-codec:a", "libmp3lame", "-q:a", "4", mp3
    ], { timeout: 60000 });

    const audio = fs.readFileSync(mp3);
    if (!audio.length) throw new Error("Generated audio is empty.");

    await sock.sendMessage(jid, {
      audio: audio, mimetype: "audio/mpeg", ptt: false
    }, { quoted: message });

    console.log("[ALSON AI offline TTS]", number, preset.voice);
  } catch (err) {
    console.error("[ALSON AI offline TTS]", err?.message || err);
    return reply(sock, jid, message,
      "Offline speech failed. Check eSpeak and FFmpeg.");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const AUDIO_EFFECTS = {
  bass:       { filter: "bass=g=10", description: "Deep bass boost" },
  robot:      { filter: "aecho=0.8:0.88:60:0.4,highpass=f=250,lowpass=f=3200", description: "Robotic echo effect" },
  chipmunk:   { filter: "asetrate=44100*1.25,aresample=44100", description: "High-pitched, faster voice" },
  echo:       { filter: "aecho=0.8:0.9:700:0.35", description: "Echo" },
  reverb:     { filter: "aecho=0.8:0.88:60|90:0.4|0.3", description: "Reverb-like ambience" },
  nightcore:  { filter: "asetrate=44100*1.15,aresample=44100", description: "Higher-pitched, faster audio" },
  slowaudio:  { filter: "atempo=0.75", description: "Slower audio" },
  reverse:    { filter: "areverse", description: "Reversed audio" }
};

async function processQuotedAudio(sock, jid, message, effectName) {
  const current = unwrap(message.message || {});
  const context = current.extendedTextMessage?.contextInfo;
  const quoted = context?.quotedMessage;
  const media = statusMediaFrom(quoted);

  if (!media || media.type !== "audio") {
    return reply(sock, jid, message,
      "Reply to an audio or voice message with ." + effectName + " to apply the effect.");
  }

  const effect = AUDIO_EFFECTS[effectName];
  if (!effect) throw new Error("Unknown audio effect.");

  const dir = path.join(os.tmpdir(), "alson-ai-audio-" + randomBytes(6).toString("hex"));
  fs.mkdirSync(dir, { recursive: true });

  try {
    const mediaMessage = {
      key: {
        remoteJid: jid,
        fromMe: false,
        id: context.stanzaId || message.key.id,
        participant: context.participant || message.key.participant
      },
      message: quoted
    };

    const buffer = await statusBaileys.downloadMediaMessage(
      mediaMessage,
      "buffer",
      {},
      { reuploadRequest: sock.updateMediaMessage }
    );

    if (!buffer?.length) throw new Error("The audio download was empty.");

    const input = path.join(dir, "input");
    const output = path.join(dir, "output.mp3");
    fs.writeFileSync(input, buffer);

    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", input,
      "-vn", "-af", effect.filter,
      "-codec:a", "libmp3lame", "-q:a", "4",
      output
    ], { timeout: 120000, maxBuffer: 2 * 1024 * 1024 });

    const processed = fs.readFileSync(output);
    if (!processed.length) throw new Error("FFmpeg produced an empty audio file.");

    await sock.sendMessage(jid, {
      audio: processed,
      mimetype: "audio/mpeg",
      ptt: false
    }, { quoted: message });

    return;
  } catch (error) {
    console.error("[ALSON AI audio effect]", effectName, error?.message || error);
    return reply(sock, jid, message,
      "Audio effect failed: " + String(error?.message || error).slice(0, 180));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function handleWhatsAppMessage(sock, phone, message) {
  installGlobalFakeQuote(sock, phone);
  if (!message?.message) return;

  const jid = message.key?.remoteJid;
  if (!jid || jid === "status@broadcast" || jid.endsWith("@newsletter")) return;

  const text = getText(message);
  if (!text) return;

  const cfg = configFor(phone);
  const prefix = cfg.prefix;

  // Owner devices may issue commands from their own WhatsApp account.
  // Ignore ordinary outgoing messages to prevent chatbot loops.
  if (message.key?.fromMe) {
    const ownerPhone = String(phone || "").replace(/\D/g, "");
    if (!OWNER_NUMBERS.has(ownerPhone) ||
        !prefix || !text.startsWith(prefix)) return;
  }

  if (prefix && text.startsWith(prefix)) {
    const input = text.slice(prefix.length).trim();
    const [rawCommand, ...args] = input.split(/\s+/);
    const command = (rawCommand || "").toLowerCase();
    const argText = args.join(" ");

    if (command === "say" || /^voice(?:[1-9]\d?|100)$/.test(command)) {
      const n = command === "say" ? 1 : Number(command.slice(5));
      return generateOfflineSpeech(sock, jid, message, n, argText);
    }

    switch (command) {

      case "togstatus": {
  if (!jid.endsWith("@g.us")) {
    return reply(sock, jid, message,
      "Use .togstatus by replying to an image or video in a group.");
  }

  const current = unwrap(message.message || {});
  const context = current.extendedTextMessage?.contextInfo;
  const quoted = context?.quotedMessage || null;
  const media = statusMediaFrom(quoted) || statusMediaFrom(current);

  if (!media || !["image", "video"].includes(media.type)) {
    return reply(sock, jid, message,
      "Reply to an image or video with .togstatus.");
  }

  try {
    if (typeof sock.waUploadToServer !== "function") {
      throw new Error("Baileys media-upload function is unavailable.");
    }

    const mediaMessage = {
      key: {
        remoteJid: jid,
        fromMe: false,
        id: context?.stanzaId || message.key.id,
        participant: context?.participant || message.key.participant
      },
      message: quoted || current
    };

    const buffer = await statusBaileys.downloadMediaMessage(
      mediaMessage,
      "buffer",
      {},
      { reuploadRequest: sock.updateMediaMessage }
    );

    if (!buffer?.length) throw new Error("Downloaded media was empty.");

    const mediaContent = media.type === "image"
      ? { image: buffer, caption: media.source.caption || "" }
      : { video: buffer, caption: media.source.caption || "" };

    const content = await statusBaileys.generateWAMessageContent(mediaContent, {
      upload: sock.waUploadToServer
    });

    const secret = randomBytes(32);
    const innerMsg =
      typeof content.toJSON === "function" ? content.toJSON() : content;

    const fullContent = {
      messageContextInfo: { messageSecret: secret },
      groupStatusMessageV2: {
        message: {
          ...innerMsg,
          messageContextInfo: { messageSecret: secret }
        }
      }
    };

    const generated = statusBaileys.generateWAMessageFromContent(jid, fullContent, {});
    await sock.relayMessage(jid, generated.message, {
      messageId: generated.key.id
    });

    return reply(sock, jid, message,
      media.type === "image" ? "✅ Image status sent!" : "✅ Video status sent!");
  } catch (error) {
    console.error("[ALSON AI togstatus]", error?.stack || error);
    return reply(sock, jid, message,
      "❌ Status error: " +
      String(error?.message || error).slice(0, 250));
  }
}

case "menu":
      case "help":
        return reply(sock, jid, message, [
          "╭━━━『 ✨ 𝘼𝙇𝙎𝙊𝙉 𝘼𝙄 ✨ 』━━━╮",
          "┃ 🇿🇼 𝙎𝙈𝘼𝙍𝙏  •  𝙁𝘼𝙎𝙏  •  𝙋𝙊𝙒𝙀𝙍𝙁𝙐𝙇",
          "╰━━━━━━━━━━━━━━━━━━━━━━╯",
          "",
          `┏━━━「 ⚙️ 𝘽𝙊𝙏 𝙄𝙉𝙁𝙊 」`,
          `┃ 𝟬𝟭. ${prefix}menu       — Show this menu`,
          `┃ 𝟬𝟮. ${prefix}ping       — Check response`,
          `┃ 𝟬𝟯. ${prefix}creator    — Developer info`,
          `┃ 𝟬𝟰. ${prefix}owner      — Owner contact card`,
          `┃ 𝟬𝟱. ${prefix}togstatus  — Group status tool`,
          "┗━━━━━━━━━━━━━━━━━━━━━━",
          "",
          "┏━━━「 🤖 𝘼𝙄 𝘾𝙃𝘼𝙏 」",
          `┃ 𝟬𝟲. ${prefix}chatbot on  — Enable AI`,
          `┃ 𝟬𝟳. ${prefix}chatbot off — Disable AI`,
          "┗━━━━━━━━━━━━━━━━━━━━━━",
          "",
          "┏━━━「 🔐 𝙊𝙒𝙉𝙀𝙍 𝙎𝙀𝙏𝙏𝙄𝙉𝙂𝙎 」",
          `┃ 𝟬𝟴. ${prefix}pair <number> — Pair a device`,
          `┃ 𝟬𝟵. ${prefix}setprefix <symbol|none>`,
          "┗━━━━━━━━━━━━━━━━━━━━━━",
          "",
          "┏━━━「 💫 𝙁𝙐𝙉 」",
          `┃ 𝟭𝟬. ${prefix}simp — Simp response`,
          `┃ 𝟭𝟭. ${prefix}ship <name1> <name2>`,
          "┗━━━━━━━━━━━━━━━━━━━━━━",
          "",
          "┏━━━「 🎙️ 𝙊𝙁𝙁𝙇𝙄𝙉𝙀 𝙑𝙊𝙄𝘾𝙀𝙎 」",
          `┃ ${prefix}say <text> — Speak text offline`,
          `┃ ${prefix}voice1 <text> to ${prefix}voice100 <text>`,
          `┃ ${prefix}voices — Show voice and audio commands`,
          "┗━━━━━━━━━━━━━━━━━━━━━━",
          "",
          "╭───「 🌐 𝙌𝙐𝙄𝘾𝙆 𝙇𝙄𝙉𝙆𝙎 」",
          `┃ 📢 View Channel: ${CHANNEL}`,
          `┃ 📰 Newsletter JID: ${NEWSLETTER_JID}`,
          `┃ 👥 View Group: ${GROUP}`,
          "╰━━━━━━━━━━━━━━━━━━━━━━"
        ].join("\n"));

      case "pair": {
        if (jid.endsWith("@g.us") || jid.endsWith("@newsletter")) {
          return reply(sock, jid, message, "Use .pair in a private chat with the bot.");
        }
        if (!isOwner(jid)) {
          return reply(sock, jid, message, "Only the configured bot owner can start pairing.");
        }
        const target = (args[0] || "").replace(/\D/g, "");
        if (!/^\d{8,15}$/.test(target)) {
          return reply(sock, jid, message, "Usage: " + (prefix || ".") + "pair 263xxxxxxxx\nUse the full international number, digits only.");
        }
        if (!pairingRequester) {
          return reply(sock, jid, message, "Pairing service is not connected yet. Restart ALSON AI and try again.");
        }
        try {
          const code = await pairingRequester(target);
          return reply(sock, jid, message, "🔐 Pairing code for +" + target + ":\n\n" + code + "\n\nOn that phone, open WhatsApp → Linked devices → Link with phone number, then enter this code.");
        } catch (error) {
          return reply(sock, jid, message, "Pairing failed: " + String(error?.message || error));
        }
      }
      case "ping":
        return reply(sock, jid, message,
          "🏓 Pong! ALSON AI is responding.");
      case "owner":
      case "contact": {
        const ownerNumber = [...OWNER_NUMBERS][0] || "263786359833";
        const international = "+" + ownerNumber;
        const vcard = [
          "BEGIN:VCARD",
          "VERSION:3.0",
          "FN:Alson Machingauta",
          "ORG:ALSON-AI",
          `TEL;TYPE=CELL;TYPE=VOICE;waid=${ownerNumber}:${international}`,
          "NOTE:Developer of ALSON-AI",
          "END:VCARD"
        ].join("\\n");

        try {
          await sock.sendMessage(jid, {
            contacts: {
              displayName: "Alson Machingauta",
              contacts: [{
                displayName: "Alson Machingauta",
                vcard
              }]
            }
          });
          return reply(sock, jid, message,
            `👤 ALSON-AI Owner: Alson Machingauta 🇿🇼\\n📱 WhatsApp: ${international}\\nSave the contact card above.`);
        } catch (error) {
          console.error("[ALSON AI owner contact]", error?.message || error);
          return reply(sock, jid, message,
            `👤 Alson Machingauta — ALSON-AI Developer\\nWhatsApp: ${international}`);
        }
      }
      case "creator":
        return reply(sock, jid, message,
          "I was created by Alson Machingauta 🇿🇼, the developer behind ALSON-AI.");
      case "chatbot":
        if (!isOwner(message.key?.participant || jid)) {
          return reply(sock, jid, message, "Only the configured bot owner can change this setting.");
        }
        if (!["on", "off"].includes(argText.toLowerCase())) {
          return reply(sock, jid, message, `Usage: ${prefix}chatbot on/off`);
        }
        cfg.chatbot = argText.toLowerCase() === "on";
        saveSettings();
        return reply(sock, jid, message, `Chatbot ${cfg.chatbot ? "enabled" : "disabled"}.`);
      case "setprefix":
        if (!isOwner(message.key?.participant || jid)) {
          return reply(sock, jid, message, "Only the configured bot owner can change the prefix.");
        }
        if (!argText || argText.length > 4 || /\s/.test(argText)) {
          return reply(sock, jid, message, `Usage: ${prefix}setprefix <symbol|none>`);
        }
        cfg.prefix = argText.toLowerCase() === "none" ? "" : argText;
        saveSettings();
        return reply(sock, jid, message,
          `Prefix updated to: ${cfg.prefix || "(none)"}`);
      case "joke":
      case "darkjoke":
      case "roast":
      case "riddle":
      case "truth":
      case "dare":
      case "fact":
      case "pickup":
      case "quote":
      case "story":
      case "novel": {
        try {
          const generated = await generateFunContent(command, argText);
          return reply(sock, jid, message, generated);
        } catch (error) {
          console.error("[ALSON AI fun generator]", command, error?.message || error);
          return reply(sock, jid, message,
            "Generation failed. Check your Gemini API key, model setting, and internet connection.");
        }
      }

      case "voices":
        return reply(sock, jid, message, [
          "🎧 ALSON AI — OFFLINE VOICES & AUDIO EFFECTS",
          "",
          "🗣️ TEXT TO SPEECH (works offline)",
          "• " + prefix + "say <text> — Speak text using preset 1",
          "• " + prefix + "voice1 <text> through " + prefix + "voice100 <text>",
          "100 presets combine installed eSpeak voices, pitch and speed.",
          "",
          "🎛️ AUDIO EFFECTS (reply to an audio/voice message)",
          ...Object.entries(AUDIO_EFFECTS).map(([name, effect]) =>
            "• " + prefix + name + " — " + effect.description
          ),
          "",
          "Audio effects transform existing audio; they are not voice cloning."
        ].join("\n"));

      case "bass":
      case "robot":
      case "chipmunk":
      case "echo":
      case "reverb":
      case "nightcore":
      case "slowaudio":
      case "reverse":
        return processQuotedAudio(sock, jid, message, command);

      case "simp":
        return reply(sock, jid, message, "😳 Simp level: 100%. Respect and kindness always win!");
      case "ship": {
        const names = argText.split(/\s+/).filter(Boolean);
        if (names.length < 2) {
          return reply(sock, jid, message, `Usage: ${prefix}ship <name1> <name2>`);
        }
        const score = (names.join("💗").split("").reduce((n, c) => n + c.charCodeAt(0), 0) % 101);
        return reply(sock, jid, message, `💞 ${names[0]} × ${names[1]}\nCompatibility: ${score}%`);
      }
      default:
        return reply(sock, jid, message, `Unknown command: ${command}\nTry ${prefix}menu`);
    }
  }

  if (cfg.chatbot) {
    try {
      const answer = await askAI(text, `${phone}:${jid}`);
      await reply(sock, jid, message, answer);
    } catch (error) {
      console.error("[ALSON AI chatbot]", error?.message || error);
      await reply(sock, jid, message, "Sorry, I couldn't answer that just now.");
    }
  }
}
