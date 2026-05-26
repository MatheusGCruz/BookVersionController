const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
const SCOPES = "https://www.googleapis.com/auth/drive";
const DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest";

let tokenClient;
let pickerLoaded = false;

export async function loadDriveApis() {
  if (!CLIENT_ID || !API_KEY) {
    throw new Error("Add VITE_GOOGLE_CLIENT_ID and VITE_GOOGLE_API_KEY to .env.local");
  }

  await loadScript("https://apis.google.com/js/api.js");
  await loadScript("https://accounts.google.com/gsi/client");

  await new Promise((resolve) => window.gapi.load("client:picker", resolve));
  await window.gapi.client.init({ apiKey: API_KEY, discoveryDocs: [DISCOVERY_DOC] });
  pickerLoaded = true;

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

export function openDrivePicker({ title }) {
  return new Promise((resolve, reject) => {
    if (!pickerLoaded) {
      reject(new Error("Picker is not loaded"));
      return;
    }

    const token = window.gapi.client.getToken()?.access_token;
    if (!token) {
      reject(new Error("Connect to Google Drive first"));
      return;
    }

    const view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
      .setMimeTypes("text/plain")
      .setIncludeFolders(false)
      .setOwnedByMe(false)
      .setSelectFolderEnabled(false);

    const picker = new window.google.picker.PickerBuilder()
      .setTitle(title)
      .setDeveloperKey(API_KEY)
      .setOAuthToken(token)
      .addView(view)
      .enableFeature(window.google.picker.Feature.SUPPORT_DRIVES)
      .setCallback((data) => {
        if (data.action === window.google.picker.Action.PICKED) {
          const picked = data.docs[0];
          resolve({
            id: picked.id,
            name: picked.name,
            mimeType: picked.mimeType,
            parents: picked.parents,
          });
        }
      })
      .build();

    picker.setVisible(true);
  });
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
  const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
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
