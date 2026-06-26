module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error('ANTHROPIC_API_KEY is missing');
    }

    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      console.error('IWAG ORACLE ANTHROPIC ERROR:', data);
      return res.status(upstream.status).json({
        error: data?.error?.message || 'Oracle request failed'
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('IWAG ORACLE FAILED:', err);
    return res.status(500).json({ error: err.message || 'Oracle failed' });
  }
};
