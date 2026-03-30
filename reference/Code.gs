// ═════════════════════════════════════════════════════════════════════════════
// TMC_WebApp — Standalone Apps Script
// ═════════════════════════════════════════════════════════════════════════════
//
// JOB: Serves the chat UI and handles AI communication.
//      Fetches data from TMC_DataAPI and sends to AI model.
//
// SETUP (run once):
// 1. Run storeKeys() to save API keys
// 2. Deploy as Web App: Execute as Me, Access: Anyone
// 3. Share the deployed URL with TMC staff
// ═════════════════════════════════════════════════════════════════════════════

function askDriveIntelligence(userMessage, provider) {
  if (userMessage === "version") {
    return "VERSION 8 - UPDATED CODE RUNNING";
  }

  const driveContext = fetchFromDataAPI(userMessage);
  
  // TEMP DEBUG - remove after fix
  Logger.log("=== askDriveIntelligence called ===");
  Logger.log("userMessage: " + userMessage);
  Logger.log("provider: " + provider);
  Logger.log("driveContext length: " + driveContext.length);
  Logger.log("driveContext preview: " + driveContext.substring(0, 200));

  if (provider === "claude") {
    return askClaude(userMessage, driveContext);
  } else if (provider === "openai") {
    return askOpenAI(userMessage, driveContext);
  } else {
    return askOpenRouter(userMessage, driveContext);
  }
}

// ─── FIXED MODEL CONSTANTS ───────────────────────────────────────────────────
const MODEL_CLAUDE     = "claude-sonnet-4-20250514";
const MODEL_OPENROUTER = "openrouter/free";

// ─── MAX CONTEXT SIZE ────────────────────────────────────────────────────────
// Limits how much Drive data is sent to AI per question
// 50,000 chars ≈ ~12,000 tokens — safe for all models
const MAX_CONTEXT_CHARS = 50000;

// ─── TMC_DataAPI URL ─────────────────────────────────────────────────────────
const DATA_API_URL = "https://script.google.com/macros/s/AKfycbzBnXbeWfFsJeXJGjNp2egbobk1AM04-gO3-ZCxEDP2tmGb6GCY2MHkCJnY_5KEWv5x/exec";

// ─── SERVES THE WEB APP UI ───────────────────────────────────────────────────
function doGet() {
  return HtmlService.createHtmlOutputFromFile('TMC_WebUI')
    .setTitle('TMC Drive Intelligence')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ─── RUN ONCE: Store API keys ─────────────────────────────────────────────────
function storeKeys() {
  PropertiesService.getScriptProperties().setProperties({
    'ANTHROPIC_KEY':  'your_anthropic_key',
    'OPENROUTER_KEY': 'your_openrouter_key',
    'OPENAI_KEY':     'PASTE_YOUR_OPENAI_KEY_HERE'
  });

  Logger.log('Keys stored. Delete them from code now.');
}


// ─── FETCH FROM TMC_DataAPI ───────────────────────────────────────────────────
function fetchFromDataAPI(query) {
  try {
    // Extract search keywords — remove common words
    const stopWords = ["tell", "me", "about", "what", "is", "are", "the", "a", "an", 
                       "show", "give", "list", "find", "get", "how", "many", "much",
                       "which", "who", "where", "when", "all", "any", "of", "for",
                       "in", "on", "at", "to", "do", "does", "has", "have", "with"];
    
    const keywords = query.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.includes(w));
    
    const searchTerm = keywords[0] || query; // Use first meaningful keyword
    Logger.log("Query: " + query + " → Search term: " + searchTerm);

    const searchUrl = DATA_API_URL + 
      "?action=search&q=" + encodeURIComponent(searchTerm);
    
    const res = UrlFetchApp.fetch(searchUrl, {
      method: "get",
      followRedirects: true,
      muteHttpExceptions: true
    });

    const json = JSON.parse(res.getContentText());
    Logger.log("Matched: " + json.matched + ", Data: " + (json.data ? json.data.length : 0) + " chars");

    if (json.status === "success" && json.matched > 0 && json.data && json.data !== "NO_MATCH") {
      const fullData = json.data.toString();
      const q = searchTerm.toLowerCase();
      const lines = fullData.split("\n");

      const contextParts = [];
      let currentSection = "";
      let currentColumnHeader = "";
      let matchingRows = [];

      for (const line of lines) {
        if (line.startsWith("## ")) {
          if (matchingRows.length > 0) {
            contextParts.push(currentSection);
            if (currentColumnHeader) contextParts.push(currentColumnHeader);
            contextParts.push(matchingRows.join("\n"));
            matchingRows = [];
          }
          currentSection = line;
          currentColumnHeader = "";
          continue;
        }

        if (line.includes(" | ") &&
            !line.startsWith("-") &&
            !line.toLowerCase().includes(q) &&
            !currentColumnHeader) {
          currentColumnHeader = line;
          continue;
        }

        if (line.match(/^[\-\| ]+$/) || line.startsWith("- **Type") || line.startsWith("- **ID")) {
          continue;
        }
        // Keep lines mentioning the query (max 20 rows per section)
        if (line.toLowerCase().includes(q)) {
          if (matchingRows.length < 20) {
            matchingRows.push(line);
          }
        }
      }

      if (matchingRows.length > 0) {
        contextParts.push(currentSection);
        if (currentColumnHeader) contextParts.push(currentColumnHeader);
        contextParts.push(matchingRows.join("\n"));
      }

      const context = contextParts.join("\n\n");
      Logger.log("Refined context: " + context.length + " chars");
      return truncate(context);
    }

    // No match — return file list
    const listUrl = DATA_API_URL + "?action=list";
    const listRes = UrlFetchApp.fetch(listUrl, {
      method: "get",
      followRedirects: true,
      muteHttpExceptions: true
    });

    const listJson = JSON.parse(listRes.getContentText());
    if (listJson.status === "success" && listJson.data) {
      return "No specific content found for your query.\n\nAvailable files:\n" + listJson.data;
    }

    return "Drive data not available.";

  } catch (e) {
    Logger.log("fetchFromDataAPI error: " + e.toString());
    return "Could not fetch Drive data: " + e.toString();
  }
}

