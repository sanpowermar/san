import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * COMPASS-Style Mock Exam — Single-Page React App
 * -------------------------------------------------
 * Features
 * - Candidate login (name, email optional) + test settings
 * - One-question-at-a-time exam UI with Next/Prev
 * - Question palette (Not visited, Not answered, Answered, Marked for review)
 * - Timer with auto-submit on timeout
 * - Mark for Review toggle
 * - MCQ (single choice), MSQ (multi-select), Numeric, Short Text questions
 * - Shuffle questions (optional)
 * - Admin panel: paste/import questions JSON, set duration, shuffle, negative marking toggle
 * - LocalStorage persistence (session resume)
 * - Result summary + per-question review + download CSV
 * - Print-friendly Result sheet (Ctrl/Cmd+P)
 *
 * How to use
 * 1) Click "Admin" → paste JSON (schema shown) → Save.
 * 2) On Welcome screen, enter your name and Start.
 * 3) Attempt questions. Use palette on the right to jump.
 * 4) Submit any time or wait for auto-submit when timer ends.
 * 5) View/print results and download CSV.
 */

// ---------- Types ----------
/**
 * Question Schema
 * id: string
 * type: 'mcq' | 'msq' | 'num' | 'text'
 * question: string (supports basic markdown-like **bold**, _italics_)
 * options?: string[] (for mcq/msq)
 * answer: for mcq -> number (index), for msq -> number[] (indices), for num -> number|string, for text -> string (keyword)
 * marks?: number (default 1)
 * negative?: number (default 0)
 */

const SAMPLE_QUESTIONS = [
  {
    id: "Q1",
    type: "mcq",
    question: "Choose the correct synonym for **Rapid**:",
    options: ["Slow", "Quick", "Small", "Weak"],
    answer: 1,
    marks: 1,
    negative: 0,
  },
  {
    id: "Q2",
    type: "mcq",
    question: "The sun __ in the east.",
    options: ["rise", "rises", "rising", "rose"],
    answer: 1,
    marks: 1,
    negative: 0,
  },
  {
    id: "Q3",
    type: "mcq",
    question: "What is 12 × 15?",
    options: ["120", "150", "180", "200"],
    answer: 2,
    marks: 1,
    negative: 0,
  },
  {
    id: "Q4",
    type: "num",
    question: "If x = 5, evaluate 2x^2 + 3x.",
    answer: 65 + 5, // 70
    marks: 1,
    negative: 0,
  },
  {
    id: "Q5",
    type: "mcq",
    question: "Sequence: 2, 6, 12, 20, ?",
    options: ["28", "30", "32", "34"],
    answer: 1,
    marks: 1,
    negative: 0,
  },
  {
    id: "Q6",
    type: "msq",
    question: "Select the prime numbers:",
    options: ["9", "11", "13", "15"],
    answer: [1, 2],
    marks: 2,
    negative: 0.5,
  },
];

// ---------- Helpers ----------
const clsx = (...args) => args.filter(Boolean).join(" ");

