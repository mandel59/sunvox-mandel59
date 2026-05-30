import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";

import { buildGraphLayout } from "./project-graph.js";
import "./styles.css";

const PROJECT_INDEX_PATH = "site-data/sunvox-projects.json";
const GRAPH_NODE_HALF_WIDTH = 39;
const GRAPH_NODE_HALF_HEIGHT = 21;
const GRAPH_LABEL_INSET = 2;
const TIMELINE_LANE_HEIGHT = 32;
const TIMELINE_PATTERN_HEIGHT = 28;
const TIMELINE_PATTERN_Y_INSET = (TIMELINE_LANE_HEIGHT - TIMELINE_PATTERN_HEIGHT) / 2;
const TIMELINE_ICON_ONLY_LINE_LIMIT = 63;
const TIMELINE_Y_PADDING = 16;
const MASTER_VOLUME_MAX = 256;
const DEFAULT_MASTER_VOLUME = 256;
const SYNTH_KEYBOARD_BASE_START_NOTE = 48;
const SYNTH_KEYBOARD_NOTE_SPAN = 24;
const SYNTH_KEYBOARD_OCTAVE_STEP = 12;
const SYNTH_KEYBOARD_MIN_START_NOTE = 0;
const SYNTH_KEYBOARD_MAX_START_NOTE = 96;
const SYNTH_KEYBOARD_VELOCITY = 128;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK_KEY_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

function compact(value) {
  return value === undefined || value === null || value === "" ? "-" : value;
}

function typeLabel(project) {
  return project.type === "synth" ? "SunSynth" : "SunVox";
}

function moduleHexId(value) {
  return value.toString(16).toUpperCase().padStart(2, "0");
}

function svgId(value) {
  return value.replaceAll(/[^A-Za-z0-9_-]/g, "-");
}

function metric(label, value) {
  return (
    <div className="metric">
      <strong>{compact(value)}</strong>
      {label}
    </div>
  );
}

function canPlay(project) {
  return project?.type === "project";
}

function playProject(project) {
  if (canPlay(project)) {
    window.loadAndPlay?.(project.path);
  }
}

function stopPlayer() {
  window.stopPlayback?.();
}

function volumePercent(volume) {
  return Math.round((volume / MASTER_VOLUME_MAX) * 100);
}

