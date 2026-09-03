export default async function handler(req, res) {
  const { videoId } = req.query;

  if (!videoId) {
    return res.status(400).json({ error: "معرف الفيديو مطلوب." });
  }

  // قائمة خوادم Piped المفتوحة لتجاوز حظر يوتيوب على خوادم Vercel
  const instances = [
    "https://pipedapi.kavin.rocks",
    "https://piped-api.garudalinux.org",
    "https://api-piped.mha.fi",
    "https://pipedapi.smnz.de"
  ];

  let subtitles = null;

  try {
    // 1. البحث عن الترجمات عبر الخوادم الوسيطة لتفادي الحظر
    for (const instance of instances) {
      try {
        // نضع مهلة للاتصال حتى ننتقل للخادم التالي إذا كان الحالي بطيئاً
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        
        const r = await fetch(`${instance}/streams/${videoId}`, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!r.ok) continue;
        
        const data = await r.json();
        if (data.subtitles && data.subtitles.length > 0) {
          subtitles = data.subtitles;
          break; // وجدنا الترجمات بنجاح، نخرج من الحلقة
        }
      } catch (e) {
        continue; // تجربة الخادم التالي
      }
    }

    if (!subtitles) {
      return res.status(404).json({ error: "خطأ: لا تتوفر ترجمة لهذا الفيديو، أو أنه لا يحتوي على نص مفرّغ." });
    }

    // 2. اختيار اللغة: العربية أولاً، ثم الإنجليزية، ثم أي لغة متوفرة
    let track = subtitles.find(s => s.code === 'ar' || (s.name && s.name.toLowerCase().includes('arab')))
             || subtitles.find(s => s.code === 'en' || (s.name && s.name.toLowerCase().includes('english')))
             || subtitles[0];

    // 3. جلب ملف الترجمة الفعلي بصيغة VTT
    let trackUrl = track.url;
    if (!trackUrl.includes('fmt=')) trackUrl += '&fmt=vtt';
    
    const trackRes = await fetch(trackUrl);
    if (!trackRes.ok) throw new Error("فشل في قراءة ملف الترجمة");
    
    const trackText = await trackRes.text();

    // 4. تنظيف النص المستخرج من أكواد التوقيت (VTT Cleanup)
    let cleanText = trackText
        .split('\n')
        .filter(line => 
            !line.includes('-->') && 
            !line.startsWith('WEBVTT') && 
            !line.startsWith('Kind:') && 
            !line.startsWith('Language:') && 
            !line.startsWith('Style:') && 
            line.trim() !== ''
        )
        .map(line => {
            // تنظيف رموز HTML والشفرات
            return line.replace(/<[^>]+>/g, '')
                       .replace(/&amp;/g, '&')
                       .replace(/&#39;/g, "'")
                       .replace(/&quot;/g, '"')
                       .trim();
        })
        .join(' ')
        .replace(/\s+/g, ' '); // إزالة المسافات الزائدة

    return res.status(200).json({ transcript: cleanText, lang: track.name });

  } catch (error) {
    return res.status(500).json({ error: "حدث خطأ غير متوقع أثناء معالجة النص." });
  }
}
