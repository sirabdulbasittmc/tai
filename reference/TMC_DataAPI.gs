// ═════════════════════════════════════════════════════════════════════════════
// TMC_DataAPI — Standalone Apps Script
// ═════════════════════════════════════════════════════════════════════════════
//
// JOB: Reads TMC_Drive_Index.md from Google Drive and exposes it as a
//      JSON API consumed by TMC_WebApp (Code.gs).
//
// ACTIONS:
//   ?action=list            → returns all section headers (## lines)
//   ?action=search&q=term   → returns sections containing the search term
//   ?action=full            → returns first 500 chars + total char count
//
// DEPLOY: Execute as Me, Access: Anyone (anonymous)
// ═════════════════════════════════════════════════════════════════════════════

const INDEX_FILE_NAME = "TMC_Drive_Index.md";
const INDEX_FOLDER_ID = "1IazxlANChiZekv3cC5JurOUAW1MTA_lI";

function doGet(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};
    const action = params.action || "full";
    const query  = (params.q || "").trim().toLowerCase();

    // Step 1: get folder
    let folder;
    try {
      folder = DriveApp.getFolderById(INDEX_FOLDER_ID);
    } catch(err) {
      return respond({ status: "error", step: "folder", message: err.toString() });
    }

    // Step 2: get file
    let content;
    try {
      const iter = folder.getFilesByName(INDEX_FILE_NAME);
      if (!iter.hasNext()) {
        return respond({ status: "error", step: "file", message: "File not found in folder" });
      }
      content = iter.next().getBlob().getDataAsString();
    } catch(err) {
      return respond({ status: "error", step: "read", message: err.toString() });
    }

    // Step 3: action routing
    if (action === "list") {
      const list = content.split("\n")
        .filter(l => l.startsWith("## "))
        .map(l => l.replace("## ", "").trim());
      return respond({ status: "success", data: list.join("\n") });
    }

    if (action === "search" && query) {
      const lines = content.split("\n");
      const sections = [];
      let current = [];

      for (const line of lines) {
        if (line.startsWith("## ") && current.length > 0) {
          sections.push(current.join("\n"));
          current = [];
        }
        current.push(line);
      }
      if (current.length > 0) sections.push(current.join("\n"));

      const matched = sections.filter(s => s.toLowerCase().includes(query));

      if (matched.length === 0) {
        return respond({ status: "success", data: "NO_MATCH", matched: 0 });
      }

      const result = matched.join("\n\n---\n\n");
      return respond({ status: "success", data: result, matched: matched.length });
    }

    // Default: full (preview only)
    return respond({ status: "success", data: content.substring(0, 500), chars: content.length });

  } catch(err) {
    return respond({ status: "error", step: "outer", message: err.toString() });
  }
}

// ─── RESPONSE HELPER ─────────────────────────────────────────────────────────
function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── POST → delegates to GET ──────────────────────────────────────────────────
function doPost(e) {
  // DEBUG - remove after fix
  const debug = {
    parameter: e ? e.parameter : null,
    postData: e && e.postData ? e.postData.contents : null
  };
  Logger.log("doPost called: " + JSON.stringify(debug).substring(0, 500));

  return doGet(e);
}