function markdownLite(text = "") {
  // Very light markdown (bold **, italics _) for inline text only
  const bold = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  const ital = bold.replace(/_(.*?)_/g, "<em>$1</em>");
  return ital;
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function downloadCSV(filename, rows) {
  const process = (row) =>
    row
      .map((v) => {
        const val = v == null ? "" : String(v);
        if (/[",\n]/.test(val)) return '"' + val.replace(/"/g, '""') + '"';
        return val;
      })
      .join(",");
  const content = rows.map(process).join("\n");
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Storage Keys ----------
const LS_KEY = "compass_mock_app_v1";

function saveToStorage(state) {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// ---------- App ----------
export default function CompassMockApp() {
  const [adminOpen, setAdminOpen] = useState(false);
  const [config, setConfig] = useState(() => ({
    durationMin: 30,
    shuffle: false,
    negativeEnabled: true,
    questions: SAMPLE_QUESTIONS,
    examTitle: "COMPASS Practice Test — Mock Exam",
    orgName: "Your Academy",
  }));

  const [candidate, setCandidate] = useState({ name: "", email: "" });
  const [stage, setStage] = useState("welcome"); // welcome | exam | review
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState({}); // {id: value}
  const [marked, setMarked] = useState({}); // {id: boolean}
  const [visited, setVisited] = useState({}); // {id: boolean}
  const [timeLeft, setTimeLeft] = useState(config.durationMin * 60);
  const [startedAt, setStartedAt] = useState(null);

  const qList = useMemo(() => {
    const list = config.questions.map((q, i) => ({ ...q, ord: i }));
    return config.shuffle ? shuffleArray(list) : list;
  }, [config.questions, config.shuffle]);

  // Resume from localStorage if available
  useEffect(() => {
    const saved = loadFromStorage();
    if (saved && saved.stage !== "review") {
      setConfig(saved.config);
      setCandidate(saved.candidate);
      setStage(saved.stage);
      setIdx(saved.idx);
      setAnswers(saved.answers);
      setMarked(saved.marked);
      setVisited(saved.visited);
      setTimeLeft(saved.timeLeft);
      setStartedAt(saved.startedAt);
    }
  }, []);

  // Persist during exam
  useEffect(() => {
    if (stage !== "welcome") {
      saveToStorage({
        config,
        candidate,
        stage,
        idx,
        answers,
        marked,
        visited,
        timeLeft,
        startedAt,
      });
    }
  }, [config, candidate, stage, idx, answers, marked, visited, timeLeft, startedAt]);

  // Timer
  useEffect(() => {
    if (stage !== "exam") return;
    if (timeLeft <= 0) {
      handleSubmit();
      return;
    }
    const t = setInterval(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [stage, timeLeft]);

  const current = qList[idx];

  function startExam() {
    if (!candidate.name.trim()) {
      alert("Please enter your name to start the test.");
      return;
    }
    setStage("exam");
    setStartedAt(Date.now());
    setTimeLeft(config.durationMin * 60);
    setVisited({ [qList[0].id]: true });
  }

  function resetAll() {
    if (!confirm("Clear saved session and reset app?")) return;
    localStorage.removeItem(LS_KEY);
    window.location.reload();
  }

  function selectAnswer(q, value) {
    setAnswers((prev) => ({ ...prev, [q.id]: value }));
  }

  function toggleMark(q) {
    setMarked((p) => ({ ...p, [q.id]: !p[q.id] }));
  }

  function goto(i) {
    setIdx(i);
    setVisited((p) => ({ ...p, [qList[i].id]: true }));
  }

  function next() {
    if (idx < qList.length - 1) goto(idx + 1);
  }

  function prev() {
    if (idx > 0) goto(idx - 1);
  }

  function computeScore() {
    let correct = 0,
      incorrect = 0,
      unattempted = 0,
      total = 0,
      score = 0;

    for (const q of qList) {
      const marks = q.marks ?? 1;
      const neg = config.negativeEnabled ? q.negative ?? 0 : 0;
      total += marks;
      const ans = answers[q.id];
      if (ans == null || (Array.isArray(ans) && ans.length === 0) || ans === "") {
        unattempted++;
        continue;
      }
      const isCorrect = (() => {
        if (q.type === "mcq") return ans === q.answer;
        if (q.type === "msq") {
          const a = Array.isArray(ans) ? [...ans].sort() : [];
          const b = Array.isArray(q.answer) ? [...q.answer].sort() : [];
          return JSON.stringify(a) === JSON.stringify(b);
        }
        if (q.type === "num") return Number(ans) === Number(q.answer);
        if (q.type === "text") {
          const norm = (s) => String(s).toLowerCase().trim();
          return norm(ans) === norm(q.answer);
        }
        return false;
      })();
      if (isCorrect) {
        correct++;
        score += marks;
      } else {
        incorrect++;
        score -= neg;
      }
    }
    return { correct, incorrect, unattempted, total, score };
  }

  function handleSubmit() {
    if (stage !== "exam") return;
    const confirmSubmit = timeLeft <= 0 || confirm("Submit the test? You cannot change answers after submitting.");
    if (!confirmSubmit) return;
    setStage("review");
    // Clear saved session after review loads to avoid auto-resume
    setTimeout(() => {
      localStorage.removeItem(LS_KEY);
    }, 100);
  }

  function exportCSV() {
    const rows = [[
      "Candidate Name",
      candidate.name,
      "Email",
      candidate.email,
      "Exam Title",
      config.examTitle,
      "Duration(min)",
      config.durationMin,
      "Score",
      computeScore().score,
    ]];
    rows.push(["QID", "Answer", "MarkedForReview", "Visited"]);
    for (const q of qList) {
      const ans = answers[q.id];
      const ansStr = Array.isArray(ans) ? ans.join("|") : (ans ?? "");
      rows.push([q.id, ansStr, marked[q.id] ? "Y" : "N", visited[q.id] ? "Y" : "N"]);
    }
    downloadCSV("results.csv", rows);
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <Header config={config} stage={stage} />

      <div className="max-w-6xl mx-auto p-4 md:p-6">
        {stage === "welcome" && (
          <Welcome
            config={config}
            setConfig={setConfig}
            adminOpen={adminOpen}
            setAdminOpen={setAdminOpen}
            candidate={candidate}
            setCandidate={setCandidate}
            startExam={startExam}
            resetAll={resetAll}
          />
        )}

        {stage === "exam" && (
          <Exam
            qList={qList}
            idx={idx}
            goto={goto}
            next={next}
            prev={prev}
            current={current}
            answers={answers}
            selectAnswer={selectAnswer}
            marked={marked}
            toggleMark={toggleMark}
            visited={visited}
            timeLeft={timeLeft}
            handleSubmit={handleSubmit}
          />
        )}

        {stage === "review" && (
          <Review
            qList={qList}
            answers={answers}
            marked={marked}
            candidate={candidate}
            config={config}
            startedAt={startedAt}
            exportCSV={exportCSV}
            computeScore={computeScore}
          />)
        }
      </div>
    </div>
  );
}

function Header({ config, stage }) {
  return (
    <header className="sticky top-0 z-40 w-full border-b bg-white/70 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-2xl bg-black/90 text-white flex items-center justify-center font-bold shadow">C</div>
          <div className="leading-tight">
            <div className="font-semibold">{config.orgName}</div>
            <div className="text-sm text-neutral-500">{config.examTitle}</div>
          </div>
        </div>
        <div className="text-xs text-neutral-500">{stage === "exam" ? "Exam in progress" : stage === "review" ? "Result" : "Welcome"}</div>
      </div>
    </header>
  );
}

function Welcome({ config, setConfig, adminOpen, setAdminOpen, candidate, setCandidate, startExam, resetAll }) {
  const [jsonText, setJsonText] = useState(beautifyJSON(config.questions));

  function saveAdmin() {
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) throw new Error("Questions must be an array");
      setConfig((p) => ({ ...p, questions: parsed }));
      alert("Questions saved!");
    } catch (e) {
      alert("Invalid JSON: " + e.message);
    }
  }

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="bg-white rounded-2xl shadow p-5">
        <h2 className="text-xl font-semibold mb-4">Candidate Details</h2>
        <div className="grid gap-4">
          <div>
            <label className="text-sm text-neutral-600">Full Name<span className="text-red-500"> *</span></label>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              placeholder="Enter your name"
              value={candidate.name}
              onChange={(e) => setCandidate({ ...candidate, name: e.target.value })}
            />
          </div>
          <div>
            <label className="text-sm text-neutral-600">Email (optional)</label>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              placeholder="name@example.com"
              value={candidate.email}
              onChange={(e) => setCandidate({ ...candidate, email: e.target.value })}
            />
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button onClick={startExam} className="rounded-2xl px-4 py-2 bg-black text-white shadow hover:opacity-90">Start Test</button>
          <button onClick={() => setAdminOpen((v) => !v)} className="rounded-2xl px-4 py-2 border shadow-sm">Admin</button>
          <button onClick={resetAll} className="rounded-2xl px-4 py-2 border shadow-sm">Reset</button>
        </div>
        <div className="mt-4 text-xs text-neutral-500">
          One-question-at-a-time · Timer with auto-submit · Mark for review · Palette navigation
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow p-5">
        <h2 className="text-xl font-semibold mb-4">Test Settings</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-neutral-600">Exam Title</label>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={config.examTitle}
              onChange={(e) => setConfig((p) => ({ ...p, examTitle: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-sm text-neutral-600">Organization</label>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={config.orgName}
              onChange={(e) => setConfig((p) => ({ ...p, orgName: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-sm text-neutral-600">Duration (minutes)</label>
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={config.durationMin}
              onChange={(e) => setConfig((p) => ({ ...p, durationMin: Math.max(1, Number(e.target.value || 1)) }))}
            />
          </div>
          <div className="flex items-center gap-3 mt-6">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={config.shuffle} onChange={(e) => setConfig((p) => ({ ...p, shuffle: e.target.checked }))} />
              <span className="text-sm">Shuffle questions</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={config.negativeEnabled} onChange={(e) => setConfig((p) => ({ ...p, negativeEnabled: e.target.checked }))} />
              <span className="text-sm">Enable negative marking</span>
            </label>
          </div>
        </div>

        <div className="mt-6 text-sm text-neutral-600">
          <div className="font-medium mb-2">Question Types</div>
          <ul className="list-disc pl-5 space-y-1">
            <li><span className="font-mono">mcq</span> – single correct (options[] + answer index)</li>
            <li><span className="font-mono">msq</span> – multiple correct (options[] + answer index[])</li>
            <li><span className="font-mono">num</span> – numeric answer (number)</li>
            <li><span className="font-mono">text</span> – exact short text match</li>
          </ul>
        </div>
      </div>

      {adminOpen && (
        <div className="md:col-span-2 bg-white rounded-2xl shadow p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold">Admin · Import Questions (JSON)</h3>
            <div className="flex items-center gap-2">
              <button className="rounded-xl px-3 py-1.5 border" onClick={() => setJsonText(beautifyJSON(SAMPLE_QUESTIONS))}>Load Sample</button>
              <button className="rounded-xl px-3 py-1.5 border" onClick={() => setJsonText(beautifyJSON(config.questions))}>Load Current</button>
              <button className="rounded-xl px-3 py-1.5 bg-black text-white" onClick={saveAdmin}>Save</button>
            </div>
          </div>
          <textarea
            className="w-full h-64 md:h-80 rounded-xl border p-3 font-mono text-sm"
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
          />
          <div className="mt-3 text-xs text-neutral-500">
            Tip: Paste array of questions. Each question must include <code>id</code>, <code>type</code>, <code>question</code>, and appropriate <code>options</code>/<code>answer</code>.
          </div>
        </div>
      )}
    </div>
  );
}

function Exam({ qList, idx, goto, next, prev, current, answers, selectAnswer, marked, toggleMark, visited, timeLeft, handleSubmit }) {
  const total = qList.length;
  const mins = Math.floor(timeLeft / 60);
  const secs = (timeLeft % 60).toString().padStart(2, "0");

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  return (
    <div className="grid lg:grid-cols-[1fr_280px] gap-6">
      <div className="bg-white rounded-2xl shadow p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-neutral-600">Question {idx + 1} of {total}</div>
          <div className="flex items-center gap-3">
            <div className={clsx("px-3 py-1.5 rounded-xl text-sm font-semibold", timeLeft < 60 ? "bg-red-600 text-white" : "bg-neutral-900 text-white")}>{mins}:{secs}</div>
            <button className="px-3 py-1.5 rounded-xl border" onClick={() => { if (confirm("Submit now?")) handleSubmit(); }}>Submit</button>
          </div>
        </div>

        <QuestionCard
          q={current}
          value={answers[current.id]}
          onChange={(v) => selectAnswer(current, v)}
        />

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="rounded-2xl px-4 py-2 border" onClick={prev} disabled={idx === 0}>Previous</button>
          <button className="rounded-2xl px-4 py-2 border" onClick={() => selectAnswer(current, null)}>Clear</button>
          <button className={clsx("rounded-2xl px-4 py-2 border", marked[current.id] && "bg-yellow-100")} onClick={() => toggleMark(current)}>{marked[current.id] ? "Unmark" : "Mark for Review"}</button>
          <button className="rounded-2xl px-4 py-2 bg-black text-white" onClick={next} disabled={idx === total - 1}>Next</button>
        </div>

        <div className="mt-6 text-xs text-neutral-500">Keyboard: ← Previous · → Next</div>
      </div>

      <div className="bg-white rounded-2xl shadow p-5 h-fit sticky top-20">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">Question Palette</div>
          <div className="text-xs text-neutral-500">Click to jump</div>
        </div>
        <Palette qList={qList} idx={idx} goto={goto} answers={answers} marked={marked} visited={visited} />
        <Legend />
      </div>
    </div>
  );
}

function QuestionCard({ q, value, onChange }) {
  return (
    <div className="rounded-2xl border p-4">
      <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: markdownLite(q.question) }} />
      {q.type === "mcq" && (
        <div className="mt-4 grid gap-2">
          {q.options.map((opt, i) => (
            <label key={i} className="flex items-center gap-3 border rounded-xl p-2">
              <input type="radio" name={q.id} checked={value === i} onChange={() => onChange(i)} />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      )}

      {q.type === "msq" && (
        <div className="mt-4 grid gap-2">
          {q.options.map((opt, i) => {
            const arr = Array.isArray(value) ? value : [];
            const checked = arr.includes(i);
            return (
              <label key={i} className="flex items-center gap-3 border rounded-xl p-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    if (e.target.checked) onChange([...(arr || []), i]);
                    else onChange((arr || []).filter((x) => x !== i));
                  }}
                />
                <span>{opt}</span>
              </label>
            );
          })}
        </div>
      )}

      {q.type === "num" && (
        <div className="mt-4">
          <input
            type="number"
            className="w-60 rounded-xl border px-3 py-2"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="Enter number"
          />
        </div>
      )}

      {q.type === "text" && (
        <div className="mt-4">
          <input
            type="text"
            className="w-full max-w-md rounded-xl border px-3 py-2"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Enter short text"
          />
        </div>
      )}

      <div className="mt-3 text-xs text-neutral-500">Marks: {q.marks ?? 1} {q.negative ? ` · Negative: ${q.negative}` : ""}</div>
    </div>
  );
}

function Palette({ qList, idx, goto, answers, marked, visited }) {
  return (
    <div className="grid grid-cols-8 gap-2">
      {qList.map((q, i) => {
        const isCurrent = i === idx;
        const isMarked = !!marked[q.id];
        const isVisited = !!visited[q.id];
        const hasAnswer = answers[q.id] != null && (Array.isArray(answers[q.id]) ? answers[q.id].length > 0 : answers[q.id] !== "");
        const base = "h-8 w-8 rounded-lg text-xs flex items-center justify-center cursor-pointer border";
        const stateClass = isCurrent
          ? "bg-black text-white border-black"
          : isMarked
          ? "bg-yellow-200 border-yellow-400"
          : hasAnswer
          ? "bg-green-200 border-green-400"
          : isVisited
          ? "bg-red-200 border-red-400"
          : "bg-neutral-100 border-neutral-300";
        return (
          <div key={q.id} className={clsx(base, stateClass)} title={q.id} onClick={() => goto(i)}>
            {i + 1}
          </div>
        );
      })}
    </div>
  );
}

function Legend() {
  const Item = ({ cls, label }) => (
    <div className="flex items-center gap-2">
      <span className={clsx("h-4 w-4 rounded", cls)} />
      <span className="text-xs">{label}</span>
    </div>
  );
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 text-neutral-600">
      <Item cls="bg-green-300" label="Answered" />
      <Item cls="bg-red-300" label="Visited / Not answered" />
      <Item cls="bg-yellow-300" label="Marked for review" />
      <Item cls="bg-neutral-200" label="Not visited" />
      <Item cls="bg-black" label="Current" />
    </div>
  );
}

function Review({ qList, answers, marked, candidate, config, startedAt, exportCSV, computeScore }) {
  const stats = computeScore();
  const finishedAt = new Date();
  const startDt = startedAt ? new Date(startedAt) : null;

  return (
    <div className="grid lg:grid-cols-[1fr_280px] gap-6">
      <div className="bg-white rounded-2xl shadow p-5">
        <div className="mb-4">
          <h2 className="text-xl font-semibold">Result Summary</h2>
          <div className="text-sm text-neutral-600">{config.examTitle} · {config.orgName}</div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          <CardStat label="Candidate" value={candidate.name || "-"} />
          <CardStat label="Email" value={candidate.email || "-"} />
          <CardStat label="Score" value={String(stats.score)} />
          <CardStat label="Correct / Incorrect" value={`${stats.correct} / ${stats.incorrect}`} />
          <CardStat label="Unattempted" value={String(stats.unattempted)} />
          <CardStat label="Total Marks" value={String(stats.total)} />
          <CardStat label="Started" value={startDt ? startDt.toLocaleString() : "-"} />
          <CardStat label="Finished" value={finishedAt.toLocaleString()} />
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-6">
          <button onClick={exportCSV} className="rounded-2xl px-4 py-2 border">Download CSV</button>
          <button onClick={() => window.print()} className="rounded-2xl px-4 py-2 border">Print</button>
        </div>

        <div className="space-y-4">
          {qList.map((q, i) => (
            <div key={q.id} className="rounded-2xl border p-4">
              <div className="mb-2 text-sm text-neutral-500">Question {i + 1} · {q.id} · Marks: {q.marks ?? 1}{q.negative ? ` · Neg: ${q.negative}` : ""}</div>
              <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: markdownLite(q.question) }} />
              <div className="mt-2 text-sm"><span className="font-semibold">Your Answer: </span>{renderAnswerValue(q, answers[q.id])}</div>
              <div className="text-sm"><span className="font-semibold">Correct Answer: </span>{renderAnswerValue(q, q.answer)}</div>
              {marked[q.id] && <div className="mt-1 text-xs text-yellow-700">(Marked for review)</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow p-5 h-fit">
        <div className="font-semibold mb-2">Grading Rules</div>
        <ul className="list-disc pl-5 text-sm text-neutral-700 space-y-1">
          <li>Correct answers add question marks.</li>
          <li>Incorrect answers {config.negativeEnabled ? "may deduct negative marks (per question setting)." : "do not deduct marks (negative marking disabled)."}</li>
          <li>Unattempted questions give 0 marks.</li>
        </ul>
        <div className="mt-4 text-xs text-neutral-500">Tip: Use the CSV to upload into your LMS/Sheets.</div>
      </div>
    </div>
  );
}

function CardStat({ label, value }) {
  return (
    <div className="rounded-2xl border p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}

function renderAnswerValue(q, v) {
  if (v == null || (Array.isArray(v) && v.length === 0) || v === "") return <span className="text-neutral-500">—</span>;
  if (q.type === "mcq") return <span>{q.options[v]}</span>;
  if (q.type === "msq") return <span>{(v || []).map((i) => q.options[i]).join(", ")}</span>;
  if (q.type === "num") return <span>{String(v)}</span>;
  if (q.type === "text") return <span>{String(v)}</span>;
  return <span>{String(v)}</span>;
}

function beautifyJSON(obj) {
  try { return JSON.stringify(obj, null, 2); } catch { return "[]"; }
}
