import { registerUploadResult } from "../services/aiPredictionService.js";

async function receiveUploadResult(req, res) {
  if (!req.body?.job_id) {
    return res.status(400).json({ message: "job_id is required" });
  }

  await registerUploadResult(req.body.job_id, req.body);

  return res.json({
    status: "ok",
    receivedAt: new Date().toISOString(),
  });
}

export { receiveUploadResult };
