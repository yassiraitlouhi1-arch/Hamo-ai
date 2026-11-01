// Vercel Serverless Function: /api/video  (توليد الفيديو عبر Magic Hour)
// متغير Vercel:  MAGIC_HOUR_API_KEY  (إجباري)
// اختياري: AI_KEY (للترجمة بـ Gemini)
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyDlbSV7mwqRl3Ud2QfzAqNeguT2pD4_bZw';
const API = 'https://api.magichour.ai';

async function verifyUser(req) {
  const m = (req.headers.authorization || '').match(/^Bearer (.+)$/);
  if (!m) return false;
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: m[1] })
  });
  return r.ok;
}

async function toEnglish(prompt) {
  if (!process.env.AI_KEY || !/[^\x00-\x7F]/.test(prompt)) return prompt;
  try {
    const base = (process.env.AI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/$/, '');
    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.AI_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'gemini-2.5-flash',
        max_tokens: 200,
        messages: [
          { role: 'system', content: 'Translate the user text into a short, vivid English prompt for a video generator. Output only the prompt, nothing else.' },
          { role: 'user', content: prompt }
        ]
      })
    });
    const data = await r.json();
    const t = r.ok && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return (t && t.trim()) || prompt;
  } catch (e) { return prompt; }
}

const msg = d => (d && (d.message || (d.error && (d.error.message || d.error)))) ? String(d.message || d.error.message || d.error).slice(0, 200) : '';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
  try {
    if (!(await verifyUser(req))) return res.status(401).json({ message: 'غير مصرح' });
    const KEY = process.env.MAGIC_HOUR_API_KEY;
    if (!KEY) return res.status(500).json({ message: 'MAGIC_HOUR_API_KEY غير مضبوط' });
    const H = { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' };
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    // متابعة حالة الفيديو
    if (body.poll) {
      const ref = String((body.poll && body.poll.status_url) || '');
      const id = ref.startsWith('mh:') ? ref.slice(3) : '';
      if (!/^[A-Za-z0-9_-]{5,64}$/.test(id)) return res.status(400).json({ message: 'معرّف غير صالح' });
      const r = await fetch(API + '/v1/video-projects/' + id, { headers: H });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(502).json({ message: msg(d) || ('خطأ من Magic Hour (' + r.status + ')') });
      if (d.status === 'complete') {
        const url = d.downloads && d.downloads[0] && d.downloads[0].url;
        if (!url) return res.status(502).json({ message: 'الفيديو جاهز ولكن بلا رابط' });
        return res.status(200).json({ videoUrl: url });
      }
      if (d.status === 'error' || d.status === 'canceled') {
        return res.status(502).json({ message: msg(d.error) || ('فشل التوليد (' + d.status + ')') });
      }
      return res.status(200).json({ status: d.status || 'rendering' });
    }

    // إنشاء فيديو جديد
    const prompt = String(body.prompt || '').trim().slice(0, 500);
    if (!prompt) return res.status(400).json({ message: 'اكتب وصف الفيديو' });
    const aspect = ['16:9', '9:16', '1:1'].includes(body.aspectRatio) ? body.aspectRatio : '9:16';
    const r = await fetch(API + '/v1/text-to-video', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ end_seconds: 5, aspect_ratio: aspect, style: { prompt: await toEnglish(prompt) }, name: 'HAMO-AI' })
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 402) return res.status(402).json({ message: 'الرصيد ديال Magic Hour سالا. جرب من بعد أو عمّر الرصيد.' });
    if (!r.ok || !d.id) return res.status(502).json({ message: msg(d) || ('خطأ من Magic Hour (' + r.status + ')') });
    return res.status(200).json({ status_url: 'mh:' + d.id, response_url: 'mh:' + d.id });
  } catch (e) {
    return res.status(502).json({ message: String(e.message || e) });
  }
};
