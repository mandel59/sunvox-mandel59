export function shortLabel(value, maxLength = 13) {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 3) {
    return ".".repeat(maxLength);
  }
  return `${value.slice(0, maxLength - 3)}...`;
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
  const xs = positionedModules.map((module) => module.position.x);
  const ys = positionedModules.map((module) => module.position.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const padding = 96;
  return {
    nodes: positionedModules,
    edges,
    viewBox: `${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`,
  };
}
