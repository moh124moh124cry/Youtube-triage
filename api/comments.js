const MAX_COMMENTS = 300;
const PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 8000;

function isValidVideoId(value) {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9_-]{11}$/.test(value)
  );
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();

  const timeoutId = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json"
      }
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function getYouTubeErrorMessage(data, status) {
  const reason =
    data?.error?.errors?.[0]?.reason || "";

  if (reason === "commentsDisabled") {
    return "التعليقات معطلة على هذا الفيديو.";
  }

  if (reason === "videoNotFound") {
    return "الفيديو غير موجود أو غير متاح للعامة.";
  }

  if (
    reason === "quotaExceeded" ||
    reason === "dailyLimitExceeded"
  ) {
    return "تم استهلاك الحصة اليومية المسموح بها من YouTube API. حاول لاحقاً.";
  }

  if (
    reason === "keyInvalid" ||
    reason === "ipRefererBlocked"
  ) {
    return "مفتاح YouTube API غير صالح أو أن قيوده تمنع هذا الطلب.";
  }

  if (status === 403) {
    return "تعذر الوصول إلى تعليقات هذا الفيديو عبر YouTube API.";
  }

  if (status === 404) {
    return "الفيديو غير موجود أو غير متاح.";
  }

  return (
    data?.error?.message ||
    "حدث خطأ أثناء الاتصال بـ YouTube API."
  );
}

function normalizeComment(item) {
  const comment =
    item?.snippet?.topLevelComment;

  const snippet = comment?.snippet;

  if (!comment?.id || !snippet) {
    return null;
  }

  const authorChannelId =
    snippet.authorChannelId?.value || null;

  return {
    id:
      authorChannelId ||
      `comment:${comment.id}`,

    commentId: comment.id,

    name:
      snippet.authorDisplayName ||
      "YouTube User",

    avatar:
      snippet.authorProfileImageUrl || "",

    text:
      snippet.textDisplay || "",

    authorChannelId,

    likeCount:
      Number.isFinite(snippet.likeCount)
        ? snippet.likeCount
        : 0,

    publishedAt:
      snippet.publishedAt || null
  };
}

export default async function handler(req, res) {
  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return res.status(405).json({
      error: "طريقة الطلب غير مدعومة."
    });
  }

  const apiKey =
    process.env.YOUTUBE_API_KEY;

  const { videoId } = req.query;

  if (!apiKey) {
    return res.status(500).json({
      error:
        "مفتاح YOUTUBE_API_KEY غير مضبوط في إعدادات Vercel."
    });
  }

  if (!isValidVideoId(videoId)) {
    return res.status(400).json({
      error:
        "معرف فيديو YouTube غير صالح."
    });
  }

  const comments = [];

  let nextPageToken = null;
  let truncated = false;

  try {
    do {
      const params =
        new URLSearchParams({
          part: "snippet",
          videoId,
          maxResults: String(PAGE_SIZE),
          textFormat: "plainText",
          order: "time",
          key: apiKey
        });

      if (nextPageToken) {
        params.set(
          "pageToken",
          nextPageToken
        );
      }

      const apiUrl =
        `https://www.googleapis.com/youtube/v3/commentThreads?${params.toString()}`;

      const response =
        await fetchWithTimeout(
          apiUrl,
          REQUEST_TIMEOUT_MS
        );

      let data;

      try {
        data = await response.json();
      } catch {
        return res.status(502).json({
          error:
            "أعاد YouTube API استجابة غير صالحة. حاول مرة أخرى."
        });
      }

      if (!response.ok) {
        return res
          .status(response.status)
          .json({
            error:
              getYouTubeErrorMessage(
                data,
                response.status
              )
          });
      }

      const items =
        Array.isArray(data?.items)
          ? data.items
          : [];

      for (const item of items) {
        const normalized =
          normalizeComment(item);

        if (!normalized) {
          continue;
        }

        comments.push(normalized);

        if (
          comments.length >=
          MAX_COMMENTS
        ) {
          break;
        }
      }

      nextPageToken =
        data?.nextPageToken || null;

      if (
        comments.length >=
          MAX_COMMENTS &&
        nextPageToken
      ) {
        truncated = true;
      }
    } while (
      nextPageToken &&
      comments.length < MAX_COMMENTS
    );

    return res.status(200).json({
      comments,

      meta: {
        count: comments.length,
        limit: MAX_COMMENTS,
        truncated
      }
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      return res.status(504).json({
        error:
          "انتهت مهلة الاتصال بـ YouTube. حاول مرة أخرى."
      });
    }

    return res.status(500).json({
      error:
        "حدث خطأ غير متوقع أثناء جلب التعليقات."
    });
  }
}
