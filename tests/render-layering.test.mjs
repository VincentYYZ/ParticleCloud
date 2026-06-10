import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

test('body particles keep a dedicated occlusion pass ahead of overflow particles', () => {
  assert.match(source, /let particleOcclusionMaterial:\s*THREE\.ShaderMaterial;/);
  assert.match(source, /let particleOcclusionMesh:\s*THREE\.Points;/);
  assert.match(source, /particleOcclusionMaterial\.colorWrite\s*=\s*false;/);
  assert.match(source, /depthWrite:\s*true/);
  assert.match(source, /particleOcclusionMesh\.renderOrder\s*=\s*1;/);
  assert.match(source, /haloMesh\.renderOrder\s*=\s*2;/);
  assert.match(source, /particlesMesh\.renderOrder\s*=\s*3;/);
});

test('overflow particles keep the same color family as the source image particles', () => {
  assert.doesNotMatch(source, /mix\(col,\s*vec3\(1\.0,\s*0\.98,\s*0\.96\)/);
  assert.doesNotMatch(source, /float glow = 1\.0;/);
  assert.match(source, /float alpha = exp\(-dist \* dist \* 6\.5\) \* vAlpha \* mix\(0\.84,\s*1\.18,\s*vScatter\);/);
  assert.match(source, /vec3 color = vColor;/);
});
