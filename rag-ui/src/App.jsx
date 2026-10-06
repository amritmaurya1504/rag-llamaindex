import { useState, useRef, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

function App() {
  const [files, setFiles] = useState([]);
  const [status, setStatus] = useState("idle");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [openSource, setOpenSource] = useState(null);

  const fileInputRef = useRef(null);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages, loading]);

  // =========================================================
  // FILE HANDLING
  // =========================================================

  const addFiles = (list) => {
    const newFiles = Array.from(list);

    // Only allow PDFs for now because backend currently
    // processes PDF documents.
    const pdfFiles = newFiles.filter(
      (file) =>
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf")
    );

    setFiles((prev) => {
      const existing = new Set(
        prev.map((file) => `${file.name}-${file.size}`)
      );

      const uniqueFiles = pdfFiles.filter(
        (file) => !existing.has(`${file.name}-${file.size}`)
      );

      return [...prev, ...uniqueFiles];
    });

    setStatus("idle");
  };

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setStatus("idle");
  };

  const clearFiles = () => {
    setFiles([]);
    setStatus("idle");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // =========================================================
  // INGEST DOCUMENTS
  // =========================================================

  const ingest = async () => {
    if (!files.length) return;

    setStatus("ingesting");

    try {
      const formData = new FormData();

      files.forEach((file) => {
        formData.append("files", file);
      });

      const response = await fetch(`${API}/api/ingest`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        let errorMessage = "Document ingestion failed.";

        try {
          const errorData = await response.json();

          if (typeof errorData.detail === "string") {
            errorMessage = errorData.detail;
          } else if (errorData.detail) {
            errorMessage = JSON.stringify(errorData.detail);
          }
        } catch {
          // Ignore JSON parsing error
        }

        throw new Error(errorMessage);
      }

      const data = await response.json();

      console.log("Ingestion response:", data);

      setStatus("ready");
    } catch (error) {
      console.error("Ingestion error:", error);

      setStatus("error");

      // Optional error message in chat
      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          text: `Document ingestion failed: ${
            error.message || "Unknown error"
          }`,
          sources: [],
        },
      ]);
    }
  };

  // =========================================================
  // CHAT
  // =========================================================

  const send = async () => {
    const question = input.trim();

    if (!question || loading || status !== "ready") {
      return;
    }

    // Add user message
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: question,
      },
    ]);

    setInput("");
    setLoading(true);

    try {
      const response = await fetch(`${API}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question,
        }),
      });

      if (!response.ok) {
        let errorMessage = "Chat request failed.";

        try {
          const errorData = await response.json();

          if (typeof errorData.detail === "string") {
            errorMessage = errorData.detail;
          } else if (errorData.detail) {
            errorMessage = JSON.stringify(errorData.detail);
          }
        } catch {
          // Ignore JSON parsing error
        }

        throw new Error(errorMessage);
      }

      const data = await response.json();

      console.log("Chat response:", data);

      /*
       * Backend currently returns UUID IDs:
       *
       * {
       *   id: "4aef4301-b088-...",
       *   file: "...",
       *   page: 1,
       *   score: 0.67,
       *   text: "..."
       * }
       *
       * But your answer contains [1], [2], etc.
       *
       * Therefore we assign citation numbers based on
       * source order.
       */
      const sources = (data.sources || []).map((source, index) => ({
        ...source,
        citationId: index + 1,
      }));

      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          text: data.answer || "No answer was returned.",
          sources,
        },
      ]);
    } catch (error) {
      console.error("Chat error:", error);

      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          text: `Something went wrong: ${
            error.message || "Unable to get an answer."
          }`,
          sources: [],
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // =========================================================
  // ANSWER + CITATIONS
  // =========================================================

  const renderAnswer = (text, sources, messageIndex) => {
    return text.split(/(\[\d+\])/g).map((part, index) => {
      const match = part.match(/^\[(\d+)\]$/);

      if (!match) {
        return <span key={index}>{part}</span>;
      }

      const citationId = Number(match[1]);

      const source = sources.find(
        (source) => source.citationId === citationId
      );

      const exists = Boolean(source);

      return (
        <button
          key={index}
          disabled={!exists}
          onClick={() => {
            if (!exists) return;

            setOpenSource(
              openSource === `${messageIndex}-${citationId}`
                ? null
                : `${messageIndex}-${citationId}`
            );
          }}
          className={`mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 text-xs font-semibold transition ${
            exists
              ? "bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
              : "cursor-default bg-slate-100 text-slate-400"
          }`}
        >
          {citationId}
        </button>
      );
    });
  };

  // =========================================================
  // STATUS
  // =========================================================

  const statusConfig = {
    idle: {
      text: files.length
        ? `${files.length} document${
            files.length > 1 ? "s" : ""
          } selected`
        : "No documents",
      dot: "bg-slate-400",
    },

    ingesting: {
      text: "Processing documents...",
      dot: "bg-amber-500 animate-pulse",
    },

    ready: {
      text: "Knowledge base ready",
      dot: "bg-emerald-500",
    },

    error: {
      text: "Ingestion failed",
      dot: "bg-red-500",
    },
  };

  const currentStatus = statusConfig[status];

  // =========================================================
  // RENDER
  // =========================================================

  return (
    <div className="flex h-screen overflow-hidden bg-[#f7f8fc] text-slate-900">
      {/* =====================================================
          SIDEBAR
      ====================================================== */}

      <aside className="hidden w-80 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        {/* Logo */}

        <div className="flex h-20 items-center border-b border-slate-100 px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white shadow-lg shadow-indigo-200">
              R
            </div>

            <div>
              <h1 className="font-semibold tracking-tight">
                RAG Assistant
              </h1>

              <p className="text-xs text-slate-400">
                Document intelligence
              </p>
            </div>
          </div>
        </div>

        {/* Documents */}

        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">
                Knowledge Base
              </h2>

              <p className="mt-1 text-xs text-slate-400">
                Upload documents to chat
              </p>
            </div>

            {files.length > 0 && (
              <button
                onClick={clearFiles}
                className="text-xs font-medium text-slate-400 transition hover:text-red-500"
              >
                Clear
              </button>
            )}
          </div>

          {/* Upload */}

          <label className="group flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-7 text-center transition hover:border-indigo-300 hover:bg-indigo-50/40">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white text-xl shadow-sm">
              ↑
            </div>

            <p className="text-sm font-medium">
              Upload documents
            </p>

            <p className="mt-1 text-xs text-slate-400">
              PDF documents
            </p>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(event) => {
                if (event.target.files) {
                  addFiles(event.target.files);
                }
              }}
            />
          </label>

          {/* File list */}

          {files.length > 0 && (
            <div className="mt-5 space-y-2">
              {files.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-indigo-200 hover:shadow-sm"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-sm font-semibold text-indigo-600">
                    PDF
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {file.name}
                    </p>

                    <p className="mt-0.5 text-xs text-slate-400">
                      {(file.size / 1024).toFixed(0)} KB
                    </p>
                  </div>

                  <button
                    onClick={() => removeFile(index)}
                    className="text-lg text-slate-300 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Ingest */}

        <div className="border-t border-slate-100 p-5">
          <button
            onClick={ingest}
            disabled={
              !files.length ||
              status === "ingesting"
            }
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-100 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            {status === "ingesting" ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />

                Processing...
              </>
            ) : (
              <>
                <span>✦</span>

                Build Knowledge Base
              </>
            )}
          </button>
        </div>
      </aside>

      {/* =====================================================
          MAIN
      ====================================================== */}

      <main className="flex min-w-0 flex-1 flex-col">
        {/* Header */}

        <header className="flex h-20 shrink-0 items-center justify-between border-b border-slate-200 bg-white/80 px-5 backdrop-blur lg:px-8">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Document Chat
            </h2>

            <p className="hidden text-xs text-slate-400 sm:block">
              Ask questions and get answers grounded in your
              documents
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 shadow-sm">
            <span
              className={`h-2 w-2 rounded-full ${currentStatus.dot}`}
            />

            <span className="text-xs font-medium text-slate-600">
              {currentStatus.text}
            </span>
          </div>
        </header>

        {/* Chat */}

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-8 sm:px-8">
            <div className="mx-auto max-w-3xl">
              {/* Empty state */}

              {messages.length === 0 && (
                <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
                  <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-indigo-600 text-3xl text-white shadow-xl shadow-indigo-200">
                    ✦
                  </div>

                  <h2 className="text-2xl font-semibold tracking-tight">
                    Ask your documents anything
                  </h2>

                  <p className="mt-3 max-w-md text-sm leading-6 text-slate-400">
                    Upload your documents, build the knowledge
                    base, and ask questions. Answers are generated
                    using relevant document context.
                  </p>

                  <div className="mt-7 grid w-full max-w-xl gap-3 sm:grid-cols-3">
                    {[
                      "Summarize this document",
                      "What are the key policies?",
                      "Find important dates",
                    ].map((suggestion) => (
                      <button
                        key={suggestion}
                        disabled={status !== "ready"}
                        onClick={() =>
                          setInput(suggestion)
                        }
                        className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-left text-xs font-medium text-slate-600 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Messages */}

              <div className="space-y-7">
                {messages.map(
                  (message, messageIndex) => {
                    const isUser =
                      message.role === "user";

                    return (
                      <div
                        key={messageIndex}
                        className={`flex gap-3 ${
                          isUser
                            ? "justify-end"
                            : "justify-start"
                        }`}
                      >
                        {!isUser && (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white shadow-sm">
                            R
                          </div>
                        )}

                        <div
                          className={`max-w-[85%] ${
                            isUser
                              ? "items-end"
                              : "items-start"
                          }`}
                        >
                          {/* Message */}

                          <div
                            className={`rounded-2xl px-4 py-3 text-sm leading-7 ${
                              isUser
                                ? "rounded-br-md bg-indigo-600 text-white shadow-sm"
                                : "rounded-bl-md border border-slate-200 bg-white text-slate-700 shadow-sm"
                            }`}
                          >
                            {isUser ? (
                              <p>{message.text}</p>
                            ) : (
                              <p>
                                {renderAnswer(
                                  message.text,
                                  message.sources ||
                                    [],
                                  messageIndex
                                )}
                              </p>
                            )}
                          </div>

                          {/* Sources */}

                          {!isUser &&
                            message.sources?.length >
                              0 && (
                              <div className="mt-3 w-full">
                                <div className="mb-2 flex items-center gap-2">
                                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                    Sources
                                  </span>

                                  <span className="h-px flex-1 bg-slate-200" />
                                </div>

                                <div className="space-y-2">
                                  {message.sources.map(
                                    (source) => {
                                      const key = `${messageIndex}-${source.citationId}`;

                                      const isOpen =
                                        openSource ===
                                        key;

                                      return (
                                        <div
                                          key={
                                            source.citationId
                                          }
                                          className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                                        >
                                          <button
                                            onClick={() =>
                                              setOpenSource(
                                                isOpen
                                                  ? null
                                                  : key
                                              )
                                            }
                                            className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-slate-50"
                                          >
                                            {/* Citation */}

                                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-xs font-bold text-indigo-600">
                                              {
                                                source.citationId
                                              }
                                            </span>

                                            {/* File */}

                                            <div className="min-w-0 flex-1">
                                              <p className="truncate text-xs font-semibold text-slate-700">
                                                {
                                                  source.file
                                                }
                                              </p>

                                              <p className="mt-0.5 text-[11px] text-slate-400">
                                                {source.page
                                                  ? `Page ${source.page}`
                                                  : "Document source"}
                                              </p>
                                            </div>

                                            {/* Score */}

                                            {source.score !=
                                              null && (
                                              <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-600">
                                                {Math.round(
                                                  source.score *
                                                    100
                                                )}
                                                % match
                                              </span>
                                            )}

                                            {/* Arrow */}

                                            <span className="text-xs text-slate-300">
                                              {isOpen
                                                ? "⌃"
                                                : "⌄"}
                                            </span>
                                          </button>

                                          {/* Source text */}

                                          {isOpen && (
                                            <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
                                              <p className="text-xs leading-6 text-slate-500">
                                                {
                                                  source.text
                                                }
                                              </p>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    }
                                  )}
                                </div>
                              </div>
                            )}
                        </div>
                      </div>
                    );
                  }
                )}

                {/* Loading */}

                {loading && (
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
                      R
                    </div>

                    <div className="rounded-2xl rounded-bl-md border border-slate-200 bg-white px-5 py-4 shadow-sm">
                      <div className="flex gap-1.5">
                        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.3s]" />

                        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.15s]" />

                        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300" />
                      </div>
                    </div>
                  </div>
                )}

                <div ref={endRef} />
              </div>
            </div>
          </div>

          {/* =================================================
              INPUT
          ================================================== */}

          <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-4 sm:px-8">
            <div className="mx-auto max-w-3xl">
              <div
                className={`flex items-end gap-2 rounded-2xl border bg-white p-2 shadow-sm transition ${
                  status === "ready"
                    ? "border-slate-300 focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-50"
                    : "border-slate-200"
                }`}
              >
                <textarea
                  value={input}
                  onChange={(event) =>
                    setInput(event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey
                    ) {
                      event.preventDefault();
                      send();
                    }
                  }}
                  disabled={
                    status !== "ready" || loading
                  }
                  rows={1}
                  placeholder={
                    status === "ready"
                      ? "Ask something about your documents..."
                      : "Upload and ingest documents first"
                  }
                  className="max-h-32 min-h-[42px] flex-1 resize-none bg-transparent px-3 py-2.5 text-sm text-slate-700 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
                />

                <button
                  onClick={send}
                  disabled={
                    status !== "ready" ||
                    loading ||
                    !input.trim()
                  }
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label="Send message"
                >
                  ↑
                </button>
              </div>

              <div className="mt-2 flex items-center justify-between px-1">
                <p className="text-[11px] text-slate-400">
                  AI responses are based on your uploaded
                  documents.
                </p>

                <p className="hidden text-[11px] text-slate-400 sm:block">
                  Enter to send · Shift + Enter for new line
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;