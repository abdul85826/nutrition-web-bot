"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  CircleHelp,
  Info,
  Leaf,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Utensils,
} from "lucide-react";

interface Message {
  id: string;
  sender: "bot" | "user";
  text: string;
  isError?: boolean;
}

type Mode = "food" | "plan" | "learn";

let messageSeq = 0;
const createMessageId = () => `message-${Date.now()}-${messageSeq++}`;

function createSessionId() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return `sess-${window.crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  }
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const foodStarter = [
  { label: "A new snack", value: "I want to try a new snack" },
  { label: "A supplement", value: "I want to try a supplement" },
  { label: "A restaurant meal", value: "I want to try a restaurant meal" },
];

const planStarter = [
  { label: "Fat loss", value: "My goal is fat loss" },
  { label: "Maintenance", value: "My goal is maintenance" },
  { label: "Muscle gain", value: "My goal is muscle gain" },
];

const nutrientLessons = [
  {
    id: "carbs",
    name: "Carbs",
    simple: "Energy / taqat",
    color: "amber",
    description: "Your body’s easiest fuel for walking, working, studying, and training.",
    foods: "Roti, rice, poha, oats, potato, banana",
    tip: "Choose mostly whole-grain and fibre-rich options; the portion depends on your routine.",
    tag: "Evidence-informed",
  },
  {
    id: "protein",
    name: "Protein",
    simple: "Body repair",
    color: "rose",
    description: "Helps build and repair muscles, skin, hormones, and other body tissues.",
    foods: "Dal, chana, paneer, eggs, curd, fish, chicken, tofu",
    tip: "Add one protein source to each main meal instead of chasing a perfect diet.",
    tag: "High-confidence",
  },
  {
    id: "iron",
    name: "Iron",
    simple: "Khoon support",
    color: "red",
    description: "Needed to make haemoglobin, which carries oxygen around your body.",
    foods: "Rajma, chana, lentils, spinach, sesame, meat, eggs",
    tip: "Pair plant iron with lemon, amla, or another vitamin-C food to improve absorption.",
    tag: "ICMR/NIN aligned",
  },
  {
    id: "fibre",
    name: "Fibre",
    simple: "Pet + gut",
    color: "green",
    description: "Supports fullness, regular bowel movements, and a healthy gut.",
    foods: "Vegetables, fruit, dal, beans, whole grains, nuts, seeds",
    tip: "Increase slowly and drink enough water, especially if your current diet is low in fibre.",
    tag: "Evidence-informed",
  },
  {
    id: "fats",
    name: "Healthy fats",
    simple: "Hormones + brain",
    color: "blue",
    description: "Supports cells, hormones, brain function, and absorption of some vitamins.",
    foods: "Groundnut, mustard oil, nuts, seeds, avocado, fatty fish",
    tip: "Fats are useful but energy-dense, so small portions go a long way.",
    tag: "High-confidence",
  },
  {
    id: "vitamins",
    name: "Vitamins",
    simple: "Body helpers",
    color: "purple",
    description: "Small nutrients that help immunity, vision, bones, blood, and energy pathways.",
    foods: "Colourful vegetables, fruit, dairy, eggs, pulses, leafy greens",
    tip: "Variety beats a single superfood. Aim for different colours across the week.",
    tag: "Food-first",
  },
];

const learningFoodGroups = [
  { title: "Everyday staples", items: "Roti · rice · dal · curd · vegetables", note: "Build meals around these first." },
  { title: "Quick protein", items: "Eggs · paneer · chana · sprouts · tofu", note: "Easy add-ons for busy days." },
  { title: "Iron-friendly pairs", items: "Rajma + lemon · poha + peanuts · dal + salad", note: "Vitamin C can help plant iron absorption." },
];

export default function NutritionApp() {
  const [mode, setMode] = useState<Mode>("food");
  const [selectedLesson, setSelectedLesson] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<Message[]>([{
    id: "welcome",
    sender: "bot",
    text: "Tell me what you want to try. I’ll ask only for the context that changes the answer, then give you a clear fit check.",
  }]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const welcome = useCallback((selectedMode: Mode = mode): Message => ({
    id: "welcome",
    sender: "bot",
    text:
      selectedMode === "food"
        ? "Tell me what you want to try. I’ll ask only for the context that changes the answer, then give you a clear fit check."
        : "Let’s create your baseline. Share your age, sex, height, weight, activity, and goal — in one message or step by step.",
  }), [mode]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = useCallback(async (value?: string) => {
    const text = (value ?? input).trim();
    if (!text || loading) return;
    if (text.length > 250) {
      setMessages((current) => [...current, {
        id: createMessageId(),
        sender: "bot",
        text: "Keep it under 250 characters so I can focus on the useful details.",
        isError: true,
      }]);
      return;
    }

    setInput("");
    setStarted(true);
    setMessages((current) => [...current, { id: createMessageId(), sender: "user", text }]);
    setLoading(true);
    const activeSessionId = sessionId || createSessionId();
    if (!sessionId) setSessionId(activeSessionId);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 18000);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ text, sessionId: activeSessionId }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      setMessages((current) => [...current, {
        id: createMessageId(),
        sender: "bot",
        text: response.ok ? data?.reply || "I’m ready for the next detail." : data?.reply || "I couldn’t process that. Please try again.",
        isError: !response.ok,
      }]);
    } catch (error) {
      const timedOut = (error as Error)?.name === "AbortError";
      setMessages((current) => [...current, {
        id: createMessageId(),
        sender: "bot",
        text: timedOut ? "That took too long. Please try once more." : "You appear to be offline. Check your connection and try again.",
        isError: true,
      }]);
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }, [input, loading, sessionId]);

  const reset = (nextMode: Mode = mode) => {
    setMode(nextMode);
    setSelectedLesson(null);
    setStarted(false);
    setInput("");
    setSessionId(createSessionId());
    setMessages([welcome(nextMode)]);
  };

  const starters = mode === "food" ? foodStarter : planStarter;
  const activeLesson = nutrientLessons.find((lesson) => lesson.id === selectedLesson);

  return (
    <main className="app-shell">
      <div className="app-frame">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark"><Utensils size={18} strokeWidth={2.5} /></div>
            <div>
              <div className="brand-name">Nutrient Earth <span className="status-pill"><span />LIVE</span></div>
              <p>Personal nutrition, without the noise</p>
            </div>
          </div>
          <button className="icon-button" onClick={() => reset()} aria-label="Start a new check" title="Start over">
            <RotateCcw size={17} />
          </button>
        </header>

        <section className="hero">
          <div className="eyebrow"><Sparkles size={14} /> QUICK, PERSONAL, PRACTICAL</div>
          <h1>{mode === "learn" ? <>Nutrition, made<br /><em>easy to remember.</em></> : <>Should I try this<br /><em>for my health?</em></>}</h1>
          <p>{mode === "learn" ? "Understand what your body needs, where it comes from, and how to use it in everyday Indian meals." : "Make better everyday food decisions with answers shaped around your goal, routine, and context."}</p>
          <div className="trust-row"><ShieldCheck size={15} /> No account. No judgement. General education, not medical advice.</div>
        </section>

        <nav className="mode-tabs" aria-label="Nutrition tools">
          <button className={mode === "food" ? "mode-tab active" : "mode-tab"} onClick={() => reset("food")}>
            <Utensils size={16} /><span><strong>Try a food</strong><small>Get a personal fit check</small></span>
          </button>
          <button className={mode === "plan" ? "mode-tab active" : "mode-tab"} onClick={() => reset("plan")}>
            <ArrowUpRight size={17} /><span><strong>Build my baseline</strong><small>Calories and macros</small></span>
          </button>
          <button className={mode === "learn" ? "mode-tab active" : "mode-tab"} onClick={() => reset("learn")}>
            <Leaf size={17} /><span><strong>Learn nutrition</strong><small>Simple Indian food guide</small></span>
          </button>
        </nav>

        {mode === "learn" ? (
          <section className="learn-card" aria-label="Nutrition learning guide">
            <div className="learn-header">
              <div><span className="assistant-dot" /> <strong>Start with the basics</strong></div>
              <span className="evidence-chip"><ShieldCheck size={12} /> Evidence tags</span>
            </div>
            <div className="learn-intro">
              <span className="learn-kicker">NO JARGON · FAMILIAR FOODS · ONE IDEA AT A TIME</span>
              <h2>What does your body need?</h2>
              <p>Tap any card for the simple meaning, common Indian sources, and one practical next step.</p>
            </div>
            <div className="lesson-grid">
              {nutrientLessons.map((lesson) => (
                <button key={lesson.id} className={`lesson-card lesson-${lesson.color}`} onClick={() => setSelectedLesson(lesson.id)}>
                  <span className="lesson-top"><span className="lesson-icon"><Leaf size={14} /></span><span className="lesson-tag">{lesson.tag}</span></span>
                  <strong>{lesson.name}</strong>
                  <span className="lesson-simple">{lesson.simple}</span>
                  <span className="lesson-foods">{lesson.foods}</span>
                  <span className="lesson-link">Learn in 30 sec <ArrowUpRight size={13} /></span>
                </button>
              ))}
            </div>
            <div className="food-group-section">
              <div className="section-title"><span>Make it practical</span><small>Start with what you already eat</small></div>
              <div className="food-group-list">
                {learningFoodGroups.map((group) => (
                  <div className="food-group" key={group.title}><strong>{group.title}</strong><span>{group.items}</span><small>{group.note}</small></div>
                ))}
              </div>
            </div>
            <div className="learn-disclaimer"><Info size={14} /> Food helps most people meet nutrition needs. Supplements and condition-specific advice need a clinician.</div>
          </section>
        ) : (
        <section className="chat-card" aria-label="Nutrition assistant">
          <div className="chat-header">
            <div><span className="assistant-dot" /> <strong>{mode === "food" ? "Food fit check" : "Baseline builder"}</strong></div>
            <span className="step-label">{started ? "In progress" : "1 minute"}</span>
          </div>
          <div className="chat-stream" aria-live="polite">
            {messages.map((message) => (
              <div key={message.id} className={`message-row ${message.sender}`}>
                <div className={`message ${message.isError ? "error" : ""}`}>
                  {message.isError && <div className="message-label"><CircleHelp size={13} /> Notice</div>}
                  {message.text}
                </div>
              </div>
            ))}
            {loading && <div className="message-row bot"><div className="message typing"><span /><span /><span /> Thinking about your context…</div></div>}
            <div ref={bottomRef} />
          </div>

          {!started && (
            <div className="starter-panel">
              <span className="starter-label">{mode === "food" ? "Start with a quick idea" : "Choose your main goal"}</span>
              <div className="starter-list">
                {starters.map((starter) => <button key={starter.value} onClick={() => send(starter.value)}>{starter.label}<ArrowUpRight size={14} /></button>)}
              </div>
            </div>
          )}

          {started && (
            <div className="quick-replies">
              {(mode === "food"
                ? ["Fat loss", "Maintenance", "Muscle gain", "I have an allergy"]
                : ["Male", "Female", "Sedentary", "Moderate", "Fat loss", "Muscle gain"]
              ).map((reply) => <button key={reply} onClick={() => send(reply)} disabled={loading}>{reply}</button>)}
            </div>
          )}

          <form className="composer" onSubmit={(event) => { event.preventDefault(); send(); }}>
            <input value={input} onChange={(event) => setInput(event.target.value)} maxLength={250} placeholder={mode === "food" ? "e.g. Is Greek yogurt a good fit for me?" : "e.g. 29, male, 178 cm, 75 kg, moderate, muscle gain"} aria-label="Your nutrition question" />
            <button type="submit" disabled={loading || !input.trim()} aria-label="Send"><Send size={17} /></button>
          </form>
        </section>
        )}

        <footer className="footer-note"><ShieldCheck size={14} /> Built to help you decide, not diagnose you <span>•</span> <button onClick={() => reset()}>Clear chat</button></footer>
      </div>
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      {activeLesson && (
        <div className="lesson-overlay" role="dialog" aria-modal="true" aria-label={`${activeLesson.name} lesson`} onClick={() => setSelectedLesson(null)}>
          <div className="lesson-modal" onClick={(event) => event.stopPropagation()}>
            <div className={`modal-accent accent-${activeLesson.color}`} />
            <div className="modal-top"><span className="lesson-tag">{activeLesson.tag}</span><button className="modal-close" onClick={() => setSelectedLesson(null)} aria-label="Close lesson">×</button></div>
            <h2>{activeLesson.name} <em>· {activeLesson.simple}</em></h2>
            <p className="modal-description">{activeLesson.description}</p>
            <div className="modal-block"><span>Common Indian sources</span><strong>{activeLesson.foods}</strong></div>
            <div className="modal-block"><span>Try this today</span><strong>{activeLesson.tip}</strong></div>
            <p className="modal-footnote">This is general education, not a diagnosis or personalised medical plan.</p>
          </div>
        </div>
      )}
    </main>
  );
}
