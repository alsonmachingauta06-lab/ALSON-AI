import fs from "node:fs";

const file = "lib/whatsappBot.js";
let s = fs.readFileSync(file, "utf8");

const anchor = 'import { GoogleGenAI } from "@google/genai";';
if (!s.includes('import * as statusBaileys from "gifted-baileys";')) {
  if (!s.includes(anchor)) throw new Error("Import anchor not found.");
  s = s.replace(anchor, 'import * as statusBaileys from "gifted-baileys";\n' + anchor);
}

const start = s.indexOf('case "togstatus": {');
const end = s.indexOf('case "menu":', start);
if (start < 0 || end < 0) throw new Error("Command boundaries not found.");

let block = s.slice(start, end);
block = block.replaceAll("downloadMediaMessage(", "statusBaileys.downloadMediaMessage(");
block = block.replaceAll("generateWAMessageContent(", "statusBaileys.generateWAMessageContent(");
block = block.replaceAll("generateWAMessageFromContent(", "statusBaileys.generateWAMessageFromContent(");

const oldText = /"Relay submitted\. Check the group profile to verify whether WhatsApp displays it as a group Status\."|"Status relay submitted\. Check the group's profile to confirm it appears as a group Status\."/;
if (!oldText.test(block)) {
  throw new Error("Could not locate old status confirmation; file not changed.");
}

block = block.replace(
  oldText,
  'media.type === "image" ? "✅ Image status sent!" : "✅ Video status sent!"'
);

const backup = file + ".bak-status-fork";
fs.copyFileSync(file, backup);
s = s.slice(0, start) + block + s.slice(end);
fs.writeFileSync(file, s);
console.log("Updated .togstatus. Backup:", backup);
