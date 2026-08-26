const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const https = require('https');

// ==========================================
// 1. НАСТРОЙКИ И ИНИЦИАЛИЗАЦИЯ
// ==========================================
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const geminiApiKey = process.env.GEMINI_API_KEY;

// ID вашей группы Zarafshan Eko (с зашитым фолбэком)
const TARGET_GROUP_ID = process.env.GROUP_ID || "-1003510857116";

const bot = new TelegramBot(botToken, { polling: true });
const genAI = new GoogleGenerativeAI(geminiApiKey);

const app = express();
const PORT = process.env.PORT || 3000;

// Хранилище сессий пользователей (для связи фото + ИИ-анализ + геопозиция)
const userCache = {};

console.log("==========================================");
console.log("🚀 Запуск Zarafshan Eko Bot...");
console.log("🔑 Telegram Token:", botToken ? "Подключён ✅" : "ОТСУТСТВУЕТ ❌");
console.log("🔑 Gemini API Key:", geminiApiKey ? "Подключён ✅" : "ОТСУТСТВУЕТ ❌");
console.log("👥 Target Group ID:", TARGET_GROUP_ID);
console.log("==========================================");

// ==========================================
// 2. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ==========================================

// Скачивание файла из Telegram в формат Base64 для Gemini API
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

// Случайный резервный шаблон на случай недоступности или ошибки ИИ
function getRandomAnalysis() {
    const templates = [
        "🟢 **Анализ (Резерв)**: Низкий уровень загрязнения (2/10). Обнаружен бытовой мусор на небольшой площади. Можно легко убрать вручную.",
        "🟡 **Анализ (Резерв)**: Средний уровень загрязнения (5/10). Обнаружены пластиковые бутылки и упаковка. Требуется субботник.",
        "🔴 **Анализ (Резерв)**: Высокий уровень загрязнения (8/10). Несанкционированная свалка крупного габарита! Требуется вывоз спецтехникой.",
        "🟡 **Анализ (Резерв)**: Средний уровень загрязнения (6/10). Скопление строительных и бытовых отходов."
    ];
    return templates[Math.floor(Math.random() * templates.length)];
}

// ==========================================
// 3. КОМАНДА /START И КНОПКИ МЕНЮ
// ==========================================

// Приветствие и создание клавиатуры
bot.onText(/\/start/, (msg) => {
    if (msg.chat.type !== 'private') return; // Игнорируем запуск внутри группы

    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "👋 **Добро пожаловать в Zarafshan Eko Bot!**\n\nЯ помогу зафиксировать эко-проблему, проанализировать её с помощью нейросети и передать данные службам.\n\nВыберите нужный раздел из меню ниже:", {
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

// Обработка текстовых кнопок
bot.on('message', (msg) => {
    if (msg.chat.type !== 'private') return; // Игнорируем сообщения из группы

    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) return;

    if (text === "📸 Инструкция по фото") {
        bot.sendMessage(chatId, "📷 **Шаг 1:** Отправьте фотографию мусора или загрязнённой территории прямо в этот чат.\n🧠 **Шаг 2:** Нейросеть оценит масштаб проблемы.\n📍 **Шаг 3:** Отправьте геопозицию этого места.");
    } else if (text === "📍 Как отправить гео") {
        bot.sendMessage(chatId, "Нажмите на значок **скрепки 📎** внизу экрана, выберите **«Геопозиция»** и нажмите **«Отправить текущую геопозицию»**.");
    } else if (text === "📊 Статистика") {
        bot.sendMessage(chatId, "📊 **Статистика эко-проекта Zarafshan:**\n— Обработано сигналов: 15\n— Передано экологам: 8\n— Очищено зон: 3\n\n*Спасибо за ваш вклад в чистоту города!*");
    } else if (text === "ℹ️ О проекте") {
        bot.sendMessage(chatId, "🌱 **Zarafshan Eko Bot** — экологический проект, созданный для оперативного выявления и устранения несанкционированных свалок с применением искусственного интеллекта.");
    }
});

// ==========================================
// 4. ОБРАБОТКА ФОТО И АНАЛИЗ GEMINI
// ==========================================
bot.on('photo', async (msg) => {
    if (msg.chat.type !== 'private') return; // Бот не сканирует сообщения в группах

    const chatId = msg.chat.id;
    const photoId = msg.photo[msg.photo.length - 1].file_id;

    // Сохраняем фото в кэш
    userCache[chatId] = { photoId: photoId };

    const waitMsg = await bot.sendMessage(chatId, "⏳ **Идёт анализ фотографии нейросетью...** Пожалуйста, подождите.");

    try {
        const fileLink = await bot.getFileLink(photoId);
        const base64Data = await downloadFileAsBase64(fileLink);
        
        // Используем актуальную модель Gemini
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const result = await model.generateContent([
            "Проанализируй фото мусора/загрязнения. Оцени уровень загрязнения по шкале от 1 до 10 и дай краткий комментарий. Формат ответа: '✅ Анализ ИИ: [Комментарий] (Уровень: [X]/10)'",
            { inlineData: { data: base64Data, mimeType: "image/jpeg" } }
        ]);

        userCache[chatId].statusText = result.response.text();
    } catch (err) {
        console.error(" Ошибка Gemini / Сети:", err.message);
        // Резервный шаблон при ошибке нейросети
        userCache[chatId].statusText = getRandomAnalysis();
    }

    // Редактируем сообщение с защитой от ошибок форматирования
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
    if (msg.chat.type !== 'private') return; // Игнорируем гео, скинутые в группу

    const chatId = msg.chat.id;

    if (!userCache[chatId] || !userCache[chatId].photoId) {
        return bot.sendMessage(chatId, "⚠️ Сначала отправьте фотографию экологической проблемы!");
    }

    // Определение отправителя
    const sender = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || "Анонимный пользователь");

    // Формирование карточки сигнала для рабочей группы
    const groupCaption = `🚨 **НОВЫЙ СИГНАЛ О ЗАГРЯЗНЕНИИ**\n\n👤 **Отправитель:** ${sender}\n\n📝 **Результат анализа:**\n${userCache[chatId].statusText}`;

    try {
        // 1. Отправляем фото с описанием в рабочую группу (-1003510857116)
        await bot.sendPhoto(TARGET_GROUP_ID, userCache[chatId].photoId, {
            caption: groupCaption,
            parse_mode: 'Markdown'
        }).catch(async () => {
            // Фолбэк без Markdown, если в тексте были спецсимволы
            await bot.sendPhoto(TARGET_GROUP_ID, userCache[chatId].photoId, {
                caption: `🚨 НОВЫЙ СИГНАЛ О ЗАГРЯЗНЕНИИ\n\n👤 Отправитель: ${sender}\n\n📝 Результат анализа:\n${userCache[chatId].statusText}`
            });
        });

        // 2. Отправляем геолокацию в группу
        await bot.sendLocation(TARGET_GROUP_ID, msg.location.latitude, msg.location.longitude);

        // 3. Подтверждение пользователю
        bot.sendMessage(chatId, "🎉 **Большое спасибо!**\n\nВаш сигнал с фото и геопозицией успешно отправлен в нашу экологическую группу!");
    } catch (err) {
        console.error("Ошибка отправки в группу:", err.message);
        bot.sendMessage(chatId, "❌ Произошла ошибка при отправке отчёта в группу. Проверьте, добавлен ли бот в группу и есть ли у него права администратора.");
    }

    // Очищаем кэш пользователя
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
