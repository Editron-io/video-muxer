import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

// Formatting function ensuring parameters fit Microsoft's format requirements (+0%, -10%, etc.)
function percent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '+0%';
  const snapped = Math.max(-100, Math.min(200, Math.round(n)));
  return `${snapped >= 0 ? '+' : ''}${snapped}%`;
}

function pitch(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '+0Hz';
  return `${n >= 0 ? '+' : ''}${Math.max(-100, Math.min(100, Math.round(n)))}Hz`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let tts;
  try {
    const body = req.body || {};
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const voice = typeof body.voice === 'string' ? body.voice.trim() : '';

    if (!text || !voice) {
      return res.status(400).json({ error: 'Text and Voice parameters are required.' });
    }

    const rate = percent(body.rate ?? 0);
    const voicePitch = pitch(body.pitch ?? 0);

    // Initializing the MS Edge WebSockets API wrapper
    tts = new MsEdgeTTS({ enableLogger: false });

    await tts.setMetadata(
      voice,
      OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
      { wordBoundaryEnabled: false, sentenceBoundaryEnabled: false }
    );

    // Stream generation handles
    const { audioStream } = tts.toStream(text, {
      rate: rate,
      pitch: voicePitch,
      volume: '+0%' // 🔧 FIXED: Changed from literal 0 to string format to fix the stalling bug
    });

    // Write audio configurations instantly to client
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store, no-transform');

    // 🏎️ SPEED FIX: Removed collectStream loop entirely.
    // Instead, chunk data streams right back to the user instantly.
    return new Promise((resolve) => {
      audioStream.pipe(res);

      audioStream.on('end', () => {
        try { tts.close(); } catch {}
        resolve();
      });

      audioStream.on('error', (error) => {
        console.error('Streaming pipeline encountered an error:', error);
        try { tts.close(); } catch {}
        if (!res.headersSent) {
          res.status(502).json({ error: 'Audio processing execution failed mid-transit.' });
        }
        resolve();
      });
    });

  } catch (error) {
    console.error('Edge Neural TTS initialization failure:', error);
    if (tts) { try { tts.close(); } catch {} }
    
    if (!res.headersSent) {
      return res.status(502).json({
        error: 'Microsoft Edge Neural TTS initialization failed.',
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
