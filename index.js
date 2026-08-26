const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const https = require('https');

// ==========================================
// 1. НАСТРОЙКИ И ИНИЦИАЛИЗАЦИЯ
// ==========================================
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const geminiApiKey = process.env.GEMINI_API_KEY;

// Указанный ID целевой рабочей группы
const TARGET_GROUP_ID = process.env.GROUP_ID || "-5534738545";

const bot = new TelegramBot(botToken, { polling: true });
const genAI = new GoogleGenerativeAI(geminiApiKey);

const app = express();
const PORT = process.env.PORT || 3000;

// Хранилища данных в оперативной памяти
const userCache = {};   // Сессии обработки (фото + гео)
const userStats = {};   // Статистика пользователей: { chatId: { reports: count } }
const operatorMap = {};  // Связь сообщений в группе с юзерами: { group_message_id: user_chat_id }

// Глобальная статистика (можно изменять прямо из группы через команду /setstats)
let globalStats = {
    signals: 134,
    cleared: 42
};

console.log("==========================================");
console.log("🚀 Запуск Zarafshan Eko Bot (Ultimate Operator Edition)...");
console.log("🔑 Telegram Token:", botToken ? "Подключён ✅" : "ОТСУТСТВУЕТ ❌");
console.log("🔑 Gemini API Key:", geminiApiKey ? "Подключён ✅" : "ОТСУТСТВУЕТ ❌");
console.log("👥 Target Group ID:", TARGET_GROUP_ID);
console.log("==========================================");

// Главное меню пользователя
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

// Загрузка изображения в Base64 для передачи в Gemini API
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

// Запасные нейтральные шаблоны анализа фото (если ИИ недоступен)
function getRandomAnalysisFallback() {
    const templates = [
        "✅ **Анализ:** Объект зафиксирован в базе. Требуется выездная проверка эко-инспектора.\n📊 **Уровень:** Требует осмотра 👁‍🗨",
        "✅ **Анализ:** Фотография принята в обработку. Тип загрязнения уточняется оператором.\n📊 **Уровень:** В очереди на проверку ⏳",
        "✅ **Анализ:** Зафиксированы признаки накопления отходов. Карточка сформирована.\n📊 **Уровень:** Требует внимания ⚠️"
    ];
    return templates[Math.floor(Math.random() * templates.length)];
}

// Каскадный вызов моделей ИИ
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
            console.warn(`⚠️ Модель ${modelName} недоступна, переключаемся...`);
        }
    }
    throw new Error("Все модели ИИ временно недоступны");
}

// ==========================================
// 3. РАБОТА В ГРУППЕ ОПЕРАТОРОВИ УПРАВЛЕНИЕ
// ==========================================

// Обработка сообщений из групп
bot.on('message', async (msg) => {
    const chatIdStr = msg.chat.id.toString();

    // Блокировка работы в чужих группах
    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
        if (chatIdStr !== TARGET_GROUP_ID) {
            // Игнорируем любые чужие группы
            return;
        }

        // КОМАНДА В ГРУППЕ: Изменение глобальной статистики
        // Пример использования: /setstats 150 50
        if (msg.text && msg.text.startsWith('/setstats')) {
            const parts = msg.text.split(' ');
            if (parts.length === 3 && !isNaN(parts[1]) && !isNaN(parts[2])) {
                globalStats.signals = parseInt(parts[1]);
                globalStats.cleared = parseInt(parts[2]);
                return bot.sendMessage(TARGET_GROUP_ID, `✅ **Статистика обновлена!**\n\n📊 Сигналов: ${globalStats.signals}\n🧹 Устранено: ${globalStats.cleared}`, { parse_mode: 'Markdown' });
            } else {
                return bot.sendMessage(TARGET_GROUP_ID, "⚠️ Формат команды: `/setstats [всего_сигналов] [устранено]`\nПример: `/setstats 150 50`", { parse_mode: 'Markdown' });
            }
        }

        // РЕЖИМ ОПЕРАТОРА: Ответ юзеру через Reply на сообщение
        if (msg.reply_to_message && operatorMap[msg.reply_to_message.message_id]) {
            const targetUserId = operatorMap[msg.reply_to_message.message_id];
            
            try {
                if (msg.text) {
                    await bot.sendMessage(targetUserId, `🧑‍💻 **Ответ от оператора эко-службы:**\n\n${msg.text}`);
                    await bot.sendMessage(TARGET_GROUP_ID, `✅ Ответ успешно доставлен пользователю!`, { reply_to_message_id: msg.message_id });
                } else if (msg.photo) {
                    const photoId = msg.photo[msg.photo.length - 1].file_id;
                    await bot.sendPhoto(targetUserId, photoId, { caption: `🧑‍💻 **Ответ оператора:**\n\n${msg.caption || ''}` });
                    await bot.sendMessage(TARGET_GROUP_ID, `✅ Фото-ответ доставлен пользователю!`, { reply_to_message_id: msg.message_id });
                }
            } catch (err) {
                bot.sendMessage(TARGET_GROUP_ID, `❌ Не удалось доставить ответ. Возможно, пользователь заблокировал бота.`);
            }
        }
        return; // Завершаем обработку для группы
    }
});

