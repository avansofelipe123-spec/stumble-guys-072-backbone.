
const WebSocket = require("ws");
const { WebSocketServer } = WebSocket;
const { hashToken, validateToken } = require("./auth");

function attachRealtimeServer(server, pool) {
    const wss = new WebSocketServer({
        server,
        path: "/realtime",
        maxPayload: 16 * 1024
    });

    const roomClients = new Map();

    function send(ws, data) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    function broadcast(roomCode, data, excludedClient = null) {
        const clients = roomClients.get(roomCode);

        if (!clients) return;

        for (const client of clients) {
            if (client !== excludedClient) {
                send(client, data);
            }
        }
    }

    function leaveRoom(ws, roomCode) {
        const clients = roomClients.get(roomCode);

        if (!clients || !ws.rooms.has(roomCode)) return;

        clients.delete(ws);

        if (clients.size === 0) {
            roomClients.delete(roomCode);
        }

        ws.rooms.delete(roomCode);

        broadcast(roomCode, {
            type: "room.member_left",
            playerId: ws.player.id
        });
    }

    async function handleMessage(ws, rawMessage) {
        let message;

        try {
            message = JSON.parse(rawMessage.toString());
        } catch {
            return send(ws, {
                type: "error",
                error: "Invalid JSON"
            });
        }

        if (!message || typeof message.type !== "string") {
            return send(ws, {
                type: "error",
                error: "Invalid message"
            });
        }

        if (message.type === "auth") {
            if (ws.player) {
                return send(ws, {
                    type: "error",
                    error: "Already authenticated"
                });
            }

            const token = message.token;

            if (!validateToken(token)) {
                return send(ws, {
                    type: "auth.failed",
                    error: "Invalid account token"
                });
            }

            const result = await pool.query(
                `SELECT id, nickname, tag_number
                 FROM players
                 WHERE account_key = $1
                 AND is_bot = FALSE
                 LIMIT 1`,
                [hashToken(token)]
            );

            if (result.rowCount === 0) {
                return send(ws, {
                    type: "auth.failed",
                    error: "Account not found"
                });
            }

            ws.player = result.rows[0];

            return send(ws, {
                type: "auth.success",
                player: ws.player
            });
        }

        if (!ws.player) {
            return send(ws, {
                type: "error",
                error: "Authentication required"
            });
        }

        if (message.type === "ping") {
            return send(ws, {
                type: "pong",
                timestamp: Date.now()
            });
        }

        if (message.type === "room.join") {
            const roomCode = message.code;

            if (
                typeof roomCode !== "string" ||
                !/^SGX[0-9]{4}$/.test(roomCode)
            ) {
                return send(ws, {
                    type: "error",
                    error: "Invalid room code"
                });
            }

            const membership = await pool.query(
                `SELECT r.code
                 FROM backbone_rooms r
                 INNER JOIN backbone_room_members m
                    ON m.room_id = r.id
                 WHERE r.code = $1
                 AND m.player_id = $2
                 LIMIT 1`,
                [roomCode, ws.player.id]
            );

            if (membership.rowCount === 0) {
                return send(ws, {
                    type: "error",
                    error: "You are not a member of this room"
                });
            }

            if (ws.rooms.has(roomCode)) {
                return send(ws, {
                    type: "room.joined",
                    code: roomCode
                });
            }

            if (!roomClients.has(roomCode)) {
                roomClients.set(roomCode, new Set());
            }

            roomClients.get(roomCode).add(ws);
            ws.rooms.add(roomCode);

            send(ws, {
                type: "room.joined",
                code: roomCode
            });

            broadcast(roomCode, {
                type: "room.member_connected",
                playerId: ws.player.id
            }, ws);

            return;
        }

        if (message.type === "room.leave") {
            const roomCode = message.code;

            if (typeof roomCode !== "string") {
                return send(ws, {
                    type: "error",
                    error: "Invalid room code"
                });
            }

            if (ws.rooms.has(roomCode)) {
                leaveRoom(ws, roomCode);
            }

            return send(ws, {
                type: "room.left",
                code: roomCode
            });
        }

        send(ws, {
            type: "error",
            error: "Unknown message type"
        });
    }

    wss.on("connection", (ws) => {
        ws.player = null;
        ws.rooms = new Set();

        // Processa uma mensagem por vez para manter a ordem.
        ws.messageQueue = Promise.resolve();

        ws.on("message", (rawMessage) => {
            ws.messageQueue = ws.messageQueue
                .then(() => handleMessage(ws, rawMessage))
                .catch((error) => {
                    console.error(
                        "Backbone realtime error:",
                        error.message
                    );

                    send(ws, {
                        type: "error",
                        error: "Realtime operation failed"
                    });
                });
        });

        ws.on("close", () => {
            for (const roomCode of [...ws.rooms]) {
                leaveRoom(ws, roomCode);
            }
        });

        ws.on("error", (error) => {
            console.error(
                "Backbone WebSocket error:",
                error.message
            );
        });
    });

    console.log("Backbone realtime WebSocket initialized");

    return wss;
}

module.exports = {
    attachRealtimeServer
};
