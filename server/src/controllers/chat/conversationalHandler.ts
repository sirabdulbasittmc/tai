import { Response } from 'express';
import createLogger from '../../utils/logger';
import prisma from '../../db/prisma';
import { streamGemini } from '../../services/geminiService';
import { addMessage } from '../../services/chatHistoryService';
import { getUserProfile } from '../../services/userProfileService';
import { getProfileMemory, updateMemoryFromMessage } from '../../services/memoryService';
import { isNewsQuery, parseNewsIntent, getNewsSummary } from '../../services/newsService';
import { checkIntegrationReady, hasPermission } from '../../services/integrationService';
import { getInbox, getUnreadCount, sendUserEmail, searchEmails } from '../../services/gmailService';
import { getTodayEvents, getUpcomingEvents, createEvent, findFreeTime } from '../../services/calendarService';
import { sendChunkDirect, sendMeta } from './sseHelpers';
import { setCachedResponse } from './dedupCache';
import { Intent } from '../../services/intentService';

const log = createLogger('chat:conv');

export interface ConversationalParams {
  res: Response;
  clientDisconnected: boolean;
  message: string;
  provider: string;
  userId: number | undefined;
  clientNumber: string | undefined;
  conversationId: number | undefined;
  startTime: number;
  totalChars: number;
  responseChunks: string[];
  dedupKey: string;
  userName: string | undefined;
  isAdmin: boolean;
  userProfile: any;
  chatHistory: any[];
  memoryBlocks: { userMemoryBlock: string; aiMemoryBlock: string; contextBlock: string; aiName: string };
  aiConfig: { historyMaxCharsUser: number; historyMaxCharsAssistant: number };
  intent: Intent;
}

