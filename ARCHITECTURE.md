# 🏗️ Arquitectura del bot

Este documento explica **cómo está armado el código**, qué hace cada parte y **por qué se tomó cada decisión**. Si querés entender, modificar o contribuir al proyecto, empezá por acá.

---

## Visión general

Todo el bot vive en un único archivo: **`index.js`** (~190 líneas). Es un proceso Node.js de larga duración con tres responsabilidades:

```
   ┌─────────────────┐
   │   WhatsApp Web  │
   │    (Baileys)    │
   └────────┬────────┘
            │ mensajes entrantes
            ▼
   ┌─────────────────┐
   │   index.js      │
   │   (router)      │
   └────────┬────────┘
            │ si no es comando rápido
            ▼
   ┌─────────────────┐
   │  Cliente OpenAI │
   │  (Gemini / Groq │
   │   / OpenAI)     │
   └─────────────────┘
```

¿Por qué un solo archivo? El proyecto es chico, no justifica modularizar. Mantenerlo plano hace que sea fácil de leer y modificar para alguien que recién empieza.

---

## Las 7 secciones de `index.js`

### 1. Imports y configuración del proveedor de IA

```js
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason,
        fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const OpenAI = require('openai');
```

**Por qué Baileys y no `whatsapp-web.js`:** Baileys habla el protocolo de WhatsApp **nativamente** (sockets), sin necesidad de un navegador real. La alternativa popular (`whatsapp-web.js`) usa Puppeteer + Chromium, que consume mucha más RAM y CPU y es complicado de hacer andar en Replit.

**Por qué el SDK de OpenAI para los tres proveedores:** Groq y Google Gemini exponen endpoints **compatibles con la API de OpenAI**. Eso nos permite usar un único cliente y cambiar de proveedor solo modificando dos cosas: `apiKey` y `baseURL`. No hace falta instalar tres SDKs distintos ni mantener tres branches de código casi idénticos.

```js
const PROVEEDOR = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
```

**Decisión:** el proveedor se elige por variable de entorno, con un default por rama. Así el código de las tres ramas (`main`, `groq`, `gemini`) es prácticamente igual y se puede mergear fácil.

---

### 2. Definición del cliente y modelo

Bloque `if/else if/else` que arma `apiKey`, `baseURL` y `MODELO` según el proveedor. Si falta la API key, **el proceso termina** con un mensaje claro (`process.exit(1)`).

**Por qué fallar rápido:** si arranca sin key, después cada mensaje del usuario va a recibir un error genérico. Es preferible que el operador vea el error en consola al iniciar que descubrirlo cuando un usuario manda un mensaje.

| Proveedor | `baseURL`                                              | Modelo default              |
|-----------|--------------------------------------------------------|------------------------------|
| `gemini`  | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-1.5-flash`         |
| `groq`    | `https://api.groq.com/openai/v1`                       | `llama-3.3-70b-versatile`    |
| `openai`  | (default del SDK: `https://api.openai.com/v1`)         | `gpt-4o-mini`                |

---

### 3. Comandos rápidos

```js
const comandosRapidos = {
    'menu': '...',
    'hola': '...',
    ...
};
```

**Por qué esto y no todo a la IA:** las respuestas a `menu`, `hola`, `info`, etc. **no cambian nunca**. Mandárselas a la IA sería tirar tokens y latencia al pedo. Este enfoque tiene tres beneficios:
- Respuesta instantánea (0 ms vs 500-2000 ms de la IA).
- Costo cero (no consume cuota).
- Determinismo (siempre responde lo mismo, útil para info clave como el menú).

---

### 4. Función `preguntarIA`

```js
async function preguntarIA(userId, mensajeUsuario) { ... }
```

Encapsula la llamada al modelo y maneja el **historial conversacional por usuario**:

- `conversaciones` es un `Map` en memoria: `{ userId → [mensajes] }`.
- `MAX_HISTORIAL = 20` mensajes por usuario.
- Cada mensaje del usuario se appendea al array; si supera 20, se descartan los más viejos (FIFO).

**Por qué un Map en memoria y no una base de datos:**
- Simplicidad. No hay nada para configurar.
- Para un bot personal con uso modesto, alcanza.
- **Trade-off conocido:** si el proceso se reinicia, se pierde el historial de todos los usuarios. Si esto te importa, reemplazá el `Map` por **Replit Database**, **SQLite** o **Redis** sin tocar el resto del código.

