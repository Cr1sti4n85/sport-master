# Redis Pub/Sub Integration para WebSocket Distribuido

## Overview

Este proyecto integra Redis pub/sub para sincronizar mensajes WebSocket entre múltiples instancias de la aplicación. Esto permite que los usuarios conectados a diferentes instancias reciban notificaciones en tiempo real.

## Arquitectura

```
┌─────────────────┐
│   Cliente WS    │
└────────┬────────┘
         │
    ┌────────────────────────┐
    │  Instancia 1 (Puerto 8080)  │
    │  ├─ Express + WS Server │
    │  └─ Redis Pub/Sub       │
    └─────────────┬───────────┘
                  │
            ┌─────▼─────┐
            │   Redis   │
            │ Pub/Sub   │
            └─────┬─────┘
                  │
    ┌─────────────┴───────────┐
    │                         │
┌───────────────────┐  ┌──────────────────┐
│  Instancia 2      │  │  Instancia 3     │
│  (Puerto 8081)    │  │  (Puerto 8082)   │
│  Redis Subscriber │  │ Redis Subscriber │
└───────────────────┘  └──────────────────┘
```

## Canales Redis

### 1. `matches:broadcast`
- **Propósito**: Notificar a TODOS los clientes conectados de nuevos matches
- **Disparado por**: Endpoint `POST /matches`
- **Comportamiento**: Cada instancia recibe y envía a todos sus clientes conectados

### 2. `match:{matchId}:commentary`
- **Propósito**: Notificar solo a clientes suscritos a un match específico
- **Disparado por**: Endpoint `POST /matches/:id/commentary`
- **Comportamiento**: Solo clientes suscritos a ese `matchId` reciben la notificación

## Flujo de Mensajes

### Crear un nuevo match (Broadcast Global)
```
Cliente HTTP
    │
    ▼
POST /matches (en cualquier instancia)
    │
    ▼
Endpoint genera: { type: "match_created", data: {...} }
    │
    ├─▶ broadcastMatchCreated() llamado
    │   ├─▶ Envía a clientes locales (en memoria)
    │   └─▶ Publica a Redis canal "matches:broadcast"
    │
    ▼
Redis pub/sub
    │
    ├─▶ Instancia 1 recibe → envía a clientes locales
    ├─▶ Instancia 2 recibe → envía a clientes locales
    └─▶ Instancia 3 recibe → envía a clientes locales
    
Todos los clientes en todas las instancias reciben el match nuevo
```

### Agregar comentario a un match (Suscriptores)
```
Cliente HTTP
    │
    ▼
POST /matches/:id/commentary (en cualquier instancia)
    │
    ▼
Endpoint genera: { type: "commentary", data: {...} }
    │
    ├─▶ broadcastCommentary(matchId) llamado
    │   ├─▶ Envía a clientes locales suscritos a matchId
    │   └─▶ Publica a Redis canal "match:123:commentary"
    │
    ▼
Redis pub/sub
    │
    ├─▶ Instancia 1 recibe → envía a clientes suscritos a match:123
    ├─▶ Instancia 2 recibe → envía a clientes suscritos a match:123
    └─▶ Instancia 3 recibe → envía a clientes suscritos a match:123
    
Solo clientes suscritos a match:123 reciben el comentario
```

## Configuración

### Variables de Entorno

```env
# Redis
REDIS_HOST=redis          # Host del servidor Redis (en Docker, usar nombre del servicio)
REDIS_PORT=6379          # Puerto de Redis

# Server
PORT=8080                # Puerto de la aplicación
HOST=0.0.0.0             # Host de escucha
```

### Docker Compose

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes

  api1:
    build: .
    ports:
      - "8080:8080"
    environment:
      PORT: 8080
      REDIS_HOST: redis
      REDIS_PORT: 6379
      DATABASE_URL: "postgresql://..."
    depends_on:
      - redis
    networks:
      - backend

  api2:
    build: .
    ports:
      - "8081:8080"
    environment:
      PORT: 8080
      REDIS_HOST: redis
      REDIS_PORT: 6379
      DATABASE_URL: "postgresql://..."
    depends_on:
      - redis
    networks:
      - backend

  api3:
    build: .
    ports:
      - "8082:8080"
    environment:
      PORT: 8080
      REDIS_HOST: redis
      REDIS_PORT: 6379
      DATABASE_URL: "postgresql://..."
    depends_on:
      - redis
    networks:
      - backend

