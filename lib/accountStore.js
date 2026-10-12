import fs from "node:fs/promises";
import path from "node:path";
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const FILE = path.resolve("data/accounts.json");
const OWNER_USERNAME = "AlsonMachingauta";
const sessions = new Map();
const attempts = new Map();
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

let users = [];
let writeQueue = Promise.resolve();

await fs.mkdir(path.dirname(FILE), { recursive: true });

try {
  const saved = JSON.parse(await fs.readFile(FILE, "utf8"));
  if (Array.isArray(saved.users)) users = saved.users;
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

for (const user of users) {
  if (!Array.isArray(user.following)) user.following = [];
  if (!user.role) user.role = "user";
}

function save() {
  writeQueue = writeQueue.then(async () => {
    const temp = FILE + ".tmp";
    await fs.writeFile(temp, JSON.stringify({ users }, null, 2), {
      mode: 0o600
    });
    await fs.rename(temp, FILE);
    await fs.chmod(FILE, 0o600);
  });
  return writeQueue;
}

function isBanned(user) {
  return Boolean(
    user.bannedUntil && Date.parse(user.bannedUntil) > Date.now()
  );
}

function publicUser(user) {
  const {
    passwordHash,
    passwordSalt,
    following,
    ...safe
  } = user;

  return {
    ...safe,
    role: user.role || "user",
    badge: Boolean(user.badge),
    banned: isBanned(user),
    followerCount: users.filter(
      item => Array.isArray(item.following) &&
        item.following.includes(user.id)
    ).length,
    followingCount: Array.isArray(user.following)
      ? user.following.length
      : 0
  };
}

function rateLimit(key, max = 10, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  let item = attempts.get(key);

  if (!item || now - item.start >= windowMs) {
    item = { start: now, count: 0 };
    attempts.set(key, item);
  }

  item.count++;
  return item.count <= max;
}

export function allowAuthAttempt(key, action) {
  return rateLimit(
    String(action) + ":" + String(key),
    action === "register" ? 5 : 10
  );
}

function validOwnerSetupKey(supplied) {
  const expected = process.env.ALSON_OWNER_SETUP_KEY || "";
  const a = Buffer.from(expected);
  const b = Buffer.from(String(supplied || ""));

  return Boolean(
    expected.length >= 32 &&
    a.length === b.length &&
    timingSafeEqual(a, b)
  );
}

export async function registerAccount(username, password, ownerSetupKey) {
  username = String(username || "").trim();
  password = String(password || "");

  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
    throw new Error("Username must be 3–24 letters, numbers, or underscores.");
  }

  if (password.length < 10 || password.length > 200) {
    throw new Error("Password must be between 10 and 200 characters.");
  }

  const normalized = username.toLowerCase();
  const ownerName = OWNER_USERNAME.toLowerCase();
  const isOwnerName = normalized === ownerName;

  if (users.some(user => user.username.toLowerCase() === normalized)) {
    throw new Error("That username is already taken.");
  }

  if (isOwnerName && !validOwnerSetupKey(ownerSetupKey)) {
    throw new Error("Owner registration requires the valid owner setup key.");
  }

  if (
    isOwnerName &&
    users.some(user => user.role === "owner")
  ) {
    throw new Error("An owner account already exists.");
  }

  const passwordSalt = randomBytes(16).toString("hex");
  const passwordHash = (
    await scrypt(password, passwordSalt, 64)
  ).toString("hex");

  const user = {
    id: randomBytes(16).toString("hex"),
    username,
    passwordSalt,
    passwordHash,
    role: isOwnerName ? "owner" : "user",
    badge: isOwnerName,
    following: [],
    bannedUntil: null,
    banReason: "",
    createdAt: new Date().toISOString()
  };

  users.push(user);
  await save();
  return publicUser(user);
}

