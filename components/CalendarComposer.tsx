
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Download, Trash2, Eye, EyeOff, Calendar as CalendarIcon, MousePointer2, Info, CircleDashed, Plus, X, Copy } from 'lucide-react';
import { ImageState, TransformState, DragMode, Point, Mask, EditMode } from '../types';

// --- Math & Rendering Helpers ---

// Linear interpolation
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Interpolate a point between two other points
const lerpPoint = (p1: Point, p2: Point, t: number): Point => ({
  x: lerp(p1.x, p2.x, t),
  y: lerp(p1.y, p2.y, t),
});

// Solve system of linear equations for affine transform mapping source triangle to dest triangle
// Maps (u0,v0)->(x0,y0), (u1,v1)->(x1,y1), (u2,v2)->(x2,y2)
// Returns matrix [a, b, c, d, e, f] for transform(a, b, c, d, e, f)
const getTriangleTransform = (
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  u0: number, v0: number,
  u1: number, v1: number,
  u2: number, v2: number
) => {
  const det = (u0 * (v1 - v2) - v0 * (u1 - u2) + (u1 * v2 - u2 * v1));
  if (det === 0) return null;

  const idet = 1 / det;
  const a = (x0 * (v1 - v2) + x1 * (v2 - v0) + x2 * (v0 - v1)) * idet;
  const b = (y0 * (v1 - v2) + y1 * (v2 - v0) + y2 * (v0 - v1)) * idet;
  const c = (x0 * (u2 - u1) + x1 * (u0 - u2) + x2 * (u1 - u0)) * idet;
  const d = (y0 * (u2 - u1) + y1 * (u0 - u2) + y2 * (u1 - u0)) * idet;
  const e = (x0 * (u1 * v2 - u2 * v1) + x1 * (u2 * v0 - u0 * v2) + x2 * (u0 * v1 - u1 * v0)) * idet;
  const f = (y0 * (u1 * v2 - u2 * v1) + y1 * (u2 * v0 - u0 * v2) + y2 * (u0 * v1 - u1 * v0)) * idet;
  
  return [a, b, c, d, e, f];
};

