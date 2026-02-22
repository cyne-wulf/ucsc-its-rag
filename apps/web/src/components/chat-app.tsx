"use client";

import Image from "next/image";
import { useMutation } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import {
  FormEvent,
  SyntheticEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import clsx from "clsx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./chat-app.module.css";
import type { AnswerResult, SourceDocument } from "@/lib/types";
import type { Components } from "react-markdown";

type Message = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  sources?: SourceDocument[];
  fallback?: string;
};

const examplePrompts = [
  "Reset my CruzID Blue password",
  "How do I set up Duo MFA on a new phone?",
  "Get eduroam Wi-Fi on macOS",
  "Report a phishing message",
];

const markdownComponents: Components = {
  a: (props) => {
    const { node, ...rest } = props;
    void node;
    return <a {...rest} target="_blank" rel="noreferrer" />;
  },
};

function stripBracketedCitations(text: string) {
  return text.replace(/\s*\[(\d+)\]/g, "").trim();
}

async function fetchAnswer(question: string): Promise<AnswerResult> {
  const response = await fetch("/api/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });

  if (!response.ok) {
    let body: {
      error?: string;
      code?: string;
      details?: Record<string, unknown>;
    } | null = null;
    try {
      body = await response.json();
    } catch {
      const text = await response.text().catch(() => "");
      throw new Error(text || "Request failed");
    }

    const details = body?.details as Record<string, unknown> | undefined;
    const geminiMessage =
      typeof details?.["geminiMessage"] === "string"
        ? (details["geminiMessage"] as string)
        : undefined;
    const fallbackDetail =
      typeof details?.["message"] === "string"
        ? (details["message"] as string)
        : undefined;

    const parts = [
      body?.error,
      body?.code ? `[${body.code}]` : "",
      geminiMessage ?? fallbackDetail ?? "",
    ]
      .map((part) => (typeof part === "string" ? part.trim() : ""))
      .filter(Boolean);

    throw new Error(parts.join(" ") || "Request failed");
  }

  return response.json();
}

const initialMessages: Message[] = [
  {
    id: "welcome",
    role: "system",
    content:
      "Ask anything about the UCSC ITS Knowledge Base. I'll return grounded answers with citations.",
  },
];

export function ChatApp() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [selectedSource, setSelectedSource] = useState<SourceDocument | null>(
    null,
  );
  const [lastMetadata, setLastMetadata] =
    useState<AnswerResult["metadata"] | null>(null);
  const [previewState, setPreviewState] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const previewTimeoutRef = useRef<number | null>(null);
  const scrollLockRef = useRef<number | null>(null);

  const mutation = useMutation({
    mutationFn: fetchAnswer,
    onSuccess: (data) => {
      const assistantMessage: Message = {
        id: nanoid(),
        role: "assistant",
        content: stripBracketedCitations(data.answer),
        sources: data.sources,
        fallback: data.fallbackMessage,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setSelectedSource(data.sources[0] ?? null);
      setLastMetadata(data.metadata);
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!input.trim() || mutation.isPending) return;

    const text = input.trim();
    const userMessage: Message = {
      id: nanoid(),
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    mutation.mutate(text);
  };

  const previewUrl = useMemo(() => {
    if (!selectedSource) return "";
    const base = `/preview/${encodeURIComponent(selectedSource.id)}`;
    const anchor = selectedSource.anchor
      ? `?anchor=${encodeURIComponent(selectedSource.anchor)}`
      : "";
    return `${base}${anchor}`;
  }, [selectedSource]);

  const sourceUrl = useMemo(() => {
    if (!selectedSource) return "";
    const anchor = selectedSource.anchor
      ? `#${selectedSource.anchor}`
      : "";
    return `${selectedSource.url}${anchor}`;
  }, [selectedSource]);

  useEffect(() => {
    if (!previewUrl) {
      setPreviewState("idle");
      if (previewTimeoutRef.current) {
        window.clearTimeout(previewTimeoutRef.current);
        previewTimeoutRef.current = null;
      }
      scrollLockRef.current = null;
      return;
    }
    setPreviewState("loading");
    scrollLockRef.current = window.scrollY;
    if (previewTimeoutRef.current) {
      window.clearTimeout(previewTimeoutRef.current);
    }
    previewTimeoutRef.current = window.setTimeout(() => {
      setPreviewState((state) => (state === "loading" ? "error" : state));
    }, 5000);
    return () => {
      if (previewTimeoutRef.current) {
        window.clearTimeout(previewTimeoutRef.current);
        previewTimeoutRef.current = null;
      }
    };
  }, [previewUrl]);

  const handleIframeLoad = (event: SyntheticEvent<HTMLIFrameElement>) => {
    try {
      const doc = event.currentTarget.contentDocument;
      const status = doc?.body?.dataset?.previewStatus;
      if (status === "error") {
        setPreviewState("error");
        return;
      }
    } catch {
      // ignore access errors – treat as loaded
    }
    if (previewTimeoutRef.current) {
      window.clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = null;
    }
    setPreviewState("loaded");
    if (scrollLockRef.current !== null) {
      const locked = scrollLockRef.current;
      scrollLockRef.current = null;
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: locked });
      });
    }
    try {
      event.currentTarget.blur();
    } catch {
      // ignore
    }
  };

  const renderMessageContent = (message: Message) => {
    if (message.role === "assistant" || message.role === "system") {
      return (
        <div className={styles.markdown}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      );
    }
    return <p className={styles.userText}>{message.content}</p>;
  };

  const latestSources =
    messages
      .slice()
      .reverse()
      .find((msg) => msg.role === "assistant" && msg.sources)?.sources ?? [];

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Image
            src="/slug.svg"
            alt="Sammy the Slug mascot"
            className={styles.slug}
            width={56}
            height={56}
            priority
          />
          <div>
            <div className={styles.title}>UCSC ITS Support AI</div>
            <p className={styles.description}>
              Retrieval-augmented answers from the official ITS Knowledge Base
              with citations and instant previews.
            </p>
          </div>
        </div>
        <span className={styles.badge}>INTERNAL DEMO</span>
      </header>

      <div className={styles.grid}>
        <section className={clsx(styles.panel, styles.chatPanel)}>
          <div className={styles.examples}>
            {examplePrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className={styles.exampleButton}
                onClick={() => setInput(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>

          <div className={styles.messageList}>
            {messages.map((message) => {
              const roleClass =
                message.role === "user"
                  ? styles.user
                  : message.role === "assistant"
                    ? styles.assistant
                    : styles.system;
              return (
                <article
                  key={message.id}
                  className={clsx(styles.message, roleClass)}
                >
                  {renderMessageContent(message)}
                </article>
              );
            })}
            {mutation.isPending && (
              <article className={clsx(styles.message, styles.assistant)}>
                Thinking through the retrieved policies…
              </article>
            )}
          </div>

          {mutation.isError && (
            <div className={styles.error}>
              {mutation.error instanceof Error
                ? mutation.error.message
                : "Something went wrong."}
            </div>
          )}

          <form className={styles.composer} onSubmit={handleSubmit}>
            <textarea
              className={styles.textarea}
              placeholder="Describe the ITS problem you're trying to solve…"
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
            <button
              type="submit"
              className={styles.submitButton}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Answering…" : "Ask"}
            </button>
          </form>

          {latestSources.length > 0 && (
            <div className={styles.sourceList}>
              {latestSources.map((source, index) => {
                const label = `${index + 1}. ${source.title}`;
                const active = selectedSource?.id === source.id;
                return (
                  <button
                    key={source.id}
                    type="button"
                    className={clsx(
                      styles.sourceChip,
                      active && styles.sourceChipActive,
                    )}
                    onClick={() => setSelectedSource(source)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          <div className={styles.metaRow}>
            <span className={styles.status}>
              {mutation.isPending
                ? "Retrieving KB snippets…"
                : "Ready for your next question"}
            </span>
            {lastMetadata && (
              <>
                <span>Latency: {lastMetadata.latencyMs ?? 0} ms</span>
                <span>Snippets searched: {lastMetadata.retrievalCount}</span>
                <span>
                  Cache: {lastMetadata.cached ? "hit" : "miss"}
                </span>
              </>
            )}
          </div>

          {messages[messages.length - 1]?.fallback && (
            <div className={styles.fallbackBox}>
              {messages[messages.length - 1]?.fallback}
            </div>
          )}
        </section>

        <section className={clsx(styles.panel, styles.previewPanel)}>
          <div className={styles.previewToolbar}>
            <div>
              <p className={styles.previewLabel}>Source preview</p>
              <h3 className={styles.previewHeading}>
                {selectedSource
                  ? selectedSource.title
                  : "Latest citation preview will appear here after you ask a question"}
              </h3>
            </div>
            <div className={styles.previewActions}>
              {sourceUrl ? (
                <a
                  className={styles.linkButton}
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open help article ↗
                </a>
              ) : (
                <span
                  className={clsx(
                    styles.linkButton,
                    styles.linkButtonDisabled,
                  )}
                  aria-disabled="true"
                >
                  Open help article ↗
                </span>
              )}
            </div>
          </div>
          {previewUrl ? (
            <iframe
              key={previewUrl}
              ref={iframeRef}
              className={styles.previewFrame}
              src={previewUrl}
              title="ITS Knowledge Base preview"
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
              tabIndex={-1}
              onLoad={handleIframeLoad}
              onError={() => setPreviewState("error")}
            />
          ) : (
            <div className={styles.previewPlaceholder}>
              Ask a question to load the latest source preview below. You can
              still open the original article while it loads.
            </div>
          )}
          {previewUrl && previewState === "loading" && (
            <div className={styles.previewLoading}>Loading preview…</div>
          )}
          {previewState === "error" && (
            <div className={styles.previewAlert}>
              We couldn’t render this preview quickly. Use “Open help article”
              to view the original source.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
