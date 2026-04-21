// Permitir certificados SSL corporativos (solo para pruebas en redes con proxy)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const OpenAI = require('openai');

// Verificar que la API key esté configurada
if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.startsWith('sk-xxx')) {
    console.error('❌ Falta configurar OPENAI_API_KEY en el archivo .env');
    console.error('   Conseguí tu API key en: https://platform.openai.com/api-keys');
    process.exit(1);
}

// Configurar OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODELO = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const PERSONALIDAD = process.env.BOT_PERSONALITY ||
    'Sos un asistente virtual amigable que responde por WhatsApp. Respondé de forma breve y clara, en español.';

// Historial de conversaciones por usuario (se mantiene en memoria)
const conversaciones = new Map();

// IDs de mensajes ya respondidos (para evitar loops al escribirte a vos mismo)
const mensajesRespondidos = new Set();

// Prefijo invisible que el bot agrega a sus respuestas para identificarlas
const BOT_PREFIX = '\u200B'; // Zero-width space

// Buscar Chrome instalado en el sistema
function findChromePath() {
    const possiblePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    ];
    const fs = require('fs');
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

const chromePath = findChromePath();
if (!chromePath) {
    console.error('❌ No se encontró Google Chrome instalado.');
    console.error('   Instalalo desde https://www.google.com/chrome/');
    process.exit(1);
}
console.log(`🌐 Usando Chrome: ${chromePath}`);

// Crear cliente con autenticación local (guarda la sesión para no escanear QR cada vez)
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: chromePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// ============================================
// CONFIGURACIÓN DE COMANDOS RÁPIDOS
// ============================================

const MAX_HISTORIAL = 20; // Máximo de mensajes por conversación (para no gastar tokens de más)

const comandosRapidos = {
    'menu': `📋 *MENÚ DEL BOT*\n\n` +
            `1️⃣ *hora* - Te digo la hora actual\n` +
            `2️⃣ *fecha* - Te digo la fecha de hoy\n` +
            `3️⃣ *reset* - Borrar historial de conversación\n\n` +
            `💬 También podés *preguntarme cualquier cosa* y te respondo con IA.`,
    'info': '🤖 Soy un bot con IA que entiende tus preguntas.\nUso GPT para responder de forma inteligente.',
    'ayuda': '💡 *AYUDA*\n\nPodés escribirme cualquier pregunta y te respondo.\nNo hace falta usar comandos específicos, ¡simplemente hablame!\n\nComandos rápidos: *menu*, *hora*, *fecha*, *reset*',
};

// ============================================
// EVENTOS DEL BOT
// ============================================

// Mostrar código QR en la terminal para escanear con WhatsApp
client.on('qr', (qr) => {
    console.log('📱 Escanea este código QR con WhatsApp:');
    console.log('   (WhatsApp > Dispositivos vinculados > Vincular dispositivo)');
    console.log('');
    qrcode.generate(qr, { small: true });
});

// El bot se conectó exitosamente
client.on('ready', () => {
    console.log('');
    console.log('✅ ¡Bot conectado y listo!');
    console.log('📨 Esperando mensajes...');
    console.log('');
    console.log('Para detener el bot, presiona Ctrl+C');
});

// Se está cargando la sesión guardada
client.on('authenticated', () => {
    console.log('🔐 Autenticación exitosa');
});

// Error de autenticación
client.on('auth_failure', (msg) => {
    console.error('❌ Error de autenticación:', msg);
});

// Desconexión
client.on('disconnected', (reason) => {
    console.log('🔌 Bot desconectado:', reason);
});

// ============================================
// FUNCIÓN DE IA
// ============================================

