export default async function handler(req, res) {
  const { videoId } = req.query;

  if (!videoId) {
    return res.status(400).json({ error: "معرف الفيديو مطلوب." });
  }

  try {
    // 1. تجاوز صفحة الموافقة الخاصة بيوتيوب والتي تعيق خوادم Vercel
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
        "Cookie": "CONSENT=YES+cb.20210328-17-p0.en+FX+478" // كود تخطي صفحة الموافقة
      }
    });
    
    const html = await pageRes.text();
    let captionTracks = [];
    
    // 2. الطريقة الأولى: البحث المباشر عن مسارات الترجمة
    const regex = /"captionTracks":\s*(\[.*?\])/;
    const match = html.match(regex);

    if (match && match[1]) {
      captionTracks = JSON.parse(match[1]);
    } else {
      // 3. الطريقة البديلة: البحث بعمق داخل كائن مشغل يوتيوب
      const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.*?\});/);
      if (playerMatch && playerMatch[1]) {
        const playerResponse = JSON.parse(playerMatch[1]);
        if (playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
          captionTracks = playerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
        }
      }
    }

    // إذا لم يتم العثور على أي ترجمة بعد الطريقتين
    if (!captionTracks || captionTracks.length === 0) {
      return res.status(404).json({ error: "خطأ: لا تتوفر ترجمة أو نص مكتوب (Captions/Transcript) لهذا الفيديو على يوتيوب." });
    }

    // 4. اختيار الترجمة (تفضيل العربية إن وجدت، وإلا جلب الترجمة الافتراضية)
    const track = captionTracks.find(t => t.languageCode.includes('ar')) || captionTracks[0];
    
    const transcriptRes = await fetch(track.baseUrl);
    if (!transcriptRes.ok) throw new Error("تعذر الاتصال بخادم النصوص");
    const transcriptXml = await transcriptRes.text();

    // 5. تنظيف النص المستخرج من أكواد XML
    const textSegments = transcriptXml.match(/<text[^>]*>(.*?)<\/text>/g);
    if (!textSegments) {
      return res.status(404).json({ error: "تعذر قراءة نصوص الترجمة." });
    }

    const cleanText = textSegments
      .map(tag => {
        const content = tag.match(/<text[^>]*>(.*?)<\/text>/)[1];
        return content.replace(/&amp;/g, '&')
                      .replace(/&#39;/g, "'")
                      .replace(/&quot;/g, '"')
                      .replace(/<[^>]+>/g, '') // إزالة أي وسوم HTML داخلية
                      .trim();
      })
      .join(' ')
      .replace(/\s+/g, ' ');

    return res.status(200).json({ transcript: cleanText });

  } catch (error) {
    return res.status(500).json({ error: "حدث خطأ غير متوقع. قد تكون حماية يوتيوب منعت الطلب مؤقتاً." });
  }
}
