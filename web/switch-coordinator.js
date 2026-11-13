// Presentation-neutral switch lifetime. Tokens, never completion order, own the UI.
(() => {
  let serial = 0,
    state = null;
  const listeners = new Set();
  const identity = (value) => ({ fileKey: value?.fileKey ?? null, pageId: value?.pageId ?? null });
  const matches = (token) =>
    !!state && state.token === token && !["end", "fail", "cancel"].includes(state.phase);
  function emit(phase) {
    state = { ...state, phase };
    for (const fn of listeners) {
      try {
        fn({ ...state });
      } catch (error) {
        console.error(error);
      }
    }
    window.dispatchEvent(new CustomEvent("switch-loading-change", { detail: { ...state } }));
  }
  window.switchCoordinator = {
    // `room`: the cloud room id when the destination is a room (its library file may not exist yet).
    begin({ kind, from, to, reason, room }) {
      if (state && matches(state.token)) emit("cancel");
      state = {
        token: ++serial,
        kind,
        from: identity(from),
        to: identity(to),
        reason,
        room: room ?? null,
        phase: "begin",
        marks: { input: performance.now(), begin: performance.now() },
      };
      emit("begin");
      return serial;
    },
    phase(token, name) {
      if (!matches(token)) return;
      state = {
        ...state,
        stage: name,
        marks: { ...state.marks, [name]: state.marks[name] ?? performance.now() },
      };
      for (const fn of listeners) {
        try {
          fn({ ...state });
        } catch (error) {
          console.error(error);
        }
      }
    },
    rendered(token, info) {
      if (!matches(token)) return;
      state = {
        ...state,
        info,
        to: { fileKey: info?.fileKey ?? state.to.fileKey, pageId: info?.pageId ?? state.to.pageId },
        marks: {
          ...state.marks,
          [info?.freshness === "provisional" ? "cached" : "fresh"]: performance.now(),
        },
      };
      emit("ready");
    },
    finish(token) {
      if (matches(token)) emit("end");
    },
    fail(token, error) {
      if (matches(token)) {
        state = { ...state, error: String(error) };
        emit("fail");
      }
    },
    cancel(token) {
      if (matches(token)) emit("cancel");
    },
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    paint: () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))),
  };
})();
