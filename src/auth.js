
const crypto = require("crypto");

function validateToken(token) {
    return (
        typeof token === "string" &&
        /^[a-f0-9]{64}$/i.test(token)
    );
}

function hashToken(token) {
    return crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
}

function createAccountAuth(pool) {
    return async function accountAuth(req, res, next) {
        try {
            const authorization = req.headers.authorization || "";

            if (!authorization.startsWith("Bearer ")) {
                return res.status(401).json({
                    error: "Authentication required"
                });
            }

            const token = authorization.slice(7);

            if (!validateToken(token)) {
                return res.status(401).json({
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
                return res.status(401).json({
                    error: "Account not found"
                });
            }

            req.player = result.rows[0];

            next();

        } catch (error) {
            console.error(
                "Backbone authentication error:",
                error.message
            );

            return res.status(500).json({
                error: "Authentication failed"
            });
        }
    };
}

module.exports = {
    createAccountAuth,
    validateToken,
    hashToken
};
