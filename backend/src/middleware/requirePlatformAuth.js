import { platformApiSecret } from "../config/env.js";

function requirePlatformAuth(req, res, next) {
  const secret = req.headers["x-platform-secret"];
  const userId = req.headers["x-user-id"];
  const email = req.headers["x-user-email"];

  if (secret !== platformApiSecret) {
    return res.status(401).json({ message: "Unauthorized platform request" });
  }

  if (!userId) {
    return res.status(401).json({ message: "Missing user context" });
  }

  req.platformUser = {
    id: String(userId),
    email: email ? String(email) : null,
  };

  next();
}

export { requirePlatformAuth };
