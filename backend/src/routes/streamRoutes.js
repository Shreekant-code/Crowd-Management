import express from "express";
import { getStreamStats, streamCamera } from "../controllers/streamController.js";

const router = express.Router();

router.get("/:cameraId/stats", getStreamStats);
router.get("/:cameraId", streamCamera);

export default router;
