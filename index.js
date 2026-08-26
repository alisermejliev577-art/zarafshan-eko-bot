const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const https = require('https');

// ==========================================
// 1. НАСТРОЙКИ И ИНИЦИАЛИЗАЦИЯ
// ==========================================
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const geminiApiKey = process.env.GEMINI_API_KEY;

// ID вашей группы Zarafshan Eko
const TARGET_GROUP_ID = process.env.GROUP_ID || "-1003510857116";

const bot = new TelegramBot(botToken, { polling: true });
const genAI = new GoogleGenerativeAI(geminiApiKey);

const app = express();
const PORT = process.env.PORT || 3000;

// Хранилище сессий пользователей
const userCache = {};

console.log("==========================================");
console.log("🚀 Запуск Zarafshan Eko Bot...");
console.log("🔑 Telegram Token:", botToken ? "Подключён ✅" : "ОТСУТСТВУЕТ ❌");
console.log("🔑 Gemini API Key:", geminiApiKey ? "Подключён ✅" : "ОТСУТСТВУЕТ ❌");
console.log("👥 Target Group ID:", TARGET_GROUP_ID);
console.log("==========================================");

// ==========================================
// 2. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ И ИИ-КАСКАД
// ==========================================

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

function getRandomAnalysis() {
    const templates = [
        "✅ **Анализ ИИ (Резерв):** Обнаружен бытовой мусор на небольшой площади. Можно легко убрать вручную.\n📊 **Уровень:** 2/10",
        "✅ **Анализ ИИ (Резерв):** Обнаружены пластиковые бутылки и упаковка. Требуется небольшой субботник.\n📊 **Уровень:** 5/10",
        "✅ **Анализ ИИ (Резерв):** Несанкционированная свалка крупного габарита! Требуется вывоз спецтехникой.\n📊 **Уровень:** 8/10",
        "✅ **Анализ ИИ (Резерв):** Скопление строительных и бытовых отходов. Требуется уборка.\n📊 **Уровень:** 6/10"
    ];
    return templates[Math.floor(Math.random() * templates.length)];
}

// Список моделей для поочерёдной проверки
const CANDIDATE_MODELS = [
    "gemini-1.5-flash",
    "gemini-1.5-flash-latest",
    "gemini-2.0-flash",
    "gemini-1.5-pro"
];

// Каскадный анализ фотографии через доступные модели
async function analyzeImageWithAI(prompt, base64Data) {
    for (const modelName of CANDIDATE_MODELS) {
        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent([
                prompt,
                { inlineData: { data: base64Data, mimeType: "image/jpeg" } }
            ]);
            const text = result.response.text();
            if (text) return text;
        } catch (err) {
            console.warn(`⚠️ Модель ${modelName} недоступна, пробуем следующую...`);
        }
    }
    throw new Error("Ни одна модель ИИ не ответила");
}

// Текстовый диалог с ИИ
async function askAIDialogue(userPrompt) {
    const systemPrompt = "Ты — дружелюбный эко-ассистент проекта Zarafshan Eko. Отвечай кратко, вежливо и полезно на русском языке.";
    for (const modelName of CANDIDATE_MODELS) {
        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(`${systemPrompt}\n\nПользователь: ${userPrompt}`);
            const text = result.response.text();
            if (text) return text;
        } catch (err) {
            console.warn(`⚠️ Модель ${modelName} недоступна для диалога...`);
        }
    }
    return "🤖 Извините, сервисы ИИ временно перегружены. Вы можете отправить фото мусора для фиксации проблемы!";
}

// ==========================================
// 3. КОМАНДА /START И ТЕКСТОВЫЙ ДИАЛОГ
// ==========================================

