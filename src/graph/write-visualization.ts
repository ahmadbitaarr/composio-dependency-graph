import type {
  DependencyGraphArtifact,
} from "./assemble";
import {
  buildToolVisualization,
} from "./visualization";

const graph =
  (await Bun.file(
    "data/dependency-graph.json",
  ).json()) as DependencyGraphArtifact;

const visualization =
  buildToolVisualization(
    graph,
  );

await Bun.write(
  "data/tool-dependency-visualization.json",
  JSON.stringify(
    visualization,
    null,
    2,
  ),
);

const embedded =
  JSON.stringify(
    visualization,
  ).replaceAll(
    "<",
    "\\u003c",
  );

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tool Dependency Graph</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    overflow: hidden;
    background: #0b1020;
    color: #e8edf7;
    font-family: Arial, sans-serif;
  }
  #graph {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  #controls {
    position: fixed;
    top: 16px;
    left: 16px;
    width: 330px;
    padding: 16px;
    border: 1px solid #34405a;
    border-radius: 12px;
    background: rgba(16, 23, 42, 0.94);
    box-shadow: 0 12px 30px rgba(0,0,0,.35);
  }
  #details {
    position: fixed;
    top: 16px;
    right: 16px;
    width: 360px;
    max-height: calc(100vh - 32px);
    overflow: auto;
    padding: 16px;
    border: 1px solid #34405a;
    border-radius: 12px;
    background: rgba(16, 23, 42, 0.94);
    box-shadow: 0 12px 30px rgba(0,0,0,.35);
  }
  h1, h2 {
    margin: 0 0 10px;
  }
  h1 { font-size: 19px; }
  h2 { font-size: 16px; }
  p {
    margin: 6px 0;
    line-height: 1.4;
  }
  label {
    display: block;
    margin-top: 11px;
    font-size: 13px;
  }
  input[type="text"],
  input[type="number"] {
    width: 100%;
    margin-top: 5px;
    padding: 8px 10px;
    border: 1px solid #4b5874;
    border-radius: 7px;
    background: #0c1325;
    color: #fff;
  }
  button {
    margin-top: 12px;
    margin-right: 6px;
    padding: 8px 12px;
    border: 1px solid #53617d;
    border-radius: 7px;
    background: #1b2741;
    color: #fff;
    cursor: pointer;
  }
  button:hover { background: #263555; }
  .row {
    display: flex;
    gap: 14px;
    align-items: center;
  }
  .row label {
    margin-top: 10px;
  }
  .small {
    color: #aeb8cd;
    font-size: 12px;
  }
  .github { color: #69a7ff; }
  .google { color: #6ee7a8; }
  .metric {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    margin: 5px 0;
  }
  .tool-name {
    overflow-wrap: anywhere;
    font-family: monospace;
    font-size: 13px;
  }
  .neighbor {
    margin: 7px 0;
    padding: 7px;
    border-radius: 6px;
    background: #111a30;
    overflow-wrap: anywhere;
    font-size: 12px;
  }
</style>
</head>
<body>
<canvas id="graph"></canvas>

<section id="controls">
  <h1>Tool Dependency Graph</h1>
  <div class="small">
    Deterministic accepted dependencies only
  </div>

  <div class="metric">
    <span>Tool nodes</span>
    <strong>${visualization.summary.toolNodeCount}</strong>
  </div>
  <div class="metric">
    <span>Tool connections</span>
    <strong>${visualization.summary.toolEdgeCount}</strong>
  </div>
  <div class="metric">
    <span>Accepted field edges</span>
    <strong>${visualization.summary.acceptedFieldEdgeCount}</strong>
  </div>

  <label>
    Search tool
    <input id="search" type="text" placeholder="Example: REPLY_TO_THREAD">
  </label>

  <label>
    Minimum accepted field edges
    <input id="minimum" type="number" min="1" value="1">
  </label>

  <div class="row">
    <label>
      <input id="github" type="checkbox" checked>
      <span class="github">GitHub</span>
    </label>
    <label>
      <input id="google" type="checkbox" checked>
      <span class="google">Google Super</span>
    </label>
  </div>

  <button id="fit">Fit graph</button>
  <button id="clear">Clear selection</button>

  <p class="small">
    Drag to pan. Use the mouse wheel to zoom.
    Click a node to inspect its dependencies.
  </p>

  <div id="status" class="small"></div>
</section>

<section id="details">
  <h2>Selected tool</h2>
  <p class="small">
    Click a node or search for a tool.
  </p>
</section>

<script>
const model = ${embedded};

const canvas =
  document.getElementById("graph");

const context =
  canvas.getContext("2d");

const search =
  document.getElementById("search");

const minimum =
  document.getElementById("minimum");

const github =
  document.getElementById("github");

const google =
  document.getElementById("google");

const details =
  document.getElementById("details");

const status =
  document.getElementById("status");

const nodes =
  model.nodes.map(function(node) {
    return Object.assign({}, node, {
      x: 0,
      y: 0
    });
  });

const nodeById =
  new Map(
    nodes.map(function(node) {
      return [node.id, node];
    })
  );

function placeGroup(group, centerX, centerY) {
  const goldenAngle =
    Math.PI * (3 - Math.sqrt(5));

  group.forEach(function(node, index) {
    const radius =
      32 * Math.sqrt(index);

    const angle =
      index * goldenAngle;

    node.x =
      centerX +
      Math.cos(angle) * radius;

    node.y =
      centerY +
      Math.sin(angle) * radius;
  });
}

const githubNodes =
  nodes.filter(function(node) {
    return node.toolkit === "github";
  });

const googleNodes =
  nodes.filter(function(node) {
    return node.toolkit === "googlesuper";
  });

placeGroup(githubNodes, -850, 0);
placeGroup(googleNodes, 850, 0);

let scale = 0.5;
let offsetX = 0;
let offsetY = 0;
let dragging = false;
let dragX = 0;
let dragY = 0;
let selectedId = null;
let searchMatches = new Set();

function resize() {
  canvas.width =
    window.innerWidth *
    window.devicePixelRatio;

  canvas.height =
    window.innerHeight *
    window.devicePixelRatio;

  canvas.style.width =
    window.innerWidth + "px";

  canvas.style.height =
    window.innerHeight + "px";

  context.setTransform(
    window.devicePixelRatio,
    0,
    0,
    window.devicePixelRatio,
    0,
    0
  );

  draw();
}

function visibleToolkit(node) {
  return (
    (
      node.toolkit === "github" &&
      github.checked
    ) ||
    (
      node.toolkit === "googlesuper" &&
      google.checked
    )
  );
}

function minimumCount() {
  return Math.max(
    1,
    Number(minimum.value) || 1
  );
}

function worldToScreen(x, y) {
  return {
    x:
      x * scale +
      offsetX,
    y:
      y * scale +
      offsetY
  };
}

function screenToWorld(x, y) {
  return {
    x:
      (x - offsetX) /
      scale,
    y:
      (y - offsetY) /
      scale
  };
}

function fitGraph() {
  const visible =
    nodes.filter(visibleToolkit);

  if (visible.length === 0) {
    return;
  }

  const xs =
    visible.map(function(node) {
      return node.x;
    });

  const ys =
    visible.map(function(node) {
      return node.y;
    });

  const minX = Math.min.apply(null, xs);
  const maxX = Math.max.apply(null, xs);
  const minY = Math.min.apply(null, ys);
  const maxY = Math.max.apply(null, ys);

  const availableWidth =
    window.innerWidth - 760;

  const availableHeight =
    window.innerHeight - 100;

  scale = Math.min(
    availableWidth /
      Math.max(1, maxX - minX + 180),
    availableHeight /
      Math.max(1, maxY - minY + 180)
  );

  scale = Math.max(
    0.08,
    Math.min(1.5, scale)
  );

  offsetX =
    370 +
    availableWidth / 2 -
    ((minX + maxX) / 2) *
      scale;

  offsetY =
    window.innerHeight / 2 -
    ((minY + maxY) / 2) *
      scale;

  draw();
}

function selectedNeighbors() {
  if (!selectedId) {
    return new Set();
  }

  const result =
    new Set([selectedId]);

  model.edges.forEach(function(edge) {
    if (edge.from === selectedId) {
      result.add(edge.to);
    }

    if (edge.to === selectedId) {
      result.add(edge.from);
    }
  });

  return result;
}

function draw() {
  context.clearRect(
    0,
    0,
    window.innerWidth,
    window.innerHeight
  );

  context.fillStyle = "#0b1020";
  context.fillRect(
    0,
    0,
    window.innerWidth,
    window.innerHeight
  );

  const neighbors =
    selectedNeighbors();

  const min =
    minimumCount();

  let visibleEdgeCount = 0;

  model.edges.forEach(function(edge) {
    if (
      edge.acceptedFieldEdgeCount <
      min
    ) {
      return;
    }

    const from =
      nodeById.get(edge.from);

    const to =
      nodeById.get(edge.to);

    if (
      !from ||
      !to ||
      !visibleToolkit(from) ||
      !visibleToolkit(to)
    ) {
      return;
    }

    visibleEdgeCount += 1;

    const start =
      worldToScreen(
        from.x,
        from.y
      );

    const end =
      worldToScreen(
        to.x,
        to.y
      );

    const highlighted =
      selectedId &&
      (
        edge.from === selectedId ||
        edge.to === selectedId
      );

    context.beginPath();
    context.moveTo(
      start.x,
      start.y
    );
    context.lineTo(
      end.x,
      end.y
    );

    context.strokeStyle =
      highlighted
        ? "rgba(255,211,105,.85)"
        : "rgba(150,170,205,.075)";

    context.lineWidth =
      highlighted
        ? 2
        : Math.min(
            1.8,
            0.25 +
            Math.log2(
              edge.acceptedFieldEdgeCount +
              1
            ) * 0.22
          );

    context.stroke();
  });

  let visibleNodeCount = 0;

  nodes.forEach(function(node) {
    if (!visibleToolkit(node)) {
      return;
    }

    visibleNodeCount += 1;

    const point =
      worldToScreen(
        node.x,
        node.y
      );

    const isSelected =
      node.id === selectedId;

    const isSearchMatch =
      searchMatches.has(node.id);

    const isNeighbor =
      neighbors.has(node.id);

    const radius =
      isSelected
        ? 8
        : isSearchMatch
          ? 7
          : 3.5;

    if (
      selectedId &&
      !isNeighbor
    ) {
      context.globalAlpha = 0.25;
    } else {
      context.globalAlpha = 1;
    }

    context.beginPath();
    context.arc(
      point.x,
      point.y,
      radius,
      0,
      Math.PI * 2
    );

    if (isSelected) {
      context.fillStyle =
        "#ffd369";
    } else if (isSearchMatch) {
      context.fillStyle =
        "#ff8fa3";
    } else if (
      node.toolkit === "github"
    ) {
      context.fillStyle =
        "#69a7ff";
    } else {
      context.fillStyle =
        "#6ee7a8";
    }

    context.fill();

    if (
      isSelected ||
      isSearchMatch
    ) {
      context.font =
        "12px monospace";

      context.fillStyle =
        "#ffffff";

      context.fillText(
        node.id,
        point.x + 10,
        point.y - 8
      );
    }
  });

  context.globalAlpha = 1;

  status.textContent =
    visibleNodeCount +
    " visible tools · " +
    visibleEdgeCount +
    " visible connections";
}

function updateSearch() {
  const query =
    search.value
      .trim()
      .toUpperCase();

  searchMatches =
    new Set();

  if (query) {
    nodes.forEach(function(node) {
      if (
        node.id
          .toUpperCase()
          .includes(query)
      ) {
        searchMatches.add(
          node.id
        );
      }
    });

    if (
      searchMatches.size === 1
    ) {
      selectedId =
        Array.from(
          searchMatches
        )[0];

      showDetails(
        selectedId
      );
    }
  }

  draw();
}

function showDetails(id) {
  const node =
    nodeById.get(id);

  if (!node) {
    return;
  }

  const outgoingEdges =
    model.edges
      .filter(function(edge) {
        return edge.from === id;
      })
      .sort(function(left, right) {
        return (
          right.acceptedFieldEdgeCount -
          left.acceptedFieldEdgeCount
        );
      });

  const incomingEdges =
    model.edges
      .filter(function(edge) {
        return edge.to === id;
      })
      .sort(function(left, right) {
        return (
          right.acceptedFieldEdgeCount -
          left.acceptedFieldEdgeCount
        );
      });

  function edgeHtml(edge, direction) {
    const other =
      direction === "out"
        ? edge.to
        : edge.from;

    return (
      '<div class="neighbor">' +
      '<strong>' +
      (
        direction === "out"
          ? "Produces for: "
          : "Can be supplied by: "
      ) +
      "</strong>" +
      other +
      "<br>" +
      edge.acceptedFieldEdgeCount +
      " accepted field edge(s)" +
      "</div>"
    );
  }

  details.innerHTML =
    "<h2>Selected tool</h2>" +
    '<p class="tool-name">' +
    node.id +
    "</p>" +
    "<p><strong>Toolkit:</strong> " +
    node.toolkit +
    "</p>" +
    "<p><strong>Service:</strong> " +
    node.service +
    "</p>" +
    "<p><strong>Incoming field edges:</strong> " +
    node.incomingFieldEdges +
    "</p>" +
    "<p><strong>Outgoing field edges:</strong> " +
    node.outgoingFieldEdges +
    "</p>" +
    "<h2>Incoming dependencies</h2>" +
    (
      incomingEdges.length
        ? incomingEdges
            .slice(0, 25)
            .map(function(edge) {
              return edgeHtml(
                edge,
                "in"
              );
            })
            .join("")
        : '<p class="small">None</p>'
    ) +
    "<h2>Outgoing dependencies</h2>" +
    (
      outgoingEdges.length
        ? outgoingEdges
            .slice(0, 25)
            .map(function(edge) {
              return edgeHtml(
                edge,
                "out"
              );
            })
            .join("")
        : '<p class="small">None</p>'
    );

  draw();
}

canvas.addEventListener(
  "mousedown",
  function(event) {
    dragging = true;
    dragX = event.clientX;
    dragY = event.clientY;
  }
);

window.addEventListener(
  "mouseup",
  function() {
    dragging = false;
  }
);

window.addEventListener(
  "mousemove",
  function(event) {
    if (!dragging) {
      return;
    }

    offsetX +=
      event.clientX -
      dragX;

    offsetY +=
      event.clientY -
      dragY;

    dragX =
      event.clientX;

    dragY =
      event.clientY;

    draw();
  }
);

canvas.addEventListener(
  "wheel",
  function(event) {
    event.preventDefault();

    const before =
      screenToWorld(
        event.clientX,
        event.clientY
      );

    const factor =
      event.deltaY < 0
        ? 1.12
        : 0.89;

    scale = Math.max(
      0.03,
      Math.min(
        4,
        scale * factor
      )
    );

    offsetX =
      event.clientX -
      before.x * scale;

    offsetY =
      event.clientY -
      before.y * scale;

    draw();
  },
  {
    passive: false
  }
);

canvas.addEventListener(
  "click",
  function(event) {
    if (dragging) {
      return;
    }

    const world =
      screenToWorld(
        event.clientX,
        event.clientY
      );

    let closest = null;
    let distance =
      18 / scale;

    nodes.forEach(function(node) {
      if (!visibleToolkit(node)) {
        return;
      }

      const current =
        Math.hypot(
          node.x - world.x,
          node.y - world.y
        );

      if (current < distance) {
        closest = node;
        distance = current;
      }
    });

    if (closest) {
      selectedId =
        closest.id;

      showDetails(
        closest.id
      );
    }
  }
);

search.addEventListener(
  "input",
  updateSearch
);

minimum.addEventListener(
  "input",
  draw
);

github.addEventListener(
  "change",
  function() {
    fitGraph();
  }
);

google.addEventListener(
  "change",
  function() {
    fitGraph();
  }
);

document
  .getElementById("fit")
  .addEventListener(
    "click",
    fitGraph
  );

document
  .getElementById("clear")
  .addEventListener(
    "click",
    function() {
      selectedId = null;
      search.value = "";
      searchMatches =
        new Set();

      details.innerHTML =
        "<h2>Selected tool</h2>" +
        '<p class="small">Click a node or search for a tool.</p>';

      draw();
    }
  );

window.addEventListener(
  "resize",
  resize
);

resize();
fitGraph();
</script>
</body>
</html>`;

await Bun.write(
  "visualization/dependency-graph.html",
  html,
);

console.log({
  format:
    visualization.format,
  toolNodeCount:
    visualization.summary
      .toolNodeCount,
  toolEdgeCount:
    visualization.summary
      .toolEdgeCount,
  acceptedFieldEdgeCount:
    visualization.summary
      .acceptedFieldEdgeCount,
  networkRequestsMade: false,
  llmRequestsMade: false,
  output:
    "visualization/dependency-graph.html",
});
