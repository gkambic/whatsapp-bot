require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const OpenAI = require('openai');
const pino = require('pino');

// Elegir proveedor: groq (default) u openai
const PROVEEDOR = (process.env.AI_PROVIDER || 'groq').toLowerCase();

let apiKey, baseURL, MODELO;
if (PROVEEDOR === 'groq') {
    apiKey = process.env.GROQ_API_KEY;
    baseURL = 'https://api.groq.com/openai/v1';
    MODELO = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    if (!apiKey) {
        console.error('❌ Falta configurar GROQ_API_KEY en los Secrets.');
        console.error('   Conseguí tu API key en: https://console.groq.com');
        process.exit(1);
    }
} else {
    apiKey = process.env.OPENAI_API_KEY;
    baseURL = undefined;
    MODELO = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    if (!apiKey || apiKey.startsWith('sk-xxx')) {
        console.error('❌ Falta configurar OPENAI_API_KEY en los Secrets.');
        console.error('   Conseguí tu API key en: https://platform.openai.com/api-keys');
        process.exit(1);
    }
}

console.log(`🧠 Proveedor de IA: ${PROVEEDOR} | Modelo: ${MODELO}`);

const openai = new OpenAI({ apiKey, baseURL });
const PERSONALIDAD = process.env.BOT_PERSONALITY ||
    'Sos un asistente virtual amigable que responde por WhatsApp. Respondé de forma breve y clara, en español. Usá emojis de vez en cuando. Si no sabés algo, decilo honestamente.';

// Historial de conversaciones por usuario
const conversaciones = new Map();
const MAX_HISTORIAL = 20;

// ============================================
// COMANDOS RÁPIDOS
// ============================================

const comandosRapidos = {
    'menu': `📋 *MENÚ DEL BOT*\n\n` +
            `1️⃣ *hora* - Te digo la hora actual\n` +
            `2️⃣ *fecha* - Te digo la fecha de hoy\n` +
            `3️⃣ *reset* - Borrar historial de conversación\n\n` +
            `💬 También podés *preguntarme cualquier cosa* y te respondo con IA.`,
    'info': '🤖 Soy un bot con IA que entiende tus preguntas.\nUso GPT para responder de forma inteligente.',
    'ayuda': '💡 *AYUDA*\n\nPodés escribirme cualquier pregunta y te respondo.\nNo hace falta usar comandos específicos, ¡simplemente hablame!\n\nComandos rápidos: *menu*, *hora*, *fecha*, *reset*',
    'hola': '¡Hola! 👋 Soy un bot con IA. Escribí *menu* para ver lo que puedo hacer, o preguntame lo que quieras.',
    'hi': '¡Hola! 👋 Soy un bot con IA. Escribí *menu* para ver lo que puedo hacer, o preguntame lo que quieras.',
    'buenas': '¡Buenas! 👋 Soy un bot con IA. Escribí *menu* para ver lo que puedo hacer, o preguntame lo que quieras.',
};

// ============================================
// FUNCIÓN DE IA
// ============================================

async function preguntarIA(userId, mensajeUsuario) {
    if (!conversaciones.has(userId)) {
        conversaciones.set(userId, []);
    }
    const historial = conversaciones.get(userId);

    historial.push({ role: 'user', content: mensajeUsuario });

    while (historial.length > MAX_HISTORIAL) {
        historial.shift();
    }

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
    historial.push({ role: 'assistant', content: textoRespuesta });

    return textoRespuesta;
}

