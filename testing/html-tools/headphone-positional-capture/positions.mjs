// The five fixture positions this tool captures, and how each is drawn.
export const POSITION_DEFS = Object.freeze([
  { id: 'center', label: 'Center', short: 'C', color: '#4ec9b0', fill: 'rgba(78,201,176,.18)', description: 'Reference seating: cup centered on the fixture.' },
  { id: 'forward', label: 'Forward', short: 'F', color: '#f07178', fill: 'rgba(240,113,120,.17)', description: 'Move the headphone towards the front of the fixture.' },
  { id: 'backward', label: 'Backward', short: 'B', color: '#569cd6', fill: 'rgba(86,157,214,.17)', description: 'Move the headphone towards the rear of the fixture.' },
  { id: 'up', label: 'Up', short: 'U', color: '#dcdcaa', fill: 'rgba(220,220,170,.17)', description: 'Lift the headphone slightly while keeping the seal.' },
  { id: 'down', label: 'Down', short: 'D', color: '#c586c0', fill: 'rgba(197,134,192,.17)', description: 'Lower the headphone slightly while keeping the seal.' },
]);

export const STORAGE_KEY = 'devicepeq-headphone-positional-v1';
