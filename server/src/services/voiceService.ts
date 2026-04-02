// ═════════════════════════════════════════════════════════════════════════════
// voiceService.ts — Speech-to-Text and Text-to-Speech for WhatsApp voice notes
//
// Inbound: Voice note → Google Speech-to-Text → text (for processing)
// Outbound: Text response → Google Text-to-Speech → voice note (OGG/Opus)
//
// Supports: Urdu, English, mixed (auto-detect)
// ═════════════════════════════════════════════════════════════════════════════

import createLogger from '../utils/logger';

const log = createLogger('voice');

// ─── Speech-to-Text: transcribe voice note to text ────────────────────────────

export async function transcribeVoiceNote(audioBuffer: Buffer, mimeType?: string): Promise<{
  text: string;
  language: string;
  confidence: number;
}> {
  // Try Gemini first (always available, supports Urdu + English + mixed)
  try {
    const geminiResult = await transcribeWithGemini(audioBuffer);
    if (geminiResult.text) return geminiResult;
  } catch (e: any) {
    log.error('Gemini transcription failed, trying Google Speech', { error: e.message });
  }

  // Fallback to Google Cloud Speech-to-Text
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return { text: '', language: 'unknown', confidence: 0 };
  }

  try {
    const speech = await import('@google-cloud/speech');
    const client = new speech.SpeechClient();

    const audio = { content: audioBuffer.toString('base64') };

    // Auto-detect language: try Urdu first, fallback to English, or use multi-language
    const config = {
      encoding: 'OGG_OPUS' as any,
      sampleRateHertz: 16000,
      languageCode: 'ur-PK',               // Primary: Urdu
      alternativeLanguageCodes: ['en-US', 'en-PK', 'hi-IN'], // Fallback: English, Hindi
      enableAutomaticPunctuation: true,
      model: 'default',
    };

    const [response] = await client.recognize({ audio, config });
    const results = response.results || [];

    if (results.length === 0) {
      log.info('No speech detected in voice note');
      return { text: '', language: 'unknown', confidence: 0 };
    }

    const best = results[0]?.alternatives?.[0];
    const text = best?.transcript || '';
    const confidence = best?.confidence || 0;
    const detectedLang = results[0]?.languageCode || 'ur-PK';

    log.info('Voice transcribed', { textLen: text.length, language: detectedLang, confidence });
    return { text, language: detectedLang, confidence };
  } catch (error: any) {
    log.error('Google Speech transcription also failed', { error: error.message });
    return { text: '', language: 'unknown', confidence: 0 };
  }
}

// ─── Fallback: Gemini audio transcription ─────────────────────────────────────

async function transcribeWithGemini(audioBuffer: Buffer): Promise<{ text: string; language: string; confidence: number }> {
  const { getGenAI } = await import('./genaiClient');
  const ai = getGenAI();

  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        role: 'user',
        parts: [
          { text: 'Transcribe this audio. Return ONLY the text, nothing else. If Urdu, write in Urdu script. If English, write in English. If mixed, keep both.' },
          { inlineData: { mimeType: 'audio/ogg', data: audioBuffer.toString('base64') } },
        ],
      },
    ],
    config: { maxOutputTokens: 500 },
  });

  const text = (result.text ?? '').trim();
  const isUrdu = /[\u0600-\u06FF]/.test(text);
  return { text, language: isUrdu ? 'ur-PK' : 'en-US', confidence: 0.8 };
}

// ─── Text-to-Speech: convert text to voice note ───────────────────────────────

export async function textToVoiceNote(text: string, language?: string): Promise<Buffer | null> {
  // Skip if text is too short or too long for voice
  if (!text || text.length < 5 || text.length > 3000) return null;

  // Try Google Cloud TTS first (requires GOOGLE_APPLICATION_CREDENTIALS)
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      const tts = await import('@google-cloud/text-to-speech');
      const client = new tts.TextToSpeechClient();

      const isUrdu = /[\u0600-\u06FF]/.test(text) || language === 'ur-PK';
      const voiceConfig = isUrdu
        ? { languageCode: 'ur-PK', name: 'ur-PK-Standard-A', ssmlGender: 'FEMALE' as any }
        : { languageCode: 'en-US', name: 'en-US-Neural2-F', ssmlGender: 'FEMALE' as any };

      const [response] = await client.synthesizeSpeech({
        input: { text },
        voice: voiceConfig,
        audioConfig: { audioEncoding: 'OGG_OPUS' as any, speakingRate: 1.0, pitch: 0 },
      });

      if (response.audioContent) {
        const buffer = Buffer.from(response.audioContent as Uint8Array);
        log.info('Voice note generated (Google TTS)', { textLen: text.length, audioLen: buffer.length });
        return buffer;
      }
    } catch (error: any) {
      log.error('Google TTS failed', { error: error.message });
    }
  }

  // No Google Cloud credentials — voice reply not available
  // Return null, caller will send text-only response
  log.info('TTS not available (no GOOGLE_APPLICATION_CREDENTIALS). Sending text only.');
  return null;
}

// ─── Detect language of text ──────────────────────────────────────────────────

export function detectLanguage(text: string): 'urdu' | 'english' | 'mixed' {
  const hasUrdu = /[\u0600-\u06FF]/.test(text);
  const hasEnglish = /[a-zA-Z]{3,}/.test(text);
  if (hasUrdu && hasEnglish) return 'mixed';
  if (hasUrdu) return 'urdu';
  return 'english';
}