// ─── TRUNCATE HELPER ─────────────────────────────────────────────────────────
function truncate(text) {
  if (text.length <= MAX_CONTEXT_CHARS) return text;
  Logger.log('Content truncated from ' + text.length + ' to ' + MAX_CONTEXT_CHARS + ' chars.');
  return text.substring(0, MAX_CONTEXT_CHARS) + "\n\n...[content truncated — ask more specific questions for full details]";
}

// ─── BUILD SYSTEM PROMPT ─────────────────────────────────────────────────────
function buildSystemPrompt(driveContext) {
  return "You are TMC Drive Intelligence, an AI assistant for TallyMarks Consulting (TMC).\n\n" +
    "The data below is TMC's internal business data in pipe-delimited markdown table format. " +
    "The first row of each section contains column names. " +
    "Interpret all data as structured business records — clients, projects, revenue, HR, and strategy.\n\n" +
    "Rules:\n" +
    "- Base all answers strictly on the Drive data provided below\n" +
    "- Give DETAILED and COMPREHENSIVE answers — include all relevant data points\n" +
    "- For projects: mention project code, client, dates, progress %, phase status, risks\n" +
    "- For sales: mention deal value, currency, owner, milestone, status\n" +
    "- For clients: mention all engagements, solutions in use, strategic notes\n" +
    "- Format responses with clear sections and bullet points\n" +
    "- If the answer is not in the data, say so clearly\n" +
    "- When user asks to export data as Excel → use create_excel tool\n" +
    "- When user asks for a Word report → use create_word tool\n\n" +
    "─── TMC DRIVE DATA ───────────────────────────────────────────────\n" +
    driveContext + "\n" +
    "──────────────────────────────────────────────────────────────────";
}
// ═════════════════════════════════════════════════════════════════════════════
// CLAUDE PATH
// ═════════════════════════════════════════════════════════════════════════════
function askClaude(userMessage, driveContext) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_KEY not found. Run storeKeys() first.');

  const messages = [{ role: "user", content: userMessage }];

  for (let i = 0; i < 3; i++) {
    const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      payload: JSON.stringify({
        model: MODEL_CLAUDE,
        max_tokens: 2048,
        system: buildSystemPrompt(driveContext),
        tools: getFileTools_Claude(),
        messages: messages
      }),
      muteHttpExceptions: true
    });

    const code = res.getResponseCode();
    const body = JSON.parse(res.getContentText());
    if (code !== 200) throw new Error("Claude API error (" + code + "): " + JSON.stringify(body));

    if (body.stop_reason === "end_turn") {
      const t = body.content.find(b => b.type === "text");
      return t ? t.text : "No response.";
    }

    if (body.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: body.content });
      const toolResults = [];
      for (const block of body.content) {
        if (block.type !== "tool_use") continue;
        let result;
        try { result = executeFileTool(block.name, block.input); }
        catch (e) { result = JSON.stringify({ error: e.toString() }); }
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }
    break;
  }
  return "Something went wrong. Please try again.";
}

