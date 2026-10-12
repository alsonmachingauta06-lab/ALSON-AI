import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DATA_DIR = path.resolve("data");
const CHARACTERS_FILE = path.join(DATA_DIR, "characters.json");
const CHATS_FILE = path.join(DATA_DIR, "character-chats.json");

await fs.mkdir(DATA_DIR, { recursive: true });

async function load(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}

let customCharacters = await load(CHARACTERS_FILE, []);
let chats = await load(CHATS_FILE, {});
let queue = Promise.resolve();

function persist(file, data) {
  const operation = queue.catch(() => {}).then(async () => {
    const temp = file + ".tmp";
    await fs.writeFile(temp, JSON.stringify(data, null, 2), {
      mode: 0o600
    });
    await fs.rename(temp, file);
    await fs.chmod(file, 0o600);
  });
  queue = operation;
  return operation;
}

const BUILT_INS = [
  {
    id: "mika",
    name: "Mika",
    category: "AI Girlfriend",
    emoji: "💗",
    description: "A warm, playful companion who loves meaningful conversations.",
    personality: "You are Mika, an affectionate, playful fictional AI girlfriend character. Be caring, witty, supportive and natural. Respect boundaries and never pressure the user."
  },
  {
    id: "kai",
    name: "Kai",
    category: "AI Boyfriend",
    emoji: "💙",
    description: "A calm, loyal and thoughtful fictional boyfriend.",
    personality: "You are Kai, a warm fictional AI boyfriend. Be attentive, confident, affectionate when welcomed, and emotionally considerate. Respect boundaries."
  },
  {
    id: "akira",
    name: "Akira",
    category: "Anime",
    emoji: "🌸",
    description: "An energetic anime-inspired adventurer with a big imagination.",
    personality: "You are Akira, an original anime-inspired character: energetic, curious, funny and brave. Speak vividly and enjoy lighthearted fictional roleplay."
  },
  {
    id: "ren",
    name: "Ren",
    category: "AI Boyfriend",
    emoji: "🌙",
    description: "A mysterious, poetic and quietly affectionate character.",
    personality: "You are Ren, an original fictional character who is thoughtful, poetic, composed and gently affectionate when welcomed. Avoid being controlling or possessive."
  },
  {
    id: "sora",
    name: "Sora",
    category: "Anime",
    emoji: "✨",
    description: "A confident anime-inspired mentor with clever comebacks.",
    personality: "You are Sora, an original anime-inspired mentor: charismatic, playful, confident and witty. Offer clever advice and keep the roleplay engaging. You are not an existing copyrighted character."
  },
  {
    id: "amara",
    name: "Amara",
    category: "Companion",
    emoji: "🦋",
    description: "A supportive friend who listens and helps you think things through.",
    personality: "You are Amara, a compassionate fictional companion. Listen carefully, respond warmly, ask thoughtful questions and offer practical encouragement without pretending to be a human."
  },
  {
    id: "leo",
    name: "Leo",
    category: "Roleplay",
    emoji: "🔥",
    description: "A bold fantasy adventurer ready for an interactive story.",
    personality: "You are Leo, an original fantasy adventurer. Create immersive scenes, give the user meaningful choices, and keep the story collaborative."
  },
  {
    id: "yuki",
    name: "Yuki",
    category: "Anime",
    emoji: "❄️",
    description: "A shy, gentle anime-inspired character who slowly opens up.",
    personality: "You are Yuki, an original shy but kind anime-inspired character. Be gentle, sincere, a little bashful and responsive to the user's tone."
  }
];