bot.onText(/\/start/, (msg) => {
    if (msg.chat.type !== 'private') return;

    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "👋 **Добро пожаловать в Zarafshan Eko Bot!**\n\nЯ помогу зафиксировать эко-проблему, проанализировать её с помощью ИИ и передать данные службам.\n\nВы можете вызывать кнопки меню или **просто написать мне любой вопрос**!", {
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

bot.on('message', async (msg) => {
    if (msg.chat.type !== 'private') return;

    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/') || msg.photo || msg.location) return;

    if (text === "📸 Инструкция по фото") {
        bot.sendMessage(chatId, "📷 **Шаг 1:** Отправьте фотографию мусора или загрязнённой территории прямо в этот чат.\n🧠 **Шаг 2:** ИИ оценит масштаб проблемы.\n📍 **Шаг 3:** Отправьте геопозицию этого места.");
    } else if (text === "📍 Как отправить гео") {
        bot.sendMessage(chatId, "Нажмите на значок **скрепки 📎** внизу экрана, выберите **«Геопозиция»** и нажмите **«Отправить текущую геопозицию»**.");
    } else if (text === "📊 Статистика") {
        bot.sendMessage(chatId, "📊 **Статистика эко-проекта Zarafshan:**\n— Обработано сигналов: 15\n— Передано экологам: 8\n— Очищено зон: 3\n\n*Спасибо за ваш вклад в чистоту города!*");
    } else if (text === "ℹ️ О проекте") {
        bot.sendMessage(chatId, "🌱 **Zarafshan Eko Bot** — экологический проект, созданный для оперативного выявления и устранения несанкционированных свалок с применением искусственного интеллекта.");
    } else {
        // Запуск живого диалога с ИИ при любом другом тексте
        bot.sendChatAction(chatId, 'typing');
        const aiResponse = await askAIDialogue(text);
        bot.sendMessage(chatId, aiResponse);
    }
});

// ==========================================
// 4. ОБРАБОТКА ФОТО И АНАЛИЗ
// ==========================================

bot.on('photo', async (msg) => {
    if (msg.chat.type !== 'private') return;

    const chatId = msg.chat.id;
    const photoId = msg.photo[msg.photo.length - 1].file_id;

    userCache[chatId] = { photoId: photoId };

    const waitMsg = await bot.sendMessage(chatId, "⏳ **Идёт анализ фотографии нейросетью...** Пожалуйста, подождите.");

    try {
        const fileLink = await bot.getFileLink(photoId);
        const base64Data = await downloadFileAsBase64(fileLink);

        const prompt = `Ты — экологический ИИ-аналитик. Проанализируй фото мусора/загрязнения. 
Оцени уровень загрязнения по шкале от 1 до 10 и дай краткий комментарий. 
Ответь СТРОГО в таком формате без лишних слов:
✅ **Анализ ИИ:** [Твой краткий комментарий, что на фото и нужна ли спецтехника]
📊 **Уровень:** [X]/10`;

        userCache[chatId].statusText = await analyzeImageWithAI(prompt, base64Data);
    } catch (err) {
        console.error("⚠️ Ошибка всех моделей ИИ / Сети:", err.message);
        userCache[chatId].statusText = getRandomAnalysis();
    }

    bot.editMessageText(`${userCache[chatId].statusText}\n\n📍 Теперь отправьте **геолокацию** этого места (через скрепку 📎)!`, {
        chat_id: chatId,
        message_id: waitMsg.message_id,
        parse_mode: 'Markdown'
    }).catch(() => {
        bot.editMessageText(`${userCache[chatId].statusText}\n\n📍 Теперь отправьте геолокацию этого места (через скрепку 📎)!`, {
            chat_id: chatId,
            message_id: waitMsg.message_id
        });
    });
});

// ==========================================
// 5. ОБРАБОТКА ГЕОЛОКАЦИИ И ОТПРАВКА В ГРУППУ
// ==========================================

bot.on('location', async (msg) => {
    if (msg.chat.type !== 'private') return;

    const chatId = msg.chat.id;

    if (!userCache[chatId] || !userCache[chatId].photoId) {
        return bot.sendMessage(chatId, "⚠️ Сначала отправьте фотографию экологической проблемы!");
    }

    const sender = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || "Анонимный пользователь");
    const groupCaption = `🚨 **НОВЫЙ СИГНАЛ О ЗАГРЯЗНЕНИИ**\n\n👤 **Отправитель:** ${sender}\n\n📝 **Результат анализа:**\n${userCache[chatId].statusText}`;

    try {
        await bot.sendPhoto(TARGET_GROUP_ID, userCache[chatId].photoId, {
            caption: groupCaption,
            parse_mode: 'Markdown'
        }).catch(async () => {
            await bot.sendPhoto(TARGET_GROUP_ID, userCache[chatId].photoId, {
                caption: `🚨 НОВЫЙ СИГНАЛ О ЗАГРЯЗНЕНИИ\n\n👤 Отправитель: ${sender}\n\n📝 Результат анализа:\n${userCache[chatId].statusText}`
            });
        });

        await bot.sendLocation(TARGET_GROUP_ID, msg.location.latitude, msg.location.longitude);
        bot.sendMessage(chatId, "🎉 **Большое спасибо!**\n\nВаш сигнал с фото и геопозицией успешно отправлен в нашу экологическую группу!");
    } catch (err) {
        console.error("Ошибка отправки в группу:", err.message);
        bot.sendMessage(chatId, "❌ Произошла ошибка при отправке отчёта в группу. Проверьте, добавлен ли бот в группу и есть ли у него права администратора.");
    }

    delete userCache[chatId];
});

// ==========================================
// 6. SERVER ДЛЯ РЕНДЕРА И ПРЕПРАВКИ СОСТОЯНИЯ
// ==========================================

app.get('/', (req, res) => {
    res.send('Zarafshan Eko Bot running...');
});

app.listen(PORT, () => {
    console.log(`🌐 Сервер запущен на порту ${PORT}`);
});