// ═════════════════════════════════════════════════════════════════════════════
// OPENROUTER PATH
// ═════════════════════════════════════════════════════════════════════════════
function askOpenRouter(userMessage, driveContext) {

  Logger.log("askOpenRouter called");
  Logger.log("driveContext length: " + driveContext.length);
  Logger.log("driveContext preview: " + driveContext.substring(0, 200));
  Logger.log("userMessage: " + userMessage);

  const apiKey = PropertiesService.getScriptProperties().getProperty('OPENROUTER_KEY');
  if (!apiKey) throw new Error('OPENROUTER_KEY not found.');

  const fullMessage =
    "You are an AI assistant for TallyMarks Consulting (TMC), a Pakistani IT consulting firm.\n\n" +
    "Here is TMC's internal business data in pipe-delimited table format.\n" +
    "Each section has column headers followed by data rows.\n\n" +
    "─── TMC DATA ───\n" +
    driveContext + "\n" +
    "────────────────\n\n" +
    "Based ONLY on the data above, answer this question:\n" +
    userMessage;

  const res = UrlFetchApp.fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey,
      "HTTP-Referer": "https://tmcltd.ai",
      "X-Title": "TMC Drive Intelligence"
    },
    payload: JSON.stringify({
      model: MODEL_OPENROUTER,
      messages: [
        { role: "user", content: fullMessage }
      ],
      max_tokens: 1024
    }),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = JSON.parse(res.getContentText());
  if (code !== 200) throw new Error("OpenRouter error (" + code + "): " + JSON.stringify(body));

  return body.choices[0].message.content || "No response.";
}

// ═════════════════════════════════════════════════════════════════════════════
// OPENAI PATH
// ═════════════════════════════════════════════════════════════════════════════
function askOpenAI(userMessage, driveContext) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_KEY');
  if (!apiKey) throw new Error('OPENAI_KEY not found. Run storeKeys() first.');

  const res = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey
    },
    payload: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: buildSystemPrompt(driveContext) },
        { role: "user", content: userMessage }
      ],
      max_tokens: 2048
    }),
    muteHttpExceptions: true
  });

  const body = JSON.parse(res.getContentText());
  if (res.getResponseCode() !== 200) {
    throw new Error("OpenAI error: " + JSON.stringify(body));
  }
  return body.choices[0].message.content;
}

// ═════════════════════════════════════════════════════════════════════════════
// FILE TOOLS
// ═════════════════════════════════════════════════════════════════════════════
function executeFileTool(toolName, toolInput) {
  if (toolName === "create_excel") return createExcelFile(toolInput.title, toolInput.headers, toolInput.rows);
  if (toolName === "create_word")  return createWordFile(toolInput.title, toolInput.content);
  throw new Error("Unknown tool: " + toolName);
}

function getFileTools_Claude() {
  return [
    {
      name: "create_excel",
      description: "Creates an Excel file and returns a download link. Use when user asks to list, export, or tabulate data.",
      input_schema: {
        type: "object",
        properties: {
          title:   { type: "string" },
          headers: { type: "array", items: { type: "string" } },
          rows:    { type: "array", items: { type: "array" } }
        },
        required: ["title", "headers", "rows"]
      }
    },
    {
      name: "create_word",
      description: "Creates a Word document and returns a download link. Use when user asks for a report or document.",
      input_schema: {
        type: "object",
        properties: {
          title:   { type: "string" },
          content: { type: "string" }
        },
        required: ["title", "content"]
      }
    }
  ];
}