export async function loginAccount(username, password) {
  const normalized = String(username || "").trim().toLowerCase();
  const user = users.find(
    item => item.username.toLowerCase() === normalized
  );

  const salt = user?.passwordSalt || randomBytes(16).toString("hex");
  const expected = user
    ? Buffer.from(user.passwordHash, "hex")
    : Buffer.alloc(64);

  const actual = Buffer.from(
    await scrypt(String(password || ""), salt, 64)
  );

  if (
    !user ||
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  ) {
    throw new Error("Incorrect username or password.");
  }

  if (isBanned(user)) {
    throw new Error("This account is temporarily suspended.");
  }

  const token = randomBytes(32).toString("hex");
  sessions.set(token, {
    userId: user.id,
    expiresAt: Date.now() + SESSION_MS
  });

  return { token, user: publicUser(user) };
}

export function authenticateToken(token) {
  if (!token || typeof token !== "string") return null;

  const session = sessions.get(token);
  if (!session) return null;

  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }

  const user = users.find(item => item.id === session.userId);
  if (!user || isBanned(user)) {
    sessions.delete(token);
    return null;
  }

  return publicUser(user);
}

export function revokeToken(token) {
  if (token) sessions.delete(token);
}

export async function listAccounts() {
  return users.map(publicUser);
}

export async function setUserBadge(id, enabled) {
  const user = users.find(item => item.id === id);
  if (!user) return null;

  user.badge = Boolean(enabled);
  await save();
  return publicUser(user);
}

export async function setUserBan(id, until, reason = "") {
  const user = users.find(item => item.id === id);
  if (!user) return null;

  if (
    until !== null &&
    (!Number.isFinite(Date.parse(until)) || Date.parse(until) <= Date.now())
  ) {
    throw new Error("Ban expiry must be a future date and time.");
  }

  user.bannedUntil = until;
  user.banReason = until ? String(reason).slice(0, 300) : "";
  if (until) {
    for (const [token, session] of sessions) {
      if (session.userId === user.id) sessions.delete(token);
    }
  }

  await save();
  return publicUser(user);
}

export async function getPublicProfile(username, viewerId = null) {
  const normalized = String(username || "").trim().toLowerCase();
  const user = users.find(
    item => item.username.toLowerCase() === normalized
  );
  if (!user) return null;

  return {
    ...publicUser(user),
    isFollowing: viewerId
      ? (user.id !== viewerId &&
        Boolean(users.find(item => item.id === viewerId)?.following?.includes(user.id)))
      : false
  };
}

export async function setFollow(viewerId, targetUsername, follow = true) {
  const viewer = users.find(item => item.id === viewerId);
  const targetName = String(targetUsername || "").trim().toLowerCase();
  const target = users.find(
    item => item.username.toLowerCase() === targetName
  );

  if (!viewer || isBanned(viewer)) {
    throw new Error("Please log in with an active account.");
  }
  if (!target) throw new Error("Account not found.");
  if (viewer.id === target.id) {
    throw new Error("You cannot follow your own account.");
  }
  if (isBanned(target)) throw new Error("That account is unavailable.");

  if (!Array.isArray(viewer.following)) viewer.following = [];

  if (follow) {
    if (!viewer.following.includes(target.id)) {
      viewer.following.push(target.id);
      await save();
    }
  } else {
    const before = viewer.following.length;
    viewer.following = viewer.following.filter(id => id !== target.id);
    if (viewer.following.length !== before) await save();
  }

  return {
    ok: true,
    following: follow,
    profile: await getPublicProfile(target.username, viewer.id)
  };
}

export async function listConnections(username, type) {
  const normalized = String(username || "").trim().toLowerCase();
  const user = users.find(
    item => item.username.toLowerCase() === normalized
  );
  if (!user) return null;

  if (type === "following") {
    return users
      .filter(item => user.following?.includes(item.id))
      .map(publicUser);
  }

  return users
    .filter(item => item.following?.includes(user.id))
    .map(publicUser);
}
