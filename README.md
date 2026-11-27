# Mi Colección

App personal para apuntar mi colección de K-pop (álbumes, photocards y merch), mis juegos, pelis y series, anime y manga.

- Funciona en el navegador y se instala en el móvil como una app (icono propio, pantalla completa).
- Los datos y las fotos se guardan en Firebase (Firestore), en una cuenta con correo y contraseña. Cada cuenta solo ve sus propios datos.
- Funciona también sin conexión y se sincroniza al volver a tenerla.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La app: diseño, apartados y toda la lógica de la interfaz |
| `app-firebase.js` | Acceso con cuenta, base de datos, fotos y copias de seguridad |
| `firebase-config.js` | La configuración pública del proyecto de Firebase |
| `firestore.rules` | Reglas de seguridad para pegar en Firebase |
| `manifest.webmanifest`, `sw.js`, `icons/` | Lo necesario para instalarla como app |

## Puesta en marcha

1. Crear un proyecto en [Firebase](https://console.firebase.google.com).
2. **Authentication** → Comenzar → activar **Correo electrónico/contraseña**.
3. **Firestore Database** → Crear base de datos → modo producción → ubicación en Europa.
4. En **Firestore → Reglas**, pegar el contenido de `firestore.rules` y publicar.
5. **Configuración del proyecto → Tus apps → Web (`</>`)** → copiar el objeto `firebaseConfig` en `firebase-config.js`.
6. **Authentication → Configuración → Dominios autorizados** → añadir `TU_USUARIO.github.io`.
7. Publicar con **GitHub Pages** (Settings → Pages → rama `main`, carpeta `/`).

## Copias de seguridad

Al pie de la app hay **Descargar copia** (un archivo `.json` con todo, fotos incluidas) e **Importar copia**. Nunca subas ese archivo al repositorio: contiene tus datos.
