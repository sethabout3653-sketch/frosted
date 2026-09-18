import React, { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  Send,
  User,
  Trash2,
  Copy,
  Check,
  RotateCcw,
  Plus,
  Code2,
  Lightbulb,
  BookOpen,
  HelpCircle,
  ArrowUp,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

const SUGGESTIONS = [
  {
    icon: Lightbulb,
    title: "Explain a concept",
    prompt: "Explain how photosyntheses works in simple, easy-to-understand terms.",
  },
  {
    icon: Code2,
    title: "Write or fix code",
    prompt: "Write a JavaScript function to reverse a string and explain how it works.",
  },
  {
    icon: BookOpen,
    title: "Summarize & study",
    prompt: "Give me 5 key bullet points summarizing the causes of the Industrial Revolution.",
  },
  {
    icon: HelpCircle,
    title: "Solve a math problem",
    prompt: "How do I solve 2x + 5 = 15 step by step?",
  },
];

// Helper to auto-determine high-speed, high-performance model based on prompt
function pickAutoModel(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (
    lower.includes("code") ||
    lower.includes("javascript") ||
    lower.includes("python") ||
    lower.includes("function") ||
    lower.includes("bug") ||
    lower.includes("html") ||
    lower.includes("css") ||
    lower.includes("react")
  ) {
    return "qwen/qwen-2.5-coder-32b-instruct:free";
  }
  if (
    lower.includes("math") ||
    lower.includes("solve") ||
    lower.includes("calculate") ||
    lower.includes("equation")
  ) {
    return "deepseek/deepseek-chat:free";
  }
  if (lower.length > 300) {
    return "meta-llama/llama-3.3-70b-instruct:free";
  }
  return "openrouter/free";
}

export default function AiAssistant() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem("frosted_ai_chat_history");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  const [inputPrompt, setInputPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [copiedCodeSnippet, setCopiedCodeSnippet] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-save history
  useEffect(() => {
    try {
      localStorage.setItem("frosted_ai_chat_history", JSON.stringify(messages));
    } catch {}
  }, [messages]);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputPrompt(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputPrompt).trim();
    if (!text || isLoading) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: Date.now(),
    };

    const newHistory = [...messages, userMessage];
    setMessages(newHistory);
    setInputPrompt("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    setIsLoading(true);

    const autoModel = pickAutoModel(text);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: newHistory.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          model: autoModel,
          systemPrompt:
            "You are a helpful, clear, and friendly AI assistant. Give articulate, well-structured answers using clean Markdown. Format code snippets with proper language tags.",
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.text || "I was unable to generate a response. Please try again.",
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      const errorMessage: ChatMessage = {
        id: `assistant-err-${Date.now()}`,
        role: "assistant",
        content: "I ran into a temporary connection issue. Please click retry or send your message again.",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleNewChat = () => {
    setMessages([]);
    setInputPrompt("");
    try {
      localStorage.removeItem("frosted_ai_chat_history");
    } catch {}
  };

  const handleCopyMessage = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMessageId(id);
    setTimeout(() => setCopiedMessageId(null), 2000);
  };

  const handleCopyCode = (snippet: string) => {
    navigator.clipboard.writeText(snippet);
    setCopiedCodeSnippet(snippet);
    setTimeout(() => setCopiedCodeSnippet(null), 2000);
  };

  const handleRegenerate = () => {
    if (messages.length === 0 || isLoading) return;

    // Find last user message
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (lastUserMsg) {
      handleSendMessage(lastUserMsg.content);
    }
  };

  // Render Markdown code blocks and paragraphs cleanly
  const renderMessageContent = (content: string) => {
    const parts = content.split(/(```[\s\S]*?```)/g);

    return parts.map((part, index) => {
      if (part.startsWith("```") && part.endsWith("```")) {
        const lines = part.slice(3, -3).split("\n");
        const language = lines[0].trim() || "code";
        const codeText = lines.slice(1).join("\n");
        const isCopied = copiedCodeSnippet === codeText;

        return (
          <div
            key={index}
            style={{
              backgroundColor: "rgba(0, 0, 0, 0.45)",
              borderColor: "var(--theme-border)",
            }}
            className="my-3 overflow-hidden rounded-xl border text-xs font-mono shadow-md"
          >
            <div
              style={{
                backgroundColor: "rgba(255, 255, 255, 0.04)",
                borderColor: "var(--theme-border)",
              }}
              className="flex items-center justify-between border-b px-3.5 py-2 text-[11px] text-neutral-400"
            >
              <span className="font-semibold uppercase tracking-wider text-neutral-300">{language}</span>
              <button
                type="button"
                onClick={() => handleCopyCode(codeText)}
                className="flex items-center gap-1 hover:text-white transition-colors cursor-pointer"
              >
                {isCopied ? (
                  <>
                    <Check size={13} className="text-[var(--theme-text-accent)]" />
                    <span className="text-[var(--theme-text-accent)] font-medium">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy size={13} />
                    <span>Copy code</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-4 overflow-x-auto text-neutral-200 leading-relaxed font-mono">
              <code>{codeText}</code>
            </pre>
          </div>
        );
      }

      // Regular markdown-like text
      const lines = part.split("\n");
      return (
        <div key={index} className="space-y-2">
          {lines.map((line, lIdx) => {
            if (!line.trim()) return <div key={lIdx} className="h-1.5" />;

            // Bullet points
            if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
              const cleanLine = line.trim().substring(2);
              return (
                <div key={lIdx} className="flex items-start gap-2 pl-2">
                  <span className="text-[var(--theme-text-accent)] mt-1.5 text-[8px]">&bull;</span>
                  <p className="flex-1 text-neutral-200 leading-relaxed">{formatInlineText(cleanLine)}</p>
                </div>
              );
            }

            // Headings
            if (line.startsWith("### ")) {
              return (
                <h3 key={lIdx} className="text-sm font-bold text-white mt-3 mb-1">
                  {line.replace("### ", "")}
                </h3>
              );
            }
            if (line.startsWith("## ")) {
              return (
                <h2 key={lIdx} className="text-base font-bold text-white mt-4 mb-1">
                  {line.replace("## ", "")}
                </h2>
              );
            }
            if (line.startsWith("# ")) {
              return (
                <h1 key={lIdx} className="text-lg font-bold text-white mt-4 mb-2">
                  {line.replace("# ", "")}
                </h1>
              );
            }

            return (
              <p key={lIdx} className="text-neutral-200 leading-relaxed">
                {formatInlineText(line)}
              </p>
            );
          })}
        </div>
      );
    });
  };

  // Inline formatting helper for bold / code inline
  const formatInlineText = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
    return parts.map((chunk, idx) => {
      if (chunk.startsWith("**") && chunk.endsWith("**")) {
        return (
          <strong key={idx} className="font-semibold text-white">
            {chunk.slice(2, -2)}
          </strong>
        );
      }
      if (chunk.startsWith("`") && chunk.endsWith("`")) {
        return (
          <code
            key={idx}
            style={{
              backgroundColor: "rgba(255, 255, 255, 0.08)",
              borderColor: "var(--theme-border)",
            }}
            className="px-1.5 py-0.5 rounded border text-[11px] font-mono text-neutral-200"
          >
            {chunk.slice(1, -1)}
          </code>
        );
      }
      return chunk;
    });
  };

  return (
    <div className="flex-1 w-full h-full flex flex-col bg-transparent overflow-hidden text-neutral-100 select-text">
      {/* Top Header Bar */}
      <header
        style={{
          backgroundColor: "var(--theme-darkest)",
          borderColor: "var(--theme-border)",
        }}
        className="flex-none border-b px-4 py-3 flex items-center justify-between gap-4 backdrop-blur-md"
      >
        <div className="flex items-center gap-2.5">
          <div
            style={{
              backgroundColor: "var(--theme-accent)",
              borderColor: "var(--theme-border)",
            }}
            className="w-8 h-8 rounded-xl border flex items-center justify-center text-white shadow-sm"
          >
            <Sparkles size={16} />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white tracking-wide">Assistant</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleNewChat}
            style={{
              backgroundColor: "var(--theme-darker)",
              borderColor: "var(--theme-border)",
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium text-neutral-200 hover:text-white hover:bg-white/10 transition-all cursor-pointer shadow-sm"
          >
            <Plus size={14} />
            <span>New chat</span>
          </button>

          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleNewChat}
              title="Clear chat history"
              className="p-2 rounded-xl text-neutral-400 hover:text-red-400 hover:bg-white/5 transition-colors cursor-pointer"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </header>

      {/* Main Conversation Canvas */}
      <div className="flex-1 overflow-y-auto px-4 py-6 custom-scrollbar">
        {messages.length === 0 ? (
          /* Empty Initial State - ChatGPT / Gemini style centered welcome */
          <div className="max-w-2xl mx-auto h-full min-h-[420px] flex flex-col items-center justify-center text-center px-4">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col items-center"
            >
              <div
                style={{
                  backgroundColor: "var(--theme-accent)",
                  borderColor: "var(--theme-border)",
                }}
                className="w-14 h-14 rounded-2xl border flex items-center justify-center text-white mb-6 shadow-lg ring-1 ring-white/10"
              >
                <Sparkles size={28} />
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight mb-2">
                What can I help with today?
              </h2>
              <p className="text-sm text-[var(--theme-text-muted)] max-w-md mb-8">
                Ask questions, debug code, brainstorm ideas, or summarize study topics.
              </p>
            </motion.div>

            {/* Quick Prompt Cards */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.1 }}
              className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-xl"
            >
              {SUGGESTIONS.map((item, idx) => {
                const IconComp = item.icon;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSendMessage(item.prompt)}
                    style={{
                      backgroundColor: "var(--theme-darker)",
                      borderColor: "var(--theme-border)",
                    }}
                    className="flex items-start gap-3 p-3.5 rounded-2xl border text-left hover:border-[var(--theme-text-accent)]/50 hover:bg-white/5 transition-all group cursor-pointer shadow-sm"
                  >
                    <div
                      style={{ backgroundColor: "rgba(255, 255, 255, 0.05)" }}
                      className="p-2 rounded-xl text-neutral-300 group-hover:text-white transition-colors"
                    >
                      <IconComp size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-white mb-0.5">{item.title}</div>
                      <div className="text-[11px] text-[var(--theme-text-muted)] truncate">{item.prompt}</div>
                    </div>
                  </button>
                );
              })}
            </motion.div>
          </div>
        ) : (
          /* Active Chat Message Stream */
          <div className="max-w-3xl mx-auto space-y-6 pb-24">
            <AnimatePresence initial={false}>
              {messages.map((msg) => {
                const isUser = msg.role === "user";
                const isCopied = copiedMessageId === msg.id;

                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    className={`flex items-start gap-3.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}
                  >
                    {/* Avatar */}
                    <div
                      style={{
                        backgroundColor: isUser ? "rgba(255, 255, 255, 0.1)" : "var(--theme-accent)",
                        borderColor: "var(--theme-border)",
                      }}
                      className="w-8 h-8 rounded-xl border flex items-center justify-center text-white flex-none shadow-sm mt-0.5"
                    >
                      {isUser ? <User size={16} /> : <Sparkles size={16} />}
                    </div>

                    {/* Message Content Container */}
                    <div className={`flex-1 min-w-0 max-w-[85%] ${isUser ? "items-end text-right" : "items-start"}`}>
                      <div
                        style={{
                          backgroundColor: isUser ? "var(--theme-accent)" : "var(--theme-darker)",
                          borderColor: "var(--theme-border)",
                        }}
                        className={`p-4 rounded-2xl border text-sm text-neutral-100 shadow-sm leading-relaxed ${
                          isUser ? "rounded-tr-sm text-white" : "rounded-tl-sm"
                        }`}
                      >
                        {isUser ? (
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        ) : (
                          renderMessageContent(msg.content)
                        )}
                      </div>

                      {/* Action Bar under AI messages */}
                      {!isUser && (
                        <div className="flex items-center gap-2 mt-1.5 ml-1 text-xs text-[var(--theme-text-muted)]">
                          <button
                            type="button"
                            onClick={() => handleCopyMessage(msg.id, msg.content)}
                            className="p-1.5 rounded-lg hover:text-white hover:bg-white/5 transition-colors cursor-pointer flex items-center gap-1 text-[11px]"
                          >
                            {isCopied ? (
                              <>
                                <Check size={13} className="text-[var(--theme-text-accent)]" />
                                <span className="text-[var(--theme-text-accent)]">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy size={13} />
                                <span>Copy</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={handleRegenerate}
                            title="Regenerate response"
                            className="p-1.5 rounded-lg hover:text-white hover:bg-white/5 transition-colors cursor-pointer flex items-center gap-1 text-[11px]"
                          >
                            <RotateCcw size={13} />
                            <span>Retry</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {/* Thinking / Loading Indicator */}
            {isLoading && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-3.5"
              >
                <div
                  style={{
                    backgroundColor: "var(--theme-accent)",
                    borderColor: "var(--theme-border)",
                  }}
                  className="w-8 h-8 rounded-xl border flex items-center justify-center text-white flex-none shadow-sm"
                >
                  <Sparkles size={16} className="animate-spin" />
                </div>
                <div
                  style={{
                    backgroundColor: "var(--theme-darker)",
                    borderColor: "var(--theme-border)",
                  }}
                  className="px-4 py-3 rounded-2xl rounded-tl-sm border text-sm text-neutral-300 flex items-center gap-2"
                >
                  <div className="w-2 h-2 rounded-full bg-[var(--theme-text-accent)] animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-2 h-2 rounded-full bg-[var(--theme-text-accent)] animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-2 h-2 rounded-full bg-[var(--theme-text-accent)] animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </motion.div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Fixed Bottom Input Area */}
      <div
        style={{
          backgroundColor: "var(--theme-darkest)",
          borderColor: "var(--theme-border)",
        }}
        className="flex-none border-t px-4 py-3 backdrop-blur-md"
      >
        <div className="max-w-3xl mx-auto flex flex-col gap-1.5">
          <div
            style={{
              backgroundColor: "var(--theme-darker)",
              borderColor: "var(--theme-border)",
            }}
            className="relative flex items-end gap-2 p-2 rounded-2xl border shadow-lg focus-within:ring-1 focus-within:ring-[var(--theme-text-accent)]/50 transition-all"
          >
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputPrompt}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Message Assistant..."
              className="flex-1 bg-transparent border-0 px-2.5 py-1.5 text-sm text-white placeholder-neutral-400 focus:outline-none resize-none max-h-44 leading-relaxed custom-scrollbar"
            />
            <button
              type="button"
              disabled={!inputPrompt.trim() || isLoading}
              onClick={() => handleSendMessage()}
              style={{
                backgroundColor: inputPrompt.trim() && !isLoading ? "var(--theme-accent)" : "rgba(255, 255, 255, 0.05)",
              }}
              className={`p-2 rounded-xl text-white transition-all cursor-pointer flex-none flex items-center justify-center ${
                !inputPrompt.trim() || isLoading ? "opacity-40 cursor-not-allowed" : "hover:scale-105 active:scale-95"
              }`}
            >
              <ArrowUp size={18} />
            </button>
          </div>

          <p className="text-[11px] text-center text-[var(--theme-text-muted)] tracking-tight py-0.5">
            Assistant can make mistakes. Verify important information.
          </p>
        </div>
      </div>
    </div>
  );
}
