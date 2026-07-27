const { SelectListView, highlightMatches } = require("@lumine-code/select-list");

class ToggleView {
  constructor(host) {
    this.host = host;
    this.disabledLayers = [];
    this.selectList = new SelectListView({
      className: "scrollmap-view",
      emptyMessage: "No scrollmap layers found",
      willShow: () => {
        this.disabledLayers = atom.config.get("scrollmap.disabledLayers") || [];
        this.selectList.update({ items: [...this.host.providers.values()] });
      },
      filterKeyForItem: (item) => item.name + " " + item.description,
      elementForItem: (item, { matchIndices }) => {
        const isDisabled = this.disabledLayers.includes(item.name);
        const li = document.createElement("li");
        // primary line with icon, tag and description
        const primary = document.createElement("div");
        primary.classList.add("primary-line");
        const icon = document.createElement("span");
        icon.classList.add("icon", isDisabled ? "icon-circle-slash" : "icon-check");
        primary.appendChild(icon);
        const tag = document.createElement("span");
        tag.classList.add("tag");
        tag.appendChild(highlightMatches(item.name, matchIndices));
        primary.appendChild(tag);
        if (item.description) {
          primary.appendChild(document.createTextNode(item.description));
        }
        li.appendChild(primary);
        return li;
      },
      didConfirmSelection: (item) => {
        const index = this.selectList.selectionIndex;
        this.toggleLayer(item.name);
        this.selectList.update({ items: [...this.host.providers.values()] });
        this.selectList.selectIndex(index);
      },
      didCancelSelection: () => {
        this.selectList.hide();
      },
    });
  }

  toggle() {
    this.selectList.toggle();
  }

  toggleLayer(name) {
    const index = this.disabledLayers.indexOf(name);
    if (index === -1) {
      this.disabledLayers.push(name);
    } else {
      this.disabledLayers.splice(index, 1);
    }
    atom.config.set("scrollmap.disabledLayers", this.disabledLayers);
  }

  destroy() {
    this.selectList.destroy();
  }
}

module.exports = ToggleView;
