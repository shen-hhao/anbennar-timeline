import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapX, visibleCopies, mapPoint, circularBounds, worldFrame, clippedCopies, frameContains, constrainCamera, adaptiveFitScale } from '../dist/viewport.js';

test('horizontal panning by any whole number of worlds preserves picking', () => {
  for (const scale of [.07,.2,1,6]) {
    for (const turns of [-1000,-3,-1,0,1,3,1000]) {
      const x = 235, tx = 89 + turns * 5632 * scale;
      const before = mapPoint(x,103,89,20,scale,5632,2048);
      const after = mapPoint(x,103,tx,20,scale,5632,2048);
      assert.deepEqual(after,before);
      assert.ok(wrapX(tx,5632*scale)>=0);
      assert.ok(wrapX(tx,5632*scale)<5632*scale);
    }
  }
});
test('seam picks the adjacent column; north and south never wrap', () => {
  assert.deepEqual(mapPoint(-1,40,0,0,1,5632,2048),{x:5631,y:40});
  assert.deepEqual(mapPoint(5632,40,0,0,1,5632,2048),{x:0,y:40});
  assert.equal(mapPoint(20,-1,0,0,1,5632,2048),null);
  assert.equal(mapPoint(20,2048,0,0,1,5632,2048),null);
});
test('repeated world copies cover wide and zoomed views without gaps', () => {
  for (const viewport of [320,1000,3000]) for (const period of [120,900,30000]) for (const tx of [-250,0,29,period]) {
    const copies=visibleCopies(tx,period,viewport);
    assert.ok(copies.length);
    assert.ok(tx+copies[0]*period<=0);
    assert.ok(tx+(copies.at(-1)+1)*period>=viewport);
    for(let i=1;i<copies.length;i++)assert.equal(copies[i],copies[i-1]+1);
  }
});
test('zoom at a point preserves its wrapped longitude after offset normalization', () => {
  const width=5632,tx=-819,oldScale=.25,newScale=1.3,x=740;
  const longitude=wrapX((x-tx)/oldScale,width);
  const newTx=wrapX(x-(x-tx)*newScale/oldScale,width*newScale);
  assert.ok(Math.abs(longitude-wrapX((x-newTx)/newScale,width))<1e-8);
});
test('country focus takes the short arc across the map seam', () => {
  assert.deepEqual(circularBounds([[4,0,19,10],[980,0,998,10]],1000),[980,1020]);
  assert.deepEqual(circularBounds([[100,0,150,10],[130,0,200,10]],1000),[100,201]);
  assert.deepEqual(circularBounds([[0,0,999,10]],1000),[0,1000]);
});

test('a world narrower than its viewport gets a centered frame instead of repeated longitude', () => {
  assert.deepEqual(worldFrame(1200, 800, 1000, 500, 2), {x:0, y:0, width:1200, height:800});
  assert.deepEqual(worldFrame(1200, 800, 1000, 500, 1.2), {x:0, y:100, width:1200, height:600});
  assert.deepEqual(worldFrame(1200, 800, 1000, 500, .6), {x:300, y:250, width:600, height:300});
  assert.deepEqual(worldFrame(1200, 800, 1000, 500, .3), {x:450, y:325, width:300, height:150});
  assert.deepEqual(worldFrame(300, 900, 1000, 500, .6), {x:0, y:300, width:300, height:300});
});

test('portrait and relatively narrow viewports fit one complete longitude circle', () => {
  for (const [mapWidth, mapHeight] of [[5632, 2048], [8192, 3616]]) {
    for (const [width, height] of [[390, 776], [768, 960], [1000, 672], [1920, 1008]]) {
      const scale = adaptiveFitScale(width, height, mapWidth, mapHeight);
      const frame = worldFrame(width, height, mapWidth, mapHeight, scale);
      assert.equal(scale, width / mapWidth, 'the limiting horizontal dimension sets minimum zoom');
      assert.ok(Math.abs(frame.width - width) < 1e-9);
      assert.ok(Math.abs(frame.x) < 1e-9, 'no horizontal inset prevents the seam from joining');
      assert.ok(frame.height < height);
      assert.ok(Math.abs(frame.y - (height - mapHeight * scale) / 2) < 1e-9);
    }
  }
});

