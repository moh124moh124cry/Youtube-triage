const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.leptons.xyz",
  "https://pipedapi.nosebs.ru",
  "https://pipedapi-libre.kavin.rocks",
  "https://piped-api.privacy.com.de",
  "https://pipedapi.adminforge.de",
  "https://api.piped.yt",
  "https://api.piped.private.coffee",
  "https://pipedapi.drgns.space"
];

const INSTANCE_BATCH_SIZE = 3;

const STREAM_TIMEOUT_MS = 5000;
const TRACK_TIMEOUT_MS = 8000;
const WATCH_PAGE_TIMEOUT_MS = 6000;
const INNERTUBE_TIMEOUT_MS = 7000;

const MAX_TRACK_BYTES = 2 * 1024 * 1024;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS = 500000;

const FALLBACK_INNERTUBE_API_KEY =
  "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

const INNERTUBE_CLIENTS = [
{
    id: "ios",
    clientName: "IOS",
    clientVersion: "20.03.02",
    clientNumber: "5",
    userAgent:
      "com.google.ios.youtube/20.03.02 (iPhone16,2; U; CPU iOS 18_2_1 like Mac OS X;)",
    extraClient: {
      deviceMake: "Apple",
      deviceModel: "iPhone16,2",
      osName: "iPhone",
      osVersion: "18.2.1.22C161"
    }
  },
{
    id: "android",
    clientName: "ANDROID",
    clientVersion: "19.47.53",
    clientNumber: "3",
    userAgent:
      "com.google.android.youtube/19.47.53 (Linux; U; Android 14) gzip",
    extraClient: {
      androidSdkVersion: 34,
      osName: "Android",
      osVersion: "14"
    }
  },
{
    id: "web",
    clientName: "WEB",
    clientVersion: "2.20250312.04.00",
    clientNumber: "1",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    extraClient: {}
  }
];

function isValidVideoId(value) {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9_-]{11}$/.test(value)
  );
}

function normalizeLanguage(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isPrivateIPv4(hostname) {
  if (
    !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(
      hostname
    )
  ) {
    return false;
  }

  const parts = hostname
    .split(".")
    .map(Number);

  if (
    parts.length !== 4 ||
    parts.some(
      (part) =>
        !Number.isInteger(part) ||
        part < 0 ||
        part > 255
    )
  ) {
    return true;
  }

  const [a, b] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 &&
      b >= 16 &&
      b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateIPv6(hostname) {
  const host = hostname
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .toLowerCase();

  return (
    host === "::1" ||
    host === "::" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    /^fe[89ab]/.test(host)
  );
}

function isSafeRemoteUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);

    if (url.protocol !== "https:") {
      return false;
    }

    const host =
      url.hostname.toLowerCase();

    if (
      !host ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal")
    ) {
      return false;
    }

    if (
      isPrivateIPv4(host) ||
      (
        host.includes(":") &&
        isPrivateIPv6(host)
      )
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function isAllowedYouTubeCaptionUrl(
  rawUrl
) {
  try {
    const url = new URL(rawUrl);

    if (url.protocol !== "https:") {
      return false;
    }

    const host =
      url.hostname.toLowerCase();

    return (
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "m.youtube.com" ||
      host === "video.google.com" ||
      host.endsWith(".youtube.com") ||
      host.endsWith(
        ".googlevideo.com"
      )
    );
  } catch {
    return false;
  }
}

async function fetchWithTimeout(
  url,
  timeoutMs,
  options = {},
  externalSignal = null
) {
  const controller =
    new AbortController();

  const abortFromExternal = () => {
    controller.abort();
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener(
        "abort",
        abortFromExternal,
        { once: true }
      );
    }
  }

  const timeoutId = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    return await fetch(url, {
      ...options,
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "*/*",
        ...options.headers
      }
    });
  } finally {
    clearTimeout(timeoutId);

    if (externalSignal) {
      externalSignal.removeEventListener(
        "abort",
        abortFromExternal
      );
    }
  }
}

