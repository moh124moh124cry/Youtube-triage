export default async function handler(req, res) {
  const { videoId } = req.query;

  if (!videoId) {
    return res.status(400).json({ error: "معرف الفيديو مطلوب." });
  }

  try {
    // جلب صفحة الفيديو لاستخراج مسار الترجمة المدمج في يوتيوب
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    const html = await pageRes.text();

    // البحث عن كائن الترجمة داخل كود الصفحة
    const regex = /"captionTracks":(\[.*?\])/;
    const match = html.match(regex);

    if (!match || !match[1]) {
      return res.status(404).json({ error: "لا تتوفر ترجمة أو نص مكتوب (Captions/Transcript) لهذا الفيديو على يوتيوب." });
    }

    const captionTracks = JSON.parse(match[1]);
    if (!captionTracks.length) {
      return res.status(404).json({ error: "لم يتم العثور على مسارات ترجمة صالحة." });
    }

    // جلب أول مسار ترجمة (تلقائي أو مضاف) بصيغة XML
    const transcriptUrl = captionTracks[0].baseUrl;
    const transcriptRes = await fetch(transcriptUrl);
    const transcriptXml = await transcriptRes.text();

    // تنظيف نص الـ XML وتحويله إلى نص عادي مرتب
    const textSegments = transcriptXml.match(/<text[^>]*>(.*?)<\/text>/g);
    if (!textSegments) {
      return res.status(404).json({ error: "تعذر قراءة نصوص الترجمة." });
    }

    const cleanText = textSegments
      .map(tag => tag.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    return res.status(200).json({ transcript: cleanText });
  } catch (error) {
    return res.status(500).json({ error: "حدث خطأ أثناء معالجة نصوص الفيديو." });
  }
}
