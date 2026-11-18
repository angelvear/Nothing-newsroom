# Nothing News Widget

Widget de escritorio para Windows que muestra las últimas publicaciones del **Newsroom** de
[nothing.community](https://nothing.community), inspirado en el widget *Community Headlines* de Android.

Hecho con **Tauri v2**: frontend en HTML/CSS/JS sin bundler y un comando en Rust que consulta el foro.

> Proyecto no oficial, sin relación con Nothing Technology Limited.

## Descarga

El instalador para Windows está en [Releases](https://github.com/angelvear/nothing-newsroom/releases).
Cada etiqueta `v*` que se sube al repositorio lanza un workflow de GitHub Actions que compila en Windows y publica una release nueva.

## Requisitos (Windows)

1. **Rust**: <https://rustup.rs> (toolchain `stable-msvc`).
2. **Microsoft C++ Build Tools**: marca la carga "Desarrollo para el escritorio con C++".
3. **Node.js** 18 o superior.
4. **WebView2**: ya viene instalado en Windows 10/11.

## Uso

```bash
npm install
npm run dev      # arranca el widget en modo desarrollo
npm run build    # genera el instalador (.exe NSIS y .msi) en src-tauri/target/release/bundle/
```

Para ver el diseño sin compilar nada, abre `src/index.html` en el navegador. Usa datos de ejemplo.

## Estructura

```
src/                  Frontend (lo que se ve)
  index.html
  styles.css          Tema oscuro/claro estilo Nothing
  main.js             Carga, parseo del JSON de Flarum, render y botones
src-tauri/
  src/lib.rs          Comando `fetch_news`: llama a /api/discussions del foro
  tauri.conf.json     Ventana sin bordes, transparente y fuera de la barra de tareas
  capabilities/       Permisos (arrastrar, cerrar, fijar encima, abrir enlaces)
  icons/
```

## Cómo funciona

- nothing.community funciona con **Flarum**, así que el widget llama a
  `GET /api/discussions?sort=-createdAt&filter[tag]=newsroom&include=user,tags,firstPost`.
- La petición la hace Rust (`reqwest`) para evitar los bloqueos de CORS del WebView.
- Si la etiqueta `newsroom` no devuelve nada, el widget muestra las últimas publicaciones de todo el foro.
- Se refresca cada 10 minutos y también al volver a enfocar la ventana, si los datos tienen más de 5 minutos.
- El punto rojo marca las publicaciones de los últimos 7 días que aún no has abierto.
- Recuerda la posición, el tamaño, el tema y si estaba fijado encima (plugin `window-state` y `localStorage`).

## Configuración rápida

En `src/main.js`, objeto `CONFIG`:

| Clave            | Por defecto | Qué hace                                    |
|------------------|-------------|---------------------------------------------|
| `tag`            | `newsroom`  | Slug de la etiqueta del foro que se muestra |
| `limit`          | `8`         | Número de publicaciones (máx. 20)           |
| `refreshMinutes` | `10`        | Cada cuánto se actualiza                    |

Para mirar otra etiqueta sin tocar el código, abre las DevTools en `npm run dev` (clic derecho → Inspeccionar)
y ejecuta: `localStorage.setItem("nnw.tag", "otra-etiqueta")`. Después recarga.

## Ideas para siguientes versiones

- Arranque con Windows (`tauri-plugin-autostart`).
- Icono en la bandeja del sistema para mostrar y ocultar el widget.
- Notificación cuando salga una publicación nueva en el Newsroom.
- Panel de ajustes dentro del widget (etiqueta, nº de noticias, idioma).
