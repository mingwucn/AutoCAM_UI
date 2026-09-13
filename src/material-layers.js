export const MATERIAL_LAYERS = [
  [1, 'Target', '#087f8c'], [2, 'Holding', '#526079'],
  [3, 'Remove', '#f5a544'], [4, 'In shadow', '#9d8ac7'],
  [5, 'Beyond reach', '#8dc9e8'], [6, 'Remaining stock', '#e8eef1'],
];

export const allMaterialLayers = () => Object.fromEntries(MATERIAL_LAYERS.map(([id]) => [id, true]));

export function visibleMaterialLabels(labels, layers = {}) {
  return Uint8Array.from(labels, label => layers[label] === false ? 0 : label);
}
