
export interface Point {
  x: number;
  y: number;
}

export interface ImageState {
  file: File | null;
  url: string | null;
  width: number;
  height: number;
}

export interface TransformState {
  corners: [Point, Point, Point, Point]; // TopLeft, TopRight, BottomRight, BottomLeft
  opacity: number;
}

export interface Mask {
  id: string;
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  rotation: number;
}

export enum EditMode {
  WARP, // Adjusting corners
  MASK  // Adjusting eraser masks
}

export enum DragMode {
  NONE,
  CORNER_TL,
  CORNER_TR,
  CORNER_BR,
  CORNER_BL,
  MOVE_ALL,
  MASK_MOVE,
  MASK_RESIZE,
  MASK_ROTATE
}
