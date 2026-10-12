import fs from "node:fs/promises";

const file = "server.js";
let src = await fs.readFile(file, "utf8");

const importLine = 'import { timingSafeEqual } from "node:crypto";';
const accountImport = `import {
  allowAuthAttempt, registerAccount, loginAccount,
  authenticateToken, revokeToken, listAccounts,
  setUserBadge, setUserBan
} from "./lib/accountStore.js";`;

if (!src.includes('from "./lib/accountStore.js"')) {
  if (!src.includes(importLine)) throw Error("Crypto import not found.");
  src = src.replace(importLine, importLine + "\n" + accountImport);
}

const anchor = 'app.get("/api/whatsapp/sessions", requireDashboardToken,';
if (!src.includes(anchor)) throw Error("WhatsApp route anchor not found.");

if (!src.includes('app.post("/api/auth/register"')) {
  const routes = `
function bearerToken(req) {
  return (req.headers.authorization || "").replace(/^Bearer\\s+/i, "");
}

app.post("/api/auth/register", async (req, res) => {
  const key = req.ip || "unknown";
  if (!allowAuthAttempt(key, "register"))
    return res.status(429).json({ok:false,error:"Too many attempts. Try later."});

  try {
    const user = await registerAccount(req.body?.username, req.body?.password);
    const login = await loginAccount(req.body?.username, req.body?.password);
    res.status(201).json({ok:true,token:login.token,user});
  } catch (e) {
    res.status(400).json({ok:false,error:String(e.message || "Registration failed.")});
  }
});

app.post("/api/auth/login", async (req, res) => {
  const key = (req.ip || "unknown") + ":" +
    String(req.body?.username || "").trim().toLowerCase();
  if (!allowAuthAttempt(key, "login"))
    return res.status(429).json({ok:false,error:"Too many attempts. Try later."});

  try {
    res.json({ok:true,...await loginAccount(req.body?.username,req.body?.password)});
  } catch {
    res.status(401).json({ok:false,error:"Incorrect username or password."});
  }
});

app.get("/api/auth/me", (req, res) => {
  const user = authenticateToken(bearerToken(req));
  if (!user) return res.status(401).json({ok:false,error:"Please log in."});
  res.json({ok:true,user});
});

app.post("/api/auth/logout", (req, res) => {
  revokeToken(bearerToken(req));
  res.json({ok:true});
});

app.get("/api/admin/users", requireDashboardToken, async (_req,res) => {
  res.json({ok:true,users:await listAccounts()});
});

app.post("/api/admin/users/:id/badge", requireDashboardToken, async (req,res) => {
  if (typeof req.body?.enabled !== "boolean")
    return res.status(400).json({ok:false,error:"enabled must be true or false."});
  const user = await setUserBadge(req.params.id,req.body.enabled);
  if (!user) return res.status(404).json({ok:false,error:"Account not found."});
  res.json({ok:true,user});
});

app.post("/api/admin/users/:id/ban", requireDashboardToken, async (req,res) => {
  let until = null;
  if (req.body?.unban !== true) {
    const minutes = Number(req.body?.durationMinutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 525600)
      return res.status(400).json({ok:false,error:"durationMinutes must be 1–525600, or set unban:true."});
    until = new Date(Date.now()+minutes*60000).toISOString();
  }
  try {
    const user = await setUserBan(req.params.id,until,req.body?.reason || "");
    if (!user) return res.status(404).json({ok:false,error:"Account not found."});
    res.json({ok:true,user});
  } catch (e) {
    res.status(400).json({ok:false,error:String(e.message || "Ban update failed.")});
  }
});

`;
  src = src.replace(anchor, routes + anchor);
}

const backup = "server.js.before-account-routes";
try {
  await fs.access(backup);
} catch {
  await fs.copyFile(file, backup);
}
await fs.writeFile(file, src);
console.log("Account API patch applied.");
