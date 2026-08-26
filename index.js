const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const https = require('https');

// ==========================================
// 1. НАСТРОЙКИ И ИНИЦИАЛИЗАЦИЯ
// ==========================================
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const geminiApiKey = process.env.GEMINI_API_KEY;

// ID вашей группы Zarafshan Eko (с минусом в начале)
const TARGET_GROUP_ID = process.env.GROUP_ID || "-1003510857116";

const bot = new TelegramBot(botToken, { polling: true });
const genAI = new GoogleGenerativeAI(geminiApiKey);

const app = express();
const PORT = process.env.PORT || 3000;

// Хранилища (в оперативной памяти)
const userCache = {}; // Сессии для фото + геопозиции
const userStats = {}; // Статистика отправленных репортов
const operatorMap = {}; // Связь сообщений в группе с юзерами { message_id: chat_id }

console.log("==========================================");
console.log("🚀 Запуск Zarafshan Eko Bot (Ultimate Edition)...");
console.log("🔑 Telegram Token:", botToken ? "Подключён ✅" : "ОТСУТСТВУЕТ ❌");
console.log("🔑 Gemini API Key:", geminiApiKey ? "Подключён ✅" : "ОТСУТСТВУЕТ ❌");
console.log("👥 Target Group ID:", TARGET_GROUP_ID);
console.log("==========================================");

// Главная клавиатура
const mainKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: "📸 Инструкция по фото" }, { text: "📍 Как отправить гео" }],
            [{ text: "👤 Мои репорты" }, { text: "💡 5 Эко-советов" }],
            [{ text: "📊 Статистика" }, { text: "ℹ️ О проекте" }]
        ],
        resize_keyboard: true
    },
    parse_mode: 'Markdown'
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

// БЕЗОПАСНЫЙ РЕЗЕРВ (Если ИИ сломался - не называем людей мусором)
function getSafeFallback() {
    return "✅ **Анализ (Резервная система):** Нейросеть временно недоступна или перегружена. Сигнал сохранён как подозрительный и будет проверен оператором вручную.\n📊 **Уровень:** Требует осмотра 👁‍🗨";
}

// Каскадный вызов ИИ (пробуем разные модели, если одна упала)
async function chatWithAI(userPrompt, base64Data = null) {
    const models = ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-1.5-pro"];
    
    for (const modelName of models) {
        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            let result;
            
            if (base64Data) {
                result = await model.generateContent([
                    userPrompt,
                    { inlineData: { data: base64Data, mimeType: "image/jpeg" } }
                ]);
            } else {
                result = await model.generateContent(userPrompt);
            }
            
            const text = result.response.text();
            if (text) return text;
        } catch (err) {
            console.warn(`⚠️ Модель ${modelName} недоступна, пробуем следующую...`);
        }
    }
    throw new Error("Все модели ИИ недоступны");
}

// ==========================================
// 3. ОБРАБОТКА КОМАНД, ТЕКСТА И РЕЖИМ ОПЕРАТОРА
// ==========================================

