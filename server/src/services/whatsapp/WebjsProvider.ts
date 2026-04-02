// ═════════════════════════════════════════════════════════════════════════════
// WebjsProvider — Free WhatsApp Web.js provider for development/testing
//
// Uses whatsapp-web.js (headless Chromium) to connect via QR code scan.
// Admin scans QR in admin panel → WhatsApp Web session established.
// NOT for production — use MetaProvider for production deployments.
// ═════════════════════════════════════════════════════════════════════════════

import { IWhatsAppProvider, SendMessageParams, SendResult, ConnectionStatus, TestResult } from './IWhatsAppProvider';
import prisma from '../../db/prisma';
import createLogger from '../../utils/logger';

const log = createLogger('whatsapp:webjs');

// Per-tenant state (in-memory — lost on restart, reconnects via saved session)
const clients = new Map<string, any>();           // whatsapp-web.js Client instances
const qrCodes = new Map<string, string>();        // base64 QR images
const statusMap = new Map<string, string>();       // connection status

export class WebjsProvider implements IWhatsAppProvider {

  async initialize(clientNumber: string): Promise<void> {
    // Clean up any stale client before reinitializing
    if (clients.has(clientNumber)) {
      const oldClient = clients.get(clientNumber);
      try {
        await oldClient.destroy();
      } catch {
        // If destroy fails, try to kill the browser process directly
        try { const browser = await oldClient.pupBrowser; if (browser) await browser.close(); } catch {}
      }
      clients.delete(clientNumber);
      statusMap.delete(clientNumber);
      qrCodes.delete(clientNumber);
    }

    // Dynamic import — whatsapp-web.js is optional dependency (not in devDependencies)
    let Client: any, LocalAuth: any, QRCode: any;
    try {
      // @ts-ignore — optional dependency, may not be installed
      const wwebjs = await import('whatsapp-web.js' as string);
      Client = wwebjs.Client || wwebjs.default?.Client;
      LocalAuth = wwebjs.LocalAuth || wwebjs.default?.LocalAuth;
      // @ts-ignore
      QRCode = await import('qrcode' as string);
    } catch {
      log.error('whatsapp-web.js or qrcode not installed. Run: npm install whatsapp-web.js qrcode');
      throw new Error('WhatsApp Web.js dependencies not installed');
    }

    const sessionPath = process.env.WHATSAPP_SESSION_PATH || './whatsapp-sessions';

    // Find Chrome/Chromium executable on the system
    const executablePath = process.env.CHROME_PATH
      || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/chromium-browser');

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: clientNumber, dataPath: sessionPath }),
      restartOnAuthFail: true,
      puppeteer: {
        headless: true,
        executablePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
               '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote',
               '--disable-gpu'],
      },
    });

    statusMap.set(clientNumber, 'connecting');
    clients.set(clientNumber, client);

    client.on('qr', async (qr: string) => {
      try {
        const qrImage = await QRCode.toDataURL(qr);
        qrCodes.set(clientNumber, qrImage);
        await prisma.$executeRawUnsafe(
          `UPDATE whatsapp_config SET qr_code = $1, qr_expires_at = $2, status = 'connecting' WHERE client_number = $3`,
          qrImage, new Date(Date.now() + 60_000), clientNumber,
        );
      } catch (e: any) { log.error('QR save failed', { error: e.message }); }
    });

    client.on('ready', async () => {
      statusMap.set(clientNumber, 'connected');
      qrCodes.delete(clientNumber);
      const number = '+' + client.info.wid.user;
      await prisma.$executeRawUnsafe(
        `UPDATE whatsapp_config SET status = 'connected', connected_number = $1, connected_at = NOW(), qr_code = NULL, qr_expires_at = NULL, last_error = NULL WHERE client_number = $2`,
        number, clientNumber,
      );
      log.info('Connected', { clientNumber, number });
    });

    client.on('message', async (message: any) => {
      if (message.fromMe) return;

      const rawFrom = message.from || '';

      // Skip non-chat messages: status broadcasts, groups, newsletters
      if (rawFrom === 'status@broadcast' || rawFrom.includes('@g.us') || rawFrom.includes('@newsletter')) {
        return;
      }

      // Skip empty messages — BUT allow voice/audio messages (they have no body)
      const isVoice = message.type === 'ptt' || message.type === 'audio';
      if (!isVoice && (!message.body || !message.body.trim())) return;

      log.info('Raw message event', { from: rawFrom, body: (message.body || '').slice(0, 50), type: message.type, hasMedia: message.hasMedia });

      try {
        // Extract real phone number — handle both @c.us and @lid formats
        let fromNumber = '';

        if (rawFrom.includes('@c.us')) {
          // Standard format: 923226288256@c.us → +923226288256
          fromNumber = '+' + rawFrom.replace('@c.us', '');
        } else if (rawFrom.includes('@lid')) {
          // LID format: doesn't contain phone number directly
          // Try to get it from the contact info
          try {
            const contact = await message.getContact();
            const contactNumber = contact?.number || contact?.id?.user || '';
            if (contactNumber && !contactNumber.includes('@')) {
              fromNumber = '+' + contactNumber;
            } else {
              // Fallback: try _data.notifyName or author
              fromNumber = '+' + rawFrom.replace('@lid', '');
            }
          } catch {
            fromNumber = '+' + rawFrom.replace('@lid', '');
          }
        } else {
          fromNumber = '+' + rawFrom.replace(/@.*$/, '');
        }

        log.info('Message received', { rawFrom, resolvedNumber: fromNumber });

        // React with ⏳ to show we're processing
        try { await message.react('⏳'); } catch {}

        // Handle voice messages — transcribe audio to text
        let messageBody = message.body || '';
        let messageType: 'text' | 'voice' | 'image' = 'text';
        let inputWasVoice = false;

        if (isVoice && message.hasMedia) {
          messageType = 'voice';
          inputWasVoice = true;
          try {
            const media = await message.downloadMedia();
            if (media?.data) {
              const audioBuffer = Buffer.from(media.data, 'base64');
              const { transcribeVoiceNote } = await import('../voiceService');
              const transcription = await transcribeVoiceNote(audioBuffer, media.mimetype);
              messageBody = transcription.text;
              log.info('Voice transcribed', { text: messageBody.slice(0, 80), lang: transcription.language });
            }
          } catch (e: any) {
            log.error('Voice transcription failed', { error: e.message });
            messageBody = '';
          }
          if (!messageBody) {
            const chat = await message.getChat();
            await chat.sendMessage('Sorry, I couldn\'t understand the voice note. Please try again or type your message.');
            try { await message.react(''); } catch {}
            return;
          }
        }

        const { handleInboundMessage } = await import('./WhatsAppInbound');
        await handleInboundMessage({
          clientNumber,
          fromNumber,
          messageBody,
          messageType,
          replyFn: async (text: string) => {
            const chat = await message.getChat();
            // If input was voice, reply with voice note too
            if (inputWasVoice) {
              try {
                const { textToVoiceNote } = await import('../voiceService');
                const audioBuffer = await textToVoiceNote(text);
                if (audioBuffer) {
                  // Send voice note
                  const { MessageMedia } = await import('whatsapp-web.js' as string);
                  const media = new MessageMedia('audio/ogg; codecs=opus', audioBuffer.toString('base64'));
                  await chat.sendMessage(media, { sendAudioAsVoice: true });
                  // Also send text version (for readability)
                  await chat.sendMessage(text);
                  return;
                }
              } catch (e: any) {
                log.error('Voice reply failed, sending text only', { error: e.message });
              }
            }
            await chat.sendMessage(text);
          },
          typingFn: async () => {
            try {
              const chat = await message.getChat();
              await chat.sendStateTyping();
            } catch {}
          },
        });

        // Remove ⏳ after all processing + replies are done
        try { await message.react(''); } catch {}
      } catch (e: any) {
        try { await message.react(''); } catch {} // remove even on error
        log.error('Inbound handler error', { error: e.message });
      }
    });

    // Also listen to message_create (newer whatsapp-web.js versions use this instead of message)
    // The dedup check in WhatsAppInbound prevents double-processing
    client.on('message_create', async (message: any) => {
      if (message.fromMe) return;
      const rawFrom = message.from || '';
      if (rawFrom === 'status@broadcast' || rawFrom.includes('@g.us') || rawFrom.includes('@newsletter')) return;
      if (!message.body || !message.body.trim()) return;

      log.info('message_create event', { from: rawFrom, body: (message.body || '').slice(0, 50) });

      try {
        let fromNumber = '';
        if (rawFrom.includes('@c.us')) {
          fromNumber = '+' + rawFrom.replace('@c.us', '');
        } else if (rawFrom.includes('@lid')) {
          try {
            const contact = await message.getContact();
            fromNumber = '+' + (contact?.number || contact?.id?.user || rawFrom.replace('@lid', ''));
          } catch { fromNumber = '+' + rawFrom.replace('@lid', ''); }
        } else {
          fromNumber = '+' + rawFrom.replace(/@.*$/, '');
        }

        const { handleInboundMessage } = await import('./WhatsAppInbound');
        await handleInboundMessage({
          clientNumber,
          fromNumber,
          messageBody: message.body,
          messageType: message.hasMedia ? 'image' : 'text',
          typingFn: async () => {
            try { const chat = await message.getChat(); await chat.sendStateTyping(); } catch {}
          },
          replyFn: async (text: string) => {
            const chat = await message.getChat();
            await chat.sendMessage(text);
          },
        });
        try { await message.react(''); } catch {}
      } catch (e: any) {
        try { await message.react(''); } catch {}
        log.error('message_create handler error', { error: e.message });
      }
    });

    client.on('disconnected', async (reason: string) => {
      statusMap.set(clientNumber, 'disconnected');
      clients.delete(clientNumber);
      await prisma.$executeRawUnsafe(
        `UPDATE whatsapp_config SET status = 'disconnected' WHERE client_number = $1`, clientNumber,
      );
      log.info('Disconnected', { clientNumber, reason });

      // Auto-reconnect after 10 seconds (if session data exists, no QR scan needed)
      if (reason !== 'LOGOUT') {
        log.info('Attempting auto-reconnect in 10s', { clientNumber });
        setTimeout(async () => {
          try {
            const self = new WebjsProvider();
            await self.initialize(clientNumber);
          } catch (e: any) {
            log.error('Auto-reconnect failed', { clientNumber, error: e.message });
          }
        }, 10_000);
      }
    });

    client.on('auth_failure', async (msg: string) => {
      statusMap.set(clientNumber, 'error');
      await prisma.$executeRawUnsafe(
        `UPDATE whatsapp_config SET status = 'error', last_error = $1, last_error_at = NOW() WHERE client_number = $2`,
        msg, clientNumber,
      );
    });

    await client.initialize();
  }

  async getQRCode(clientNumber: string): Promise<string | null> {
    return qrCodes.get(clientNumber) || null;
  }

  async testConnection(clientNumber: string): Promise<TestResult> {
    const client = clients.get(clientNumber);
    const status = statusMap.get(clientNumber);
    if (!client || status !== 'connected') {
      return { success: false, error: `Status: ${status || 'not initialized'}` };
    }
    return { success: true, connectedNumber: '+' + client.info.wid.user };
  }

  async sendMessage(params: SendMessageParams): Promise<SendResult> {
    const client = clients.get(params.clientNumber);
    if (!client || statusMap.get(params.clientNumber) !== 'connected') {
      return { success: false, error: 'WhatsApp not connected' };
    }
    try {
      const chatId = params.to.replace('+', '') + '@c.us';
      const msg = await client.sendMessage(chatId, params.message);
      return { success: true, messageId: msg.id.id };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async disconnect(clientNumber: string): Promise<void> {
    const client = clients.get(clientNumber);
    if (client) {
      try { await client.destroy(); } catch {}
      clients.delete(clientNumber);
      statusMap.delete(clientNumber);
      qrCodes.delete(clientNumber);
    }
    await prisma.$executeRawUnsafe(
      `UPDATE whatsapp_config SET status = 'disconnected', qr_code = NULL WHERE client_number = $1`, clientNumber,
    );
  }

  async getStatus(clientNumber: string): Promise<ConnectionStatus> {
    const status = (statusMap.get(clientNumber) || 'disconnected') as ConnectionStatus['status'];
    const client = clients.get(clientNumber);
    return {
      status,
      connectedNumber: status === 'connected' && client ? '+' + client.info?.wid?.user : undefined,
    };
  }
}
