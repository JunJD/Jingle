// linkedom 会为 HTMLCanvasElement 尝试加载可选的 node-canvas。
// quick-capture 只需要 DOM 解析供 Readability 使用，这里不提供真实绘图能力。
class CanvasShim {
  height: number
  width: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }

  getContext(): null {
    return null
  }

  toDataURL(): string {
    return ""
  }
}

export function createCanvas(width: number, height: number): CanvasShim {
  return new CanvasShim(width, height)
}

export default {
  createCanvas
}
