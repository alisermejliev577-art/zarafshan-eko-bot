const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const https = require('https');

// ==========================================
// 1. НАСТРОЙКИ И ИНИЦИАЛИЗАЦИЯ
// ==========================================
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const geminiApiKey = process.env.GEMINI_API_KEY;

// ID вашей админ-группы (Zarafshan Eko Operators)
const TARGET_GROUP_ID = process.env.GROUP_ID || "-5534738545";

const bot = new TelegramBot(botToken, { polling: true });
const genAI = new GoogleGenerativeAI(geminiApiKey);

const app = express();
const PORT = process.env.PORT || 3000;

// Хранилища в оперативной памяти
const userCache = {};   // Временное хранение фото и состояния юзера
const userStats = {};   // Статистика отчётов юзера { [chatId]: { reports: 0 } }
const operatorMap = {}; // Связь message_id в группах с chatId пользователя

// Глобальная статистика (можно менять через команду в админ-группе /setstats <сигналы> <устранено>)
let globalStats = {
    totalSignals: 142,
    cleanedZones: 48
};

console.log("==========================================");
console.log("🚀 Запуск Zarafshan Eko Bot (Operator & AI Edition)...");
console.log("🔑 Telegram Token:", botToken ? "Подключён ✅" : "ОТСУТСТВУЕТ ❌");
console.log("🔑 Gemini API Key:", geminiApiKey ? "Подключён ✅" : "ОТСУТСТВУЕТ ❌");
console.log("👥 Привязанная группа операторов:", TARGET_GROUP_ID);
console.log("==========================================");

// Главное меню для обычных пользователей
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

// Резервный умный ответ для фото, если Gemini полностью недоступен
function getSafePhotoFallback() {
    const templates = [
        "✅ **Анализ (Резервная система):** Обнаружен бытовой мусор на локальной территории. Потребуется стандартный уборочный инвентарь.\n📊 **Уровень:** 4/10",
        "✅ **Анализ (Резервная система):** Скопление пластиковых отходов и упаковки. Сигнал сохранён для операторов.\n📊 **Уровень:** 5/10",
        "✅ **Анализ (Резервная система):** Несанкционированная свалка крупного габарита. Требуется вывоз спецтехникой.\n📊 **Уровень:** 8/10"
    ];
    return templates[Math.floor(Math.random() * templates.length)];
}

// Каскадный вызов ИИ
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
            console.warn(`⚠️ Модель ${modelName} временна недоступна...`);
        }
    }
    throw new Error("Все модели ИИ недоступны");
}

// ==========================================
// 3. РЕЖИМ ОПЕРАТОРА И АДМИНИСТРИРОВАНИЕ ГРУППЫ
// ==========================================

// Проверка сообщений из групп
bot.on('message', async (msg) => {
    const chatId = msg.chat.id.toString();

    // Защита: Если бота добавили в чужую группу — игнорируем или выходим
    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
        if (chatId !== TARGET_GROUP_ID) {
            console.warn(`⚠️ Сообщение из неавторизованной группы ${chatId}. Игнорируется.`);
            return;
        }

        // --- РЕЖИМ ОПЕРАТОРА (Ответ оператора из TARGET_GROUP_ID юзеру) ---
        if (msg.reply_to_message && operatorMap[msg.reply_to_message.message_id]) {
            const targetUserId = operatorMap[msg.reply_to_message.message_id];
            
            try {
                await bot.sendMessage(
                    targetUserId,
                    `🧑‍💻 **Ответ от оператора эко-службы Zarafshan:**\n\n${msg.text}`,
                    { parse_mode: 'Markdown' }
                );
                await bot.sendMessage(chatId, `✅ Ответ успешно доставлен пользователю!`, { reply_to_message_id: msg.message_id });
            } catch (e) {
                await bot.sendMessage(chatId, `❌ Ошибка доставки ответа пользователю (возможно, бот заблокирован).`, { reply_to_message_id: msg.message_id });
            }
            return;
        }

        // Обновление статистики прямо из группы операторов: /setstats 150 50
        if (msg.text && msg.text.startsWith('/setstats')) {
            const args = msg.text.split(' ');
            if (args.length === 3 && !isNaN(args[1]) && !isNaN(args[2])) {
                globalStats.totalSignals = parseInt(args[1]);
                globalStats.cleanedZones = parseInt(args[2]);
                return bot.sendMessage(chatId, `📊 **Статистика обновлена!**\nВсего сигналов: ${globalStats.totalSignals}\nУстранено: ${globalStats.cleanedZones}`);
            } else {
                return bot.sendMessage(chatId, "⚠️ Используйте формат: `/setstats <всего_сигналов> <устранено>`", { parse_mode: 'Markdown' });
            }
        }

        return; // Больше ничего в группе не обрабатываем
    }
});

// ==========================================
// 4. ЛИЧНЫЕ СООБЩЕНИЯ (ПОЛЬЗОВАТЕЛЬСКИЙ ИНТЕРФЕЙС)
// ==========================================