async function readLimitedText(
  response,
  maxBytes
) {
  const lengthHeader =
    response.headers.get(
      "content-length"
    );

  if (lengthHeader) {
    const declaredSize =
      Number(lengthHeader);

    if (
      Number.isFinite(
        declaredSize
      ) &&
      declaredSize > maxBytes
    ) {
      throw new Error(
        "الاستجابة أكبر من الحد المسموح."
      );
    }
  }

  const text =
    await response.text();

  if (
    Buffer.byteLength(
      text,
      "utf8"
    ) > maxBytes
  ) {
    throw new Error(
      "الاستجابة أكبر من الحد المسموح."
    );
  }

  return text;
}

function trackScore(track) {
  const code =
    normalizeLanguage(
      track?.code ||
      track?.languageCode ||
      track?.lang_code
    );

  const name =
    normalizeLanguage(
      getTrackDisplayName(track)
    );

  let score = 0;

  if (
    code === "ar" ||
    code.startsWith("ar-") ||
    name.includes("arabic") ||
    name.includes("العربية")
  ) {
    score += 100;
  } else if (
    code === "en" ||
    code.startsWith("en-") ||
    name.includes("english")
  ) {
    score += 80;
  } else if (
    code === "fr" ||
    code.startsWith("fr-") ||
    name.includes("french") ||
    name.includes("français")
  ) {
    score += 60;
  } else {
    score += 20;
  }

  const autoGenerated =
    track?.autoGenerated === true ||
    track?.auto_generated === true ||
    track?.kind === "asr" ||
    name.includes("auto-generated") ||
    name.includes(
      "automatically generated"
    );

  if (!autoGenerated) {
    score += 10;
  }

  if (
    typeof track?.url === "string" &&
    track.url.trim()
  ) {
    score += 5;
  }

  if (
    typeof track?.baseUrl ===
      "string" &&
    track.baseUrl.trim()
  ) {
    score += 5;
  }

  return score;
}

function pickSubtitleTrack(subtitles) {
  if (
    !Array.isArray(subtitles) ||
    subtitles.length === 0
  ) {
    return null;
  }

  return (
    [...subtitles]
      .filter(
        (track) =>
          track &&
          typeof track === "object"
      )
      .sort(
        (a, b) =>
          trackScore(b) -
          trackScore(a)
      )[0] || null
  );
}

function getTrackDisplayName(track) {
  if (
    typeof track?.name ===
    "string"
  ) {
    return track.name;
  }

  if (
    typeof track?.name
      ?.simpleText === "string"
  ) {
    return track.name.simpleText;
  }

  if (
    Array.isArray(
      track?.name?.runs
    )
  ) {
    const value =
      track.name.runs
        .map(
          (item) =>
            item?.text || ""
        )
        .join("")
        .trim();

    if (value) {
      return value;
    }
  }

  return (
    track?.lang_original ||
    track?.lang_translated ||
    track?.languageCode ||
    track?.code ||
    track?.lang_code ||
    "unknown"
  );
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(
      /&#39;|&apos;/gi,
      "'"
    )
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(
      /&#(\d+);/g,
      (_, code) => {
        const value =
          Number(code);

        return (
          Number.isInteger(value) &&
          value >= 0 &&
          value <= 0x10ffff
        )
          ? String.fromCodePoint(
              value
            )
          : "";
      }
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, code) => {
        const value =
          Number.parseInt(
            code,
            16
          );

        return (
          Number.isInteger(value) &&
          value >= 0 &&
          value <= 0x10ffff
        )
          ? String.fromCodePoint(
              value
            )
          : "";
      }
    );
}

