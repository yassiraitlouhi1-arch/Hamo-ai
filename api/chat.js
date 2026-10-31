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

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
  try {
    if (!(await verifyUser(req))) return res.status(401).json({ message: 'غير مصرح' });
    if (!process.env.HF_TOKEN) return res.status(500).json({ message: 'HF_TOKEN غير مضبوط' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const history = Array.isArray(body.messages) ? body.messages.slice(-20) : [{ role: 'user', content: String(body.prompt || '') }];
    const messages = [
      { role: 'system', content: 'أنت HAMO-AI، مساعد ذكي ودود. أجب بلغة المستخدم.' },
      ...history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) }))
    ];

    const r = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.HF_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.HF_MODEL || 'meta-llama/Llama-3.1-8B-Instruct', messages, max_tokens: 800 })
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ message: (data.error && data.error.message) || data.error || 'خطأ من المزود' });
    const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return res.status(200).json({ reply });
  } catch (e) {
    return res.status(500).json({ message: String(e.message || e) });
  }
};