function getFileTools_OpenAI() {
  return [
    {
      type: "function",
      function: {
        name: "create_excel",
        description: "Creates an Excel file and returns a download link. Use when user asks to list, export, or tabulate data.",
        parameters: {
          type: "object",
          properties: {
            title:   { type: "string" },
            headers: { type: "array", items: { type: "string" } },
            rows:    { type: "array", items: { type: "array" } }
          },
          required: ["title", "headers", "rows"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "create_word",
        description: "Creates a Word document and returns a download link. Use when user asks for a report or document.",
        parameters: {
          type: "object",
          properties: {
            title:   { type: "string" },
            content: { type: "string" }
          },
          required: ["title", "content"]
        }
      }
    }
  ];
}

// ═════════════════════════════════════════════════════════════════════════════
// FILE CREATION: EXCEL
// ═════════════════════════════════════════════════════════════════════════════
function createExcelFile(title, headers, rows) {
  const ss = SpreadsheetApp.create(title);
  const sheet = ss.getActiveSheet();
  sheet.appendRow(headers);
  const hr = sheet.getRange(1, 1, 1, headers.length);
  hr.setFontWeight("bold");
  hr.setBackground("#1a1a2e");
  hr.setFontColor("#ffffff");
  rows.forEach(row => sheet.appendRow(row));
  sheet.autoResizeColumns(1, headers.length);
  DriveApp.getFileById(ss.getId()).setSharing(
    DriveApp.Access.ANYONE_WITH_LINK,
    DriveApp.Permission.VIEW
  );
  return JSON.stringify({
    success: true,
    message: "Excel file created successfully.",
    title: title,
    download_url: "https://docs.google.com/spreadsheets/d/" + ss.getId() + "/export?format=xlsx",
    view_url: ss.getUrl()
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// FILE CREATION: WORD
// ═════════════════════════════════════════════════════════════════════════════
function createWordFile(title, content) {
  const doc = DocumentApp.create(title);
  const body = doc.getBody();
  body.clear();
  body.appendParagraph(title).setHeading(DocumentApp.ParagraphHeading.TITLE);
  content.split('\n').forEach(line => {
    if (!line.trim())                { body.appendParagraph(''); }
    else if (line.startsWith('# '))  { body.appendParagraph(line.replace('# ', '')).setHeading(DocumentApp.ParagraphHeading.HEADING1); }
    else if (line.startsWith('## ')) { body.appendParagraph(line.replace('## ', '')).setHeading(DocumentApp.ParagraphHeading.HEADING2); }
    else if (line.startsWith('- '))  { body.appendListItem(line.replace('- ', '')); }
    else                             { body.appendParagraph(line); }
  });
  doc.saveAndClose();
  DriveApp.getFileById(doc.getId()).setSharing(
    DriveApp.Access.ANYONE_WITH_LINK,
    DriveApp.Permission.VIEW
  );
  return JSON.stringify({
    success: true,
    message: "Word document created successfully.",
    title: title,
    download_url: "https://docs.google.com/document/d/" + doc.getId() + "/export?format=docx",
    view_url: "https://docs.google.com/document/d/" + doc.getId()
  });
}


// ═════════════════════════════════════════════════════════════════════════════
// Test Functions
// ═════════════════════════════════════════════════════════════════════════════
function testFetchDirect() {
  const res = UrlFetchApp.fetch(DATA_API_URL, {
    method: "post",
    contentType: "application/x-www-form-urlencoded",
    payload: "action=search&q=fauji",
    followRedirects: true,
    muteHttpExceptions: true
  });

  const json = JSON.parse(res.getContentText());
  Logger.log("Matched sections: " + json.matched);
  Logger.log("Raw data length: " + (json.data ? json.data.length : 0));

  // Now test the refined extraction
  const result = fetchFromDataAPI("fauji");
  Logger.log("Refined context length: " + result.length);
  Logger.log("Refined context preview:\n" + result.substring(0, 1000));
}

function testContextDirectly() {
  const context = fetchFromDataAPI("fauji");
  Logger.log("Context length: " + context.length);
  Logger.log("Context preview: " + context.substring(0, 500));
}

function testFullPipeline() {
  const context = fetchFromDataAPI("fauji");
  Logger.log("Context length: " + context.length);
  Logger.log("Context preview: " + context.substring(0, 300));
}

function testEndToEnd() {
  const context = fetchFromDataAPI("fauji");
  Logger.log("=== CONTEXT ===");
  Logger.log(context.substring(0, 500));
  
  const prompt = buildSystemPrompt(context);
  Logger.log("=== PROMPT LENGTH ===");
  Logger.log(prompt.length);
  Logger.log("=== PROMPT PREVIEW ===");
  Logger.log(prompt.substring(0, 500));
}

function testOpenRouter() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('OPENROUTER_KEY');
  
  const context = fetchFromDataAPI("fauji");
  Logger.log("Context length: " + context.length);
  
  const fullMessage = 
    "Here is business data:\n\n" +
    context + "\n\n" +
    "Question: What projects does Fauji Foundation have?";

  const res = UrlFetchApp.fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey,
      "HTTP-Referer": "https://tmcltd.ai",
      "X-Title": "TMC Drive Intelligence"
    },
    payload: JSON.stringify({
      model: "openrouter/free",
      messages: [
        { role: "user", content: fullMessage }
      ],
      max_tokens: 500
    }),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = JSON.parse(res.getContentText());
  Logger.log("Response code: " + code);
  Logger.log("Response: " + JSON.stringify(body).substring(0, 500));
}
