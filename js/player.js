svlib.then(async function (Module) {
    //
    // SunVox Library was successfully loaded.
    // Here we can perform some initialization:
    //
    svlib = Module;
    if (sv_init(0, 44100, 2, 0) < 0) {
        updateStatus("sv_init error");
        return;
    }
    if (sv_open_slot(0) < 0) {
        updateStatus("sv_open_slot error");
        return;
    }
    updateStatus("Select a music file");
});

function updateStatus(/** @type {string} */ s) {
    document.getElementById("status").innerHTML = s;
    console.log(s);
}

async function load(/** @type {string} */ url) {
    updateStatus("Loading the file...");
    const req = await fetch(url);
    if (!req.ok) {
        updateStatus(`Music file ${filePath} not found`);
        return false;
    }
    const arrayBuffer = await req.arrayBuffer();
    const byteArray = new Uint8Array(arrayBuffer);
    if (sv_load_from_memory(0, byteArray) < 0) {
        updateStatus(`Failed to load the music file ${filePath}`);
        return false;
    }
    fileSize = byteArray.byteLength;
    updateStatus(`${url}`);
    return true;
}

function play() {
    sv_play_from_beginning(0);
}

function stop() {
    sv_stop(0);
}

async function loadAndPlay(/** @type {string} */ url) {
    if (!await load(url)) {
        return false;
    }
    sv_play_from_beginning(0);
    return true;
}
