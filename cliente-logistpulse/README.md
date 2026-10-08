# Cliente LOGISTPULSE

Una clienta simulada (Marcela Paredes, jefa de operaciones) para practicar **elicitación de requisitos**.
Cada estudiante la entrevista **una sola vez, durante 6 minutos**, desde un navegador, **sin necesitar cuenta de Claude**.
Al terminar entrega los requisitos que descubrió (con su letra FURPS) y el docente ve quién entrevistó y qué puntaje obtuvo.

- **Servidor:** Node 22 + Express + SQLite integrado (`node:sqlite`). No hay módulos nativos que compilar.
- **IA:** APIs de OpenAI, Google Gemini o Anthropic Claude, solo desde el servidor. Las claves y el guion de necesidades ocultas nunca llegan al navegador.
- **Reglas en el servidor:** cronómetro, una entrevista por correo (restricción única en la base de datos), código de clase y dominio de correo.

## Puesta en marcha en 5 minutos

### Opción A: GitHub Codespaces (recomendada para clase)
1. Sube esta carpeta a un repositorio de GitHub (el archivo `.env` está en `.gitignore`).
2. **Code → Codespaces → Create codespace.** Se instala todo y se crea `.env` a partir de `.env.example`.
3. Edita `.env`: pon al menos una clave (`OPENAI_API_KEY`, `GEMINI_API_KEY` o `ANTHROPIC_API_KEY`), una `ADMIN_PASSWORD` y el `ACCESS_CODE` que dirás en clase.
4. Arranca con Docker Compose: `docker compose up --build -d`  (o sin Docker: `npm ci && npm start`).
5. Abre la pestaña **Ports**, clic derecho en el puerto **3000 → Port Visibility → Public**. Sin esto, los estudiantes tendrían que iniciar sesión en GitHub.
6. Copia la URL del puerto 3000 y compártela. El panel docente está en `/admin`.

> El Codespace se detiene por inactividad. Mantenlo abierto durante la clase. Los datos quedan en el volumen y sobreviven a reinicios.

### Opción B: cualquier servidor con Docker
```bash
cp .env.example .env      # completa los valores
docker compose up --build -d
```
Ponle HTTPS delante (Caddy, Nginx o el proveedor) si lo publicas en internet.

### Probar sin IA y sin clave
```bash
npm ci
npm run dev        # MOCK_LLM=1, contraseña de panel: admin123
```
La clienta responde por palabras clave. Sirve para ver la interfaz y ensayar el flujo, no para clase.

## Variables (`.env`)
| Variable | Para qué sirve |
|---|---|
| `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` | Configura la(s) clave(s) de los proveedores que quieras usar. Una es obligatoria salvo en modo simulado |
| `ADMIN_PASSWORD` | Contraseña del panel docente (mínimo 6 caracteres) |
| `ACCESS_CODE` | Código de clase. Vacío = no se pide |
| `ALLOWED_EMAIL_DOMAIN` | Por ejemplo `usfq.edu.ec`. Vacío = cualquier correo |
| `DURACION_SEG` | Duración de la entrevista (360 = 6 min) |
| `LLM_PROVIDER` | Proveedor inicial: `openai`, `gemini` o `anthropic` |
| `CLIENT_MODEL` / `EVAL_MODEL` | Modelos iniciales para entrevista y evaluación. Se pueden cambiar desde `/admin` |

En el panel `/admin`, selecciona proveedor y modelos y pulsa **Probar y activar**. El servidor hace una llamada real de prueba; si falla, la selección anterior sigue activa. Para habilitar otro proveedor, agrega su clave al `.env` y reinicia el servidor. La selección activa vive en memoria y vuelve a los valores del `.env` al reiniciar.

## Cómo se usa en clase
1. Comparte la URL y el código de clase.
2. Cada estudiante escribe correo, nombre, equipo y el código, y pulsa **Comenzar**. El reloj corre en el servidor: recargar la página retoma la misma entrevista sin reiniciar el tiempo.
3. Al terminar entrega sus requisitos. La entrega no se puede editar.
4. En `/admin`: **Evaluar pendientes** puntúa todo (sobre 16), **Mejor puntaje** ordena, **Exportar CSV** baja la tabla a Excel.
5. Si alguien cambió de dispositivo o hubo un problema técnico: **Reabrir** borra su entrevista y puede repetirla.

## Puntaje (16 puntos)
| Criterio | Puntos | Cómo |
|---|---|---|
| Cobertura | 0–4 | Necesidades descubiertas / 6 (tope 4). Calculado por el servidor |
| Calidad de preguntas | 0–4 | La IA: abiertas, escenarios, repreguntas |
| Requisitos entregados | 0–4 | La IA: medibles, FURPS correcto, coherentes con lo descubierto |
| Contradicción | 0 o 4 | 4 si pidió aclarar «todos son urgentes» frente a los tres niveles |

La nota de la IA es una **sugerencia**: revisa las transcripciones antes de publicarla.

## Cambiar el guion
Edita `server/guion.json` (persona, contexto, saludo, contradicción y las 10 necesidades con su "se revela cuando"). Reinicia el servidor. El campo `claves` solo lo usa el modo simulado.

## Qué se garantiza y qué no
- **Una entrevista por correo:** lo impone la base de datos. Quien cambie de correo podría repetir; el dominio institucional y el código de clase lo dificultan, y las transcripciones permiten detectarlo.
- **Retomar solo con el navegador original:** el token queda en el navegador. Si se pierde, el docente reabre.
- **No hay contraseñas de estudiantes:** el control es el correo + código de clase. Es un ejercicio de aula, no un examen con identidad verificada.
- **Costo:** cada entrevista son unas 6 a 15 llamadas cortas al modelo rápido más una evaluación con el modelo capaz. Revisa los precios vigentes en console.anthropic.com y fija un límite de gasto en tu cuenta.

## Pruebas
```bash
npm test     # 7 pruebas del servidor en modo simulado
```

## Estructura
```
server/   index.js (API), db.js, llm.js, prompts.js, guion.json
public/   index.html + student.js (estudiante), admin.html + admin.js (docente)
test/     smoke.test.js
Dockerfile · docker-compose.yml · .devcontainer/
```