test('relatively wide viewports fit the full north-south extent and center a single world', () => {
  for (const [mapWidth, mapHeight] of [[5632, 2048], [8192, 3616]]) {
    for (const [width, height] of [[1920, 600], [3440, 1080], [3840, 800]]) {
      const scale = adaptiveFitScale(width, height, mapWidth, mapHeight);
      const frame = worldFrame(width, height, mapWidth, mapHeight, scale);
      assert.equal(scale, height / mapHeight);
      assert.ok(Math.abs(frame.height - height) < 1e-9);
      assert.ok(Math.abs(frame.y) < 1e-9, 'no padding crops or shrinks the north-south fit');
      assert.ok(frame.width < width);
      assert.ok(Math.abs(frame.x - (width - mapWidth * scale) / 2) < 1e-9);
    }
  }
});

test('aspect-ratio threshold fills both axes and changes continuously between fit directions', () => {
  for (const [mapWidth, mapHeight] of [[5632, 2048], [8192, 3616]]) {
    const height = mapHeight / 4, width = mapWidth / 4;
    assert.equal(adaptiveFitScale(width, height, mapWidth, mapHeight), .25);
    assert.deepEqual(worldFrame(width, height, mapWidth, mapHeight, .25), {x:0, y:0, width, height});
    const narrow = adaptiveFitScale(width - .001, height, mapWidth, mapHeight);
    const wide = adaptiveFitScale(width + .001, height, mapWidth, mapHeight);
    assert.ok(narrow < .25 && Math.abs(narrow - .25) < 1e-6);
    assert.equal(wide, .25);
  }
});

test('adaptive fit remains finite and positive during invalid or tiny layouts', () => {
  for (let index = 0; index < 4; index++) for (const invalid of [0, -1, NaN, Infinity, undefined]) {
    const args = [1000, 672, 5632, 2048];
    args[index] = invalid;
    assert.equal(adaptiveFitScale(...args), 1);
  }
  for (const args of [
    [Number.MAX_VALUE, Number.MAX_VALUE, Number.MIN_VALUE, Number.MIN_VALUE],
    [Number.MIN_VALUE, Number.MIN_VALUE, Number.MAX_VALUE, Number.MAX_VALUE],
  ]) assert.equal(adaptiveFitScale(...args), 1);
  assert.equal(adaptiveFitScale(1, 1, 5632, 2048), 1 / 5632);
});

test('minimum zoom always exposes one complete, nonduplicated circumference while panning', () => {
  for (const [mapWidth, mapHeight] of [[5632, 2048], [8192, 3616]]) {
    for (const [width, height] of [[390, 776], [1000, 672], [1920, 1008], [3440, 1080]]) {
      const scale = adaptiveFitScale(width, height, mapWidth, mapHeight), period = mapWidth * scale;
      const frame = worldFrame(width, height, mapWidth, mapHeight, scale);
      assert.ok(Math.abs(frame.width - period) < 1e-9, 'the complete world circumference fits at minimum zoom');
      assert.ok(frame.height <= height && frame.width <= width);
      for (const offset of [0, period / 3, -period * 1000]) {
        const copies = clippedCopies(offset, period, frame);
        const visible = copies.reduce((sum, copy) => sum + Math.min(frame.x + frame.width, offset + (copy + 1) * period)
          - Math.max(frame.x, offset + copy * period), 0);
        assert.ok(Math.abs(visible - period) < 1e-7);
        assert.ok(copies.length >= 1 && copies.length <= 2);
        assert.equal(frameContains(frame.x + frame.width, frame.y + frame.height / 2, frame), false,
          'the duplicate seam endpoint is excluded from picking');
      }
    }
  }
});

