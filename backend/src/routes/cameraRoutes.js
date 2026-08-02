import express from "express";
import controller from "../controllers/cameraController.js";

const router = express.Router();

router.get("/", controller.listCameras);
router.get("/:id/preview", controller.previewCamera);
router.post("/", controller.addCamera);
router.post("/:id/start", controller.startCamera);
router.post("/:id/pause", controller.pauseCamera);
router.post("/:id/resume", controller.resumeCamera);
router.post("/:id/restart", controller.restartCamera);
router.post("/:id/stop", controller.stopCamera);
router.delete("/:id", controller.deleteCamera);

export default router;
