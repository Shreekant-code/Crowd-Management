import fs from "fs/promises";

async function cleanupFiles(paths = []) {
  const uniquePaths = [...new Set(paths.filter(Boolean))];

  await Promise.all(
    uniquePaths.map(async (targetPath) => {
      try {
        await fs.unlink(targetPath);
      } catch (error) {
        if (error?.code !== "ENOENT") {
          console.error(`[cleanup] failed to remove ${targetPath}`);
          console.error(error.message);
        }
      }
    })
  );
}

export { cleanupFiles };