// ==========================================
// 4. ЛИЧНЫЕ СООБЩЕНИЯ (ДИАЛОГ И МЕНЮ)
// ==========================================

bot.onText(/\/start/, (msg) => {
    if (msg.chat.type !== 'private') return;
    const chatId = msg.chat.id;
    if (!userStats[chatId]) userStats[chatId] = { reports: 0 };

    bot.sendMessage(chatId, "👋 **Добро пожаловать в Zarafshan Eko Bot!**\n\nЯ умный экологический помощник. Отправляйте фото загрязнений, задавайте вопросы или используйте меню ниже 👇", mainKeyboard);
});

bot.on('message', async (msg) => {
    if (msg.chat.type !== 'private') return;

    const chatId = msg.chat.id;
    if (!userStats[chatId]) userStats[chatId] = { reports: 0 };

    // ПАСХАЛКА №1: Стикер с элифантом (🐘)
    if (msg.sticker) {
        if (msg.sticker.emoji && msg.sticker.emoji.includes('🐘')) {
            return bot.sendMessage(chatId, "🐘 **Слонёнок — это Талгат!** 😄", mainKeyboard);
        }
        return;
    }

    const text = msg.text;
    if (!text || text.startsWith('/') || msg.photo || msg.location) return;

    const lowerText = text.toLowerCase();

    // ПАСХАЛКА №2: Создатели
    if (lowerText.includes('кто создатель') || lowerText.includes('кто тебя создал') || lowerText.includes('кто авторы')) {
        return bot.sendMessage(chatId, "👑 **Главные создатели этого шедевра:**\nАлишер, Талгат и Айдамир! 😎", mainKeyboard);
    }

    // ОБРАБОТКА МЕНЮ
    if (text === "📸 Инструкция по фото") {
        return bot.sendMessage(chatId, "📷 **Шаг 1:** Отправьте фотографию мусора.\n🧠 **Шаг 2:** Нейросеть проанализирует снимок.\n📍 **Шаг 3:** Отправьте геопозицию этого места.", mainKeyboard);
    } 
    if (text === "📍 Как отправить гео") {
        return bot.sendMessage(chatId, "Нажмите на **скрепку 📎** -> **«Геопозиция»** -> **«Отправить текущую геопозицию»**.", mainKeyboard);
    } 
    if (text === "📊 Статистика") {
        return bot.sendMessage(chatId, `📊 **Глобальная статистика эко-проекта:**\n\n📥 Сигналов получено: **${globalStats.signals}**\n🧹 Устранено свалок: **${globalStats.cleared}**\n\n*Спасибо за вклад в чистоту региона!*`, mainKeyboard);
    } 
    if (text === "ℹ️ О проекте") {
        return bot.sendMessage(chatId, "🌱 **Zarafshan Eko Bot** — нейросетевая платформа для оперативного выявления несанкционированных свалок и координации эко-служб.", mainKeyboard);
    } 
    if (text === "👤 Мои репорты") {
        const count = userStats[chatId].reports;
        let rank = "🌱 Новичок-эколог";
        if (count >= 5) rank = "🌿 Продвинутый защитник";
        if (count >= 10) rank = "🌳 Эко-Герой Зарафшана";
        return bot.sendMessage(chatId, `👤 **Ваш личный профиль:**\n\n📈 Отправлено репортов: **${count}**\n🏅 Ваш статус: **${rank}**\n\nПродолжайте делать город чище!`, mainKeyboard);
    }
    if (text === "💡 5 Эко-советов") {
        const tips = "🌍 **Топ-5 полезных эко-привычек:**\n\n1️⃣ Используйте многоразовые тканевые сумки вместо пластиковых пакетов.\n2️⃣ Сминайте пластиковые бутылки и жестяные банки перед выбросом.\n3️⃣ Закрывайте кран во время чистки зубов.\n4️⃣ Сдавайте батарейки и электронику в специальные пункты сбора.\n5️⃣ Отдавайте ненужные вещи на переработку или благотворительность.";
        return bot.sendMessage(chatId, tips, mainKeyboard);
    } 

    // ОБРАБОТКА ОБЫЧНОГО ТЕКСТА (Пересылка в группу операторам + ответ ИИ)
    const username = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || "Пользователь");
    
    // Пересылаем сообщение в группу операторов
    bot.sendMessage(TARGET_GROUP_ID, `📩 **Сообщение от** ${username} (ID: \`${chatId}\`):\n\n${text}`, { parse_mode: 'Markdown' })
        .then(sentMsg => {
            operatorMap[sentMsg.message_id] = chatId; // Сохраняем ID для ответа
        }).catch(() => {});

    // ИИ-ответ пользователю (без упоминания поломок при ошибке)
    bot.sendChatAction(chatId, 'typing');
    try {
        const aiPrompt = `Ты — вежливый эко-ассистент Zarafshan Eko Bot. Ответь кратко и полезно на русском языке: ${text}`;
        const aiResponse = await chatWithAI(aiPrompt);
        bot.sendMessage(chatId, aiResponse);
    } catch (err) {
        // Мягкий фолбэк — пользователь думает, что сообщение передано человеку
        bot.sendMessage(chatId, "📥 Ваше сообщение передано дежурному оператору эко-службы. При необходимости мы свяжемся с вами!");
    }
});

