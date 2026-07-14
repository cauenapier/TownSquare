"use strict";

const { registerPlugin } = require("../plugins");

registerPlugin({
  name: "test-feature",
  adminModule: "/plus/test-feature/admin.mjs",
  widgetModule: "/plus/test-feature/widget.mjs",
  adminActions: {
    update({ setData }, input) {
      if (!/^[a-z-]+$/.test(String(input.hat || ""))) return { error: "Invalid hat." };
      setData({ hat: input.hat });
    },
  },
  extendVisitor(_visitor, { data }) {
    return { hat: data?.hat || "none" };
  },
  extendAdminPanel(panel, { data }) {
    return { ...panel, plugins: { ...panel.plugins, "test-feature": data } };
  },
});

registerPlugin({
  name: "test-labelled",
  label: "Test labelled add-on",
  description: "Exercises labelled plugin admin actions in the smoke test.",
  adminActions: {
    update({ setData }, input) {
      setData({ value: String(input.value || "") });
    },
  },
  extendAdminPanel(panel, { data }) {
    return { ...panel, plugins: { ...panel.plugins, "test-labelled": data } };
  },
});

registerPlugin({
  name: "test-scene-entity",
  label: "Test scene entity",
  description: "Exercises scene-entity plugins in the smoke test.",
  widgetModule: "/plus/test-scene-entity/widget.mjs",
  sceneEntity: {
    create() {
      return { moves: 0 };
    },
    snapshot({ state }) {
      return { moves: state.moves };
    },
  },
  onSceneMove({ state, emit }) {
    state.moves += 1;
    emit({ moves: state.moves });
  },
});
