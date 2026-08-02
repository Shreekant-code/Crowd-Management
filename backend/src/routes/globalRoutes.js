import express from "express";
import {
  getGlobal,
  getGlobalPrediction,
  getGlobalSummary,
} from "../controllers/dashboardController.js";

const router = express.Router();

router.get("/", getGlobal);
router.get("/summary", getGlobalSummary);
router.get("/prediction", getGlobalPrediction);

export default router;