function normalizeCaptionLine(line) {
  return decodeHtmlEntities(line)
    .replace(/<[^>]*>/g, "")
    .replace(/\u200b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function appendWithOverlap(
  words,
  nextWords
) {
  if (!nextWords.length) {
    return words;
  }

  if (!words.length) {
    return [...nextWords];
  }

  const maxOverlap =
    Math.min(
      words.length,
      nextWords.length,
      30
    );

  let overlap = 0;

  for (
    let size = maxOverlap;
    size >= 1;
    size -= 1
  ) {
    let matches = true;

    for (
      let i = 0;
      i < size;
      i += 1
    ) {
      if (
        words[
          words.length -
          size +
          i
        ] !== nextWords[i]
      ) {
        matches = false;
        break;
      }
    }

    if (matches) {
      overlap = size;
      break;
    }
  }

  words.push(
    ...nextWords.slice(overlap)
  );

  return words;
}

function cleanVtt(vttText) {
  if (
    typeof vttText !== "string" ||
    !vttText.trim()
  ) {
    return "";
  }

  let outputWords = [];
  let previousLine = "";
  let skipBlock = false;
  let currentLength = 0;

  const lines = vttText
    .replace(/\r/g, "")
    .split("\n");

  for (const rawLine of lines) {
    const line =
      rawLine.trim();

    if (!line) {
      skipBlock = false;
      continue;
    }

    if (
      /^(NOTE|STYLE|REGION)(\s|$)/i.test(
        line
      )
    ) {
      skipBlock = true;
      continue;
    }

    if (skipBlock) {
      continue;
    }

    if (/^WEBVTT/i.test(line)) {
      continue;
    }

    if (
      /^(Kind|Language):/i.test(
        line
      )
    ) {
      continue;
    }

    if (
      /^X-TIMESTAMP-MAP=/i.test(
        line
      )
    ) {
      continue;
    }

    if (line.includes("-->")) {
      continue;
    }

    if (/^\d+$/.test(line)) {
      continue;
    }

    const cleaned =
      normalizeCaptionLine(
        line
      );

    if (
      !cleaned ||
      cleaned === previousLine
    ) {
      continue;
    }

    outputWords =
      appendWithOverlap(
        outputWords,
        cleaned.split(/\s+/)
      );

    currentLength +=
      cleaned.length + 1;

    previousLine = cleaned;

    if (
      currentLength >=
      MAX_TRANSCRIPT_CHARS
    ) {
      break;
    }
  }

  return outputWords
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(
      0,
      MAX_TRANSCRIPT_CHARS
    );
}

function cleanJson3(data) {
  const events =
    Array.isArray(data?.events)
      ? data.events
      : [];

  let outputWords = [];
  let currentLength = 0;

  for (const event of events) {
    const segments =
      Array.isArray(event?.segs)
        ? event.segs
        : [];

    const raw = segments
      .map(
        (segment) =>
          segment?.utf8 || ""
      )
      .join("");

    const cleaned =
      normalizeCaptionLine(raw);

    if (!cleaned) {
      continue;
    }

    outputWords =
      appendWithOverlap(
        outputWords,
        cleaned.split(/\s+/)
      );

    currentLength +=
      cleaned.length + 1;

    if (
      currentLength >=
      MAX_TRANSCRIPT_CHARS
    ) {
      break;
    }
  }

  return outputWords
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(
      0,
      MAX_TRANSCRIPT_CHARS
    );
}

function cleanTimedTextXml(xmlText) {
  if (
    typeof xmlText !== "string" ||
    !xmlText.trim()
  ) {
    return "";
  }

  let outputWords = [];
  let currentLength = 0;

  const regex =
    /<text\b[^>]*>([\s\S]*?)<\/text>/gi;

  let match;

  while (
    (match = regex.exec(xmlText))
  ) {
    const cleaned =
      normalizeCaptionLine(
        match[1]
      );

    if (!cleaned) {
      continue;
    }

    outputWords =
      appendWithOverlap(
        outputWords,
        cleaned.split(/\s+/)
      );

    currentLength +=
      cleaned.length + 1;

    if (
      currentLength >=
      MAX_TRANSCRIPT_CHARS
    ) {
      break;
    }
  }

  return outputWords
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(
      0,
      MAX_TRANSCRIPT_CHARS
    );
}

function buildVttUrl(rawUrl) {
  if (
    typeof rawUrl !== "string" ||
    !rawUrl.trim() ||
    !isSafeRemoteUrl(rawUrl)
  ) {
    throw new Error(
      "رابط الترجمة غير صالح أو غير آمن."
    );
  }

  const url = new URL(rawUrl);

  url.searchParams.set(
    "fmt",
    "vtt"
  );

  return url.toString();
}

async function readTrackText(
  trackUrl,
  signal
) {
  const response =
    await fetchWithTimeout(
      trackUrl,
      TRACK_TIMEOUT_MS,
      {
        headers: {
          Accept:
            "text/vtt,text/plain;q=0.9,*/*;q=0.5"
        }
      },
      signal
    );

  if (!response.ok) {
    throw new Error(
      `Track HTTP ${response.status}`
    );
  }

  return readLimitedText(
    response,
    MAX_TRACK_BYTES
  );
}

async function tryInstance(
  instance,
  videoId,
  signal
) {
  let foundSubtitleMetadata =
    false;

  try {
    const streamResponse =
      await fetchWithTimeout(
        `${instance}/streams/${encodeURIComponent(
          videoId
        )}`,
        STREAM_TIMEOUT_MS,
        {
          headers: {
            Accept:
              "application/json"
          }
        },
        signal
      );

    if (!streamResponse.ok) {
      return {
        ok: false,
        foundSubtitleMetadata
      };
    }

    const data =
      await streamResponse.json();

    const subtitles =
      Array.isArray(
        data?.subtitles
      )
        ? data.subtitles
        : [];

    if (!subtitles.length) {
      return {
        ok: false,
        foundSubtitleMetadata
      };
    }

    foundSubtitleMetadata =
      true;

    const track =
      pickSubtitleTrack(
        subtitles
      );

    if (!track?.url) {
      return {
        ok: false,
        foundSubtitleMetadata
      };
    }

    const trackUrl =
      buildVttUrl(
        track.url
      );

    const trackText =
      await readTrackText(
        trackUrl,
        signal
      );

    const transcript =
      cleanVtt(trackText);

    if (!transcript) {
      return {
        ok: false,
        foundSubtitleMetadata
      };
    }

    return {
      ok: true,
      foundSubtitleMetadata,
      transcript,
      lang:
        track.name ||
        track.code ||
        "unknown",
      code:
        track.code || null,
      source: "piped"
    };
  } catch {
    return {
      ok: false,
      foundSubtitleMetadata
    };
  }
}

async function runInstanceBatch(
  instances,
  videoId
) {
  const batchController =
    new AbortController();

  const wrapped =
    instances.map(
      async (instance) => {
        const result =
          await tryInstance(
            instance,
            videoId,
            batchController.signal
          );

        if (result.ok) {
          return result;
        }

        throw result;
      }
    );

  try {
    const winner =
      await Promise.any(
        wrapped
      );

    batchController.abort();

    return {
      success: winner,
      foundSubtitleMetadata:
        true
    };
  } catch (error) {
    batchController.abort();

    const failures =
      Array.isArray(
        error?.errors
      )
        ? error.errors
        : [];

    return {
      success: null,
      foundSubtitleMetadata:
        failures.some(
          (item) =>
            item?.foundSubtitleMetadata
        )
    };
  }
}

function extractInnerTubeApiKey(
  html
) {
  if (
    typeof html !== "string" ||
    !html
  ) {
    return null;
  }

  const patterns = [
    /"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/,
    /'INNERTUBE_API_KEY'\s*:\s*'([^']+)'/,
    /INNERTUBE_API_KEY\s*[:=]\s*"([^"]+)"/
  ];

  for (
    const pattern of patterns
  ) {
    const match =
      html.match(pattern);

    if (
      match?.[1] &&
      match[1].startsWith(
        "AIza"
      )
    ) {
      return match[1];
    }
  }

  return null;
}

