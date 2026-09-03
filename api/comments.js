export default async function handler(req, res) {
  // جلب المفتاح بأمان من متغيرات البيئة في Vercel
  const apiKey = process.env.YOUTUBE_API_KEY;
  const { videoId } = req.query;

  if (!apiKey) {
    return res.status(500).json({ error: "مفتاح API غير مضبوط في إعدادات Vercel." });
  }

  if (!videoId) {
    return res.status(400).json({ error: "معرف الفيديو مطلوب." });
  }

  try {
    let allComments = [];
    let nextPageToken = "";

    // جلب التعليقات حتى 300 تعليق كحد أقصى لتفادي استهلاك الحصة
    do {
      const apiUrl = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=100&pageToken=${nextPageToken}&key=${apiKey}`;
      const response = await fetch(apiUrl);
      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: data.error?.message || "خطأ من YouTube API" });
      }

      if (data.items) {
        for (const item of data.items) {
          const s = item.snippet.topLevelComment.snippet;
          allComments.push({
            id: s.authorChannelId ? s.authorChannelId.value : s.authorDisplayName,
            name: s.authorDisplayName,
            avatar: s.authorProfileImageUrl,
            text: s.textDisplay
          });
        }
      }

      nextPageToken = data.nextPageToken || "";
    } while (nextPageToken && allComments.length < 300);

    return res.status(200).json({ comments: allComments });
  } catch (error) {
    return res.status(500).json({ error: "حدث خطأ أثناء جلب التعليقات." });
  }
}
