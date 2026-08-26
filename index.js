const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const https = require('https');

// ==========================================
// 1. НАСТРОЙКИ И ИНИЦИАЛИЗАЦИЯ
// ==========================================
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const geminiApiKey = process.env.GEMINI_API_KEY;

// Разрешённые группы для операторов (только здесь бот будет слушать команды админов)
const ADMIN_GROUPS = ["-5534738545", "-1003510857116"];

const bot = new TelegramBot(botToken, { polling: true });
const genAI = new GoogleGenerativeAI(geminiApiKey);

const app = express();
const PORT = process.env.PORT || 3000;

// Хранилища данных (в оперативной памяти)
const userCache = {}; // Сессии для связи фото + ИИ + геопозиция
const userStats = {}; // Личная статистика пользователей
const operatorMap = {}; // Связь { message_id_в_группе: chat_id_пользователя }

// Глобальная статистика (можно менять из группы операторов)
let globalStats = {
    signals: 134,
    cleaned: 42
};

console.log("==========================================");
console.log("🚀 Запуск Zarafshan Eko Bot (Operator Edition)...");
console.log("🔑 Telegram Token:", botToken ? "Подключён ✅" : "ОТСУТСТВУЕТ ❌");
console.log("🔑 Gemini API Key:", geminiApiKey ? "Подключён ✅" : "ОТСУТСТВУЕТ ❌");
console.log("👥 Группы операторов:", ADMIN_GROUPS.join(', '));
console.log("==========================================");

// Главная клавиатура пользователей
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

// УМНЫЙ РЕЗЕРВ (Если ИИ сломался — мы не называем людей мусором)
function getSafeFallback() {
    const templates = [
        "✅ **Анализ (Автономный режим):** Фотография принята. Система передала снимок оператору для визуальной проверки на наличие загрязнений.\n📊 **Уровень:** Ожидает оценки 👁‍🗨",
        "✅ **Анализ (Автономный режим):** Сигнал зафиксирован. Нейросеть временно недоступна, поэтому точный уровень загрязнения определит дежурный эколог.\n📊 **Уровень:** Ожидает оценки 👁‍🗨"
    ];
    return templates[Math.floor(Math.random() * templates.length)];
}

// Функция общения с Gemini
async function analyzePhotoWithAI(base64Data) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Ты строгий ИИ-эколог. Внимательно посмотри на фото.
1. Если на фото четко виден человек, лицо, селфи, животное, или просто чистая улица/комната БЕЗ мусора — ответь СТРОГО ТАК:
✅ **Анализ ИИ:** Мусор не обнаружен. На фото другой объект.
📊 **Уровень:** 0/10