function noteName(note) {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12)}`;
}

function keyboardNotes(startNote) {
  const notes = [];
  let whiteIndex = -1;
  for (let note = startNote; note <= startNote + SYNTH_KEYBOARD_NOTE_SPAN; note += 1) {
    const pitchClass = note % 12;
    const black = BLACK_KEY_PITCH_CLASSES.has(pitchClass);
    if (!black) {
      whiteIndex += 1;
    }
    notes.push({
      note,
      name: noteName(note),
      black,
      whiteIndex: black ? whiteIndex : whiteIndex,
    });
  }
  return notes;
}

function clampKeyboardStartNote(note) {
  return Math.min(SYNTH_KEYBOARD_MAX_START_NOTE, Math.max(SYNTH_KEYBOARD_MIN_START_NOTE, note));
}

function TopbarControls({ project, volume, onVolumeChange }) {
  const playable = canPlay(project);
  return (
    <div className="topbar-controls" aria-label="Playback controls">
      <button type="button" disabled={!playable} onClick={() => playProject(project)}>
        <span aria-hidden="true">▶</span>
        Play
      </button>
      <button type="button" onClick={stopPlayer}>
        <span aria-hidden="true">■</span>
        Stop
      </button>
      <label className="volume-control">
        <span>Master</span>
        <input
          type="range"
          min="0"
          max={MASTER_VOLUME_MAX}
          step="1"
          value={volume}
          aria-label="Master volume"
          onChange={(event) => onVolumeChange(Number(event.target.value))}
        />
        <output>{volumePercent(volume)}%</output>
      </label>
    </div>
  );
}

function SynthKeyboardSection({ project }) {
  const [activeNotes, setActiveNotes] = useState(() => new Set());
  const [keyboardStatus, setKeyboardStatus] = useState("Ready");
  const [keyboardStartNote, setKeyboardStartNote] = useState(SYNTH_KEYBOARD_BASE_START_NOTE);
  const keyboardRef = useRef(null);
  const dragNoteRef = useRef(undefined);
  const synthKeyboardNotes = useMemo(() => keyboardNotes(keyboardStartNote), [keyboardStartNote]);
  const synthKeyboardWhiteKeys = useMemo(
    () => synthKeyboardNotes.filter((keyboardNote) => !keyboardNote.black).length,
    [synthKeyboardNotes],
  );
  const canShiftDown = keyboardStartNote > SYNTH_KEYBOARD_MIN_START_NOTE;
  const canShiftUp = keyboardStartNote < SYNTH_KEYBOARD_MAX_START_NOTE;

  useEffect(() => {
    dragNoteRef.current = undefined;
    setActiveNotes(new Set());
    setKeyboardStatus("Ready");
    setKeyboardStartNote(SYNTH_KEYBOARD_BASE_START_NOTE);
    return () => {
      dragNoteRef.current = undefined;
      window.stopInstrumentNotes?.();
    };
  }, [project.path]);

  if (project.type !== "synth") {
    return null;
  }

  function noteAtPoint(clientX, clientY) {
    const keyboard = keyboardRef.current;
    if (!keyboard) {
      return undefined;
    }
    const target = document.elementFromPoint(clientX, clientY);
    const key = target?.closest?.(".piano-key");
    if (!key || !keyboard.contains(key)) {
      return undefined;
    }
    return Number(key.dataset.note);
  }

  async function startNote(note) {
    if (dragNoteRef.current === note) {
      return;
    }
    if (dragNoteRef.current !== undefined) {
      window.stopSynthNote?.(dragNoteRef.current);
    }
    dragNoteRef.current = note;
    setActiveNotes(new Set([note]));
    setKeyboardStatus("Loading");
    const played = await window.playSynthNote?.(project.path, note, SYNTH_KEYBOARD_VELOCITY);

    if (dragNoteRef.current !== note) {
      if (played) {
        window.stopSynthNote?.(note);
      }
      return;
    }

    setKeyboardStatus(played ? noteName(note) : "Unavailable");
    if (!played) {
      dragNoteRef.current = undefined;
      setActiveNotes(new Set());
    }
  }

  function stopCurrentNote() {
    if (dragNoteRef.current !== undefined) {
      window.stopSynthNote?.(dragNoteRef.current);
      dragNoteRef.current = undefined;
    }
    setActiveNotes(new Set());
  }

  function shiftKeyboardOctave(direction) {
    stopCurrentNote();
    setKeyboardStatus("Ready");
    setKeyboardStartNote((note) => clampKeyboardStartNote(note + direction * SYNTH_KEYBOARD_OCTAVE_STEP));
  }

  function handlePointerMove(event) {
    if (event.buttons !== 1) {
      return;
    }
    const note = noteAtPoint(event.clientX, event.clientY);
    if (note !== undefined) {
      startNote(note);
    }
  }

  return (
    <section className="section-grid" aria-labelledby="instrument-heading">
      <div className="instrument-header">
        <h3 id="instrument-heading">Instrument</h3>
        <div className="octave-controls" aria-label="Keyboard octave">
          <button
            type="button"
            className="octave-button"
            disabled={!canShiftDown}
            aria-label="Octave down"
            onClick={() => shiftKeyboardOctave(-1)}
          >
            -
          </button>
          <output className="octave-range" aria-label="Keyboard range">
            {noteName(keyboardStartNote)}-{noteName(keyboardStartNote + SYNTH_KEYBOARD_NOTE_SPAN)}
          </output>
          <button
            type="button"
            className="octave-button"
            disabled={!canShiftUp}
            aria-label="Octave up"
            onClick={() => shiftKeyboardOctave(1)}
          >
            +
          </button>
        </div>
        <output className="instrument-status">{keyboardStatus}</output>
      </div>
      <div
        ref={keyboardRef}
        className="virtual-keyboard"
        style={{ "--white-key-count": synthKeyboardWhiteKeys }}
        aria-label={`${project.title} virtual keyboard`}
      >
        {synthKeyboardNotes.map((keyboardNote) => (
          <button
            key={keyboardNote.note}
            type="button"
            className={`piano-key ${keyboardNote.black ? "is-black" : "is-white"}${
              activeNotes.has(keyboardNote.note) ? " is-active" : ""
            }`}
            style={{ "--white-index": keyboardNote.whiteIndex }}
            aria-label={keyboardNote.name}
            data-note={keyboardNote.note}
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              event.preventDefault();
              try {
                event.currentTarget.setPointerCapture(event.pointerId);
              } catch {
                // Synthetic pointer events in tests do not always create a capturable pointer.
              }
              startNote(keyboardNote.note);
            }}
            onPointerMove={handlePointerMove}
            onPointerUp={(event) => {
              event.preventDefault();
              stopCurrentNote();
            }}
            onPointerCancel={stopCurrentNote}
            onLostPointerCapture={stopCurrentNote}
            onBlur={stopCurrentNote}
          >
            <span>{keyboardNote.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function visiblePatterns(project) {
  return (project.patterns ?? []).filter(
    (pattern) => pattern.eventCount > 0 || Boolean(pattern.name?.trim()) || isClonePattern(pattern),
  );
}

function patternCount(project) {
  return visiblePatterns(project).length;
}

function listedPatterns(project) {
  return visiblePatterns(project).filter((pattern) => !isClonePattern(pattern));
}

function isClonePattern(pattern) {
  return pattern.infoFlags?.clone === true;
}

function isIconOnlyTimelinePattern(pattern) {
  return pattern.lines <= TIMELINE_ICON_ONLY_LINE_LIMIT && Boolean(pattern.icon);
}

function timelinePatterns(project) {
  if (project.type !== "project") {
    return [];
  }
  return visiblePatterns(project).filter(
    (pattern) =>
      Number.isFinite(pattern.position?.x) &&
      Number.isFinite(pattern.position?.y) &&
      Number.isFinite(pattern.lines) &&
      pattern.lines > 0,
  );
}

function timelineLayout(project) {
  const patterns = timelinePatterns(project);
  if (!patterns.length) {
    return undefined;
  }
  const supertracks = Boolean(project.project?.flags?.supertracks);
  const minLine = Math.min(...patterns.map((pattern) => pattern.position.x));
  const maxLine = Math.max(...patterns.map((pattern) => pattern.position.x + pattern.lines));
  const minY = Math.min(...patterns.map((pattern) => pattern.position.y));
  const maxY = Math.max(...patterns.map((pattern) => pattern.position.y + TIMELINE_LANE_HEIGHT));
  const startLine = Math.floor(minLine / 64) * 64;
  const endLine = Math.ceil(maxLine / 64) * 64;
  const startY = Math.floor(minY / TIMELINE_LANE_HEIGHT) * TIMELINE_LANE_HEIGHT;
  const endY = Math.ceil(maxY / TIMELINE_LANE_HEIGHT) * TIMELINE_LANE_HEIGHT;
  const duration = Math.max(1, endLine - startLine);
  const ticks = [];
  for (let line = startLine; line <= endLine; line += 64) {
    ticks.push(line);
  }
  const laneGuides = [];
  if (supertracks) {
    const occupiedLanes = new Map();
    for (const pattern of patterns) {
      const lane = Math.max(0, Math.round(pattern.position.y / TIMELINE_LANE_HEIGHT));
      if (!occupiedLanes.has(lane)) {
        const laneTop = pattern.position.y - startY + TIMELINE_Y_PADDING;
        occupiedLanes.set(lane, {
          lane,
          y: pattern.position.y,
          label: String(lane),
          lineTop: laneTop,
          labelTop: laneTop + TIMELINE_LANE_HEIGHT / 2,
        });
      }
    }
    laneGuides.push(...[...occupiedLanes.values()].sort((a, b) => a.y - b.y || a.lane - b.lane));
  }
  return {
    startLine,
    endLine,
    startY,
    duration,
    ticks,
    laneGuides,
    patterns: patterns.sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x || a.index - b.index),
    width: duration,
    height: Math.max(96, endY - startY + TIMELINE_Y_PADDING * 2),
    supertracks,
  };
}

function percent(value) {
  return `${value.toFixed(3)}%`;
}

function rectEdgePoint(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) {
    return from;
  }
  const tx = dx === 0 ? Number.POSITIVE_INFINITY : GRAPH_NODE_HALF_WIDTH / Math.abs(dx);
  const ty = dy === 0 ? Number.POSITIVE_INFINITY : GRAPH_NODE_HALF_HEIGHT / Math.abs(dy);
  const ratio = Math.min(tx, ty);
  return {
    x: from.x + dx * ratio,
    y: from.y + dy * ratio,
  };
}

function graphEdgePoints(from, to) {
  const start = rectEdgePoint(from, to);
  const end = rectEdgePoint(to, from);
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
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

function ModuleGraphSvg({ graph, graphId, label = "Module graph" }) {
  const markerId = `${graphId}-arrow`;
  return (
    <svg className="module-graph" viewBox={graph.viewBox} role="img" aria-label={label}>
      <defs>
        <marker
          id={markerId}
          markerHeight="10"
          markerUnits="userSpaceOnUse"
          markerWidth="10"
          orient="auto"
          refX="9"
          refY="5"
        >
          <path d="M0,0 L10,5 L0,10 z" />
        </marker>
      </defs>
      <g className="graph-edges">
        {graph.edges.map((link, index) => {
          const from = graph.nodes.find((module) => module.index === link.from);
          const to = graph.nodes.find((module) => module.index === link.to);
          const edge = graphEdgePoints(from.position, to.position);
          return (
            <line
              key={`${link.from}-${link.to}-${index}`}
              x1={edge.x1}
              y1={edge.y1}
              x2={edge.x2}
              y2={edge.y2}
              markerEnd={`url(#${markerId})`}
            >
              <title>
                #{link.from} {link.fromName} to #{link.to} {link.toName}
              </title>
            </line>
          );
        })}
      </g>
      <g className="graph-nodes">
        {graph.nodes.map((module) => {
          const clipId = `${graphId}-node-clip-${module.index}`;
          return (
            <g
              key={module.index}
              style={{ "--module-color": module.color }}
              transform={`translate(${module.position.x} ${module.position.y})`}
            >
              <clipPath id={clipId}>
                <rect
                  className="graph-node-clip"
                  x={-GRAPH_NODE_HALF_WIDTH}
                  y={-GRAPH_NODE_HALF_HEIGHT}
                  width={GRAPH_NODE_HALF_WIDTH * 2}
                  height={GRAPH_NODE_HALF_HEIGHT * 2}
                />
              </clipPath>
              <rect
                className="graph-node-box"
                x={-GRAPH_NODE_HALF_WIDTH}
                y={-GRAPH_NODE_HALF_HEIGHT}
                width={GRAPH_NODE_HALF_WIDTH * 2}
                height={GRAPH_NODE_HALF_HEIGHT * 2}
              />
              <text
                className="graph-node-id"
                x={-GRAPH_NODE_HALF_WIDTH + GRAPH_LABEL_INSET}
                y={-GRAPH_NODE_HALF_HEIGHT - 7}
              >
                {moduleHexId(module.index)}
              </text>
              <text
                className="graph-node-name"
                clipPath={`url(#${clipId})`}
                x={-GRAPH_NODE_HALF_WIDTH + GRAPH_LABEL_INSET}
                y={-GRAPH_NODE_HALF_HEIGHT + 7}
              >
                {module.name}
              </text>
              <text
                className="graph-node-type"
                clipPath={`url(#${clipId})`}
                x={-GRAPH_NODE_HALF_WIDTH + GRAPH_LABEL_INSET}
                y={GRAPH_NODE_HALF_HEIGHT - 6}
              >
                {module.type || module.kind}
              </text>
              <title>
                #{module.index} {module.name} [{module.type || module.kind}]
              </title>
            </g>
          );
        })}
      </g>
    </svg>
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
        <ModuleGraphSvg graph={graph} graphId="main-module-graph" />
      </div>
    </section>
  );
}

