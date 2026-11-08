import React from 'react';
import {
  Layers,
  FileText,
  CheckSquare,
  Keyboard,
  Pin,
  Sparkles,
  Command,
  Users,
  Mic,
  ShoppingCart,
  Columns,
  Tag,
  Link as LinkIcon,
  Bell,
  Lock,
  Heading1,
  ListTodo,
  Code,
  Download,
  KeyRound,
  Shapes,
  CloudOff,
} from 'lucide-react';
import type { HelpContent } from './types';

const kbd = 'px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent';

// Spanish help: the same cards and shortcut table as the English and German ones
const es: HelpContent = {
  cards: [
    // WORKSPACE & OUTLINER
    {
      id: 'workspace-architecture',
      category: 'workspace',
      title: 'Outliner jerárquico y sincronización sin conexión',
      subtitle: 'Almacenamiento atómico con sincronización colaborativa en tiempo real',
      icon: FileText,
      keywords: [
        'workspace',
        'outliner',
        'base de datos',
        'sqlite',
        'offline',
        'indexeddb',
        'exportar',
        'markdown',
        'guardar',
        'sin conexion',
      ],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            En MindSift cada nota es un outliner jerárquico y estructurado. Tus notas se almacenan de forma segura y versionada en la{' '}
            <strong className="text-main">base de datos SQLite</strong> y se guardan en caché en el navegador mediante{' '}
            <strong className="text-main">IndexedDB</strong>.
          </p>
          <ul className="space-y-1 list-disc list-inside">
            <li>
              <strong className="text-main">Totalmente funcional sin conexión:</strong> puedes seguir trabajando sin conexión a internet;
              los cambios se sincronizan automáticamente en cuanto vuelvas a estar en línea.
            </li>
            <li>
              <strong className="text-main">Exportación a Markdown:</strong> mediante el icono de descarga (<Download className="w-3 h-3 inline text-accent" />) en la cabecera de la nota puedes exportar el estado actual como archivo Markdown estándar (<code className="font-mono text-accent">.md</code>) a tu equipo en cualquier momento.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-keyboard',
      category: 'workspace',
      title: 'Uso del teclado en el editor de notas',
      subtitle: 'Escribe y estructura con fluidez sin tocar el ratón',
      icon: Keyboard,
      keywords: [
        'teclado',
        'atajos',
        'enter',
        'tab',
        'shift',
        'retroceso',
        'outliner',
        'sangrar',
        'reducir sangria',
        'deshacer',
        'rehacer',
        'flechas',
      ],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <kbd className={kbd}>Enter</kbd> : crea inmediatamente un nuevo punto en el mismo nivel. Si el punto está vacío y sangrado, se desplaza un nivel a la izquierda.
            </li>
            <li>
              <kbd className={kbd}>Tab</kbd> : sangra el punto actual hacia la derecha y lo anida bajo el anterior.
            </li>
            <li>
              <kbd className={kbd}>Shift + Tab</kbd> : anula la sangría del punto hacia la izquierda (reduce el nivel de anidación).
            </li>
            <li>
              <kbd className={kbd}>Shift + Enter</kbd> : inserta un salto de línea suave dentro del mismo bloque de texto.
            </li>
            <li>
              <kbd className={kbd}>Backspace</kbd> : en un bloque vacío, lo elimina de inmediato. Al inicio del texto, fusiona el bloque con el anterior.
            </li>
            <li>
              <kbd className={kbd}>↑ / ↓</kbd> : salta al bloque anterior o siguiente cuando el cursor está al principio o final del texto.
            </li>
            <li>
              <kbd className={kbd}>Ctrl + Z</kbd> / <kbd className={kbd}>Cmd + Z</kbd> : deshacer de múltiples pasos para notas. Rehacer con <kbd className={kbd}>Ctrl + Y</kbd> o <kbd className={kbd}>Ctrl + Shift + Z</kbd>.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-slash-and-autoformat',
      category: 'workspace',
      title: 'Comandos de barra inclinada (/) y formato automático',
      subtitle: 'Cambia tipos de bloque y formatea Markdown mientras escribes',
      icon: Command,
      keywords: [
        'slash',
        'comandos',
        'todo',
        'enlace',
        'h1',
        'h2',
        'h3',
        'codigo',
        'callout',
        'warn',
        'fail',
        'separador',
        'imagen',
        'extraer',
        'fusionar',
        'audio',
        'nota de voz',
        'dictado',
        'foto',
        'formato automatico',
      ],
      content: (
        <div className="space-y-3 text-muted leading-relaxed">
          <div>
            <p className="mb-1.5">
              Escribe <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">/</code> en un bloque para abrir el menú de tipos de bloque:
            </p>
            <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px]">
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <ListTodo className="w-3.5 h-3.5 text-accent" />
                <span>/todo (tarea con casilla)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <LinkIcon className="w-3.5 h-3.5 text-accent" />
                <span>/link (enlazar una nota)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <Heading1 className="w-3.5 h-3.5 text-accent" />
                <span>/h1, /h2, /h3 (encabezados)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <Code className="w-3.5 h-3.5 text-accent" />
                <span>/code (bloque de código)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <KeyRound className="w-3.5 h-3.5 text-accent" />
                <span>/secret (ocultar un valor, p. ej. una IP o un token)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <span className="text-accent font-bold">💬</span>
                <span>/callout (cuadro destacado)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <span className="text-status-warn font-bold">⚠</span>
                <span>/warn, /fail (advertencia, error)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <span className="text-accent font-bold">—</span>
                <span>/divider (separador)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main col-span-2">
                <span className="text-accent font-bold">🖼️</span>
                <span>/image (subir, fotografiar, pegar o enlazar una imagen; solo en un punto vacío)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main col-span-2">
                <Shapes className="w-3.5 h-3.5 text-accent shrink-0" />
                <span>/canvas (dibujo con formas, flechas, texto y trazo libre)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main col-span-2">
                <span className="text-accent font-bold">📤</span>
                <span>/extract (mover el punto con todos sus subpuntos a una nota propia, dejando un [[enlace]]; el botón «Recuperar nota» en el enlace lo revierte)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main col-span-2">
                <span className="text-accent font-bold">🎙️</span>
                <span>/audio (grabar una nota de voz: el botón verde inicia, el rojo guarda; o subir un archivo de audio)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main col-span-2">
                <span className="text-accent font-bold">🗣️</span>
                <span>/diktat (hablar en lugar de escribir: empieza al instante, pulsar «Detener» inserta el texto en el punto)</span>
              </div>
            </div>
          </div>
          <div className="pt-2 border-t border-border">
            <span className="font-semibold text-main block mb-1">Formato instantáneo al escribir:</span>
            <ul className="space-y-1 text-xs">
              <li><code className="text-accent font-mono">[] </code> o <code className="text-accent font-mono">[ ] </code> al inicio de una línea lo convierte en casilla de verificación al instante.</li>
              <li><code className="text-accent font-mono">[x] </code> lo convierte en casilla de verificación marcada.</li>
              <li><code className="text-accent font-mono"># </code>, <code className="text-accent font-mono">## </code> o <code className="text-accent font-mono">### </code> al inicio de una línea da formato de encabezado al bloque de inmediato.</li>
            </ul>
          </div>
        </div>
      ),
    },
    // WORKSPACE: DRAWINGS
    {
      id: 'workspace-drawings',
      category: 'workspace',
      title: 'Dibujos (/canvas)',
      subtitle: 'Bocetos, diagramas de flujo y mapas mentales directamente en la nota',
      icon: Shapes,
      keywords: ['dibujo', 'canvas', 'boceto', 'diagrama', 'diagrama de flujo', 'mapa mental', 'flecha', 'formas', 'trazo libre', 'cuadrícula', 'mermaid'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Crear uno:</strong> Escribe <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">/canvas</kbd> (o <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">/draw</kbd>, <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">/sketch</kbd>) en un punto vacío; el editor se abre a pantalla completa. Esc o «Listo» guarda y cierra.
            </li>
            <li>
              <strong className="text-main">Herramientas:</strong> Seleccionar <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">V</kbd>, desplazar <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">H</kbd> (o mantener la barra espaciadora), rectángulo <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">R</kbd>, elipse <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">O</kbd>, rombo <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">D</kbd>, flecha <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">A</kbd>, trazo libre <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">P</kbd>, texto <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">T</kbd>, borrador <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">E</kbd>. Con Mayús, rectángulos y elipses se vuelven cuadrados y círculos; <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">G</kbd> activa y desactiva la cuadrícula con ajuste. Color de línea, relleno, grosor y discontinuo se ajustan en la forma seleccionada.
            </li>
            <li>
              <strong className="text-main">Texto y flechas:</strong> Doble clic (o Intro) en una forma para escribir dentro, doble clic en una flecha para ponerle una etiqueta como «sí» o «no». Las flechas se acoplan a las formas y las siguen al moverlas; pueden ser rectas, curvas o en ángulo.
            </li>
            <li>
              <strong className="text-main">Editar:</strong> <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Ctrl + Z</kbd> / <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Ctrl + Y</kbd> deshacen y rehacen, <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Ctrl + D</kbd> duplica, <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Ctrl + C</kbd> / <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Ctrl + V</kbd> copian y pegan, <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Supr</kbd> borra, las flechas del teclado mueven la selección.
            </li>
            <li>
              <strong className="text-main">En la nota:</strong> El dibujo ocupa el ancho de la nota. Haz clic dentro; luego arrastrar mueve la vista y la rueda del ratón o dos dedos hacen zoom. Arrastra el borde inferior para cambiar la altura. «Guardar vista» fija sección, zoom y altura para todos, «Automático» vuelve a encajarlo todo. Doble clic o «Editar» abre el editor.
            </li>
            <li>
              <strong className="text-main">En equipo y sin conexión:</strong> En notas compartidas, un dibujo queda bloqueado para los demás mientras alguien dibuja en él. Lo dibujado sin conexión se guarda en cuanto vuelve la conexión; un borrador sin guardar se ofrece para restaurar la próxima vez que abras el dibujo.
            </li>
            <li>
              <strong className="text-main">En todas partes:</strong> La búsqueda encuentra las palabras de los dibujos, copiar y pegar conserva el dibujo y la exportación Markdown lo incluye como imagen SVG (al importarlo vuelve a ser un dibujo). Los agentes de IA (MCP) leen una descripción del dibujo y pueden crear dibujos a partir de diagramas de flujo y mapas mentales de Mermaid.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-wikilinks-tags',
      category: 'workspace',
      title: 'WikiLinks ([[...]]), hashtags (#) y páginas de etiquetas',
      subtitle: 'Conecta el conocimiento bidireccionalmente y filtra por temas',
      icon: Tag,
      keywords: ['wikilinks', 'enlaces', 'vincular', 'hashtags', 'etiquetas', 'filtrar', 'palabras clave'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>En MindSift, las notas y pensamientos pueden conectarse entre sí de múltiples formas:</p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">WikiLinks:</strong> escribe <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">[[Nombre de la nota]]</code> para enlazar directamente a otra nota. Al hacer clic se abre la nota de destino de inmediato.
            </li>
            <li>
              <strong className="text-main">Hashtags:</strong> escribe <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">#proyecto</code> o <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">#importante</code> en cualquier lugar del texto. Los hashtags se resaltan en color y se indexan.
            </li>
            <li>
              <strong className="text-main">Vista «Etiquetas y filtros»:</strong> el resumen de etiquetas está en las pestañas del Workspace, arriba. Muestra todos los hashtags en uso, permite buscar sus apariciones en todos los documentos e incluso añadir notas libres en las páginas de etiquetas.
            </li>
            <li>
              <strong className="text-main">Enlaces entrantes (backlinks):</strong> al final de cada nota, «Vinculado a esta nota» muestra qué otras notas la enlazan mediante <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">[[título]]</code>. Al hacer clic en un lugar, se salta directamente allí.
            </li>
            <li>
              <strong className="text-main">Papelera:</strong> las notas eliminadas (también las de carpetas eliminadas) van a la «Papelera» en la parte inferior de la barra de carpetas o en el menú móvil. Allí puedes verlas en modo de solo lectura, restaurarlas o eliminarlas definitivamente. Mientras una nota está en la papelera, las personas con las que se compartió tampoco la ven. Tras el periodo establecido en Ajustes de la cuenta → Retención (por defecto 30 días) se elimina de forma permanente. Las tareas eliminadas se encuentran en la pestaña «Papelera» de tareas, y los pensamientos descartados en la papelera de triage.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-zoom-drag',
      category: 'workspace',
      title: 'Enfoque (zoom hoisting), arrastrar y soltar, y favoritos',
      subtitle: 'Mantén la concentración y organiza notas libremente',
      icon: Pin,
      keywords: ['otra nota', 'extraer', 'hoisting', 'zoom', 'arrastrar', 'soltar', 'carpetas', 'mover', 'fijar', 'migas de pan'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Enfoque (zoom hoisting):</strong> haz clic directamente en el punto (<code className="text-accent">•</code>) de un bloque para hacer zoom únicamente en esa rama. La navegación de migas de pan en la parte superior te permite retroceder paso a paso en cualquier momento.
            </li>
            <li>
              <strong className="text-main">Mover bloques:</strong> mantén pulsado el botón del ratón sobre un punto para arrastrarlo con todos sus subpuntos a una nueva ubicación.
            </li>
            <li>
              <strong className="text-main">A otra nota:</strong> arrastra el punto sobre una nota de la barra lateral y toda la rama pasa al final de esa nota. Si lo sueltas sobre el botón + de nota nueva, arriba en la barra lateral, se convierte en una nota nueva propia. El aviso posterior ofrece «Abrir» y «Deshacer», Ctrl+Z también funciona; las tareas vinculadas van con ella.
            </li>
            <li>
              <strong className="text-main">Extraer:</strong> el botón «Convertir en nota propia» a la derecha del punto pregunta el destino: Intro crea una nota nueva, escribiendo buscas una existente. En el lugar anterior queda un enlace al punto movido.
            </li>
            <li>
              <strong className="text-main">Navegación por carpetas:</strong> las notas del explorador de la izquierda se pueden organizar en subcarpetas arrastrando y soltando.
            </li>
            <li>
              <strong className="text-main">Favoritos fijados:</strong> el icono de chincheta mantiene las notas importantes siempre arriba del todo en el explorador.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-collab-locks',
      category: 'workspace',
      title: 'Colaboración en tiempo real, bloqueos y conflictos',
      subtitle: 'Trabajad juntos sin sobrescribir contenido por accidente',
      icon: Lock,
      keywords: ['colaboracion', 'bloqueos', 'candado', 'conflictos', 'en vivo', 'presencia', 'compartir'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>MindSift permite trabajar en documentos de forma colaborativa con protección integrada frente a la pérdida de datos:</p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Bloqueos de bloques:</strong> mientras alguien edita un punto, se muestra un icono de candado y el nombre del usuario. Los demás no pueden sobrescribir ese punto en ese momento.
            </li>
            <li>
              <strong className="text-main">Copias de conflicto:</strong> si se producen cambios al mismo tiempo o sin conexión, el servidor nunca sobrescribe silenciosamente tus cambios. En su lugar, aparece un bloque de conflicto resaltado en amarillo con dos botones: <em>«Usar»</em> o <em>«Descartar»</em>.
            </li>
            <li>
              <strong className="text-main">Indicador de conexión:</strong> junto al título de la nota verás siempre el modo de conexión (p. ej. <em>En vivo</em>, <em>long polling</em> o <em>Sin conexión</em>).
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-global-todos',
      category: 'workspace',
      title: 'Resumen global de tareas y enlaces a tareas',
      subtitle: 'Todas las tareas pendientes de todas las notas en un solo lugar',
      icon: CheckSquare,
      keywords: ['rollup', 'tareas', 'casillas', 'tarea ampliada', 'global', 'pendientes'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            La pestaña del Workspace <strong className="text-main">«Tareas»</strong> recopila automáticamente todas las casillas sin marcar (<code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">- [ ]</code>) de todas tus notas.
          </p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Sincronización bidireccional:</strong> tacha una tarea en la lista global y el bloque en la nota de origen se actualizará en tiempo real.
            </li>
            <li>
              <strong className="text-main">Tareas vinculadas (tareas ampliadas):</strong> las casillas de verificación seleccionadas en las notas también se pueden gestionar como tareas completas en el área de tareas y Kanban.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-search-cmdk',
      category: 'workspace',
      title: 'Búsqueda global y paleta de comandos (Cmd+K)',
      subtitle: 'Búsqueda de texto completo FTS5 en notas, bloques, tareas y listas',
      icon: Command,
      keywords: ['busqueda', 'comando', 'paleta', 'cmdk', 'buscar', 'fts', 'texto completo', 'teclado'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            Pulsa <kbd className={kbd}>Cmd + K</kbd> / <kbd className={kbd}>Ctrl + K</kbd> o <kbd className={kbd}>/</kbd> (cuando ningún campo de texto esté activo) para abrir la búsqueda global:
          </p>
          <ul className="space-y-1.5 list-disc list-inside">
            <li>
              <strong className="text-main">Búsqueda de texto completo (FTS5):</strong> busca en títulos de notas, bloques, tareas y elementos de lista al instante, con clasificación por relevancia (BM25) y búsqueda por prefijo.
            </li>
            <li>
              <strong className="text-main">Seguridad:</strong> solo muestra contenido al que realmente tienes acceso (tanto tus notas, listas de tareas y listas propias como las compartidas).
            </li>
            <li>
              <strong className="text-main">Navegación con teclado:</strong> navega con <kbd className={kbd}>↑</kbd> y <kbd className={kbd}>↓</kbd>, abre un resultado con <kbd className={kbd}>Enter</kbd> (las notas se abren justo en el bloque encontrado).
            </li>
          </ul>
        </div>
      ),
    },

    // TRIAGE & QUICK DUMP
    {
      id: 'triage-capture',
      category: 'triage',
      title: 'Barra de captura rápida',
      subtitle: 'Apunta pensamientos en menos de un segundo: por teclado o voz',
      icon: Layers,
      keywords: ['captura', 'captura rapida', 'dictado', 'voz', 'microfono', 'inbox', 'c'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>La barra de captura rápida en la parte superior garantiza que ningún pensamiento fugaz se pierda:</p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Foco instantáneo:</strong> pulsa <kbd className={kbd}>C</kbd> o <kbd className={kbd}>/</kbd> en cualquier parte de la aplicación (salvo si ya estás escribiendo en un campo de texto).
            </li>
            <li>
              <strong className="text-main">Dictado por voz:</strong> haz clic en el icono de micrófono (<Mic className="w-3.5 h-3.5 inline text-accent" />) para entrada continua de voz. Los pensamientos dictados reciben automáticamente la etiqueta <code className="text-accent font-mono">#diktat</code>. En el móvil también puedes mantener pulsado el botón redondo <strong className="text-main">+</strong> en la barra inferior para hablar al instante: al soltar, el texto va al inbox (arrastrar hacia arriba cancela).
            </li>
            <li>
              <strong className="text-main">Elegir destino:</strong> los pensamientos van al inbox por defecto. Con las opciones puedes enviarlos directamente como <strong className="text-main">tarea</strong> (con prioridad y fecha de vencimiento), <strong className="text-main">elemento de lista</strong> (p. ej. en la lista de la compra) o <strong className="text-main">nueva nota</strong>.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'triage-deck-decisions',
      category: 'triage',
      title: 'Pila de triage: decide con una sola tecla o deslizamiento',
      subtitle: 'Procesa la bandeja de entrada en tiempo récord y mantén la mente despejada',
      icon: Sparkles,
      keywords: ['triage', 'pila', 'h', 'l', 't', 'd', 'espacio', 'deslizar', 'papelera', 'gestos'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>La pila de triage presenta cada pensamiento recopilado tarjeta por tarjeta. Decides en un instante:</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
            <div className="p-2.5 bg-panel border border-border rounded">
              <span className="font-semibold text-main block mb-1">Teclado (escritorio):</span>
              <ul className="space-y-1 font-mono text-[11px]">
                <li><strong className="text-status-err">H</strong> o <strong>←</strong> : descartar (a la papelera)</li>
                <li><strong className="text-accent">L</strong> o <strong>→</strong> : crear como tarea</li>
                <li><strong className="text-main">T</strong> : con fecha de vencimiento</li>
                <li><strong className="text-main">D</strong> : convertir en documento de nota en el Workspace</li>
                <li><strong className="text-muted">Espacio</strong> : más tarde (al final de la pila)</li>
              </ul>
            </div>
            <div className="p-2.5 bg-panel border border-border rounded">
              <span className="font-semibold text-main block mb-1">Gestos de deslizamiento (táctil y móvil):</span>
              <ul className="space-y-1 text-xs">
                <li><strong className="text-status-err">Deslizar a la izquierda:</strong> descartar</li>
                <li><strong className="text-accent">Deslizar a la derecha:</strong> asumir como tarea</li>
                <li><strong className="text-main">Mantener pulsado:</strong> abrir el menú (fecha, lista, nota)</li>
              </ul>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'triage-webhooks',
      category: 'triage',
      title: 'API: curl, domótica y agentes de IA (MCP)',
      subtitle: 'Consulta y modifica tareas y listas mediante curl o Home Assistant, envía pensamientos y conecta agentes de IA como Claude Code.',
      icon: Bell,
      keywords: [
        'webhooks',
        'api',
        'token',
        'home assistant',
        'siri',
        'atajos',
        'automatizacion',
        'curl',
        'mcp',
        'ia',
        'agente',
        'claude',
        'codex',
      ],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            MindSift cuenta con una API. En <em className="text-main">Ajustes de la cuenta → API</em> puedes crear claves personales e indicar mediante interruptores qué acciones puede realizar cada una: leer, crear o modificar tareas, listas, notas y la bandeja de entrada. Estos permisos se aplican por igual a ambos tipos de acceso; las notas y la lectura/clasificación de la bandeja de entrada solo están disponibles mediante MCP. Una clave nunca tiene acceso a los ajustes.
          </p>
          <p>
            <strong className="text-main">curl y domótica:</strong> con acceso de lectura, <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">GET /api/v1/tasks?due=today&amp;status=open</code> devuelve todo lo que vence hoy, p. ej. para un sensor de Home Assistant. Más filtros: <code className="font-mono">due=overdue</code>, una fecha, <code className="font-mono">taskListId</code>. Las listas se obtienen mediante <code className="font-mono">GET /api/v1/lists</code>. Con acceso de modificación puedes tachar elementos mediante <code className="font-mono">PATCH /api/v1/thoughts/ID</code>. Los ajustes muestran ejemplos listos para usar.
          </p>
          <p>
            <strong className="text-main">Envío:</strong> <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">POST /api/v1/webhooks/ingest</code> acepta pensamientos desde Atajos de iOS, Home Assistant o n8n. El campo <code className="font-mono">"target"</code> selecciona el destino: <code className="font-mono">triage</code> (por defecto), <code className="font-mono">task</code> (opcionalmente con <code className="font-mono">taskListId</code>) o <code className="font-mono">list_item</code> (con <code className="font-mono">listId</code>).
          </p>
          <p>
            <strong className="text-main">Agentes de IA:</strong> mediante MCP (<code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">POST /api/v1/mcp</code>), Claude Code, OpenAI Codex, Claude Desktop, Cursor y tus propios agentes pueden leer, crear, modificar, tachar y eliminar tareas, listas y notas, así como clasificar la bandeja de entrada. Los ajustes muestran el comando preparado para cada agente; un agente solo ve las herramientas permitidas por la clave.
          </p>
          <p>
            <strong className="text-main">Origen:</strong> cualquier elemento creado o modificado por una clave lleva un distintivo permanente con su nombre, precedido por un icono de webhook (API) o un robot (MCP). Al pasar el cursor o pulsar sobre él se muestra quién lo creó, quién lo modificó por última vez y cuándo.
          </p>
        </div>
      ),
    },

    // TASKS & KANBAN
    {
      id: 'tasks-kanban',
      category: 'tasks',
      title: 'Vista de lista y tablero Kanban flexible',
      subtitle: 'Visualiza tareas y gestiónalas con columnas personalizadas',
      icon: Columns,
      keywords: ['tareas', 'kanban', 'tablero', 'columnas', 'arrastrar', 'soltar', 'listas'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            Las tareas se pueden gestionar en una <strong className="text-main">vista de lista</strong> clásica o en el interactivo{' '}
            <strong className="text-main">tablero Kanban</strong>:
          </p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Cambiar de vista:</strong> usa el conmutador arriba a la derecha entre lista y Kanban.
            </li>
            <li>
              <strong className="text-main">Columnas Kanban personalizadas:</strong> en la configuración de columnas puedes definir etapas individuales para cada lista de tareas (p. ej. <em>Backlog</em>, <em>En progreso</em>, <em>Revisión</em>, <em>Hecho</em>), incluidos colores y estado de finalización.
            </li>
            <li>
              <strong className="text-main">Arrastrar y soltar:</strong> mueve fácilmente tarjetas de tareas entre columnas. Mover una tarjeta a una columna de tareas completadas la marca automáticamente como hecha.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'tasks-details-alarms',
      category: 'tasks',
      title: 'Subtareas, fechas de vencimiento y avisos automáticos',
      subtitle: 'Listas de verificación con barra de progreso, notas en Markdown y notificaciones',
      icon: CheckSquare,
      keywords: [
        'subtareas',
        'avisos',
        'notificaciones',
        'correo',
        'discord',
        'fecha',
        'vencimiento',
        'prioridad',
        'asignar',
        'asignado',
      ],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Subtareas:</strong> crea una lista de comprobación dentro de cualquier tarea con barra de progreso visible (p. ej. «3 de 5 hechas»). El tirador a la izquierda permite reordenar las subtareas con el ratón o el dedo; las teclas de flecha lo hacen con el teclado.
            </li>
            <li>
              <strong className="text-main">Nueva tarea en una columna Kanban:</strong> «Añadir tarea» en la parte inferior de la columna abre la ventana de la tarea de inmediato con la columna y la lista preseleccionadas; solo tienes que escribir el título. Si cierras la ventana sin título, la tarea vacía desaparece.
            </li>
            <li>
              <strong className="text-main">Prioridades y notas:</strong> asigna prioridades (<em className="text-accent">Urgente</em>, <em className="text-main">Importante</em>, <em>Normal</em>) y añade notas detalladas en Markdown.
            </li>
            <li>
              <strong className="text-main">Asignaciones:</strong> en listas de tareas compartidas puedes asignar una tarea a una o varias personas con acceso (escribe un nombre, Enter). Las personas asignadas aparecen como fotos de perfil pequeñas en la tarea; quien pierda acceso a la lista se desasigna automáticamente.
            </li>
            <li>
              <strong className="text-main">Tareas periódicas:</strong> elige una repetición en la ventana de detalle (de diaria a anual). Al completarla se crea automáticamente la siguiente tarea con la fecha actualizada; la reconocerás por el icono 🔁.
            </li>
            <li>
              <strong className="text-main">Fecha de vencimiento con hora:</strong> en la ventana de detalle puedes indicar una hora junto a la fecha; «✕ Hora» vuelve a hacer la tarea para todo el día. Muestra p. ej. «Hoy, 14:30», y los elementos vencidos en rojo.
            </li>
            <li>
              <strong className="text-main">Avisos automáticos:</strong> a la hora de vencimiento (tareas de todo el día a las 9:00, menos tu tiempo de antelación), MindSift te notifica por <strong className="text-main">correo electrónico</strong>, <strong className="text-main">webhook de Discord</strong> o tu propio webhook HTTP. Si pospones la fecha o reabres la tarea, el aviso vuelve a programarse. Configurable en los ajustes de tu cuenta.
            </li>
          </ul>
        </div>
      ),
    },

    // LISTS & SHOPPING
    {
      id: 'lists-shared-shopping',
      category: 'lists',
      title: 'Listas compartidas, cantidades y categorías por hashtag',
      subtitle: 'Listas de la compra, equipaje y verificación en tiempo real',
      icon: ShoppingCart,
      keywords: ['listas', 'compra', 'supermercado', 'verificacion', 'cantidades', 'categorias', 'hashtag', 'tiempo real'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>Las listas compartidas son ideales para compras, equipaje y recados en común:</p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Cantidades automáticas:</strong> entradas como <code className="text-accent font-mono">2x leche bio</code> o <code className="text-accent font-mono">500g pasta</code> separan la cantidad y el nombre automáticamente.
            </li>
            <li>
              <strong className="text-main">Categorías por hashtag:</strong> añade un hashtag como <code className="text-accent font-mono">#nevera</code> o <code className="text-accent font-mono">#verduras</code>. La lista agrupa automáticamente los elementos en secciones correspondientes.
            </li>
            <li>
              <strong className="text-main">Sincronización en vivo y borrado de completados:</strong> los elementos marcados se sincronizan en tiempo real y muestran quién los tachó. El botón de borrado elimina los elementos completados todos a la vez.
            </li>
          </ul>
        </div>
      ),
    },

    // APPEARANCE: CUSTOM THEMES
    {
      id: 'workspace-custom-themes',
      category: 'account',
      title: 'Apariencia y temas personalizados',
      subtitle: 'Elige un diseño listo para usar o sube tu propio tema CSS',
      icon: Sparkles,
      keywords: ['tema', 'diseno', 'colores', 'css', 'oscuro', 'claro', 'apariencia'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Cambiar de tema:</strong> en el menú de perfil arriba a la derecha o en <em>Ajustes de la cuenta → Apariencia y temas</em>.
            </li>
            <li>
              <strong className="text-main">Tema personalizado:</strong> descarga o pega la plantilla, ajusta colores y esquinas, súbela o pégala como archivo <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">.css</code> y selecciona «Guardar y activar». El tema se aplica de inmediato y estará disponible en todos tus dispositivos.
            </li>
          </ul>
        </div>
      ),
    },

    // ACCOUNT: OFFLINE, BACKUPS & PASSWORD
    {
      id: 'account-offline-backups',
      category: 'account',
      title: 'Sin conexión, copias de seguridad y contraseña',
      subtitle: 'Seguir trabajando sin internet, restaurar copias, restablecer la contraseña',
      icon: CloudOff,
      keywords: ['sin conexión', 'offline', 'internet', 'copia de seguridad', 'restaurar', 'contraseña', 'olvidada', 'cuenta'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Copias de seguridad del servidor:</strong> si la administración ha activado las copias automáticas, encontrarás las copias diarias de tus datos en <em>Ajustes de la cuenta → Exportar e importar</em>. Puedes descargarlas o restaurarlas, incluso para áreas individuales como listas o tareas.
            </li>
            <li>
              <strong className="text-main">Sin internet:</strong> instalada como app (o en el navegador), MindSift también arranca sin conexión con el último estado cargado. Puedes seguir capturando pensamientos y tachando tareas y elementos de listas; un aviso abajo indica cuántos cambios están pendientes, y se enviarán automáticamente en cuanto vuelva la conexión.
            </li>
            <li>
              <strong className="text-main">Dónde quedan los cambios sin conexión:</strong> Las notas que ya has abierto en este dispositivo se pueden leer y editar sin conexión. Lo que aún no se ha enviado solo está guardado en este navegador: sobrevive a cerrar, reiniciar y apagar, y se envía automáticamente la próxima vez que MindSift arranque con conexión. Se pierde si cierras sesión (MindSift pregunta antes), borras los datos del navegador o trabajas en una ventana privada. Por eso, después de trabajar sin conexión, vuelve a conectarte pronto con el mismo dispositivo. Si alguien cambió el mismo punto mientras tanto, no se pierde nada: tu versión aparece debajo como copia de conflicto.
            </li>
            <li>
              <strong className="text-main">Contraseña olvidada:</strong> si la administración ha configurado el envío de correo, la pantalla de inicio de sesión mostrará «¿Has olvidado tu contraseña?». Recibirás un enlace válido durante una hora; al establecer la nueva contraseña se cerrará la sesión en todos tus dispositivos.
            </li>
          </ul>
        </div>
      ),
    },

    // COLLABORATION: ORGANIZATIONS, GROUPS & SHARING
    {
      id: 'collab-teams-sharing',
      category: 'collaboration',
      title: 'Organizaciones, grupos y opciones de compartir',
      subtitle: 'Quién puede compartir con quién, y cómo compartir notas, carpetas y listas de forma segura',
      icon: Users,
      keywords: [
        'equipos',
        'grupos',
        'organizacion',
        'visibilidad',
        'privado',
        'compartir',
        'permisos',
        'editor',
        'lector',
        'carpetas',
        'público',
        'enlace',
      ],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Quién puede compartir con quién:</strong> lo decide la administración del servidor: con todos, solo con personas con las que tienes al menos una <em>organización</em> en común, o con nadie (modo «Privado»: sin compartir ni grupos). Puedes pertenecer a varias organizaciones; las gestionan la administración y la gestión de usuarios. Si la búsqueda de personas está desactivada, al compartir introduces la dirección de correo o el nombre de usuario exactos. Quien trabaja contigo en algo aparece siempre allí con su nombre.
            </li>
            <li>
              <strong className="text-main">Grupos:</strong> agrupa a personas que puedes ver (p. ej. familia, compañeros de piso, un proyecto) y comparte contenido con todos ellos a la vez. Quien crea un grupo es su administrador; solo los miembros pueden compartir con el grupo.
            </li>
            <li>
              <strong className="text-main">Solo el propietario comparte:</strong> los editores pueden modificar contenido, pero no volver a compartirlo. Puedes abandonar un recurso compartido en cualquier momento. Si alguien deja una organización o un grupo, los elementos compartidos que solo estaban permitidos por ellos finalizan automáticamente.
            </li>
            <li>
              <strong className="text-main">Enlace público:</strong> en el diálogo de compartir puedes compartir una nota propia de solo lectura mediante enlace, también con personas sin cuenta y, opcionalmente, con contraseña. El enlace siempre caduca (de 1 hora a 14 días), se puede retirar en cualquier momento y no aparece en buscadores. Las visitas ven los cambios en vivo, pero ni valores ocultos ni nombres. Si está disponible lo decide la administración del servidor.
            </li>
            <li>
              <strong className="text-main">Roles (editor vs. lector):</strong> al compartir notas, carpetas o listas puedes elegir entre <em>Editor</em> (acceso completo a contenidos y listas de tareas) y <em>Solo lectura</em> (solo ver, con actualizaciones en vivo).
            </li>
            <li>
              <strong className="text-main">Estructura de carpetas propia:</strong> cada persona receptora puede organizar los documentos y carpetas compartidos en su propia estructura de carpetas sin alterar la organización del propietario.
            </li>
          </ul>
        </div>
      ),
    },
  ],
  shortcuts: [
    { key: 'Cmd + K / Ctrl + K o /', scope: 'Global', desc: 'Abrir la búsqueda global de texto completo (paleta de comandos)' },
    { key: 'C', scope: 'Global', desc: 'Poner el foco en la barra de captura rápida de inmediato' },
    { key: 'Enter', scope: 'Captura rápida', desc: 'Guardar el pensamiento en un instante' },
    { key: 'Esc', scope: 'Captura rápida', desc: 'Borrar la entrada y cerrar las opciones' },
    { key: 'Enter', scope: 'Outliner del Workspace', desc: 'Crear un nuevo punto (o anular sangría de un bloque vacío)' },
    { key: 'Tab', scope: 'Outliner del Workspace', desc: 'Sangrar el punto hacia la derecha (anidar)' },
    { key: 'Shift + Tab', scope: 'Outliner del Workspace', desc: 'Anular la sangría del punto hacia la izquierda' },
    { key: 'Shift + Enter', scope: 'Outliner del Workspace', desc: 'Salto de línea suave dentro del bloque' },
    { key: 'Backspace', scope: 'Outliner del Workspace', desc: 'En un bloque vacío: eliminar el bloque; al inicio: fusionar' },
    { key: '↑ / ↓', scope: 'Outliner del Workspace', desc: 'Ir al bloque anterior / siguiente' },
    { key: 'Ctrl + L / Cmd + L', scope: 'Outliner del Workspace', desc: 'Insertar un enlace (nota, viñeta o enlace web); el texto seleccionado pasa a ser el texto del enlace' },
    { key: 'Ctrl + Mayús + ↓', scope: 'Outliner del Workspace', desc: 'Desplegar todas las viñetas plegadas de la nota' },
    { key: 'Ctrl + Mayús + ↑', scope: 'Outliner del Workspace', desc: 'Plegar todas las viñetas de la nota (en el modo de enfoque, solo en la rama)' },
    { key: 'Ctrl + Z / Cmd + Z', scope: 'Outliner del Workspace', desc: 'Deshacer la última acción en notas' },
    { key: 'Ctrl + Y / Ctrl + Shift + Z', scope: 'Outliner del Workspace', desc: 'Rehacer una acción deshecha' },
    { key: 'Arrastrar el ratón sobre varios puntos', scope: 'Outliner del Workspace', desc: 'Seleccionar texto a través de varios puntos; Supr/Retroceso lo elimina, escribir lo reemplaza, Ctrl + C lo copia como Markdown (sangrías, tareas, encabezados)' },
    { key: 'Ctrl + A dos veces', scope: 'Outliner del Workspace', desc: 'La primera vez selecciona el punto, la segunda la nota entera; Ctrl + C lo copia como Markdown, pegar recrea los mismos puntos' },
    { key: 'Ctrl + Z / Cmd + Z', scope: 'Tareas', desc: 'Deshacer eliminación, movimiento o marcado de completada' },
    { key: '/', scope: 'Outliner del Workspace', desc: 'Abrir el menú de barra inclinada (/todo, /link, /h1, /code, ...)' },
    { key: '[] o [ ] al inicio', scope: 'Outliner del Workspace', desc: 'Convertir en casilla de tarea de inmediato' },
    { key: '[x] al inicio', scope: 'Outliner del Workspace', desc: 'Convertir en casilla de tarea completada de inmediato' },
    { key: '#, ##, ### al inicio', scope: 'Outliner del Workspace', desc: 'Convertir en encabezado H1, H2 o H3 de inmediato' },
    { key: '[[Título de la nota]]', scope: 'Outliner del Workspace', desc: 'Incrustar un WikiLink interactivo a una nota' },
    { key: '#etiqueta', scope: 'Workspace / listas', desc: 'Hashtag en línea para enlazar o categorizar' },
    { key: 'V, H, R, O, D, A, P, T, E · G', scope: 'Dibujo', desc: 'Elegir herramienta (seleccionar, desplazar, rectángulo, elipse, rombo, flecha, trazo libre, texto, borrador) · cuadrícula sí/no' },
    { key: 'H o ←', scope: 'Pila de triage', desc: 'Descartar el pensamiento (a la papelera)' },
    { key: 'L o →', scope: 'Pila de triage', desc: 'Convertir el pensamiento en tarea de inmediato' },
    { key: 'T', scope: 'Pila de triage', desc: 'Crear una tarea con fecha de vencimiento' },
    { key: 'D', scope: 'Pila de triage', desc: 'Convertir el pensamiento en nota del Workspace' },
    { key: 'Espacio', scope: 'Pila de triage', desc: 'Saltar la tarjeta («Más tarde» – al final de la pila)' },
    { key: 'Deslizar a la izquierda', scope: 'Triage (táctil/móvil)', desc: 'Descartar el pensamiento' },
    { key: 'Deslizar a la derecha', scope: 'Triage (táctil/móvil)', desc: 'Asumir el pensamiento como tarea' },
    { key: 'Mantener pulsado', scope: 'Triage (táctil/móvil)', desc: 'Abrir el menú de acciones (fecha, lista, nota)' },
  ],
};

export default es;