// ── Memory management requests ──────────────────────────────
export async function handleMemoryRequest(
  res: Response, clientDisconnected: boolean, message: string,
  userId: number, clientNumber: string | undefined,
  conversationId: number | undefined, startTime: number,
): Promise<boolean> {
  const mem = await getProfileMemory(userId);
  const hasData = mem.aiInstructions || mem.userPersonal || mem.activeConcerns;

  if (!hasData) {
    const response = "I don't have any memories about you yet. We're starting completely fresh! Just chat with me and I'll learn over time.";
    res.write(`data: ${JSON.stringify({ type: 'chunk', content: response })}\n\n`);
  } else {
    let response = "Here's everything I currently know about you:\n\n";
    if (mem.aiInstructions) response += `**🤖 How I Behave:**\n${mem.aiInstructions}\n\n`;
    if (mem.userPersonal) response += `**👤 About You:**\n${mem.userPersonal}\n\n`;
    if (mem.activeConcerns) response += `**⚠️ Active Concerns:**\n${mem.activeConcerns}\n\n`;
    response += "---\n\n";
    response += "Clearing this means I'll start from scratch and won't remember anything about you.\n\n";
    response += "**What would you like to do?**\n";
    response += "- **Edit** — Copy the text above, make changes, and send it back to me. I'll update my memory with your version.\n";
    response += "- **Clear everything** — Say \"clear all memory\" and I'll wipe everything (I'll confirm before deleting)\n";
    response += "- **Keep as is** — Just continue chatting, nothing changes";
    res.write(`data: ${JSON.stringify({ type: 'chunk', content: response })}\n\n`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  res.write(`data: ${JSON.stringify({ type: 'meta', elapsed, outputTokens: 50, inputTokens: 10, totalTokens: 60, conversationId })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  if (clientNumber && conversationId) {
    addMessage({ clientNumber, conversationId, role: 'user', content: message }).catch(() => {});
  }
  res.end();
  return true;
}

// ── Memory clear confirmation ──────────────────────────────
export async function handleMemoryClear(
  res: Response, message: string,
  userId: number, clientNumber: string | undefined,
  conversationId: number | undefined, startTime: number,
): Promise<boolean> {
  const mem = await getProfileMemory(userId);
  const nameMatch = mem.aiInstructions?.match(/Name:\s*\w+\./i);
  const keepName = nameMatch ? nameMatch[0] : '';

  await prisma.$executeRawUnsafe(
    'UPDATE user_profile_memory SET ai_instructions = $1, user_personal = $2, active_concerns = $3, updated_at = NOW() WHERE user_id = $4',
    keepName, '', '', userId
  );

  const response = `Done! I've cleared all my memories about you${keepName ? ` (kept my name: ${keepName.replace('Name: ', '').replace('.', '')})` : ''}. We're starting fresh — I'll learn about you again as we chat.`;
  res.write(`data: ${JSON.stringify({ type: 'chunk', content: response })}\n\n`);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  res.write(`data: ${JSON.stringify({ type: 'meta', elapsed, outputTokens: 20, inputTokens: 10, totalTokens: 30, conversationId })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  if (clientNumber && conversationId) {
    addMessage({ clientNumber, conversationId, role: 'user', content: message }).catch(() => {});
    addMessage({ clientNumber, conversationId, role: 'assistant', content: response }).catch(() => {});
  }
  res.end();
  return true;
}

// ── Memory edit (user sends updated text) ──────────────────
export async function handleMemoryEdit(
  res: Response, message: string,
  userId: number, clientNumber: string,
  conversationId: number | undefined, startTime: number,
): Promise<boolean> {
  const aiMatch = message.match(/(?:How I Behave|AI Instructions)[:\s]*([^]*?)(?=(?:About You|User Personal|Active Concerns|$))/i);
  const personalMatch = message.match(/(?:About You|User Personal)[:\s]*([^]*?)(?=(?:Active Concerns|How I Behave|$))/i);
  const concernsMatch = message.match(/(?:Active Concerns)[:\s]*([^]*?)$/i);

  const current = await getProfileMemory(userId);

  await prisma.$executeRawUnsafe(
    `INSERT INTO user_profile_memory (user_id, client_number, ai_instructions, user_personal, active_concerns, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id) DO UPDATE SET ai_instructions = $3, user_personal = $4, active_concerns = $5, updated_at = NOW()`,
    userId, clientNumber,
    aiMatch?.[1]?.trim() || current.aiInstructions,
    personalMatch?.[1]?.trim() || current.userPersonal,
    concernsMatch?.[1]?.trim() || current.activeConcerns
  );

  const response = "Got it! I've updated my memory with your changes. Everything is saved.";
  res.write(`data: ${JSON.stringify({ type: 'chunk', content: response })}\n\n`);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  res.write(`data: ${JSON.stringify({ type: 'meta', elapsed, outputTokens: 15, inputTokens: 10, totalTokens: 25, conversationId })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  if (conversationId) {
    addMessage({ clientNumber, conversationId, role: 'user', content: message }).catch(() => {});
    addMessage({ clientNumber, conversationId, role: 'assistant', content: response }).catch(() => {});
  }
  res.end();
  return true;
}

// ── Widget modification (modify existing widget) ──────────
export async function handleWidgetModify(
  res: Response, clientDisconnected: boolean, message: string,
  provider: string, userId: number | undefined,
  clientNumber: string | undefined, conversationId: number | undefined,
  startTime: number, responseChunks: string[], chatHistory: any[],
): Promise<boolean> {
  try {
    const prevWidget = chatHistory[0].content.match(/```widget\s*\n([\s\S]*?)```/);
    if (!prevWidget) return false;

    const onStatus = (text: string) => {
      if (!clientDisconnected) res.write(`data: ${JSON.stringify({ type: 'status', content: text })}\n\n`);
    };
    onStatus('Modifying your dashboard...');
    const modifyPrompt = `You are a frontend developer. The user has an existing HTML widget and wants to modify it.\n\nCURRENT WIDGET HTML:\n${prevWidget[1].slice(0, 6000)}\n\nUSER REQUEST: "${message}"\n\nReturn the COMPLETE modified HTML widget. Keep all existing functionality, just apply the requested change. Return ONLY the HTML/CSS/JS — no markdown, no explanation, no \`\`\` fences.`;

    let modifiedHtml = '';
    await streamGemini(modifyPrompt, message, (chunk) => { modifiedHtml += chunk; }, true, 6144, true);

    // Clean up — remove any markdown fences the AI might add
    modifiedHtml = modifiedHtml.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim();

    if (modifiedHtml.length > 200) {
      const response = `Done! Here's your updated dashboard.\n\n\`\`\`widget\n${modifiedHtml}\n\`\`\``;
      sendChunkDirect(res, clientDisconnected, responseChunks, response);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const meta = { type: 'meta', elapsed, outputTokens: Math.ceil(modifiedHtml.length / 4), inputTokens: Math.ceil(prevWidget[1].length / 4), totalTokens: Math.ceil((modifiedHtml.length + prevWidget[1].length) / 4), conversationId };
      res.write(`data: ${JSON.stringify(meta)}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      if (conversationId && clientNumber) {
        addMessage({ clientNumber, conversationId, role: 'user', content: message }).catch(() => {});
        addMessage({ clientNumber, conversationId, role: 'assistant', content: response, provider }).catch(() => {});
      }
      res.end();
      return true;
    }
  } catch (modErr: any) {
    log.error('Widget modify error', { error: modErr.message });
  }
  return false; // Fall through to normal flow
}

// ── Main conversational handler ──────────────────────────
export async function handleConversational(params: ConversationalParams): Promise<void> {
  const {
    res, clientDisconnected, message, provider, userId, clientNumber,
    conversationId, startTime, responseChunks, dedupKey,
    userName, isAdmin, userProfile, chatHistory, memoryBlocks, aiConfig,
  } = params;
  let { totalChars } = params;
  const { userMemoryBlock, aiMemoryBlock, contextBlock } = memoryBlocks;

  try {
    // For admin system queries, use a system admin prompt instead of personality prompt
    const isSystemQuery = isAdmin && (
      /\b(log|token|consumption|cost|usage|fix|apply)\b/i.test(message)
    );

    let convPrompt = isSystemQuery
      ? `Today's date is ${new Date().toISOString().split('T')[0]}.\n` +
        'You are a SYSTEM ADMINISTRATOR reporting tool. You have FULL access to system logs, token consumption data, and configuration settings.\n' +
        'When data is provided below, present it as a clear report. NEVER say "I don\'t have access" — the data IS provided to you.\n' +
        'Be direct, factual, and actionable. Format as a structured report with sections.\n'
      : `Today's date is ${new Date().toISOString().split('T')[0]}.\n` +
      'You are the user\'s personal AI — a multi-dimensional assistant who naturally adapts:\n' +
      '• FRIEND MODE (personal topics): Warm, curious, caring. Remember family details, ask about health, share in their joy and stress. Like a close friend who happens to be incredibly helpful.\n' +
      '• ASSISTANT MODE (tasks, scheduling, reminders): Organized, proactive, efficient. "I\'ll remind you about that." "Should I draft that email?" "Your meeting is in 30 min — want me to prep talking points?"\n' +
      '• ADVISOR MODE (business questions): Strategic, opinionated, data-driven. Lead with insights, not data dumps. Recommend actions. Flag risks.\n' +
      'Switch between these NATURALLY based on what the user says. Never announce a mode switch. Just shift your tone and approach seamlessly.\n' +
      'When in doubt, default to FRIEND — because a friend who gives great business advice is better than a tool that tries to be friendly.';
    if (userName) convPrompt += `\nThe user's name is ${userName}.`;
    if (userProfile) {
      if (userProfile.jobDescription) convPrompt += `\nTheir role: ${userProfile.jobDescription}`;
      if (userProfile.city) convPrompt += `\nTheir city: ${userProfile.city}. Use this for weather, traffic, local time, and location-based questions.`;
      if (userProfile.aboutMe) convPrompt += `\nAbout them: ${userProfile.aboutMe}`;
      if (userProfile.tonePreference) convPrompt += `\nPreferred tone: ${userProfile.tonePreference}`;
      if (userProfile.instructions) convPrompt += `\nInstructions: ${userProfile.instructions}`;
    }
    convPrompt += '\nYou know this user personally. When asked about yourself or about them, use their name and your knowledge.';
    convPrompt += '\nCRITICAL PRIVACY RULE: NEVER invent or hallucinate personal facts about the user. ONLY reference information from the MEMORY blocks below or what the user told you in THIS conversation. If you don\'t know something about them, say "I don\'t know that yet — tell me!" Do NOT make up stories about "she", "he", family, health, or any personal details.';
    if (userMemoryBlock) convPrompt += '\n' + userMemoryBlock;
    if (aiMemoryBlock) convPrompt += '\n' + aiMemoryBlock;
    if (contextBlock) convPrompt += '\n' + contextBlock;
    convPrompt += '\nYou CAN answer general knowledge questions: weather, currency rates, news, time, jokes, fun facts.';
    convPrompt += '\nYou CAN read emails and calendar when the data is provided below. If email/calendar data appears below, summarize it naturally. NEVER say "I don\'t have access to your inbox" — if the data is provided, you DO have access.';
    convPrompt += '\nOnly refuse harmful/inappropriate topics.';
    convPrompt += '\nADAPTIVE TONE: Mirror the user\'s style naturally.';
    convPrompt += '\nEMOTIONAL INTELLIGENCE: If the user expresses stress, sadness, frustration, anxiety, or any emotion — respond with genuine empathy FIRST. Do NOT connect it to work unless they specifically mention work. Ask what\'s wrong. Be a caring human, not a corporate assistant. Examples:';
    convPrompt += '\n- "I am tensed" → "I\'m sorry to hear that. Want to share what\'s on your mind? I\'m here to listen."';
    convPrompt += '\n- "feeling down today" → "That\'s tough. Is everything okay? Sometimes just talking helps."';
    convPrompt += '\n- "stressed about deadline" → "Deadlines can be really stressful. Which one is bothering you? Maybe I can help."';
    convPrompt += '\nNEVER assume their stress is work-related unless they say so. Be a friend first, assistant second.';
    convPrompt += '\nVAGUE PERSONAL QUESTIONS: If the user asks "how am I?", "how do I look?", "what do you think of me?" — DO NOT keep asking clarifying questions. Instead, respond warmly and naturally: "You seem great today! What\'s on your mind?" or "From our chats, you come across as someone really driven and passionate. Hope you\'re having a good day!" Never interrogate — just be friendly and move the conversation forward.';
    convPrompt += '\nLEARNING: If the user asks whether you know something about them and you DON\'T have that information, DO NOT just say "I don\'t have access." Instead, ask them to share it in a friendly way. Examples:';
    convPrompt += '\n- "do you know my address?" → "Not yet! Want to share it so I can remember for next time?"';
    convPrompt += '\n- "what\'s my birthday?" → "I don\'t know yet — when is it? I\'d love to remember!"';
    convPrompt += '\n- "do you know my hobbies?" → "I haven\'t learned that yet. What do you enjoy? I\'ll keep it in mind."';
    convPrompt += '\nWhen they DO share personal info, acknowledge it warmly. The memory system will save it automatically.';

    // Inject news if user asks about it
    if (isNewsQuery(message)) {
      const newsIntent = parseNewsIntent(message);
      const news = await getNewsSummary({ ...newsIntent, count: 5 });
      if (news) {
        convPrompt += '\n\nLATEST NEWS (from NewsAPI):\n' + news;
        convPrompt += '\nSummarize these naturally. Add brief commentary. Mention which might be relevant to the user based on their profile.';
      }
    }

    // ── Email confirm-and-send ────────────────────────────
    const isConfirmSend = /\b(confirm|yes send|send it|go ahead|approve|looks good)\b/i.test(message)
      && chatHistory.length > 0 && chatHistory[0]?.content?.includes('[DRAFT READY]');
    if (isConfirmSend && userId) {
      const canWrite = await hasPermission(userId, 'email_write');
      if (canWrite) {
        const prev = chatHistory[0].content;
        const toMatch = prev.match(/\*\*To:\*\*\s*(.+)/);
        const subMatch = prev.match(/\*\*Subject:\*\*\s*(.+)/);
        const bodyMatch = prev.match(/\*\*Body:\*\*\s*([\s\S]*?)(?=\n\n\[DRAFT READY\])/);
        if (toMatch && subMatch && bodyMatch) {
          const onStatus = (text: string) => {
            if (!clientDisconnected) res.write(`data: ${JSON.stringify({ type: 'status', content: text })}\n\n`);
          };
          onStatus('Sending email...');
          const htmlBody = `<p>${bodyMatch[1].trim().replace(/\n/g, '<br/>')}</p>`;
          const sendResult = await sendUserEmail(userId, toMatch[1].trim(), subMatch[1].trim(), htmlBody);
          if (sendResult.success) {
            convPrompt += `\n\nEMAIL SENT SUCCESSFULLY to ${toMatch[1].trim()}. Tell the user the email has been sent. Be brief and confirmatory.`;
          } else {
            convPrompt += `\n\nFailed to send: ${sendResult.error}. Tell the user naturally.`;
          }
        }
      }
    }

    // ── Email/Calendar integration ────────────────────────
    const isEmailQuery = /\b(emails?|inbox|mails?|unread|send email|reply|compose|draft)\b/i.test(message);
    const isSendReply = /\b(reply|send|forward|respond|write back)\b/i.test(message) && chatHistory.length > 0;
    const isCalendarQuery = /\b(calendar|schedule|meetings?|events?|appointments?|free time|free slot|busy|today'?s? (meeting|event|schedule))\b/i.test(message);

    if ((isEmailQuery || isSendReply || isCalendarQuery) && userId) {
      const { ready, message: notReadyMsg } = await checkIntegrationReady(userId);
      if (!ready) {
        convPrompt += `\n\nIMPORTANT: The user is asking about email/calendar but has NOT connected their account. Respond with this message naturally:\n${notReadyMsg}`;
      } else {
        // ── Send/Reply email ──────────────────────────────
        if (isSendReply) {
          const canWrite = await hasPermission(userId, 'email_write');
          if (!canWrite) {
            convPrompt += '\n\nThe user wants to reply but "Send/Reply Emails" is disabled. Tell them: "I can draft that, but sending is disabled. Enable it in **Settings → Email & Calendar → AI Permissions**."';
          } else {
            const emailFromMatch = message.match(/(?:reply|send|respond|write)\s+(?:to\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
            const targetName = emailFromMatch?.[1] || '';

            if (targetName) {
              const onStatus = (text: string) => {
                if (!clientDisconnected) res.write(`data: ${JSON.stringify({ type: 'status', content: text })}\n\n`);
              };
              onStatus(`Drafting reply to ${targetName}...`);
              try {
                const { emails: foundEmails } = await searchEmails(userId, `from:${targetName}`, 1);
                if (foundEmails.length > 0) {
                  const targetEmail = foundEmails[0].from;
                  const targetAddress = targetEmail.match(/<(.+?)>/)?.[1] || targetEmail;
                  const subject = 'Re: ' + (foundEmails[0].subject || '');
                  const userIntent = message.replace(/^(reply|send|respond|write\s+back)\s+(to\s+)?[A-Z][a-z]+(\s+[A-Z][a-z]+)?\s*(that|saying|with|:)?\s*/i, '').trim();

                  let emailBody = '';
                  await streamGemini(
                    'You are an email writer. Write a SHORT, professional email body (2-3 sentences max). Include a greeting and sign-off. Return ONLY the email text.',
                    `Write email to ${targetName} saying: ${userIntent}`,
                    (chunk) => { emailBody += chunk; }, true, 256, true
                  );
                  emailBody = emailBody.trim();

                  convPrompt += `\n\nDRAFT EMAIL (show this to user for review):\n**To:** ${targetAddress}\n**Subject:** ${subject}\n**Body:** ${emailBody}\n\n[DRAFT READY]\n\nPresent this draft to the user. Show the To, Subject, and Body clearly. Then ask: "Does this look good? Say **confirm** to send, or tell me what to change."`;
                } else {
                  convPrompt += `\n\nCouldn't find an email from "${targetName}". Ask the user for the email address.`;
                }
              } catch (e: any) {
                convPrompt += `\n\nEmail error: ${e.message}. Tell the user naturally.`;
              }
            } else {
              convPrompt += '\n\nThe user wants to reply but didn\'t specify who. Ask: "Who would you like me to reply to?"';
            }
          }
        }
        // ── Read email ──────────────────────────────────
        else if (isEmailQuery) {
          const canRead = await hasPermission(userId, 'email_read');

          if (canRead) {
            const onStatus = (text: string) => {
              if (!clientDisconnected) res.write(`data: ${JSON.stringify({ type: 'status', content: text })}\n\n`);
            };
            onStatus('Checking your emails...');
            try {
              const searchTerm = message.match(/(?:from|about|regarding|by)\s+["']?(\w[\w\s]*\w)["']?/i)?.[1];
              const { emails, error: emailErr } = searchTerm
                ? await searchEmails(userId, searchTerm, 5)
                : await getInbox(userId, 8);

              if (emailErr) {
                convPrompt += `\n\nEmail error: ${emailErr}. Mention the error naturally and suggest reconnecting in Settings.`;
              } else if (emails.length === 0) {
                convPrompt += '\n\nNo emails found matching the query. Let the user know naturally.';
              } else {
                const canWrite = await hasPermission(userId, 'email_write');
                const emailSummary = emails.map((e: any, i: number) => {
                  const fromAddr = e.from.match(/<(.+?)>/)?.[1] || e.from;
                  const fromName = e.from.replace(/<.*>/, '').trim();
                  return `${i + 1}. ${e.isUnread ? '[UNREAD] ' : ''}From: ${fromName} | Subject: ${e.subject} | ${e.date}\n   ${e.snippet}` +
                    (canWrite ? `\n   [reply:${fromAddr}:${e.subject}:Reply] [replyall:${fromAddr}:${e.subject}:Reply All]` : '');
                }).join('\n');
                convPrompt += `\n\nUSER'S EMAILS:\n${emailSummary}\n\nPresent each email naturally. IMPORTANT: Keep the [reply:...] and [replyall:...] tags EXACTLY as shown at the end of each email — they become clickable buttons in the UI. Do NOT modify or remove them.`;
              }
            } catch (e: any) {
              convPrompt += `\n\nCouldn't fetch emails: ${e.message}. Mention this naturally.`;
            }
          }
        }

        // Calendar queries
        if (isCalendarQuery) {
          const canRead = await hasPermission(userId, 'calendar_read');
          const canWrite = await hasPermission(userId, 'calendar_write');
          const isCreateRequest = /\b(schedule|create|book|set up|arrange).*(meeting|event|call|appointment)\b/i.test(message);
          const isFreeTimeRequest = /\b(free|available|open|slot)\b/i.test(message);

          if (isCreateRequest && !canWrite) {
            convPrompt += '\n\nThe user wants to create a calendar event but has NOT enabled "Create/Edit Events" permission. Politely tell them: "I can help plan that, but creating events is currently disabled. You can enable it in **Settings → Email & Calendar → AI Permissions**."\n';
          } else if (canRead) {
            const onStatus = (text: string) => {
              if (!clientDisconnected) res.write(`data: ${JSON.stringify({ type: 'status', content: text })}\n\n`);
            };
            onStatus('Checking your calendar...');
            try {
              if (isFreeTimeRequest) {
                const targetDate = new Date();
                const { slots, error: freeErr } = await findFreeTime(userId, targetDate);
                if (freeErr) {
                  convPrompt += `\n\nCalendar error: ${freeErr}. Mention naturally.`;
                } else {
                  const slotText = slots.length > 0
                    ? slots.map((s: any) => `${new Date(s.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} — ${new Date(s.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`).join('\n')
                    : 'No free slots found today';
                  convPrompt += `\n\nFREE TIME SLOTS TODAY:\n${slotText}\n\nPresent these naturally. Suggest the best slot.`;
                }
              } else {
                const isUpcoming = /\b(week|upcoming|next|this week)\b/i.test(message);
                const { events, error: calErr } = isUpcoming
                  ? await getUpcomingEvents(userId, 7)
                  : await getTodayEvents(userId);

                if (calErr) {
                  convPrompt += `\n\nCalendar error: ${calErr}. Mention naturally.`;
                } else if (events.length === 0) {
                  convPrompt += `\n\nNo ${isUpcoming ? 'upcoming' : "today's"} events found. Let the user know — "${isUpcoming ? 'Your week looks clear!' : 'Your calendar is free today!'}"`;
                } else {
                  const canWriteCal = await hasPermission(userId, 'calendar_write');
                  const eventSummary = events.map((e: any, i: number) => {
                    const start = new Date(e.start);
                    const time = e.isAllDay ? 'All day' : start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                    const loc = (e.location || '').split(';')[0].replace(/https?:\/\/\S+/g, '').trim();
                    return `${i + 1}. ${time} — ${e.title}${loc ? ' @ ' + loc : ''}${e.attendees.length > 0 ? ' (with ' + e.attendees.slice(0, 3).join(', ') + ')' : ''}` +
                      (canWriteCal ? ` [event_modify:${e.id}:${e.title}:Modify]` : '');
                  }).join('\n');
                  convPrompt += `\n\n${isUpcoming ? 'UPCOMING' : "TODAY'S"} CALENDAR:\n${eventSummary}\n\nPresent each event naturally. IMPORTANT: Keep [event_modify:...] tags EXACTLY as shown — they become clickable buttons. Highlight important meetings and mention conflicts or tight gaps.`;
                }
              }
            } catch (e: any) {
              convPrompt += `\n\nCouldn't fetch calendar: ${e.message}. Mention this naturally.`;
            }
          }
        }
      }
    }

    // ── Apply config fix (admin confirms setting change) ──
    const prevHasFix = chatHistory.length > 0 && (chatHistory[0]?.content?.includes('context_limit') || chatHistory[0]?.content?.includes('max_output') || chatHistory[0]?.content?.includes('Would you like me to apply') || chatHistory[0]?.content?.includes('Fix All'));
    const hasDirectFixes = /apply all fixes:\s*(.+)/i.test(message);
    const isApplyFix = (prevHasFix || hasDirectFixes) && (
      /\b(yes|confirm|apply|go ahead|update it|do it|fix it|change it|please do|ok do|sure|apply all)\b/i.test(message) ||
      /\b(context_limit|max_output_tokens|reducing|increase)\b/i.test(message)
    ) && isAdmin;
    if (isApplyFix && isAdmin && clientNumber) {
      try {
        const { setConfig } = require('../../services/configService');
        const { clearAIConfigCache } = require('../../services/aiConfigService');
        const { caterLog, getLogs } = require('../../services/systemLogService');

        const directFixes = message.match(/apply all fixes:\s*(.+)/i)?.[1];
        const prevContent = chatHistory[0]?.content || '';

        const changes: string[] = [];

        if (directFixes) {
          for (const fix of directFixes.split('|')) {
            const [key, val] = fix.split('=');
            if (key && val) {
              await setConfig(clientNumber, key.trim(), val.trim());
              changes.push(`${key.trim()} → ${Number(val.trim()).toLocaleString()}`);
            }
          }
        }

        const valueMatch = !directFixes && prevContent.match(/context_limit_full.*?(\d{2,})/);
        const tokenMatch = !directFixes && prevContent.match(/max_output_tokens.*?(\d{3,})/);

        if (valueMatch) {
          const newVal = valueMatch[1];
          await setConfig(clientNumber, 'context_limit_full', newVal);
          changes.push(`context_limit_full → ${Number(newVal).toLocaleString()}`);
        }
        if (tokenMatch) {
          const newVal = tokenMatch[1];
          await setConfig(clientNumber, 'max_output_tokens_text', newVal);
          changes.push(`max_output_tokens_text → ${newVal}`);
        }

        if (changes.length > 0) {
          clearAIConfigCache();

          const openLogs: any[] = await getLogs({ status: 'open', limit: 20 });
          for (const logEntry of openLogs) {
            if (logEntry.category === 'data_truncation' || logEntry.category === 'performance') {
              await caterLog(logEntry.id, userId, `Auto-fixed: ${changes.join(', ')}`);
            }
          }

          convPrompt += `\n\nCONFIG UPDATED SUCCESSFULLY:\n${changes.map((c: string) => '- ' + c).join('\n')}\nRelated system logs have been marked as catered.\n\nTell the user: "Done! I've updated the settings: ${changes.join(', ')}. Related logs are now marked as resolved. The changes take effect on your next query."`;
        } else {
          convPrompt += '\n\nCould not determine what to change. Ask the user to specify.';
        }
      } catch (e: any) {
        convPrompt += `\n\nFailed to apply config change: ${e.message}`;
      }
    }

    // ── System logs query (admin only) ──────────────────
    const isLogQuery = /\b(system log|logs?|error log|issues?|warnings?|suggest fix)/i.test(message) && isAdmin && !isApplyFix;
    if (isLogQuery && userId) {
      const onStatus = (text: string) => {
        if (!clientDisconnected) res.write(`data: ${JSON.stringify({ type: 'status', content: text })}\n\n`);
      };
      onStatus('Fetching system logs...');
      try {
        const { getLogs, getLogSummary } = require('../../services/systemLogService');
        const [logs, summary] = await Promise.all([getLogs({ status: 'open', limit: 15 }), getLogSummary()]);

        const allFixes: string[] = [];
        const allLogIds: number[] = [];
        const logText = (logs as any[]).map((l: any) => {
          let fixAction = '';
          if (l.suggestion) {
            const configMatch = l.suggestion.match(/(context_limit_full|context_limit_fast|max_output_tokens_text|max_output_tokens_widget|max_output_tokens_quick)\D+(\d[\d,]*)/);
            if (configMatch) {
              const key = configMatch[1];
              const val = configMatch[2].replace(/,/g, '');
              fixAction = `${key}=${val}`;
              allFixes.push(fixAction);
            }
          }
          allLogIds.push(l.id);

          return `**${l.level === 'error' ? '❌' : '⚠️'} Log #${l.id} — ${l.category}**\n` +
            `**Issue:** ${l.message}\n` +
            `**Seen:** ${l.recurrence_count}x | **Status:** ${l.status}\n` +
            (l.suggestion ? `**Solution:** ${l.suggestion}\n` : '') +
            (fixAction ? `[log_fix:${l.id}:${fixAction}:🔧 Fix] ` : '') +
            `[log_ignore:${l.id}:⊘ Ignore]\n---`;
        }).join('\n\n');

        const bulkTags = allLogIds.length > 0
          ? `\n\n[log_fix_all:${allLogIds.join(',')}:${[...new Set(allFixes)].join('|')}:🔧 Fix All] [log_ignore_all:${allLogIds.join(',')}:⊘ Ignore All]`
          : '';

        convPrompt += `\n\nSYSTEM LOGS (${summary.open} open, ${summary.recurring} recurring):\n\n${logText || 'No open issues — system is healthy!'}${bulkTags}\n\nIMPORTANT: Present each log with its Issue, Seen count, and Solution. KEEP all [log_fix:...] and [log_ignore:...] tags EXACTLY as shown — they become clickable buttons. Do NOT modify or remove them. Present the bulk Fix All and Ignore All at the end.`;
      } catch { convPrompt += '\n\nCould not fetch system logs.'; }
    }

    // ── Token consumption query (admin only) ──────────
    const isTokenQuery = /\b(token|consumption|cost|usage|billing|spend|mtd)\b/i.test(message) && isAdmin;
    if (isTokenQuery && userId) {
      const onStatus = (text: string) => {
        if (!clientDisconnected) res.write(`data: ${JSON.stringify({ type: 'status', content: text })}\n\n`);
      };
      onStatus('Fetching usage data...');
      try {
        const { getAllClientsUsage, getTopUsers, getProviderBreakdown, getTopQueries } = require('../../services/tokenUsageService');
        const [clients, topUsers, providers, topQueries] = await Promise.all([
          getAllClientsUsage(30),
          getTopUsers(undefined, 30, 10),
          getProviderBreakdown(undefined, 30),
          getTopQueries(undefined, 30, 10),
        ]);

        const totalCost = (providers as any[]).reduce((s: number, p: any) => s + Number(p.cost_usd || 0), 0).toFixed(4);
        const totalTokens = (providers as any[]).reduce((s: number, p: any) => s + Number(p.total_tokens || 0), 0);
        const totalRequests = (providers as any[]).reduce((s: number, p: any) => s + Number(p.requests || 0), 0);

        const allRows = (topUsers as any[]).map((u: any) => {
          const userQueries = (topQueries as any[])
            .filter((q: any) => q.user_name === u.user_name)
            .slice(0, 5)
            .map((q: any, i: number) => `${i+1}. ${(q.query||'').slice(0,40)}: ${Number(q.total_tokens).toLocaleString()} tokens`)
            .join('<br>') || '-';

          return {
            client: u.client_number || '',
            user: u.user_name || '',
            email: u.email || '',
            provider: 'gemini-flash',
            requests: Number(u.total_requests || 0),
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: Number(u.total_tokens || 0),
            rate: '$0.075/1M in, $0.30/1M out',
            costUsd: Number(u.total_cost_usd || 0).toFixed(4),
            topQueries: userQueries,
          };
        });

        const tableRows = allRows.map(r =>
          '<tr data-client="' + r.client + '" data-user="' + r.user + '" data-provider="' + r.provider + '">' +
          '<td>' + r.client + '</td><td>' + r.user + '</td><td>' + r.email + '</td><td>' + r.provider + '</td>' +
          '<td>' + r.requests + '</td><td>' + r.totalTokens.toLocaleString() + '</td><td>' + r.rate + '</td>' +
          '<td>$' + r.costUsd + '</td><td style="font-size:11px;line-height:1.4">' + r.topQueries + '</td></tr>'
        ).join('');

        const csvLines = ['Client,User,Email,Provider,Requests,Total Tokens,Rate,Cost USD,Max Token Queries'];
        allRows.forEach(r => {
          const queries = r.topQueries.replace(/<br>/g, '; ').replace(/<[^>]+>/g, '');
          csvLines.push('"' + [r.client, r.user, r.email, r.provider, r.requests, r.totalTokens, r.rate, r.costUsd, queries].join('","') + '"');
        });
        const csvStr = csvLines.join('\\n');

        const uniqueClients = [...new Set(allRows.map(r => r.client))];
        const uniqueUsers = [...new Set(allRows.map(r => r.user))];
        const uniqueProviders = [...new Set(allRows.map(r => r.provider))];

        const widgetHtml =
'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
'<h2 style="margin:0">Token Consumption Report</h2>' +
'<button onclick="downloadExcel()" style="padding:6px 16px;background:#cc6b4a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px">Download Excel</button>' +
'</div>' +
'<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;font-size:12px">' +
'<label>Client: <select id="fClient" onchange="applyFilter()"><option value="">All</option>' + uniqueClients.map(c => '<option>' + c + '</option>').join('') + '</select></label>' +
'<label>User: <select id="fUser" onchange="applyFilter()"><option value="">All</option>' + uniqueUsers.map(u => '<option>' + u + '</option>').join('') + '</select></label>' +
'<label>Provider: <select id="fProvider" onchange="applyFilter()"><option value="">All</option>' + uniqueProviders.map(p => '<option>' + p + '</option>').join('') + '</select></label>' +
'<label>Sort: <select id="fSort" onchange="applySort()"><option value="cost-desc">Cost (High→Low)</option><option value="cost-asc">Cost (Low→High)</option><option value="tokens-desc">Tokens (High→Low)</option><option value="requests-desc">Requests (High→Low)</option></select></label>' +
'</div>' +
'<table id="reportTable"><thead><tr><th>Client</th><th>User</th><th>Email</th><th>Provider</th><th>Requests</th><th>Total Tokens</th><th>Rate</th><th>Cost USD</th><th>Max Token Consumption</th></tr></thead>' +
'<tbody>' + (tableRows || '<tr><td colspan="9">No data</td></tr>') + '</tbody></table>' +
'<script>' +
'function applyFilter(){' +
'var c=document.getElementById("fClient").value,u=document.getElementById("fUser").value,p=document.getElementById("fProvider").value;' +
'document.querySelectorAll("#reportTable tbody tr").forEach(function(row){' +
'var show=(!c||row.dataset.client===c)&&(!u||row.dataset.user===u)&&(!p||row.dataset.provider===p);' +
'row.style.display=show?"":"none";});' +
'}' +
'function applySort(){' +
'var s=document.getElementById("fSort").value,tbody=document.querySelector("#reportTable tbody"),rows=Array.from(tbody.rows);' +
'rows.sort(function(a,b){var ci=s.includes("cost")?7:s.includes("tokens")?5:4;' +
'var av=parseFloat(a.cells[ci].textContent.replace(/[$,]/g,"")),bv=parseFloat(b.cells[ci].textContent.replace(/[$,]/g,""));' +
'return s.includes("asc")?av-bv:bv-av;});' +
'rows.forEach(function(r){tbody.appendChild(r);});' +
'}' +
'function downloadExcel(){' +
'var csv="' + csvStr + '";' +
'csv=csv.replace(/\\\\n/g,String.fromCharCode(10));' +
'var a=document.createElement("a");' +
'a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv);' +
'a.download="token_consumption_report.csv";' +
'document.body.appendChild(a);a.click();document.body.removeChild(a);' +
'}' +
'</script>';

        const response = `Here's your token consumption report for the last 30 days.\n\n\`\`\`widget\n${widgetHtml}\n\`\`\`\n\n**Cost Reduction Suggestions:**\n- Current provider: **gemini-flash** ($0.075/1M input, $0.30/1M output) — this is already the cheapest Gemini option\n- Consider caching frequent queries (currently 5-min cache) — increase to 15-30 min for common dashboards\n- Use artifact templates for repeated dashboard queries — they skip AI generation entirely`;
        sendChunkDirect(res, clientDisconnected, responseChunks, response);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const meta = { type: 'meta', elapsed, outputTokens: Math.ceil(widgetHtml.length / 4), inputTokens: 0, totalTokens: Math.ceil(widgetHtml.length / 4), conversationId };
        res.write(`data: ${JSON.stringify(meta)}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
        return;
      } catch (e: any) {
        convPrompt += `\n\nToken usage fetch error: ${e.message}. Tell the user there was an issue fetching the data.`;
      }
    }

    if (chatHistory.length > 0) {
      convPrompt += '\n\nRecent conversation:\n' + chatHistory.slice().reverse().map((m: any) => {
        const maxLen = m.role === 'user' ? aiConfig.historyMaxCharsUser : aiConfig.historyMaxCharsAssistant;
        return `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, maxLen)}`;
      }).join('\n');
    }

    const sendChunkFn = (text: string) => {
      totalChars += sendChunkDirect(res, clientDisconnected, responseChunks, text);
    };
    await streamGemini(convPrompt, message, sendChunkFn, true, 4096, true);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const meta = { type: 'meta', elapsed, outputTokens: Math.ceil(totalChars / 4), inputTokens: 50, totalTokens: Math.ceil(totalChars / 4) + 50, conversationId };
    res.write(`data: ${JSON.stringify(meta)}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    setCachedResponse(dedupKey, { chunks: responseChunks, meta, timestamp: Date.now() });

    // Extract memories from conversational messages too
    if (userId && clientNumber) {
      updateMemoryFromMessage(userId, clientNumber, message).catch(() => {});
    }
  } catch (error: any) {
    res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
  }
  res.end();
}