export const CalendarComposer: React.FC = () => {
  // --- State ---
  const [background, setBackground] = useState<ImageState>({ file: null, url: null, width: 0, height: 0 });
  const [foreground, setForeground] = useState<ImageState>({ file: null, url: null, width: 0, height: 0 });
  
  const [transform, setTransform] = useState<TransformState>({
    corners: [{x:0,y:0}, {x:0,y:0}, {x:0,y:0}, {x:0,y:0}],
    opacity: 0.9,
  });

  // Masking State
  const [masks, setMasks] = useState<Mask[]>([]);
  const [editMode, setEditMode] = useState<EditMode>(EditMode.WARP);
  const [activeMaskId, setActiveMaskId] = useState<string | null>(null);

  const [dragMode, setDragMode] = useState<DragMode>(DragMode.NONE);
  const [dragStart, setDragStart] = useState<Point>({ x: 0, y: 0 });
  
  // Store original state at start of drag
  const [initialDragCorners, setInitialDragCorners] = useState<[Point,Point,Point,Point]>([{x:0,y:0},{x:0,y:0},{x:0,y:0},{x:0,y:0}]);
  const [initialDragMask, setInitialDragMask] = useState<Mask | null>(null);
  
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [showGuides, setShowGuides] = useState(true);

  // --- Refs ---
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Helper canvas for compositing foreground + masks before drawing to main canvas
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const fgImageRef = useRef<HTMLImageElement | null>(null);

  // --- Handlers ---

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'bg' | 'fg') => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    img.onload = () => {
      const newState = { file, url, width: img.width, height: img.height };
      
      if (type === 'bg') {
        setBackground(newState);
        bgImageRef.current = img;
        setCanvasSize({ width: img.width, height: img.height });
      } else {
        setForeground(newState);
        fgImageRef.current = img;
        
        // Initialize corners to be centered with reasonable size
        const canvasW = canvasSize.width || 800;
        const canvasH = canvasSize.height || 600;
        
        // Start with 50% of canvas width, maintaining aspect ratio
        const targetW = canvasW * 0.5;
        const scale = targetW / img.width;
        const targetH = img.height * scale;
        
        const cx = canvasW / 2;
        const cy = canvasH / 2;
        
        setTransform(prev => ({
          ...prev,
          corners: [
            { x: cx - targetW/2, y: cy - targetH/2 }, // TL
            { x: cx + targetW/2, y: cy - targetH/2 }, // TR
            { x: cx + targetW/2, y: cy + targetH/2 }, // BR
            { x: cx - targetW/2, y: cy + targetH/2 }, // BL
          ],
          opacity: 0.9
        }));
        
        // Switch to warp mode by default when uploading new photo
        setEditMode(EditMode.WARP);
      }
    };
  };

  const addMask = () => {
    // Scale default size based on image dimensions
    const minDim = Math.min(canvasSize.width, canvasSize.height);
    // Create a vertical capsule shape by default (narrow width, taller height)
    const defaultRadiusX = Math.max(10, minDim * 0.015); // Width (half)
    const defaultRadiusY = Math.max(30, minDim * 0.05);  // Height (half)
    
    const cx = canvasSize.width / 2;
    const cy = canvasSize.height / 4;
    
    const newMask: Mask = {
      id: Date.now().toString(),
      x: cx,
      y: cy,
      radiusX: defaultRadiusX,
      radiusY: defaultRadiusY,
      rotation: 0
    };
    setMasks(prev => [...prev, newMask]);
    setActiveMaskId(newMask.id);
    setEditMode(EditMode.MASK);
  };

  const duplicateMask = () => {
    if (!activeMaskId) return;
    const source = masks.find(m => m.id === activeMaskId);
    if (!source) return;

    const newMask: Mask = {
        ...source,
        id: Date.now().toString(),
        // Offset slightly to the right
        x: source.x + (source.radiusX * 2 + (canvasSize.width * 0.02)), 
        y: source.y
    };
    setMasks(prev => [...prev, newMask]);
    setActiveMaskId(newMask.id);
  }

  const removeMask = (id: string) => {
    setMasks(prev => prev.filter(m => m.id !== id));
    if (activeMaskId === id) setActiveMaskId(null);
  };

  // --- Rendering Logic ---
  
  // Helper to draw a single affine triangle with gap-fill overlap
  const drawTextureTriangle = (
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    sx0: number, sy0: number,
    sx1: number, sy1: number,
    sx2: number, sy2: number,
    dx0: number, dy0: number,
    dx1: number, dy1: number,
    dx2: number, dy2: number
  ) => {
    ctx.save();
    
    // Seam Fix: Expand vertices slightly from centroid for clipping path
    // Increased expansion to 1.5 to aggressively fill anti-aliasing gaps
    const cx = (dx0 + dx1 + dx2) / 3;
    const cy = (dy0 + dy1 + dy2) / 3;
    const expansion = 1.5; // Increased pixel amount to expand
    
    const expand = (x: number, y: number) => {
      const dirX = x - cx;
      const dirY = y - cy;
      const len = Math.sqrt(dirX * dirX + dirY * dirY);
      if (len === 0) return { x, y };
      return { x: x + (dirX / len) * expansion, y: y + (dirY / len) * expansion };
    };

    const p0 = expand(dx0, dy0);
    const p1 = expand(dx1, dy1);
    const p2 = expand(dx2, dy2);

    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.closePath();
    ctx.clip();

    // Compute affine transform using ORIGINAL destination coordinates
    const m = getTriangleTransform(dx0, dy0, dx1, dy1, dx2, dy2, sx0, sy0, sx1, sy1, sx2, sy2);
    if (m) {
      ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      ctx.drawImage(img, 0, 0);
    }
    ctx.restore();
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    // Calculate UI Scale based on resolution (Assuming 1000px is baseline)
    const uiScale = Math.max(1, Math.min(canvas.width, canvas.height) / 1000);

    // Initialize Offscreen Canvas if needed
    if (!offscreenRef.current) {
      offscreenRef.current = document.createElement('canvas');
    }
    const offCtx = offscreenRef.current.getContext('2d');
    
    // Ensure offscreen canvas matches main canvas size
    if (offscreenRef.current.width !== canvas.width || offscreenRef.current.height !== canvas.height) {
      offscreenRef.current.width = canvas.width;
      offscreenRef.current.height = canvas.height;
    }

    // --- MAIN RENDER LOOP ---

    // 1. Draw Background on MAIN canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (bgImageRef.current) {
      ctx.drawImage(bgImageRef.current, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = '20px sans-serif';
      ctx.fillStyle = '#9ca3af';
      ctx.textAlign = 'center';
      ctx.fillText('Upload Template (Fig 1)', canvas.width / 2, canvas.height / 2);
    }

    // 2. Prepare Foreground on OFFSCREEN canvas
    // We draw the warped photo here, then "erase" the masks, then draw the result to main canvas.
    if (fgImageRef.current && offCtx && transform && transform.corners) {
      offCtx.clearRect(0, 0, canvas.width, canvas.height);
      
      // 2a. Draw Warped Photo
      const img = fgImageRef.current;
      const { corners } = transform;
      const [tl, tr, br, bl] = corners;
      
      // Enable high quality scaling
      offCtx.imageSmoothingEnabled = true;
      offCtx.imageSmoothingQuality = 'high';

      // Reduced subdivisions to 10 to minimize internal edges while maintaining good perspective
      const subdivisions = 10; 
      for (let i = 0; i < subdivisions; i++) {
        for (let j = 0; j < subdivisions; j++) {
          const u0 = i / subdivisions;
          const v0 = j / subdivisions;
          const u1 = (i + 1) / subdivisions;
          const v1 = (j + 1) / subdivisions;

          const sx0 = u0 * img.width;
          const sy0 = v0 * img.height;
          const sx1 = u1 * img.width;
          const sy1 = v1 * img.height;

          const t0 = lerpPoint(tl, tr, u0);
          const t1 = lerpPoint(tl, tr, u1);
          const b0 = lerpPoint(bl, br, u0);
          const b1 = lerpPoint(bl, br, u1);
          
          const p00 = lerpPoint(t0, b0, v0);
          const p10 = lerpPoint(t1, b1, v0);
          const p01 = lerpPoint(t0, b0, v1);
          const p11 = lerpPoint(t1, b1, v1);

          drawTextureTriangle(offCtx, img, 
            sx0, sy0, sx1, sy0, sx1, sy1, 
            p00.x, p00.y, p10.x, p10.y, p11.x, p11.y 
          );
          drawTextureTriangle(offCtx, img,
            sx0, sy0, sx1, sy1, sx0, sy1,
            p00.x, p00.y, p11.x, p11.y, p01.x, p01.y
          );
        }
      }

      // 2b. Apply Masks (Eraser) - NOW USING CAPSULE/PILL SHAPE
      offCtx.globalCompositeOperation = 'destination-out';
      masks.forEach(mask => {
        offCtx.save();
        offCtx.translate(mask.x, mask.y);
        offCtx.rotate(mask.rotation);
        
        offCtx.beginPath();
        if (offCtx.roundRect) {
            // Create capsule shape: fully rounded corners based on the smaller dimension
            offCtx.roundRect(-mask.radiusX, -mask.radiusY, mask.radiusX * 2, mask.radiusY * 2, Math.min(mask.radiusX, mask.radiusY));
        } else {
            // Fallback
            offCtx.rect(-mask.radiusX, -mask.radiusY, mask.radiusX * 2, mask.radiusY * 2);
        }
        offCtx.fill();
        offCtx.restore();
      });
      // Reset composition mode
      offCtx.globalCompositeOperation = 'source-over';

      // 3. Composite Offscreen to Main
      ctx.save();
      ctx.globalAlpha = transform.opacity;
      ctx.drawImage(offscreenRef.current, 0, 0);
      ctx.restore();
    }

    // 4. Draw UI Guides (on top of everything)
    if (showGuides) {
      const guideLineWidth = 1.5 * uiScale;
      const handleRadius = 8 * uiScale;
      
      // 4a. Draw Warp Guides (if in warp mode or always subtle?)
      if (fgImageRef.current && transform.corners) {
        const [tl, tr, br, bl] = transform.corners;
        
        ctx.save();
        // Outline
        ctx.strokeStyle = editMode === EditMode.WARP ? '#4f46e5' : 'rgba(79, 70, 229, 0.3)';
        ctx.lineWidth = guideLineWidth;
        ctx.beginPath();
        ctx.moveTo(tl.x, tl.y);
        ctx.lineTo(tr.x, tr.y);
        ctx.lineTo(br.x, br.y);
        ctx.lineTo(bl.x, bl.y);
        ctx.closePath();
        ctx.stroke();

        // Handles (only if warping)
        if (editMode === EditMode.WARP) {
          [tl, tr, br, bl].forEach((p) => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, handleRadius, 0, Math.PI * 2);
            ctx.fillStyle = 'white';
            ctx.fill();
            ctx.strokeStyle = '#4f46e5';
            ctx.lineWidth = 2 * uiScale;
            ctx.stroke();
          });
        }
        ctx.restore();
      }

      // 4b. Draw Mask Guides (Capsule Shape)
      masks.forEach(mask => {
        const isActive = editMode === EditMode.MASK && mask.id === activeMaskId;
        
        ctx.save();
        ctx.translate(mask.x, mask.y);
        ctx.rotate(mask.rotation);
        
        ctx.beginPath();
        if (ctx.roundRect) {
             ctx.roundRect(-mask.radiusX, -mask.radiusY, mask.radiusX * 2, mask.radiusY * 2, Math.min(mask.radiusX, mask.radiusY));
        } else {
             ctx.rect(-mask.radiusX, -mask.radiusY, mask.radiusX * 2, mask.radiusY * 2);
        }
        
        if (isActive) {
            ctx.strokeStyle = '#ef4444'; // Red for active
            ctx.lineWidth = 2 * uiScale;
            ctx.stroke();
            
            // Draw Center Handle (Move)
            ctx.beginPath();
            ctx.arc(0, 0, handleRadius * 0.8, 0, Math.PI * 2);
            ctx.fillStyle = '#ef4444';
            ctx.fill();

            // Draw Resize Handle (Right edge - Width)
            ctx.beginPath();
            ctx.arc(mask.radiusX, 0, handleRadius, 0, Math.PI * 2);
            ctx.fillStyle = 'white';
            ctx.fill();
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 2 * uiScale;
            ctx.stroke();
            
            // Draw Resize Handle (Bottom edge - Height)
            ctx.beginPath();
            ctx.arc(0, mask.radiusY, handleRadius, 0, Math.PI * 2);
            ctx.fillStyle = 'white';
            ctx.fill();
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 2 * uiScale;
            ctx.stroke();
        } else {
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
            ctx.lineWidth = guideLineWidth;
            ctx.setLineDash([5 * uiScale, 5 * uiScale]);
            ctx.stroke();
        }
        ctx.restore();
      });
    }
  }, [background, foreground, transform, masks, showGuides, editMode, activeMaskId]);

  useEffect(() => {
    draw();
  }, [draw]);

  // --- Interaction Logic ---

  const getMousePos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const dist = (p1: Point, p2: Point) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (!foreground.url) return;
    const pos = getMousePos(e);
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Calculate dynamic threshold based on resolution
    const uiScale = Math.max(1, Math.min(canvas.width, canvas.height) / 1000);
    const hitThreshold = 25 * uiScale; // Generous hit area

    // --- MASK EDITING MODE ---
    if (editMode === EditMode.MASK) {
      // Check Active Mask handles first
      if (activeMaskId) {
        const mask = masks.find(m => m.id === activeMaskId);
        if (mask) {
          // Resize X handle (Right)
          if (dist(pos, { x: mask.x + mask.radiusX, y: mask.y }) < hitThreshold) {
             setDragMode(DragMode.MASK_RESIZE);
             setInitialDragMask(mask);
             setDragStart(pos);
             return;
          }
          // Resize Y handle (Bottom)
          if (dist(pos, { x: mask.x, y: mask.y + mask.radiusY }) < hitThreshold) {
             setDragMode(DragMode.MASK_RESIZE); 
             setInitialDragMask(mask);
             setDragStart(pos);
             return;
          }
        }
      }

      // Check for hitting any mask body (to select and move)
      // Reverse order to pick top-most
      for (let i = masks.length - 1; i >= 0; i--) {
        const m = masks[i];
        // Simple hit test for bounding box of the capsule approx
        // For precise pill hit test:
        const dx = Math.abs(pos.x - m.x);
        const dy = Math.abs(pos.y - m.y);
        
        if (dx <= m.radiusX && dy <= m.radiusY) {
           setActiveMaskId(m.id);
           setDragMode(DragMode.MASK_MOVE);
           setInitialDragMask(m);
           setDragStart(pos);
           return;
        }
      }
      
      // Clicked empty space -> deselect
      setActiveMaskId(null);
      return;
    }

    // --- WARP EDITING MODE ---
    if (editMode === EditMode.WARP) {
        const { corners } = transform;
        
        if (dist(pos, corners[0]) < hitThreshold) setDragMode(DragMode.CORNER_TL);
        else if (dist(pos, corners[1]) < hitThreshold) setDragMode(DragMode.CORNER_TR);
        else if (dist(pos, corners[2]) < hitThreshold) setDragMode(DragMode.CORNER_BR);
        else if (dist(pos, corners[3]) < hitThreshold) setDragMode(DragMode.CORNER_BL);
        else {
            // Check inside for move all
            let inside = false;
            for (let i = 0, j = 3; i < 4; j = i++) {
                const xi = corners[i].x, yi = corners[i].y;
                const xj = corners[j].x, yj = corners[j].y;
                const intersect = ((yi > pos.y) !== (yj > pos.y))
                    && (pos.x < (xj - xi) * (pos.y - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
            if (inside) {
                setDragMode(DragMode.MOVE_ALL);
                setInitialDragCorners([...transform.corners]);
            } else {
                return;
            }
        }
        setDragStart(pos);
    }
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (dragMode === DragMode.NONE) return;
    e.preventDefault();
    
    const pos = getMousePos(e);
    const dx = pos.x - dragStart.x;
    const dy = pos.y - dragStart.y;

    // --- HANDLE MASK DRAGGING ---
    if (dragMode === DragMode.MASK_MOVE && initialDragMask && activeMaskId) {
       setMasks(prev => prev.map(m => {
         if (m.id === activeMaskId) {
           return { ...m, x: initialDragMask.x + dx, y: initialDragMask.y + dy };
         }
         return m;
       }));
    }
    else if (dragMode === DragMode.MASK_RESIZE && initialDragMask && activeMaskId) {
       setMasks(prev => prev.map(m => {
         if (m.id === activeMaskId) {
            const canvas = canvasRef.current;
            const uiScale = canvas ? Math.max(1, Math.min(canvas.width, canvas.height) / 1000) : 1;
            
            // Determine which dimension to resize based on initial handle proximity
            const distToRightHandle = Math.abs(dragStart.x - (initialDragMask.x + initialDragMask.radiusX));
            const distToBottomHandle = Math.abs(dragStart.y - (initialDragMask.y + initialDragMask.radiusY));
            const threshold = 50 * uiScale; 

            let newRx = m.radiusX;
            let newRy = m.radiusY;

            if (distToRightHandle < threshold) {
                newRx = Math.max(5 * uiScale, initialDragMask.radiusX + dx);
            }
            if (distToBottomHandle < threshold) {
                newRy = Math.max(5 * uiScale, initialDragMask.radiusY + dy);
            }
            
            return { ...m, radiusX: newRx, radiusY: newRy };
         }
         return m;
       }));
    }

    // --- HANDLE WARP DRAGGING ---
    else if (editMode === EditMode.WARP) {
      setTransform(prev => {
        const newCorners = [...prev.corners] as [Point, Point, Point, Point];
        
        if (dragMode === DragMode.MOVE_ALL) {
           newCorners[0] = { x: initialDragCorners[0].x + dx, y: initialDragCorners[0].y + dy };
           newCorners[1] = { x: initialDragCorners[1].x + dx, y: initialDragCorners[1].y + dy };
           newCorners[2] = { x: initialDragCorners[2].x + dx, y: initialDragCorners[2].y + dy };
           newCorners[3] = { x: initialDragCorners[3].x + dx, y: initialDragCorners[3].y + dy };
        } else if (dragMode >= DragMode.CORNER_TL && dragMode <= DragMode.CORNER_BL) {
          const idx = dragMode - 1; 
          newCorners[idx] = { x: pos.x, y: pos.y };
        }
        
        return { ...prev, corners: newCorners };
      });
    }
  };

  const handleMouseUp = () => {
    setDragMode(DragMode.NONE);
    setInitialDragMask(null);
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const prevShowGuides = showGuides;
    setShowGuides(false);
    
    requestAnimationFrame(() => {
      draw(); 
      setTimeout(() => {
          const link = document.createElement('a');
          link.download = 'calendar-composed.png';
          link.href = canvas.toDataURL('image/png', 1.0);
          link.click();
          setShowGuides(prevShowGuides);
      }, 10);
    });
  };

  return (
    <div className="flex flex-col lg:flex-row h-full">
      
      {/* Left Control Panel */}
      <div className="w-full lg:w-1/3 p-6 border-b lg:border-b-0 lg:border-r border-gray-200 bg-gray-50 overflow-y-auto space-y-8">
        
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex gap-3">
          <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-semibold mb-1">Instructions:</p>
            <ol className="list-decimal list-inside space-y-1">
                <li>Upload Template (Background)</li>
                <li>Upload Photo (Foreground)</li>
                <li>Match corners to the calendar area.</li>
                <li>Use <strong>Binding Holes</strong> tab to mask out ring binders.</li>
            </ol>
          </div>
        </div>

        {/* Upload Section */}
        <div className="space-y-4">
           <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Images</h2>
           
           {/* Background */}
           <div className="flex items-center gap-3">
              <div className="flex-grow">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Template (Fig 1)</label>
                  {!background.url ? (
                    <label className="flex items-center justify-center w-full h-20 border border-gray-300 border-dashed rounded-lg cursor-pointer bg-white hover:bg-gray-50">
                        <div className="text-center">
                            <Upload className="w-4 h-4 text-gray-400 mx-auto" />
                            <span className="text-xs text-gray-500">Upload</span>
                        </div>
                        <input type="file" className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, 'bg')} />
                    </label>
                  ) : (
                     <div className="relative h-20 w-full rounded-lg overflow-hidden border border-gray-200 group">
                        <img src={background.url} className="w-full h-full object-cover" />
                        <button onClick={() => setBackground({ file: null, url: null, width: 0, height: 0 })} className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                            <Trash2 className="w-3 h-3" />
                        </button>
                     </div>
                  )}
              </div>
              
              {/* Foreground */}
              <div className="flex-grow">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Photo (Fig 2)</label>
                  {!foreground.url ? (
                    <label className="flex items-center justify-center w-full h-20 border border-gray-300 border-dashed rounded-lg cursor-pointer bg-white hover:bg-gray-50">
                        <div className="text-center">
                            <Upload className="w-4 h-4 text-gray-400 mx-auto" />
                            <span className="text-xs text-gray-500">Upload</span>
                        </div>
                        <input type="file" className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, 'fg')} />
                    </label>
                  ) : (
                     <div className="relative h-20 w-full rounded-lg overflow-hidden border border-gray-200 group">
                        <img src={foreground.url} className="w-full h-full object-cover" />
                        <button onClick={() => setForeground({ file: null, url: null, width: 0, height: 0 })} className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                            <Trash2 className="w-3 h-3" />
                        </button>
                     </div>
                  )}
              </div>
           </div>
        </div>

        {foreground.url && (
            <>
                <div className="space-y-2">
                    <label className="text-xs font-medium text-gray-700 flex justify-between">
                        <span>Transparency</span>
                        <span>{Math.round(transform.opacity * 100)}%</span>
                    </label>
                    <input 
                        type="range" min="0" max="1" step="0.05" 
                        value={transform.opacity}
                        onChange={(e) => setTransform(prev => ({...prev, opacity: parseFloat(e.target.value)}))}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                </div>

                {/* Editing Tabs */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="flex border-b border-gray-100">
                        <button 
                            onClick={() => setEditMode(EditMode.WARP)}
                            className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-2 transition-colors
                                ${editMode === EditMode.WARP ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500 hover:bg-gray-50'}`}
                        >
                            <MousePointer2 className="w-4 h-4" />
                            1. Position & Warp
                        </button>
                        <button 
                            onClick={() => setEditMode(EditMode.MASK)}
                            className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-2 transition-colors
                                ${editMode === EditMode.MASK ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500 hover:bg-gray-50'}`}
                        >
                            <CircleDashed className="w-4 h-4" />
                            2. Binding Holes
                        </button>
                    </div>

                    <div className="p-4 bg-gray-50 min-h-[120px]">
                        {editMode === EditMode.WARP ? (
                            <div className="text-center py-2">
                                <p className="text-xs text-gray-500 mb-2">Drag the 4 white corner handles on the image to match the calendar perspective.</p>
                                <div className="inline-flex items-center px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded border border-blue-200">
                                    Tip: Reduce opacity to see grid lines
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                    <span className="text-xs font-medium text-gray-700">Ring Masks</span>
                                    <div className="flex gap-2">
                                      <button 
                                          onClick={duplicateMask}
                                          disabled={!activeMaskId}
                                          title="Duplicate Active Mask"
                                          className={`flex items-center px-2 py-1 text-xs border rounded shadow-sm transition-colors
                                            ${activeMaskId 
                                              ? 'bg-white border-gray-300 hover:bg-indigo-50 hover:text-indigo-600 cursor-pointer' 
                                              : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'}`}
                                      >
                                          <Copy className="w-3 h-3" />
                                      </button>
                                      <button 
                                          onClick={addMask}
                                          className="flex items-center px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-indigo-50 hover:text-indigo-600 transition-colors shadow-sm"
                                      >
                                          <Plus className="w-3 h-3 mr-1" /> Add
                                      </button>
                                    </div>
                                </div>
                                
                                <div className="space-y-2 max-h-[150px] overflow-y-auto">
                                    {masks.length === 0 && (
                                        <p className="text-xs text-gray-400 text-center py-4 italic">No masks added yet.</p>
                                    )}
                                    {masks.map((mask, idx) => (
                                        <div 
                                            key={mask.id} 
                                            onClick={() => setActiveMaskId(mask.id)}
                                            className={`flex items-center justify-between p-2 rounded border text-xs cursor-pointer
                                                ${activeMaskId === mask.id ? 'bg-white border-indigo-300 shadow-sm ring-1 ring-indigo-100' : 'bg-gray-100 border-transparent hover:bg-white hover:border-gray-200'}`}
                                        >
                                            <span className="font-medium text-gray-600">Hole #{idx + 1}</span>
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); removeMask(mask.id); }}
                                                className="text-gray-400 hover:text-red-500"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                <p className="text-[10px] text-gray-400 mt-2">
                                    Use <strong>Duplicate</strong> for symmetry. <span className="text-red-400 font-bold">Red Dots</span> resize width/height.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </>
        )}

        {/* Actions */}
        <div className="pt-4 border-t border-gray-200 mt-auto">
           <button 
              onClick={() => setShowGuides(!showGuides)}
              className="flex items-center justify-center w-full px-4 py-2 mb-3 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
           >
              {showGuides ? <EyeOff className="w-4 h-4 mr-2"/> : <Eye className="w-4 h-4 mr-2"/>}
              Toggle Guides
           </button>

           <button 
              onClick={handleDownload}
              disabled={!background.url || !foreground.url}
              className={`flex items-center justify-center w-full px-4 py-3 text-sm font-medium text-white rounded-lg shadow-sm transition-all
                ${(!background.url || !foreground.url) 
                  ? 'bg-gray-300 cursor-not-allowed' 
                  : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-md'}`}
           >
              <Download className="w-4 h-4 mr-2" />
              Download Result
           </button>
        </div>

      </div>

      {/* Right Canvas Area */}
      <div className="w-full lg:w-2/3 bg-gray-200 overflow-hidden relative flex items-center justify-center cursor-crosshair" ref={containerRef}>
        <div className="relative shadow-2xl">
            <canvas 
                ref={canvasRef}
                width={canvasSize.width}
                height={canvasSize.height}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onTouchStart={handleMouseDown}
                onTouchMove={handleMouseMove}
                onTouchEnd={handleMouseUp}
                className="max-w-full max-h-[80vh] object-contain bg-white"
                style={{ 
                  width: 'auto', 
                  height: 'auto',
                  maxWidth: '100%',
                  maxHeight: '80vh'
                }}
            />
             {!background.url && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                 <div className="bg-white/80 backdrop-blur-sm p-6 rounded-xl shadow-lg text-center">
                    <CalendarIcon className="w-12 h-12 text-indigo-300 mx-auto mb-3" />
                    <h3 className="text-gray-900 font-semibold text-lg">Waiting for Template</h3>
                    <p className="text-gray-500 text-sm max-w-xs mx-auto mt-1">
                      Upload "Figure 1" (the calendar base) to start.
                    </p>
                 </div>
              </div>
            )}
        </div>
      </div>

    </div>
  );
};
