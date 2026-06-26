module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error('OPENAI_API_KEY is missing');
    }

    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'gpt-5.5',
        input: prompt,
        max_output_tokens: 1000
      })
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      console.error('IWAG ORACLE OPENAI ERROR:', data);
      return res.status(upstream.status).json({
        error: data?.error?.message || 'Oracle request failed'
      });
    }

    const text =
      data.output_text ||
      data.output?.flatMap(o => o.content || [])
        ?.map(c => c.text || '')
        ?.join('')
        ?.trim();

    if (!text) {
      console.error('IWAG ORACLE EMPTY OPENAI RESPONSE:', data);
      return res.status(500).json({ error: 'Oracle returned an empty response' });
    }

    return res.status(200).json({
      content: [
        {
          text
        }
      ]
    });
  } catch (err) {
    console.error('IWAG ORACLE FAILED:', err);
    return res.status(500).json({ error: err.message || 'Oracle failed' });
  }
};
