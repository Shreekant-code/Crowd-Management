import path from "path";
import multer from "multer";
import { uploadDir } from "../config/env.js";
import { ensureDir } from "../utils/ffmpeg.js";

ensureDir(uploadDir);

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const targetDir = path.join(uploadDir, req.platformUser?.id || "anonymous");
    ensureDir(targetDir);
    cb(null, targetDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/\s+/g, "-").toLowerCase();
    cb(null, `${Date.now()}-${base}${ext}`);
  },
});

const allowedTypes = new Set(["video/mp4", "video/quicktime", "video/x-matroska", "video/webm"]);

const upload = multer({
  storage,
  limits: {
    fileSize: 1024 * 1024 * 250,
  },
  fileFilter: (_req, file, cb) => {
    if (!allowedTypes.has(file.mimetype)) {
      cb(new Error("Only video uploads are supported"));
      return;
    }

    cb(null, true);
  },
});

export default upload;