// ============================================
// CONEXIÓN DE WHATSAPP
// ============================================

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_session');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        browser: Browsers.ubuntu('Chrome'),
        logger: pino({ level: 'silent' }),
    });

    // Evento: actualización de conexión
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('');
            console.log('📱 Escaneá este código QR con WhatsApp:');
            console.log('   (WhatsApp > Dispositivos vinculados > Vincular dispositivo)');
            console.log('');
            qrcode.generate(qr, { small: true });
            QRCode.toFile('./qr.png', qr, { width: 400, margin: 2 })
                .then(() => console.log('🖼️  QR guardado en qr.png'))
                .catch(err => console.error('Error guardando QR:', err.message));
        }

        if (connection === 'open') {
            console.log('');
            console.log('✅ ¡Bot conectado y listo!');
            console.log('📨 Esperando mensajes...');
            console.log('');
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`🔌 Desconectado (código: ${statusCode})`);
            if (shouldReconnect) {
                console.log('🔄 Reconectando...');
                iniciarBot();
            } else {
                console.log('❌ Sesión cerrada. Borrá la carpeta auth_session y volvé a escanear el QR.');
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Evento: mensajes nuevos
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            console.log(`🔎 Evento de mensaje | fromMe=${msg.key.fromMe} | jid=${msg.key.remoteJid} | tipo=${Object.keys(msg.message || {}).join(',') || 'vacío'}`);

            // Ignorar grupos
            if (msg.key.remoteJid.endsWith('@g.us')) continue;

            // Obtener texto del mensaje
            const textoMensaje = msg.message?.conversation ||
                                 msg.message?.extendedTextMessage?.text;
            if (!textoMensaje) continue;

            const userId = msg.key.remoteJid;
            const texto = textoMensaje.toLowerCase().trim();

            console.log(`📩 Mensaje de ${userId}: ${textoMensaje}`);

            // Marcar como leído
            await sock.readMessages([msg.key]);

            // Comando: reset
            if (texto === 'reset') {
                conversaciones.delete(userId);
                await sock.sendMessage(userId, { text: '🧹 Historial borrado. Empezamos de cero.' });
                console.log('   ✅ Historial reseteado');
                continue;
            }

            // Comandos rápidos
            if (comandosRapidos[texto]) {
                await sock.sendMessage(userId, { text: comandosRapidos[texto] });
                console.log(`   ✅ Comando rápido: ${texto}`);
                continue;
            }

            // Comando: hora
            if (texto === 'hora') {
                const hora = new Date().toLocaleTimeString('es-AR', {
                    hour: '2-digit', minute: '2-digit', second: '2-digit'
                });
                await sock.sendMessage(userId, { text: `🕐 Son las *${hora}*` });
                console.log('   ✅ Respondido con: hora');
                continue;
            }

            // Comando: fecha
            if (texto === 'fecha') {
                const fecha = new Date().toLocaleDateString('es-AR', {
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                });
                await sock.sendMessage(userId, { text: `📅 Hoy es *${fecha}*` });
                console.log('   ✅ Respondido con: fecha');
                continue;
            }

            // Para todo lo demás → IA
            try {
                await sock.sendPresenceUpdate('composing', userId);
                const respuestaIA = await preguntarIA(userId, textoMensaje);
                await sock.sendMessage(userId, { text: respuestaIA });
                console.log(`   🤖 IA respondió (${respuestaIA.length} chars)`);
            } catch (error) {
                console.error('   ❌ Error de IA:', error.message);
                let mensajeError = '⚠️ Hubo un error al procesar tu mensaje. Intentá de nuevo en unos segundos.';
                if (error.status === 429) {
                    if (/quota|billing|insufficient/i.test(error.message)) {
                        mensajeError = `⚠️ La cuenta de ${PROVEEDOR} no tiene crédito disponible.`;
                    } else {
                        mensajeError = '⚠️ Demasiadas consultas en poco tiempo. Esperá unos segundos y volvé a probar.';
                    }
                } else if (error.status === 401) {
                    mensajeError = `⚠️ La API key de ${PROVEEDOR} es inválida o fue revocada. Actualizala en los Secrets de Replit.`;
                } else if (error.status === 404 || /model/i.test(error.message)) {
                    mensajeError = `⚠️ El modelo "${MODELO}" no está disponible. Cambiá el modelo en los Secrets.`;
                }
                await sock.sendMessage(userId, { text: mensajeError });
            }
        }
    });
}

// ============================================
// INICIAR
// ============================================

console.log('');
console.log('🚀 Iniciando bot de WhatsApp...');
console.log('');

iniciarBot();