2. Если на фото ДЕЙСТВИТЕЛЬНО есть мусор, грязь или свалка — оцени масштаб и ответь СТРОГО ТАК:
✅ **Анализ ИИ:** [Опиши мусор кратко: пластик, ветки, стройматериалы]
📊 **Уровень:** [Твоя оценка от 1 до 10]/10`;

    const result = await model.generateContent([
        prompt,
        { inlineData: { data: base64Data, mimeType: "image/jpeg" } }
    ]);
    return result.response.text();
}

// ==========================================
// 3. ОБРАБОТКА ГРУПП (РЕЖИМ ОПЕРАТОРА)
// ==========================================

bot.on('message', async (msg) => {
    const chatId = msg.chat.id.toString();

    // Если сообщение написано в группе
    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
        // Если группа НЕ в белом списке — бот её полностью игнорирует
        if (!ADMIN_GROUPS.includes(chatId)) return;

        const text = msg.text || '';

        // КОМАНДА: Изменение статистики (только для админов в группе)
        if (text.startsWith('/setstats')) {
            const parts = text.split(' ');
            if (parts.length === 3) {
                globalStats.signals = parseInt(parts[1]) || globalStats.signals;
                globalStats.cleaned = parseInt(parts[2]) || globalStats.cleaned;
                return bot.sendMessage(chatId, `✅ **Статистика успешно обновлена!**\nТеперь в боте:\n— Сигналов: ${globalStats.signals}\n— Очищено: ${globalStats.cleaned}`, { parse_mode: 'Markdown' });
            } else {
                return bot.sendMessage(chatId, "⚠️ Использование: `/setstats [сигналы] [очищено]`\nПример: `/setstats 150 50`", { parse_mode: 'Markdown' });
            }
        }

        // КОМАНДА: Ответ пользователю через "Reply" (Ответить)
        if (msg.reply_to_message && operatorMap[msg.reply_to_message.message_id]) {
            const targetUserId = operatorMap[msg.reply_to_message.message_id];
            
            // Если оператор ответил текстом
            if (msg.text) {
                bot.sendMessage(targetUserId, `🧑‍💻 **Сообщение от эко-службы:**\n\n${msg.text}`);
            } 
            // Если оператор ответил фото
            else if (msg.photo) {
                const photoId = msg.photo[msg.photo.length - 1].file_id;
                const caption = msg.caption ? `🧑‍💻 **Фото от эко-службы:**\n\n${msg.caption}` : `🧑‍💻 **Фото от эко-службы**`;
                bot.sendPhoto(targetUserId, photoId, { caption: caption });
            }
        }
        return; // Останавливаем дальнейшую обработку для групповых чатов
    }

// ==========================================
// 4. ЛИЧНЫЕ СООБЩЕНИЯ (ПОЛЬЗОВАТЕЛИ)
// ==========================================

    // ПАСХАЛКА №1: СТИКЕР СЛОНА
    if (msg.sticker) {
        if (msg.sticker.emoji && msg.sticker.emoji.includes('🐘')) {
            return bot.sendMessage(chatId, "🐘 **Слоненок — это Талгат!** 😄");
        }
        return;
    }

    const text = msg.text;
    
    // Команда /start
    if (text === '/start') {
        if (!userStats[chatId]) userStats[chatId] = { reports: 0 };
        return bot.sendMessage(chatId, "👋 **Добро пожаловать в Zarafshan Eko Bot!**\n\nЯ умный помощник для борьбы с мусором. Отправляй фото загрязнений или используй меню ниже 👇", mainKeyboard);
    }

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
        return bot.sendMessage(chatId, `📊 **Глобальная статистика бота:**\n— Сигналов получено: **${globalStats.signals}**\n— Устранено свалок: **${globalStats.cleaned}**\n\n🌍 Спасибо за ваш вклад в чистоту города!`, mainKeyboard);
    } 
    if (text === "ℹ️ О проекте") {
        return bot.sendMessage(chatId, "🌱 **Zarafshan Eko Bot** — проект для оперативного выявления свалок. Наш ИИ отличает мусор от людей и зданий, а дежурные экологи готовы выехать на место!", mainKeyboard);
    } 
    if (text === "👤 Мои репорты") {
        const count = userStats[chatId].reports;
        let rank = "🌱 Новичок-эколог";
        if (count >= 3) rank = "🌿 Активный участник";
        if (count >= 5) rank = "🌳 Защитник природы";
        if (count >= 10) rank = "👑 Эко-Герой Зарафшана";
        return bot.sendMessage(chatId, `👤 **Твой профиль:**\n\n📈 Отправлено репортов: **${count}**\n🏅 Твой статус: **${rank}**\n\n${count >= 10 ? "Ты невероятный молодец! Спасибо за твой труд!" : "Продолжай в том же духе!"}`, mainKeyboard);
    }
    if (text === "💡 5 Эко-советов") {
        const tips = "🌍 **Топ-5 эко-советов:**\n1️⃣ Бери шоппер в магазин вместо пластиковых пакетов.\n2️⃣ Сминай пластиковые бутылки перед тем как выбросить — так они занимают меньше места.\n3️⃣ Выключай воду, пока чистишь зубы.\n4️⃣ Отдавай старую одежду нуждающимся, а не выбрасывай.\n5️⃣ Сдавай батарейки в специальные пункты утилизации.";
        return bot.sendMessage(chatId, tips, mainKeyboard);
    } 

    // ОБРАБОТКА ОБЫЧНОГО ТЕКСТА (ПЕРЕСЫЛКА АДМИНАМ)
    const username = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || "Пользователь");
    
    // Пересылаем сообщение в ПЕРВУЮ админскую группу по умолчанию
    const primaryAdminGroup = ADMIN_GROUPS[0];
    
    bot.sendMessage(primaryAdminGroup, `📩 **Вопрос от** ${username}:\n\n${text}`, { parse_mode: 'Markdown' })
        .then(sentMsg => {
            operatorMap[sentMsg.message_id] = chatId; // Сохраняем для возможности ответа
            bot.sendMessage(chatId, "✅ Ваше сообщение передано операторам эко-службы. Ожидайте ответа!");
        })
        .catch(err => console.error("Ошибка пересылки текста в группу:", err));
});

// ==========================================
// 5. ОБРАБОТКА ФОТО (ИИ АНАЛИЗ)
// ==========================================

bot.on('photo', async (msg) => {
    if (msg.chat.type !== 'private') return;

    const chatId = msg.chat.id;
    const photoId = msg.photo[msg.photo.length - 1].file_id;

    userCache[chatId] = { photoId: photoId };

    const waitMsg = await bot.sendMessage(chatId, "🔍 **Анализирую снимок...**");

    try {
        const fileLink = await bot.getFileLink(photoId);
        const base64Data = await downloadFileAsBase64(fileLink);
        
        userCache[chatId].statusText = await analyzePhotoWithAI(base64Data);
    } catch (err) {
        console.error("⚠️ Ошибка ИИ:", err.message);
        // Запускаем безопасный шаблон
        userCache[chatId].statusText = getSafeFallback();
    }

    // Если ИИ распознал человека/отсутствие мусора (сработала защита)
    if (userCache[chatId].statusText.includes("0/10") || userCache[chatId].statusText.includes("Мусор не обнаружен")) {
        bot.editMessageText(`${userCache[chatId].statusText}\n\n❌ **Геолокация не требуется.** Если вы ошиблись, пожалуйста, сфотографируйте сам мусор крупнее.`, {
            chat_id: chatId,
            message_id: waitMsg.message_id,
            parse_mode: 'Markdown'
        });
        delete userCache[chatId]; 
        return;
    }

    // Если мусор найден или сработал резерв — просим гео
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
// 6. ОБРАБОТКА ГЕОЛОКАЦИИ И ОТПРАВКА В ГРУППУ
// ==========================================

bot.on('location', async (msg) => {
    if (msg.chat.type !== 'private') return;
    const chatId = msg.chat.id;

    if (!userCache[chatId] || !userCache[chatId].photoId) {
        return bot.sendMessage(chatId, "⚠️ Сначала отправьте фотографию экологической проблемы!");
    }

    const sender = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || "Анонимный");
    const groupCaption = `🚨 **НОВЫЙ ЭКО-СИГНАЛ**\n\n👤 **Отправитель:** ${sender}\n\n📝 **Анализ:**\n${userCache[chatId].statusText}`;

    const primaryAdminGroup = ADMIN_GROUPS[0]; // Отправляем в первую группу из списка

    try {
        await bot.sendPhoto(primaryAdminGroup, userCache[chatId].photoId, { caption: groupCaption, parse_mode: 'Markdown' })
            .catch(async () => await bot.sendPhoto(primaryAdminGroup, userCache[chatId].photoId, { caption: groupCaption.replace(/\*/g, "") }));

        await bot.sendLocation(primaryAdminGroup, msg.location.latitude, msg.location.longitude);

        // ОБНОВЛЕНИЕ ЛИЧНОЙ СТАТИСТИКИ И АЧИВКИ
        if (!userStats[chatId]) userStats[chatId] = { reports: 0 };
        userStats[chatId].reports += 1;
        const count = userStats[chatId].reports;

        let msgReply = "🎉 **Сигнал успешно передан экологам!** Спасибо!";
        if (count === 1) msgReply += "\n\n🌟 Это твой первый репорт! Добро пожаловать в команду.";
        if (count === 3) msgReply += "\n\n🔥 Ого, уже 3 репорта! Ты активно помогаешь городу!";
        if (count === 5) msgReply += "\n\n🌿 5 репортов! Ты настоящий защитник природы!";
        if (count === 10) msgReply += "\n\n👑 Невероятно! 10 репортов! Ты официальный Эко-Герой!";

        bot.sendMessage(chatId, msgReply, mainKeyboard);
    } catch (err) {
        bot.sendMessage(chatId, "❌ Произошла ошибка. Скорее всего, бот не был добавлен в группу операторов или не имеет прав.", mainKeyboard);
    }
    delete userCache[chatId];
});

// ==========================================
// 7. СЕРВЕР (Для поддержания активности)
// ==========================================
app.get('/', (req, res) => {
    res.send('Zarafshan Eko Bot Ultimate running...');
});

app.listen(PORT, () => {
    console.log(`🌐 Сервер запущен на порту ${PORT}`);
});
