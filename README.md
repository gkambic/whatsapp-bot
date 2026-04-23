# 🤖 WhatsApp Bot con IA

Bot de WhatsApp que responde de forma inteligente usando un modelo de IA. Soporta **tres proveedores intercambiables**: **Google Gemini**, **Groq** y **OpenAI**. Funciona corriendo en Replit (o en cualquier server Node.js) y se vincula a tu WhatsApp escaneando un código QR una sola vez.

> ℹ️ El proveedor se elige con la variable `AI_PROVIDER`. Cada rama del repo (`main`, `groq`, `gemini`) tiene un default distinto, pero el código es prácticamente el mismo.

---

## Características

- 💬 Responde mensajes privados de WhatsApp con IA conversacional.
- 🧠 Mantiene **historial por usuario** (las últimas 20 interacciones) para que la conversación tenga contexto.
- ⚡ Comandos rápidos pre-definidos (`menu`, `hora`, `fecha`, `reset`, etc.) que no consumen tokens de IA.
- 🔄 **Reconexión automática** ante caídas, sin perder la sesión vinculada.
- 🖼️ El código QR se imprime en consola **y se guarda como imagen** (`qr.png`) para poder verlo desde cualquier lado.
- 🔌 Proveedor de IA **intercambiable** vía variables de entorno (Gemini / Groq / OpenAI).
- ✉️ Mensajes de error claros para el usuario final ante fallas comunes (sin saldo, rate limit, key inválida, modelo inexistente).

---

## Cómo funciona, en 30 segundos

1. El proceso Node arranca, lee la variable `AI_PROVIDER` y configura el cliente de IA correspondiente. Como los tres proveedores exponen una API compatible con OpenAI, usamos un único cliente (`openai` SDK) con distinto `baseURL` y `apiKey`.
2. Se conecta a WhatsApp usando **Baileys** (librería que habla el protocolo de WhatsApp Web sin necesidad de un navegador).
3. La primera vez muestra un QR; el usuario lo escanea con su celular y la sesión queda guardada en `auth_session/`.
4. Cada mensaje entrante pasa por un pipeline: filtro de grupo → comando rápido → consulta a la IA → respuesta.

---

## Requisitos

- **Node.js 20+** (en Replit ya viene preconfigurado).
- **Cuenta en WhatsApp** activa en un celular.
- **API key** del proveedor que vayas a usar:
  - Gemini: https://aistudio.google.com/apikey (gratis, sin tarjeta)
  - Groq: https://console.groq.com (gratis, sin tarjeta)
  - OpenAI: https://platform.openai.com/api-keys (requiere saldo)

---

## Configuración (Secrets / variables de entorno)

| Variable          | Descripción                                                                                  | Default                  |
|-------------------|----------------------------------------------------------------------------------------------|--------------------------|
| `AI_PROVIDER`     | Qué proveedor usar: `gemini`, `groq` u `openai`.                                            | depende de la rama       |
| `GEMINI_API_KEY`  | API key de Google AI Studio. Requerida si `AI_PROVIDER=gemini`.                              | —                        |
| `GEMINI_MODEL`    | Modelo de Gemini.                                                                            | `gemini-1.5-flash`       |
| `GROQ_API_KEY`    | API key de Groq. Requerida si `AI_PROVIDER=groq`.                                            | —                        |
| `GROQ_MODEL`      | Modelo de Groq.                                                                              | `llama-3.3-70b-versatile`|
| `OPENAI_API_KEY`  | API key de OpenAI. Requerida si `AI_PROVIDER=openai`.                                        | —                        |
| `OPENAI_MODEL`    | Modelo de OpenAI.                                                                            | `gpt-4o-mini`            |
| `BOT_PERSONALITY` | Prompt de sistema que define cómo se comporta el bot.                                        | "Asistente amigable…"    |

**En Replit:** los valores se configuran en la pestaña **Secrets** (no en un archivo `.env`).

---

## Cómo correrlo en Replit

1. Asegurate de estar en la rama deseada (`main`, `groq` o `gemini`) o setteá `AI_PROVIDER` a mano.
2. Cargá el Secret correspondiente al proveedor elegido (ver tabla de arriba).
3. El workflow `WhatsApp Bot` arranca solo con `node index.js`.
4. Cuando aparezca un QR (consola y archivo `qr.png`), abrí WhatsApp en tu celular → **Configuración → Dispositivos vinculados → Vincular dispositivo** y escanealo.
5. Listo: vas a ver `✅ ¡Bot conectado y listo!`. Ahora cualquier mensaje que llegue al WhatsApp vinculado va a recibir respuesta del bot.

> Nota: la sesión se guarda en `auth_session/`. Esa carpeta **no se sube a Git** (está en `.gitignore`). Si la borrás o cambiás de rama, vas a tener que escanear el QR otra vez.

---

## Cómo correrlo localmente (fuera de Replit)

```bash
git clone https://github.com/gkambic/whatsapp-bot.git
cd whatsapp-bot
git checkout groq   # o gemini, o main
npm install
echo "AI_PROVIDER=groq" > .env
echo "GROQ_API_KEY=tu_key_aca" >> .env
npm start
```

---

## Comandos rápidos del bot

Estos comandos **no llaman a la IA** (responden con texto fijo, son instantáneos y gratis):

| Comando | Qué hace                                       |
|---------|------------------------------------------------|
| `menu`  | Muestra la lista de comandos disponibles.      |
| `info`  | Información sobre el bot.                      |
| `ayuda` | Cómo usarlo.                                   |
| `hola`  | Saludo automático.                             |
| `hora`  | Hora actual en formato AR.                     |
| `fecha` | Fecha de hoy en formato AR.                    |
| `reset` | Borra el historial de conversación con vos.    |

Cualquier otro texto se manda al modelo de IA configurado y responde con lo que ese modelo devuelva.

---

## Arquitectura y decisiones de diseño

Para entender por qué cada parte está escrita como está, mirá [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Limitaciones conocidas

- El bot **ignora mensajes de grupos** por diseño (para evitar spam y respuestas no deseadas).
- WhatsApp **rota el QR cada ~20 segundos**: si no llegás a escanearlo, se genera otro automáticamente.
- Después de vincular por primera vez, WhatsApp suele cerrar y reabrir la conexión una vez (código `515`); es normal y se reconecta solo.
- WhatsApp puede **bloquear el número** si detecta uso masivo o automatizado abusivo. Este bot es para uso personal/educativo.
- Si el proveedor reporta `429` (rate limit) muy seguido, probá cambiar de modelo (otra variante de Gemini o de Llama en Groq) o cambiar de proveedor con `AI_PROVIDER`.
