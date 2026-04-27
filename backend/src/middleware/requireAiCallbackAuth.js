import { aiCallbackSecret } from "../config/env.js";

function requireAiCallbackAuth(req, res, next) {
  const secret = req.headers["x-ai-callback-secret"];

  if (secret !== aiCallbackSecret) {
    return res.status(401).json({ message: "Unauthorized AI callback" });
  }

  next();
}

export { requireAiCallbackAuth };