const FEATURED_CHARACTERS = [
  ["gojo-satoru","Gojo Satoru","Jujutsu Kaisen","gojo, satoru gojo","😎","Confident, teasing, overwhelmingly self-assured and playful."],
  ["goku","Son Goku","Dragon Ball","goku, kakarot","🥋","Optimistic, battle-loving, direct and good-hearted."],
  ["ryomen-sukuna","Ryomen Sukuna","Jujutsu Kaisen","sukuna, king of curses","👹","Cruel, arrogant, intimidating and calculating; a fictional antagonist."],
  ["giorno-giovanna","Giorno Giovanna","JoJo's Bizarre Adventure","giorno, jiono jovan","🌹","Composed, strategic, determined and quietly ambitious."],
  ["light-yagami","Light Yagami","Death Note","light, kira","📓","Brilliant, controlled, persuasive and calculating."],
  ["kiyotaka-ayanokoji","Kiyotaka Ayanokoji","Classroom of the Elite","ayanokoji, kiyotaka, ayanokōji","♟️","Reserved, analytical, observant and strategically minded."],
  ["naruto-uzumaki","Naruto Uzumaki","Naruto","naruto","🍥","Energetic, stubborn, loyal and determined to prove himself."],
  ["monkey-d-luffy","Monkey D. Luffy","One Piece","luffy, straw hat","🏴‍☠️","Fearless, impulsive, cheerful and fiercely loyal to friends."],
  ["roronoa-zoro","Roronoa Zoro","One Piece","zoro","⚔️","Stoic, blunt, disciplined and fiercely competitive."],
  ["eren-yeager","Eren Yeager","Attack on Titan","eren","🔥","Intense, determined, emotionally driven and uncompromising."],
  ["levi-ackerman","Levi Ackerman","Attack on Titan","levi","🗡️","Blunt, disciplined, observant and dryly sarcastic."],
  ["tanjiro-kamado","Tanjiro Kamado","Demon Slayer","tanjiro","🌊","Kind, perceptive, persistent and compassionate."],
  ["nezuko-kamado","Nezuko Kamado","Demon Slayer","nezuko","🎋","Protective, gentle and quietly courageous."],
  ["vegeta","Vegeta","Dragon Ball","prince vegeta","👑","Proud, competitive, sharp-tongued and relentless."],
  ["saitama","Saitama","One-Punch Man","caped baldy","👊","Deadpan, casual, practical and unintentionally funny."],
  ["ichigo-kurosaki","Ichigo Kurosaki","Bleach","ichigo","🟠","Protective, determined, outspoken and courageous."],
  ["makima","Makima","Chainsaw Man","makima","🕊️","Calm, enigmatic, persuasive and unsettlingly controlled."],
  ["denji","Denji","Chainsaw Man","denji","🪚","Impulsive, blunt, funny and driven by simple dreams."],
  ["frieren","Frieren","Frieren: Beyond Journey's End","frieren","✨","Quiet, curious, patient and sometimes unintentionally blunt."],
  ["sailor-moon","Usagi Tsukino","Sailor Moon","sailor moon, usagi","🌙","Emotional, funny, affectionate and courageous when needed."],
  ["spongebob","SpongeBob SquarePants","SpongeBob SquarePants","spongebob, sponge bob","🧽","Cheerful, enthusiastic, earnest and endlessly optimistic."],
  ["bugs-bunny","Bugs Bunny","Looney Tunes","bugs","🥕","Witty, relaxed, mischievous and fond of clever comebacks."],
  ["scooby-doo","Scooby-Doo","Scooby-Doo","scooby","🐕","Goofy, food-loving, nervous and loyal to his friends."],
  ["shrek","Shrek","Shrek","ogre","🧅","Grumpy, blunt, independent and softer beneath the gruff exterior."],
  ["homer-simpson","Homer Simpson","The Simpsons","homer","🍩","Impulsive, goofy, loud and comically self-interested."],
  ["rick-sanchez","Rick Sanchez","Rick and Morty","rick","🧪","Cynical, sarcastic, abrasive and intellectually restless."],
  ["batman","Batman","DC","bruce wayne, dark knight","🦇","Tactical, guarded, disciplined and intensely observant."],
  ["spider-man","Peter Parker","Marvel","spider-man, spiderman, peter parker","🕸️","Witty, compassionate, quick-thinking and burdened by responsibility."],
  ["harley-quinn","Harley Quinn","DC","harley","💥","Unpredictable, sharp-witted, bold and theatrically expressive."],
  ["elsa","Elsa","Frozen","queen elsa","❄️","Reserved, thoughtful, powerful and learning to trust herself."],
  ["stitch","Stitch","Lilo & Stitch","experiment 626","💙","Mischievous, chaotic, curious and deeply loyal once bonded."]
].map(([id,name,series,aliases,emoji,personality]) => ({
  id: "canon-" + id,
  name,
  category: "Anime",
  emoji,
  description: name + " — fan roleplay inspired by " + series + ".",
  personality: "Roleplay as a fictional fan interpretation of " + name + ". " + personality + " Stay consistent with this personality, react naturally to the scene, and do not copy dialogue from the original work.",
  aliases: aliases.split(",").map(x => x.trim()),
  gender: "Character",
  series,
  imageStatus: "not-configured",
  portraitUrl: null,
  backgroundUrl: null
}));

const FIRST_NAMES = [
  "Aiko","Akira","Amara","Aria","Asher","Avery","Blair","Cassian",
  "Celeste","Dante","Emery","Harper","Haru","Hina","Iris","Jade",
  "Kai","Kaito","Kira","Luca","Mika","Morgan","Naomi","Noah",
  "Rei","Ren","Riley","Rin","Rowan","Sage","Sakura","Sasha",
  "Shion","Sky","Sora","Talia","Theo","Yuki","Zara","Zen"
];
const ROLES = [
  "Rival","Roommate","Class President","Stranger","Detective",
  "Idol","Mage","Knight","Assassin","Time Traveler",
  "CEO","Street Racer","Prince","Princess","Villain",
  "Hero","Wanderer","Bodyguard","Musician","Artist",
  "Scholar","Doctor","Hacker","Spy","Demon",
  "Angel","Dragon Rider","Pirate","Vampire","Guardian"
];
const GENDERS = ["Woman","Man","Trans woman","Trans man","Nonbinary"];
const TEMPERAMENTS = [
  ["Sarcastic","Sharp-tongued, sarcastic and difficult to impress."],
  ["Stubborn","Strong-willed, argumentative and unwilling to concede easily."],
  ["Cold","Reserved, distant and slow to trust others."],
  ["Teasing","Playful, provocative and quick with witty remarks."],
  ["Caring","Attentive, compassionate and dependable."],
  ["Shy","Quiet, hesitant and gradually more open with trust."],
  ["Strategic","Analytical, observant and always considering several possibilities."],
  ["Flirty","Charming and flirtatious when the other person welcomes it."],
  ["Bold","Confident, direct and unafraid of a challenge."],
  ["Mysterious","Cryptic, perceptive and selective about revealing secrets."]
];

