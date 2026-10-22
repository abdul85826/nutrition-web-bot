"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { Send, Activity, Sparkles, Flame, Heart, QrCode, X, RefreshCw, ChevronRight } from "lucide-react";

interface Message {
  id: string;
  sender: "bot" | "user";
  text: string;
}

export default function NutritionApp() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "init",
      sender: "bot",
      text: "Welcome to Nutrient Earth! Click the green button below to calculate your personalized BMR, daily calories, and macro breakdown.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState(() => "sess-" + Math.random().toString(36).substring(2, 9));
  const [showQrModal, setShowQrModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [started, setStarted] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (directText?: string) => {
    const textToSend = directText || input;
    if (!textToSend.trim() || loading) return;

    setInput("");
    setStarted(true);
    setMessages((prev) => [...prev, { id: Math.random().toString(), sender: "user", text: textToSend }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: textToSend, sessionId }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { id: Math.random().toString(), sender: "bot", text: data.reply || "Calculation complete." },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: Math.random().toString(), sender: "bot", text: "Connection error. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const resetSession = () => {
    setSessionId("sess-" + Math.random().toString(36).substring(2, 9));
    setStarted(false);
    setMessages([
      {
        id: "init",
        sender: "bot",
        text: "Welcome to Nutrient Earth! Click the green button below to calculate your personalized BMR, daily calories, and macro breakdown.",
      },
    ]);
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-2 sm:p-4 font-sans">
      <div className="w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-3xl shadow-2xl flex flex-col h-[94vh] overflow-hidden relative">
        
        {/* Header */}
        <header className="px-5 py-3.5 bg-zinc-900/90 border-b border-zinc-800/80 backdrop-blur flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400">
              <Activity className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-sm font-bold tracking-wide uppercase text-zinc-100">Nutrient Earth</h1>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-semibold border border-emerald-500/30">ONLINE</span>
              </div>
              <p className="text-xs text-zinc-400">Mifflin-St Jeor Engine</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowQrModal(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-xl text-xs font-semibold text-emerald-400 transition"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Tip / UPI</span>
            </button>
            <button
              onClick={resetSession}
              className="p-2 hover:bg-zinc-800 rounded-xl text-zinc-400 hover:text-white transition"
              title="Reset Chat"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Dedicated 1-Click Trigger */}
        {!started && (
          <div className="p-4 bg-emerald-950/20 border-b border-emerald-500/20 flex flex-col items-center text-center space-y-2.5">
            <span className="text-xs text-emerald-300 font-medium">Ready to get your macro & caloric targets?</span>
            <button
              onClick={() => handleSend("Calculate my nutrition plan")}
              className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white font-semibold text-sm flex items-center justify-center space-x-2 shadow-lg shadow-emerald-950 transition"
            >
              <Flame className="w-4 h-4 fill-current" />
              <span>Calculate Nutrition Plan</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Chat Stream */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.sender === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-line ${
                  m.sender === "user"
                    ? "bg-emerald-600 text-white font-medium shadow-md shadow-emerald-950"
                    : "bg-zinc-800/90 border border-zinc-700/60 text-zinc-200"
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-zinc-800 border border-zinc-700 px-4 py-2 rounded-2xl text-xs text-zinc-400 flex items-center space-x-2">
                <Sparkles className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                <span>Computing your metabolic telemetry...</span>
              </div>
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>

        {/* 1-Tap Quick Fill Chips for Follow-up Questions */}
        {started && (
          <div className="px-4 py-2 border-t border-zinc-800/60 bg-zinc-950 flex items-center space-x-2 overflow-x-auto text-xs scrollbar-none">
            <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider shrink-0">Tap to Send:</span>
            <button
              onClick={() => handleSend("male")}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 font-medium transition whitespace-nowrap active:scale-95"
            >
              Male
            </button>
            <button
              onClick={() => handleSend("female")}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 font-medium transition whitespace-nowrap active:scale-95"
            >
              Female
            </button>
            <button
              onClick={() => handleSend("sedentary")}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 font-medium transition whitespace-nowrap active:scale-95"
            >
              Sedentary
            </button>
            <button
              onClick={() => handleSend("light")}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 font-medium transition whitespace-nowrap active:scale-95"
            >
              Light (1-3 days)
            </button>
            <button
              onClick={() => handleSend("moderate")}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 font-medium transition whitespace-nowrap active:scale-95"
            >
              Moderate (3-5 days)
            </button>
            <button
              onClick={() => handleSend("fat loss")}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 font-medium transition whitespace-nowrap active:scale-95"
            >
              Fat Loss
            </button>
            <button
              onClick={() => handleSend("muscle gain")}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 font-medium transition whitespace-nowrap active:scale-95"
            >
              Muscle Gain
            </button>
          </div>
        )}

        {/* Input Field */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="p-3 sm:p-4 bg-zinc-900 border-t border-zinc-800 flex items-center space-x-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your answer or tap buttons above..."
            className="flex-1 bg-zinc-950 border border-zinc-700 text-sm rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-zinc-100 placeholder-zinc-500"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white p-3 rounded-xl transition shadow-lg shadow-emerald-950/40"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

        {/* Dynamic Scannable UPI / QR Modal */}
        {showQrModal && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 max-w-sm w-full text-center relative shadow-2xl">
              <button
                onClick={() => setShowQrModal(false)}
                className="absolute top-4 right-4 p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="w-12 h-12 bg-emerald-500/10 text-emerald-400 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-emerald-500/20">
                <Heart className="w-6 h-6 fill-current" />
              </div>
              <h3 className="text-lg font-bold text-zinc-100">Support Nutrient Earth</h3>
              <p className="text-xs text-zinc-400 mt-1 mb-4 leading-relaxed">
                Scan using Google Pay, PhonePe, Paytm, or any UPI app to support server maintenance.
              </p>

              <div className="flex flex-col items-center mb-3">
                <div className="bg-white p-2.5 rounded-2xl inline-block shadow-inner">
                  <Image
                    src="/qr.jpeg"
                    alt="PhonePe UPI QR - Syed Abdul Rehman"
                    width={220}
                    height={380}
                    className="w-48 h-auto max-h-72 object-contain mx-auto rounded-xl"
                    priority
                  />
                </div>

                {/* Download QR Button */}
                <a
                  href="/qr.jpeg"
                  download="NutrientEarth-PhonePe-QR.jpeg"
                  className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800/80 hover:bg-zinc-700/80 px-3 py-1.5 rounded-lg border border-zinc-700 transition"
                >
                  <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download QR
                </a>
              </div>

              {/* UPI ID Bar with Copy Button */}
              <div className="text-xs text-zinc-300 font-mono bg-zinc-950 py-2.5 px-3 rounded-xl border border-zinc-800 flex items-center justify-between">
                <span className="select-all">syedabdulrehman01@axl</span>
                <button
                  type="button"
                  onClick={async () => {
                    const upi = "syedabdulrehman01@axl";
                    try {
                      await navigator.clipboard.writeText(upi);
                    } catch {
                      const input = document.createElement("textarea");
                      input.value = upi;
                      document.body.appendChild(input);
                      input.select();
                      document.execCommand("copy");
                      document.body.removeChild(input);
                    }
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="inline-flex items-center gap-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] uppercase font-semibold px-2 py-0.5 rounded-md transition"
                >
                  {copied ? (
                    <>
                      <span>✓</span>
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              <button
                onClick={() => setShowQrModal(false)}
                className="w-full mt-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2.5 rounded-xl text-xs transition"
              >
                Back to Calculator
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}