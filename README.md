
# Stumble Guys 0.72 - Backbone

Serviço independente de infraestrutura multiplayer.

## Responsabilidades

- Gerenciamento de salas privadas.
- Códigos de sala SGX + 4 números.
- Entrada e saída de jogadores.
- Lista de participantes.
- Escolha de mapas.
- Sistema de jogadores prontos.
- Organização de partidas.
- Comunicação em tempo real via WebSocket.
- Gerenciamento de sessões de jogo.

## Tecnologias

- Node.js
- Express
- PostgreSQL
- WebSocket

## Instalação

```bash
npm install
npm start
```

## Variáveis de ambiente

- PORT
- DATABASE_URL
- BACKEND_API_URL
- BACKEND_API_KEY
- NODE_ENV

## API

### Salas

- POST /api/backbone/rooms
- GET /api/backbone/rooms/:code
- POST /api/backbone/rooms/:code/join
- POST /api/backbone/rooms/:code/leave
- PATCH /api/backbone/rooms/:code/ready
- PATCH /api/backbone/rooms/:code/map
- POST /api/backbone/rooms/:code/start

### WebSocket

Endpoint:

`/realtime`

## Health check

`GET /health`

## Observação

Este projeto é a infraestrutura de salas e comunicação.
Ele ainda precisa de autenticação integrada, servidor
autoritativo de partidas e integração com o cliente do jogo.
# stumble-guys-072-backbone.