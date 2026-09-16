/**
 * Effects registry V1.02
 */
import * as femaleVoice from './femaleVoice.js';
import * as deepVoice from './deepVoice.js';
import * as autotune from './autotune.js';
import * as speaker from './speaker.js';
import * as police from './police.js';
import * as echo from './echo.js';
import * as studio from './studio.js';
import * as bassBoost from './bassBoost.js';
import * as improveQuality from './improveQuality.js';
import * as volume from './volume.js';

const modules = [
  femaleVoice, deepVoice, autotune,
  speaker, police, echo, studio,
  bassBoost, improveQuality, volume
];

export const effectsRegistry = {};
modules.forEach(mod => {
  effectsRegistry[mod.meta.id] = {
    meta: mod.meta,
    createNodes: mod.createNodes,
    processOfflineBuffer: mod.processOfflineBuffer || null
  };
});

export const effectOrder = [
  'femaleVoice', 'deepVoice', 'autotune',
  'speaker', 'police', 'echo', 'studio',
  'bassBoost', 'improveQuality', 'volume'
];

export function createEffectNodes(ctx, id, params) {
  const entry = effectsRegistry[id];
  if (!entry) throw new Error('Effect not found: ' + id);
  return entry.createNodes(ctx, params);
}

export function getEffectMeta(id) {
  return effectsRegistry[id]?.meta || null;
}
