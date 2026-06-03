/**
 * Native Nodes - Interactive Force-Directed Graph View
 * 
 * Renders page connections on a high-DPI Canvas with basic physics
 * and interactive controls (pan, zoom, hover highlights, drag-and-drop).
 */

export class WikiGraph {
  /**
   * @param {HTMLCanvasElement} canvas 
   * @param {function(string): void} onNodeClick Callback when a node is clicked
   */
  constructor(canvas, onNodeClick) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onNodeClick = onNodeClick;

    this.nodes = [];
    this.links = [];
    this.nodesMap = new Map();

    // Viewport transforms (Pan & Zoom)
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;

    // Interaction states
    this.hoveredNode = null;
    this.draggedNode = null;
    this.isPanning = false;
    this.startX = 0;
    this.startY = 0;
    this.dragOffset = { x: 0, y: 0 };
    this.clickThresh = 5; // Pixels to distinguish click from drag
    this.mouseDownPos = null;

    // Simulation parameters
    this.charge = -1200;       // Repulsion strength (default wider spacing)
    this.linkStrength = 0.04;   // Hooke's Law spring strength
    this.linkDistance = 100;    // Ideal bond distance (slightly wider)
    this.centerStrength = 0.003; // Attractor pull to center (gentler gravity)
    this.damping = 0.82;        // Friction coefficient

    // Stabilization & features
    this.alpha = 1.0;           // Simulation temperature
    this.alphaDecay = 0.025;    // Cool down rate per frame
    this.alphaMin = 0.005;      // Stop simulation below this threshold
    this.isPlaying = true;      // Play/pause physics
    this.searchFilter = '';     // Node label filter string

    this.activeNodeId = null;
    this.isDark = false;
    this.running = false;