async function getInnerTubeApiKey(
  videoId
) {
  try {
    const url =
      new URL(
        "https://www.youtube.com/watch"
      );

    url.searchParams.set(
      "v",
      videoId
    );

    url.searchParams.set(
      "hl",
      "en"
    );

    const response =
      await fetchWithTimeout(
        url.toString(),
        WATCH_PAGE_TIMEOUT_MS,
        {
          headers: {
            Accept:
              "text/html,application/xhtml+xml",
            "Accept-Language":
              "en-US,en;q=0.9",
            "User-Agent":
              INNERTUBE_CLIENTS[
                2
              ].userAgent
          }
        }
      );

    if (!response.ok) {
      return (
        FALLBACK_INNERTUBE_API_KEY
      );
    }

    const html =
      await readLimitedText(
        response,
        MAX_PAGE_BYTES
      );

    return (
      extractInnerTubeApiKey(
        html
      ) ||
      FALLBACK_INNERTUBE_API_KEY
    );
  } catch {
    return (
      FALLBACK_INNERTUBE_API_KEY
    );
  }
}

function getCaptionTracksFromPlayer(
  playerData
) {
  const tracks =
    playerData?.captions
      ?.playerCaptionsTracklistRenderer
      ?.captionTracks;

  return Array.isArray(tracks)
    ? tracks
    : [];
}

