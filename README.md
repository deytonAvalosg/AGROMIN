# AGROMIN MongoDB Sync Backend

Este repositorio incluye el frontend en `index.html` y un backend ligero en `server.js` para sincronizar el estado de la aplicación con MongoDB Atlas.

## Configuración

1. Copia `.env.example` a `.env`.
2. Ajusta `MONGODB_URI` con tu cadena de conexión de MongoDB Atlas.
3. Ejecuta:

```bash
npm install
npm start
```

## Uso

- Abre el navegador en `http://localhost:3000/index.html`.
- Inicia sesión con los usuarios configurados en `index.html`.
- El estado se guardará automáticamente en MongoDB Atlas en la colección configurada.

## Notas

- El frontend ya está preparado para guardar y cargar el estado remoto a través de la API local.
- Si deseas servir el frontend desde otro puerto u origen, ajusta `MONGO_API_BASE` en `index.html`.
