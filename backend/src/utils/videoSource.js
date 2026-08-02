function normalizeSourceUrl(sourceUrl) {
  const raw = String(sourceUrl || "").trim();
  if (!raw) {
    return raw;
  }

  if (/<iframe\b/i.test(raw) || /src\s*=\s*["'][^"']+["']/i.test(raw)) {
    const srcMatch = raw.match(/src\s*=\s*["']([^"']+)["']/i);
    if (srcMatch?.[1]) {
      return normalizeSourceUrl(srcMatch[1]);
    }

    const urlMatch = raw.match(/https?:\/\/[^"' <>\]]+/i);
    if (urlMatch?.[0]) {
      return normalizeSourceUrl(urlMatch[0]);
    }
  }

  if (/^webcam:\/\/?/i.test(raw)) {
    return raw.replace(/^webcam:\/\//i, "webcam://");
  }

  try {
    const parsed = new URL(raw);
    const hostname = (parsed.hostname || "").toLowerCase();
    const isPrivateIpv4 =
      /^10\./.test(hostname)
      || /^192\.168\./.test(hostname)
      || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
      || hostname === "localhost"
      || hostname === "127.0.0.1";

    if (parsed.protocol === "https:" && isPrivateIpv4) {
      parsed.protocol = "http:";
    }

    return parsed.toString();
  } catch (_error) {
    return raw;
  }
}

function detectSourceType(sourceUrl, preferredType = "") {
  const normalizedPreferred = String(preferredType || "").trim().toLowerCase();
  const normalizedSource = normalizeSourceUrl(sourceUrl).trim().toLowerCase();

  if (
    normalizedPreferred === "rtsp"
    || normalizedPreferred === "webcam"
    || normalizedPreferred === "public"
    || normalizedPreferred === "hls"
    || normalizedPreferred === "mjpeg"
    || normalizedPreferred === "usb"
    || normalizedPreferred === "ipcam"
    || normalizedPreferred === "file"
  ) {
    return normalizedPreferred;
  }

  if (normalizedSource.startsWith("webcam://")) {
    return "webcam";
  }

  if (normalizedSource.startsWith("rtsp://")) {
    return "rtsp";
  }

  if (normalizedSource.startsWith("http://") || normalizedSource.startsWith("https://")) {
    try {
      const parsed = new URL(normalizedSource);
      const host = (parsed.hostname || "").toLowerCase();
      if (
        host.includes("youtube.com")
        || host.includes("youtu.be")
        || host.includes("earthlive.tv")
        || host.includes("twitch.tv")
      ) {
        return "public";
      }

      if (normalizedPreferred === "public") {
        return "public";
      }

      if (normalizedSource.includes("/mjpeg") || normalizedSource.includes("mjpg")) {
        return "mjpeg";
      }
      if (normalizedSource.includes(".m3u8")) {
        return "hls";
      }
      return "http";
    } catch (_error) {
      if (normalizedSource.includes(".m3u8")) {
        return "hls";
      }
      return normalizedPreferred === "public" ? "public" : "http";
    }
  }

  if (normalizedSource.endsWith(".m3u8") || normalizedSource.includes(".m3u8?")) {
    return "hls";
  }

  if (
    normalizedSource.endsWith(".mjpg")
    || normalizedSource.endsWith(".mjpeg")
    || normalizedSource.includes("mjpeg")
  ) {
    return "mjpeg";
  }

  if (
    normalizedSource.endsWith(".mp4")
    || normalizedSource.endsWith(".avi")
    || normalizedSource.endsWith(".mov")
    || normalizedSource.endsWith(".mkv")
    || normalizedSource.endsWith(".webm")
  ) {
    return "file";
  }

  return "public";
}

function isLiveStreamSourceType(sourceType) {
  return [
    "rtsp",
    "http",
    "public",
    "webcam",
    "hls",
    "mjpeg",
    "usb",
    "ipcam",
    "file",
  ].includes(String(sourceType || "").toLowerCase());
}

export { normalizeSourceUrl, detectSourceType, isLiveStreamSourceType };
