const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.leptons.xyz",
  "https://pipedapi.nosebs.ru"
];

const STREAM_TIMEOUT_MS = 5000;
const TRACK_TIMEOUT_MS = 8000;

function isValidVideoId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{11}$/.test(value);
}

async function fetchWithTimeout(url, timeoutMs, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "*/*",
        ...options.headers
      }
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeLanguage(value) {
  return String(value || "").trim().toLowerCase();
}

function pickSubtitleTrack(subtitles) {
  if (!Array.isArray(subtitles) || subtitles.length === 0) return null;

  const arabic = subtitles.find((track) => {
    const code = normalizeLanguage(track?.code);
    const name = normalizeLanguage(track?.name);

    return (
      code === "ar" ||
      code.startsWith("ar-") ||
      name.includes("arabic") ||
      name.includes("العربية")
    );
  });

  if (arabic) return arabic;

  const english = subtitles.find((track) => {
    const code = normalizeLanguage(track?.code);
    const name = normalizeLanguage(track?.name);

    return (
      code === "en" ||
      code.startsWith("en-") ||
      name.includes("english")
    );
  });

  return english || subtitles[0];
}

function buildVttUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new Error("رابط الترجمة غير صالح.");
  }

  const url = new URL(rawUrl);

  if (url.protocol !== "https:") {
    throw new Error("بروتوكول رابط الترجمة غير آمن.");
  }

  url.searchParams.set("fmt", "vtt");

  return url.toString();
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => {
      const value = Number(code);

      return Number.isFinite(value)
        ? String.fromCodePoint(value)
        : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const value = Number.parseInt(code, 16);

      return Number.isFinite(value)
        ? String.fromCodePoint(value)
        : "";
    });
}

function cleanVtt(vttText) {
  if (typeof vttText !== "string" || !vttText.trim()) {
    return "";
  }

  const output = [];

  let previousLine = "";
  let skipBlock = false;

  for (const rawLine of vttText.replace(/\r/g, "").split("\n")) {
    const line = rawLine.trim();

    if (!line) {
      skipBlock = false;
      continue;
    }

    if (/^(NOTE|STYLE|REGION)(\s|$)/i.test(line)) {
      skipBlock = true;
      continue;
    }

    if (skipBlock) continue;

    if (/^WEBVTT/i.test(line)) continue;
    if (/^(Kind|Language):/i.test(line)) continue;
    if (/^X-TIMESTAMP-MAP=/i.test(line)) continue;
    if (line.includes("-->")) continue;
    if (/^\d+$/.test(line)) continue;

    const cleaned = decodeHtmlEntities(line)
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned || cleaned === previousLine) {
      continue;
    }

    output.push(cleaned);
    previousLine = cleaned;
  }

  return output
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return res.status(405).json({
      error: "طريقة الطلب غير مدعومة."
    });
  }

  const { videoId } = req.query;

  if (!isValidVideoId(videoId)) {
    return res.status(400).json({
      error: "معرف فيديو YouTube غير صالح."
    });
  }

  let foundSubtitleMetadata = false;

  for (const instance of PIPED_INSTANCES) {
    try {
      const streamResponse = await fetchWithTimeout(
        `${instance}/streams/${encodeURIComponent(videoId)}`,
        STREAM_TIMEOUT_MS,
        {
          headers: {
            Accept: "application/json"
          }
        }
      );

      if (!streamResponse.ok) {
        continue;
      }

      const data = await streamResponse.json();

      const subtitles = Array.isArray(data?.subtitles)
        ? data.subtitles
        : [];

      if (subtitles.length === 0) {
        continue;
      }

      foundSubtitleMetadata = true;

      const track = pickSubtitleTrack(subtitles);

      if (!track?.url) {
        continue;
      }

      const trackUrl = buildVttUrl(track.url);

      const trackResponse = await fetchWithTimeout(
        trackUrl,
        TRACK_TIMEOUT_MS
      );

      if (!trackResponse.ok) {
        continue;
      }

      const transcript = cleanVtt(
        await trackResponse.text()
      );

      if (!transcript) {
        continue;
      }

      return res.status(200).json({
        transcript,
        lang: track.name || track.code || "unknown",
        code: track.code || null
      });
    } catch (error) {
      // إذا تعطل خادم أو انتهت المهلة،
      // ينتقل تلقائياً إلى الخادم التالي.
      continue;
    }
  }

  if (foundSubtitleMetadata) {
    return res.status(502).json({
      error:
        "تم العثور على ترجمة، لكن تعذر قراءة ملف النص حالياً. حاول مرة أخرى بعد قليل."
    });
  }

  return res.status(404).json({
    error:
      "لا تتوفر ترجمة أو نص مفرغ لهذا الفيديو حالياً."
  });
}