**Por qué incluir un `system prompt`** (`PERSONALIDAD`): le da al modelo instrucciones permanentes (idioma, tono, longitud). Esto va antes del historial en cada llamada para que la IA no se "olvide" de cómo tiene que responder.

**Por qué `max_tokens: 500` y `temperature: 0.7`:**
- 500 tokens = ~350 palabras, más que suficiente para WhatsApp y evita respuestas eternas.
- Temperatura 0.7 = balance entre creatividad y coherencia. Más bajo (0.2) sería más "robótico"; más alto (1.0) puede divagar.

---

### 5. Función `iniciarBot` — conexión a WhatsApp

#### Autenticación con archivos
```js
const { state, saveCreds } = await useMultiFileAuthState('./auth_session');
```
Baileys guarda las credenciales como un conjunto de archivos JSON en `auth_session/`. **Ventaja:** no se corrompen tan fácil como un único archivo monolítico (problema común en versiones viejas).

#### Versión y "navegador" simulado
```js
const { version } = await fetchLatestBaileysVersion();
const sock = makeWASocket({
    version,
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    logger: pino({ level: 'silent' }),
});
```

**Por qué `fetchLatestBaileysVersion()`:** WhatsApp valida la "versión de WhatsApp Web" que el cliente dice ser. Si está desactualizada, **rechaza la conexión con error 405**. Esta función consulta cuál es la versión vigente y nos asegura compatibilidad.

**Por qué `Browsers.ubuntu('Chrome')`:** identifica al cliente como Chrome en Ubuntu. WhatsApp es más permisivo con identificaciones "comunes" — ayuda a evitar bloqueos preventivos.

**Por qué `pino({ level: 'silent' })`:** Baileys es muy verboso por default. Silenciamos su logger interno para que la consola sea legible y nuestros propios `console.log` se vean.

#### Manejo de eventos

El socket de Baileys emite eventos. Escuchamos tres:

##### `connection.update`
- Si llega un `qr`: lo imprimimos en consola (formato ASCII) y lo guardamos como PNG.
  - **Por qué guardarlo como imagen:** desde el celular o por chat es difícil leer un QR ASCII; un PNG se puede ver en cualquier lado.
- Si `connection === 'open'`: estamos vinculados.
- Si `connection === 'close'`:
  - Si es **logout** (DisconnectReason.loggedOut), no reconectamos — la sesión está muerta y hay que escanear QR de nuevo.
  - Cualquier otro caso: reintentamos llamando a `iniciarBot()` recursivamente.

##### `creds.update`
- Cada vez que las credenciales cambian (rotación de claves de sesión), las persistimos con `saveCreds()`. Si esto faltara, la sesión se pierde al reiniciar.

##### `messages.upsert`
- Es el evento principal: llega un mensaje nuevo. Procesamos en este orden:
  1. **Log de diagnóstico** (`fromMe`, `jid`, tipo).
  2. **Filtro de grupos:** si `remoteJid` termina en `@g.us`, lo ignoramos.
  3. **Extracción de texto:** los mensajes de WhatsApp tienen muchos formatos. Soportamos los dos más comunes: `conversation` (texto plano) y `extendedTextMessage` (texto con formato/respuesta a otro mensaje). Si el mensaje es una imagen/sticker/audio, no hay `textoMensaje` y se ignora.
  4. **Marcado como leído:** `sock.readMessages([msg.key])` muestra los doble-tildes azules.
  5. **Routing:**
     - `reset` → borra historial.
     - Comando rápido conocido → respuesta fija.
     - `hora` / `fecha` → respuestas dinámicas locales.
     - Cualquier otra cosa → IA.
  6. **`sendPresenceUpdate('composing')`** antes de la IA: muestra "escribiendo…" en el chat del usuario, así sabe que el bot está procesando.
  7. **Manejo de errores:** capturamos por `error.status` y devolvemos al usuario un mensaje específico (sin saldo, rate limit, key inválida, modelo inexistente). Así el usuario sabe qué pasó sin tener que pedirnos el log a nosotros.

**Por qué no filtramos `fromMe`:** lo dejamos pasar a propósito para que el operador pueda **testear el bot escribiéndose a sí mismo** desde el WhatsApp vinculado.

---

### 6. Pipeline de un mensaje (resumen visual)

```
Mensaje entrante
    │
    ├─ ¿es de grupo?            → ignorar
    ├─ ¿tiene texto?            → si no, ignorar
    ├─ ¿es "reset"?             → borrar historial, responder
    ├─ ¿es comando rápido?      → respuesta fija
    ├─ ¿es "hora" o "fecha"?    → respuesta dinámica local
    └─ todo lo demás            → preguntarIA() → respuesta del modelo
```

