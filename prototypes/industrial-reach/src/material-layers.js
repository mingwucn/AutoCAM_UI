export const MATERIAL_LAYERS = [
  [1, 'Target', '#087f8c'], [2, 'Holding', '#526079'],
  [3, 'Remove', '#f5a544'], [4, 'In shadow', '#9d8ac7'],
  [5, 'Beyond reach', '#8dc9e8'], [6, 'Remaining stock', '#e8eef1'],
];

export const allMaterialLayers = () => Object.fromEntries(MATERIAL_LAYERS.map(([id]) => [id, true]));

export function visibleMaterialLabels(labels, layers = {}, stockLabels) {
  if (stockLabels && stockLabels.length !== labels.length) throw new Error('Stock display mask size differs');
  const visible = new Uint8Array(labels.length), showStock = layers[6] !== false;
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    // Coloured categories overlay the current accepted stock. A hidden
    // category reveals that stock, never material removed by an earlier step.
    visible[i] = label && layers[label] !== false ? label : stockLabels?.[i] && showStock ? 6 : 0;
  }
  return visible;
}
