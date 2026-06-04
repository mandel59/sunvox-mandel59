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

    const synthFixtureButton = page.locator('.project-button', { hasText: 'instruments/mandel59 shepard.sunsynth' });
    await synthFixtureButton.click();
    await page.waitForTimeout(100);

    const initial = await page.evaluate(() => ({
      title: document.title,
      h1: document.querySelector('h1')?.textContent ?? null,
      projectButtons: document.querySelectorAll('.project-button').length,
      selected: document.querySelector('#project-details h2')?.textContent ?? null,
      detailsHeaderGap: (() => {
        const header = document.querySelector('.details-header')?.getBoundingClientRect();
        const heading = document.querySelector('#properties-heading')?.getBoundingClientRect();
        return header && heading ? heading.top - header.bottom : null;
      })(),
      graphSections: document.querySelectorAll('.module-graph').length,
      graphNodes: document.querySelectorAll('.graph-nodes g').length,
      graphEdges: document.querySelectorAll('.graph-edges line').length,
      topLevelMetrics: document.querySelectorAll('#project-details > .metrics').length,
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
      synthControlsBeforeKeyboard: (() => {
        const controls = document.querySelector('.instrument-controls')?.getBoundingClientRect();
        const keyboard = document.querySelector('.virtual-keyboard-frame')?.getBoundingClientRect();
        return controls && keyboard ? controls.top < keyboard.top : false;
      })(),
      synthPropertiesBesideInstrument: (() => {
        const instrument = document.querySelector('[aria-labelledby="instrument-heading"]')?.getBoundingClientRect();
        const properties = document.querySelector('[aria-labelledby="properties-heading"]')?.getBoundingClientRect();
        return instrument && properties
          ? Math.abs(instrument.top - properties.top) < 8 && instrument.right <= properties.left
          : false;
      })(),
      synthPropertiesControllersRight: (() => {
        const blocks = Array.from(document.querySelectorAll('[aria-labelledby="properties-heading"] .property-block'));
        const controllers = blocks
          .find((block) => block.querySelector('h4')?.textContent.trim() === 'Controllers')
          ?.getBoundingClientRect();
        const data = blocks
          .find((block) => block.querySelector('h4')?.textContent.trim() === 'Data')
          ?.getBoundingClientRect();
        return controllers && data ? controllers.left > data.left : false;
      })(),
      synthControllerKnobs: document.querySelectorAll('.instrument-knob[role="slider"]').length,
      synthControllerLabels: Array.from(document.querySelectorAll('.instrument-control-label')).map((element) =>
        element.textContent.trim(),
      ),
      propertiesHeading: document.querySelector('#properties-heading')?.textContent ?? null,
      propertiesText: document.querySelector('[aria-labelledby="properties-heading"] .properties-panel')?.textContent ?? null,
      embeddedMeta: document.querySelector('[aria-labelledby="embedded-heading"] .section-meta')?.textContent ?? null,
      propertyFlags: Array.from(
        document.querySelectorAll('[aria-labelledby="properties-heading"] .property-flag'),
      ).map((element) => element.textContent.trim()),
    }));
    if (initial.topbarButtons !== 2) {
      throw new Error(`Expected two topbar playback buttons, got ${initial.topbarButtons}`);
    }
    if (!(initial.detailsHeaderGap >= 12)) {
      throw new Error(`Expected details header divider to have bottom spacing, got ${initial.detailsHeaderGap}`);
    }
    if (initial.topLevelMetrics !== 0) {
      throw new Error(`Expected no top-level file metrics summary, got ${initial.topLevelMetrics}`);
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
      !(initial.synthScrollLaneHeight >= 18) ||
      !initial.synthControlsBeforeKeyboard ||
      initial.synthControllerKnobs < 1 ||
      !initial.synthControllerLabels.includes('Octave') ||
      !initial.synthControllerLabels.includes('Volume')
    ) {
      throw new Error(
        `Expected a two-octave synth keyboard with octave and controller controls, got ${JSON.stringify(initial)}`,
      );
    }
    if (
      initial.propertiesHeading !== 'Synth Properties' ||
      !initial.propertiesText.includes(initial.selected) ||
      !initial.propertiesText.includes('Controllers') ||
      !initial.propertiesText.includes('Volume160') ||
      initial.propertiesText.includes('Data chunks') ||
      initial.propertiesText.includes('Embedded projects') ||
      !initial.propertiesText.includes('Embedded project') ||
      !initial.propertiesText.includes('Controller links') ||
      !initial.propertiesText.includes('Options') ||
      initial.propertiesText.includes('Other data') ||
      initial.embeddedMeta !== 'Embedded projects 1' ||
      !initial.propertyFlags.includes('generator')
    ) {
      throw new Error(`Expected synth properties summary, got ${JSON.stringify(initial)}`);
    }

    const synthResponsiveLayout = await page.evaluate(() => ({
      middleBeside: (() => {
        const instrument = document.querySelector('[aria-labelledby="instrument-heading"]')?.getBoundingClientRect();
        const properties = document.querySelector('[aria-labelledby="properties-heading"]')?.getBoundingClientRect();
        return instrument && properties
          ? Math.abs(instrument.top - properties.top) < 8 && instrument.right <= properties.left
          : false;
      })(),
      middleControllersRight: (() => {
        const blocks = Array.from(document.querySelectorAll('[aria-labelledby="properties-heading"] .property-block'));
        const controllers = blocks
          .find((block) => block.querySelector('h4')?.textContent.trim() === 'Controllers')
          ?.getBoundingClientRect();
        const data = blocks
          .find((block) => block.querySelector('h4')?.textContent.trim() === 'Data')
          ?.getBoundingClientRect();
        return controllers && data ? controllers.left > data.left : false;
      })(),
    }));
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.waitForTimeout(100);
    const synthWideLayout = await page.evaluate(() => ({
      beside: (() => {
        const instrument = document.querySelector('[aria-labelledby="instrument-heading"]')?.getBoundingClientRect();
        const properties = document.querySelector('[aria-labelledby="properties-heading"]')?.getBoundingClientRect();
        return instrument && properties
          ? Math.abs(instrument.top - properties.top) < 8 && instrument.right <= properties.left
          : false;
      })(),
      controllersRight: (() => {
        const blocks = Array.from(document.querySelectorAll('[aria-labelledby="properties-heading"] .property-block'));
        const controllers = blocks
          .find((block) => block.querySelector('h4')?.textContent.trim() === 'Controllers')
          ?.getBoundingClientRect();
        const data = blocks
          .find((block) => block.querySelector('h4')?.textContent.trim() === 'Data')
          ?.getBoundingClientRect();
        return controllers && data ? controllers.left > data.left : false;
      })(),
    }));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(100);
    if (
      synthResponsiveLayout.middleBeside ||
      synthResponsiveLayout.middleControllersRight ||
      !synthWideLayout.beside ||
      !synthWideLayout.controllersRight
    ) {
      throw new Error(
        `Expected synth properties to stack until the instrument has four controller columns, got ${JSON.stringify({
          synthResponsiveLayout,
          synthWideLayout,
        })}`,
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
        document.querySelector('.virtual-keyboard-frame')?.scrollIntoView({ block: 'center', inline: 'nearest' });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
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

    const synthControllerUi = await page.evaluate(async () => {
      const calls = [];
      const originalSetSynthController = window.setSynthController;
      window.setSynthController = async (url, controllerIndex, value) => {
        calls.push({ url, controllerIndex, value });
        return true;
      };
      try {
        const knob = document.querySelector('.instrument-knob[aria-label="Volume controller"]');
        knob.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        return {
          value: knob.getAttribute('aria-valuenow'),
          output: knob.closest('.instrument-control')?.querySelector('.instrument-control-value')?.textContent ?? null,
          calls,
        };
      } finally {
        window.setSynthController = originalSetSynthController;
      }
    });
    const synthControllerUiCall = synthControllerUi.calls.at(-1);
    if (
      synthControllerUi.value !== '0' ||
      synthControllerUi.output !== '0' ||
      typeof synthControllerUiCall?.url !== 'string' ||
      synthControllerUiCall?.controllerIndex !== 0 ||
      synthControllerUiCall?.value !== 0
    ) {
      throw new Error(`Expected synth controller UI to call the player API, got ${JSON.stringify(synthControllerUi)}`);
    }

    const synthPlayback = await page.evaluate(async () => {
      const calls = {
        loadModule: [],
        connectModule: [],
        sendEvent: [],
        setModuleCtlValue: [],
      };
      const originalLoadModule = window.sv_load_module_from_memory;
      const originalConnectModule = window.sv_connect_module;
      const originalSendEvent = window.sv_send_event;
      const originalSetModuleCtlValue = window.sv_set_module_ctl_value;
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
      window.sv_set_module_ctl_value = (slot, moduleIndex, controllerIndex, value, scaled) => {
        calls.setModuleCtlValue.push({ slot, moduleIndex, controllerIndex, value, scaled });
        return originalSetModuleCtlValue(slot, moduleIndex, controllerIndex, value, scaled);
      };
      try {
        const noteOn = await window.playSynthNote('instruments/mandel59 shepard.sunsynth', 60, 128);
        const controller = await window.setSynthController('instruments/mandel59 shepard.sunsynth', 0, 144);
        const noteOff = window.stopSynthNote(60);
        const acidBassNoteOn = await window.playSynthNote('generated/instruments/Scratch Acid Bass.sunsynth', 60, 128);
        const acidBassNoteOff = window.stopSynthNote(60);
        const fmxTinesNoteOn = await window.playSynthNote('generated/instruments/Scratch FMX Tines.sunsynth', 60, 128);
        const fmxTinesNoteOff = window.stopSynthNote(60);
        window.stopInstrumentNotes?.();
        return { noteOn, controller, noteOff, acidBassNoteOn, acidBassNoteOff, fmxTinesNoteOn, fmxTinesNoteOff, calls };
      } finally {
        window.sv_load_module_from_memory = originalLoadModule;
        window.sv_connect_module = originalConnectModule;
        window.sv_send_event = originalSendEvent;
        window.sv_set_module_ctl_value = originalSetModuleCtlValue;
      }
    });
    const [loadedSynthLoad, acidBassLoad, fmxTinesLoad] = synthPlayback.calls.loadModule;
    const loadedSynthModule = loadedSynthLoad?.moduleIndex;
    const noteOnEvent = synthPlayback.calls.sendEvent.find((event) => event.note === 61);
    const controllerEvent = synthPlayback.calls.setModuleCtlValue.find(
      (event) => event.controllerIndex === 0 && event.value === 144,
    );
    const noteOffEvent = synthPlayback.calls.sendEvent.find((event) => event.note === 128);
    const acidBassModule = acidBassLoad?.moduleIndex;
    const acidBassNoteOnEvent = synthPlayback.calls.sendEvent
      .filter((event) => event.note === 61)
      .find((event) => event.module === acidBassModule + 1);
    const fmxTinesModule = fmxTinesLoad?.moduleIndex;
    const fmxTinesNoteOnEvent = synthPlayback.calls.sendEvent
      .filter((event) => event.note === 61)
      .find((event) => event.module === fmxTinesModule + 1);
    if (
      !synthPlayback.noteOn ||
      !synthPlayback.controller ||
      !synthPlayback.noteOff ||
      !synthPlayback.acidBassNoteOn ||
      !synthPlayback.acidBassNoteOff ||
      !synthPlayback.fmxTinesNoteOn ||
      !synthPlayback.fmxTinesNoteOff ||
      !(loadedSynthModule > 0) ||
      !(acidBassModule > 0) ||
      !(fmxTinesModule > 0) ||
      synthPlayback.calls.connectModule[0]?.destination !== 0 ||
      noteOnEvent?.module !== loadedSynthModule + 1 ||
      noteOnEvent?.track !== 28 ||
      noteOnEvent?.velocity !== 128 ||
      controllerEvent?.moduleIndex !== loadedSynthModule ||
      controllerEvent?.scaled !== 0 ||
      noteOffEvent?.module !== loadedSynthModule + 1 ||
      noteOffEvent?.track !== 28 ||
      acidBassNoteOnEvent?.track !== 28 ||
      acidBassNoteOnEvent?.velocity !== 128 ||
      fmxTinesNoteOnEvent?.track !== 28 ||
      fmxTinesNoteOnEvent?.velocity !== 128
    ) {
      throw new Error(
        `Expected synth keyboard to load/connect/send note and controller events, got ${JSON.stringify(synthPlayback)}`,
      );
    }

    const fmxAtlasSources = [];
    for (const path of [
      'generated/instruments/Scratch FMX Bell.sunsynth',
      'generated/instruments/Scratch FMX Bass.sunsynth',
    ]) {
      const button = page.locator('.project-button', { hasText: path });
      await button.click();
      await page.waitForTimeout(100);
      fmxAtlasSources.push(
        await page.evaluate((expectedPath) => {
          const catalogSection = document.querySelector('[aria-labelledby="catalog-heading"]');
          const propertiesPanel = document.querySelector('[aria-labelledby="properties-heading"] .properties-panel');
          const sourceRow = Array.from(catalogSection?.querySelectorAll('.property-row') ?? []).find(
            (row) => row.querySelector('dt')?.textContent.trim() === 'Source',
          );
          const link = sourceRow?.querySelector('a');
          return {
            expectedPath,
            selected: document.querySelector('#project-details h2')?.textContent ?? null,
            catalogHeading: catalogSection?.querySelector('h3')?.textContent.trim() ?? null,
            catalogText: catalogSection?.textContent ?? null,
            sourceInsideProperties: propertiesPanel?.textContent?.includes('scratch-fmx.mjs') ?? false,
            sourceText: link?.textContent.trim() ?? null,
            sourceHref: link?.getAttribute('href') ?? null,
          };
        }, path),
      );
    }
    if (
      fmxAtlasSources.some(
        (source) =>
          !source.selected?.startsWith('Scratch FMX ') ||
          source.catalogHeading !== 'Catalog' ||
          !source.catalogText?.includes('Statusdeploy') ||
          source.sourceInsideProperties ||
          source.sourceText !== 'scratch-fmx.mjs' ||
          source.sourceHref !== 'generated/recipes/sunvox-edit/scratch-fmx.mjs',
      )
    ) {
      throw new Error(`Expected FMX atlas synths to show catalog source recipe links, got ${JSON.stringify(fmxAtlasSources)}`);
    }

    const superSawButton = page.locator('.project-button', { hasText: 'instruments/mandel59 SuperSaw.sunsynth' });
    await superSawButton.click();
    await page.waitForTimeout(100);
    const superSawControllers = await page.evaluate(() => ({
      labels: Array.from(document.querySelectorAll('.instrument-control-label')).map((element) =>
        element.textContent.trim(),
      ),
      targets: Array.from(document.querySelectorAll('.instrument-control-target')).map((element) =>
        element.textContent.trim(),
      ),
      propertyTargets: Array.from(
        document.querySelectorAll('[aria-labelledby="properties-heading"] .controller-target'),
      ).map((element) => element.textContent.trim()),
      values: Array.from(document.querySelectorAll('.instrument-control-value')).map((element) =>
        element.textContent.trim(),
      ),
    }));
    if (
      superSawControllers.labels.length !== 11 ||
      !superSawControllers.labels.includes('Octave') ||
      !superSawControllers.labels.includes('Detune 1') ||
      !superSawControllers.labels.includes('Filter freq') ||
      superSawControllers.targets.length !== 0 ||
      !superSawControllers.propertyTargets.some((target) => target.includes('Filter ProFrequency')) ||
      !superSawControllers.values.includes('13680')
    ) {
      throw new Error(`Expected SuperSaw user controllers under Instrument, got ${JSON.stringify(superSawControllers)}`);
    }

    const synthControllerChanged = await page.evaluate(async () => {
      const changed = await window.setSynthController('instruments/mandel59 SuperSaw.sunsynth', 0, 96);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const modules = [];
      const count = window.sv_get_number_of_modules?.(0) ?? 0;
      for (let index = 0; index < count; index += 1) {
        modules.push({
          index,
          name: window.sv_get_module_name?.(0, index),
          type: window.sv_get_module_type?.(0, index),
          volume: window.sv_get_module_ctl_value?.(0, index, 0, 0),
        });
      }
      const loaded = modules.find((module) => module.type === 'MetaModule' || module.name === 'SuperSaw');
      return { changed, loaded };
    });
    if (!synthControllerChanged.changed || synthControllerChanged.loaded?.volume !== 96) {
      throw new Error(`Expected SuperSaw volume to change before reopen, got ${JSON.stringify(synthControllerChanged)}`);
    }
    const shepardButton = page.locator('.project-button', { hasText: 'instruments/mandel59 shepard.sunsynth' });
    await shepardButton.click();
    await page.waitForTimeout(100);
    await superSawButton.click();
    await page.waitForTimeout(250);
    const synthControllerReopened = await page.evaluate(() => {
      const modules = [];
      const count = window.sv_get_number_of_modules?.(0) ?? 0;
      for (let index = 0; index < count; index += 1) {
        modules.push({
          index,
          name: window.sv_get_module_name?.(0, index),
          type: window.sv_get_module_type?.(0, index),
          volume: window.sv_get_module_ctl_value?.(0, index, 0, 0),
        });
      }
      const loaded = modules.find((module) => module.type === 'MetaModule' || module.name === 'SuperSaw');
      return {
        uiValue: document.querySelector('.instrument-knob[aria-label="Volume controller"]')?.getAttribute('aria-valuenow') ?? null,
        loaded,
      };
    });
    if (synthControllerReopened.uiValue !== '256' || synthControllerReopened.loaded?.volume !== 256) {
      throw new Error(
        `Expected reopening SuperSaw to reset UI and loaded SunVox controller state, got ${JSON.stringify(
          synthControllerReopened,
        )}`,
      );
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
      detailsHeaderGap: (() => {
        const header = document.querySelector('.details-header')?.getBoundingClientRect();
        const heading = document.querySelector('#properties-heading')?.getBoundingClientRect();
        return header && heading ? heading.top - header.bottom : null;
      })(),
      graphSections: document.querySelectorAll('.module-graph').length,
      graphNodes: document.querySelectorAll('.graph-nodes g').length,
      graphEdges: document.querySelectorAll('.graph-edges line').length,
      topLevelMetrics: document.querySelectorAll('#project-details > .metrics').length,
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
      locationHash: window.location.hash,
      copyLinkText: document.querySelector('.project-permalink')?.textContent.trim() ?? null,
      permalinkHash: document.querySelector('.project-permalink')?.dataset.permalinkHash ?? null,
      copyLinkWidth: document.querySelector('.project-permalink')?.getBoundingClientRect().width ?? null,
      propertiesHeading: document.querySelector('#properties-heading')?.textContent ?? null,
      propertiesText: document.querySelector('[aria-labelledby="properties-heading"] .properties-panel')?.textContent ?? null,
      graphMeta: document.querySelector('[aria-labelledby="graph-heading"] .section-meta')?.textContent ?? null,
      patternsMeta: document.querySelector('[aria-labelledby="patterns-heading"] .section-meta')?.textContent ?? null,
      embeddedMeta: document.querySelector('[aria-labelledby="embedded-heading"] .section-meta')?.textContent ?? null,
      embeddedTitle: document.querySelector('[aria-labelledby="embedded-heading"] .embedded-title')?.textContent.trim() ?? null,
      embeddedHost: document
        .querySelector('[aria-labelledby="embedded-heading"] .embedded-host .module-reference')
        ?.textContent.trim() ?? null,
      embeddedHostStyle:
        document.querySelector('[aria-labelledby="embedded-heading"] .embedded-host .module-reference')?.getAttribute('style') ??
        null,
    }));
    if (afterSelect.topbarPlayDisabled !== false) {
      throw new Error(`Expected selected project to enable topbar play, got disabled=${afterSelect.topbarPlayDisabled}`);
    }
    if (!(afterSelect.detailsHeaderGap >= 12)) {
      throw new Error(`Expected details header divider to have bottom spacing, got ${afterSelect.detailsHeaderGap}`);
    }
    if (afterSelect.topLevelMetrics !== 0) {
      throw new Error(`Expected no top-level file metrics summary, got ${afterSelect.topLevelMetrics}`);
    }
    if (
      afterSelect.locationHash !== '#file=music%2F2022-04-17.sunvox' ||
      afterSelect.copyLinkText !== 'Copy link' ||
      afterSelect.permalinkHash !== '#file=music%2F2022-04-17.sunvox'
    ) {
      throw new Error(`Expected music file permalink hash, got ${JSON.stringify(afterSelect)}`);
    }
    if (
      afterSelect.propertiesHeading !== 'Project Properties' ||
      afterSelect.propertiesText.includes('Name') ||
      afterSelect.propertiesText.includes('Stored modules') ||
      afterSelect.propertiesText.includes('Stored patterns') ||
      afterSelect.propertiesText.includes('Embedded projects') ||
      !afterSelect.propertiesText.includes('BPM125') ||
      !afterSelect.propertiesText.includes('Speed6') ||
      !afterSelect.propertiesText.includes('Global volume130') ||
      !afterSelect.propertiesText.includes('Timeline grid4 / 4') ||
      afterSelect.graphMeta !== 'Stored modules 9' ||
      afterSelect.patternsMeta !== 'Stored patterns 1' ||
      afterSelect.embeddedMeta !== 'Embedded projects 1' ||
      afterSelect.embeddedTitle !== 'SuperSaw by mandel59 (licensed under CC0)' ||
      !afterSelect.embeddedHost.includes('01SuperSawMetaModule') ||
      afterSelect.embeddedHost.includes('embeddedProject') ||
      !afterSelect.embeddedHostStyle?.includes('--module-color')
    ) {
      throw new Error(`Expected project properties summary, got ${JSON.stringify(afterSelect)}`);
    }
    await page.evaluate(() => {
      document
        .querySelector('[aria-labelledby="graph-heading"] .graph-node[data-module-index="5"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForTimeout(50);
    const graphSelection = await page.evaluate(() => ({
      detailId:
        document.querySelector('[aria-labelledby="graph-heading"] .graph-detail-heading .module-reference-id')?.textContent.trim() ?? null,
      detailName:
        document.querySelector('[aria-labelledby="graph-heading"] .graph-detail-heading .module-reference-name')?.textContent.trim() ?? null,
      detailType:
        document.querySelector('[aria-labelledby="graph-heading"] .graph-detail-heading .module-reference-type')?.textContent.trim() ?? null,
      detailText: document.querySelector('[aria-labelledby="graph-heading"] .graph-detail')?.textContent ?? '',
      sectionHeadings: Array.from(
        document.querySelectorAll('[aria-labelledby="graph-heading"] .graph-detail-section h4'),
      ).map((element) => element.textContent.trim().replace(/\s+\(\d+\)$/u, '')),
      controllerRows: Array.from(
        document.querySelectorAll('[aria-labelledby="graph-heading"] .controller-row'),
      ).map((element) => element.textContent.trim()),
      selectedNodePressed: document
        .querySelector('[aria-labelledby="graph-heading"] .graph-node-button[data-module-index="5"]')
        ?.getAttribute('aria-pressed') ?? null,
      selectedEdges: document.querySelectorAll('[aria-labelledby="graph-heading"] .graph-edge.is-selected').length,
      dimmedEdges: document.querySelectorAll('[aria-labelledby="graph-heading"] .graph-edge.is-dimmed').length,
      linkChips: Array.from(
        document.querySelectorAll('[aria-labelledby="graph-heading"] .graph-detail-links .module-reference'),
      ).map((element) => ({
        text: element.textContent.trim(),
        pillText: element.querySelector('.module-reference-pill')?.textContent.trim() ?? null,
        metaText: element.querySelector('.module-reference-meta')?.textContent.trim() ?? null,
        color: element.getAttribute('style'),
        pillRadius: getComputedStyle(element.querySelector('.module-reference-pill')).borderRadius,
      })),
      linkText: document.querySelector('[aria-labelledby="graph-heading"] .graph-detail')?.textContent ?? '',
    }));
    if (
      graphSelection.detailId !== '05' ||
      graphSelection.detailName !== 'Sound2Ctl' ||
      graphSelection.detailType !== null ||
      graphSelection.detailText.includes('Position') ||
      graphSelection.detailText.includes('Color') ||
      graphSelection.detailText.includes('Data chunks') ||
      !graphSelection.detailText.includes('Options') ||
      graphSelection.detailText.includes('Other data') ||
      graphSelection.sectionHeadings.join(',') !== 'Controllers,Data,Inputs,Outputs' ||
      graphSelection.controllerRows.length !== 9 ||
      !graphSelection.controllerRows.some((row) => row.includes('Modehq')) ||
      graphSelection.selectedNodePressed !== 'true' ||
      graphSelection.selectedEdges !== 2 ||
      graphSelection.linkChips.length !== 2 ||
      !graphSelection.linkChips.every((chip) => chip.color?.includes('--module-color')) ||
      graphSelection.linkChips.some((chip) => chip.pillText?.includes('slot')) ||
      !graphSelection.linkChips.some((chip) => chip.metaText?.includes('slot')) ||
      !graphSelection.linkText.includes('Compressor') ||
      !graphSelection.linkText.includes('MultiCtl')
    ) {
      throw new Error(`Expected graph selection details for Sound2Ctl, got ${JSON.stringify(graphSelection)}`);
    }
    await page.evaluate(() => {
      window.__browserCheckCopiedLink = '';
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.__browserCheckCopiedLink = text;
          },
        },
      });
    });
    const copyLinkButton = page.locator('.project-permalink');
    const copyLinkButtonCount = await copyLinkButton.count();
    if (copyLinkButtonCount !== 1) {
      throw new Error(`Expected one copy link button, found ${copyLinkButtonCount}`);
    }
    await copyLinkButton.click();
    await page.waitForTimeout(50);
    const copiedLink = await page.evaluate(() => ({
      copied: window.__browserCheckCopiedLink,
      label: document.querySelector('.project-permalink')?.textContent.trim() ?? null,
      width: document.querySelector('.project-permalink')?.getBoundingClientRect().width ?? null,
    }));
    const expectedCopiedLink = new URL('#file=music%2F2022-04-17.sunvox', url).href;
    if (copiedLink.copied !== expectedCopiedLink || copiedLink.label !== 'Copied') {
      throw new Error(`Expected copy link button to copy ${expectedCopiedLink}, got ${JSON.stringify(copiedLink)}`);
    }
    if (Math.abs(copiedLink.width - afterSelect.copyLinkWidth) > 0.5) {
      throw new Error(`Expected copy link button width to stay stable, got ${afterSelect.copyLinkWidth} -> ${copiedLink.width}`);
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

    await page.evaluate(() => {
      window.__browserCheckStopInstrumentNotesCalls = 0;
      window.__browserCheckOriginalStopInstrumentNotes = window.stopInstrumentNotes;
      window.stopInstrumentNotes = () => {
        window.__browserCheckStopInstrumentNotesCalls += 1;
        return window.__browserCheckOriginalStopInstrumentNotes?.() ?? false;
      };
    });
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
      stopInstrumentNotesCalls: window.__browserCheckStopInstrumentNotesCalls ?? null,
    }));
    await page.evaluate(() => {
      if (window.__browserCheckOriginalStopInstrumentNotes) {
        window.stopInstrumentNotes = window.__browserCheckOriginalStopInstrumentNotes;
      }
      delete window.__browserCheckOriginalStopInstrumentNotes;
      delete window.__browserCheckStopInstrumentNotesCalls;
    });
    if (supertrackTimeline.stopInstrumentNotesCalls !== 0) {
      throw new Error(
        `Expected project switching not to send instrument note cleanup, got ${supertrackTimeline.stopInstrumentNotesCalls}`,
      );
    }
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

    const directLinkUrl = new URL(url);
    directLinkUrl.hash = 'file=music%2F2022-04-18.sunvox';
    await page.goto(directLinkUrl.href, { waitUntil: 'networkidle' });
    const directLink = await page.evaluate(() => ({
      selected: document.querySelector('#project-details h2')?.textContent ?? null,
      selectedButtonPath: document.querySelector('.project-button[aria-current="true"] .project-path')?.textContent ?? null,
      locationHash: window.location.hash,
      copyLinkText: document.querySelector('.project-permalink')?.textContent.trim() ?? null,
      permalinkHash: document.querySelector('.project-permalink')?.dataset.permalinkHash ?? null,
    }));
    if (
      directLink.selected !== '2022-04-17 18-14' ||
      directLink.selectedButtonPath !== 'music/2022-04-18.sunvox' ||
      directLink.locationHash !== '#file=music%2F2022-04-18.sunvox' ||
      directLink.copyLinkText !== 'Copy link' ||
      directLink.permalinkHash !== '#file=music%2F2022-04-18.sunvox'
    ) {
      throw new Error(`Expected direct file permalink to select music/2022-04-18.sunvox, got ${JSON.stringify(directLink)}`);
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
      directLink,
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
