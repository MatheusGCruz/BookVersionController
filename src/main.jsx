import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlignLeft,
  Bold,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  FolderOpen,
  Italic,
  MessageSquarePlus,
  Save,
  Search,
  Settings,
  Underline,
  X,
} from "lucide-react";
import {
  ensureVersionsFile,
  getDriveUser,
  listDriveTextFiles,
  loadDriveApis,
  readDriveTextFile,
  saveDriveTextFile,
  signInToDrive,
} from "./services/drive.js";
import "./styles.css";

const initialLines = [
  "Chapter 1",
  "",
  "The first draft waits here, ready to become something sharper.",
  "Select a line, add a comment, or propose a replacement.",
].join("\n");

const fonts = ["Georgia", "Inter", "Arial", "Times New Roman", "Courier New"];
const sizes = [14, 16, 18, 20, 24, 28, 32];

function parseVersionsFile(text) {
  const commentsMatch = text.match(/<comments>([\s\S]*?)<\/comments>/);
  const versions = [...text.matchAll(/<version\s+([^>]*)>([\s\S]*?)<\/version>/g)].map((match) => ({
    attrs: match[1],
    content: decodeURIComponent(match[2].trim()),
  }));

  let comments = [];
  if (commentsMatch?.[1]?.trim()) {
    try {
      comments = JSON.parse(commentsMatch[1]);
    } catch {
      comments = [];
    }
  }

  return { comments, versions };
}

function buildVersionsFile({ bookName, versionLabel, mainText, comments, previousVersionsText }) {
  const existing = previousVersionsText ? parseVersionsFile(previousVersionsText).versions : [];
  const versionNumber = existing.length + 1;
  const timestamp = new Date().toISOString();
  const versions = [
    ...existing,
    {
      attrs: `number="${versionNumber}" label="${escapeAttr(versionLabel)}" savedAt="${timestamp}"`,
      content: mainText,
    },
  ];

  return [
    `<book name="${escapeAttr(bookName)}">`,
    "<comments>",
    JSON.stringify(comments, null, 2),
    "</comments>",
    ...versions.map((version) => `<version ${version.attrs}>\n${encodeURIComponent(version.content)}\n</version>`),
    "</book>",
  ].join("\n");
}

