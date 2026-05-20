declare module "react-grid-layout" {
  import type { ComponentType, HTMLAttributes, ReactNode, RefObject } from "react";

  export interface LayoutItem {
    i: string;
    x: number;
    y: number;
    w: number;
    h: number;
    minW?: number;
    minH?: number;
    maxW?: number;
    maxH?: number;
    isDraggable?: boolean;
    isResizable?: boolean;
    isBounded?: boolean;
  }

  export type Layout = LayoutItem[];

  export interface GridLayoutProps extends HTMLAttributes<HTMLDivElement> {
    width: number;
    layout: Layout;
    autoSize?: boolean;
    gridConfig?: Record<string, unknown>;
    dragConfig?: Record<string, unknown>;
    resizeConfig?: Record<string, unknown>;
    compactor?: unknown;
    onLayoutChange?: (layout: Layout) => void;
    children?: ReactNode;
  }

  export const GridLayout: ComponentType<GridLayoutProps>;
  export const noCompactor: unknown;

  export function useContainerWidth(options?: { initialWidth?: number }): {
    width: number;
    mounted: boolean;
    containerRef: RefObject<HTMLElement>;
  };
}