    this.initEvents();
    this.resizeCanvas();
  }

  /**
   * Adjusts canvas backing resolution to prevent blurriness on Retina/High-DPI screens.
   */
  resizeCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
  }

  /**
   * Starts the simulation animation loop.
   */
  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.tick();
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /**
   * Stops the simulation loop.
   */
  stop() {
    this.running = false;
  }

  /**
   * Wakes up or resets simulation temperature.
   */
  heatUp() {
    this.alpha = 1.0;
    if (this.isPlaying) {
      this.start();
    } else {
      this.draw(); // Make sure to render if we are paused
    }
  }

  /**
   * Re-populates simulation data.
   * @param {Array<{name: string, exists: boolean}>} pages 
   * @param {Array<{source: string, target: string}>} linksData 
   * @param {string|null} activeNodeId 
   * @param {boolean} isDark 
   */
  updateData(pages, linksData, activeNodeId, isDark) {
    this.activeNodeId = activeNodeId;
    this.isDark = isDark;

    const oldNodes = new Map(this.nodes.map(n => [n.id.toLowerCase(), n]));
    const rect = this.canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    // Calculate degree of each page
    const degrees = new Map();
    for (const link of linksData) {
      const src = link.source.toLowerCase();
      const tgt = link.target.toLowerCase();
      degrees.set(src, (degrees.get(src) || 0) + 1);
      degrees.set(tgt, (degrees.get(tgt) || 0) + 1);
    }

    // Build node elements
    this.nodes = pages.map(page => {
      const key = page.name.toLowerCase();
      const old = oldNodes.get(key);
      const isCurrent = activeNodeId && page.name.toLowerCase() === activeNodeId.toLowerCase();
      
      const degree = degrees.get(key) || 0;
      const baseRadius = isCurrent ? 12 : 8;
      const radius = baseRadius + Math.min(degree * 1.2, 10); // cap degree bonus at 10px

      return {
        id: page.name,
        exists: page.exists !== false,
        isCurrent: !!isCurrent,
        x: old ? old.x : cx + (Math.random() - 0.5) * 150,
        y: old ? old.y : cy + (Math.random() - 0.5) * 150,
        vx: old ? old.vx : 0,
        vy: old ? old.vy : 0,
        radius: radius,
        degree: degree,
        isDragging: false
      };
    });

    this.nodesMap = new Map(this.nodes.map(n => [n.id.toLowerCase(), n]));

    // Construct edge arrays pointing to actual objects
    this.links = [];
    for (const link of linksData) {
      const sourceNode = this.nodesMap.get(link.source.toLowerCase());
      const targetNode = this.nodesMap.get(link.target.toLowerCase());
      if (sourceNode && targetNode) {
        this.links.push({ source: sourceNode, target: targetNode });
      }
    }

    // Wake up simulation
    this.heatUp();
  }

  /**
   * Map screen coordinates to zoomed/panned viewport coordinates.
   */
  screenToWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return {
      x: (x - this.panX) / this.zoom,
      y: (y - this.panY) / this.zoom
    };
  }

  /**
   * Attaches interaction event hooks.
   */
  initEvents() {
    // Resize handler
    window.addEventListener('resize', () => {
      this.resizeCanvas();
      this.heatUp();
    });

    // Mouse movements
    this.canvas.addEventListener('mousedown', e => {
      const worldPos = this.screenToWorld(e.clientX, e.clientY);
      this.mouseDownPos = { x: e.clientX, y: e.clientY };

      // Check if clicking node
      const hitNode = this.findNodeAt(worldPos.x, worldPos.y);
      if (hitNode) {
        this.draggedNode = hitNode;
        hitNode.isDragging = true;
        this.dragOffset.x = worldPos.x - hitNode.x;
        this.dragOffset.y = worldPos.y - hitNode.y;
        this.heatUp();
      } else {
        // Start pan
        this.isPanning = true;
        this.startX = e.clientX - this.panX;
        this.startY = e.clientY - this.panY;
      }
    });

    this.canvas.addEventListener('mousemove', e => {
      const worldPos = this.screenToWorld(e.clientX, e.clientY);

      if (this.draggedNode) {
        this.draggedNode.x = worldPos.x - this.dragOffset.x;
        this.draggedNode.y = worldPos.y - this.dragOffset.y;
        this.draggedNode.vx = 0;
        this.draggedNode.vy = 0;
        this.heatUp();
      } else if (this.isPanning) {
        this.panX = e.clientX - this.startX;
        this.panY = e.clientY - this.startY;
        this.draw();
      } else {
        // Update hover
        const node = this.findNodeAt(worldPos.x, worldPos.y);
        if (node !== this.hoveredNode) {
          this.hoveredNode = node;
          this.canvas.style.cursor = node ? 'pointer' : 'default';
          this.draw();
        }
      }
    });

    const release = e => {
      if (this.draggedNode) {
        this.draggedNode.isDragging = false;
        
        // If it was a quick click, trigger navigation
        if (this.mouseDownPos) {
          const dx = Math.abs(e.clientX - this.mouseDownPos.x);
          const dy = Math.abs(e.clientY - this.mouseDownPos.y);
          if (dx < this.clickThresh && dy < this.clickThresh) {
            this.onNodeClick(this.draggedNode.id);
          }
        }
        this.draggedNode = null;
        this.heatUp();
      }
      this.isPanning = false;
      this.mouseDownPos = null;
    };

    this.canvas.addEventListener('mouseup', release);
    this.canvas.addEventListener('mouseleave', release);

    // Zooming
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Mouse position in world coordinates before zoom
      const worldX = (mouseX - this.panX) / this.zoom;
      const worldY = (mouseY - this.panY) / this.zoom;

      const zoomFactor = 1.1;
      if (e.deltaY < 0) {
        this.zoom = Math.min(this.zoom * zoomFactor, 3.0);
      } else {
        this.zoom = Math.max(this.zoom / zoomFactor, 0.3);
      }

      // Readjust pan so mouse remains over the same world coordinate
      this.panX = mouseX - worldX * this.zoom;
      this.panY = mouseY - worldY * this.zoom;
      
      this.heatUp();
    }, { passive: false });
  }

  /**
   * Finds the node under the coordinate.
   */
  findNodeAt(x, y) {
    for (const node of this.nodes) {
      const dx = node.x - x;
      const dy = node.y - y;
      const limit = node.radius + 6; // Hit buffer
      if (dx * dx + dy * dy < limit * limit) {
        return node;
      }
    }
    return null;
  }

  /**
   * Main simulation frame physics update.
   */
  tick() {
    if (!this.isPlaying) return;

    const rect = this.canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    // Apply alpha decay
    this.alpha *= (1 - this.alphaDecay);
    if (this.alpha < this.alphaMin) {
      this.alpha = 0;
      this.stop();
      return;
    }

    // 1. Repulsion between all node pairs
    for (let i = 0; i < this.nodes.length; i++) {
      const n1 = this.nodes[i];
      for (let j = i + 1; j < this.nodes.length; j++) {
        const n2 = this.nodes[j];
        
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const distSq = dx * dx + dy * dy + 0.1;
        const dist = Math.sqrt(distSq);

        if (dist < 600) {
          // Repulsion force with a buffer to prevent extreme forces
          const f = (this.charge * this.alpha) / (distSq + 100);
          const fx = f * (dx / dist);
          const fy = f * (dy / dist);

          if (!n1.isDragging) {
            n1.vx += fx;
            n1.vy += fy;
          }
          if (!n2.isDragging) {
            n2.vx -= fx;
            n2.vy -= fy;
          }
        }
      }
    }

    // 2. Attraction pull along links
    for (const link of this.links) {
      const s = link.source;
      const t = link.target;

      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;

      // Spring displacement force
      const f = (dist - this.linkDistance) * this.linkStrength * this.alpha;
      const fx = f * (dx / dist);
      const fy = f * (dy / dist);

      if (!s.isDragging) {
        s.vx += fx;
        s.vy += fy;
      }
      if (!t.isDragging) {
        t.vx -= fx;
        t.vy -= fy;
      }
    }

    // 3. Collision avoidance force (separates overlapping nodes)
    for (let i = 0; i < this.nodes.length; i++) {
      const n1 = this.nodes[i];
      for (let j = i + 1; j < this.nodes.length; j++) {
        const n2 = this.nodes[j];
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const minDist = n1.radius + n2.radius + 12; // radius + padding
        const distSq = dx * dx + dy * dy;
        if (distSq < minDist * minDist) {
          const dist = Math.sqrt(distSq) || 0.1;
          const overlap = minDist - dist;
          const forceStrength = overlap * 0.15 * this.alpha;
          const fx = (dx / dist) * forceStrength;
          const fy = (dy / dist) * forceStrength;

          if (!n1.isDragging) {
            n1.vx -= fx;
            n1.vy -= fy;
          }
          if (!n2.isDragging) {
            n2.vx += fx;
            n2.vy += fy;
          }
        }
      }
    }

    // 4. Update positions, apply center gravity, friction damping
    const maxVelocity = 10; // Cap node movement speed to stop wild oscillations
    for (const node of this.nodes) {
      if (node.isDragging) continue;

      // Center force pull: pull active node strongly to center, others gently
      let cStrength = this.centerStrength;
      if (node.isCurrent) {
        cStrength = this.centerStrength * 10;
      }
      node.vx += (cx - node.x) * cStrength * this.alpha;
      node.vy += (cy - node.y) * cStrength * this.alpha;

      // Cap speed
      const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
      if (speed > maxVelocity) {
        node.vx = (node.vx / speed) * maxVelocity;
        node.vy = (node.vy / speed) * maxVelocity;
      }

      node.x += node.vx;
      node.y += node.vy;
      node.vx *= this.damping;
      node.vy *= this.damping;
    }
  }

  /**
   * Redraws the scene.
   */
  draw() {
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    this.ctx.clearRect(0, 0, w, h);

    this.ctx.save();
    // Apply pan & zoom
    this.ctx.translate(this.panX, this.panY);
    this.ctx.scale(this.zoom, this.zoom);

    // Styling constants
    const accentColor = '#6366f1'; // Premium Indigo
    const accentGlow = 'rgba(99, 102, 241, 0.25)';
    const brokenColor = '#ef4444'; // Red-orange for missing notes
    const brokenGlow = 'rgba(239, 68, 68, 0.2)';

    const lineColorDefault = this.isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';
    const lineColorActive = this.isDark ? 'rgba(99, 102, 241, 0.45)' : 'rgba(99, 102, 241, 0.35)';
    const nodeColorDefault = this.isDark ? '#334155' : '#cbd5e1';
    const nodeColorText = this.isDark ? '#e2e8f0' : '#1e293b';

    // 1. Draw connections/links
    this.ctx.lineWidth = 1.5;
    for (const link of this.links) {
      const isRelatedToHover = this.hoveredNode && 
        (link.source === this.hoveredNode || link.target === this.hoveredNode);
      const isRelatedToCurrent = this.activeNodeId && 
        (link.source.id.toLowerCase() === this.activeNodeId.toLowerCase() || 
         link.target.id.toLowerCase() === this.activeNodeId.toLowerCase());

      let linkOpacity = 1.0;
      if (this.searchFilter) {
        const query = this.searchFilter.toLowerCase();
        const srcMatches = link.source.id.toLowerCase().includes(query);
        const tgtMatches = link.target.id.toLowerCase().includes(query);
        if (!srcMatches || !tgtMatches) {
          linkOpacity = 0.15;
        }
      }

      this.ctx.save();
      this.ctx.globalAlpha = linkOpacity;

      this.ctx.beginPath();
      this.ctx.moveTo(link.source.x, link.source.y);
      this.ctx.lineTo(link.target.x, link.target.y);
      
      if (isRelatedToHover || isRelatedToCurrent) {
        this.ctx.strokeStyle = lineColorActive;
        this.ctx.lineWidth = 2.0;
      } else {
        this.ctx.strokeStyle = lineColorDefault;
        this.ctx.lineWidth = 1.0;
      }
      this.ctx.stroke();
      this.ctx.restore();
    }

    // 2. Draw node points
    for (const node of this.nodes) {
      const isHovered = node === this.hoveredNode;
      const isCurrent = node.isCurrent;

      let nodeOpacity = 1.0;
      let matchesFilter = true;
      if (this.searchFilter) {
        const query = this.searchFilter.toLowerCase();
        matchesFilter = node.id.toLowerCase().includes(query);
        if (!matchesFilter) {
          nodeOpacity = 0.15;
        }
      }

      this.ctx.save();
      this.ctx.globalAlpha = nodeOpacity;

      this.ctx.beginPath();
      
      // Draw glow ring if active/hovered
      if (isCurrent || isHovered) {
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(node.x, node.y, node.radius + 6, 0, Math.PI * 2);
        this.ctx.fillStyle = node.exists ? accentGlow : brokenGlow;
        this.ctx.fill();
        this.ctx.restore();
      }

      this.ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      
      if (!node.exists) {
        // Red dashed outline if targeted note does not exist yet
        this.ctx.save();
        this.ctx.fillStyle = this.isDark ? '#1e293b' : '#f8fafc';
        this.ctx.fill();
        this.ctx.strokeStyle = brokenColor;
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([3, 2]);
        this.ctx.stroke();
        this.ctx.restore();
      } else if (isCurrent) {
        this.ctx.fillStyle = accentColor;
        this.ctx.fill();
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 1.5;
        this.ctx.stroke();
      } else {
        this.ctx.fillStyle = isHovered ? accentColor : nodeColorDefault;
        this.ctx.fill();
      }

      // Check if node is 1 degree of separation away from the active note
      let isNeighbour = false;
      if (this.activeNodeId) {
        const activeKey = this.activeNodeId.toLowerCase();
        isNeighbour = this.links.some(link => 
          (link.source.id.toLowerCase() === activeKey && link.target.id.toLowerCase() === node.id.toLowerCase()) ||
          (link.target.id.toLowerCase() === activeKey && link.source.id.toLowerCase() === node.id.toLowerCase())
        );
      }

      // 3. Draw text labels
      const showLabel = isHovered || 
                        isCurrent || 
                        isNeighbour || 
                        (this.searchFilter && matchesFilter) || 
                        (!this.activeNodeId && this.zoom > 0.6);
      if (showLabel) {
        this.ctx.save();
        this.ctx.font = isCurrent ? 'bold 11px sans-serif' : '10px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'top';

        // Draw shadow/outline for readability
        this.ctx.strokeStyle = this.isDark ? '#0f172a' : '#ffffff';
        this.ctx.lineWidth = 3;
        this.ctx.strokeText(node.id, node.x, node.y + node.radius + 5);

        this.ctx.fillStyle = isCurrent ? accentColor : (isHovered ? accentColor : nodeColorText);
        this.ctx.fillText(node.id, node.x, node.y + node.radius + 5);
        this.ctx.restore();
      }

      this.ctx.restore();
    }

    this.ctx.restore();
  }

  // Interactive controls helper methods
  zoomIn() {
    this.zoomToScale(1.25);
  }

  zoomOut() {
    this.zoomToScale(0.8);
  }

  zoomToScale(factor) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    const worldX = (cx - this.panX) / this.zoom;
    const worldY = (cy - this.panY) / this.zoom;

    this.zoom = Math.max(0.3, Math.min(3.0, this.zoom * factor));

    this.panX = cx - worldX * this.zoom;
    this.panY = cy - worldY * this.zoom;

    this.heatUp();
  }

  resetView() {
    if (this.nodes.length === 0) return;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const node of this.nodes) {
      if (node.x < minX) minX = node.x;
      if (node.x > maxX) maxX = node.x;
      if (node.y < minY) minY = node.y;
      if (node.y > maxY) maxY = node.y;
    }

    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    const ncx = (minX + maxX) / 2;
    const ncy = (minY + maxY) / 2;

    const ccx = w / 2;
    const ccy = h / 2;

    const nW = Math.max(maxX - minX, 50);
    const nH = Math.max(maxY - minY, 50);

    const zoomX = (w * 0.7) / nW;
    const zoomY = (h * 0.7) / nH;
    this.zoom = Math.max(0.4, Math.min(zoomX, zoomY, 1.2));

    this.panX = ccx - ncx * this.zoom;
    this.panY = ccy - ncy * this.zoom;

    this.heatUp();
  }

  setSearchFilter(query) {
    this.searchFilter = query.trim();
    this.draw();
  }

  setRepulsion(val) {
    this.charge = -Math.abs(val);
    this.heatUp();
  }

  setLinkDistance(val) {
    this.linkDistance = Number(val);
    this.heatUp();
  }

  togglePlay(isPlaying) {
    this.isPlaying = isPlaying;
    if (isPlaying) {
      this.heatUp();
    } else {
      this.stop();
    }
  }
}
