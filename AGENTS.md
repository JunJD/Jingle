# Openwork Codex Instructions

## React 状态约束

- 不要在 `useEffect` 的 effect body 里同步调用 `setState` 来派生另一个 React 状态；这会触发 `react-hooks/set-state-in-effect`，也容易造成级联渲染。
- 不要在 render 阶段通过读写 `ref.current` 来驱动渲染状态；这会触发 `react-hooks/refs`。
- 如果一个状态只是另一个状态的投影，优先直接推导；如果需要延迟、节流、过渡或和异步流程对齐，把状态机收口到 hook / 事件处理函数 / effect 的异步回调里，而不是在 effect 里同步回写。