async function preguntarIA(userId, mensajeUsuario) {
    // Obtener o crear historial de este usuario
    if (!conversaciones.has(userId)) {
        conversaciones.set(userId, []);
    }
    const historial = conversaciones.get(userId);

    // Agregar mensaje del usuario al historial
    historial.push({ role: 'user', content: mensajeUsuario });

    // Limitar historial para no gastar tokens de más
    while (historial.length > MAX_HISTORIAL) {
        historial.shift();
    }

    // Llamar a OpenAI
    const respuesta = await openai.chat.completions.create({
        model: MODELO,
        messages: [
            { role: 'system', content: PERSONALIDAD },
            ...historial,
        ],
        max_tokens: 500,
        temperature: 0.7,
    });

    const textoRespuesta = respuesta.choices[0].message.content.trim();

    // Guardar respuesta en el historial
    historial.push({ role: 'assistant', content: textoRespuesta });

    return textoRespuesta;
}

// ============================================
// LÓGICA DE MENSAJES
// ============================================

// Usamos 'message_create' en vez de 'message' para capturar también
// los mensajes que te enviás a vos mismo (chat personal)
client.on('message_create', async (message) => {
    // Ignorar mensajes que no sean de texto
    if (message.type !== 'chat') return;

    // Log de debug
    console.log(`🔍 DEBUG | fromMe: ${message.fromMe} | from: ${message.from} | to: ${message.to} | body: ${message.body.substring(0, 50)}`);

    const chat = await message.getChat();

    // Ignorar grupos
    if (chat.isGroup) return;

    // Evitar responder a mensajes que ya procesamos (previene loops)
    if (mensajesRespondidos.has(message.id._serialized)) return;
    mensajesRespondidos.add(message.id._serialized);

    // Ignorar mensajes que empiezan con el prefijo del bot (son respuestas nuestras)
    if (message.body.startsWith(BOT_PREFIX)) {
        console.log('   ⏭️ Ignorando respuesta propia del bot');
        return;
    }

    // Limpiar mensajes viejos del set (cada 100 mensajes)
    if (mensajesRespondidos.size > 100) {
        const entries = [...mensajesRespondidos];
        entries.slice(0, 50).forEach(id => mensajesRespondidos.delete(id));
    }

    const texto = message.body.toLowerCase().trim();
    const userId = message.from;

    console.log(`📩 Mensaje de ${userId}: ${message.body}`);

    // Comando: reset (borrar historial)
    if (texto === 'reset') {
        conversaciones.delete(userId);
        await chat.sendMessage(BOT_PREFIX + '🧹 Historial borrado. Empezamos de cero.');
        console.log('   ✅ Historial reseteado');
        return;
    }

    // Comandos rápidos
    if (comandosRapidos[texto]) {
        await chat.sendMessage(BOT_PREFIX + comandosRapidos[texto]);
        console.log(`   ✅ Comando rápido: ${texto}`);
        return;
    }

    // Comando especial: hora
    if (texto === 'hora') {
        const hora = new Date().toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        await chat.sendMessage(BOT_PREFIX + `🕐 Son las *${hora}*`);
        console.log('   ✅ Respondido con: hora');
        return;
    }

    // Comando especial: fecha
    if (texto === 'fecha') {
        const fecha = new Date().toLocaleDateString('es-AR', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        await chat.sendMessage(BOT_PREFIX + `📅 Hoy es *${fecha}*`);
        console.log('   ✅ Respondido con: fecha');
        return;
    }

    // Para todo lo demás → responder con IA
    try {
        await chat.sendStateTyping(); // Mostrar "escribiendo..."
        const respuestaIA = await preguntarIA(userId, message.body);
        await chat.sendMessage(BOT_PREFIX + respuestaIA);
        console.log(`   🤖 IA respondió (${respuestaIA.length} chars)`);
    } catch (error) {
        console.error('   ❌ Error de IA:', error.message);
        await chat.sendMessage(BOT_PREFIX + '⚠️ Hubo un error al procesar tu mensaje. Intentá de nuevo en unos segundos.');
    }
});

// ============================================
// INICIAR EL BOT
// ============================================

console.log('');
console.log('🚀 Iniciando bot de WhatsApp...');
console.log('   Esto puede tardar unos segundos la primera vez.');
console.log('');

client.initialize();