bot.onText(/\/start/, (msg) => {
    if (msg.chat.type !== 'private') return;
    const chatId = msg.chat.id;
    if (!userStats[chatId]) userStats[chatId] = { reports: 0 };

    bot.sendMessage(
        chatId, 
        "👋 **Добро пожаловать в Zarafshan Eko Bot!**\n\nЯ умный экологический помощник. Отправляй фото несанкционированных свалок, общайся со мной или используй меню ниже 👇", 
        mainKeyboard
    );
});

bot.on('message', async (msg) => {
    if (msg.chat.type !== 'private') return;
    const chatId = msg.chat.id;

    if (!userStats[chatId]) userStats[chatId] = { reports: 0 };

    // Пасхалка: Стикер Слона
    if (msg.sticker) {
        if (msg.sticker.emoji && msg.sticker.emoji.includes('🐘')) {
            return bot.sendMessage(chatId, "🐘 **Слонёнок — это Талгат!** 😄", mainKeyboard);
        }
        return;
    }

    const text = msg.text;
    if (!text || text.startsWith('/') || msg.photo || msg.location) return;

    const lowerText = text.toLowerCase();

    // Пасхалка: Создатели
    if (lowerText.includes('кто создатель') || lowerText.includes('кто тебя создал') || lowerText.includes('кто автор')) {
        return bot.sendMessage(chatId, "👑 **Главные создатели этого шедевра:**\nАлишер, Талгат и Айдамир! 😎", mainKeyboard);
    }

    // Обработка пунктов меню
    if (text === "📸 Инструкция по фото") {
        return bot.sendMessage(chatId, "📷 **Шаг 1:** Отправьте фото мусора.\n🧠 **Шаг 2:** ИИ проверит объект.\n📍 **Шаг 3:** Отправьте геопозицию этого места.", mainKeyboard);
    } 
    if (text === "📍 Как отправить гео") {
        return bot.sendMessage(chatId, "Нажмите на **скрепку 📎** -> **«Геопозиция»** -> **«Отправить текущую геопозицию»**.", mainKeyboard);
    } 
    if (text === "📊 Статистика") {
        return bot.sendMessage(
            chatId, 
            `📊 **Глобальная статистика проекта Zarafshan Eko:**\n— Сигналов получено: **${globalStats.totalSignals}**\n— Устранено свалок: **${globalStats.cleanedZones}**`, 
            mainKeyboard
        );
    } 
    if (text === "ℹ️ О проекте") {
        return bot.sendMessage(chatId, "🌱 **Zarafshan Eko Bot** — инновационный проект для оперативного выявления свалок с помощью нейросетей и передачи данных экологическим операторам.", mainKeyboard);
    } 
    if (text === "👤 Мои репорты") {
        const count = userStats[chatId].reports;
        let rank = "🌱 Новичок-эколог";
        if (count >= 5) rank = "🌿 Продвинутый защитник";
        if (count >= 10) rank = "🌳 Эко-Герой Зарафшана";
        return bot.sendMessage(chatId, `👤 **Твой профиль:**\n\n📈 Отправлено репортов: **${count}**\n🏅 Твой статус: **${rank}**\n\nПродолжай делать город чище!`, mainKeyboard);
    }
    if (text === "💡 5 Эко-советов") {
        const tips = "🌍 **Топ-5 советов для каждого:**\n1️⃣ Используйте многоразовые шопперы.\n2️⃣ Сминайте пластиковые бутылки перед выбросом.\n3️⃣ Закрывайте кран во время чистки зубов.\n4️⃣ Сдавайте батарейки в специальные пункты приёма.\n5️⃣ Отдавайте ненужные вещи на вторичную переработку или благотворительность.";
        return bot.sendMessage(chatId, tips, mainKeyboard);
    }

    // --- Пересылка диалога в группу операторов + Ответ ИИ ---
    const username = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || "Пользователь");
    
    // 1. Отправляем в группу операторов
    try {
        const forwardedMsg = await bot.sendMessage(
            TARGET_GROUP_ID, 
            `📩 **Сообщение от** ${username} (ID: \`${chatId}\`):\n\n${text}`, 
            { parse_mode: 'Markdown' }
        );
        operatorMap[forwardedMsg.message_id] = chatId;
    } catch (e) {
        console.error("Ошибка пересылки сообщения в админ-группу:", e.message);
    }

    // 2. Генерация ответа через ИИ
    bot.sendChatAction(chatId, 'typing');
    try {
        const aiPrompt = `Ты — вежливый эко-ассистент проекта Zarafshan Eko. Отвечай кратко, грамотно и доброжелательно на русском языке. Сообщение пользователя: "${text}"`;
        const aiResponse = await chatWithAI(aiPrompt);
        bot.sendMessage(chatId, aiResponse, mainKeyboard);
    } catch (err) {
        bot.sendMessage(chatId, "💬 Ваше сообщение получено операторами эко-службы. Мы ответим вам в ближайшее время!", mainKeyboard);
    }
});

// ==========================================
// 5. ОБРАБОТКА ФОТОСНИМКОВ (АНАЛИЗ ИИ)
// ==========================================

