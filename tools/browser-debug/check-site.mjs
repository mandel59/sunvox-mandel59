import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_URL = 'http://127.0.0.1:5173/';
const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '..', '..');
const screenshotPath = path.join(repoRoot, 'var', 'browser-debug', 'playwright-site-check.png');

async function launchBrowser(headed) {
  const launchOptions = { headless: !headed };
  try {
    return await chromium.launch(launchOptions);
  } catch (error) {
    return await chromium.launch({ ...launchOptions, channel: 'msedge' });
  }
}

export async function checkSite({ url = DEFAULT_URL, headed = false } = {}) {
  const browser = await launchBrowser(headed);
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    const badResponses = [];

    page.on('pageerror', (error) => {
      errors.push(`pageerror: ${error.message}`);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') {
        const location = message.location();
        const suffix = location.url ? ` (${location.url}:${location.lineNumber}:${location.columnNumber})` : '';
        errors.push(`console.error: ${message.text()}${suffix}`);
      }
    });
    page.on('response', (response) => {
      if (response.status() >= 400) {
        badResponses.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto(url, { waitUntil: 'networkidle' });

    const initial = await page.evaluate(() => ({
      title: document.title,
      h1: document.querySelector('h1')?.textContent ?? null,
      projectButtons: document.querySelectorAll('.project-button').length,
      selected: document.querySelector('#project-details h2')?.textContent ?? null,
      graphSections: document.querySelectorAll('.module-graph').length,
      graphNodes: document.querySelectorAll('.graph-nodes g').length,
      graphEdges: document.querySelectorAll('.graph-edges line').length,
      licenseLinks: document.querySelectorAll('.licenses a').length,
      topbarButtons: document.querySelectorAll('#topbar-controls button').length,
      topbarVolume: document.querySelector('#topbar-controls input[type="range"]')?.value ?? null,
      topbarVolumeOutput: document.querySelector('#topbar-controls output')?.textContent ?? null,
      synthKeyboardKeys: document.querySelectorAll('.virtual-keyboard .piano-key').length,
      synthKeyboardWhiteKeys: document.querySelectorAll('.virtual-keyboard .piano-key.is-white').length,
      synthKeyboardBlackKeys: document.querySelectorAll('.virtual-keyboard .piano-key.is-black').length,
      synthOctaveButtons: document.querySelectorAll('.octave-button').length,
      synthKeyboardRange: document.querySelector('.octave-range')?.textContent ?? null,
      synthScrollLaneHeight: document.querySelector('.keyboard-scroll-lane')?.getBoundingClientRect().height ?? null,
    }));
    if (initial.topbarButtons !== 2) {
      throw new Error(`Expected two topbar playback buttons, got ${initial.topbarButtons}`);
    }
    if (initial.topbarVolume !== '256' || initial.topbarVolumeOutput !== '100%') {
      throw new Error(`Expected initial master volume 100%, got ${initial.topbarVolume}/${initial.topbarVolumeOutput}`);
    }
    if (
      initial.synthKeyboardKeys !== 25 ||
      initial.synthKeyboardWhiteKeys !== 15 ||
      initial.synthKeyboardBlackKeys !== 10 ||
      initial.synthOctaveButtons !== 2 ||
      initial.synthKeyboardRange !== 'C4-C6' ||
      !(initial.synthScrollLaneHeight >= 18)
    ) {
      throw new Error(
        `Expected a two-octave synth keyboard with octave controls, got ${JSON.stringify(initial)}`,
      );
    }

    const synthOctaveUi = await page.evaluate(async () => {
      const snapshot = () => ({
        range: document.querySelector('.octave-range')?.textContent ?? null,
        firstKey: document.querySelector('.virtual-keyboard .piano-key.is-white')?.getAttribute('aria-label') ?? null,
        lastKey:
          Array.from(document.querySelectorAll('.virtual-keyboard .piano-key.is-white')).at(-1)?.getAttribute(
            'aria-label',
          ) ?? null,
      });
      const upButton = document.querySelector('.octave-button[aria-label="Octave up"]');
      const downButton = document.querySelector('.octave-button[aria-label="Octave down"]');
      const initialRange = snapshot();
      upButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const shiftedUp = snapshot();
      downButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const shiftedBack = snapshot();
      return { initialRange, shiftedUp, shiftedBack };
    });
    if (
      synthOctaveUi.initialRange.range !== 'C4-C6' ||
      synthOctaveUi.shiftedUp.range !== 'C5-C7' ||
      synthOctaveUi.shiftedUp.firstKey !== 'C5' ||
      synthOctaveUi.shiftedUp.lastKey !== 'C7' ||
      synthOctaveUi.shiftedBack.range !== 'C4-C6'
    ) {
      throw new Error(`Expected octave controls to shift the synth keyboard, got ${JSON.stringify(synthOctaveUi)}`);
    }

    const wideSynthKeyboard = await page.evaluate(() => {
      const frame = document.querySelector('.virtual-keyboard-frame');
      const keyboard = document.querySelector('.virtual-keyboard');
      return {
        viewportWidth: window.innerWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
        frameClientWidth: frame?.clientWidth ?? null,
        frameScrollWidth: frame?.scrollWidth ?? null,
        keyboardWidth: keyboard?.getBoundingClientRect().width ?? null,
        scrollLaneHeight: document.querySelector('.keyboard-scroll-lane')?.getBoundingClientRect().height ?? null,
        scrollLaneTouchAction: getComputedStyle(document.querySelector('.keyboard-scroll-lane')).touchAction,
      };
    });
    if (wideSynthKeyboard.frameScrollWidth > wideSynthKeyboard.frameClientWidth) {
      throw new Error(`Expected synth keyboard not to scroll at the wide viewport, got ${JSON.stringify(wideSynthKeyboard)}`);
    }
    if (wideSynthKeyboard.scrollLaneTouchAction !== 'pan-x' || !(wideSynthKeyboard.scrollLaneHeight >= 18)) {
      throw new Error(`Expected synth keyboard to expose a horizontal scroll lane, got ${JSON.stringify(wideSynthKeyboard)}`);
    }

    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(100);
    const narrowSynthKeyboard = await page.evaluate(() => {
      const frame = document.querySelector('.virtual-keyboard-frame');
      const keyboard = document.querySelector('.virtual-keyboard');
      return {
        viewportWidth: window.innerWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
        frameClientWidth: frame?.clientWidth ?? null,
        frameScrollWidth: frame?.scrollWidth ?? null,
        keyboardWidth: keyboard?.getBoundingClientRect().width ?? null,
        scrollLaneHeight: document.querySelector('.keyboard-scroll-lane')?.getBoundingClientRect().height ?? null,
      };
    });
    if (narrowSynthKeyboard.pageScrollWidth > narrowSynthKeyboard.viewportWidth + 1) {
      throw new Error(`Expected narrow viewport not to overflow the page, got ${JSON.stringify(narrowSynthKeyboard)}`);
    }
    if (!(narrowSynthKeyboard.frameScrollWidth > narrowSynthKeyboard.frameClientWidth)) {
      throw new Error(`Expected synth keyboard frame to scroll horizontally, got ${JSON.stringify(narrowSynthKeyboard)}`);
    }
    if (!(narrowSynthKeyboard.scrollLaneHeight >= 18)) {
      throw new Error(`Expected synth keyboard scroll lane to remain touch-sized, got ${JSON.stringify(narrowSynthKeyboard)}`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(100);

    const synthGlissandoUi = await page.evaluate(async () => {
      const calls = {
        noteOn: [],
        noteOff: [],
      };
      const originalPlaySynthNote = window.playSynthNote;
      const originalStopSynthNote = window.stopSynthNote;
      const originalStopInstrumentNotes = window.stopInstrumentNotes;
      window.playSynthNote = async (url, note, velocity) => {
        calls.noteOn.push({ url, note, velocity });
        return true;
      };
      window.stopSynthNote = (note) => {
        calls.noteOff.push(note);
        return true;
      };
      window.stopInstrumentNotes = () => true;
      try {
        const keyC = document.querySelector('.piano-key[aria-label="C5"]');
        const keyD = document.querySelector('.piano-key[aria-label="D5"]');
        const keyE = document.querySelector('.piano-key[aria-label="E5"]');
        const point = (element) => {
          const rect = element.getBoundingClientRect();
          return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height - 8,
          };
        };
        const dispatchPointer = (element, type, position, buttons) => {
          element.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              pointerId: 1,
              pointerType: 'mouse',
              buttons,
              clientX: position.x,
              clientY: position.y,
            }),
          );
        };
        const c = point(keyC);
        const d = point(keyD);
        const e = point(keyE);
        dispatchPointer(keyC, 'pointerdown', c, 1);
        await new Promise((resolve) => setTimeout(resolve, 0));
        dispatchPointer(keyC, 'pointermove', d, 1);
        await new Promise((resolve) => setTimeout(resolve, 0));
        dispatchPointer(keyC, 'pointermove', e, 1);
        await new Promise((resolve) => setTimeout(resolve, 0));
        dispatchPointer(keyC, 'pointerup', e, 0);
        await new Promise((resolve) => setTimeout(resolve, 0));
        return calls;
      } finally {
        window.playSynthNote = originalPlaySynthNote;
        window.stopSynthNote = originalStopSynthNote;
        window.stopInstrumentNotes = originalStopInstrumentNotes;
      }
    });
    if (synthGlissandoUi.noteOn.map(({ note }) => note).join(',') !== '60,62,64') {
      throw new Error(`Expected synth drag to glide C5,D5,E5, got ${JSON.stringify(synthGlissandoUi)}`);
    }
    if (synthGlissandoUi.noteOff.join(',') !== '60,62,64') {
      throw new Error(`Expected synth drag to stop prior/current notes, got ${JSON.stringify(synthGlissandoUi)}`);
    }

    const synthPlayback = await page.evaluate(async () => {
      const calls = {
        loadModule: [],
        connectModule: [],
        sendEvent: [],
      };
      const originalLoadModule = window.sv_load_module_from_memory;
      const originalConnectModule = window.sv_connect_module;
      const originalSendEvent = window.sv_send_event;
      window.sv_load_module_from_memory = (slot, byteArray, x, y, z) => {
        const moduleIndex = originalLoadModule(slot, byteArray, x, y, z);
        calls.loadModule.push({ slot, bytes: byteArray.byteLength, x, y, z, moduleIndex });
        return moduleIndex;
      };
      window.sv_connect_module = (slot, source, destination) => {
        calls.connectModule.push({ slot, source, destination });
        return originalConnectModule(slot, source, destination);
      };
      window.sv_send_event = (slot, track, note, velocity, module, controller, value) => {
        calls.sendEvent.push({ slot, track, note, velocity, module, controller, value });
        return originalSendEvent(slot, track, note, velocity, module, controller, value);
      };
      try {
        const noteOn = await window.playSynthNote('instruments/mandel59 shepard.sunsynth', 60, 128);
        const noteOff = window.stopSynthNote(60);
        window.stopInstrumentNotes?.();
        return { noteOn, noteOff, calls };
      } finally {
        window.sv_load_module_from_memory = originalLoadModule;
        window.sv_connect_module = originalConnectModule;
        window.sv_send_event = originalSendEvent;
      }
    });
    const loadedSynthModule = synthPlayback.calls.loadModule[0]?.moduleIndex;
    const noteOnEvent = synthPlayback.calls.sendEvent.find((event) => event.note === 61);
    const noteOffEvent = synthPlayback.calls.sendEvent.find((event) => event.note === 128);
    if (
      !synthPlayback.noteOn ||
      !synthPlayback.noteOff ||
      !(loadedSynthModule > 0) ||
      synthPlayback.calls.connectModule[0]?.destination !== 0 ||
      noteOnEvent?.module !== loadedSynthModule + 1 ||
      noteOnEvent?.velocity !== 128 ||
      noteOffEvent?.module !== loadedSynthModule + 1
    ) {
      throw new Error(`Expected synth keyboard to load/connect/send note events, got ${JSON.stringify(synthPlayback)}`);
    }

    const musicButton = page.locator('.project-button', { hasText: 'music/2022-04-17.sunvox' });
    const musicButtonCount = await musicButton.count();
    if (musicButtonCount !== 1) {
      throw new Error(`Expected one music project button, found ${musicButtonCount}`);
    }

    await musicButton.click();
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      const input = document.querySelector('#topbar-controls input[type="range"]');
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      valueSetter.call(input, '128');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(50);

    const afterSelect = await page.evaluate(() => ({
      selected: document.querySelector('#project-details h2')?.textContent ?? null,
      graphSections: document.querySelectorAll('.module-graph').length,
      graphNodes: document.querySelectorAll('.graph-nodes g').length,
      graphEdges: document.querySelectorAll('.graph-edges line').length,
      patternRows: document.querySelectorAll('.pattern-row').length,
      moduleRows: document.querySelectorAll('.module-row').length,
      timelineLaneNumbers: Array.from(document.querySelectorAll('.timeline-lane-number')).map((element) =>
        element.textContent.trim(),
      ),
      timelineMuteButtons: document.querySelectorAll('.timeline-mute-control').length,
      topbarPlayDisabled: document.querySelector('#topbar-controls button')?.disabled ?? null,
      topbarVolume: document.querySelector('#topbar-controls input[type="range"]')?.value ?? null,
      topbarVolumeOutput: document.querySelector('#topbar-controls output')?.textContent ?? null,
      playerVolume: window.getMasterVolume?.() ?? null,
    }));
    if (afterSelect.topbarPlayDisabled !== false) {
      throw new Error(`Expected selected project to enable topbar play, got disabled=${afterSelect.topbarPlayDisabled}`);
    }
    if (afterSelect.topbarVolume !== '128' || afterSelect.topbarVolumeOutput !== '50%' || afterSelect.playerVolume !== 128) {
      throw new Error(
        `Expected master volume 50%, got ${afterSelect.topbarVolume}/${afterSelect.topbarVolumeOutput}/${afterSelect.playerVolume}`,
      );
    }
    const playbackVolume = await page.evaluate(async () => {
      const calls = [];
      const originalVolume = window.sv_volume;
      window.sv_volume = (slot, volume) => {
        calls.push([slot, volume]);
        return originalVolume(slot, volume);
      };
      try {
        const result = await window.loadAndPlay('music/2022-04-17.sunvox');
        window.stopPlayback?.();
        return { result, calls, playerVolume: window.getMasterVolume?.() ?? null };
      } finally {
        window.sv_volume = originalVolume;
      }
    });
    const masterVolumeReapplications = playbackVolume.calls.filter(
      ([slot, volume]) => slot === 0 && volume === 128,
    ).length;
    if (!playbackVolume.result || playbackVolume.playerVolume !== 128 || masterVolumeReapplications < 2) {
      throw new Error(
        `Expected master volume to be reapplied during load/play, got ${JSON.stringify(playbackVolume)}`,
      );
    }

    const supertrackButton = page.locator('.project-button', { hasText: 'music/2022-04-18.sunvox' });
    const supertrackButtonCount = await supertrackButton.count();
    if (supertrackButtonCount !== 1) {
      throw new Error(`Expected one supertrack project button, found ${supertrackButtonCount}`);
    }

    await supertrackButton.click();
    await page.waitForTimeout(250);

    const supertrackTimeline = await page.evaluate(() => ({
      selected: document.querySelector('#project-details h2')?.textContent ?? null,
      timelineLaneNumbers: Array.from(document.querySelectorAll('.timeline-lane-number')).map((element) =>
        element.textContent.trim(),
      ),
      timelineMuteButtons: document.querySelectorAll('.timeline-mute-control').length,
      timelinePatterns: Array.from(document.querySelectorAll('.timeline-pattern')).map((element) => ({
        text: element.textContent.trim(),
        top: element.style.top,
      })),
      timelineTicks: Array.from(document.querySelectorAll('.timeline-tick-label')).map((element) =>
        element.textContent.trim(),
      ),
      timelineClonePatterns: document.querySelectorAll('.timeline-pattern.is-clone').length,
      patternRows: document.querySelectorAll('.pattern-row').length,
      clonePatternRows: document.querySelectorAll('.pattern-row.is-clone').length,
    }));
    if (supertrackTimeline.timelineLaneNumbers.join(',') !== '1,2') {
      throw new Error(`Expected occupied supertrack lanes 1,2, got ${supertrackTimeline.timelineLaneNumbers.join(',')}`);
    }
    if (supertrackTimeline.timelineMuteButtons !== 0) {
      throw new Error(`Expected no timeline mute buttons, got ${supertrackTimeline.timelineMuteButtons}`);
    }
    if (supertrackTimeline.timelinePatterns.length !== 6) {
      throw new Error(`Expected three source patterns and three clones, got ${supertrackTimeline.timelinePatterns.length}`);
    }
    if (supertrackTimeline.timelineClonePatterns !== 3) {
      throw new Error(`Expected three clone timeline patterns, got ${supertrackTimeline.timelineClonePatterns}`);
    }
    if (supertrackTimeline.patternRows !== 3) {
      throw new Error(`Expected only three source pattern rows, got ${supertrackTimeline.patternRows}`);
    }
    if (supertrackTimeline.clonePatternRows !== 0) {
      throw new Error(`Expected no clone pattern rows, got ${supertrackTimeline.clonePatternRows}`);
    }
    if (supertrackTimeline.timelineTicks.join(',') !== '0,64,128,192') {
      throw new Error(`Expected 64-line ticks for supertrack timeline, got ${supertrackTimeline.timelineTicks.join(',')}`);
    }

    const denseButton = page.locator('.project-button', { hasText: 'music/2022-04-16.sunvox' });
    const denseButtonCount = await denseButton.count();
    if (denseButtonCount !== 1) {
      throw new Error(`Expected one dense timeline project button, found ${denseButtonCount}`);
    }

    await denseButton.click();
    await page.waitForTimeout(250);

    const denseTimeline = await page.evaluate(() => {
      const shortPattern = document.querySelector('.timeline-pattern[data-pattern-index="1"]');
      const longPattern = document.querySelector('.timeline-pattern[data-pattern-index="0"]');
      const plot = document.querySelector('.timeline-plot');
      return {
        selected: document.querySelector('#project-details h2')?.textContent ?? null,
        plotWidth: plot?.getBoundingClientRect().width ?? null,
        shortPattern: shortPattern
          ? {
              text: shortPattern.textContent.trim(),
              className: shortPattern.className,
              width: shortPattern.getBoundingClientRect().width,
              labelCount: shortPattern.querySelectorAll('.timeline-pattern-label').length,
            }
          : null,
        longPattern: longPattern
          ? {
              width: longPattern.getBoundingClientRect().width,
              labelCount: longPattern.querySelectorAll('.timeline-pattern-label').length,
            }
          : null,
        tickLabels: Array.from(document.querySelectorAll('.timeline-tick-label')).map((element) =>
          element.textContent.trim(),
        ),
      };
    });
    if (!denseTimeline.shortPattern?.className.includes('is-icon-only')) {
      throw new Error(`Expected pattern #1 to be icon-only, got ${denseTimeline.shortPattern?.className}`);
    }
    if (denseTimeline.shortPattern.labelCount !== 0) {
      throw new Error(`Expected pattern #1 label to be hidden, got ${denseTimeline.shortPattern.labelCount}`);
    }
    if (!(denseTimeline.shortPattern.width < denseTimeline.longPattern.width)) {
      throw new Error(
        `Expected lines=32 pattern to be narrower than lines=64 pattern, got ${denseTimeline.shortPattern.width} >= ${denseTimeline.longPattern.width}`,
      );
    }
    if (Math.abs(denseTimeline.plotWidth - 896) > 1) {
      throw new Error(`Expected 1:1 timeline plot width for 896 lines, got ${denseTimeline.plotWidth}`);
    }
    if (Math.abs(denseTimeline.shortPattern.width - 32) > 1) {
      throw new Error(`Expected lines=32 pattern width to be 32px, got ${denseTimeline.shortPattern.width}`);
    }
    if (Math.abs(denseTimeline.longPattern.width - 64) > 1) {
      throw new Error(`Expected lines=64 pattern width to be 64px, got ${denseTimeline.longPattern.width}`);
    }
    if (denseTimeline.tickLabels.join(',') !== '0,64,128,192,256,320,384,448,512,576,640,704,768,832,896') {
      throw new Error(`Expected 64-line ticks for dense timeline, got ${denseTimeline.tickLabels.join(',')}`);
    }

    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });

    return {
      url,
      headed,
      initial,
      wideSynthKeyboard,
      synthGlissandoUi,
      afterSelect,
      supertrackTimeline,
      denseTimeline,
      errors,
      badResponses,
      screenshot: path.relative(repoRoot, screenshotPath).replaceAll('\\', '/'),
    };
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = new Set(process.argv.slice(2));
  const result = await checkSite({
    headed: args.has('--headed'),
    url: process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? DEFAULT_URL,
  });

  console.log(JSON.stringify(result, null, 2));

  const seriousErrors = result.errors.filter((error) => !error.includes('/favicon.ico'));
  const seriousBadResponses = result.badResponses.filter((response) => !response.includes('/favicon.ico'));

  if (seriousErrors.length > 0 || seriousBadResponses.length > 0) {
    process.exitCode = 1;
  }
}
