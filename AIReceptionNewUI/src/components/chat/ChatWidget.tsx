import React, { useEffect, useMemo, useRef, useState } from "react";
import API_URLS from "../../config/urls";
import "./ChatWidget.css";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const STORAGE_KEY = "s4u_chat_conversation_id";
const MAX_MESSAGE_LENGTH = 1500;
const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content: "Hi! I'm the SmartConnect4u Assistant. Ask about products, pricing, or book a quick demo—I'll keep it concise."
};
const HANDOFF_KEYWORDS = ["agent", "human", "live support", "live agent", "real person", "representative"];

const StatusDot: React.FC<{ status: "online" | "idle" }> = ({ status }) => (
  <span className={`chat-status-dot chat-status-${status}`} aria-label={status === "online" ? "Online" : "Idle"} />
);

function nowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

const ChatWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [handoffPending, setHandoffPending] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const decoderRef = useRef<TextDecoder | null>(null);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (stored) {
      setConversationId(stored);
    }
  }, []);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  const status = useMemo<"online" | "idle">(() => (isStreaming ? "online" : "online"), [isStreaming]);

  const toggleOpen = () => {
    setIsOpen((open) => {
      const next = !open;
      console.log("[chat-widget] toggle", { open: next });
      return next;
    });
  };

  const handleNewConversation = () => {
    console.log("[chat-widget] new conversation");
    setMessages([WELCOME]);
    setConversationId(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text) return;
    if (text.length > MAX_MESSAGE_LENGTH) {
      setError(`Message is too long (max ${MAX_MESSAGE_LENGTH} characters).`);
      return;
    }
    console.log("[chat-widget] send", { length: text.length });

    const userMessage: ChatMessage = { id: nowId("user"), role: "user", content: text };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setError(null);

    const isHandoff = HANDOFF_KEYWORDS.some((k) => text.toLowerCase().includes(k));
    if (isHandoff) {
      setIsSending(true);
      setIsStreaming(false);
      await triggerHandoff(userMessage);
      return;
    }

    setIsSending(true);
    setIsStreaming(true);

    const body = {
      conversationId,
      message: text,
      pageUrl: typeof window !== "undefined" ? window.location.href : undefined
    };

    controllerRef.current = new AbortController();
    let assistantText = "";
    const assistantId = nowId("assistant");
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);

    try {
      const res = await fetch(API_URLS.chat, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controllerRef.current.signal
      });

      const newConversation = res.headers.get("x-conversation-id");
      if (newConversation) {
        setConversationId(newConversation);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(STORAGE_KEY, newConversation);
        }
      }

      if (!res.ok || !res.body) {
        const fallback = "Sorry, something went wrong. Try again.";
        setError(fallback);
        setInput(text);
        setMessages((prev) =>
          prev.map((msg) => (msg.id === assistantId ? { ...msg, content: fallback } : msg))
        );
        console.log("[chat-widget] send failed", { status: res.status });
        setIsStreaming(false);
        setIsSending(false);
        return;
      }

      const reader = res.body.getReader();
      if (!decoderRef.current) {
        decoderRef.current = new TextDecoder();
      }
      const decoder = decoderRef.current;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;
        assistantText += chunk;
        setMessages((prev) =>
          prev.map((msg) => (msg.id === assistantId ? { ...msg, content: assistantText } : msg))
        );
      }
    } catch (err) {
      console.error("[chat-widget] send error", err);
      const fallback = "Sorry, something went wrong. Try again.";
      setInput(text);
      setError(fallback);
      setMessages((prev) => prev.map((msg) => (msg.id === assistantId ? { ...msg, content: fallback } : msg)));
    } finally {
      setIsSending(false);
      setIsStreaming(false);
      controllerRef.current = null;
    }
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const bubbleText = isOpen ? "Hide assistant" : "Ask SmartConnect4u";

  const triggerHandoff = async (userMessage: ChatMessage) => {
    if (handoffPending) return;
    setHandoffPending(true);
    const payload = {
      name: "",
      email: "",
      company: "",
      message: userMessage.content,
      conversation: [...messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content
      }))
    };

    try {
      await fetch(API_URLS.liveHandoff, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      setMessages((prev) => [
        ...prev,
        {
          id: nowId("assistant"),
          role: "assistant",
          content: "I’m handing you off to a live agent now. They’ll respond shortly in this chat or via the contact details you shared."
        }
      ]);
    } catch (err) {
      console.error("[chat-widget] handoff failed", err);
      setMessages((prev) => [
        ...prev,
        {
          id: nowId("assistant"),
          role: "assistant",
          content: "Sorry, I couldn’t reach a live agent right now. Please try again or provide an email to reach you."
        }
      ]);
    } finally {
      setHandoffPending(false);
      setIsSending(false);
      setIsStreaming(false);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label={bubbleText}
        className="chat-launcher"
        onClick={toggleOpen}
        data-open={isOpen}
      >
        <span className="chat-launcher-glow" />
        <span className="chat-launcher-icon">✦</span>
        <span className="chat-launcher-label">{bubbleText}</span>
      </button>

      <div className={`chat-shell ${isOpen ? "chat-open" : ""}`} role="dialog" aria-label="SmartConnect4u Assistant">
        <div className="chat-card">
          <header className="chat-header">
            <div className="chat-header-left">
              <div className="chat-avatar">S4U</div>
              <div className="chat-title">
                <div className="chat-subtitle">
                  <StatusDot status={status} /> {status === "online" ? "Online" : "Idle"}
                </div>
              </div>
            </div>
            <div className="chat-header-actions">
              <button type="button" className="chat-secondary-btn" onClick={handleNewConversation}>
                New chat
              </button>
              <button type="button" className="chat-icon-btn" onClick={toggleOpen} aria-label="Close chat">
                ✕
              </button>
            </div>
          </header>

          <div className="chat-body">
            <div className="chat-messages" ref={listRef}>
              {messages.map((msg) => (
                <div key={msg.id} className={`chat-bubble ${msg.role}`}>
                  <div className="chat-bubble-label">{msg.role === "assistant" ? "Assistant" : "You"}</div>
                  <div className="chat-bubble-body">{msg.content}</div>
                </div>
              ))}
              {isStreaming && (
                <div className="chat-bubble assistant typing">
                  <div className="chat-bubble-label">Assistant</div>
                  <div className="chat-typing">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="chat-error">
                {error}{" "}
                <button type="button" onClick={sendMessage} className="chat-inline-btn" disabled={isSending}>
                  Retry
                </button>
              </div>
            )}
          </div>

          <footer className="chat-footer">
            <textarea
              className="chat-input"
              placeholder="Ask about pricing, features, or book a demo…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={MAX_MESSAGE_LENGTH}
              rows={3}
            />
            <button type="button" className="chat-send-btn" onClick={sendMessage} disabled={isSending}>
              {isSending ? "Sending…" : "Send"}
            </button>
          </footer>
        </div>
      </div>
    </>
  );
};

export default ChatWidget;
