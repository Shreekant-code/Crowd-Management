import express from "express";
import {
  getTopology,
  calculateRoutes,
  calculateSingleRoute,
  calculateMaxFlow,
} from "../controllers/evacuationController.js";

const router = express.Router();

router.get("/topology", getTopology);
router.post("/routes", calculateRoutes);
router.post("/route", calculateSingleRoute);
router.post("/max-flow", calculateMaxFlow);

export default router;
