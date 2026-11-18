// window.DoomBridge: the only way to read or drive the game.
(function () {
  var ready = new Promise(function (resolve) {
    (function poll() {
      var up = false;
      try { up = Module._agent_ready() } catch (e) {} // exports are not bound until the wasm is instantiated
      up ? resolve() : setTimeout(poll, 50);
    })();
  });
  window.DoomBridge = {
    ready: ready,
    observe: function () { return JSON.parse(UTF8ToString(Module._agent_observe())); },
    setControls: function (mask) { Module._agent_set_controls(mask | 0); },
    setPaused: function (b) { Module._agent_set_paused(b ? 1 : 0); },
    setSpeed: function (n) { Module._agent_set_speed(n); },
  };
})();
