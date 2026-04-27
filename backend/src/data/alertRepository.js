import { maxAlerts } from "../config/env.js";
import { readJson, writeJson } from "./jsonDb.js";

const FILE_NAME = "alerts.json";

function listAll() {
  return readJson(FILE_NAME, []);
}

function listByUser(userId) {
  return listAll().filter((alert) => alert.userId === userId).slice(0, maxAlerts);
}

function add(alert) {
  const alerts = [alert, ...listAll()]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, maxAlerts * 20);
  writeJson(FILE_NAME, alerts);
  return alert;
}

export default {
  listAll,
  listByUser,
  add,
};