// ==========================================
// 5. ОБРАБОТКА ФОТОГРАФИЙ
// ==========================================

bot.on('photo', async (msg) => {
    if (msg.chat.type !== 'private') return;

    const chatId = msg.chat.id;
    const photoId = msg.photo[msg.photo.length - 1].file_id;

    userCache[chatId] = { photoId: photoId };

    const waitMsg = await bot.sendMessage(chatId, "🔍 **Нейросеть изучают снимок...**");

    try {
        const fileLink = await bot.getFileLink(photoId);
        const base64Data = await downloadFileAsBase64(fileLink);

        // Промпт защиты от распознавания людей и обычных объектов как мусор
        const prompt = `Ты — экологический ИИ-аналитик.
1. Если на снимке человек, лицо, животное, здание, чистая улица или транспорт БЕЗ загрязнений — ответь СТРОГО:
✅ **Анализ ИИ:** Мусор не обнаружен. На фото сторонний объект.
📊 **Уровень:** 0/10

2. Если на фото есть мусор или свалка — ответь СТРОГО:
✅ **Анализ ИИ:** [Краткое описание типа мусора]
📊 **Уровень:** [Оценка от 1 до 10]/10`;

        userCache[chatId].statusText = await chatWithAI(prompt, base64Data);
    } catch (err) {
        console.error("⚠️ Ошибка ИИ:", err.message);
        // Не показываем ошибку, выдаем корректный фолбэк
        userCache[chatId].statusText = getRandomAnalysisFallback();
    }

    // Если на фото нет мусора
    if (userCache[chatId].statusText.includes("0/10") || userCache[chatId].statusText.includes("Мусор не обнаружен")) {
        bot.editMessageText(`${userCache[chatId].statusText}\n\n❌ Геолокация не требуется. Пожалуйста, сфотографируйте участок с мусором.`, {
            chat_id: chatId,
            message_id: waitMsg.message_id,
            parse_mode: 'Markdown'
        });
        delete userCache[chatId]; 
        return;
    }

    // Запрос геопозиции
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
// 6. ОБРАБОТКА ГЕОЛОКАЦИИ
// ==========================================

bot.on('location', async (msg) => {
    if (msg.chat.type !== 'private') return;
    const chatId = msg.chat.id;

    if (!userCache[chatId] || !userCache[chatId].photoId) {
        return bot.sendMessage(chatId, "⚠️ Сначала отправьте фотографию экологической проблемы!");
    }

    const sender = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || "Анонимный");
    const groupCaption = `🚨 **НОВЫЙ ЭКО-СИГНАЛ**\n\n👤 **Отправитель:** ${sender}\n\n📝 **Анализ:**\n${userCache[chatId].statusText}`;

    try {
        // 1. Отправляем фото и карточку сигнала в группу операторов
        const sentPhoto = await bot.sendPhoto(TARGET_GROUP_ID, userCache[chatId].photoId, { caption: groupCaption, parse_mode: 'Markdown' })
            .catch(async () => await bot.sendPhoto(TARGET_GROUP_ID, userCache[chatId].photoId, { caption: groupCaption.replace(/\*/g, "") }));
        
        // Связываем карточку сигнала с юзером для ответа оператора
        if (sentPhoto) operatorMap[sentPhoto.message_id] = chatId;

        // 2. Отправляем геолокацию
        await bot.sendLocation(TARGET_GROUP_ID, msg.location.latitude, msg.location.longitude);
        
        // 3. Обновляем статистику
        if (!userStats[chatId]) userStats[chatId] = { reports: 0 };
        userStats[chatId].reports += 1;
        globalStats.signals += 1;

        const count = userStats[chatId].reports;
        let msgReply = "🎉 **Сигнал успешно передан экологам!** Спасибо за помощь!";
        if (count === 1) msgReply += "\n\n🌟 Это ваш первый репорт!";
        if (count === 5) msgReply += "\n\n🔥 У вас уже 5 репортов! Вы настоящий защитник природы!";
        if (count === 10) msgReply += "\n\n👑 10 репортов! Вы официальный Эко-Герой Зарафшана!";

        bot.sendMessage(chatId, msgReply, mainKeyboard);
    } catch (err) {
        bot.sendMessage(chatId, "❌ Произошла ошибка отправки отчёта. Попробуйте снова.", mainKeyboard);
    }
    delete userCache[chatId];
});

// ==========================================
// 7. EXPRESS SERVER (WEB SERVICE)
// ==========================================
app.get('/', (req, res) => {
    res.send('Zarafshan Eko Bot Ultimate running...');
});

app.listen(PORT, () => {
    console.log(`🌐 Сервер запущен на порту ${PORT}`);
});