bot.onText(/\/start/, (msg) => {
    if (msg.chat.type !== 'private') return;
    const chatId = msg.chat.id;
    if (!userStats[chatId]) userStats[chatId] = { reports: 0 };

    bot.sendMessage(chatId, "👋 **Добро пожаловать в Zarafshan Eko Bot!**\n\nЯ умный помощник для борьбы с мусором. Отправляй фото загрязнений, общайся со мной или используй меню ниже 👇", mainKeyboard);
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    // --- РЕЖИМ ОПЕРАТОРА (ОТВЕТ ИЗ ГРУППЫ ЮЗЕРУ) ---
    // Если сообщение написано в вашей группе и это "Ответ" (Reply) на сообщение бота
    if (chatId.toString() === TARGET_GROUP_ID) {
        if (msg.reply_to_message && operatorMap[msg.reply_to_message.message_id]) {
            const targetUserId = operatorMap[msg.reply_to_message.message_id];
            // Отправляем ответ юзеру
            bot.sendMessage(targetUserId, `🧑‍💻 **Ответ от оператора эко-службы:**\n\n${msg.text}`);
        }
        return; // Дальше не обрабатываем команды из группы
    }

    if (msg.chat.type !== 'private') return;
    
    // ПАСХАЛКА №1: СТИКЕР СЛОНА
    if (msg.sticker) {
        if (msg.sticker.emoji && msg.sticker.emoji.includes('🐘')) {
            return bot.sendMessage(chatId, "🐘 **Слоненок — это Талгат!** 😄");
        }
        return; // Игнорируем другие стикеры
    }

    const text = msg.text;
    if (!text || text.startsWith('/') || msg.photo || msg.location) return;

    if (!userStats[chatId]) userStats[chatId] = { reports: 0 };
    const lowerText = text.toLowerCase();

    // ПАСХАЛКА №2: СОЗДАТЕЛИ
    if (lowerText.includes('кто создатель') || lowerText.includes('кто тебя создал')) {
        return bot.sendMessage(chatId, "👑 **Главные создатели этого шедевра:**\nАлишер, Талгат и Айдамир! 😎", mainKeyboard);
    }

    // ОБРАБОТКА МЕНЮ
    if (text === "📸 Инструкция по фото") {
        return bot.sendMessage(chatId, "📷 **Шаг 1:** Отправьте фото мусора.\n🧠 **Шаг 2:** ИИ проверит его.\n📍 **Шаг 3:** Скиньте геопозицию.", mainKeyboard);
    } 
    if (text === "📍 Как отправить гео") {
        return bot.sendMessage(chatId, "Нажмите на **скрепку 📎** -> **«Геопозиция»** -> **«Отправить текущую геопозицию»**.", mainKeyboard);
    } 
    if (text === "📊 Статистика") {
        return bot.sendMessage(chatId, "📊 **Глобальная статистика бота:**\n— Сигналов получено: 134\n— Устранено свалок: 42", mainKeyboard);
    } 
    if (text === "ℹ️ О проекте") {
        return bot.sendMessage(chatId, "🌱 **Zarafshan Eko Bot** — нейросетевой проект для оперативного выявления свалок. Наш ИИ отличает мусор от людей и зданий!", mainKeyboard);
    } 
    if (text === "👤 Мои репорты") {
        const count = userStats[chatId].reports;
        let rank = "🌱 Новичок-эколог";
        if (count >= 5) rank = "🌿 Продвинутый защитник";
        if (count >= 10) rank = "🌳 Эко-Герой Зарафшана";
        return bot.sendMessage(chatId, `👤 **Твой профиль:**\n\n📈 Отправлено репортов: **${count}**\n🏅 Твой статус: **${rank}**\n\nПродолжай в том же духе!`, mainKeyboard);
    }
    if (text === "💡 5 Эко-советов") {
        const tips = "🌍 **Топ-5 советов:**\n1️⃣ Бери шоппер вместо пакетов.\n2️⃣ Сминай пластиковые бутылки перед выбросом.\n3️⃣ Выключай воду, пока чистишь зубы.\n4️⃣ Отдавай старую одежду, а не выбрасывай.\n5️⃣ Сдавай батарейки в спец. пункты.";
        return bot.sendMessage(chatId, tips, mainKeyboard);
    } 

    // --- ЕСЛИ ЭТО ПРОСТО ТЕКСТ (Диалог с ИИ + Пересылка админам) ---
    
    // 1. Отправляем в группу админам, чтобы они видели и могли ответить
    const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
    bot.sendMessage(TARGET_GROUP_ID, `📩 **Сообщение от пользователя** ${username}:\n\n${text}`, { parse_mode: 'Markdown' })
        .then(sentMsg => {
            // Сохраняем ID сообщения в группе, чтобы привязывать ответы оператора к юзеру
            operatorMap[sentMsg.message_id] = chatId;
        });

    // 2. Отвечаем пользователю от лица ИИ
    bot.sendChatAction(chatId, 'typing');
    try {
        const aiPrompt = `Ты — дружелюбный эко-ассистент проекта Zarafshan Eko. Отвечай кратко, вежливо и полезно на русском языке. Пользователь пишет: ${text}`;
        const aiResponse = await chatWithAI(aiPrompt);
        bot.sendMessage(chatId, aiResponse);
    } catch (err) {
        bot.sendMessage(chatId, "🤖 Мои нейромозги сейчас отдыхают. Я передал ваше сообщение операторам, они скоро ответят!");
    }
});

// ==========================================
// 4. ОБРАБОТКА ФОТО (УМНАЯ ЗАЩИТА)
// ==========================================

