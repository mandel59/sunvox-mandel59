import { createSunVoxPlayer } from "@mandel59/sunvox-web";

const player = createSunVoxPlayer({
  runtimeBaseUrl: new URL("sunvox_lib/sunvox_lib/js/lib/", window.location.href),
  onStateChange: (detail) => window.dispatchEvent(new CustomEvent("sunvox-player-state", { detail })),
  onReady: () => window.dispatchEvent(new Event("sunvox-player-api-ready")),
  onStatus: updateStatus,
  onLog: (level, message) => console[level](`[SunVox worker] ${message}`),
});

function updateStatus(message) {
  const statusElement = document.getElementById("status");
  if (statusElement) statusElement.textContent = message;
  if (message) console.log(message);
}

window.playLoadedProject = player.playLoadedProject;
window.stopPlayback = player.stopPlayback;
window.setMasterVolume = player.setMasterVolume;
window.getMasterVolume = player.getMasterVolume;
window.getAudioTransportState = player.getAudioTransportState;
window.preloadProject = player.preloadProject;
window.preloadSynth = player.preloadSynth;
window.playSynthNote = player.playSynthNote;
window.stopSynthNote = player.stopSynthNote;
window.stopInstrumentNotes = player.stopInstrumentNotes;
window.setSynthController = player.setSynthController;
window.configureSynthControllers = player.configureSynthControllers;
window.loadAndPlay = player.loadAndPlay;
window.getPlayerState = player.getPlayerState;

// Preserve the site's volume hook used by its UI and playback checks.
window.loadAndPlay = async (url) => {
  const result = await player.loadAndPlay(url);
  try { await window.setMasterVolume(player.getMasterVolume()); } catch { /* non-fatal */ }
  return result;
};
window.addEventListener("beforeunload", () => player.dispose());
updateStatus("Ready");
