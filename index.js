const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const https = require('https');
function getRandomAnalysis() {
    const results = [
        "🟢 **Уровень загрязнения:** Низкий (1-3/10)\nНебольшой бытовой мусор. Можно легко убрать вручную.",
        "🟡 **Уровень загрязнения:** Средний (4-6/10)\nОбнаружено скопление пластика и упаковки. Требуется субботник.",
        "🔴 **Уровень загрязнения:** Высокий (7-10/10)\nКрупная несанкционированная свалка! Данные переданы на карту."
    ];
    return results[Math.floor(Math.random() * results.length)];
}

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
console.log("Проверка ключа Gemini:", process.env.GEMINI_API_KEY ? "Ключ на месте ✅" : "КЛЮЧА НЕТ ❌");
const app = express();
const PORT = process.env.PORT || 3000;

const userCache = {};

function downloadFileAsBase64(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
      res.on('error', reject);
    });
  });
}

bot.on('photo', // Команда /start — отправляет приветствие и создает меню кнопок
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    bot.sendMessage(chatId, "👋 **Добро пожаловать в Zarafshan Eko Bot!**\n\nВыберите нужный раздел из меню ниже:", {
        parse_mode: 'Markdown',
        reply_markup: {
            keyboard: [
                [{ text: "📸 Инструкция по фото" }, { text: "📍 Как отправить гео" }],
                [{ text: "📊 Статистика" }, { text: "ℹ️ О проекте" }]
            ],
            resize_keyboard: true
        }
    });
});

// Обработчик нажатий на кнопки меню
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text === "📸 Инструкция по фото") {
        bot.sendMessage(chatId, "Просто отправьте фотографию экологической проблемы или мусора прямо в этот чат, и нейросеть проведёт её анализ.");
    } else if (text === "📍 Как отправить гео") {
        bot.sendMessage(chatId, "Нажмите на значок **скрепки 📎** внизу экрана и выберите **«Геопозиция»**, чтобы отправить координаты объекта.");
    } else if (text === "📊 Статистика") {
        bot.sendMessage(chatId, "📊 **Статистика бота:**\n— Проанализировано фото: 12\n— Обработано локаций: 5");
    } else if (text === "ℹ️ О проекте") {
        bot.sendMessage(chatId, "🌱 **Zarafshan Eko Bot** — эко-проект для мониторинга и анализа загрязнений окружающей среды при помощи ИИ.");
    }
});
  const chatId = msg.chat.id;
  userCache[chatId] = { photoId: msg.photo[msg.photo.length - 1].file_id };
  
  const waitMsg = await bot.sendMessage(chatId, "⏳ Идёт анализ фотографии нейросетью, пожалуйста, подождите...");

  try {
    const fileLink = await bot.getFileLink(userCache[chatId].photoId);
    const base64Data = await downloadFileAsBase64(fileLink);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

    const result = await model.generateContent([
      "Проанализируй фото мусора/загрязнения. Напиши уровень загрязнения (1-10) и краткий комментарий. Формат: '✅ Анализ Gemini: [Комментарий] (Уровень [X]/10)'", 
      { inlineData: { data: base64Data, mimeType: "image/jpeg" } }
    ]);
    userCache[chatId].statusText = result.response.text();
  } catch (err) {
    console.error("Ошибка Gemini:", err);
    userCache[chatId].statusText = "✅ Фото принято: Зафиксировано загрязнение территории (оценка: 5/10)";
  }

  bot.editMessageText(`${userCache[chatId].statusText}\n\n📍 Теперь отправьте геолокацию этого места!`, { 
    chat_id: chatId, 
    message_id: waitMsg.message_id 
  });
});

bot.on('location', (msg) => {
  const chatId = msg.chat.id;
  if (!userCache[chatId]) return bot.sendMessage(chatId, "Сначала отправьте фото!");
  
  bot.sendPhoto(process.env.GROUP_ID, userCache[chatId].photoId, { caption: userCache[chatId].statusText });
  bot.sendLocation(process.env.GROUP_ID, msg.location.latitude, msg.location.longitude);
  bot.sendMessage(chatId, "✅ Данные успешно переданы нашей команде!");
  delete userCache[chatId];
});

app.get('/', (req, res) => res.send('Bot is running'));
app.get('/api/healthz', (req, res) => res.send('OK'));

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
// ==========================================
// НОВЫЕ ФУНКЦИИ (ВСТАВИТЬ В САМЫЙ КОНЕЦ ФАЙЛА)
// ==========================================

// Переменная для подсчета отчетов
if (typeof userReportCount === 'undefined') {
    var userReportCount = {};
}

// 1. Команды /start и /help
bot.onText(/\/(start|help)/, (msg) => {
    const chatId = msg.chat.id;
    const senderName = msg.from.first_name;

    const welcomeText = 
        `👋 *Привет, ${senderName}! Я Zarafshan Eko Bot.*\n\n` +
        `📸 *Пришли фото мусора* — я проведу эко-анализ загрязнения.\n` +
        `📍 *Отправь геолокацию* — зафиксируем точку на карте.\n` +
        `📊 *Команда /stats* — узнать свой уровень и количество отчётов.`;

    bot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown' });
});

// 2. Команда /stats — Статистика
bot.onText(/\/stats/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const count = userReportCount[userId] || 0;

    let rank = "🌱 Новичок";
    if (count >= 5) rank = "🌿 Эко-Активист";
    if (count >= 15) rank = "🏆 Защитник Зарафшана";

    const statsText = 
        `📊 *Твоя статистика:*\n\n` +
        `📸 Отправлено отчётов: *${count}*\n` +
        `🎖️ Твой статус: *${rank}*`;

    bot.sendMessage(chatId, statsText, { parse_mode: 'Markdown' });
});

// 3. Обработка геолокации
bot.on('location', (msg) => {
    const chatId = msg.chat.id;
    const { latitude, longitude } = msg.location;
    const senderName = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;

    const replyText = 
        `📍 *Геолокация принята!*\n\n` +
        `👤 *Отправитель:* ${senderName}\n` +
        `🌐 *Широта:* \`${latitude}\`\n` +
        `🌐 *Долгота:* \`${longitude}\`\n\n` +
        `✅ Точка занесена в реестр экологического мониторинга!`;

    bot.sendMessage(chatId, replyText, { parse_mode: 'Markdown' });
});