function escapeAttr(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [bookText, setBookText] = useState(initialLines);
  const [comments, setComments] = useState([]);
  const [selectedLine, setSelectedLine] = useState(1);
  const [commentType, setCommentType] = useState("comment");
  const [commentText, setCommentText] = useState("");
  const [proposalText, setProposalText] = useState("");
  const [bookName, setBookName] = useState("Untitled Book");
  const [versionLabel, setVersionLabel] = useState("Draft 1");
  const [fontFamily, setFontFamily] = useState("Georgia");
  const [fontSize, setFontSize] = useState(18);
  const [sourceUrl, setSourceUrl] = useState("https://www.google.com/search?igu=1&q=writing%20research");
  const [searchQuery, setSearchQuery] = useState("writing research");
  const [driveStatus, setDriveStatus] = useState("Each user logs in with their own Google Drive");
  const [driveUser, setDriveUser] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("book-editor-theme") || "light");
  const [secondaryColor, setSecondaryColor] = useState(
    () => localStorage.getItem("book-editor-secondary-color") || "#256b5c",
  );
  const [mainFile, setMainFile] = useState(null);
  const [versionsFile, setVersionsFile] = useState(null);
  const [versionsRaw, setVersionsRaw] = useState("");
  const [fileDialog, setFileDialog] = useState({
    open: false,
    title: "",
    query: "",
    files: [],
    loading: false,
  });
  const editorRef = useRef(null);
  const fileDialogResolver = useRef(null);

  const lines = useMemo(() => bookText.split("\n"), [bookText]);
  const lineComments = useMemo(
    () => comments.filter((comment) => comment.lineNumber === selectedLine),
    [comments, selectedLine],
  );
  const commentCountsByLine = useMemo(
    () =>
      comments.reduce((counts, comment) => {
        counts[comment.lineNumber] = (counts[comment.lineNumber] || 0) + 1;
        return counts;
      }, {}),
    [comments],
  );

  useEffect(() => {
    localStorage.setItem("book-editor-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("book-editor-secondary-color", secondaryColor);
  }, [secondaryColor]);

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerText = initialLines;
    }
  }, []);

  async function connectDrive() {
    try {
      setDriveStatus("Choose your Google Drive account...");
      await loadDriveApis();
      await signInToDrive({ chooseAccount: true });
      const user = await getDriveUser();
      setDriveUser(user.emailAddress || user.displayName || "");
      setDriveStatus(`Connected to ${user.emailAddress || user.displayName}`);
    } catch (error) {
      setDriveStatus(error.message);
    }
  }

  async function openMainFromDrive() {
    try {
      setDriveStatus("Opening principal txt file...");
      await loadDriveApis();
      await signInToDrive();
      const user = await getDriveUser();
      setDriveUser(user.emailAddress || user.displayName || "");
      const file = await chooseDriveTextFile("Choose the principal .txt book file");
      const text = await readDriveTextFile(file.id);
      const derivedName = file.name.replace(/\.txt$/i, "");
      setMainFile(file);
      setBookName(derivedName);
      setBookText(text);

      const versions = await ensureVersionsFile(file);
      setVersionsFile(versions);
      if (versions?.id) {
        const versionsText = await readDriveTextFile(versions.id);
        const parsed = parseVersionsFile(versionsText);
        setVersionsRaw(versionsText);
        setComments(parsed.comments);
        setVersionLabel(`Draft ${parsed.versions.length + 1}`);
      }
      setDriveStatus(`Loaded ${file.name}`);
    } catch (error) {
      setDriveStatus(error.message);
    }
  }

  async function openVersionsFromDrive() {
    try {
      setDriveStatus("Opening versions txt file...");
      await loadDriveApis();
      await signInToDrive();
      const user = await getDriveUser();
      setDriveUser(user.emailAddress || user.displayName || "");
      const file = await chooseDriveTextFile("Choose the versions/commentary .txt file");
      const text = await readDriveTextFile(file.id);
      const parsed = parseVersionsFile(text);
      setVersionsFile(file);
      setVersionsRaw(text);
      setComments(parsed.comments);
      setVersionLabel(`Draft ${parsed.versions.length + 1}`);
      setDriveStatus(`Loaded ${file.name}`);
    } catch (error) {
      setDriveStatus(error.message);
    }
  }

  async function chooseDriveTextFile(title) {
    const files = await listDriveTextFiles();
    setFileDialog({ open: true, title, query: "", files, loading: false });

    return new Promise((resolve, reject) => {
      fileDialogResolver.current = { resolve, reject };
    });
  }

  async function refreshDriveFiles(query) {
    setFileDialog((dialog) => ({ ...dialog, query, loading: true }));
    try {
      const files = await listDriveTextFiles(query);
      setFileDialog((dialog) => ({ ...dialog, files, loading: false }));
    } catch (error) {
      setFileDialog((dialog) => ({ ...dialog, files: [], loading: false }));
      setDriveStatus(error.message);
    }
  }

  function selectDriveFile(file) {
    fileDialogResolver.current?.resolve(file);
    fileDialogResolver.current = null;
    setFileDialog((dialog) => ({ ...dialog, open: false }));
  }

  function closeDriveFileDialog() {
    fileDialogResolver.current?.reject(new Error("File selection canceled"));
    fileDialogResolver.current = null;
    setFileDialog((dialog) => ({ ...dialog, open: false }));
  }

  async function saveToDrive() {
    try {
      if (!mainFile) {
        setDriveStatus("Open the principal txt file first");
        return;
      }

      setDriveStatus("Saving book and versions...");
      const activeVersionsFile = versionsFile?.id ? versionsFile : await ensureVersionsFile(mainFile);
      const versionsText = buildVersionsFile({
        bookName,
        versionLabel,
        mainText: bookText,
        comments,
        previousVersionsText: versionsRaw,
      });

      await saveDriveTextFile(mainFile.id, bookText);
      await saveDriveTextFile(activeVersionsFile.id, versionsText);
      setVersionsFile(activeVersionsFile);
      setVersionsRaw(versionsText);
      setVersionLabel(`Draft ${parseVersionsFile(versionsText).versions.length + 1}`);
      setDriveStatus(`Saved ${mainFile.name} and ${activeVersionsFile.name}`);
    } catch (error) {
      setDriveStatus(error.message);
    }
  }

  function applyFormatting(command, value = null) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    setBookText(editorRef.current.innerText.replace(/\n\n/g, "\n"));
  }

  function updateLineSelection(event) {
    const selection = window.getSelection();
    if (!selection?.anchorNode || !editorRef.current?.contains(selection.anchorNode)) return;

    const range = selection.getRangeAt(0);
    const preRange = range.cloneRange();
    preRange.selectNodeContents(editorRef.current);
    preRange.setEnd(range.endContainer, range.endOffset);
    const lineNumber = preRange.toString().split("\n").length;
    setSelectedLine(Math.max(1, lineNumber));
  }

  function addComment() {
    if (!commentText.trim() && !proposalText.trim()) return;
    setComments((existing) => [
      ...existing,
      {
        id: crypto.randomUUID(),
        lineNumber: selectedLine,
        type: commentType,
        comment: commentText.trim(),
        proposal: commentType === "proposal" ? proposalText.trim() : "",
        original: lines[selectedLine - 1] ?? "",
        createdAt: new Date().toISOString(),
      },
    ]);
    setCommentText("");
    setProposalText("");
  }

  function acceptProposal(comment) {
    const nextLines = [...lines];
    nextLines[comment.lineNumber - 1] = comment.proposal;
    setBookText(nextLines.join("\n"));
    setComments((existing) =>
      existing.map((item) =>
        item.id === comment.id
          ? {
              ...item,
              type: "comment",
              comment: `Original version: ${comment.original}`,
              proposal: "",
              original: comment.proposal,
            }
          : item,
      ),
    );
  }

  function submitSearch(event) {
    event.preventDefault();
    setSourceUrl(`https://www.google.com/search?igu=1&q=${encodeURIComponent(searchQuery)}`);
  }

  return (
    <div
      className={theme === "dark" ? "app-shell dark-theme" : "app-shell"}
      style={{ "--secondary-color": secondaryColor }}
    >
      <aside className={sidebarOpen ? "sidebar" : "sidebar collapsed"}>
        <button className="collapse-button" onClick={() => setSidebarOpen((value) => !value)} title="Toggle comments">
          {sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
        {sidebarOpen && (
          <>
            <div className="panel-heading">
              <MessageSquarePlus size={18} />
              <span>Line commentary</span>
            </div>
            <div className="line-picker">
              <label>Line</label>
              <input
                type="number"
                min="1"
                max={Math.max(1, lines.length)}
                value={selectedLine}
                onChange={(event) => setSelectedLine(Number(event.target.value))}
              />
            </div>
            <div className="comment-flags">
              <button className={commentType === "comment" ? "active" : ""} onClick={() => setCommentType("comment")}>
                Commentary
              </button>
              <button className={commentType === "proposal" ? "active" : ""} onClick={() => setCommentType("proposal")}>
                Alter proposition
              </button>
            </div>
            <textarea
              className="comment-input"
              placeholder="Commentary"
              value={commentText}
              onChange={(event) => setCommentText(event.target.value)}
            />
            {commentType === "proposal" && (
              <textarea
                className="comment-input proposal"
                placeholder="Replacement line"
                value={proposalText}
                onChange={(event) => setProposalText(event.target.value)}
              />
            )}
            <button className="primary-action" onClick={addComment}>
              <MessageSquarePlus size={16} />
              Add
            </button>
            <div className="comment-list">
              {lineComments.map((comment) => (
                <article key={comment.id} className="comment-card">
                  <div className="comment-card-top">
                    <span>{comment.type === "proposal" ? "Alter proposition" : "Commentary"}</span>
                    <small>Line {comment.lineNumber}</small>
                  </div>
                  <p>{comment.comment}</p>
                  {comment.proposal && <blockquote>{comment.proposal}</blockquote>}
                  {comment.type === "proposal" && (
                    <button className="accept-button" onClick={() => acceptProposal(comment)}>
                      <Check size={15} />
                      Change line
                    </button>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
      </aside>

      <main className="editor-column">
        <header className="drive-bar">
          <div className="drive-actions">
            <button onClick={connectDrive}>
              <ExternalLink size={16} />
              Login
            </button>
            <button onClick={openMainFromDrive}>
              <FolderOpen size={16} />
              Principal txt
            </button>
            <button onClick={openVersionsFromDrive}>
              <FileText size={16} />
              Versions txt
            </button>
            <button className="save-button" onClick={saveToDrive}>
              <Save size={16} />
              Save
            </button>
            <span>{driveStatus}</span>
          </div>
          <div className="settings-menu">
            <button className="icon-button" onClick={() => setSettingsOpen((value) => !value)} title="Settings">
              <Settings size={17} />
            </button>
            {settingsOpen && (
              <div className="settings-popover" role="menu">
                <label className="settings-field">
                  <span>Theme</span>
                  <select value={theme} onChange={(event) => setTheme(event.target.value)}>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </label>
                <label className="settings-field color-field">
                  <span>Secondary color</span>
                  <input
                    type="color"
                    value={secondaryColor}
                    onChange={(event) => setSecondaryColor(event.target.value)}
                  />
                </label>
              </div>
            )}
          </div>
        </header>

        <section className="metadata-row">
          <input value={bookName} onChange={(event) => setBookName(event.target.value)} aria-label="Book name" />
          <input value={versionLabel} onChange={(event) => setVersionLabel(event.target.value)} aria-label="Version" />
        </section>

        <nav className="toolbar" aria-label="Text toolbar">
          <button title="Bold" onClick={() => applyFormatting("bold")}>
            <Bold size={17} />
          </button>
          <button title="Italic" onClick={() => applyFormatting("italic")}>
            <Italic size={17} />
          </button>
          <button title="Underline" onClick={() => applyFormatting("underline")}>
            <Underline size={17} />
          </button>
          <button title="Align left" onClick={() => applyFormatting("justifyLeft")}>
            <AlignLeft size={17} />
          </button>
          <select value={fontFamily} onChange={(event) => setFontFamily(event.target.value)}>
            {fonts.map((font) => (
              <option key={font}>{font}</option>
            ))}
          </select>
          <select value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))}>
            {sizes.map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>
        </nav>

        <section className="canvas">
          <div className="line-gutter">
            {lines.map((_, index) => (
              <button
                key={index}
                className={selectedLine === index + 1 ? "selected" : ""}
                onClick={() => setSelectedLine(index + 1)}
                title={`Line ${index + 1}`}
              >
                <span>{index + 1}</span>
                {commentCountsByLine[index + 1] ? (
                  <strong className="comment-badge">
                    {commentCountsByLine[index + 1] >= 10 ? "+" : commentCountsByLine[index + 1]}
                  </strong>
                ) : null}
              </button>
            ))}
          </div>
          <div
            ref={editorRef}
            className="editor"
            contentEditable
            suppressContentEditableWarning
            style={{ fontFamily, fontSize }}
            onInput={(event) => setBookText(event.currentTarget.innerText)}
            onClick={updateLineSelection}
            onKeyUp={updateLineSelection}
            dangerouslySetInnerHTML={{ __html: bookText }}
          />
        </section>

        <footer className="book-footer">
          <span>{bookName}</span>
          <span>{versionLabel}</span>
        </footer>
      </main>

      <aside className="research-pane">
        <form className="search-bar" onSubmit={submitSearch}>
          <Search size={17} />
          <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} aria-label="Search" />
          <button>Go</button>
        </form>
        <iframe title="Research webpage" src={sourceUrl} sandbox="allow-scripts allow-forms allow-same-origin allow-popups" />
      </aside>

      {fileDialog.open && (
        <div className="modal-backdrop" role="presentation">
          <section className="file-dialog" role="dialog" aria-modal="true" aria-label={fileDialog.title}>
            <header className="file-dialog-header">
              <strong>{fileDialog.title}</strong>
              <button className="icon-button" onClick={closeDriveFileDialog} title="Close">
                <X size={17} />
              </button>
            </header>
            <div className="file-search">
              <Search size={17} />
              <input
                value={fileDialog.query}
                onChange={(event) => refreshDriveFiles(event.target.value)}
                placeholder="Search txt files"
                aria-label="Search Drive text files"
              />
            </div>
            <div className="file-list">
              {fileDialog.loading && <p>Loading...</p>}
              {!fileDialog.loading && fileDialog.files.length === 0 && <p>No txt files found</p>}
              {fileDialog.files.map((file) => (
                <button key={file.id} className="file-row" onClick={() => selectDriveFile(file)}>
                  <FileText size={17} />
                  <span>
                    <strong>{file.name}</strong>
                    <small>
                      {file.owners?.[0]?.emailAddress || file.owners?.[0]?.displayName || "Shared file"}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