---

### 7. Arranque

```js
console.log('\n🚀 Iniciando bot de WhatsApp...\n');
iniciarBot();
```

Trivial: imprime el banner y arranca. No usamos `try/catch` global porque queremos que un crash sea visible (Replit lo va a reiniciar automáticamente vía workflow).

---

## Estructura de archivos

```
whatsapp-bot/
├── index.js          ← Todo el código del bot
├── package.json      ← Dependencias
├── package-lock.json ← Versiones exactas (commiteado)
├── README.md         ← Cómo usar el bot
├── ARCHITECTURE.md   ← Este archivo (cómo está hecho y por qué)
├── replit.md         ← Notas internas para el agente de Replit
├── auth_session/     ← (autogenerado, NO commiteado) credenciales de WhatsApp
├── qr.png            ← (autogenerado) último QR generado, en PNG
├── node_modules/     ← (autogenerado) dependencias instaladas
└── .gitignore        ← Excluye auth_session, node_modules, .env, etc.
```

---

## Dependencias clave

| Paquete                       | Para qué se usa                                                          |
|-------------------------------|--------------------------------------------------------------------------|
| `@whiskeysockets/baileys`     | Cliente de WhatsApp Web (sockets, sin navegador).                        |
| `openai`                      | SDK que usamos para los tres proveedores (compatible Gemini/Groq/OpenAI).|
| `qrcode-terminal`             | Renderiza el QR en ASCII en la consola.                                  |
| `qrcode`                      | Genera el PNG del QR (`qr.png`).                                         |
| `pino`                        | Logger usado por Baileys (lo silenciamos).                               |
| `dotenv`                      | Carga el `.env` cuando se corre fuera de Replit.                         |

---

## Decisiones de diseño en una tabla

| Decisión                                        | Por qué                                                                 |
|-------------------------------------------------|-------------------------------------------------------------------------|
| Usar Baileys en lugar de `whatsapp-web.js`      | Más liviano, sin Chromium, anda mejor en Replit.                        |
| Usar el SDK de OpenAI para los 3 proveedores    | Gemini y Groq son compatibles → un solo cliente, código DRY.            |
| Proveedor por variable de entorno               | Permite usar la misma base de código en las 3 ramas.                    |
| Historial en memoria (Map)                      | Simple. Para uso personal alcanza. Fácil de cambiar a una DB después.   |
| Comandos rápidos hardcodeados                   | Cero latencia y cero costo en respuestas que no varían.                 |
| Fallar rápido si falta API key                  | Errores visibles en consola al arrancar, no en runtime al primer chat.  |
| Guardar el QR como PNG además del ASCII         | El ASCII es ilegible en muchos lados (móvil, copy/paste).                |
| Reconexión automática (excepto logout)          | Robustez ante caídas de red sin requerir intervención manual.            |
| Logs detallados de eventos de mensaje           | Cuando algo no funciona, los logs te dicen exactamente qué llegó.        |
| Mensajes de error específicos al usuario        | El usuario final entiende sin tener que pedirle al dev que mire logs.   |
| Ignorar grupos                                  | Evita spam y prevención de baneos.                                      |

---

## Cómo extender el bot

### Agregar un comando rápido nuevo
Agregalo al objeto `comandosRapidos`:
```js
'chiste': '😂 ¿Qué le dijo un pez a otro? Nada.',
```

### Agregar un comando con lógica
Después del bloque de `hora`/`fecha` y antes del `try` de IA:
```js
if (texto === 'clima') {
    const data = await fetch('https://...').then(r => r.json());
    await sock.sendMessage(userId, { text: `🌤️ ${data.temp}°C` });
    continue;
}
```

### Persistir el historial
Reemplazá el `Map` por una capa de storage (Replit DB, SQLite, Redis). Los métodos a tocar son: `conversaciones.has`, `.get`, `.set`, `.delete`.

### Soportar imágenes / audios entrantes
Detectá `msg.message?.imageMessage` o `audioMessage`, descargá el buffer con `downloadMediaMessage` de Baileys, y mandalo a un modelo multimodal (Gemini o GPT-4o lo soportan).

### Cambiar el proveedor
Solo cambiá el Secret `AI_PROVIDER` y, si hace falta, agregá la API key del nuevo proveedor. No hay que tocar código.
