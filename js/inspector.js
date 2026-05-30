(function () {
    const state = {
        projects: [],
        selectedPath: "",
    };

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }

    function compact(value) {
        return value === undefined || value === null || value === "" ? "-" : value;
    }

    function metric(label, value) {
        return `<div class="metric"><strong>${escapeHtml(compact(value))}</strong>${escapeHtml(label)}</div>`;
    }

    function typeLabel(project) {
        return project.type === "synth" ? "SunSynth" : "SunVox";
    }

    function projectSubtitle(project) {
        if (project.project) {
            return `${project.stats.activeModules} modules, ${project.stats.patterns} patterns, ${project.stats.events} events`;
        }
        return `${project.stats.activeModules} modules, ${project.stats.embeddedContainers} embedded`;
    }

    function renderProjectList() {
        const list = document.getElementById("project-list");
        list.innerHTML = state.projects.map((project) => `
            <button
                type="button"
                class="project-button"
                data-project-path="${escapeHtml(project.path)}"
                aria-current="${project.path === state.selectedPath ? "true" : "false"}"
            >
                <span>
                    <span class="project-title">${escapeHtml(project.title)}</span><br>
                    <span class="project-path">${escapeHtml(project.path)}</span>
                </span>
                <span class="badge">${escapeHtml(typeLabel(project))}</span>
            </button>
        `).join("");

        for (const button of list.querySelectorAll("[data-project-path]")) {
            button.addEventListener("click", () => selectProject(button.dataset.projectPath));
        }
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

    function renderPatterns(project) {
        if (!project.patterns.length) {
            return "";
        }
        return `
            <section class="section-grid" aria-labelledby="patterns-heading">
                <h3 id="patterns-heading">Patterns</h3>
                <div class="pattern-grid">
                    ${project.patterns.map((pattern) => `
                        <div class="pattern-row">
                            <div>
                                <span class="pattern-name">#${escapeHtml(pattern.index)} ${escapeHtml(pattern.name || "(unnamed)")}</span>
                            </div>
                            <div class="pattern-meta">
                                lines=${escapeHtml(pattern.lines)} tracks=${escapeHtml(pattern.tracks)} events=${escapeHtml(pattern.eventCount)}
                            </div>
                            ${pattern.eventPreview.length ? `
                                <div class="event-preview">
                                    ${pattern.eventPreview.map((event) => `<span class="event-pill">${escapeHtml(eventText(event))}</span>`).join("")}
                                </div>
                            ` : ""}
                        </div>
                    `).join("")}
                </div>
            </section>
        `;
    }

    function renderModules(project) {
        return `
            <section class="section-grid" aria-labelledby="modules-heading">
                <h3 id="modules-heading">Modules</h3>
                <div class="module-grid">
                    ${project.modules.map((module) => `
                        <div class="module-row">
                            <div>
                                <span class="module-name">#${escapeHtml(module.index)} ${escapeHtml(module.name)}</span>
                                <div class="module-meta">${escapeHtml(module.type || module.kind)}</div>
                            </div>
                            <div class="module-meta">
                                controllers=${escapeHtml(module.controllerCount)}
                                data=${escapeHtml(module.dataChunkCount)}
                                links=${escapeHtml(module.inputCount + module.outputCount)}
                            </div>
                        </div>
                    `).join("")}
                </div>
            </section>
        `;
    }

    function renderLinks(project) {
        if (!project.links.length) {
            return "";
        }
        return `
            <section class="section-grid" aria-labelledby="links-heading">
                <h3 id="links-heading">Links</h3>
                <div class="link-grid">
                    ${project.links.map((link) => `
                        <div class="link-row">
                            <strong>#${escapeHtml(link.from)} ${escapeHtml(link.fromName)}</strong>
                            -&gt;
                            <strong>#${escapeHtml(link.to)} ${escapeHtml(link.toName)}</strong>
                            <span>${escapeHtml(link.kind)}${link.fromSlot !== undefined ? ` fromSlot=${escapeHtml(link.fromSlot)}` : ""}${link.toSlot !== undefined ? ` toSlot=${escapeHtml(link.toSlot)}` : ""}</span>
                        </div>
                    `).join("")}
                </div>
            </section>
        `;
    }

    function renderEmbedded(project) {
        if (!project.embedded.length) {
            return "";
        }
        return `
            <section class="section-grid" aria-labelledby="embedded-heading">
                <h3 id="embedded-heading">Embedded</h3>
                <div class="module-grid">
                    ${project.embedded.map((embedded) => `
                        <div class="module-row">
                            <div>
                                <span class="module-name">#${escapeHtml(embedded.hostModule)} ${escapeHtml(embedded.hostName)}</span>
                                <div class="module-meta">${escapeHtml(embedded.dataChunkName || "container")} #${escapeHtml(embedded.dataChunkIndex)}</div>
                            </div>
                            <div class="module-meta">
                                modules=${escapeHtml(embedded.document.stats.activeModules)}
                                patterns=${escapeHtml(embedded.document.stats.patterns)}
                            </div>
                        </div>
                    `).join("")}
                </div>
            </section>
        `;
    }

    function renderDetails(project) {
        const details = document.getElementById("project-details");
        const playable = project.type === "project";
        details.innerHTML = `
            <div class="details-header">
                <div>
                    <h2>${escapeHtml(project.title)}</h2>
                    <div class="project-path">${escapeHtml(project.path)}</div>
                </div>
                <div class="project-actions">
                    ${playable ? `
                        <button type="button" id="selected-play"><span aria-hidden="true">▶</span> Play</button>
                        <button type="button" id="selected-stop"><span aria-hidden="true">■</span> Stop</button>
                    ` : ""}
                    <a class="action-link" href="${escapeHtml(project.path)}" download>Download</a>
                </div>
            </div>

            <div class="metrics" aria-label="Project metrics">
                ${metric("type", typeLabel(project))}
                ${metric("modules", project.stats.activeModules)}
                ${metric("links", project.stats.links)}
                ${metric("patterns", project.stats.patterns)}
                ${metric("events", project.stats.events)}
                ${metric("embedded", project.stats.embeddedContainers)}
            </div>

            <div class="section-grid">
                ${renderModules(project)}
                ${renderLinks(project)}
                ${renderPatterns(project)}
                ${renderEmbedded(project)}
            </div>
        `;

        document.getElementById("selected-play")?.addEventListener("click", () => {
            if (typeof window.loadAndPlay === "function") {
                window.loadAndPlay(project.path);
            }
        });
        document.getElementById("selected-stop")?.addEventListener("click", () => {
            if (typeof window.stopPlayback === "function") {
                window.stopPlayback();
            }
        });
    }

    function selectProject(path) {
        const project = state.projects.find((candidate) => candidate.path === path);
        if (!project) {
            return;
        }
        state.selectedPath = path;
        renderProjectList();
        renderDetails(project);
    }

    async function loadProjectIndex() {
        const response = await fetch("site-data/sunvox-projects.json");
        if (!response.ok) {
            throw new Error(`Project index ${response.status}`);
        }
        const data = await response.json();
        state.projects = data.projects ?? [];
        state.selectedPath = state.projects[0]?.path ?? "";
        renderProjectList();
        if (state.selectedPath) {
            renderDetails(state.projects[0]);
        } else {
            document.getElementById("project-details").innerHTML = '<p class="muted">No project data.</p>';
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        loadProjectIndex().catch((error) => {
            document.getElementById("project-details").innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
        });
    });
}());
