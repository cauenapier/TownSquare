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
