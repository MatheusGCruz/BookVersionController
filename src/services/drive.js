const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = "https://www.googleapis.com/auth/drive";
const DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest";

let tokenClient;

export async function loadDriveApis() {
  if (!CLIENT_ID) {
    throw new Error("Add VITE_GOOGLE_CLIENT_ID to .env.local");
  }

  await loadScript("https://apis.google.com/js/api.js");
  await loadScript("https://accounts.google.com/gsi/client");

  await new Promise((resolve) => window.gapi.load("client", resolve));
  await window.gapi.client.init({ discoveryDocs: [DISCOVERY_DOC] });

  tokenClient =
    tokenClient ||
    window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: () => {},
    });
}

export function signInToDrive({ chooseAccount = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      reject(new Error("Drive APIs are not loaded"));
      return;
    }

    tokenClient.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error));
        return;
      }

      window.gapi.client.setToken(response);
      resolve(response);
    };
    tokenClient.requestAccessToken({ prompt: chooseAccount ? "select_account consent" : "" });
  });
}

export async function getDriveUser() {
  const response = await window.gapi.client.drive.about.get({
    fields: "user(displayName,emailAddress)",
  });
  return response.result.user;
}

export async function listDriveTextFiles(searchTerm = "") {
  const queryParts = ["mimeType = 'text/plain'", "trashed = false"];
  if (searchTerm.trim()) {
    queryParts.push(`name contains '${escapeDriveQuery(searchTerm.trim())}'`);
  }

  const response = await window.gapi.client.drive.files.list({
    q: queryParts.join(" and "),
    fields: "files(id,name,mimeType,parents,modifiedTime,owners(displayName,emailAddress),capabilities)",
    spaces: "drive",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    orderBy: "modifiedTime desc",
    pageSize: 50,
  });

  return response.result.files || [];
}

export async function readDriveTextFile(fileId) {
  const response = await window.gapi.client.drive.files.get({
    fileId,
    alt: "media",
  });
  return typeof response.body === "string" ? response.body : JSON.stringify(response.result, null, 2);
}

export async function saveDriveTextFile(fileId, content) {
  const token = window.gapi.client.getToken()?.access_token;
  const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&supportsAllDrives=true`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain; charset=utf-8",
    },
    body: content,
  });

  if (!response.ok) {
    throw new Error(`Drive save failed: ${response.status}`);
  }

  return response.json();
}

export async function ensureVersionsFile(mainFile) {
  const baseName = mainFile.name.replace(/\.txt$/i, "");
  const versionsName = `${baseName}-versions.txt`;
  const query = [
    `name = '${versionsName.replaceAll("'", "\\'")}'`,
    "mimeType = 'text/plain'",
    "trashed = false",
  ].join(" and ");

  const existing = await window.gapi.client.drive.files.list({
    q: query,
    fields: "files(id,name,mimeType,parents,capabilities)",
    spaces: "drive",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });

  if (existing.result.files?.length) {
    return existing.result.files[0];
  }

  const created = await window.gapi.client.drive.files.create({
    resource: {
      name: versionsName,
      mimeType: "text/plain",
      parents: mainFile.parents?.length ? mainFile.parents : undefined,
    },
    fields: "id,name,mimeType,parents",
    supportsAllDrives: true,
  });

  await saveDriveTextFile(created.result.id, "<book>\n<comments>[]</comments>\n</book>");
  return created.result;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

function escapeDriveQuery(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}
