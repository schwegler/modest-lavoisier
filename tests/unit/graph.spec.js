const { test, expect } = require('@playwright/test');

test.describe('WikiGraph', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8080');
  });

  test('constructor should initialize with defaults', async ({ page }) => {
    const initialState = await page.evaluate(async () => {
      const { WikiGraph } = await new Function("return import('/js/graph.js')")();
      const canvas = document.createElement('canvas');
      // Mock getContext to avoid rendering issues in headless mode without full WebGL sometimes
      canvas.getContext = () => ({
        scale: () => {},
        translate: () => {},
        clearRect: () => {},
        save: () => {},
        restore: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        fill: () => {},
        arc: () => {},
        strokeText: () => {},
        fillText: () => {},
        setLineDash: () => {},
      });
      document.body.appendChild(canvas);

      const graph = new WikiGraph(canvas, () => {});
      return {
        nodesLen: graph.nodes.length,
        linksLen: graph.links.length,
        zoom: graph.zoom,
        charge: graph.charge,
        isPlaying: graph.isPlaying,
        running: graph.running,
      };
    });

    expect(initialState.nodesLen).toBe(0);
    expect(initialState.linksLen).toBe(0);
    expect(initialState.zoom).toBe(1.0);
    expect(initialState.charge).toBe(-1200);
    expect(initialState.isPlaying).toBe(true);
    expect(initialState.running).toBe(false);
  });

  test('updateData should populate nodes and links correctly', async ({ page }) => {
    const dataState = await page.evaluate(async () => {
      const { WikiGraph } = await new Function("return import('/js/graph.js')")();
      const canvas = document.createElement('canvas');
      canvas.getContext = () => ({
        scale: () => {},
        translate: () => {},
        clearRect: () => {},
        save: () => {},
        restore: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        fill: () => {},
        arc: () => {},
        strokeText: () => {},
        fillText: () => {},
        setLineDash: () => {},
      });

      const graph = new WikiGraph(canvas, () => {});

      // Stop the simulation so coordinates don't change asynchronously during tests
      graph.stop();

      const pages = [{ name: 'Home' }, { name: 'About' }, { name: 'Contact' }];
      const linksData = [
        { source: 'Home', target: 'About' },
        { source: 'Home', target: 'Contact' }
      ];

      graph.updateData(pages, linksData, 'Home', false);

      return {
        nodesLen: graph.nodes.length,
        linksLen: graph.links.length,
        hasHome: graph.nodesMap.has('home'),
        hasAbout: graph.nodesMap.has('about'),
        isHomeCurrent: graph.nodesMap.get('home').isCurrent,
        isAboutCurrent: graph.nodesMap.get('about').isCurrent
      };
    });

    expect(dataState.nodesLen).toBe(3);
    expect(dataState.linksLen).toBe(2);
    expect(dataState.hasHome).toBe(true);
    expect(dataState.hasAbout).toBe(true);
    expect(dataState.isHomeCurrent).toBe(true);
    expect(dataState.isAboutCurrent).toBe(false);
  });

  test('findNodeAt should identify nodes within click threshold', async ({ page }) => {
    const hitResult = await page.evaluate(async () => {
      const { WikiGraph } = await new Function("return import('/js/graph.js')")();
      const canvas = document.createElement('canvas');
      canvas.getContext = () => ({
        scale: () => {},
        translate: () => {},
        clearRect: () => {},
        save: () => {},
        restore: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        fill: () => {},
        arc: () => {},
        strokeText: () => {},
        fillText: () => {},
        setLineDash: () => {},
      });

      const graph = new WikiGraph(canvas, () => {});
      graph.stop();

      const pages = [{ name: 'NodeA' }];
      const linksData = [];
      graph.updateData(pages, linksData, null, false);

      const nodeA = graph.nodesMap.get('nodea');
      // Forcibly set coordinates for predictable testing
      nodeA.x = 100;
      nodeA.y = 100;
      nodeA.radius = 10;

      // Exact hit
      const hit1 = graph.findNodeAt(100, 100);
      // Close hit (within limit = radius + 4)
      const hit2 = graph.findNodeAt(110, 100);
      // Miss
      const miss = graph.findNodeAt(150, 150);

      return {
        hit1Id: hit1 ? hit1.id : null,
        hit2Id: hit2 ? hit2.id : null,
        missHit: miss !== null
      };
    });

    expect(hitResult.hit1Id).toBe('NodeA');
    expect(hitResult.hit2Id).toBe('NodeA');
    expect(hitResult.missHit).toBe(false);
  });

  test('start and stop should control simulation running state', async ({ page }) => {
    const simState = await page.evaluate(async () => {
      const { WikiGraph } = await new Function("return import('/js/graph.js')")();
      const canvas = document.createElement('canvas');
      canvas.getContext = () => ({
        scale: () => {},
        translate: () => {},
        clearRect: () => {},
        save: () => {},
        restore: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        fill: () => {},
        arc: () => {},
        strokeText: () => {},
        fillText: () => {},
        setLineDash: () => {},
      });

      const graph = new WikiGraph(canvas, () => {});

      const runningInitially = graph.running;

      graph.start();
      const runningAfterStart = graph.running;

      graph.stop();
      const runningAfterStop = graph.running;

      return {
        runningInitially,
        runningAfterStart,
        runningAfterStop
      };
    });

    expect(simState.runningInitially).toBe(false);
    expect(simState.runningAfterStart).toBe(true);
    expect(simState.runningAfterStop).toBe(false);
  });
});