bot.on('photo', async (msg) => {
    if (msg.chat.type !== 'private') return;

    const chatId = msg.chat.id;
    const photoId = msg.photo[msg.photo.length - 1].file_id;

    userCache[chatId] = { photoId: photoId };

    const waitMsg = await bot.sendMessage(chatId, "🔍 **Нейросеть пристально изучает снимок...**");

    try {
        const fileLink = await bot.getFileLink(photoId);
        const base64Data = await downloadFileAsBase64(fileLink);

        // УМНЫЙ ПРОМПТ - Защита от дурака (от людей, селфи, пустых улиц)
        const prompt = `Ты строгий ИИ-эколог. Внимательно посмотри на фото.
1. Если на фото изображен человек, лицо, селфи, животное, обычная улица, здание или транспорт БЕЗ мусора — ответь СТРОГО ТАК:
✅ **Анализ ИИ:** Мусор не обнаружен. На фото другой объект (человек/здание/животное).
📊 **Уровень:** 0/10

2. Если на фото ДЕЙСТВИТЕЛЬНО есть мусор, грязь или свалка — оцени масштаб и ответь СТРОГО ТАК:
✅ **Анализ ИИ:** [Опиши мусор кратко: пластик, стройматериалы и т.д.]
📊 **Уровень:** [Твоя оценка от 1 до 10]/10`;

        userCache[chatId].statusText = await chatWithAI(prompt, base64Data);
    } catch (err) {
        console.error("⚠️ Ошибка ИИ:", err.message);
        // БЕЗОПАСНЫЙ РЕЗЕРВ (без шаблонов про мусор)
        userCache[chatId].statusText = getSafeFallback();
    }

    // Если ИИ распознал человека/отсутствие мусора (защита сработала)
    if (userCache[chatId].statusText.includes("0/10") || userCache[chatId].statusText.includes("Мусор не обнаружен")) {
        bot.editMessageText(`${userCache[chatId].statusText}\n\n❌ Геолокация не требуется. Если вы ошиблись, сфотографируйте сам мусор.`, {
            chat_id: chatId,
            message_id: waitMsg.message_id,
            parse_mode: 'Markdown'
        });
        delete userCache[chatId]; 
        return;
    }

    // Если всё ок или сработал резерв - просим гео
    bot.editMessageText(`${userCache[chatId].statusText}\n\n📍 Всё верно? Теперь отправьте **геолокацию** этого места (через скрепку 📎)!`, {
        chat_id: chatId,
        message_id: waitMsg.message_id,
        parse_mode: 'Markdown'
    }).catch(() => {
        bot.editMessageText(`${userCache[chatId].statusText}\n\n📍 Всё верно? Теперь отправьте геолокацию этого места (через скрепку 📎)!`, {
            chat_id: chatId,
            message_id: waitMsg.message_id
        });
    });
});

// ==========================================
// 5. ОБРАБОТКА ГЕОЛОКАЦИИ И АЧИВКИ
// ==========================================

bot.on('location', async (msg) => {
    if (msg.chat.type !== 'private') return;
    const chatId = msg.chat.id;

    if (!userCache[chatId] || !userCache[chatId].photoId) {
        return bot.sendMessage(chatId, "⚠️ Сначала отправьте фотографию экологической проблемы!");
    }

    const sender = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || "Анонимный");
    const groupCaption = `🚨 **НОВЫЙ ЭКО-СИГНАЛ**\n\n👤 **Отправитель:** ${sender}\n\n📝 **Результат анализа:**\n${userCache[chatId].statusText}`;

    try {
        await bot.sendPhoto(TARGET_GROUP_ID, userCache[chatId].photoId, { caption: groupCaption, parse_mode: 'Markdown' })
            .catch(async () => await bot.sendPhoto(TARGET_GROUP_ID, userCache[chatId].photoId, { caption: groupCaption.replace(/\*/g, "") }));
        
        await bot.sendLocation(TARGET_GROUP_ID, msg.location.latitude, msg.location.longitude);
        
        // НАЧИСЛЯЕМ СТАТИСТИКУ И ВЫДАЕМ АЧИВКИ
        if (!userStats[chatId]) userStats[chatId] = { reports: 0 };
        userStats[chatId].reports += 1;
        const count = userStats[chatId].reports;
        
        let msgReply = "🎉 **Сигнал успешно передан экологам!** Спасибо!";
        if (count === 1) msgReply += "\n\n🌟 Это твой первый репорт! Ты начал путь эколога.";
        if (count === 5) msgReply += "\n\n🔥 Ого, уже 5 репортов! Ты настоящий защитник природы!";
        if (count === 10) msgReply += "\n\n👑 Невероятно! 10 репортов! Ты официальный Эко-Герой Зарафшана!";

        bot.sendMessage(chatId, msgReply, mainKeyboard);
    } catch (err) {
        bot.sendMessage(chatId, "❌ Ошибка отправки в группу. Проверьте права бота.", mainKeyboard);
    }
    delete userCache[chatId];
});

// ==========================================
// 6. SERVER (Защита от отключения Render)
// ==========================================
app.get('/', (req, res) => {
    res.send('Zarafshan Eko Bot Ultimate running...');
});

app.listen(PORT, () => {
    console.log(`🌐 Сервер запущен на порту ${PORT}`);
});
