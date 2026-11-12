
const WebSocket = require("ws");

function attachRealtimeServer(server, pool) {
    const wss = new WebSocket.Server({
        server,
        path: "/realtime"
    });

    const rooms = new Map();

    wss.on("connection", (socket) => {
        let currentRoom = null;
        let playerId = null;

        socket.on("message", async (raw) => {
            try {
                const message = JSON.parse(raw.toString());

                if (message.type === "ping") {
                    socket.send(JSON.stringify({ type: "pong" }));
                    return;
                }

                if (message.type === "auth") {
                    if (!message.token) {
                        socket.close(1008, "Token required");
                        return;
                    }

                    const result = await pool.query(
                        `SELECT id FROM players
                         WHERE account_key = $1 LIMIT 1`,
                        [message.token]
                    );

                    if (result.rowCount === 0) {
                        socket.close(1008, "Invalid account");
                        return;
                    }

                    playerId = result.rows[0].id;

                    socket.send(JSON.stringify({
                        type: "auth.success",
                        playerId
                    }));
                    return;
                }

                if (!playerId) {
                    socket.close(1008, "Authentication required");
                    return;
                }

                if (message.type === "room.join") {
                    const code = String(message.code || "");

                    const result = await pool.query(
                        `SELECT id FROM rooms WHERE code = $1`,
                        [code]
                    );

                    if (result.rowCount === 0) {
                        socket.send(JSON.stringify({
                            type: "error",
                            message: "Room not found"
                        }));
                        return;
                    }

                    if (currentRoom) {
                        rooms.get(currentRoom)?.delete(socket);
                    }

                    currentRoom = code;

                    if (!rooms.has(code)) {
                        rooms.set(code, new Set());
                    }

                    rooms.get(code).add(socket);

                    socket.send(JSON.stringify({
                        type: "room.joined",
                        code
                    }));

                    broadcast(code, {
                        type: "room.player_joined",
                        playerId
                    });

                    return;
                }

                if (message.type === "room.leave") {
                    leaveRoom();
                }
            } catch (error) {
                socket.send(JSON.stringify({
                    type: "error",
                    message: "Invalid message"
                }));
            }
        });

        function leaveRoom() {
            if (!currentRoom) return;

            rooms.get(currentRoom)?.delete(socket);

            broadcast(currentRoom, {
                type: "room.player_left",
                playerId
            });

            if (rooms.get(currentRoom)?.size === 0) {
                rooms.delete(currentRoom);
            }

            currentRoom = null;
        }

        socket.on("close", leaveRoom);
    });

    function broadcast(code, data) {
        const members = rooms.get(code);
        if (!members) return;

        const payload = JSON.stringify(data);

        for (const client of members) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        }
    }

    return wss;
}

module.exports = { attachRealtimeServer };
