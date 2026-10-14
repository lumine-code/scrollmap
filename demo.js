// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: ["language-gfm", "navigation-panel", "marker"],
  viewport: { width: 1100, height: 730 },
  async before() {},
  async prepare(context) {
    const { lumine, state, fixture, open } = context;
    state.editor = await open("navigation/README.md");
    await lumine.project.setPaths([fixture("navigation")]);
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Locate document sections on the scrollbar while navigating a long file.",
      timeout: 60000,
      async run(context) {
        const { lumine, state } = context;
        {
          lumine.commands.dispatch(lumine.views.getView(state.editor), "navigation-panel:open");
        }
      },
      ready() {
        return Boolean(document.querySelector("canvas"));
      },
    },
  ],
  async cleanup() {},
};
