export interface LauncherSnapRectangle {
  height: number
  width: number
  x: number
  y: number
}

export interface LauncherSnapGuideLines {
  height: number
  horizontalTop: number
  verticalLeft: number
  verticalRight: number
  width: number
}

export const LAUNCHER_SNAP_DISTANCE = 8

function distance(left: number, right: number): number {
  return Math.abs(left - right)
}

export function getLauncherSnapGuideLines(params: {
  displayBounds: LauncherSnapRectangle
  guideBounds: LauncherSnapRectangle
}): LauncherSnapGuideLines {
  const { displayBounds, guideBounds } = params

  return {
    height: displayBounds.height,
    horizontalTop: guideBounds.y - displayBounds.y,
    verticalLeft: guideBounds.x - displayBounds.x,
    verticalRight: guideBounds.x + guideBounds.width - displayBounds.x,
    width: displayBounds.width
  }
}

export function resolveLauncherSnapBounds(params: {
  currentBounds: LauncherSnapRectangle
  guideBounds: LauncherSnapRectangle
  snapDistance?: number
}): LauncherSnapRectangle | null {
  const { currentBounds, guideBounds, snapDistance = LAUNCHER_SNAP_DISTANCE } = params
  const currentRight = currentBounds.x + currentBounds.width
  const guideRight = guideBounds.x + guideBounds.width
  const leftDistance = distance(currentBounds.x, guideBounds.x)
  const rightDistance = distance(currentRight, guideRight)
  const shouldSnapX = Math.min(leftDistance, rightDistance) <= snapDistance
  const yDistance = distance(currentBounds.y, guideBounds.y)
  const shouldSnapY = yDistance <= snapDistance

  if (!shouldSnapX && !shouldSnapY) {
    return null
  }

  return {
    ...currentBounds,
    x: shouldSnapX
      ? leftDistance <= rightDistance
        ? guideBounds.x
        : guideRight - currentBounds.width
      : currentBounds.x,
    y: shouldSnapY ? guideBounds.y : currentBounds.y
  }
}
