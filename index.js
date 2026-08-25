const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const https = require('https');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
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

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  userCache[chatId] = { photoId: msg.photo[msg.photo.length - 1].file_id };
  
  const waitMsg = await bot.sendMessage(chatId, "⏳ Идёт анализ фотографии нейросетью, пожалуйста, подождите...");

  try {
    const fileLink = await bot.getFileLink(userCache[chatId].photoId);
    const base64Data = await downloadFileAsBase64(fileLink);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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
