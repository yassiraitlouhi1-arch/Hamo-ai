// Vercel Serverless Function: /api/image  (إنشاء الصور)
// افتراضياً: Pollinations بلا مفتاح.
// اختياري (أفضل وأضمن): Cloudflare Workers AI. زيد متغيرين فـ Vercel:
//   CF_ACCOUNT_ID  و  CF_API_TOKEN
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyDlbSV7mwqRl3Ud2QfzAqNeguT2pD4_bZw';

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

// ترجمة الوصف للإنجليزية بـ Gemini (نماذج الصور كتفهم الإنجليزية أحسن بزاف)
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
          { role: 'system', content: 'Translate the user text into a short, vivid English prompt for an image generator. Output only the prompt, nothing else.' },
          { role: 'user', content: prompt }
        ]
      })
    });
    const data = await r.json();
    const t = r.ok && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return (t && t.trim()) || prompt;
  } catch (e) { return prompt; }
}

async function viaCloudflare(prompt) {
  const r = await fetch('https://api.cloudflare.com/client/v4/accounts/' + process.env.CF_ACCOUNT_ID + '/ai/run/@cf/black-forest-labs/flux-1-schnell', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + process.env.CF_API_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, steps: 4 })
  });
  const data = await r.json();
  if (!r.ok || !data.result || !data.result.image) {
    throw new Error((data.errors && data.errors[0] && data.errors[0].message) || 'Cloudflare error');
  }
  return 'data:image/jpeg;base64,' + data.result.image;
}

// تعديل صورة موجودة (img2img) بـ Stable Diffusion 1.5 على Cloudflare
async function viaImg2Img(prompt, dataUrl, strength, width, height) {
  const r = await fetch('https://api.cloudflare.com/client/v4/accounts/' + process.env.CF_ACCOUNT_ID + '/ai/run/@cf/runwayml/stable-diffusion-v1-5-img2img', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + process.env.CF_API_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, image_b64: dataUrl.split(',')[1], strength, num_steps: 20, guidance: 7.5, width, height })
  });
  const type = r.headers.get('content-type') || '';
  if (r.ok && type.startsWith('image/')) {
    return 'data:' + type + ';base64,' + Buffer.from(await r.arrayBuffer()).toString('base64');
  }
  const data = await r.json().catch(() => ({}));
  if (r.ok && data.result && data.result.image) return 'data:image/png;base64,' + data.result.image;
  throw new Error((data.errors && data.errors[0] && data.errors[0].message) || 'Cloudflare img2img error ' + r.status);
}

async function viaPollinations(prompt) {
  const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt) + '?width=1024&height=1024&nologo=true&model=flux';
  const r = await fetch(url);
  if (r.status === 402) throw new Error('Pollinations صار كيطلب الدفع. فعّل Cloudflare (CF_ACCOUNT_ID و CF_API_TOKEN).');
  if (!r.ok) throw new Error('Pollinations error ' + r.status);
  const type = r.headers.get('content-type') || 'image/jpeg';
  if (!type.startsWith('image/')) throw new Error('Pollinations لم يرجع صورة');
  const buf = Buffer.from(await r.arrayBuffer());
  return 'data:' + type + ';base64,' + buf.toString('base64');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
  try {
    if (!(await verifyUser(req))) return res.status(401).json({ message: 'غير مصرح' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const prompt = String(body.prompt || '').trim().slice(0, 500);
    if (!prompt) return res.status(400).json({ message: 'اكتب وصف الصورة' });
    const useCF = process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN;
    if (typeof body.image === 'string') {
      if (!useCF) return res.status(400).json({ message: 'تعديل الصور يتطلب إعداد Cloudflare' });
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(body.image) || body.image.length > 2000000) {
        return res.status(400).json({ message: 'الصورة كبيرة أو غير مدعومة' });
      }
      const snap = v => Math.min(1024, Math.max(256, Math.round((Number(v) || 512) / 8) * 8));
      const strength = Math.min(1, Math.max(0.1, Number(body.strength) || 0.6));
      const img = await viaImg2Img(await toEnglish(prompt), body.image, strength, snap(body.width), snap(body.height));
      return res.status(200).json({ image: img });
    }
    const en = await toEnglish(prompt);
    const image = useCF ? await viaCloudflare(en) : await viaPollinations(en);
    return res.status(200).json({ image });
  } catch (e) {
    return res.status(502).json({ message: String(e.message || e) });
  }
};
module.exports.config = { maxDuration: 60 };
