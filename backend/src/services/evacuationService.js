import { requestJson } from "./aiHttpClient.js";
import cameraRepository from "../data/cameraRepository.js";

class EvacuationService {
  async getTopology() {
    try {
      return await requestJson("/evacuation/topology", { method: "GET" });
    } catch (err) {
      console.warn("[evacuation-service] Could not fetch topology from python-service, returning fallback", err.message);
      return null;
    }
  }

  async calculateRoutes(userId) {
    const cameras = cameraRepository.listByUser(userId);
    const telemetry = {};

    cameras.forEach((cam) => {
      const count = Number(cam.metrics?.current_count ?? cam.metrics?.count ?? 0);
      const zone = cam.zoneName || cam.name || "";
      telemetry[zone] = { current_count: count };
    });

    try {
      return await requestJson("/evacuation/routes", {
        method: "POST",
        body: { telemetry },
      });
    } catch (err) {
      console.warn("[evacuation-service] Python evacuation routing unavailable:", err.message);
      return { status: "offline", routes: {}, telemetry };
    }
  }

  async calculateSingleRoute(source, targetExit, userId) {
    const cameras = cameraRepository.listByUser(userId);
    const telemetry = {};

    cameras.forEach((cam) => {
      const count = Number(cam.metrics?.current_count ?? cam.metrics?.count ?? 0);
      const zone = cam.zoneName || cam.name || "";
      telemetry[zone] = { current_count: count };
    });

    try {
      return await requestJson("/evacuation/route", {
        method: "POST",
        body: { source, target_exit: targetExit, telemetry },
      });
    } catch (err) {
      console.warn("[evacuation-service] Python single route calculation failed:", err.message);
      return { source, target_exit: targetExit, path: [source, targetExit || "Exit_North_Main"] };
    }
  }

  async calculateMaxFlow(demands, userId) {
    const cameras = cameraRepository.listByUser(userId);
    const telemetry = {};

    cameras.forEach((cam) => {
      const count = Number(cam.metrics?.current_count ?? cam.metrics?.count ?? 0);
      telemetry[cam.zoneName || cam.name || ""] = { current_count: count };
    });

    try {
      return await requestJson("/evacuation/max-flow", {
        method: "POST",
        body: { demands, telemetry },
      });
    } catch (err) {
      console.warn("[evacuation-service] MCMF flow calculation failed:", err.message);
      return { status: "fallback", exit_distribution: {} };
    }
  }
}

export default new EvacuationService();