function isLikelyPoTokenTrack(
  rawUrl
) {
  try {
    const url =
      new URL(rawUrl);

    return (
      url.searchParams.get(
        "exp"
      ) === "xpe"
    );
  } catch {
    return false;
  }
}

async function fetchCaptionFromBaseUrl(
  baseUrl,
  client
) {
  const diagnostics = {
    validUrl: false,
    poTokenLike: false,
    host: null,
    attempts: []
  };

  if (
    typeof baseUrl !== "string" ||
    !baseUrl.trim() ||
    !isAllowedYouTubeCaptionUrl(
      baseUrl
    )
  ) {
    return {
      transcript: "",
      diagnostics
    };
  }

  diagnostics.validUrl = true;
  diagnostics.poTokenLike =
    isLikelyPoTokenTrack(baseUrl);

  try {
    diagnostics.host =
      new URL(baseUrl).hostname;
  } catch {
    diagnostics.host = null;
  }

  const commonHeaders = {
    "Accept-Language":
      "en-US,en;q=0.9",
    "User-Agent":
      client.userAgent,
    Referer:
      "https://www.youtube.com/"
  };

  const formats = [
    "json3",
    null,
    "vtt"
  ];

  for (
    const format of formats
  ) {
    const attempt = {
      format:
        format || "default",
      status: null,
      ok: false,
      bytes: 0,
      contentType: null,
      parsed: false,
      error: null
    };

    try {
      const url =
        new URL(baseUrl);

      if (format) {
        url.searchParams.set(
          "fmt",
          format
        );
      } else {
        url.searchParams.delete(
          "fmt"
        );
      }

      const response =
        await fetchWithTimeout(
          url.toString(),
          TRACK_TIMEOUT_MS,
          {
            headers: {
              ...commonHeaders,
              Accept:
                format === "json3"
                  ? "application/json,text/plain;q=0.9,*/*;q=0.5"
                  : format === "vtt"
                    ? "text/vtt,text/plain;q=0.9,*/*;q=0.5"
                    : "text/xml,application/xml,text/plain;q=0.9,*/*;q=0.5"
            }
          }
        );

      attempt.status =
        response.status;
      attempt.ok =
        response.ok;
      attempt.contentType =
        response.headers.get(
          "content-type"
        );

      if (!response.ok) {
        diagnostics.attempts.push(
          attempt
        );
        continue;
      }

      const body =
        await readLimitedText(
          response,
          MAX_TRACK_BYTES
        );

      attempt.bytes =
        Buffer.byteLength(
          body,
          "utf8"
        );

      if (!body.trim()) {
        diagnostics.attempts.push(
          attempt
        );
        continue;
      }

      if (
        format === "json3"
      ) {
        try {
          const data =
            JSON.parse(body);

          const transcript =
            cleanJson3(data);

          if (transcript) {
            attempt.parsed = true;
            diagnostics.attempts.push(
              attempt
            );

            return {
              transcript,
              diagnostics
            };
          }
        } catch {
          // نجرب الصيغة التالية.
        }
      } else if (
        format === "vtt"
      ) {
        const transcript =
          cleanVtt(body);

        if (transcript) {
          attempt.parsed = true;
          diagnostics.attempts.push(
            attempt
          );

          return {
            transcript,
            diagnostics
          };
        }
      } else {
        const transcript =
          cleanTimedTextXml(
            body
          );

        if (transcript) {
          attempt.parsed = true;
          diagnostics.attempts.push(
            attempt
          );

          return {
            transcript,
            diagnostics
          };
        }

        try {
          const data =
            JSON.parse(body);

          const transcriptFromJson =
            cleanJson3(data);

          if (
            transcriptFromJson
          ) {
            attempt.parsed = true;
            diagnostics.attempts.push(
              attempt
            );

            return {
              transcript:
                transcriptFromJson,
              diagnostics
            };
          }
        } catch {
          // ليست JSON.
        }
      }

      diagnostics.attempts.push(
        attempt
      );
    } catch (error) {
      attempt.error =
        error?.name ||
        "fetch-error";

      diagnostics.attempts.push(
        attempt
      );
    }
  }

  return {
    transcript: "",
    diagnostics
  };
}


