/**
 * Effects registry V1.07.1 – categorized + Breath/Sibilance
 */
import * as femaleVoice from './femaleVoice.js';
import * as deepVoice from './deepVoice.js';
import * as autotune from './autotune.js';
import * as breathSibilance from './breathSibilance.js';
import * as speaker from './speaker.js';
import * as police from './police.js';
import * as echo from './echo.js';
import * as studio from './studio.js';
import * as bassBoost from './bassBoost.js';
import * as improveQuality from './improveQuality.js';
import * as noiseReduction from './noiseReduction.js';
import * as volume from './volume.js';

const modules = [
  femaleVoice, deepVoice, autotune, breathSibilance,
  speaker, police, echo, studio,
  bassBoost, improveQuality, noiseReduction, volume
];

export const effectsRegistry = {};
modules.forEach(mod => {
  effectsRegistry[mod.meta.id] = {
    meta: mod.meta,
    createNodes: mod.createNodes,
    processOfflineBuffer: mod.processOfflineBuffer || null,
    getPitchConfig: mod.getPitchConfig || null,
    STYLE_PRESETS: mod.STYLE_PRESETS || null,
    detectKeyAndScale: mod.detectKeyAndScale || null,
    applyStylePreset: mod.applyStylePreset || null
  };
});

/**
 * Processing priority order (engine chain):
 * noise → breath/sib → vocal pitch character → autotune → tone → space → volume
 */
export const effectOrder = [
  'noiseReduction',
  'breathSibilance',
  'femaleVoice', 'deepVoice',
  'autotune',
  'bassBoost', 'improveQuality',
  'speaker', 'police',
  'echo', 'studio',
  'volume'
];

export const effectCategories = [
  {
    id: 'voice',
    label: 'صدا (Vocal)',
    ids: ['femaleVoice', 'deepVoice']
  },
  {
    id: 'correction',
    label: 'تصحیح (Correction)',
    ids: ['autotune', 'breathSibilance', 'noiseReduction']
  },
  {
    id: 'tone',
    label: 'تن (Tone)',
    ids: ['bassBoost', 'improveQuality', 'volume']
  },
  {
    id: 'space',
    label: 'فضا (Space)',
    ids: ['echo', 'studio']
  },
  {
    id: 'character',
    label: 'کاراکتر (Character)',
    ids: ['speaker', 'police']
  }
];

export function createEffectNodes(ctx, id, params) {
  const entry = effectsRegistry[id];
  if (!entry) throw new Error('Effect not found: ' + id);
  return entry.createNodes(ctx, params);
}

export function getEffectMeta(id) {
  return effectsRegistry[id]?.meta || null;
}
