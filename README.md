# 🤖 WhatsApp Bot con IA

Bot de WhatsApp con inteligencia artificial (GPT) que entiende y responde preguntas.

## Requisitos previos

- **Node.js** versión 18 o superior → [Descargar](https://nodejs.org/)
- **Google Chrome** instalado (la librería lo usa internamente)
- **WhatsApp** en tu celular
- **API Key de OpenAI** → [Conseguir acá](https://platform.openai.com/api-keys)

## Instalación

1. Abrí una terminal en la carpeta del proyecto:

```bash
cd C:\Projects\whatsapp-bot
```

2. Instalá las dependencias:

```bash
npm install
```

3. Editá el archivo `.env` y poné tu API key de OpenAI:

```
OPENAI_API_KEY=sk-tu-api-key-real-aca
```

## Cómo usar

1. Iniciá el bot:

```bash
npm start
```

2. Va a aparecer un **código QR** en la terminal.

3. En tu celular, abrí WhatsApp → **Dispositivos vinculados** → **Vincular dispositivo** → escaneá el QR.

4. ¡Listo! El bot va a responder automáticamente a los mensajes que recibas.

5. Para detener el bot, presioná **Ctrl+C** en la terminal.

## Comandos disponibles

| Comando     | Respuesta                          |
|-------------|------------------------------------|
| `menu`      | Lista de comandos disponibles      |
| `info`      | Información sobre el bot           |
| `hora`      | Hora actual                        |
| `fecha`     | Fecha de hoy                       |
| `ayuda`     | Instrucciones de uso               |
| `reset`     | Borrar historial de la conversación|
| Cualquier otro texto | **Respuesta inteligente con IA** |

## Configuración del .env

| Variable          | Descripción                                  | Default       |
|-------------------|----------------------------------------------|---------------|
| `OPENAI_API_KEY`  | Tu API key de OpenAI (obligatorio)           | -             |
| `OPENAI_MODEL`    | Modelo a usar                                | `gpt-4o-mini` |
| `BOT_PERSONALITY` | Instrucciones de personalidad del bot        | Asistente amigable en español |

## Notas importantes

- El bot solo responde a **chats privados** (ignora grupos).
- La sesión se guarda localmente (carpeta `.wwebjs_auth`), así que no necesitás escanear el QR cada vez.
- Este proyecto es **solo para pruebas y aprendizaje**. No uses bots automatizados de forma masiva ya que WhatsApp puede bloquear tu número.

## Estructura del proyecto

```
whatsapp-bot/
├── index.js         ← Código principal del bot con IA
├── package.json     ← Dependencias del proyecto
├── .env             ← Configuración (API key, modelo, personalidad)
├── .npmrc           ← Config de npm (skip Chromium download)
├── .gitignore       ← Archivos ignorados por git
└── README.md        ← Este archivo
```

## Próximos pasos para aprender más

- Agregar respuestas a grupos
- Conectar con una API externa (clima, noticias, etc.)
- Enviar imágenes o archivos
- Usar una base de datos para guardar conversaciones
- Crear un menú interactivo con botones
