export function shortLabel(value, maxLength = 13) {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 3) {
    return ".".repeat(maxLength);
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function formatGraphNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, "");
}

function buildAspectViewBox({ minX, maxX, minY, maxY, padding, aspectRatio }) {
  let x = minX - padding;
  let y = minY - padding;
  let width = maxX - minX + padding * 2;
  let height = maxY - minY + padding * 2;
  const currentAspectRatio = width / height;

  if (currentAspectRatio < aspectRatio) {
    const nextWidth = height * aspectRatio;
    x -= (nextWidth - width) / 2;
    width = nextWidth;
  } else if (currentAspectRatio > aspectRatio) {
    const nextHeight = width / aspectRatio;
    y -= (nextHeight - height) / 2;
    height = nextHeight;
  }

  return [x, y, width, height].map(formatGraphNumber).join(" ");
}

function scalePositionsToAspect(modules, aspectRatio) {
  const xs = modules.map((module) => module.position.x);
  const ys = modules.map((module) => module.position.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;
  if (width === 0 || height === 0) {
    return modules;
  }

  const currentAspectRatio = width / height;
  const scaleX = currentAspectRatio > aspectRatio ? aspectRatio / currentAspectRatio : 1;
  const scaleY = currentAspectRatio < aspectRatio ? currentAspectRatio / aspectRatio : 1;
  const centerX = minX + width / 2;
  const centerY = minY + height / 2;

  return modules.map((module) => ({
    ...module,
    position: {
      ...module.position,
      x: centerX + (module.position.x - centerX) * scaleX,
      y: centerY + (module.position.y - centerY) * scaleY,
    },
  }));
}

export function buildGraphLayout(project) {
  const positionedModules = project.modules.filter((module) => module.position);
  if (project.links.length === 0 || positionedModules.length === 0) {
    return undefined;
  }
  const nodeByIndex = new Map(positionedModules.map((module) => [module.index, module]));
  const edges = project.links.filter((link) => nodeByIndex.has(link.from) && nodeByIndex.has(link.to));
  if (edges.length === 0) {
    return undefined;
  }
  const aspectRatio = 16 / 9;
  const displayModules = scalePositionsToAspect(positionedModules, aspectRatio);
  const xs = displayModules.map((module) => module.position.x);
  const ys = displayModules.map((module) => module.position.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const padding = 96;
  return {
    nodes: displayModules,
    edges,
    viewBox: buildAspectViewBox({ minX, maxX, minY, maxY, padding, aspectRatio }),
  };
}