volumes:
  redis_data:

networks:
  backend:
```

## Cliente WebSocket

### Ejemplos de uso

```javascript
// Conectar al WebSocket
const ws = new WebSocket('ws://localhost:8080/ws');

// Recibir mensaje de bienvenida
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  if (message.type === 'Welcome') {
    console.log('Conectado');
  }
  
  if (message.type === 'match_created') {
    console.log('Nuevo match:', message.data);
  }
  
  if (message.type === 'commentary') {
    console.log('Comentario:', message.data);
  }
  
  if (message.type === 'subscribed') {
    console.log(`Suscrito a match ${message.matchId}`);
  }
};

// Suscribirse a un match específico
ws.send(JSON.stringify({
  type: 'subscribe',
  matchId: 123
}));

// Desuscribirse
ws.send(JSON.stringify({
  type: 'unsubscribe',
  matchId: 123
}));
```

## Detalles de Implementación

### Archivos Creados/Modificados

1. **`src/redis/client.js`** (NUEVO)
   - Configura cliente Redis publisher y subscriber
   - Expone funciones `connectRedis()` y `disconnectRedis()`
   - Lee variables de entorno: `REDIS_HOST`, `REDIS_PORT`

2. **`src/ws/server.js`** (MODIFICADO)
   - Recibe `publisher` y `subscriber` como parámetros
   - Escucha eventos Redis en canales `matches:broadcast` y `match:*:commentary`
   - Al recibir eventos locales (HTTP), publica a Redis además de enviar localmente
   - Maneja suscripción/desuscripción dinámicamente a canales Redis

3. **`src/index.js`** (MODIFICADO)
   - Importa Redis client
   - Conecta a Redis antes de iniciar servidor
   - Pasa `publisher` y `subscriber` a `attachWebSocketServer()`

4. **`package.json`** (MODIFICADO)
   - Agrega dependencia: `redis@^4.7.0`

### Optimizaciones

- **Suscripción dinámica a Redis**: Solo se suscriben a canales cuando hay clientes locales interesados
- **Desuscripción automática**: Cuando no hay clientes locales en un match, se desuscribe del canal Redis
- **Map local para velocidad**: Mantiene un `Map` de suscriptores locales para evitar iterar todos los clientes
- **Sin duplicados**: Cada instancia mantiene su propio estado local, Redis solo sincroniza entre instancias

## Testing

### Test básico con 3 instancias

1. Levantar Docker Compose:
```bash
docker-compose up
```

2. Conectar cliente 1 a instancia 1 (puerto 8080)
3. Conectar cliente 2 a instancia 2 (puerto 8081)
4. Cliente 1 suscribirse a match ID 100
5. Cliente 2 suscribirse a match ID 100

6. Hacer POST a instancia 3:
```bash
curl -X POST http://localhost:8082/matches \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Match", "sport": "football"}'
```

**Esperado**: Ambos clientes (1 y 2) reciben notificación de nuevo match

7. Hacer POST comentario a instancia 1:
```bash
curl -X POST http://localhost:8080/matches/100/commentary \
  -H "Content-Type: application/json" \
  -d '{"text": "Excelente jugada"}'
```

**Esperado**: Solo clientes suscritos a match 100 reciben el comentario

## Troubleshooting

### "Failed to connect to Redis"
- Verificar que Redis está corriendo: `redis-cli ping` debe retornar `PONG`
- Verificar `REDIS_HOST` y `REDIS_PORT` en variables de entorno
- En Docker, el host debe ser el nombre del servicio (`redis`), no `localhost`

### Clientes no reciben mensajes
- Verificar que cliente está enviando correcto `type: "subscribe"` con `matchId` como número
- Revisar logs de la instancia WebSocket
- Verificar que Redis está recibiendo mensajes: `redis-cli SUBSCRIBE '*'`

### Duplicados de mensajes
- Cada instancia debe recibir el mensaje una sola vez de Redis
- Si se ven duplicados, revisar logs para duplicados en publicación

## Performance

- Cada instancia mantiene su propio Map de suscriptores (O(1) lookups)
- Redis pub/sub es fire-and-forget (no persiste mensajes)
- Para persistence, considerar Redis Streams o Kafka en futuro
- Rate limiting sigue funcionando por instancia (no global)