async function callInnerTubePlayer(
  videoId,
  apiKey,
  client
) {
  const url =
    new URL(
      "https://www.youtube.com/youtubei/v1/player"
    );

  if (apiKey) {
    url.searchParams.set(
      "key",
      apiKey
    );
  }

  url.searchParams.set(
    "prettyPrint",
    "false"
  );

  const payload = {
    videoId,
    context: {
      client: {
        hl: "en",
        gl: "US",
        clientName:
          client.clientName,
        clientVersion:
          client.clientVersion,
        userAgent:
          client.userAgent,
        ...client.extraClient
      }
    },
    contentCheckOk: true,
    racyCheckOk: true
  };

  if (
    client.clientName === "WEB"
  ) {
    payload.playbackContext = {
      contentPlaybackContext: {
        html5Preference:
          "HTML5_PREF_WANTS"
      }
    };
  }

  try {
    const response =
      await fetchWithTimeout(
        url.toString(),
        INNERTUBE_TIMEOUT_MS,
        {
          method: "POST",
          headers: {
            Accept:
              "application/json",
            "Content-Type":
              "application/json",
            "User-Agent":
              client.userAgent,
            Origin:
              "https://www.youtube.com",
            Referer:
              "https://www.youtube.com/",
            "X-YouTube-Client-Name":
              client.clientNumber,
            "X-YouTube-Client-Version":
              client.clientVersion
          },
          body:
            JSON.stringify(payload)
        }
      );

    if (!response.ok) {
      return {
        ok: false,
        httpStatus:
          response.status,
        tracks: [],
        playabilityStatus:
          null,
        error: null
      };
    }

    let data;

    try {
      data =
        await response.json();
    } catch {
      return {
        ok: false,
        httpStatus:
          response.status,
        tracks: [],
        playabilityStatus:
          null,
        error:
          "invalid-json"
      };
    }

    return {
      ok: true,
      httpStatus:
        response.status,
      tracks:
        getCaptionTracksFromPlayer(
          data
        ),
      playabilityStatus:
        data?.playabilityStatus
          ?.status || null,
      playabilityReason:
        data?.playabilityStatus
          ?.reason || null,
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      httpStatus: null,
      tracks: [],
      playabilityStatus:
        null,
      playabilityReason:
        null,
      error:
        error?.name ||
        "request-error"
    };
  }
}