function ProjectActions({ project }) {
  const playable = canPlay(project);
  return (
    <div className="project-actions">
      {playable ? (
        <>
          <button type="button" onClick={() => playProject(project)}>
            <span aria-hidden="true">▶</span> Play
          </button>
          <button type="button" onClick={stopPlayer}>
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

function TimelinePattern({ pattern, layout }) {
  const primaryModule = pattern.moduleReferences?.[0];
  const left = ((pattern.position.x - layout.startLine) / layout.duration) * 100;
  const width = (pattern.lines / layout.duration) * 100;
  const top = pattern.position.y - layout.startY + TIMELINE_Y_PADDING + TIMELINE_PATTERN_Y_INSET;
  const clone = isClonePattern(pattern);
  const iconOnly = isIconOnlyTimelinePattern(pattern);
  return (
    <div
      className={`timeline-pattern${clone ? " is-clone" : ""}${iconOnly ? " is-icon-only" : ""}`}
      data-pattern-index={pattern.index}
      data-pattern-lines={pattern.lines}
      style={{
        "--pattern-color": primaryModule?.color,
        left: percent(left),
        top: `${top}px`,
        width: percent(width),
      }}
      title={`#${pattern.index} ${pattern.name || "(unnamed)"}${clone ? ` clone of #${pattern.parent}` : ""} lines=${pattern.lines} events=${pattern.eventCount}`}
    >
      {pattern.icon ? (
        <img
          className="timeline-pattern-icon"
          src={pattern.icon.src}
          width={pattern.icon.width}
          height={pattern.icon.height}
          alt=""
          aria-hidden="true"
        />
      ) : null}
      {iconOnly ? null : (
        <span className="timeline-pattern-label">
          #{pattern.index} {pattern.name || "(unnamed)"}
        </span>
      )}
    </div>
  );
}

function TimelineSection({ project }) {
  const layout = useMemo(() => timelineLayout(project), [project]);
  if (!layout) {
    return null;
  }
  return (
    <section className="section-grid" aria-labelledby="timeline-heading">
      <h3 id="timeline-heading">Timeline</h3>
      <div
        className="timeline-panel"
        role="img"
        aria-label={`${project.title} ${layout.supertracks ? "supertracks" : "classic"} timeline`}
      >
        <div className="timeline-canvas" style={{ "--timeline-width": `${layout.width}px` }}>
          <div className="timeline-header">
            <div className="timeline-lane-label" />
            <div className="timeline-axis">
              {layout.ticks.map((line) => (
                <span
                  className="timeline-tick-label"
                  key={line}
                  style={{ left: percent(((line - layout.startLine) / layout.duration) * 100) }}
                >
                  {line}
                </span>
              ))}
            </div>
          </div>
          <div className="timeline-body" style={{ height: `${layout.height}px` }}>
            <div className="timeline-lane-column">
              {layout.laneGuides.map((lane) => (
                <span
                  className="timeline-lane-number"
                  key={lane.lane}
                  style={{ top: `${lane.labelTop}px` }}
                  aria-label={`Supertrack ${lane.label}`}
                >
                  {lane.label}
                </span>
              ))}
            </div>
            <div className="timeline-plot">
              {layout.ticks.map((line) => (
                <span
                  className="timeline-grid-line"
                  key={line}
                  style={{ left: percent(((line - layout.startLine) / layout.duration) * 100) }}
                />
              ))}
              {layout.laneGuides.map((lane) => (
                <span className="timeline-lane-guide" key={lane.lane} style={{ top: `${lane.lineTop}px` }} />
              ))}
              {layout.patterns.map((pattern) => (
                <TimelinePattern key={pattern.index} pattern={pattern} layout={layout} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PatternList({ patterns }) {
  return (
    <div className="pattern-grid">
      {patterns.map((pattern) => {
        const moduleReferences = pattern.moduleReferences ?? [];
        return (
          <div className="pattern-row" key={pattern.index}>
            <div className="pattern-title">
              {pattern.icon ? (
                <img
                  className="pattern-icon"
                  src={pattern.icon.src}
                  width={pattern.icon.width}
                  height={pattern.icon.height}
                  alt=""
                  aria-hidden="true"
                />
              ) : null}
              <span className="pattern-name">
                #{pattern.index} {pattern.name || "(unnamed)"}
              </span>
            </div>
            <div className="pattern-meta">
              lines={compact(pattern.lines)} tracks={compact(pattern.tracks)} events={compact(pattern.eventCount)}
            </div>
            {moduleReferences.length ? (
              <div className="module-reference-list" aria-label={`Modules used by pattern ${pattern.index}`}>
                {moduleReferences.map((module) => (
                  <span
                    className="module-reference-pill"
                    key={module.index}
                    style={{ "--module-color": module.color }}
                  >
                    <span className="module-reference-id">{moduleHexId(module.index)}</span>
                    {module.name}
                    {module.type ? <span className="module-reference-type">{module.type}</span> : null}
                    <span className="module-reference-count">{module.eventCount}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function PatternSection({ project }) {
  const patterns = listedPatterns(project);
  if (!patterns.length) {
    return null;
  }
  return (
    <section className="section-grid" aria-labelledby="patterns-heading">
      <h3 id="patterns-heading">Patterns</h3>
      <PatternList patterns={patterns} />
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
      <div className="embedded-grid">
        {project.embedded.map((embedded) => (
          <EmbeddedProject key={`${embedded.hostModule}-${embedded.dataChunkIndex}`} embedded={embedded} />
        ))}
      </div>
    </section>
  );
}

function EmbeddedProject({ embedded }) {
  const graph = useMemo(() => buildGraphLayout(embedded.document), [embedded.document]);
  const patterns = listedPatterns(embedded.document);
  const graphId = svgId(`embedded-${embedded.hostModule}-${embedded.dataChunkIndex}-${embedded.hostName}`);
  return (
    <article className="embedded-row">
      <div className="embedded-header">
        <div>
          <span className="module-name">
            {moduleHexId(embedded.hostModule)} {embedded.hostName}
          </span>
          <div className="module-meta">
            {embedded.dataChunkName || "container"} {embedded.dataChunkIndex}
          </div>
        </div>
        <div className="module-meta">
          modules={embedded.document.stats.activeModules} links={embedded.document.stats.links} patterns=
          {patternCount(embedded.document)}
        </div>
      </div>
      {graph ? (
        <div className="graph-panel embedded-graph-panel">
          <ModuleGraphSvg
            graph={graph}
            graphId={graphId}
            label={`Embedded module graph for ${embedded.hostName}`}
          />
        </div>
      ) : null}
      {patterns.length ? (
        <section className="embedded-patterns" aria-label={`${embedded.hostName} patterns`}>
          <h4>Patterns</h4>
          <PatternList patterns={patterns} />
        </section>
      ) : null}
    </article>
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
        {metric("patterns", patternCount(project))}
        {metric("events", project.stats.events)}
        {metric("embedded", project.stats.embeddedContainers)}
      </div>

      <div className="section-grid">
        <ModuleGraphSection project={project} />
        <SynthKeyboardSection project={project} />
        <TimelineSection project={project} />
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
  const [masterVolume, setMasterVolume] = useState(DEFAULT_MASTER_VOLUME);
  const topbarControlsRoot = useMemo(() => document.getElementById("topbar-controls"), []);

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

  useEffect(() => {
    function applyVolume() {
      window.setMasterVolume?.(masterVolume);
    }
    applyVolume();
    window.addEventListener("sunvox-player-api-ready", applyVolume);
    return () => {
      window.removeEventListener("sunvox-player-api-ready", applyVolume);
    };
  }, [masterVolume]);

  return (
    <>
      {topbarControlsRoot
        ? createPortal(
            <TopbarControls project={selectedProject} volume={masterVolume} onVolumeChange={setMasterVolume} />,
            topbarControlsRoot,
          )
        : null}
      <main className="app-shell">
        <ProjectList projects={projects} selectedPath={selectedPath} onSelect={setSelectedPath} />
        <ProjectDetails project={selectedProject} error={error} />
      </main>
    </>
  );
}

createRoot(document.getElementById("app-root")).render(<App />);