test('clipped seam copies cover exactly one world at most across zoom and resize', () => {
  for (const viewportWidth of [320, 1200, 4000]) for (const scale of [.00001, .07, .2, 1, 6]) {
    const period = 5632 * scale;
    const frame = worldFrame(viewportWidth, 700, 5632, 2048, scale);
    for (const offset of [-1000 * period, -period / 3, 0, 29, period, 1000 * period]) {
      const copies = clippedCopies(offset, period, frame);
      assert.ok(copies.length >= 1 && copies.length <= 2);
      const segments = copies.map(copy => [Math.max(frame.x, offset + copy * period),
        Math.min(frame.x + frame.width, offset + (copy + 1) * period)]);
      const visibleWidth = segments.reduce((sum, [start, end]) => sum + end - start, 0);
      assert.ok(Math.abs(visibleWidth - frame.width) < 1e-7);
      assert.ok(frame.width <= period);
      // Coordinates within the visible frame cannot contain the same longitude twice.
      for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) {
        const a = frame.x + frame.width * i / 10, b = frame.x + frame.width * j / 10;
        assert.notEqual(wrapX(a - offset, period), wrapX(b - offset, period));
      }
    }
  }
});

test('exact and fractional seams do not request zero-width extra copies', () => {
  assert.deepEqual(clippedCopies(0, 100, {x:0, width:100}), [0]);
  assert.deepEqual(clippedCopies(100, 100, {x:0, width:100}), [-1]);
  assert.deepEqual(clippedCopies(25, 100, {x:0, width:100}), [-1, 0]);
  const period = 5632 * .07, frame = {x:400, width:period};
  assert.deepEqual(clippedCopies(frame.x, period, frame), [0]);
  assert.deepEqual(clippedCopies(frame.x - period, period, frame), [1]);
});

test('frame picking excludes letterbox and duplicate right or bottom edges', () => {
  const frame = worldFrame(1200, 800, 1000, 500, .6);
  assert.equal(frameContains(300, 250, frame), true);
  assert.equal(frameContains(899.999, 549.999, frame), true);
  for (const [x, y] of [[299.999, 400], [900, 400], [600, 249.999], [600, 550], [NaN, 400]]) {
    assert.equal(frameContains(x, y, frame), false);
  }
});

test('camera remains horizontally cyclic and vertically bounded when the window shrinks or grows', () => {
  const frame = worldFrame(1200, 800, 1000, 500, .6);
  const first = constrainCamera(-300, 9999, .6, 1000, 500, 1200, 800);
  assert.deepEqual(first, {tx:300, ty:frame.y});
  assert.deepEqual(constrainCamera(-300 + 600 * 1000, -9999, .6, 1000, 500, 1200, 800), first);
  assert.deepEqual(constrainCamera(-300, -9999, 2, 1000, 500, 1200, 800), {tx:1700, ty:-250});
  assert.deepEqual(constrainCamera(-300, 9999, 2, 1000, 500, 1200, 800), {tx:1700, ty:50});
  assert.equal(constrainCamera(20, 45, 1, 1000, 800, 1200, 800).ty, 0);
  // An enlarged viewport now fits the whole map and recenters its latitude.
  assert.equal(constrainCamera(20, -100, 2, 1000, 500, 2500, 1400).ty, 200);
});

test('empty or invalid viewports never produce interaction targets or copy loops', () => {
  for (const frame of [worldFrame(0, 800, 1000, 500, .6), worldFrame(1200, 800, 1000, 500, 0),
    worldFrame(1200, 800, 0, 500, .6), worldFrame(NaN, 800, 1000, 500, .6)]) {
    assert.equal(frameContains(0, 0, frame), false);
    assert.deepEqual(clippedCopies(0, 100, frame), []);
  }
  assert.deepEqual(clippedCopies(0, 0, {x:0, width:100}), []);
  assert.deepEqual(clippedCopies(Infinity, 100, {x:0, width:100}), []);
});
