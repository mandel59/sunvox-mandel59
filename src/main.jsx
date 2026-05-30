import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import { buildGraphLayout, shortLabel } from "./project-graph.js";
import "./styles.css";

const PROJECT_INDEX_PATH = "site-data/sunvox-projects.json";

function compact(value) {
  return value === undefined || value === null || value === "" ? "-" : value;
}

function typeLabel(project) {
  return project.type === "synth" ? "SunSynth" : "SunVox";
}

function metric(label, value) {
  return (
    <div className="metric">
      <strong>{compact(value)}</strong>
      {label}
    </div>
  );
}

function eventText(event) {
  const parts = [`L${String(event.line ?? 0).padStart(3, "0")}`, `T${event.track ?? 0}`];
  if (event.note) {
    parts.push(event.note);
  }
  if (event.moduleName) {
    parts.push(event.moduleName);
  }
  if (event.controller) {
    parts.push(`ctl:${event.controller}`);
  }
  if (event.effect) {
    parts.push(`fx:${event.effect}`);
  }
  return parts.join(" ");
}

function ProjectList({ projects, selectedPath, onSelect }) {
  return (
    <aside className="sidebar" aria-labelledby="project-list-heading">
      <section aria-labelledby="project-list-heading">
        <h2 id="project-list-heading">Files</h2>
        <div id="project-list" className="project-list" aria-live="polite">
          {projects.map((project) => (
            <button
              key={project.path}
              type="button"
              className="project-button"
              aria-current={project.path === selectedPath ? "true" : "false"}
              onClick={() => onSelect(project.path)}
            >
              <span>
                <span className="project-title">{project.title}</span>
                <br />
                <span className="project-path">{project.path}</span>
              </span>
              <span className="badge">{typeLabel(project)}</span>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}

function ModuleGraphSection({ project }) {
  const graph = useMemo(() => buildGraphLayout(project), [project]);
  if (!graph) {
    return null;
  }
  return (
    <section className="section-grid" aria-labelledby="graph-heading">
      <h3 id="graph-heading">Module Graph</h3>
      <div className="graph-panel">
        <svg className="module-graph" viewBox={graph.viewBox} role="img" aria-label="Module graph">
          <defs>
            <marker id="module-arrow" markerHeight="8" markerWidth="8" orient="auto-start-reverse" refX="7" refY="4">
              <path d="M0,0 L8,4 L0,8 z" />
            </marker>
          </defs>
          <g className="graph-edges">
            {graph.edges.map((link, index) => {
              const from = graph.nodes.find((module) => module.index === link.from);
              const to = graph.nodes.find((module) => module.index === link.to);
              return (
                <line
                  key={`${link.from}-${link.to}-${index}`}
                  x1={from.position.x}
                  y1={from.position.y}
                  x2={to.position.x}
                  y2={to.position.y}
                  markerEnd="url(#module-arrow)"
                >
                  <title>
                    #{link.from} {link.fromName} to #{link.to} {link.toName}
                  </title>
                </line>
              );
            })}
          </g>
          <g className="graph-nodes">
            {graph.nodes.map((module) => (
              <g key={module.index} transform={`translate(${module.position.x} ${module.position.y})`}>
                <rect x="-48" y="-18" width="96" height="36" rx="7" style={{ "--module-color": module.color }} />
                <text y="-2">#{module.index}</text>
                <text y="11">{shortLabel(module.name)}</text>
                <title>
                  #{module.index} {module.name} [{module.type || module.kind}]
                </title>
              </g>
            ))}
          </g>
        </svg>
      </div>
    </section>
  );
}

function ProjectActions({ project }) {
  const playable = project.type === "project";
  return (
    <div className="project-actions">
      {playable ? (
        <>
          <button type="button" onClick={() => window.loadAndPlay?.(project.path)}>
            <span aria-hidden="true">▶</span> Play
          </button>
          <button type="button" onClick={() => window.stopPlayback?.()}>
            <span aria-hidden="true">■</span> Stop
          </button>
        </>
      ) : null}
      <a className="action-link" href={project.path} download>
        Download
      </a>
    </div>
  );
}

function ModuleSection({ project }) {
  return (
    <section className="section-grid" aria-labelledby="modules-heading">
      <h3 id="modules-heading">Modules</h3>
      <div className="module-grid">
        {project.modules.map((module) => (
          <div className="module-row" key={module.index}>
            <div>
              <span className="module-name">
                #{module.index} {module.name}
              </span>
              <div className="module-meta">{module.type || module.kind}</div>
            </div>
            <div className="module-meta">
              controllers={compact(module.controllerCount)} data={compact(module.dataChunkCount)} links=
              {compact(module.inputCount + module.outputCount)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function LinkSection({ project }) {
  if (!project.links.length) {
    return null;
  }
  return (
    <section className="section-grid" aria-labelledby="links-heading">
      <h3 id="links-heading">Links</h3>
      <div className="link-grid">
        {project.links.map((link, index) => (
          <div className="link-row" key={`${link.from}-${link.to}-${index}`}>
            <strong>
              #{link.from} {link.fromName}
            </strong>
            -&gt;
            <strong>
              #{link.to} {link.toName}
            </strong>
            <span>
              {link.kind}
              {link.fromSlot !== undefined ? ` fromSlot=${link.fromSlot}` : ""}
              {link.toSlot !== undefined ? ` toSlot=${link.toSlot}` : ""}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function PatternSection({ project }) {
  if (!project.patterns.length) {
    return null;
  }
  return (
    <section className="section-grid" aria-labelledby="patterns-heading">
      <h3 id="patterns-heading">Patterns</h3>
      <div className="pattern-grid">
        {project.patterns.map((pattern) => (
          <div className="pattern-row" key={pattern.index}>
            <div>
              <span className="pattern-name">
                #{pattern.index} {pattern.name || "(unnamed)"}
              </span>
            </div>
            <div className="pattern-meta">
              lines={compact(pattern.lines)} tracks={compact(pattern.tracks)} events={compact(pattern.eventCount)}
            </div>
            {pattern.eventPreview.length ? (
              <div className="event-preview">
                {pattern.eventPreview.map((event, index) => (
                  <span className="event-pill" key={`${event.line}-${event.track}-${index}`}>
                    {eventText(event)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function EmbeddedSection({ project }) {
  if (!project.embedded.length) {
    return null;
  }
  return (
    <section className="section-grid" aria-labelledby="embedded-heading">
      <h3 id="embedded-heading">Embedded</h3>
      <div className="module-grid">
        {project.embedded.map((embedded) => (
          <div className="module-row" key={`${embedded.hostModule}-${embedded.dataChunkIndex}`}>
            <div>
              <span className="module-name">
                #{embedded.hostModule} {embedded.hostName}
              </span>
              <div className="module-meta">
                {embedded.dataChunkName || "container"} #{embedded.dataChunkIndex}
              </div>
            </div>
            <div className="module-meta">
              modules={embedded.document.stats.activeModules} patterns={embedded.document.stats.patterns}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProjectDetails({ project, error }) {
  if (error) {
    return (
      <section id="project-details" className="details" aria-live="polite">
        <p className="muted">{error}</p>
      </section>
    );
  }
  if (!project) {
    return (
      <section id="project-details" className="details" aria-live="polite">
        <p className="muted">Loading project index...</p>
      </section>
    );
  }
  return (
    <section id="project-details" className="details" aria-live="polite">
      <div className="details-header">
        <div>
          <h2>{project.title}</h2>
          <div className="project-path">{project.path}</div>
        </div>
        <ProjectActions project={project} />
      </div>

      <div className="metrics" aria-label="Project metrics">
        {metric("type", typeLabel(project))}
        {metric("modules", project.stats.activeModules)}
        {metric("links", project.stats.links)}
        {metric("patterns", project.stats.patterns)}
        {metric("events", project.stats.events)}
        {metric("embedded", project.stats.embeddedContainers)}
      </div>

      <div className="section-grid">
        <ModuleGraphSection project={project} />
        <ModuleSection project={project} />
        <LinkSection project={project} />
        <PatternSection project={project} />
        <EmbeddedSection project={project} />
      </div>
    </section>
  );
}

function App() {
  const [projects, setProjects] = useState([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    async function loadProjectIndex() {
      const response = await fetch(PROJECT_INDEX_PATH);
      if (!response.ok) {
        throw new Error(`Project index ${response.status}`);
      }
      const data = await response.json();
      if (!alive) {
        return;
      }
      const nextProjects = data.projects ?? [];
      setProjects(nextProjects);
      setSelectedPath(nextProjects[0]?.path ?? "");
    }
    loadProjectIndex().catch((loadError) => {
      if (alive) {
        setError(loadError.message);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const selectedProject = useMemo(
    () => projects.find((project) => project.path === selectedPath),
    [projects, selectedPath],
  );

  return (
    <main className="app-shell">
      <ProjectList projects={projects} selectedPath={selectedPath} onSelect={setSelectedPath} />
      <ProjectDetails project={selectedProject} error={error} />
    </main>
  );
}

createRoot(document.getElementById("app-root")).render(<App />);
