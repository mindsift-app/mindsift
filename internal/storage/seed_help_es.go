package storage

import "github.com/mindsift-app/mindsift/internal/domain"

// seedHelpNotesES: the help notes in Spanish, see seedHelpNotes. Same notes, blocks and links as the English
// ones (seed_en.go), without the parts that only fit the online demo (which has its help in English).
func (s *Store) seedHelpNotesES(user *domain.User, ed HelpEdition) {
	const folder = "Ayuda de MindSift"
	_, _ = s.CreateFolder(user.ID, folder)
	help := func(title, icon string, spec []seedBlock) {
		_, _ = s.CreateDocument(user.ID, "", title, icon, folder, seedBlocks(forEdition(spec, ed)), []string{"ayuda"}, false)
	}
	help("Primeros pasos", "", []seedBlock{
		{typ: "callout", text: "¡Bienvenido! Estas notas explican MindSift. Todo lo que hay aquí es contenido de ejemplo: puedes cambiarlo, moverlo y borrarlo sin problema. #ayuda"},
		{typ: "h2", text: "La idea en tres pasos"},
		{typ: "numbered", text: "**Capturar:** lo que se te ocurra, directo a la barra de arriba (Quick Dump): tecla `C` o `/`, en el móvil el +."},
		{typ: "numbered", text: "**Ordenar:** más tarde repasas tus pensamientos en el triage: descartar, tarea, nota o elemento de lista."},
		{typ: "numbered", text: "**Profundizar:** las tareas tienen subtareas y fechas de vencimiento, las notas se convierten en esquemas, las listas ayudan con la compra y el equipaje."},
		{typ: "h2", text: "Sigue leyendo"},
		{level: 1, text: "[[Notas y outliner]]: puntos, niveles, zoom y enlaces"},
		{level: 1, text: "[[Probar el zoom]]: un esquema de diez niveles"},
		{level: 1, text: "[[Tareas y Kanban]]: listas, columnas, papelera"},
		{level: 1, text: "[[Listas y compra]]: comprar y hacer la maleta"},
		{level: 1, text: "[[Atajos de teclado]]: trabaja más rápido"},
		{level: 1, text: "[[Entrada de voz]]: dicta en vez de escribir"},
		{level: 1, text: "[[Compartir y editar en común]]"},
		{level: 1, text: "[[API y domótica]]: conecta agentes de IA y scripts"},
	})
	help("Notas y outliner", "", []seedBlock{
		{typ: "h2", text: "Puntos y niveles"},
		{level: 1, text: "`Enter` crea un punto nuevo, `Tab` lo sangra, `Shift+Tab` reduce la sangría"},
		{level: 1, text: "Los puntos con subpuntos se pueden plegar y desplegar (flecha a la izquierda al pasar el ratón)"},
		{level: 1, text: "Arrastrar el punto (•) lo mueve y sus subpuntos se quedan; plegado, se mueve toda la rama"},
		{level: 1, text: "Hacer clic en el punto (•) **hace zoom** en la rama: pruébalo en [[Probar el zoom]]"},
		{typ: "h2", text: "Dar formato"},
		{level: 1, text: "Al principio de una línea: `- ` punto, `1. ` número, `[] ` casilla, `# ` encabezado"},
		{level: 1, text: "`/` abre el menú: /todo, /h1, /code, /callout, /warn, /fail, /image, /audio, /diktat, /extract …"},
		{level: 1, text: "**negrita** con `Ctrl+B`, *cursiva* con `Ctrl+I`, enlace con `Ctrl+K`"},
		{typ: "h2", text: "Enlazar"},
		{level: 1, text: "`[[Título de la nota]]` enlaza una nota, p. ej. [[Primeros pasos]]"},
		{level: 1, text: "También se pueden enlazar puntos sueltos: busca texto en la ventana de enlaces; los puntos encontrados aparecen debajo de las notas"},
		{level: 1, text: "Los `#hashtags` reúnen las menciones de todas las notas, p. ej. #ayuda"},
		{typ: "h2", text: "Seleccionar y borrar"},
		{level: 1, text: "Arrastrar el ratón por varios puntos selecciona texto más allá de los límites de cada punto; Supr lo borra como en un editor de texto"},
		{level: 1, text: "`Ctrl+Z` deshace cualquier cambio tuyo"},
		{typ: "callout", text: "Las notas eliminadas van a la papelera, abajo en la barra de carpetas. Cuánto tiempo permanecen allí se define en Ajustes de la cuenta → Retención."},
	})
	help("Probar el zoom", "🔍", []seedBlock{
		{typ: "callout", text: "Al hacer clic en un punto (•) solo se muestra esa rama. Arriba aparece la ruta; al hacer clic en ella vuelves atrás nivel a nivel."},
		{text: "Nivel 1: proyecto «Jardín nuevo»"},
		{level: 1, text: "Nivel 2: bancales"},
		{level: 2, text: "Nivel 3: bancal elevado junto a la valla"},
		{level: 3, text: "Nivel 4: plantación"},
		{level: 4, text: "Nivel 5: primavera"},
		{level: 5, text: "Nivel 6: lechuga y rabanitos"},
		{level: 6, text: "Nivel 7: variedades"},
		{level: 7, text: "Nivel 8: lechuga de hoja suelta «Lollo Rosso»"},
		{level: 8, text: "Nivel 9: siembra a partir de mediados de marzo"},
		{level: 9, text: "Nivel 10: volver a sembrar cada dos semanas: así hay lechuga todo el verano 🥗"},
		{level: 7, text: "Nivel 8: rabanito «Carámbano»"},
		{level: 5, text: "Nivel 6: hierbas aromáticas"},
		{level: 6, text: "Nivel 7: cebollino, perejil, albahaca"},
		{level: 4, text: "Nivel 5: verano"},
		{level: 5, text: "Nivel 6: tomates y calabacines"},
		{level: 2, text: "Nivel 3: espiral de hierbas"},
		{level: 1, text: "Nivel 2: césped"},
		{level: 2, typ: "todo", text: "Nivel 3: escarificar en abril"},
	})
	help("Tareas y Kanban", "✅", []seedBlock{
		{typ: "h2", text: "Vistas"},
		{level: 1, text: "**Lista** con las pestañas Pendientes, Completadas y Papelera; la agrupación y el orden están arriba a la derecha"},
		{level: 1, text: "**Kanban** con columnas propias por lista de tareas (personalizar columnas: nombre, color, columna de hecho)"},
		{level: 1, text: "«Todas las tareas» muestra las columnas de todas las listas juntas"},
		{typ: "h2", text: "Trabajar con tareas"},
		{level: 1, text: "Un clic abre los detalles: prioridad, fecha de vencimiento con hora, repetición, subtareas, notas (con micrófono)"},
		{level: 1, text: "Arrastrar reordena o cambia de columna; `Ctrl+Z` deshace borrar, mover y marcar como completada"},
		{level: 1, text: "Las tareas y las notas se pueden vincular"},
		{typ: "h2", text: "Ordenar"},
		{level: 1, text: "Las tareas completadas pasan a la papelera pasado un tiempo, y la papelera se vacía sola más adelante"},
		{level: 1, text: "Los plazos se ajustan en Ajustes de la cuenta → Retención"},
	})
	help("Listas y compra", "🛒", []seedBlock{
		{text: "Las categorías salen de los hashtags: `leche de avena #frescos` queda en «frescos»"},
		{text: "Las cantidades van en su propio campo, p. ej. `500 g` o `3x`"},
		{sharingOnly: true, text: "Las listas compartidas muestran lo marcado a todos al instante: ideales para la compra semanal"},
		{text: "Los elementos marcados desaparecen solos al cabo de una semana (se ajusta en Retención)"},
	})
	help("Atajos de teclado", "⌨️", []seedBlock{
		{typ: "h2", text: "En todas partes"},
		{level: 1, text: "`C` o `/`: Quick Dump"},
		{level: 1, text: "`Ctrl+K`: búsqueda global en notas, tareas y listas"},
		{typ: "h2", text: "Triage"},
		{level: 1, text: "`H` / `←` descartar, `L` / `→` tarea, `T` con fecha, `D` nota, espacio para más tarde"},
		{typ: "h2", text: "Notas"},
		{level: 1, text: "`Tab` / `Shift+Tab` sangrar y reducir sangría, `Ctrl+Z` / `Ctrl+Shift+Z` deshacer y rehacer"},
		{level: 1, text: "`Ctrl+Shift+F` modo de enfoque: solo la nota, con ancho de lectura"},
		{typ: "h2", text: "Tareas"},
		{level: 1, text: "`Ctrl+Z` deshace borrar, mover y marcar como completada"},
	})
	help("Entrada de voz", "🎙️", []seedBlock{
		{text: "Hay micrófonos en el Quick Dump, al crear tareas y elementos de lista, en las notas de una tarea y como `/diktat` en las notas"},
		{text: "En el móvil: mantener pulsado el + inicia una grabación al instante"},
		{text: "Con tu propio servidor Whisper la grabación se queda en tu servidor; en Ajustes de la cuenta → Entrada de voz eliges Whisper o el reconocimiento del navegador"},
	})
	// Where people share the full note; without sharing (desktop app, sharing mode private) a short one saying why it is missing
	if ed.Sharing {
		help("Compartir y editar en común", "🤝", []seedBlock{
			{text: "Las notas, carpetas, listas de tareas y listas se pueden compartir con personas o grupos, para editar o solo para leer"},
			{text: "En una nota compartida escriben varias personas a la vez; quien escribe en un punto lo reserva un momento"},
			{text: "Las tareas de las listas compartidas se pueden asignar a personas y seguir"},
		})
	} else {
		help("Compartir y editar en común", "🤝", []seedBlock{
			{text: "Compartir notas, carpetas, listas de tareas y listas con otras personas y editarlas en común requiere un servidor MindSift con varias cuentas y la función de compartir activada"},
			{desktopOnly: true, text: "Esta instancia local de la app de escritorio no lo ofrece, por eso aquí no hay botones para compartir. Para trabajar con otras personas necesitas un servidor MindSift al que la app de escritorio pueda conectarse"},
			{serverOnly: true, text: "En este servidor la administración ha desactivado la función de compartir (Administración → Instancia → Compartir, ajuste «Privado»), por eso aquí no hay botones para compartir. Consulta con la administración si quieres trabajar con otras personas"},
		})
	}
	help("API y domótica", "🔌", []seedBlock{
		{text: "En Ajustes de la cuenta → API creas claves con exactamente los permisos que necesita un dispositivo"},
		{desktopOnly: true, text: "En la app de escritorio la API existe de entrada solo para la propia app: en Ajustes de la cuenta → API activa «Accesible para programas locales» y los programas de este ordenador la alcanzan en 127.0.0.1 (el puerto aparece allí)"},
		{typ: "h3", text: "Consultar las tareas que vencen hoy"},
		{serverOnly: true, typ: "code", lang: "bash", text: "curl -H \"X-API-Key: mindsift_sec_…\" \\\n  \"https://mindsift.example.com/api/v1/tasks?due=today&status=open\""},
		{desktopOnly: true, typ: "code", lang: "bash", text: "curl -H \"X-API-Key: mindsift_sec_…\" \\\n  \"http://127.0.0.1:18890/api/v1/tasks?due=today&status=open\""},
		{typ: "h3", text: "Agentes de IA (MCP)"},
		{text: "Claude Code, Codex y otros agentes leen y gestionan tareas, listas y notas a través de `/api/v1/mcp`"},
		{text: "Todo lo que una clave crea o cambia lleva una pequeña insignia con su nombre"},
	})
}