async function tryInnerTube(
  videoId
) {
  const apiKey =
    await getInnerTubeApiKey(
      videoId
    );

  let foundSubtitleMetadata =
    false;

  const diagnostics = {
    clients: []
  };

  for (
    const client of
    INNERTUBE_CLIENTS
  ) {
    const clientDiagnostics = {
      id: client.id,
      playerOk: false,
      httpStatus: null,
      playabilityStatus: null,
      playabilityReason: null,
      trackCount: 0,
      tracks: [],
      error: null
    };

    try {
      const playerResult =
        await callInnerTubePlayer(
          videoId,
          apiKey,
          client
        );

      clientDiagnostics.playerOk =
        playerResult.ok;
      clientDiagnostics.httpStatus =
        playerResult.httpStatus;
      clientDiagnostics.playabilityStatus =
        playerResult.playabilityStatus;
      clientDiagnostics.playabilityReason =
        playerResult.playabilityReason;
      clientDiagnostics.error =
        playerResult.error;

      const tracks =
        playerResult.tracks;

      clientDiagnostics.trackCount =
        tracks.length;

      if (!tracks.length) {
        diagnostics.clients.push(
          clientDiagnostics
        );
        continue;
      }

      foundSubtitleMetadata =
        true;

      const orderedTracks =
        [...tracks]
          .filter(
            (track) =>
              track &&
              typeof track ===
                "object" &&
              typeof track
                .baseUrl ===
                "string"
          )
          .sort(
            (a, b) =>
              trackScore(b) -
              trackScore(a)
          );

      for (
        const track of
        orderedTracks
      ) {
        const trackDiagnostics = {
          code:
            track.languageCode ||
            null,
          name:
            getTrackDisplayName(
              track
            ),
          kind:
            track.kind || null,
          poTokenLike:
            isLikelyPoTokenTrack(
              track.baseUrl
            ),
          fetch: null
        };

        if (
          client.clientName ===
            "WEB" &&
          trackDiagnostics
            .poTokenLike
        ) {
          trackDiagnostics.fetch = {
            skipped:
              "po-token-like"
          };

          clientDiagnostics.tracks.push(
            trackDiagnostics
          );

          continue;
        }

        const captionResult =
          await fetchCaptionFromBaseUrl(
            track.baseUrl,
            client
          );

        trackDiagnostics.fetch =
          captionResult.diagnostics;

        clientDiagnostics.tracks.push(
          trackDiagnostics
        );

        if (
          !captionResult.transcript
        ) {
          continue;
        }

        diagnostics.clients.push(
          clientDiagnostics
        );

        return {
          success: {
            transcript:
              captionResult.transcript,
            lang:
              getTrackDisplayName(
                track
              ),
            code:
              track.languageCode ||
              null,
            source:
              `innertube-${client.id}`
          },
          foundSubtitleMetadata:
            true,
          diagnostics
        };
      }
    } catch (error) {
      clientDiagnostics.error =
        error?.name ||
        "inner-error";
    }

    diagnostics.clients.push(
      clientDiagnostics
    );
  }

  return {
    success: null,
    foundSubtitleMetadata,
    diagnostics
  };
}


