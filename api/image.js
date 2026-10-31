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

async function viaPollinations(prompt) {
  const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt) + '?width=1024&height=1024&nologo=true&model=flux';
  const r = await fetch(url);
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
    const image = useCF ? await viaCloudflare(prompt) : await viaPollinations(prompt);
    return res.status(200).json({ image });
  } catch (e) {
    return res.status(502).json({ message: String(e.message || e) });
  }
};
module.exports.config = { maxDuration: 60 };