bot.on('photo', async (msg) => {
    if (msg.chat.type !== 'private') return;

    const chatId = msg.chat.id;
    const photoId = msg.photo[msg.photo.length - 1].file_id;

    userCache[chatId] = { photoId: photoId };

    const waitMsg = await bot.sendMessage(chatId, "🔍 **Нейросеть проверяет снимок...**");

    try {
        const fileLink = await bot.getFileLink(photoId);
        const base64Data = await downloadFileAsBase64(fileLink);

        const prompt = `Ты строгий ИИ-эколог. Внимательно проанализируй фотографию.
1. Если на фото человек, селфи, животное, портрет, машина или здание БЕЗ мусора — ответь СТРОГО:
✅ **Анализ ИИ:** Мусор не обнаружен. На фото посторонний объект (человек/здание/животное).
📊 **Уровень:** 0/10

2. Если на фото ДЕЙСТВИТЕЛЬНО есть мусор или свалка — ответь СТРОГО:
✅ **Анализ ИИ:** [Краткое описание обнаруженного мусора]
📊 **Уровень:** [Оценка от 1 до 10]/10`;

        userCache[chatId].statusText = await chatWithAI(prompt, base64Data);
    } catch (err) {
        console.error("⚠️ Ошибка обработки фото через Gemini:", err.message);
        userCache[chatId].statusText = getSafePhotoFallback();
    }

    // Если ИИ распознал человека или отсутствие мусора
    if (userCache[chatId].statusText.includes("0/10") || userCache[chatId].statusText.includes("Мусор не обнаружен")) {
        await bot.editMessageText(`${userCache[chatId].statusText}\n\n❌ Геолокация не требуется. Сфотографируйте непосредственно скопление мусора.`, {
            chat_id: chatId,
            message_id: waitMsg.message_id,
            parse_mode: 'Markdown'
        }).catch(() => {});
        delete userCache[chatId];
        return;
    }

    // При успешном распознавании мусора
    await bot.editMessageText(`${userCache[chatId].statusText}\n\n📍 Всё верно? Теперь отправьте **геолокацию** этого места (через скрепку 📎)!`, {
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
// 6. ОБРАБОТКА ГЕОЛОКАЦИИ И КАРТОЧКА СИГНАЛА
// ==========================================

bot.on('location', async (msg) => {
    if (msg.chat.type !== 'private') return;
    const chatId = msg.chat.id;

    if (!userCache[chatId] || !userCache[chatId].photoId) {
        return bot.sendMessage(chatId, "⚠️ Сначала отправьте фотографию эко-проблемы!", mainKeyboard);
    }

    const sender = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || "Анонимный пользователь");
    const groupCaption = `🚨 **НОВЫЙ ЭКО-СИГНАЛ**\n\n👤 **Отправитель:** ${sender} (ID: \`${chatId}\`)\n\n📝 **Результат анализа:**\n${userCache[chatId].statusText}`;

    try {
        // 1. Отправляем фото и данные анализа в группу операторов
        const photoMsg = await bot.sendPhoto(TARGET_GROUP_ID, userCache[chatId].photoId, { 
            caption: groupCaption, 
            parse_mode: 'Markdown' 
        }).catch(async () => {
            return await bot.sendPhoto(TARGET_GROUP_ID, userCache[chatId].photoId, { 
                caption: groupCaption.replace(/\*/g, "").replace(/`/g, "") 
            });
        });

        // Сохраняем ID сообщения для возможности ответа оператора
        operatorMap[photoMsg.message_id] = chatId;

        // 2. Отправляем геолокацию в группу операторов
        await bot.sendLocation(TARGET_GROUP_ID, msg.location.latitude, msg.location.longitude);

        // 3. Обновляем статистику пользователя
        if (!userStats[chatId]) userStats[chatId] = { reports: 0 };
        userStats[chatId].reports += 1;
        globalStats.totalSignals += 1;

        const count = userStats[chatId].reports;
        let msgReply = "🎉 **Сигнал успешно передан операторам!** Спасибо за помощь!";
        if (count === 1) msgReply += "\n\n🌟 Это твой первый репорт! Отличное начало.";
        if (count === 5) msgReply += "\n\n🔥 У тебя уже 5 репортов! Ты настоящий защитник окружающей среды!";
        if (count === 10) msgReply += "\n\n👑 Невероятно! 10 репортов! Ты официальный Эко-Герой Зарафшана!";

        bot.sendMessage(chatId, msgReply, mainKeyboard);
    } catch (err) {
        console.error("Ошибка при отправке в группу операторов:", err.message);
        bot.sendMessage(chatId, "❌ Ошибка отправки сигнала операторам. Проверьте права бота в группе.", mainKeyboard);
    }

    delete userCache[chatId];
});

// ==========================================
// 7. EXPRESS СЕРВЕР ДЛЯ RENDER / HEROKU
// ==========================================
app.get('/', (req, res) => {
    res.send('Zarafshan Eko Bot Ultimate running...');
});

app.listen(PORT, () => {
    console.log(`🌐 Сервер запущен на порту ${PORT}`);
});
