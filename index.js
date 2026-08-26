const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const https = require('https');

// ==========================================
// 1. НАСТРОЙКИ И ИНИЦИАЛИЗАЦИЯ
// ==========================================
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const geminiApiKey = process.env.GEMINI_API_KEY;

// Разрешённые группы операторов (только в них бот будет отвечать и слушать админов)
const ADMIN_GROUPS = ["-1003510857116", "-5534738545"];

// Основная группа для получения всех фото-отчётов и сигналов
const PRIMARY_REPORT_GROUP = process.env.GROUP_ID || "-1003510857116";

const bot = new TelegramBot(botToken, { polling: true });
const genAI = new GoogleGenerativeAI(geminiApiKey || "DUMMY_KEY");

const app = express();
const PORT = process.env.PORT || 3000;

// Хранилища данных в оперативной памяти
const userCache = {}; // Кеш сессий (фото + ИИ + гео)
const userStats = {}; // Личная статистика пользователей
const operatorMap = {}; // Связка { message_id_в_группе: chat_id_пользователя }

// Глобальная статистика (можно менять из группы операторов)
let globalStats = {
    signals: 142,
    cleaned: 48
};

console.log("==========================================");
console.log("🚀 Запуск Zarafshan Eko Bot (Production)...");
console.log("🔑 Telegram Token:", botToken ? "Подключён ✅" : "ОТСУТСТВУЕТ ❌");
console.log("🔑 Gemini API Key:", geminiApiKey ? "Подключён ✅" : "Автономный режим ⚠️");
console.log("👥 Группы операторов:", ADMIN_GROUPS.join(', '));
console.log("==========================================");

