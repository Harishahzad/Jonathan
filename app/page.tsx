"use client";
import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";

type Source = { id: number; title: string; url: string };
type Turn = { query: string; answer: string; sources: Source[]; related: string[] };

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Turn [1] or [1, 2] into links the renderer can style as chips
function withCitations(text: string) {
  return text.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_, nums: string) =>
    nums
      .split(",")
      .map((n) => `[${n.trim()}](#cite-${n.trim()})`)
      .join("")
  );
}

function Answer({
  text,
  sources,
  onHover,
}: {
  text: string;
  sources: Source[];
  onHover: (id: number | null) => void;
}) {
  return (
    <div className="answer">
      <ReactMarkdown
        components={{
          a({ href, children }) {
            if (href?.startsWith("#cite-")) {
              const id = Number(href.slice(6));
              const src = sources.find((s) => s.id === id);
              if (!src) return null;
              return (
                <sup>
                  <a
                    className="cite"
                    href={src.url}
                    target="_blank"
                    rel="noreferrer"
                    onMouseEnter={() => onHover(id)}
                    onMouseLeave={() => onHover(null)}
                    onFocus={() => onHover(id)}
                    onBlur={() => onHover(null)}
                  >
                    {id}
                  </a>
                </sup>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {withCitations(text)}
      </ReactMarkdown>
    </div>
  );
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState<{ turn: number; id: number } | null>(null);
  const lastRef = useRef<HTMLElement>(null);

  // Load / save history in the browser
  useEffect(() => {
    try {
      const saved = localStorage.getItem("turns");
      if (saved) setTurns(JSON.parse(saved));
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem("turns", JSON.stringify(turns));
  }, [turns, loaded]);

  // Scroll to the newest question when it is added
  useEffect(() => {
    if (loading) lastRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns.length]);

  function updateLast(patch: Partial<Turn>) {
    setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, ...patch } : x)));
  }

  async function ask(override?: string) {
    const q = override ?? query;
    if (!q.trim() || loading) return;

    const history = turns.map(({ query, answer }) => ({ query, answer }));
    setQuery("");
    setLoading(true);
    setTurns((t) => [...t, { query: q, answer: "", sources: [], related: [] }]);

    const res = await fetch("/api/search", {
      method: "POST",
      body: JSON.stringify({ query: q, history }),
    });

    if (!res.ok || !res.body) {
      updateLast({ answer: await res.text() });
      setLoading(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let gotSources = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      if (!gotSources && buffer.includes("\n")) {
        const i = buffer.indexOf("\n");
        updateLast({ sources: JSON.parse(buffer.slice(0, i)) });
        buffer = buffer.slice(i + 1);
        gotSources = true;
      }
      if (gotSources) updateLast({ answer: buffer });
    }

    setLoading(false);

    fetch("/api/related", {
      method: "POST",
      body: JSON.stringify({ query: q, answer: buffer }),
    })
      .then((r) => r.json())
      .then((related) => updateLast({ related }))
      .catch(() => {});
  }

  const composer = (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        ask();
      }}
    >
      <input
        aria-label="Question"
        placeholder={turns.length ? "Ask a follow-up" : "What do you want to look up?"}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <button type="submit" disabled={loading || !query.trim()}>
        {loading ? "Searching" : "Ask"}
      </button>
    </form>
  );

  return (
    <div className="shell">
      <header className="top">
        <span className="mark">Glint</span>
      </header>

      {loaded && turns.length === 0 && (
        <section className="hero">
          <h1>Ask Jonathan.</h1>
          <p>Every answer comes with the sources it came from.</p>
          {composer}
        </section>
      )}

      <div>
        {turns.map((t, i) => {
          const isLast = i === turns.length - 1;
          return (
            <article key={i} className="turn" ref={isLast ? lastRef : undefined}>
  <h2 className="question">{t.query}</h2>

  {isLast && loading && !t.answer ? (
    <p className="status">
      <span className="dot" />
      Searching the web
    </p>
  ) : (
    <Answer
      text={t.answer}
      sources={t.sources}
      onHover={(id) => setActive(id ? { turn: i, id } : null)}
    />
  )}

  {t.sources.length > 0 && (
    <aside className="margin" aria-label="Sources">
      <h3>Sources</h3>
      <ol>
        {t.sources.map((s) => (
          <li key={s.id} className={active?.turn === i && active.id === s.id ? "on" : ""}>
            <a href={s.url} target="_blank" rel="noreferrer">
              <span className="src-title">{s.title}</span>
              <span className="src-host">{host(s.url)}</span>
            </a>
          </li>
        ))}
      </ol>
    </aside>
  )}

  {t.related?.length > 0 && (
    <ul className="related">
      {t.related.map((r) => (
        <li key={r}>
          <button onClick={() => ask(r)}>{r}</button>
        </li>
      ))}
    </ul>
  )}
 </article>
          );
        })}
      </div>

      {turns.length > 0 && (
        <div className="dock">
          <div className="dock-inner">
            {composer}
            <button className="quiet newchat" onClick={() => setTurns([])}>
              New chat
            </button>
          </div>
        </div>
      )}
    </div>
  );
}