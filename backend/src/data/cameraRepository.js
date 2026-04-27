import { readJson, writeJson } from "./jsonDb.js";

const FILE_NAME = "cameras.json";

function listAll() {
  return readJson(FILE_NAME, []);
}

function listByUser(userId) {
  return listAll().filter((camera) => camera.userId === userId);
}

function getById(id) {
  return listAll().find((camera) => camera.id === id);
}

function getByUser(id, userId) {
  return listAll().find((camera) => camera.id === id && camera.userId === userId);
}

function save(camera) {
  const cameras = listAll();
  const index = cameras.findIndex((item) => item.id === camera.id);

  if (index >= 0) {
    cameras[index] = camera;
  } else {
    cameras.unshift(camera);
  }

  writeJson(FILE_NAME, cameras);
  return camera;
}

function remove(id) {
  const cameras = listAll();
  const camera = cameras.find((item) => item.id === id);
  writeJson(
    FILE_NAME,
    cameras.filter((item) => item.id !== id)
  );
  return camera;
}

function resetRunningStatuses() {
  const cameras = listAll().map((camera) => ({
    ...camera,
    status: "stopped",
  }));
  writeJson(FILE_NAME, cameras);
  return cameras;
}

export default {
  listAll,
  listByUser,
  getById,
  getByUser,
  save,
  remove,
  resetRunningStatuses,
};