async function tryWatchPageCaptionTracks(
  videoId
) {
  try {
    const url =
      new URL(
        "https://www.youtube.com/watch"
      );

    url.searchParams.set(
      "v",
      videoId
    );

    url.searchParams.set(
      "hl",
      "en"
    );

    const client =
      INNERTUBE_CLIENTS[2];

    const response =
      await fetchWithTimeout(
        url.toString(),
        WATCH_PAGE_TIMEOUT_MS,
        {
          headers: {
            Accept:
              "text/html,application/xhtml+xml",
            "Accept-Language":
              "en-US,en;q=0.9",
            "User-Agent":
              client.userAgent
          }
        }
      );

    if (!response.ok) {
      return {
        success: null,
        foundSubtitleMetadata:
          false
      };
    }

    const html =
      await readLimitedText(
        response,
        MAX_PAGE_BYTES
      );

    const marker =
      '"captionTracks":';

    const markerIndex =
      html.indexOf(marker);

    if (markerIndex < 0) {
      return {
        success: null,
        foundSubtitleMetadata:
          false
      };
    }

    const start =
      html.indexOf(
        "[",
        markerIndex +
          marker.length
      );

    if (start < 0) {
      return {
        success: null,
        foundSubtitleMetadata:
          false
      };
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;

    for (
      let i = start;
      i < html.length;
      i += 1
    ) {
      const char = html[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }

        if (char === "\\") {
          escaped = true;
          continue;
        }

        if (char === '"') {
          inString = false;
        }

        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === "[") {
        depth += 1;
      } else if (
        char === "]"
      ) {
        depth -= 1;

        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }

    if (end < 0) {
      return {
        success: null,
        foundSubtitleMetadata:
          false
      };
    }

    let tracks;

    try {
      tracks =
        JSON.parse(
          html.slice(
            start,
            end
          )
        );
    } catch {
      return {
        success: null,
        foundSubtitleMetadata:
          false
      };
    }

    if (
      !Array.isArray(tracks) ||
      !tracks.length
    ) {
      return {
        success: null,
        foundSubtitleMetadata:
          false
      };
    }

    const orderedTracks =
      [...tracks]
        .filter(
          (track) =>
            typeof track?.baseUrl ===
            "string"
        )
        .sort(
          (a, b) =>
            trackScore(b) -
            trackScore(a)
        );

    for (
      const track of
      orderedTracks
    ) {
      if (
        isLikelyPoTokenTrack(
          track.baseUrl
        )
      ) {
        continue;
      }

      const captionResult =
        await fetchCaptionFromBaseUrl(
          track.baseUrl,
          client
        );

      if (captionResult.transcript) {
        return {
          success: {
            transcript:
              captionResult.transcript,
            lang:
              getTrackDisplayName(
                track
              ),
            code:
              track.languageCode ||
              null,
            source:
              "watch-page"
          },
          foundSubtitleMetadata:
            true
        };
      }
    }

    return {
      success: null,
      foundSubtitleMetadata:
        true
    };
  } catch {
    return {
      success: null,
      foundSubtitleMetadata:
        false
    };
  }
}

export default async function handler(
  req,
  res
) {
  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  if (req.method !== "GET") {
    res.setHeader(
      "Allow",
      "GET"
    );

    return res
      .status(405)
      .json({
        error:
          "طريقة الطلب غير مدعومة."
      });
  }

  const { videoId } =
    req.query;

  const debug =
    req.query?.debug === "1";

  if (
    !isValidVideoId(
      videoId
    )
  ) {
    return res
      .status(400)
      .json({
        error:
          "معرف فيديو YouTube غير صالح."
      });
  }

  let foundSubtitleMetadata =
    false;

  // 1) Piped
  for (
    let index = 0;
    index <
    PIPED_INSTANCES.length;
    index +=
    INSTANCE_BATCH_SIZE
  ) {
    const batch =
      PIPED_INSTANCES.slice(
        index,
        index +
          INSTANCE_BATCH_SIZE
      );

    const result =
      await runInstanceBatch(
        batch,
        videoId
      );

    if (
      result.foundSubtitleMetadata
    ) {
      foundSubtitleMetadata =
        true;
    }

    if (result.success) {
      return res
        .status(200)
        .json({
          transcript:
            result.success
              .transcript,
          lang:
            result.success.lang,
          code:
            result.success.code,
          source:
            result.success.source
        });
    }
  }

  // 2) YouTube InnerTube
  const innerTubeResult =
    await tryInnerTube(
      videoId
    );

  const debugDiagnostics = {
    innerTube:
      innerTubeResult.diagnostics ||
      null
  };

  if (
    innerTubeResult
      .foundSubtitleMetadata
  ) {
    foundSubtitleMetadata =
      true;
  }

  if (
    innerTubeResult.success
  ) {
    return res
      .status(200)
      .json({
        transcript:
          innerTubeResult
            .success
            .transcript,
        lang:
          innerTubeResult
            .success.lang,
        code:
          innerTubeResult
            .success.code,
        source:
          innerTubeResult
            .success.source
      });
  }

  // 3) Watch page signed caption URL
  const watchPageResult =
    await tryWatchPageCaptionTracks(
      videoId
    );

  if (
    watchPageResult
      .foundSubtitleMetadata
  ) {
    foundSubtitleMetadata =
      true;
  }

  if (
    watchPageResult.success
  ) {
    return res
      .status(200)
      .json({
        transcript:
          watchPageResult
            .success
            .transcript,
        lang:
          watchPageResult
            .success.lang,
        code:
          watchPageResult
            .success.code,
        source:
          watchPageResult
            .success.source
      });
  }

  if (
    foundSubtitleMetadata
  ) {
    return res
      .status(502)
      .json({
        error:
          "تم العثور على Captions لهذا الفيديو، لكن YouTube منع تنزيل ملف النص من الخادم حالياً. حاول مرة أخرى بعد قليل.",
        ...(debug
          ? { diagnostics:
              debugDiagnostics }
          : {})
      });
  }

  return res
    .status(404)
    .json({
      error:
        "لم يتم العثور على Captions قابلة للاستخراج لهذا الفيديو حالياً.",
      ...(debug
        ? { diagnostics:
            debugDiagnostics }
        : {})
    });
}