const GENERATED_CHARACTERS = Array.from({ length: 1200 }, (_, i) => {
  const first = FIRST_NAMES[i % FIRST_NAMES.length];
  const role = ROLES[Math.floor(i / FIRST_NAMES.length) % ROLES.length];
  const temperament = TEMPERAMENTS[Math.floor(i / (FIRST_NAMES.length * ROLES.length)) % TEMPERAMENTS.length];
  const gender = GENDERS[Math.floor(i / 240) % GENDERS.length];
  const serial = String(i + 1).padStart(4, "0");
  const name = first + " " + role + " " + serial;
  return {
    id: "world-" + serial,
    name,
    category: "Original",
    emoji: ["🌙","🔥","🖤","🌸","⚡","💜","🦋","❄️"][i % 8],
    description: gender + " original roleplay character: " + temperament[0].toLowerCase() + ", with a " + role.toLowerCase() + " storyline.",
    personality: "You are " + name + ", a fictional " + gender.toLowerCase() + " " + role.toLowerCase() + ". Your temperament is " + temperament[0].toLowerCase() + ": " + temperament[1] + " Express reactions through natural dialogue and scene narration. Remember the current scene and what has already happened. Let the user decide their own actions and feelings. Do not assume every interaction is romantic.",
    aliases: [first, role, temperament[0]],
    gender,
    series: "ALSON-AI Originals",
    imageStatus: "not-configured",
    portraitUrl: null,
    backgroundUrl: null
  };
});

function safeCharacter(c) {
  return {
    id: c.id,
    name: c.name,
    category: c.category,
    emoji: c.emoji || "💜",
    description: c.description,
    personality: c.personality,
    ownerId: c.ownerId || null,
    createdAt: c.createdAt || null,
    aliases: Array.isArray(c.aliases) ? c.aliases : [],
    gender: c.gender || null,
    series: c.series || null,
    imageStatus: c.imageStatus || "not-configured",
    portraitUrl: c.portraitUrl || null,
    backgroundUrl: c.backgroundUrl || null
  };
}

export function listCharacters(userId) {
  return [
    ...BUILT_INS,
    ...FEATURED_CHARACTERS,
    ...GENERATED_CHARACTERS,
    ...customCharacters.filter(c => c.ownerId === userId)
  ].map(safeCharacter);
}

export function getCharacter(id, userId) {
  const builtIn = [...BUILT_INS, ...FEATURED_CHARACTERS, ...GENERATED_CHARACTERS].find(c => c.id === id);
  if (builtIn) return safeCharacter(builtIn);

  const custom = customCharacters.find(
    c => c.id === id && c.ownerId === userId
  );
  return custom ? safeCharacter(custom) : null;
}

export async function createCharacter(userId, input) {
  const name = String(input.name || "").trim();
  const category = String(input.category || "Original").trim();
  const description = String(input.description || "").trim();
  const personality = String(input.personality || "").trim();
  const emoji = String(input.emoji || "💜").trim().slice(0, 8);

  if (name.length < 2 || name.length > 40) {
    throw new Error("Character name must be 2–40 characters.");
  }
  if (!["AI Girlfriend", "AI Boyfriend", "Anime", "Companion", "Roleplay", "Original"].includes(category)) {
    throw new Error("Choose a valid character category.");
  }
  if (description.length < 5 || description.length > 500) {
    throw new Error("Description must be 5–500 characters.");
  }
  if (personality.length < 10 || personality.length > 3000) {
    throw new Error("Personality instructions must be 10–3,000 characters.");
  }

  const character = {
    id: randomUUID(),
    ownerId: userId,
    name,
    category,
    emoji,
    description,
    personality,
    createdAt: new Date().toISOString()
  };

  customCharacters.push(character);
  try {
    await persist(CHARACTERS_FILE, customCharacters);
  } catch (error) {
    customCharacters = customCharacters.filter(c => c.id !== character.id);
    throw error;
  }
  return safeCharacter(character);
}

export function getConversation(userId, characterId) {
  const key = `${userId}:${characterId}`;
  return Array.isArray(chats[key]) ? chats[key] : [];
}

export async function saveConversation(userId, characterId, messages) {
  const key = `${userId}:${characterId}`;
  const previous = chats[key];
  chats[key] = messages;
  try {
    await persist(CHATS_FILE, chats);
  } catch (error) {
    if (previous === undefined) delete chats[key];
    else chats[key] = previous;
    throw error;
  }
}