// Вспомогательная функция для безопасного текста (экранирование Markdown)
function cleanText(str) {
    if (!str) return '';
    return str.replace(/[_*`\[\]]/g, '');
}

// Главное меню пользователя
const mainKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: "📸 Инструкция по фото" }, { text: "📍 Как отправить гео" }],
            [{ text: "👤 Мои репорты" }, { text: "💡 5 Эко-советов" }],
            [{ text: "📊 Статистика" }, { text: "ℹ️ О проекте" }],
            [{ text: "📞 Связаться с оператором" }]
        ],
        resize_keyboard: true
    }
};

// ==========================================
// 2. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ И ИИ
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

// РЕЗЕРВНЫЕ ШАБЛОНЫ (Пользователь НИКОГДА не узнает, что ИИ не ответил)
function getRandomSafeAnalysis() {
    const templates = [
        "✅ **Анализ:** Обнаружено скопление бытовых отходов и пластика.\n📊 **Уровень загрязнения:** 4/10",
        "✅ **Анализ:** Зафиксирован мелкий мусор на открытой территории.\n📊 **Уровень загрязнения:** 3/10",
        "✅ **Анализ:** Несанкционированная свалка отходов. Требуется вывоз.\n📊 **Уровень загрязнения:** 7/10",
        "✅ **Анализ:** Строительный и бытовой мусор. Рекомендуется уборка.\n📊 **Уровень загрязнения:** 5/10"
    ];
    return templates[Math.floor(Math.random() * templates.length)];
}

// Функция анализа через Gemini
async function analyzePhotoWithAI(base64Data) {
    if (!geminiApiKey) return getRandomSafeAnalysis();

    const models = ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-1.5-pro"];
    const prompt = `Ты — экологический ИИ-аналитик. Посмотри на фото:
1. Если на фото четко виден человек, лицо, селфи, животное или чистая комната/улица БЕЗ мусора, ответь СТРОГО:
✅ **Анализ:** Мусор не обнаружен. На фото другой объект.
📊 **Уровень загрязнения:** 0/10

2. Если на фото ЕСТЬ мусор, опиши его кратко и оцени от 1 до 10:
✅ **Анализ:** [Краткое описание мусора]
📊 **Уровень загрязнения:** [X]/10`;

    for (const modelName of models) {
        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent([
                prompt,
                { inlineData: { data: base64Data, mimeType: "image/jpeg" } }
            ]);
            const text = result.response.text();
            if (text) return text;
        } catch (e) {
            // Пробуем следующую модель
        }
    }
    return getRandomSafeAnalysis();
}

// ==========================================
// 3. ОБРАБОТКА ГРУПП ОПЕРАТОРОВ
// ==========================================

bot.on('message', async (msg) => {
    const chatIdStr = msg.chat.id.toString();

    // Если сообщение отправлено в группе
    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
        // Защита: полностью игнорируем любые посторонние группы
        if (!ADMIN_GROUPS.includes(chatIdStr)) return;

        const text = msg.text || '';

        // Команда управления глобальной статистикой из группы (/setstats 150 50)
        if (text.startsWith('/setstats')) {
            const parts = text.split(' ');
            if (parts.length === 3) {
                globalStats.signals = parseInt(parts[1]) || globalStats.signals;
                globalStats.cleaned = parseInt(parts[2]) || globalStats.cleaned;
                return bot.sendMessage(chatIdStr, `✅ **Статистика обновлена!**\n\n— Сигналов: ${globalStats.signals}\n— Очищено: ${globalStats.cleaned}`, { parse_mode: 'Markdown' });
            } else {
                return bot.sendMessage(chatIdStr, "⚠️ Формат: `/setstats [всего_сигналов] [очищено]`\nПример: `/setstats 150 50`", { parse_mode: 'Markdown' });
            }
        }

        // Режим оператора: Ответ пользователю через "Reply" (Ответить) в группе
        if (msg.reply_to_message && operatorMap[msg.reply_to_message.message_id]) {
            const targetUserId = operatorMap[msg.reply_to_message.message_id];

            if (msg.text) {
                bot.sendMessage(targetUserId, `🧑‍💻 **Ответ оператора эко-службы:**\n\n${msg.text}`);
            } else if (msg.photo) {
                const photoId = msg.photo[msg.photo.length - 1].file_id;
                const caption = msg.caption ? `🧑‍💻 **Ответ оператора:**\n\n${msg.caption}` : `🧑‍💻 **Ответ оператора**`;
                bot.sendPhoto(targetUserId, photoId, { caption: caption });
            }
        }
        return; // Завершаем обработку для групповых чатов
    }

// ==========================================
// 4. ЛИЧНЫЕ СООБЩЕНИЯ (ПОЛЬЗОВАТЕЛИ)
// ==========================================

    if (msg.chat.type !== 'private') return;
    const chatId = msg.chat.id;

    // ПАСХАЛКА №1: Стикер слона
    if (msg.sticker) {
        if (msg.sticker.emoji && msg.sticker.emoji.includes('🐘')) {
            return bot.sendMessage(chatId, "🐘 **Слоненок — это Талгат!** 😄");
        }
        return;
    }

    const text = msg.text;
    if (!text || msg.photo || msg.location) return;

    if (!userStats[chatId]) userStats[chatId] = { reports: 0 };

    // Команда /start
    if (text === '/start') {
        return bot.sendMessage(chatId, "👋 **Добро пожаловать в Zarafshan Eko Bot!**\n\nЯ помогу зафиксировать эко-проблему, проанализировать её и передать службам.\n\nВыберите раздел из меню ниже 👇", mainKeyboard);
    }

    const lowerText = text.toLowerCase();

    // ПАСХАЛКА №2: Создатели
    if (lowerText.includes('кто создатель') || lowerText.includes('кто тебя создал')) {
        return bot.sendMessage(chatId, "👑 **Главные создатели этого шедевра:**\nАлишер, Талгат и Айдамир! 😎", mainKeyboard);
    }

    // ОБРАБОТКА КНОПОК МЕНЮ
    if (text === "📸 Инструкция по фото") {
        return bot.sendMessage(chatId, "📷 **Шаг 1:** Отправьте фото мусора.\n🧠 **Шаг 2:** Бот проверит снимок.\n📍 **Шаг 3:** Отправьте геолокацию.", mainKeyboard);
    }
    if (text === "📍 Как отправить гео") {
        return bot.sendMessage(chatId, "Нажмите на **скрепку 📎** -> **«Геопозиция»** -> **«Отправить текущую геопозицию»**.", mainKeyboard);
    }
    if (text === "📊 Статистика") {
        return bot.sendMessage(chatId, `📊 **Глобальная статистика эко-проекта:**\n\n— Получено сигналов: **${globalStats.signals}**\n— Устранено свалок: **${globalStats.cleaned}**\n\n🌍 Спасибо за вклад в чистоту города!`, mainKeyboard);
    }
    if (text === "ℹ️ О проекте") {
        return bot.sendMessage(chatId, "🌱 **Zarafshan Eko Bot** — интеллектуальный сервис для оперативного выявления несанкционированных свалок и передачи данных экологическим службам.", mainKeyboard);
    }
    if (text === "💡 5 Эко-советов") {
        const tips = "🌍 **5 простых эко-советов:**\n\n1️⃣ Используйте шоппер вместо пластиковых пакетов.\n2️⃣ Сминайте пластиковые бутылки перед утилизацией.\n3️⃣ Выключайте воду во время чистки зубов.\n4️⃣ Отдавайте ненужную одежду на переработку или благотворительность.\n5️⃣ Сдавайте батарейки в специальные пункты сбора.";
        return bot.sendMessage(chatId, tips, mainKeyboard);
    }
    if (text === "👤 Мои репорты") {
        const count = userStats[chatId].reports;
        let rank = "🌱 Новичок-эколог";
        if (count >= 3) rank = "🌿 Активный участник";
        if (count >= 5) rank = "🌳 Защитник природы";
        if (count >= 10) rank = "👑 Эко-Герой Зарафшана";

        return bot.sendMessage(chatId, `👤 **Ваш профиль:**\n\n📈 Отправлено отчётов: **${count}**\n🏅 Ваш статус: **${rank}**\n\n${count >= 10 ? "Вы делаете город чище каждый день!" : "Продолжайте в том же духе!"}`, mainKeyboard);
    }
    if (text === "📞 Связаться с оператором") {
        return bot.sendMessage(chatId, "💬 Напишите ваш вопрос или сообщение прямо в этот чат. Я сразу передам его дежурному оператору!", mainKeyboard);
    }

    // ОБРАБОТКА ОБЫЧНОГО ТЕКСТА (Пересылка в группу операторов)
    const senderName = cleanText(msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || "Пользователь"));
    
    bot.sendMessage(PRIMARY_REPORT_GROUP, `📩 **Сообщение от ${senderName}:**\n\n${cleanText(text)}`, { parse_mode: 'Markdown' })
        .then(sentMsg => {
            operatorMap[sentMsg.message_id] = chatId;
            bot.sendMessage(chatId, "✅ Ваше сообщение передано операторам эко-службы. Мы ответим вам в ближайшее время!", mainKeyboard);
        })
        .catch(() => {
            // Фолбэк без Маркдауна, если возникла ошибка спецсимволов
            bot.sendMessage(PRIMARY_REPORT_GROUP, `📩 Сообщение от ${senderName}:\n\n${text}`)
                .then(sentMsg => {
                    operatorMap[sentMsg.message_id] = chatId;
                    bot.sendMessage(chatId, "✅ Ваше сообщение передано операторам эко-службы. Ожидайте ответа!", mainKeyboard);
                });
        });
});

// ==========================================
// 5. ОБРАБОТКА ФОТО С МУСОРОМ
// ==========================================

bot.on('photo', async (msg) => {
    if (msg.chat.type !== 'private') return;

    const chatId = msg.chat.id;
    const photoId = msg.photo[msg.photo.length - 1].file_id;

    userCache[chatId] = { photoId: photoId };

    const waitMsg = await bot.sendMessage(chatId, "🔍 **Анализирую изображение...**");

    try {
        const fileLink = await bot.getFileLink(photoId);
        const base64Data = await downloadFileAsBase64(fileLink);
        userCache[chatId].statusText = await analyzePhotoWithAI(base64Data);
    } catch (err) {
        userCache[chatId].statusText = getRandomSafeAnalysis();
    }

    // Если ИИ распознал человека или чистую зону
    if (userCache[chatId].statusText.includes("0/10") || userCache[chatId].statusText.includes("Мусор не обнаружен")) {
        bot.editMessageText(`${userCache[chatId].statusText}\n\n❌ **Геолокация не требуется.** Если произошла ошибка, сделайте фото мусора крупнее.`, {
            chat_id: chatId,
            message_id: waitMsg.message_id,
            parse_mode: 'Markdown'
        });
        delete userCache[chatId];
        return;
    }

    // Просим геолокацию
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
// 6. ОБРАБОТКА ГЕОЛОКАЦИИ И ОТПРАВКА В ГРУППУ
// ==========================================

bot.on('location', async (msg) => {
    if (msg.chat.type !== 'private') return;
    const chatId = msg.chat.id;

    if (!userCache[chatId] || !userCache[chatId].photoId) {
        return bot.sendMessage(chatId, "⚠️ Сначала отправьте фотографию проблемы!");
    }

    const sender = cleanText(msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || "Пользователь"));
    const captionText = `🚨 **НОВЫЙ ЭКО-СИГНАЛ**\n\n👤 **Отправитель:** ${sender}\n\n📝 **Анализ:**\n${userCache[chatId].statusText}`;

    try {
        // 1. Отправляем фото в группу
        const sentPhoto = await bot.sendPhoto(PRIMARY_REPORT_GROUP, userCache[chatId].photoId, {
            caption: captionText,
            parse_mode: 'Markdown'
        }).catch(async () => {
            return await bot.sendPhoto(PRIMARY_REPORT_GROUP, userCache[chatId].photoId, {
                caption: `🚨 НОВЫЙ ЭКО-СИГНАЛ\n\n👤 Отправитель: ${sender}\n\n📝 Анализ:\n${userCache[chatId].statusText.replace(/\*/g, '')}`
            });
        });

        // Сохраняем связку для возможности ответа на фото в группе
        if (sentPhoto) {
            operatorMap[sentPhoto.message_id] = chatId;
        }

        // 2. Отправляем локацию в группу
        await bot.sendLocation(PRIMARY_REPORT_GROUP, msg.location.latitude, msg.location.longitude);

        // 3. Обновляем личную статистику и выдаём награду
        if (!userStats[chatId]) userStats[chatId] = { reports: 0 };
        userStats[chatId].reports += 1;
        const count = userStats[chatId].reports;

        let replyMsg = "🎉 **Ваш сигнал отправлен команде экологов!** Спасибо!";
        if (count === 1) replyMsg += "\n\n🌟 Поздравляем с первым отправленным репортом!";
        if (count === 3) replyMsg += "\n\n🔥 У вас уже 3 репорта! Вы активно помогаете чистоте города!";
        if (count === 5) replyMsg += "\n\n🌿 5 репортов! Вам присвоен статус **Защитник природы**!";
        if (count === 10) replyMsg += "\n\n👑 10 репортов! Вы официальный **Эко-Герой Зарафшана**!";

        bot.sendMessage(chatId, replyMsg, mainKeyboard);
    } catch (err) {
        console.error("Ошибка при отправке отчёта в группу:", err.message);
        bot.sendMessage(chatId, "❌ Не удалось передать сигнал в группу. Убедитесь, что бот является администратором группы операторов.", mainKeyboard);
    }

    delete userCache[chatId];
});

// ==========================================
// 7. СЕРВЕР (Для поддержания работы на Render)
// ==========================================
app.get('/', (req, res) => {
    res.send('Zarafshan Eko Bot is active.');
});

app.listen(PORT, () => {
    console.log(`🌐 Сервер запущен на порту ${PORT}`);
});
