import express from "express";
import upload from "../middleware/upload.js";
import { processVideoUpload } from "../controllers/uploadController.js";

const router = express.Router();

router.post("/", upload.single("video"), processVideoUpload);

export default router;
